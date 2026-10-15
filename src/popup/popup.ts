import { originOf } from '../lib/origin';
import { clampVolume, emptySettings, isExcluded, maxVolume, resolveVolume, type Settings } from '../lib/rules';
import type { GetState, SetVolume, StateReply } from '../lib/messages';
import * as storage from '../lib/storage';
import '../ui/tokens.css';
import '../ui/base.css';
import './popup.css';
import { initTheme } from '../ui/theme';
import { createKnob } from '../ui/knob';
import { connectAudio } from './capture';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings = emptySettings();
let tabId: number | undefined;
let origin: string | null = null;
let reachable = false;
let hasMedia = true;
let volume = 100;

void initTheme();

const notice = (text: string, warn = false) => {
  const el = $('notice');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('warn', warn);
};

// ---------- live volume ----------

let pending = 0;
let frame = 0;
function sendLive(v: number) {
  pending = v;
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    const msg: SetVolume = { type: 'set-volume', volume: pending };
    void chrome.tabs.sendMessage(tabId!, msg).catch(() => {});
  });
}

const knob = createKnob($('knobHost'), {
  value: 100,
  max: 100,
  step: 5,
  onInput(v) {
    volume = v;
    if (reachable) sendLive(v);
    paintSave();
  },
  onChange(v) {
    volume = v;
  },
});

function setVolume(v: number) {
  volume = clampVolume(v, settings.boostEnabled);
  knob.setValue(volume, true);
  paintSave();
  if (reachable) sendLive(volume);
}

for (const b of document.querySelectorAll<HTMLElement>('[data-preset]')) {
  b.addEventListener('click', () => reachable && setVolume(Number(b.dataset.preset)));
}

$<HTMLInputElement>('boost').addEventListener('change', (e) => {
  void storage.setBoostEnabled((e.target as HTMLInputElement).checked).catch((err: Error) => notice(`Save failed: ${err.message}`, true));
});

// ---------- paint ----------

// ponytail: only strips a leading "www."; no public-suffix list, so on co.uk style hosts the wildcard is too narrow or too wide. Add the PSL if that bites.
const wildcardFor = (o: string) => {
  const host = new URL(o).hostname.replace(/^www\./, '');
  return /^[\d.]+$/.test(host) || host.includes(':') ? null : `*.${host}`;
};
/** Key the main Save button writes: the whole domain, or the exact origin where no wildcard is possible (IPs). */
const domainKey = () => (origin === null ? null : (wildcardFor(origin) ?? origin));
const urlSaved = () => origin !== null && origin in settings.sites;
const saved = () => urlSaved() || (domainKey() !== null && domainKey()! in settings.sites);
const excluded = () => origin !== null && isExcluded(settings, origin);

function paintChips() {
  for (const b of document.querySelectorAll<HTMLElement>('[data-preset]')) b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === volume));
}

function paintSave() {
  paintChips();
  const s = saved();
  const btn = $<HTMLButtonElement>('saveBtn');
  btn.textContent = s ? 'Unsave' : 'Save';
  btn.setAttribute('aria-pressed', String(s));
  btn.classList.toggle('is-saved', s);
  btn.disabled = !reachable || excluded();
}

function paintMenu() {
  $('menuUrl').textContent = urlSaved() ? 'Unsave this URL' : 'Save for this URL';
  ($('menuUrl') as HTMLButtonElement).disabled = !origin || !reachable || origin === domainKey(); // same key as the main button
  const ex = origin !== null && settings.excluded.includes(origin);
  $('menuExclude').textContent = ex ? 'Stop ignoring this site' : 'Never touch this site';
  ($('menuExclude') as HTMLButtonElement).disabled = !origin;
}

function paint() {
  $('siteOrigin').textContent = origin ?? 'This page';
  let tag = '';
  if (origin) {
    const r = resolveVolume(settings, origin);
    tag = isExcluded(settings, origin) ? 'excluded' : r ? (r.source === 'exact' ? 'saved' : r.source) : 'not saved';
  }
  const pill = $('sourcePill');
  pill.textContent = tag;
  pill.hidden = !tag;
  pill.dataset.source = tag.replace(' ', '-');

  volume = clampVolume(volume, settings.boostEnabled);
  knob.setMax(maxVolume(settings.boostEnabled));
  knob.setValue(volume);
  knob.setDisabled(!reachable || excluded());
  $<HTMLInputElement>('boost').checked = settings.boostEnabled;
  $('controls').classList.toggle('is-off', !reachable || excluded());
  for (const el of $('controls').querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-preset], #boost')) el.disabled = !reachable || excluded();
  paintSave();
  paintMenu();
  if (reachable && !hasMedia && !excluded()) notice('No media on this page yet. The level applies once something plays.');
}

function showBlocked() {
  $('controls').hidden = true;
  $('blocked').hidden = false;
  const reloadable = origin !== null && tabId !== undefined;
  $('blockedText').textContent = reloadable
    ? "This tab can't be controlled yet. It was probably open before the extension was installed or updated. Reload it and try again."
    : "Browser pages and the web store can't be controlled by extensions.";
  $('reloadBtn').hidden = !reloadable;
}

// ---------- actions ----------

