export type Theme = 'system' | 'light' | 'dark';

const dark = matchMedia('(prefers-color-scheme: dark)');
let current: Theme = 'system';

function apply(): void {
  document.documentElement.dataset.theme = current === 'system' ? (dark.matches ? 'dark' : 'light') : current;
}

dark.addEventListener('change', apply);
// The choice can change in another page (options while the popup is open).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    current = (changes.theme.newValue as Theme | undefined) ?? 'system';
    apply();
  }
});

export async function getTheme(): Promise<Theme> {
  const { theme } = await chrome.storage.local.get('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

/** Call first thing in the page script so data-theme is set before first paint. */
export async function initTheme(): Promise<void> {
  apply(); // OS value right away, then the stored choice
  current = await getTheme();
  apply();
}

export async function setTheme(t: Theme): Promise<void> {
  current = t;
  apply();
  await chrome.storage.local.set({ theme: t });
}
