export type Theme = 'system' | 'light' | 'dark';
const apply = (t: Theme) => (document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t);
export async function getTheme(): Promise<Theme> {
  const { theme } = await chrome.storage.local.get('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}
export const setTheme = async (t: Theme) => { await chrome.storage.local.set({ theme: t }); apply(t); };
export async function initTheme(): Promise<void> { apply(await getTheme()); }
