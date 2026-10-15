import { originOf } from './origin';

/** Sound effects, applied to every site that is not excluded. Only media that goes through Web Audio gets them. */
export interface Fx {
  /** Evens out loud and quiet parts (a compressor). */
  leveler: boolean;
  /** Plays both channels as one. */
  mono: boolean;
  /** -100 (left only) .. 100 (right only). */
  balance: number;
  /** Gain in dB for each of the five EQ bands. */
  eq: number[];
}

export interface Settings {
  defaultVolume: number | null;
  boostEnabled: boolean;
  /** Top of the knob while boost is on: 200, 300, 400 or 600. */
  boostMax: number;
  /** Keys are exact origins or wildcard patterns like `*.example.com`. */
  sites: Record<string, number>;
  excluded: string[];
  /** Sites (same patterns) where media that starts playing before any click is paused. */
  autoplayBlock: string[];
  fx: Fx;
}

export type Resolved = { volume: number; source: 'exact' | 'wildcard' | 'default' };

export const BOOST_CHOICES = [200, 300, 400, 600];
/** Centre frequencies (Hz) of the five EQ bands: low shelf, three peaks, high shelf. */
export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_LIMIT = 12; // dB either way
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  'Bass boost': [6, 4, 0, 0, 0],
  'Treble boost': [0, 0, 0, 4, 6],
  Vocal: [-3, -1, 3, 3, -1],
  Loudness: [5, 2, -1, 2, 5],
};
/** Name of the preset whose gains equal `eq`, or null for custom gains. */
export const presetOf = (eq: number[]) => Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k].every((g, i) => g === eq[i])) ?? null;
export const emptyFx = (): Fx => ({ leveler: false, mono: false, balance: 0, eq: EQ_BANDS.map(() => 0) });
export const fxActive = (f: Fx) => f.leveler || f.mono || f.balance !== 0 || f.eq.some((g) => g !== 0);
export const emptySettings = (): Settings => ({ defaultVolume: null, boostEnabled: false, boostMax: 200, sites: {}, excluded: [], autoplayBlock: [], fx: emptyFx() });

/** Fx from untrusted input (storage, import): anything off-spec falls back to its default. */
export function cleanFx(x: unknown): Fx {
  const d = emptyFx();
  if (!x || typeof x !== 'object') return d;
  const o = x as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
  return {
    leveler: o.leveler === true,
    mono: o.mono === true,
    balance: num(o.balance, -100, 100, 0),
    eq: Array.isArray(o.eq) && o.eq.length === EQ_BANDS.length ? o.eq.map((g) => num(g, -EQ_LIMIT, EQ_LIMIT, 0)) : d.eq,
  };
}
export const cleanBoostMax = (v: unknown) => (typeof v === 'number' && BOOST_CHOICES.includes(v) ? v : 200);

const WILDCARD = /^\*\.([a-z0-9-]+\.)*[a-z0-9-]+$/;

export const isWildcard = (p: string) => WILDCARD.test(p);
export const isValidPattern = (p: string) => isWildcard(p) || (originOf(p) === p && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(p));
export const maxVolume = (boostEnabled: boolean, boostMax = 200) => (boostEnabled ? boostMax : 100);

export function isValidVolume(v: unknown, boostEnabled: boolean, boostMax = 200): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= maxVolume(boostEnabled, boostMax);
}

export function clampVolume(v: number, boostEnabled: boolean, boostMax = 200): number {
  return Math.min(maxVolume(boostEnabled, boostMax), Math.max(0, Math.round(v) || 0));
}

/** Length of the wildcard's base domain if `pattern` covers `origin`, else -1. */
function wildcardMatch(pattern: string, origin: string): number {
  if (!isWildcard(pattern)) return -1;
  const base = pattern.slice(2);
  const host = new URL(origin).hostname;
  return host === base || host.endsWith('.' + base) ? base.length : -1;
}

export const covers = (pattern: string, origin: string) => pattern === origin || wildcardMatch(pattern, origin) >= 0;
export const inList = (list: string[], origin: string) => list.some((p) => covers(p, origin));
export const isExcluded = (s: Settings, origin: string) => inList(s.excluded, origin);

/** The saved key that sets the level for `origin`: the exact origin, else the longest matching wildcard. Ignores excludes and the default. */
export function coveringKey(s: Settings, origin: string): string | null {
  if (origin in s.sites) return origin;
  let best: string | null = null;
  let bestLen = -1;
  for (const p of Object.keys(s.sites)) {
    const len = wildcardMatch(p, origin);
    if (len > bestLen) [best, bestLen] = [p, len];
  }
  return best;
}

export function resolveVolume(s: Settings, origin: string): Resolved | null {
  if (isExcluded(s, origin)) return null;
  const done = (volume: number, source: Resolved['source']): Resolved => ({ volume: clampVolume(volume, s.boostEnabled, s.boostMax), source });
  const key = coveringKey(s, origin);
  if (key !== null) return done(s.sites[key], key === origin ? 'exact' : 'wildcard');
  return s.defaultVolume === null ? null : done(s.defaultVolume, 'default');
}
