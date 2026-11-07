import { BOOST_CHOICES, cleanFx, isValidPattern, isValidVolume, type Settings } from './rules';
import { t } from './i18n';

export const exportSettings = (s: Settings): string => JSON.stringify({ version: 1, ...s }, null, 2);

/** Validates an exported file. Throws Error with a readable message. */
export function parseImport(json: string): Settings {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    throw new Error(t('errJson'));
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(t('errObject'));
  if (d.version !== 1) throw new Error(t('errVersion', String(d.version)));
  if (typeof d.boostEnabled !== 'boolean') throw new Error(t('errBoostEnabled'));
  // levels above 100 are kept while boost is off (they play at 100), so an export can hold them
  const boost = true; // validate against the top cap whatever boostEnabled says
  const top = 600;
  // new in this version, so older exports lack them
  if (d.boostMax !== undefined && !BOOST_CHOICES.includes(d.boostMax)) throw new Error(t('errBoostMax', String(d.boostMax)));
  if (d.defaultVolume !== null && !isValidVolume(d.defaultVolume, boost, top)) {
    throw new Error(t('errDefault', String(d.defaultVolume)));
  }
  if (!d.sites || typeof d.sites !== 'object' || Array.isArray(d.sites)) throw new Error(t('errSites'));
  for (const [pattern, v] of Object.entries(d.sites)) {
    if (!isValidPattern(pattern)) throw new Error(t('errPattern', pattern));
    if (!isValidVolume(v, boost, top)) throw new Error(t('errVolume', [pattern, String(v)]));
  }
  if (!Array.isArray(d.excluded)) throw new Error(t('errExcludedList'));
  for (const p of d.excluded) {
    if (typeof p !== 'string' || !isValidPattern(p)) throw new Error(t('errExcluded', String(p)));
  }
  const muteSites = d.muteSites ?? []; // older exports lack it
  if (!Array.isArray(muteSites)) throw new Error(t('errExcludedList'));
  for (const p of muteSites) {
    if (typeof p !== 'string' || !isValidPattern(p)) throw new Error(t('errExcluded', String(p)));
  }
  return {
    defaultVolume: d.defaultVolume,
    boostEnabled: d.boostEnabled,
    boostMax: d.boostMax ?? 200,
    sites: d.sites,
    excluded: d.excluded,
    muteSites,
    fx: cleanFx(d.fx),
  };
}
