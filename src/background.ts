import { originOf } from './lib/origin';
import { clampVolume, resolveVolume } from './lib/rules';
import type { SetVolume, StateReply } from './lib/messages';
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

chrome.runtime.onInstalled.addListener(() => void storage.migrateLegacy());
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
