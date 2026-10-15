import { originOf } from './lib/origin';
import { clampVolume, resolveVolume } from './lib/rules';
import type {
  CaptureGain,
  CaptureStarted,
  CaptureState,
  CaptureStop,
  LevelChanged,
  LevelReply,
  NeedsCapture,
  SetVolume,
  StateReply,
  VizStart,
  VizStartReply,
  VizStopped,
} from './lib/messages';
import * as storage from './lib/storage';

// exposed so Playwright can call storage functions inside the real extension
(globalThis as unknown as { svsStorage: typeof storage }).svsStorage = storage;

const STEP = 5;

async function setBadge(tabId: number, text: string) {
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {}); // tab may be gone
}

/** Badge from storage: the level for saved (exact or wildcard) sites, empty otherwise. */
async function refreshBadge(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const origin = originOf(tab.url);
  const r = origin && resolveVolume(await storage.loadSettings(), origin);
  await setBadge(tab.id, r && r.source !== 'default' ? String(r.volume) : '');
}

const refreshAll = async () => (await chrome.tabs.query({})).forEach(refreshBadge);

/**
 * Chrome only injects content scripts on navigation, so tabs already open at install or update get them here.
 * After an update the MAIN-world copy already in a page stays in charge and the new one steps aside.
 */
async function injectOpenTabs() {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.id === undefined) continue;
    const target = { tabId: tab.id, allFrames: true };
    void chrome.scripting.executeScript({ target, files: ['inject.js'], world: 'MAIN' }).catch(() => {});
    void chrome.scripting.executeScript({ target, files: ['content.js'] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => void storage.migrateLegacy().then(() => Promise.all([injectOpenTabs(), refreshAll()])));
chrome.runtime.onStartup.addListener(() => void storage.migrateLegacy().then(refreshAll));
chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
storage.onSettingsChanged(() => void refreshAll());
chrome.tabs.onActivated.addListener(({ tabId }) => void chrome.tabs.get(tabId).then(refreshBadge));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url || info.status) void refreshBadge(tab);
});

/** Current level of the tab's top frame, or null when the content script is unreachable. */
const getState = (tabId: number) =>
  chrome.tabs.sendMessage<{ type: 'get-state' }, StateReply>(tabId, { type: 'get-state' }, { frameId: 0 }).catch(() => null);

async function run(name: string) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const origin = originOf(tab?.url);
  if (tab?.id === undefined || !origin) return;
  const tabId = tab.id;
  if (name === 'toggle-mute') return void (await chrome.tabs.update(tabId, { muted: !tab.mutedInfo?.muted }));
  const state = await getState(tabId);
  if (!state) return;
  if (name === 'save-site') return void (await storage.saveSite(origin, state.volume));
  const dir = name === 'volume-up' ? 1 : name === 'volume-down' ? -1 : 0;
  if (!dir) return;
  const { boostEnabled } = await storage.loadSettings();
  const volume = clampVolume(state.volume + dir * STEP, boostEnabled);
  const msg: SetVolume = { type: 'set-volume', volume };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  await setBadge(tabId, String(volume)); // preview only; next navigation or settings change recomputes
}

chrome.commands.onCommand.addListener((name) => void run(name));

// exposed so Playwright can trigger commands (it cannot press extension shortcuts)
(globalThis as unknown as { svsCommands: { run: typeof run } }).svsCommands = { run };

// ---------- offscreen document: visualizer and capture fallback ----------

const OFFSCREEN = 'offscreen/offscreen.html';

const hasOffscreen = async () =>
  (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length > 0;

const closeOffscreen = async () => {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
  for (const id of Object.keys(await getTabs('captured'))) await setCaptured(Number(id), null);
};

const createOffscreen = () =>
  chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Plays captured tab audio back, with gain when boosting media the page itself cannot, and measures its levels for the popup visualizer.',
  });

/** Tab id -> origin, in session storage so it survives a service worker restart. */
type Tabs = Record<string, string>;
type TabsKey = 'needy' | 'captured'; // needy: has media only capture can boost; captured: override capture running
const getTabs = async (k: TabsKey): Promise<Tabs> => ((await chrome.storage.session.get(k))[k] as Tabs | undefined) ?? {};
const setTabs = (k: TabsKey, t: Tabs) => chrome.storage.session.set({ [k]: t });
const gainFor = (volume: number | null) => Math.max(volume ?? 100, 100) / 100; // in-page carries up to 100

