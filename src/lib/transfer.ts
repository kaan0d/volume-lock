import { BOOST_CHOICES, cleanFx, isValidPattern, isValidVolume, type Settings } from './rules';

export const exportSettings = (s: Settings): string => JSON.stringify({ version: 1, ...s }, null, 2);

/** Validates an exported file. Throws Error with a readable message. */
export function parseImport(json: string): Settings {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Expected a JSON object');
  if (d.version !== 1) throw new Error(`Unsupported version: ${d.version}`);
  if (typeof d.boostEnabled !== 'boolean') throw new Error('boostEnabled must be true or false');
  // levels above 100 are kept while boost is off (they play at 100), so an export can hold them
  const boost = true; // validate against the top cap whatever boostEnabled says
  const top = 600;
  // new in this version, so older exports lack them
  if (d.boostMax !== undefined && !BOOST_CHOICES.includes(d.boostMax)) throw new Error(`Invalid boostMax: ${d.boostMax}`);
  if (d.autoplayBlock !== undefined && (!Array.isArray(d.autoplayBlock) || !d.autoplayBlock.every((p: unknown) => typeof p === 'string' && isValidPattern(p)))) throw new Error('autoplayBlock must be a list of sites');
  if (d.defaultVolume !== null && !isValidVolume(d.defaultVolume, boost, top)) {
    throw new Error(`Invalid defaultVolume: ${d.defaultVolume}`);
  }
  if (!d.sites || typeof d.sites !== 'object' || Array.isArray(d.sites)) throw new Error('sites must be an object');
  for (const [pattern, v] of Object.entries(d.sites)) {
    if (!isValidPattern(pattern)) throw new Error(`Invalid site pattern: ${pattern}`);
    if (!isValidVolume(v, boost, top)) throw new Error(`Invalid volume for ${pattern}: ${v}`);
  }
  if (!Array.isArray(d.excluded)) throw new Error('excluded must be a list');
  for (const p of d.excluded) {
    if (typeof p !== 'string' || !isValidPattern(p)) throw new Error(`Invalid excluded entry: ${p}`);
  }
  return {
    defaultVolume: d.defaultVolume,
    boostEnabled: d.boostEnabled,
    boostMax: d.boostMax ?? 200,
    sites: d.sites,
    excluded: d.excluded,
    autoplayBlock: d.autoplayBlock ?? [],
    fx: cleanFx(d.fx),
  };
}