$('saveBtn').addEventListener('click', async () => {
  const key = domainKey();
  if (!key) return;
  try {
    if (saved()) await storage.removeSite(key in settings.sites ? key : origin!);
    else await storage.saveSite(key, volume);
    notice('');
  } catch (e) {
    notice(`Save failed: ${(e as Error).message}`, true);
  }
});

const muteBtn = $('muteBtn');
const paintMute = (muted: boolean) => {
  muteBtn.textContent = muted ? 'Unmute tab' : 'Mute tab';
  muteBtn.setAttribute('aria-pressed', String(muted));
};
muteBtn.addEventListener('click', async () => {
  if (tabId === undefined) return;
  const muted = !(await chrome.tabs.get(tabId)).mutedInfo?.muted;
  await chrome.tabs.update(tabId, { muted });
  paintMute(muted);
});
$('muteOthersBtn').addEventListener('click', async () => {
  const others = (await chrome.tabs.query({ audible: true })).filter((t) => t.id !== undefined && t.id !== tabId);
  await Promise.all(others.map((t) => chrome.tabs.update(t.id!, { muted: true })));
  notice(others.length ? `Muted ${others.length} other tab${others.length > 1 ? 's' : ''}.` : 'No other tab is playing audio.');
});

// muted tabs: listed with an unmute button each, hidden when none
const mutedList = $('mutedList');
async function paintMuted() {
  const tabs = (await chrome.tabs.query({ muted: true })).filter((t) => t.id !== undefined);
  mutedList.hidden = !tabs.length;
  mutedList.replaceChildren(
    ...tabs.map((t) => {
      const name = document.createElement('span');
      name.textContent = t.title || t.url || 'Tab';
      name.title = name.textContent;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Unmute';
      btn.addEventListener('click', () => void chrome.tabs.update(t.id!, { muted: false }));
      const li = document.createElement('li');
      li.append(name, btn);
      return li;
    }),
  );
}
chrome.tabs.onUpdated.addListener((id, info) => {
  if (!info.mutedInfo) return;
  void paintMuted();
  if (id === tabId) paintMute(info.mutedInfo.muted);
});
chrome.tabs.onRemoved.addListener(() => void paintMuted());
void paintMuted();

$('gearBtn').addEventListener('click', () => void chrome.runtime.openOptionsPage());
$('reloadBtn').addEventListener('click', () => tabId !== undefined && void chrome.tabs.reload(tabId).then(() => window.close()));

// site menu
const menu = $('menu');
const toggleMenu = (open: boolean) => {
  menu.hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
  if (open) ($('menuExclude') as HTMLButtonElement).focus();
};
$('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(!!menu.hidden);
});
document.addEventListener('click', (e) => !menu.contains(e.target as Node) && toggleMenu(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && !menu.hidden && (toggleMenu(false), $('menuBtn').focus()));

$('menuExclude').addEventListener('click', async () => {
  toggleMenu(false);
  if (!origin) return;
  const list = settings.excluded.includes(origin) ? settings.excluded.filter((x) => x !== origin) : [...settings.excluded, origin];
  await storage.setExcluded(list).catch((e: Error) => notice(`Save failed: ${e.message}`, true));
});
$('menuUrl').addEventListener('click', async () => {
  toggleMenu(false);
  if (!origin) return;
  const unsave = urlSaved();
  try {
    if (!unsave) return await storage.saveSite(origin, volume);
    await storage.removeSite(origin);
    // the page falls back to the domain level; keep the knob in step with it
    const { [origin]: _, ...sites } = settings.sites;
    const r = resolveVolume({ ...settings, sites }, origin);
    if (r) setVolume(r.volume);
  } catch (e) {
    notice(`Save failed: ${(e as Error).message}`, true);
  }
});

// first-run hint: shown once, remembered per device
async function firstRun() {
  const { hintSeen } = await chrome.storage.local.get('hintSeen');
  if (hintSeen) return;
  $('hint').hidden = false;
  void chrome.storage.local.set({ hintSeen: true });
}
$('hintClose').addEventListener('click', () => ($('hint').hidden = true));

// ---------- boot ----------

/** Target tab: `?tabId=N` (tests, where the popup is itself a tab) or the active tab of the focused window. */
async function findTab(): Promise<chrome.tabs.Tab | undefined> {
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return chrome.tabs.get(Number(forced));
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}

void (async () => {
  settings = await storage.loadSettings();
  const tab = await findTab();
  tabId = tab?.id;
  origin = originOf(tab?.url);
  paintMute(tab?.mutedInfo?.muted === true);
  const icon = $<HTMLImageElement>('favicon');
  if (tab?.favIconUrl && origin) {
    icon.src = tab.favIconUrl;
    icon.hidden = false;
    icon.addEventListener('error', () => (icon.hidden = true));
  }
  if (tabId !== undefined && origin) {
    const msg: GetState = { type: 'get-state' };
    const state = await chrome.tabs.sendMessage<GetState, StateReply>(tabId, msg, { frameId: 0 }).catch(() => null);
    if (state) {
      reachable = true;
      volume = state.volume;
      hasMedia = state.hasMedia;
    }
  }
  paint();
  if (reachable) connectAudio(tabId!, (levels) => (levels.length ? knob.setLevels(levels) : knob.setIdle()));
  else showBlocked();
  void firstRun();
  storage.onSettingsChanged((s) => {
    settings = s;
    paint();
  });
})();
