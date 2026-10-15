import { originOf } from './lib/origin';
import { clampVolume, resolveVolume, type Resolved } from './lib/rules';
import type { SetVolume, StateReply, VizStart, VizStopped } from './lib/messages';
import * as storage from './lib/storage';

// exposed so Playwright can call storage functions inside the real extension
(globalThis as unknown as { svsStorage: typeof storage }).svsStorage = storage;

const STEP = 5;

async function setBadge(tabId: number, text: string, color?: string) {
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {}); // tab may be gone
  if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

/** Badge background by state: blue saved, violet wildcard, gray default, red while the tab is muted. */
function badgeColor(source: Resolved['source'] | null, muted: boolean): string {
  if (muted) return '#dc2626';
  if (source === 'exact') return '#3b82f6';
  if (source === 'wildcard') return '#8b5cf6';
  return '#5f6368';
}

/** Badge from storage: the level for saved (exact or wildcard) sites, empty otherwise. A muted tab with no level shows "×". */
async function refreshBadge(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const origin = originOf(tab.url);
  const r = origin && resolveVolume(await storage.loadSettings(), origin);
  const muted = !!tab.mutedInfo?.muted;
  const level = r && r.source !== 'default' ? String(r.volume) : '';
  await setBadge(tab.id, level || (muted ? '×' : ''), badgeColor(r ? r.source : null, muted));
}

const refreshAll = async () => (await chrome.tabs.query({})).forEach(refreshBadge);

/** Chrome only injects content scripts on navigation, so tabs already open at install or update get them here. */
async function injectOpenTabs() {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.id === undefined) continue;
    void chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => void storage.migrateLegacy().then(() => Promise.all([injectOpenTabs(), refreshAll()])));
chrome.runtime.onStartup.addListener(() => void storage.migrateLegacy().then(refreshAll));
chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
chrome.action.setBadgeTextColor({ color: '#ffffff' });
storage.onSettingsChanged(() => void refreshAll());
chrome.tabs.onActivated.addListener(({ tabId }) => void chrome.tabs.get(tabId).then(refreshBadge));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url || info.status || info.mutedInfo) void refreshBadge(tab);
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

// ---------- visualizer offscreen document ----------

const OFFSCREEN = 'offscreen/offscreen.html';

const closeOffscreen = async () => {
  const docs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (docs.length) await chrome.offscreen.closeDocument().catch(() => {});
};

/** Fresh document per popup: closing the old one ends any capture still running, so getMediaStreamId cannot fail on it. */
const startOffscreen = async () => {
  await closeOffscreen();
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Plays captured tab audio back unchanged and measures its levels for the popup visualizer.',
  });
};

// one document at a time: run opens and closes in order
let queue: Promise<unknown> = Promise.resolve();
const serial = (job: () => Promise<void>) => (queue = queue.then(job, job));

chrome.runtime.onMessage.addListener((msg: VizStart | VizStopped, _sender, reply) => {
  if (msg?.type === 'viz-start') {
    serial(startOffscreen).then(() => reply(true), () => reply(false));
    return true;
  }
  if (msg?.type === 'viz-stopped') void serial(closeOffscreen);
});
