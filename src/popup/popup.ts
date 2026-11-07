import { displayOrigin, originOf } from '../lib/origin';
import { clampVolume, coveringKey, covers, EQ_PRESETS, emptyQuiet, emptySettings, inList, isExcluded, maxVolume, presetOf, resolveVolume, type Settings } from '../lib/rules';
import type { GetState, ResetTab, SetVolume, StateReply } from '../lib/messages';
import * as storage from '../lib/storage';
import '../ui/tokens.css';
import '../ui/base.css';
import './popup.css';
import { initTheme } from '../ui/theme';
import { createKnob } from '../ui/knob';
import '../ui/designs.css';
import { connectAudio } from './capture';
import { applyI18n, presetName, t as tr } from '../lib/i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings = emptySettings();
let tabId: number | undefined;
let origin: string | null = null;
let reachable = false;
let volume = 100;
let warnAbove = 150;
let quiet = emptyQuiet();

void initTheme();
applyI18n();

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

/** Re-asks the page whether boost/effects are routed; shows the click hint if not. */
async function recheckIdle() {
  if (!reachable || tabId === undefined) return;
  await new Promise((r) => setTimeout(r, 250));
  const state = await chrome.tabs.sendMessage<GetState, StateReply>(tabId, { type: 'get-state' }, { frameId: 0 }).catch(() => null);
  if (state) showState(state);
}

let lastState: StateReply | null = null;

function showState(state: StateReply) {
  lastState = state;
  paintBoost();
  $('boostHint').hidden = !state.idle;
  $('captureWarn').hidden = !state.needsCapture;
}

// tag -> message key; the tag itself stays English because CSS and tests key on it
const PILL: Record<string, string> = { excluded: 'pillExcluded', saved: 'pillSaved', 'not saved': 'pillNotSaved', wildcard: 'pillWildcard', quiet: 'pillQuiet', default: 'pillDefault' };

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
    // a saved site follows the knob: the new level is stored once the move settles
    const key = covering();
    void recheckIdle();
    if (key !== null && reachable && settings.sites[key] !== v) storage.saveSite(key, v).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
  },
});

function setVolume(v: number) {
  volume = clampVolume(v, settings.boostEnabled, settings.boostMax);
  knob.setValue(volume, true);
  paintSave();
  if (reachable) sendLive(volume);
}

for (const b of document.querySelectorAll<HTMLElement>('[data-preset]')) {
  b.addEventListener('click', () => reachable && setVolume(Number(b.dataset.preset)));
}

$<HTMLInputElement>('boost').addEventListener('change', (e) => {
  void storage.setBoostEnabled((e.target as HTMLInputElement).checked).catch((err: Error) => notice(tr('saveFailed', storage.friendly(err)), true));
});

// ---------- paint ----------

// ponytail: no public-suffix list. Keeps the last two labels, three when the second-to-last is a common
// second-level word under a 2-letter TLD (bbc.co.uk). Odd suffixes (e.g. github.io) come out too wide; add the PSL if that bites.
const SECOND_LEVEL = /^(co|com|org|net|gov|edu|ac)$/;
const wildcardFor = (o: string) => {
  const host = new URL(o).hostname;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null;
  const labels = host.split('.');
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.test(labels.at(-2)!) ? 3 : 2;
  return `*.${labels.slice(-keep).join('.')}`;
};
/** Key the main Save button writes: the whole domain, or the exact origin where no wildcard is possible (IPs). */
const domainKey = () => (origin === null ? null : (wildcardFor(origin) ?? origin));
const urlSaved = () => origin !== null && origin in settings.sites;
const covering = () => (origin === null || excluded() ? null : coveringKey(settings, origin));
const saved = () => covering() !== null;
const excluded = () => origin !== null && isExcluded(settings, origin);

function paintChips() {
  for (const b of document.querySelectorAll<HTMLElement>('[data-preset]')) b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === volume));
}

/** Says in words whether boost is doing something right now. */
function paintBoost() {
  const el = $('boostStatus');
  el.hidden = !settings.boostEnabled || !reachable || excluded();
  if (el.hidden) return;
  const gain = volume / 100;
  el.textContent = lastState?.idle ? tr('boostWaiting') : volume > 100 ? tr('boostActive', [`+${(20 * Math.log10(gain)).toFixed(1)}`, gain.toFixed(1)]) : tr('boostReady');
}

