import { clampVolume, emptySettings, EQ_BANDS, EQ_LIMIT, EQ_PRESETS, isValidPattern, isWildcard, maxVolume, presetOf, type Settings } from '../lib/rules';
import * as storage from '../lib/storage';
import { exportSettings, parseImport } from '../lib/transfer';
import { getTheme, initTheme, setTheme } from '../ui/theme';

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

let settings: Settings = emptySettings();
const max = () => maxVolume(settings.boostEnabled, settings.boostMax);
const BAD_PATTERN = 'Enter an origin like https://example.com or a wildcard like *.example.com.';

// ---------- nav ----------

const SECTIONS = ['sites', 'general'];
function route() {
  const s = SECTIONS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'sites';
  for (const id of SECTIONS) {
    $(id).classList.toggle('active', id === s);
    const a = document.querySelector(`nav a[data-s="${id}"]`)!;
    if (id === s) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
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
  const b = el('button', { type: 'button', className: 'del', title: 'Remove', textContent: '×' });
  b.setAttribute('aria-label', `Remove ${pattern}`);
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
        el('td', { className: 'site', textContent: p }),
        el('td', { className: 'type', textContent: isWildcard(p) ? 'Wildcard' : 'Exact' }),
        el('td', {}, levelInput(`Level for ${p}`, v, (n) => storage.saveSite(p, n))),
        el('td', {}, removeBtn(p, () => storage.removeSite(p))),
      ),
    ),
  );
  $('emptyState').textContent = all.length
    ? 'No matching sites.'
    : 'No sites saved yet. Open a page, set a level in the popup and press Save, or add a site below.';
  $('emptyState').classList.toggle('hidden', shown.length > 0);
}
input('search').addEventListener('input', renderSites);

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = input('addPattern').value.trim().toLowerCase();
  const level = input('addLevel').valueAsNumber;
  if (!isValidPattern(pattern)) return show('addError', BAD_PATTERN);
  if (!Number.isInteger(level) || level < 0 || level > max()) return show('addError', `Level must be a whole number from 0 to ${max()}.`);
  show('addError', '');
  try {
    await storage.saveSite(pattern, level);
    input('addPattern').value = '';
  } catch (err) {
    show('addError', `Save failed: ${(err as Error).message}`);
  }
});

// ---------- rules ----------

function renderRules() {
  const wild = Object.entries(settings.sites).filter(([p]) => isWildcard(p)).sort(([a], [b]) => a.localeCompare(b));
  $('wildCount').textContent = String(wild.length);
  $('wildList').replaceChildren(
    ...wild.map(([p, v]) => el('li', {}, el('span', { textContent: `${p}  ·  ${v}%` }), removeBtn(p, () => storage.removeSite(p)))),
  );
  $('autoplayCount').textContent = String(settings.autoplayBlock.length);
  $('autoplayList').replaceChildren(
    ...settings.autoplayBlock.map((p) => el('li', {}, el('span', { textContent: p }), removeBtn(p, () => storage.setAutoplayBlock(settings.autoplayBlock.filter((x) => x !== p))))),
  );
  $('excludeCount').textContent = String(settings.excluded.length);
  $('excludeList').replaceChildren(
    ...settings.excluded.map((p) => el('li', {}, el('span', { textContent: p }), removeBtn(p, () => storage.setExcluded(settings.excluded.filter((x) => x !== p))))),
  );
}

$('excludeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = input('excludePattern').value.trim().toLowerCase();
  if (!isValidPattern(pattern)) return show('excludeError', BAD_PATTERN);
  show('excludeError', '');
  if (!settings.excluded.includes(pattern)) await storage.setExcluded([...settings.excluded, pattern]);
  input('excludePattern').value = '';
});

$('autoplayForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = input('autoplayPattern').value.trim().toLowerCase();
  if (!isValidPattern(pattern)) return show('autoplayError', BAD_PATTERN);
  show('autoplayError', '');
  if (!settings.autoplayBlock.includes(pattern)) await storage.setAutoplayBlock([...settings.autoplayBlock, pattern]);
  input('autoplayPattern').value = '';
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
  show('boostNote', !settings.boostEnabled && over ? `${over} stored level${over > 1 ? 's are' : ' is'} above 100% and play at 100% while boost is off. They are kept as they are.` : '');
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
eqSelect.replaceChildren(...[...Object.keys(EQ_PRESETS), 'Custom'].map((n) => el('option', { value: n, textContent: n })));
const bandLabel = (f: number) => (f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz');
const dB = (v: number) => (v > 0 ? '+' : '') + v + ' dB';
const eqRows = EQ_BANDS.map((f) => {
  const slider = el('input', { type: 'range', min: String(-EQ_LIMIT), max: String(EQ_LIMIT), step: '1', value: '0' }) as HTMLInputElement;
  slider.setAttribute('aria-label', 'EQ ' + bandLabel(f));
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
const balanceText = (v: number) => (v === 0 ? 'Centre' : v < 0 ? 'L ' + -v : 'R ' + v);
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
  if (s) await storage.replaceSettings(s).catch((e: Error) => show('backupError', `Import failed: ${e.message}`));
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

// ---------- appearance ----------

$<HTMLSelectElement>('themeSel').addEventListener('change', (e) => void setTheme((e.target as HTMLSelectElement).value as 'system' | 'light' | 'dark'));

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
  settings = await storage.loadSettings();
  render();
  storage.onSettingsChanged((s) => {
    settings = s;
    render();
  });
})();
