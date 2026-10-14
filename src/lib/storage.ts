// The only file that touches chrome.*; one sync key per site keeps every item far below the 8 KB cap.
import { clampVolume, emptySettings, type Settings } from './rules';

const SITE = 'site:';
const sync = () => chrome.storage.sync;

export async function loadSettings(): Promise<Settings> {
  const all = await sync().get(null);
  const s = emptySettings();
  if (typeof all.defaultVolume === 'number') s.defaultVolume = all.defaultVolume;
  s.boostEnabled = all.boostEnabled === true;
  if (Array.isArray(all.excluded)) s.excluded = all.excluded.filter((x) => typeof x === 'string');
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SITE) && typeof v === 'number') s.sites[k.slice(SITE.length)] = v;
  }
  return s;
}

export const saveSite = (pattern: string, volume: number) => sync().set({ [SITE + pattern]: volume });
export const removeSite = (pattern: string) => sync().remove(SITE + pattern);

export async function clearSites(): Promise<void> {
  const all = await sync().get(null);
  await sync().remove(Object.keys(all).filter((k) => k.startsWith(SITE)));
}

export const setDefaultVolume = (v: number | null) =>
  v === null ? sync().remove('defaultVolume') : sync().set({ defaultVolume: v });
export const setBoostEnabled = (b: boolean) => sync().set({ boostEnabled: b });
export const setExcluded = (list: string[]) => sync().set({ excluded: list });

/** Replaces every setting with `s` (import). On a quota error the old settings are put back. */
export async function replaceSettings(s: Settings): Promise<void> {
  const before = await sync().get(null);
  const sites = Object.fromEntries(Object.entries(s.sites).map(([p, v]) => [SITE + p, v]));
  const rest: Record<string, number> = s.defaultVolume === null ? {} : { defaultVolume: s.defaultVolume };
  await sync().clear();
  try {
    await sync().set({ ...sites, ...rest, boostEnabled: s.boostEnabled, excluded: s.excluded });
  } catch (e) {
    await sync().set(before); // they fit before, so they fit again
    throw e;
  }
}

/** Calls cb with fresh settings whenever any sync setting changes. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (_: unknown, area: string) => area === 'sync' && void loadSettings().then(cb);
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Old format: one `siteList` object {origin: percent}. Split into site: keys and drop it. */
export async function migrateLegacy(): Promise<void> {
  const { siteList } = await sync().get('siteList');
  if (!siteList || typeof siteList !== 'object') return;
  const items: Record<string, number> = {};
  for (const [origin, v] of Object.entries(siteList)) {
    if (typeof v === 'number' && Number.isFinite(v)) items[SITE + origin] = clampVolume(v, true);
  }
  await sync().set(items);
  await sync().remove('siteList');
}
