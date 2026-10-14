import { originOf } from './origin';

export interface Settings {
  defaultVolume: number | null;
  boostEnabled: boolean;
  /** Keys are exact origins or wildcard patterns like `*.example.com`. */
  sites: Record<string, number>;
  excluded: string[];
}

export type Resolved = { volume: number; source: 'exact' | 'wildcard' | 'default' };

export const emptySettings = (): Settings => ({ defaultVolume: null, boostEnabled: false, sites: {}, excluded: [] });

const WILDCARD = /^\*\.([a-z0-9-]+\.)*[a-z0-9-]+$/;

export const isWildcard = (p: string) => WILDCARD.test(p);
export const isValidPattern = (p: string) => isWildcard(p) || (originOf(p) === p && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(p));
export const maxVolume = (boostEnabled: boolean) => (boostEnabled ? 200 : 100);

export function isValidVolume(v: unknown, boostEnabled: boolean): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= maxVolume(boostEnabled);
}

export function clampVolume(v: number, boostEnabled: boolean): number {
  return Math.min(maxVolume(boostEnabled), Math.max(0, Math.round(v) || 0));
}

/** Length of the wildcard's base domain if `pattern` covers `origin`, else -1. */
function wildcardMatch(pattern: string, origin: string): number {
  if (!isWildcard(pattern)) return -1;
  const base = pattern.slice(2);
  const host = new URL(origin).hostname;
  return host === base || host.endsWith('.' + base) ? base.length : -1;
}

export function resolveVolume(s: Settings, origin: string): Resolved | null {
  if (s.excluded.some((p) => p === origin || wildcardMatch(p, origin) >= 0)) return null;
  const done = (volume: number, source: Resolved['source']): Resolved => ({ volume: clampVolume(volume, s.boostEnabled), source });
  if (origin in s.sites) return done(s.sites[origin], 'exact');
  let best: string | null = null;
  let bestLen = -1;
  for (const p of Object.keys(s.sites)) {
    const len = wildcardMatch(p, origin);
    if (len > bestLen) [best, bestLen] = [p, len];
  }
  if (best !== null) return done(s.sites[best], 'wildcard');
  return s.defaultVolume === null ? null : done(s.defaultVolume, 'default');
}
