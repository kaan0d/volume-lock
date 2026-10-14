import { originOf } from '../lib/origin';
import { clampVolume, emptySettings, isValidPattern, maxVolume, resolveVolume, type Settings } from '../lib/rules';
import type { GetState, SetVolume, StateReply } from '../lib/messages';
import * as storage from '../lib/storage';
import { exportSettings, parseImport } from '../lib/transfer';

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

// ---------- saved sites tab ----------

const input = (id: string) => $<HTMLInputElement>(id);
const show = (id: string, text: string) => {
  $(id).textContent = text;
  $(id).classList.toggle('hidden', !text);
};

function el(tag: string, props: Record<string, unknown> = {}, ...kids: Node[]): HTMLElement {
  const e = Object.assign(document.createElement(tag), props) as HTMLElement;
  e.append(...kids);
  return e;
}

/** A pattern/value row with a delete button; `middle` is an extra element between them. */
function row(pattern: string, onDelete: () => void, middle?: HTMLElement) {
  const del = el('button', { type: 'button', className: 'icon-btn-remove', title: 'Remove', textContent: '×' });
  del.setAttribute('aria-label', `Remove ${pattern}`);
  del.addEventListener('click', onDelete);
  return el('li', { className: 'site-row' }, el('span', { className: 'site-host', textContent: pattern, title: pattern }), ...(middle ? [middle] : []), del);
}

function levelInput(label: string, value: number, onCommit: (v: number) => void) {
  const f = el('input', { type: 'number', className: 'field', min: '0', max: String(max()), value: String(value) }) as unknown as HTMLInputElement;
  f.setAttribute('aria-label', label);
  f.addEventListener('change', () => {
    if (f.value.trim() === '' || Number.isNaN(f.valueAsNumber)) return void (f.value = String(value));
    onCommit(clampVolume(f.valueAsNumber, settings.boostEnabled));
  });
  return el('span', { className: 'site-level' }, f, document.createTextNode('%'));
}

function renderSites() {
  const q = input('search').value.trim().toLowerCase();
  const all = Object.entries(settings.sites).sort(([a], [b]) => a.localeCompare(b));
  const shown = all.filter(([p]) => p.toLowerCase().includes(q));
  $('siteCount').textContent = String(all.length);
  $('siteList').replaceChildren(
    ...shown.map(([p, v]) => row(p, () => storage.removeSite(p), levelInput(`Level for ${p}`, v, (n) => storage.saveSite(p, n)))),
  );
  $('emptyState').textContent = all.length ? 'No matching sites.' : 'No sites saved yet. Set a level on the Volume tab and hit Save site.';
  $('emptyState').classList.toggle('hidden', shown.length > 0);
  ($('deleteAllBtn') as HTMLButtonElement).disabled = all.length === 0;

  $('excludeCount').textContent = String(settings.excluded.length);
  $('excludeList').replaceChildren(
    ...settings.excluded.map((p) => row(p, () => storage.setExcluded(settings.excluded.filter((x) => x !== p)))),
  );

  const m = String(max());
  for (const id of ['addLevel', 'defaultLevel']) input(id).max = m;
  input('boostOn').checked = settings.boostEnabled;
  input('defaultOn').checked = settings.defaultVolume !== null;
  input('defaultLevel').disabled = settings.defaultVolume === null;
  if (document.activeElement !== input('defaultLevel') && settings.defaultVolume !== null) input('defaultLevel').value = String(settings.defaultVolume);
  const over = all.filter(([, v]) => v > 100).length + ((settings.defaultVolume ?? 0) > 100 ? 1 : 0);
  show('boostNote', !settings.boostEnabled && over ? `${over} stored level${over > 1 ? 's are' : ' is'} above 100% and play at 100% while boost is off. They are kept as they are.` : '');
}

input('search').addEventListener('input', renderSites);

const levelOf = (id: string) => input(id).valueAsNumber;
$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = input('addPattern').value.trim().toLowerCase();
  const level = levelOf('addLevel');
  if (!isValidPattern(pattern)) return show('addError', 'Enter an origin like https://example.com or a wildcard like *.example.com.');
  if (!Number.isInteger(level) || level < 0 || level > max()) return show('addError', `Level must be a whole number from 0 to ${max()}.`);
  show('addError', '');
  await storage.saveSite(pattern, level);
  input('addPattern').value = '';
});

$('excludeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = input('excludePattern').value.trim().toLowerCase();
  if (!isValidPattern(pattern)) return show('excludeError', 'Enter an origin like https://example.com or a wildcard like *.example.com.');
  show('excludeError', '');
  if (!settings.excluded.includes(pattern)) await storage.setExcluded([...settings.excluded, pattern]);
  input('excludePattern').value = '';
});

const saveDefault = () => {
  const n = levelOf('defaultLevel');
  return storage.setDefaultVolume(input('defaultOn').checked ? clampVolume(Number.isNaN(n) ? 100 : n, settings.boostEnabled) : null);
};
input('defaultOn').addEventListener('change', saveDefault);
input('defaultLevel').addEventListener('change', saveDefault);
input('boostOn').addEventListener('change', () => storage.setBoostEnabled(input('boostOn').checked));

// ---------- delete all, export, import ----------

/** Swaps a trigger for an inline confirm row; `yes` runs on confirm. */
function inlineConfirm(trigger: string, row: string, yes: string, no: string, onYes: () => Promise<void> | void) {
  const toggle = (asking: boolean) => {
    $(trigger).classList.toggle('hidden', asking);
    $(row).classList.toggle('hidden', !asking);
    if (asking) $(no).focus();
  };
  $(no).addEventListener('click', () => toggle(false));
  $(yes).addEventListener('click', async () => {
    toggle(false);
    await onYes();
  });
  return toggle;
}

const askDeleteAll = inlineConfirm('deleteAllBtn', 'deleteAllConfirm', 'deleteAllYes', 'deleteAllNo', () => storage.clearSites());
$('deleteAllBtn').addEventListener('click', () => askDeleteAll(true));

$('exportBtn').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([exportSettings(settings)], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'simple-volume-saver-settings.json' });
  a.click();
  URL.revokeObjectURL(url);
});

let imported: Settings | null = null;
const showImport = inlineConfirm('importBtn', 'importConfirm', 'importYes', 'importNo', async () => {
  if (imported) await storage.replaceSettings(imported);
  imported = null;
});
// the confirm row only appears once a valid file was picked
$('importBtn').addEventListener('click', () => input('importFile').click());
input('importFile').addEventListener('change', async () => {
  const file = input('importFile').files?.[0];
  input('importFile').value = '';
  if (!file) return;
  showImport(false);
  try {
    imported = parseImport(await file.text());
    show('backupError', '');
    showImport(true);
  } catch (e) {
    imported = null;
    show('backupError', `Import failed: ${(e as Error).message}`);
  }
});

// ---------- boot ----------

function render() {
  paintSource();
  paintFader();
  renderSites();
}

void (async () => {
  settings = await storage.loadSettings();
  await initVolumeTab();
  storage.onSettingsChanged((s) => {
    settings = s;
    render();
  });
})();
