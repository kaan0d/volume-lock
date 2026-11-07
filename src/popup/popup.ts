import { displayOrigin, originOf } from '../lib/origin';
import { clampVolume, coveringKey, covers, EQ_PRESETS, emptyQuiet, emptySettings, inList, isExcluded, maxVolume, presetOf, resolveVolume, type Settings } from '../lib/rules';
import type { GetState, ResetTab, SetVolume, StateReply } from '../lib/messages';
import * as storage from '../lib/storage';
import '../ui/tokens.css';
import '../ui/base.css';
import './popup.css';
import { initTheme, isPreview } from '../ui/theme';
import { createKnob } from '../ui/knob';
import '../ui/designs.css';
import { startCapture } from './capture';
import { UNMUTE_ALARM } from '../lib/messages';
import { applyI18n, initLang, presetName, t as tr } from '../lib/i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings = emptySettings();
let tabId: number | undefined;
let origin: string | null = null;
let reachable = false;
let volume = 100;
let warnAbove = 150;
let quiet = emptyQuiet();

void initTheme();
await initLang(); // a language picked in settings
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
async function recheckIdle(wait = 250) {
  if (!reachable || tabId === undefined) return;
  await new Promise((r) => setTimeout(r, wait));
  const state = await chrome.tabs.sendMessage<GetState, StateReply>(tabId, { type: 'get-state' }, { frameId: 0 }).catch(() => null);
  if (state) showState(state);
}

let lastState: StateReply | null = null;
// media can start after the popup opened, so the boost status follows the page while boost is on
setInterval(() => settings.boostEnabled && void recheckIdle(0), 2000);

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
  const on = settings.boostEnabled && reachable && !excluded();
  const gain = volume / 100;
  const text = !on ? '' : lastState?.idle ? tr('boostWaiting') : lastState && !lastState.media ? tr('boostNoMedia') : volume > 100 ? tr('boostActive', `+${(20 * Math.log10(gain)).toFixed(1)}`) : '';
  el.textContent = text ? `${tr('boost')} · ${text}` : tr('boost'); // the label doubles as the status, so it costs no height
  el.title = text ? tr('boostStatusTitle', [text]) : '';
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
  const sm = origin !== null && settings.muteSites.includes(origin);
  $('menuStartMuted').textContent = tr(sm ? 'stopStartMuted' : 'startMuted');
  ($('menuStartMuted') as HTMLButtonElement).disabled = !origin;
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
const otherTabs = async (info: chrome.tabs.QueryInfo) => (await chrome.tabs.query(info)).filter((t) => t.id !== undefined && t.id !== tabId);
/** One button both ways: "Unmute other tabs" once every playing tab is muted and some tab is muted, else "Mute other tabs". */
async function othersMode(): Promise<'mute' | 'unmute'> {
  const [playing, muted] = await Promise.all([otherTabs({ audible: true }), mutedToOpen()]);
  return muted.length > 0 && playing.every((t) => t.mutedInfo?.muted) ? 'unmute' : 'mute';
}
/** Tabs the Unmute button opens: every muted tab, or (setting) only those this button muted, remembered in session storage. */
async function mutedToOpen() {
  const muted = await otherTabs({ muted: true });
  if ((await storage.loadUnmuteScope()) === 'all') return muted;
  const ours = ((await chrome.storage.session.get('mutedByUs')).mutedByUs as number[] | undefined) ?? [];
  return muted.filter((t) => ours.includes(t.id!));
}
async function paintMuteOthers() {
  $('muteOthersBtn').textContent = tr((await othersMode()) === 'unmute' ? 'unmuteOthers' : 'muteOthers');
}
$('muteOthersBtn').addEventListener('click', async () => {
  const unmute = (await othersMode()) === 'unmute';
  const others = unmute ? await mutedToOpen() : await otherTabs({ audible: true });
  await Promise.all(others.map((t) => chrome.tabs.update(t.id!, { muted: !unmute })));
  const ours = ((await chrome.storage.session.get('mutedByUs')).mutedByUs as number[] | undefined) ?? [];
  const ids = others.map((t) => t.id!);
  await chrome.storage.session.set({ mutedByUs: unmute ? ours.filter((i) => !ids.includes(i)) : [...new Set([...ours, ...ids])] });
  const msg = $('othersNotice');
  const key = unmute ? ['unmutedOthersMany', 'unmutedOthersOne'] : ['mutedOthersMany', 'mutedOthersOne'];
  msg.textContent = others.length ? tr(key[others.length > 1 ? 0 : 1], others.length) : tr('noOthers');
  msg.hidden = false;
  void paintMuteOthers();
});

