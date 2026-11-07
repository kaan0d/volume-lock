import { cleanQuiet, cleanWarnAbove, clampVolume, emptySettings, EQ_BANDS, EQ_LIMIT, EQ_PRESETS, isValidPattern, isWildcard, maxVolume, presetOf, type Settings } from '../lib/rules';
import { displayOrigin } from '../lib/origin';
import * as storage from '../lib/storage';
import { exportSettings, parseImport } from '../lib/transfer';
import { getDesign, getTheme, initTheme, setDesign, setTheme } from '../ui/theme';
import { DESIGNS } from '../ui/designs';
import { applyI18n, presetName, t } from '../lib/i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
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

applyI18n();
document.querySelectorAll<HTMLElement>('.list').forEach((l) => (l.dataset.empty = t('noneYet')));

let settings: Settings = emptySettings();
const max = () => maxVolume(settings.boostEnabled, settings.boostMax);
const BAD_PATTERN = t('badPattern');
/** Typed pattern; a bare domain like example.com gets https:// so people need not type the scheme. */
const patternOf = (id: string) => {
  const v = input(id).value.trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(v) ? `https://${v}` : v;
};

// ---------- nav ----------

const SECTIONS = ['sites', 'general', 'appearance'];
function route() {
  const s = SECTIONS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'sites';
  for (const id of SECTIONS) {
    $(id).classList.toggle('active', id === s);
    const a = document.querySelector(`nav a[data-s="${id}"]`)!;
    if (id === s) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (s === 'appearance') queueMicrotask(paintPreviews); // twelve popups load only when this page is open (microtask: the grid is built later in this module)
}
addEventListener('hashchange', route);
route();

// ---------- sites ----------

let sortKey: 'site' | 'level' = 'site';
let sortDir = 1;
document.querySelectorAll<HTMLButtonElement>('.sort').forEach((b) =>
  b.addEventListener('click', () => {
    const key = b.dataset.key as 'site' | 'level';
    sortDir = key === sortKey ? -sortDir : 1;
    sortKey = key;
    renderSites();
  }),
);

function levelInput(label: string, value: number, onCommit: (v: number) => void) {
  const f = el('input', { type: 'number', className: 'field num', min: '0', max: String(max()), value: String(value) }) as HTMLInputElement;
  f.setAttribute('aria-label', label);
  f.addEventListener('change', () => {
    if (f.value.trim() === '' || Number.isNaN(f.valueAsNumber)) return void (f.value = String(value));
    onCommit(clampVolume(f.valueAsNumber, settings.boostEnabled, settings.boostMax));
  });
  return el('span', { className: 'lvl' }, f, document.createTextNode('%'));
}

function removeBtn(pattern: string, onDelete: () => void) {
  const b = el('button', { type: 'button', className: 'del', title: t('remove'), textContent: '×' });
  b.setAttribute('aria-label', t('removeAria', pattern));
  b.addEventListener('click', onDelete);
  return b;
}

function renderSites() {
  const q = input('search').value.trim().toLowerCase();
  const all = Object.entries(settings.sites);
  const shown = all
    .filter(([p]) => p.toLowerCase().includes(q))
    .sort(([a, x], [b, y]) => sortDir * (sortKey === 'level' ? x - y || a.localeCompare(b) : a.localeCompare(b)));
  document.querySelectorAll<HTMLElement>('th[aria-sort]').forEach((th) => {
    const key = th.querySelector<HTMLElement>('.sort')?.dataset.key;
    th.setAttribute('aria-sort', key === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
  });
  $('siteCount').textContent = String(all.length);
  $('siteRows').replaceChildren(
    ...shown.map(([p, v]) =>
      el(
        'tr', {},
        el('td', { className: 'site', textContent: displayOrigin(p), title: p }),
        el('td', { className: 'type', textContent: t(isWildcard(p) ? 'typeWildcard' : 'typeExact') }),
        el('td', {}, levelInput(t('levelFor', p), v, (n) => storage.saveSite(p, n))),
        el('td', {}, removeBtn(p, () => storage.removeSite(p))),
      ),
    ),
  );
  $('emptyState').textContent = t(all.length ? 'noMatch' : 'noSites');
  $('emptyState').classList.toggle('hidden', shown.length > 0);
}
input('search').addEventListener('input', renderSites);

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = patternOf('addPattern');
  const level = input('addLevel').valueAsNumber;
  if (!isValidPattern(pattern)) return show('addError', BAD_PATTERN);
  if (!Number.isInteger(level) || level < 0 || level > max()) return show('addError', t('levelRange', max()));
  show('addError', '');
  try {
    await storage.saveSite(pattern, level);
    input('addPattern').value = '';
  } catch (err) {
    show('addError', t('saveFailed', storage.friendly(err)));
  }
});

