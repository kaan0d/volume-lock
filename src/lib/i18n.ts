import en from '../../public/_locales/en/messages.json' with { type: 'json' };

type Msg = { message: string; placeholders?: Record<string, { content: string }> };
const EN: Record<string, Msg> = en;

/** Localized text for `key`. Without a Chrome translation (unit tests, missing key) it renders the bundled English. */
export function t(key: string, subs: string | number | (string | number)[] = []): string {
  const args = [subs].flat().map(String);
  const got = globalThis.chrome?.i18n?.getMessage(key, args);
  if (got) return got;
  const m = EN[key];
  if (!m) return key;
  return m.message.replace(/\$(\w+)\$/g, (_, name: string) =>
    (m.placeholders?.[name.toLowerCase()]?.content ?? '').replace(/\$(\d)/g, (_, i: string) => args[Number(i) - 1] ?? ''),
  );
}

/** Display name of an EQ preset; the English name stays the stored/lookup key. */
export const presetName = (name: string) => t('eq' + name.replace(/\W/g, ''));

/** Fills [data-i18n] (text), [data-i18n-title], [data-i18n-aria] (aria-label) and [data-i18n-placeholder]. */
export function applyI18n(root: ParentNode = document) {
  if (globalThis.chrome?.i18n) document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n]')) e.textContent = t(e.dataset.i18n!);
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle!);
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria!));
  for (const e of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) e.placeholder = t(e.dataset.i18nPlaceholder!);
}
