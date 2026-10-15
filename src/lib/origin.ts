/** Origin of an http(s) URL, or null for anything else (chrome://, file:, about:blank, invalid). */
export function originOf(url: string | undefined): string | null {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Origin as shown to the user: no scheme, no leading "www.". Wildcards and other keys pass through. */
export const displayOrigin = (o: string) => o.replace(/^https?:\/\/(www\.)?/, '');