/** Records an override capture and tells every frame of the tab, so in-page stops boosting on top of it. */
async function setCaptured(tabId: number, origin: string | null) {
  const t = await getTabs('captured');
  if (!origin && !(tabId in t)) return;
  if (origin) t[tabId] = origin;
  else delete t[tabId];
  await setTabs('captured', t);
  const msg: CaptureState = { type: 'capture-state', active: !!origin };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

/**
 * A captured tab is joined, not captured again. Otherwise a fresh document ends any leftover capture,
 * so getMediaStreamId cannot fail on it, unless override captures of other tabs must keep running.
 */
async function vizStart(tabId: number | undefined): Promise<VizStartReply> {
  const gen = (((await chrome.storage.session.get('gen')).gen as number | undefined) ?? 0) + 1;
  await chrome.storage.session.set({ gen });
  if (!(await hasOffscreen())) await closeOffscreen(); // forget captures of a document that is gone
  else if (tabId !== undefined && (await getTabs('captured'))[tabId]) return { attach: true, gen };
  if (!Object.keys(await getTabs('captured')).length) {
    await closeOffscreen();
    await createOffscreen();
  }
  if (tabId === undefined || !(await getTabs('needy'))[tabId]) return { attach: false, gen };
  return { attach: false, gain: gainFor((await getState(tabId))?.volume ?? null), gen };
}

async function vizStopped({ tabId, remaining, gen }: VizStopped) {
  if (tabId !== undefined) await setCaptured(tabId, null);
  if (gen !== undefined && gen !== (await chrome.storage.session.get('gen')).gen) return; // a newer start owns the document
  if (remaining === 0 || (remaining === undefined && !Object.keys(await getTabs('captured')).length)) await closeOffscreen();
}

/** Tab closed (origin null) or navigated: drop what belonged to its old origin. */
async function forgetTab(tabId: number, origin: string | null) {
  const needy = await getTabs('needy');
  if (tabId in needy && needy[tabId] !== origin) {
    delete needy[tabId];
    await setTabs('needy', needy);
  }
  const captured = (await getTabs('captured'))[tabId];
  if (captured && captured !== origin) {
    const stop: CaptureStop = { type: 'capture-stop', tabId };
    const stopped = await chrome.runtime.sendMessage<CaptureStop, boolean>(stop).catch(() => false); // then viz-stopped follows
    if (!stopped) await setCaptured(tabId, null);
  }
}

/** Level changed in a tab that might be captured: re-apply the gain, tell the frame whether it is capped. */
async function levelChanged(tabId: number, volume: number | null): Promise<LevelReply> {
  const captured = !!(await getTabs('captured'))[tabId];
  const msg: CaptureGain = { type: 'capture-gain', tabId, gain: gainFor(volume) };
  if (captured) await chrome.runtime.sendMessage(msg).catch(() => {});
  return { captured };
}

// one document at a time and no lost updates to the session maps: jobs run in order
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

type CaptureMsg = VizStart | VizStopped | CaptureStarted | NeedsCapture | LevelChanged;

chrome.runtime.onMessage.addListener((msg: CaptureMsg, sender, reply) => {
  const tabId = sender.tab?.id;
  switch (msg?.type) {
    case 'viz-start':
      serial(() => vizStart(msg.tabId)).then(reply, () => reply(false));
      return true;
    case 'viz-stopped':
      void serial(() => vizStopped(msg));
      break;
    case 'capture-started':
      void serial(async () => setCaptured(msg.tabId, originOf((await chrome.tabs.get(msg.tabId).catch(() => null))?.url) ?? ''));
      break;
    case 'needs-capture': {
      const origin = originOf(sender.tab?.url);
      if (tabId !== undefined && origin) void serial(async () => setTabs('needy', { ...(await getTabs('needy')), [tabId]: origin }));
      break;
    }
    case 'level':
      if (tabId === undefined) return;
      serial(() => levelChanged(tabId, msg.volume)).then(reply, () => reply({ captured: false }));
      return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void serial(() => forgetTab(tabId, null)));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) void serial(() => forgetTab(tabId, originOf(info.url)));
});