// ---------- rules ----------

function renderRules() {
  const wild = Object.entries(settings.sites).filter(([p]) => isWildcard(p)).sort(([a], [b]) => a.localeCompare(b));
  $('wildCount').textContent = String(wild.length);
  $('wildList').replaceChildren(
    ...wild.map(([p, v]) => el('li', {}, el('span', { textContent: `${p}  ·  ${v}%` }), removeBtn(p, () => storage.removeSite(p)))),
  );
  $('excludeCount').textContent = String(settings.excluded.length);
  $('excludeList').replaceChildren(
    ...settings.excluded.map((p) => el('li', {}, el('span', { textContent: p }), removeBtn(p, () => storage.setExcluded(settings.excluded.filter((x) => x !== p))))),
  );
}

$('excludeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = patternOf('excludePattern');
  if (!isValidPattern(pattern)) return show('excludeError', BAD_PATTERN);
  show('excludeError', '');
  if (!settings.excluded.includes(pattern)) await storage.setExcluded([...settings.excluded, pattern]);
  input('excludePattern').value = '';
});

// ---------- audio ----------

function renderAudio() {
  input('addLevel').max = input('defaultLevel').max = String(max());
  input('boostOn').checked = settings.boostEnabled;
  $<HTMLSelectElement>('boostMax').value = String(settings.boostMax);
  $<HTMLSelectElement>('boostMax').disabled = !settings.boostEnabled;
  input('defaultOn').checked = settings.defaultVolume !== null;
  input('defaultLevel').disabled = settings.defaultVolume === null;
  if (document.activeElement !== input('defaultLevel') && settings.defaultVolume !== null) input('defaultLevel').value = String(settings.defaultVolume);
  const over = Object.values(settings.sites).filter((v) => v > 100).length + ((settings.defaultVolume ?? 0) > 100 ? 1 : 0);
  show('boostNote', !settings.boostEnabled && over ? t(over > 1 ? 'boostNoteMany' : 'boostNoteOne', over) : '');
}

const saveDefault = () => {
  const n = input('defaultLevel').valueAsNumber;
  return storage.setDefaultVolume(input('defaultOn').checked ? clampVolume(Number.isNaN(n) ? 100 : n, settings.boostEnabled, settings.boostMax) : null);
};
input('defaultOn').addEventListener('change', saveDefault);
input('defaultLevel').addEventListener('change', saveDefault);
input('boostOn').addEventListener('change', () => storage.setBoostEnabled(input('boostOn').checked));
$<HTMLSelectElement>('boostMax').addEventListener('change', (e) => storage.setBoostMax(Number((e.target as HTMLSelectElement).value)));

// ---------- sound ----------

const eqSelect = $<HTMLSelectElement>('eqPreset');
eqSelect.replaceChildren(...[...Object.keys(EQ_PRESETS), 'Custom'].map((n) => el('option', { value: n, textContent: presetName(n) })));
const bandLabel = (f: number) => (f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz');
const dB = (v: number) => (v > 0 ? '+' : '') + v + ' dB';
const eqRows = EQ_BANDS.map((f) => {
  const slider = el('input', { type: 'range', min: String(-EQ_LIMIT), max: String(EQ_LIMIT), step: '1', value: '0' }) as HTMLInputElement;
  slider.setAttribute('aria-label', t('eqBandAria', bandLabel(f)));
  const out = el('output', {});
  slider.addEventListener('input', () => (out.textContent = dB(slider.valueAsNumber)));
  slider.addEventListener('change', () => storage.setFx({ ...settings.fx, eq: eqRows.map((r) => r.slider.valueAsNumber) }));
  $('eqBands').append(el('div', { className: 'fxrow' }, el('span', { textContent: bandLabel(f) }), slider, out));
  return { slider, out };
});
eqSelect.addEventListener('change', () => {
  const eq = EQ_PRESETS[eqSelect.value];
  if (eq) void storage.setFx({ ...settings.fx, eq });
});
input('fxLeveler').addEventListener('change', () => storage.setFx({ ...settings.fx, leveler: input('fxLeveler').checked }));
input('fxMono').addEventListener('change', () => storage.setFx({ ...settings.fx, mono: input('fxMono').checked }));
const balanceText = (v: number) => (v === 0 ? t('balanceCentre') : v < 0 ? t('balanceLeft', -v) : t('balanceRight', v));
input('fxBalance').addEventListener('input', () => ($('fxBalanceOut').textContent = balanceText(input('fxBalance').valueAsNumber)));
input('fxBalance').addEventListener('change', () => storage.setFx({ ...settings.fx, balance: input('fxBalance').valueAsNumber }));

function renderSound() {
  const f = settings.fx;
  input('fxLeveler').checked = f.leveler;
  input('fxMono').checked = f.mono;
  if (document.activeElement !== input('fxBalance')) input('fxBalance').value = String(f.balance);
  $('fxBalanceOut').textContent = balanceText(f.balance);
  eqRows.forEach((r, i) => {
    if (document.activeElement !== r.slider) r.slider.value = String(f.eq[i]);
    r.out.textContent = dB(f.eq[i]);
  });
  eqSelect.value = presetOf(f.eq) ?? 'Custom';
}

// ---------- backup ----------

/** Swaps a trigger for an inline confirm row; `onYes` runs on confirm. */
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
  el('a', { href: url, download: 'volume-lock-settings.json' }).click();
  URL.revokeObjectURL(url);
});