function paintSave() {
  paintChips();
  paintBoost();
  $('loudWarn').hidden = !(warnAbove > 0 && volume > warnAbove);
  const s = saved();
  const btn = $<HTMLButtonElement>('saveBtn');
  btn.textContent = tr(s ? 'unsave' : 'save');
  btn.setAttribute('aria-pressed', String(s));
  btn.classList.toggle('is-saved', s);
  btn.disabled = !reachable || excluded();
}

const eqSel = $<HTMLSelectElement>('eqSel');
eqSel.replaceChildren(...[...Object.keys(EQ_PRESETS), 'Custom'].map((n) => Object.assign(document.createElement('option'), { value: n, textContent: presetName(n) })));
eqSel.addEventListener('change', () => {
  const eq = EQ_PRESETS[eqSel.value];
  if (eq) void storage.setFx({ ...settings.fx, eq }).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
});
$('nightBtn').addEventListener('click', () => {
  void storage.setFx({ ...settings.fx, leveler: !settings.fx.leveler }).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
});

function paintSound() {
  eqSel.value = presetOf(settings.fx.eq) ?? 'Custom';
  $('nightBtn').setAttribute('aria-pressed', String(settings.fx.leveler));
  const off = !reachable || excluded();
  eqSel.disabled = off;
  ($('nightBtn') as HTMLButtonElement).disabled = off;
}

function paintMenu() {
  $('menuUrl').textContent = tr(urlSaved() ? 'unsaveUrl' : 'saveUrl');
  ($('menuUrl') as HTMLButtonElement).disabled = !origin || !reachable || origin === domainKey(); // same key as the main button
  const ex = origin !== null && settings.excluded.includes(origin);
  $('menuExclude').textContent = tr(ex ? 'stopIgnoring' : 'neverTouchSite');
  ($('menuExclude') as HTMLButtonElement).disabled = !origin;
  ($('menuDefault') as HTMLButtonElement).disabled = !reachable;
}

function paint() {
  $('siteOrigin').textContent = origin ? displayOrigin(origin) : tr('thisPage');
  let tag = '';
  if (origin) {
    const r = resolveVolume(settings, origin, storage.quietLevel(quiet));
    tag = isExcluded(settings, origin) ? 'excluded' : r ? (r.source === 'exact' ? 'saved' : r.source) : 'not saved';
  }
  const pill = $('sourcePill');
  pill.textContent = tag && tr(PILL[tag]);
  pill.hidden = !tag;
  pill.dataset.source = tag.replace(' ', '-'); // tag, not the shown text: CSS keys on 'wildcard'

  volume = clampVolume(volume, settings.boostEnabled, settings.boostMax);
  knob.setMax(maxVolume(settings.boostEnabled, settings.boostMax));
  knob.setValue(volume);
  knob.setDisabled(!reachable || excluded());
  $<HTMLInputElement>('boost').checked = settings.boostEnabled;
  $<HTMLInputElement>('boost').setAttribute('aria-label', tr('boostAria', settings.boostMax));
  $('controls').classList.toggle('is-off', !reachable || excluded());
  for (const el of $('controls').querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-preset], #boost')) el.disabled = !reachable || excluded();
  paintSave();
  paintSound();
  paintMenu();
}

function showBlocked() {
  $('controls').hidden = true;
  $('blocked').hidden = false;
  const reloadable = origin !== null && tabId !== undefined;
  $('blockedText').textContent = reloadable
    ? tr('blockedReload')
    : tr('blockedBrowser');
  $('reloadBtn').hidden = !reloadable;
}

// ---------- actions ----------

$('saveBtn').addEventListener('click', async () => {
  const key = domainKey();
  if (!key) return;
  try {
    if (saved()) await storage.removeSite(covering()!);
    else await storage.saveSite(key, volume);
    $('hint').hidden = true; // saving is what the hint asked for
    notice('');
  } catch (e) {
    notice(tr('saveFailed', storage.friendly(e)), true);
  }
});

const muteBtn = $('muteBtn');
const paintMute = (muted: boolean) => {
  muteBtn.textContent = tr(muted ? 'unmuteTab' : 'muteTab');
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
  notice(others.length ? tr(others.length > 1 ? 'mutedOthersMany' : 'mutedOthersOne', others.length) : tr('noOthers'));
});