// the other-tabs page replaces the popup content; its own result text goes away with it
function showOthers(open: boolean) {
  $('othersView').hidden = !open;
  document.querySelector<HTMLElement>('.app')!.dataset.view = open ? 'others' : '';
  $('othersNotice').hidden = true;
  void paintOthers();
  void paintMuted();
  (open ? $('othersBack') : $('othersBtn')).focus();
}
$('othersBtn').addEventListener('click', () => showOthers(true));
$('othersBack').addEventListener('click', () => showOthers(false));

// muted tabs: listed with an unmute button each, hidden when none
const mutedList = $('mutedList');
async function paintMuted() {
  const tabs = (await chrome.tabs.query({ muted: true })).filter((t) => t.id !== undefined);
  $('mutedBox').hidden = !tabs.length;
  void paintMuteOthers();
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
  $('othersEmpty').hidden = tabs.length > 0;
  void paintMuteOthers();
  $('othersCount').textContent = String(tabs.length);
  $('othersBtn').textContent = tabs.length ? `${tr('otherTabs')} (${tabs.length})` : tr('otherTabs');
  $('othersList').replaceChildren(
    ...tabs.map((t, i) => {
      const icon = Object.assign(document.createElement('img'), { alt: '', src: t.favIconUrl ?? '' });
      icon.hidden = !t.favIconUrl;
      icon.addEventListener('error', () => (icon.hidden = true));
      const name = Object.assign(document.createElement('span'), { textContent: t.title || t.url || tr('tabFallback') });
      name.title = name.textContent!;
      name.tabIndex = 0;
      name.setAttribute('role', 'link');
      const go = () => void chrome.tabs.update(t.id!, { active: true }).then(() => chrome.windows.update(t.windowId, { focused: true }));
      name.addEventListener('click', go);
      name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
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
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!menu.hidden) (toggleMenu(false), $('menuBtn').focus());
  else if (!$('othersView').hidden) showOthers(false);
});

$('menuExclude').addEventListener('click', async () => {
  toggleMenu(false);
  if (!origin) return;
  const list = settings.excluded.includes(origin) ? settings.excluded.filter((x) => x !== origin) : [...settings.excluded, origin];
  await storage.setExcluded(list).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
});
$('menuStartMuted').addEventListener('click', async () => {
  toggleMenu(false);
  if (!origin) return;
  const list = settings.muteSites.includes(origin) ? settings.muteSites.filter((x) => x !== origin) : [...settings.muteSites, origin];
  await storage.setMuteSites(list).catch((e: Error) => notice(tr('saveFailed', storage.friendly(e)), true));
});
for (const [id, min] of [['menuMute15', 15], ['menuMute60', 60]] as const) {
  $(id).addEventListener('click', async () => {
    toggleMenu(false);
    if (tabId === undefined) return;
    await chrome.alarms.create(UNMUTE_ALARM + tabId, { delayInMinutes: min });
    await chrome.tabs.update(tabId, { muted: true });
    notice(tr('mutedFor', min));
  });
}
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
  if (isPreview) {
    // a picture of the popup for the settings page: a sample saved site, nothing is read or sent
    const q = new URLSearchParams(location.search);
    volume = Number(q.get('level')) || 65; // ?level=150&boost&unsaved shows a boosted, unsaved sample (store images)
    settings = { ...emptySettings(), boostEnabled: q.has('boost'), sites: q.has('unsaved') ? {} : { 'https://example.com': volume } };
    origin = 'https://example.com';
    reachable = true;
    return paint();
  }
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
  // Media that only tab capture can boost: capture it once the level is above 100 (the warning in the popup says so).
  if (reachable) {
    if ((lastState as StateReply | null)?.needsCapture && volume > 100) void startCapture(tabId!);
  } else showBlocked();
  void firstRun();
  storage.onLocalChanged(() => void Promise.all([storage.loadQuiet(), storage.loadWarnAbove()]).then(([q, w]) => ([quiet, warnAbove] = [q, w], paint())));
  storage.onSettingsChanged((s) => {
    settings = s;
    paint();
  });
})();