let imported: Settings | null = null;
const showImport = inlineConfirm('importBtn', 'importConfirm', 'importYes', 'importNo', async () => {
  const s = imported;
  imported = null;
  if (s) await storage.replaceSettings(s).catch((e: Error) => show('backupError', t('importFailed', storage.friendly(e))));
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
    show('backupError', t('importFailed', storage.friendly(e)));
  }
});

// ---------- warn and quiet hours (device-local) ----------

const quietIds = ['quietOn', 'quietFrom', 'quietTo', 'quietLevel'];
const saveQuiet = () =>
  void storage.setQuiet(cleanQuiet({ on: input('quietOn').checked, from: input('quietFrom').value, to: input('quietTo').value, level: input('quietLevel').valueAsNumber }));
for (const id of quietIds) input(id).addEventListener('change', saveQuiet);
input('warnAbove').addEventListener('change', () => void storage.setWarnAbove(cleanWarnAbove(input('warnAbove').valueAsNumber)).then(paintLocal));
async function paintLocal() {
  const q = await storage.loadQuiet();
  input('quietOn').checked = q.on;
  input('quietFrom').value = q.from;
  input('quietTo').value = q.to;
  input('quietLevel').value = String(q.level);
  input('warnAbove').value = String(await storage.loadWarnAbove());
}

// ---------- appearance ----------

$<HTMLSelectElement>('themeSel').addEventListener('change', (e) => void setTheme((e.target as HTMLSelectElement).value as 'system' | 'light' | 'dark').then(paintPreviews));

const vizToggle = $<HTMLInputElement>('vizToggle');
vizToggle.addEventListener('change', () => void chrome.storage.local.set({ visualizer: vizToggle.checked }));

const designGrid = $('designGrid');
for (const d of DESIGNS) {
  const b = document.createElement('div');
  b.className = 'design';
  b.dataset.design = d.id;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', d.name);
  // the real popup in this design, scaled down (a preview page that sends nothing and reads no tab)
  b.innerHTML = `<span class="shot"><iframe tabindex="-1" aria-hidden="true" loading="lazy" title=""></iframe></span><span class="nm">${d.name}</span>`;
  b.addEventListener('click', () => void setDesign(d.id).then(paintDesigns));
  b.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (e.key === ' ' || e.key === 'Enter') (e.preventDefault(), b.click());
    else if (step) {
      e.preventDefault();
      const all = [...designGrid.children] as HTMLElement[];
      const next = all[(all.indexOf(b) + step + all.length) % all.length];
      next.click();
      next.focus();
    }
  });
  designGrid.append(b);
}
/** Previews follow the theme (Aurora Glass does); the others keep their own colors. */
function paintPreviews() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  for (const b of designGrid.children as Iterable<HTMLElement>) {
    const f = b.querySelector('iframe')!;
    const src = `../popup/popup.html?preview=${b.dataset.design}&theme=${theme}`;
    if (f.getAttribute('src') !== src) f.setAttribute('src', src);
  }
}
async function paintDesigns() {
  const now = await getDesign();
  for (const b of designGrid.children as Iterable<HTMLButtonElement>) {
    const on = b.dataset.design === now;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1; // roving tabindex: one tab stop for the group
  }
}

// ---------- boot ----------

function render() {
  $('deleteAllBtn').toggleAttribute('disabled', Object.keys(settings.sites).length === 0);
  renderSites();
  renderRules();
  renderAudio();
  renderSound();
}

void (async () => {
  await initTheme();
  $<HTMLSelectElement>('themeSel').value = await getTheme();
  await paintDesigns();
  vizToggle.checked = (await chrome.storage.local.get('visualizer')).visualizer === true;
  settings = await storage.loadSettings();
  await paintLocal();
  render();
  storage.onSettingsChanged((s) => {
    settings = s;
    render();
  });
})();