// muted tabs: listed with an unmute button each, hidden when none
const mutedList = $('mutedList');
async function paintMuted() {
  const tabs = (await chrome.tabs.query({ muted: true })).filter((t) => t.id !== undefined);
  mutedList.hidden = !tabs.length;
  mutedList.replaceChildren(
    ...tabs.map((t) => {
      const name = document.createElement('span');
      name.textContent = t.title || t.url || tr('tabFallback');
      name.title = name.textContent;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = tr('unmute');
      btn.addEventListener('click', () => void chrome.tabs.update(t.id!, { muted: false }));
      const li = document.createElement('li');
      li.append(name, btn);
      return li;
    }),
  );
}
// other tabs playing: a live level slider and a mute button each, hidden when none
const others = $<HTMLDetailsElement>('others');
async function paintOthers() {
  const tabs = (await chrome.tabs.query({ audible: true })).filter((t) => t.id !== undefined && t.id !== tabId);
  const levels = await Promise.all(tabs.map((t) => chrome.tabs.sendMessage<GetState, StateReply>(t.id!, { type: 'get-state' }, { frameId: 0 }).catch(() => null)));
  others.hidden = !tabs.length;
  $('othersCount').textContent = String(tabs.length);
  $('othersList').replaceChildren(
    ...tabs.map((t, i) => {
      const icon = Object.assign(document.createElement('img'), { alt: '', src: t.favIconUrl ?? '' });
      icon.hidden = !t.favIconUrl;
      icon.addEventListener('error', () => (icon.hidden = true));
      const name = Object.assign(document.createElement('span'), { textContent: t.title || t.url || tr('tabFallback') });
      name.title = name.textContent!;
      const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: String(maxVolume(settings.boostEnabled, settings.boostMax)), step: '5', value: String(levels[i]?.volume ?? 100) });
      range.setAttribute('aria-label', tr('levelOf', name.textContent!));
      range.addEventListener('input', () => void chrome.tabs.sendMessage(t.id!, { type: 'set-volume', volume: range.valueAsNumber } satisfies SetVolume).catch(() => {}));
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: tr(t.mutedInfo?.muted ? 'unmute' : 'mute') });
      btn.addEventListener('click', () => void chrome.tabs.update(t.id!, { muted: !t.mutedInfo?.muted }));
      const li = document.createElement('li');
      li.append(icon, name, range, btn);
      return li;
    }),
  );
}
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.audible !== undefined || info.mutedInfo) void paintOthers();
  if (!info.mutedInfo) return;
  void paintMuted();
  if (id === tabId) paintMute(info.mutedInfo.muted);
});
chrome.tabs.onRemoved.addListener(() => (void paintMuted(), void paintOthers()));
void paintMuted();

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('menuReset').addEventListener('click', async () => {
  if (tabId === undefined) return;
  await chrome.runtime.sendMessage({ type: 'reset-tab', tabId } satisfies ResetTab).catch(() => {});
  await chrome.tabs.reload(tabId);
  window.close();
});
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
  await storage.setExcluded(list).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
});
$('menuDefault').addEventListener('click', async () => {
  toggleMenu(false);
  await storage.setDefaultVolume(volume).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
  notice(tr('defaultNow', volume));
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
    const r = resolveVolume({ ...settings, sites }, origin, storage.quietLevel(quiet));
    if (r) setVolume(r.volume);
  } catch (e) {
    notice(tr('saveFailed', storage.friendly(e)), true);
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
  [quiet, warnAbove] = await Promise.all([storage.loadQuiet(), storage.loadWarnAbove()]);
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
      showState(state);
    }
  }
  paint();
  void paintOthers();
  // The level ring needs tab capture, which cuts the tab's audio for a moment when it starts: opt-in (settings), off by default.
  const viz = new URLSearchParams(location.search).has('vizTest') || (await chrome.storage.local.get('visualizer')).visualizer === true;
  if (reachable) {
    if (viz) connectAudio(tabId!, (levels) => (levels.length ? knob.setLevels(levels) : knob.setIdle()));
  } else showBlocked();
  void firstRun();
  storage.onLocalChanged(() => void Promise.all([storage.loadQuiet(), storage.loadWarnAbove()]).then(([q, w]) => ([quiet, warnAbove] = [q, w], paint())));
  storage.onSettingsChanged((s) => {
    settings = s;
    paint();
  });
})();
