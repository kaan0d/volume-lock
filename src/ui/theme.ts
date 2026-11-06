import { DEFAULT_DESIGN, isDesign, type Design } from './designs';

export type Theme = 'system' | 'light' | 'dark';

const dark = matchMedia('(prefers-color-scheme: dark)');
let current: Theme = 'system';
let design: Design = DEFAULT_DESIGN;

function apply(): void {
  const root = document.documentElement;
  root.dataset.theme = current === 'system' ? (dark.matches ? 'dark' : 'light') : current;
  if (root.dataset.design !== design) {
    root.dataset.design = design;
    window.dispatchEvent(new Event('designchange')); // the knob re-reads its CSS-driven layout
  }
}

dark.addEventListener('change', apply);
// The choice can change in another page (options while the popup is open).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) current = (changes.theme.newValue as Theme | undefined) ?? 'system';
  if (changes.design) design = isDesign(changes.design.newValue) ? changes.design.newValue : DEFAULT_DESIGN;
  apply();
});

export async function getTheme(): Promise<Theme> {
  const { theme } = await chrome.storage.local.get('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export async function getDesign(): Promise<Design> {
  const { design } = await chrome.storage.local.get('design');
  return isDesign(design) ? design : DEFAULT_DESIGN;
}

/** Call first thing in the page script so data-theme is set before first paint. */
export async function initTheme(): Promise<void> {
  apply(); // OS value right away, then the stored choice
  [current, design] = await Promise.all([getTheme(), getDesign()]);
  apply();
}

export async function setTheme(t: Theme): Promise<void> {
  current = t;
  apply();
  await chrome.storage.local.set({ theme: t });
}

export async function setDesign(d: Design): Promise<void> {
  design = d;
  apply();
  await chrome.storage.local.set({ design: d });
}
