/**
 * Hand-written intros for the all-time series, per pair.
 *
 * The generated intro (rivalry.ts) says only what the list of meetings can
 * prove: when the pair first met, how often, and since when they have shared
 * a division. Where a franchise played at the time, and when it moved, is the
 * kind of history that is easy to get wrong from data, so it is written here
 * by hand and printed as given.
 *
 * Keyed by the pair's slug below /nfl/. A pair with no entry gets the
 * generated intro. Kept in source so every claim is reviewable in a diff.
 */
export const RIVALRY_INTROS: Record<string, string> = {
  "arizona-cardinals-vs-los-angeles-rams":
    "One of the NFL's oldest matchups: the two franchises first met in 1937, when the " +
    "Cardinals played in Chicago and the Rams in Cleveland, and they have been NFC West " +
    "rivals since 2002.",
};

export function rivalryIntroFor(pairSlug: string): string | null {
  return RIVALRY_INTROS[pairSlug] ?? null;
}
