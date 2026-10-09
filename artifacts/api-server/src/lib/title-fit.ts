/**
 * The longest title that fits a results page.
 *
 * Google shows about 60 characters of a title and rewrites or cuts the rest,
 * and the 2026-10-08 crawl found 2,373 of the site's generated titles past it:
 * a player's or a team's name is the part people search, so it stays whole and
 * the tail after it gives way. Every generated title is a ladder of
 * candidates, most descriptive first, and the first that fits is used; the
 * last rung is written short enough to fit for every name there is, and is
 * returned even when it does not.
 *
 * No " | StatChasers" anywhere (mak, 2026-10-08): the brand spent fourteen
 * characters of the sixty on every page and the name already carries the site.
 *
 * MIRRORED IN PHP by statchasers_fit_title() in the WordPress plugin, which
 * builds the same strings for Rank Math. Change one and change the other.
 */

export const TITLE_MAX = 60;

export function fitTitle(candidates: string[], max = TITLE_MAX): string {
  for (const candidate of candidates) {
    if (candidate.length <= max) return candidate;
  }
  return candidates[candidates.length - 1];
}
