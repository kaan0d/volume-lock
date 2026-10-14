import { originOf } from '../lib/origin';
import { clampVolume, emptySettings, maxVolume, resolveVolume, type Settings } from '../lib/rules';
import type { GetState, SetVolume, StateReply } from '../lib/messages';
import * as storage from '../lib/storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const BARS = 24;
const BAR_AREA = 140; // height of .wave-control
const MARGIN = 12; // keeps the line's hit area inside the clipped control
const TRAVEL = BAR_AREA - MARGIN * 2;
const QUIET = 20;
const STEP = 5;

let settings: Settings = emptySettings();
let tabId: number | undefined;
let origin: string | null = null;
let reachable = false;
let hasMedia = true;
let volume = 100;

// ---------- theme (per device, storage.local) ----------

type Theme = 'dark' | 'light';
const applyTheme = (t: Theme) => (document.documentElement.dataset.theme = t);
applyTheme(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
void chrome.storage.local.get('theme').then(({ theme }) => (theme === 'light' || theme === 'dark') && applyTheme(theme));
$('themeToggle').addEventListener('click', () => {
  const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  void chrome.storage.local.set({ theme: next });
});

// ---------- tabs ----------

const pages = [
  { btn: $('tabBtnMain'), page: $('pageMain') },
  { btn: $('tabBtnSites'), page: $('pageSites') },
];
for (const sel of pages) {
  sel.btn.addEventListener('click', () => {
    for (const p of pages) {
      p.btn.setAttribute('aria-selected', String(p === sel));
      p.page.classList.toggle('hidden', p !== sel);
    }
  });
}

// ---------- visualizer (step 6 fills this in) ----------

/** Live level bars for the tab's audio. No-op until the offscreen capture lands; bars stay idle. */
export function startVisualizer(container: HTMLElement, tabId: number): void {
  void container, tabId;
}

// ---------- volume tab ----------

const wave = $('waveControl');
const line = $('waveLine');
const notice = (text: string, warn = false) => {
  const el = $('notice');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('warn', warn);
};

const max = () => maxVolume(settings.boostEnabled);

function paintFader() {
  volume = clampVolume(volume, settings.boostEnabled);
  const m = max();
  $('volumeDisplay').textContent = `${volume}%`;
  line.style.setProperty('--wave-line-y', `${MARGIN + (1 - volume / m) * TRAVEL}px`);
  line.setAttribute('aria-valuenow', String(volume));
  line.setAttribute('aria-valuemax', String(m));
  line.setAttribute('aria-valuetext', `${volume}%`);
  wave.classList.toggle('is-quiet', volume < QUIET);
  $('waveBars').classList.toggle('is-quiet', volume < QUIET);
  const mark = $('boostMark');
  mark.classList.toggle('hidden', !settings.boostEnabled);
  mark.style.setProperty('--mark-y', `${MARGIN + (1 - 100 / m) * TRAVEL}px`);
}

function paintSource() {
  $('siteOrigin').textContent = origin ?? 'This page';
  let tag = '';
  if (reachable && origin) {
    const r = resolveVolume(settings, origin);
    tag = settings.excluded.includes(origin) ? 'excluded' : r ? r.source === 'exact' ? 'saved' : r.source : 'not saved';
    if (!hasMedia) tag += ' · no media yet';
  }
  $('siteSource').textContent = tag;
  const saved = origin !== null && origin in settings.sites;
  ($('resetBtn') as HTMLButtonElement).disabled = !reachable || !saved;
  ($('saveBtn') as HTMLButtonElement).disabled = !reachable;
}

function paintReachable() {
  wave.classList.toggle('disabled', !reachable);
  line.tabIndex = reachable ? 0 : -1;
  line.setAttribute('aria-disabled', String(!reachable));
  notice(reachable ? '' : "This page can't be controlled by the extension. If it is a normal web page, reload it.", true);
}

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

function setVolume(v: number) {
  volume = v;
  paintFader();
  if (reachable) sendLive(volume);
}

const fromPointer = (clientY: number) => {
  const y = clientY - wave.getBoundingClientRect().top - MARGIN;
  return Math.round(Math.min(1, Math.max(0, 1 - y / TRAVEL)) * max());
};

line.addEventListener('pointerdown', (e) => {
  if (!reachable) return;
  e.preventDefault();
  line.setPointerCapture(e.pointerId);
  line.classList.add('dragging');
  setVolume(fromPointer(e.clientY));
});
line.addEventListener('pointermove', (e) => line.classList.contains('dragging') && setVolume(fromPointer(e.clientY)));
const endDrag = () => line.classList.remove('dragging');
line.addEventListener('pointerup', endDrag);
line.addEventListener('pointercancel', endDrag);
line.addEventListener('keydown', (e) => {
  if (!reachable) return;
  const to: Record<string, number> = {
    ArrowUp: volume + STEP, ArrowRight: volume + STEP, ArrowDown: volume - STEP, ArrowLeft: volume - STEP, Home: 0, End: max(),
  };
  if (!(e.key in to)) return;
  e.preventDefault();
  setVolume(to[e.key]);
});

$('saveBtn').addEventListener('click', async () => {
  if (origin) await storage.saveSite(origin, volume);
});
$('resetBtn').addEventListener('click', async () => {
  if (!origin) return;
  await storage.removeSite(origin);
  const { [origin]: _, ...sites } = settings.sites;
  setVolume(resolveVolume({ ...settings, sites }, origin)?.volume ?? 100);
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

/** Target tab: `?tabId=N` (tests, where the popup is itself a tab) or the active tab of the focused window. */
async function findTab(): Promise<chrome.tabs.Tab | undefined> {
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return chrome.tabs.get(Number(forced));
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}

async function initVolumeTab() {
  const tab = await findTab();
  tabId = tab?.id;
  origin = originOf(tab?.url);
  paintMute(tab?.mutedInfo?.muted === true);
  if (tabId !== undefined && origin) {
    const msg: GetState = { type: 'get-state' };
    const state = await chrome.tabs.sendMessage<GetState, StateReply>(tabId, msg, { frameId: 0 }).catch(() => null);
    if (state) {
      reachable = true;
      volume = state.volume;
      hasMedia = state.hasMedia;
    }
  }
  const bars = $('waveBars');
  for (let i = 0; i < BARS; i++) bars.appendChild(document.createElement('span'));
  paintReachable();
  render();
  if (reachable) startVisualizer(bars, tabId!);
}

// ---------- boot ----------

function render() {
  paintSource();
  paintFader();
}

void (async () => {
  settings = await storage.loadSettings();
  await initVolumeTab();
  storage.onSettingsChanged((s) => {
    settings = s;
    render();
  });
})();
