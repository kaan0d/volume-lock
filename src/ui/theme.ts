// Placeholder; the theme agent's version replaces this.
export type Theme = 'system' | 'light' | 'dark';

const apply = (t: Theme) => {
  const dark = t === 'system' ? !matchMedia('(prefers-color-scheme: light)').matches : t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};

export async function getTheme(): Promise<Theme> {
  const { theme } = await chrome.storage.local.get('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export async function setTheme(t: Theme): Promise<void> {
  await chrome.storage.local.set({ theme: t });
  apply(t);
}

export async function initTheme(): Promise<void> {
  apply(await getTheme());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => (await getTheme()) === 'system' && apply('system'));
}
