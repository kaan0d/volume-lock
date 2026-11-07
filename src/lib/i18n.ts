import en from '../../public/_locales/en/messages.json' with { type: 'json' };
import tr from '../../public/_locales/tr/messages.json' with { type: 'json' };

type Msg = { message: string; placeholders?: Record<string, { content: string }> };
const EN: Record<string, Msg> = en;
const CATALOGS: Record<string, Record<string, Msg>> = { en: EN, tr };

/** Languages the user can pick (each named in itself); 'auto' follows the browser. */
export const LANGS: [code: string, name: string][] = [['en', 'English'], ['tr', 'Türkçe']];
let lang = 'auto';

/** Reads the language choice (chrome.i18n cannot be overridden, so a picked language uses the bundled catalogs). Await it before the first t(). */
export async function initLang(): Promise<void> {
  const { lang: stored } = (await globalThis.chrome?.storage?.local?.get('lang')) ?? {};
  lang = typeof stored === 'string' && stored in CATALOGS ? stored : 'auto';
}
export const getLang = () => lang;
export const setLang = (l: string) => chrome.storage.local.set({ lang: l });

/** Localized text for `key`. A picked language, or no Chrome translation (unit tests, missing key), renders the bundled catalogs. */
export function t(key: string, subs: string | number | (string | number)[] = []): string {
  const args = [subs].flat().map(String);
  if (lang === 'auto') {
    const got = globalThis.chrome?.i18n?.getMessage(key, args);
    if (got) return got;
  }
  const m = CATALOGS[lang]?.[key] ?? EN[key];
  if (!m) return key;
  return m.message.replace(/\$(\w+)\$/g, (_, name: string) =>
    (m.placeholders?.[name.toLowerCase()]?.content ?? '').replace(/\$(\d)/g, (_, i: string) => args[Number(i) - 1] ?? ''),
  );
}

/** Display name of an EQ preset; the English name stays the stored/lookup key. */
export const presetName = (name: string) => t('eq' + name.replace(/\W/g, ''));

/** Fills [data-i18n] (text), [data-i18n-title], [data-i18n-aria] (aria-label) and [data-i18n-placeholder]. */
export function applyI18n(root: ParentNode = document) {
  if (lang !== 'auto') document.documentElement.lang = lang;
  else if (globalThis.chrome?.i18n) document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n]')) e.textContent = t(e.dataset.i18n!);
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle!);
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria!));
  for (const e of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) e.placeholder = t(e.dataset.i18nPlaceholder!);
}
