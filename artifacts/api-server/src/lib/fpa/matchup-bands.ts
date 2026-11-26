/**
 * One matchup-difficulty methodology for the site (audit WEB-033).
 *
 * The rank is a defense's place in fantasy points allowed per game to one
 * position, from the FPA table (lib/fpa/fpa-data.ts) - the table the Fantasy
 * Points Allowed page prints. Rank 1 allowed the most points: the softest
 * matchup. The bands below are the FPA page's own tint scale, and every
 * player-page label (Game Log difficulty, the schedule strip, the Outlook's
 * soft/tough reads, the FAQ) reads them through matchupBand():
 *
 *   1-12   favorable ("soft"): 1-6 softest, 7-12 soft
 *   13-20  neutral
 *   21-32  tough: 21-26 tough, 27-32 toughest
 *
 * Until 2026-11-19 the player pages cut at 10 and 23 and the Game Log ranked
 * defenses its own way, so one opponent could read "25th, Tough" there and
 * "13th" on the FPA page.
 */

import { DEFAULT_FPA_FORMAT } from "./blend";

export type MatchupTier = "soft-2" | "soft-1" | "mid" | "tough-1" | "tough-2";
export type MatchupBand = "soft" | "mid" | "tough";

/** The last favorable rank, and the first tough one. */
export const SOFT_MAX_RANK = 12;
export const TOUGH_MIN_RANK = 21;

export function matchupTier(rank: number): MatchupTier {
  if (rank <= 6) return "soft-2";
  if (rank <= SOFT_MAX_RANK) return "soft-1";
  if (rank < TOUGH_MIN_RANK) return "mid";
  if (rank <= 26) return "tough-1";
  return "tough-2";
}

export function matchupBand(rank: number): MatchupBand {
  const tier = matchupTier(rank);
  return tier === "mid" ? "mid" : tier.startsWith("soft") ? "soft" : "tough";
}

/** The visible word for a band. */
export const BAND_WORDS: Record<MatchupBand, string> = { soft: "Favorable", mid: "Neutral", tough: "Tough" };

/* ------------------------------------------------------------ the wording */

/** Where an opponent rank came from; mirrors player/ranks.ts OppRankSource. */
export type OppRankMeaning = "fpa-current" | "fpa-archive" | "gamelog" | "unavailable";

/**
 * What a rank measures, in one phrase every player-page label shares
 * (WEB-033): position, scoring format, per game, and the cutoff.
 *
 *   current  "PPR fantasy points allowed per game to RBs through Week 11"
 *   archive  "PPR fantasy points allowed per game to RBs in 2025 (Weeks 1-17)"
 *   gamelog  "PPR fantasy points allowed per game to RBs in 2024 (full season)"
 *
 * `through` is the FPA table's own cutoff label ("Week 11", "Week 10 and 1
 * Week 11 game"), the same words the FPA page's Updated line prints.
 */
export function oppRankScope(input: {
  position: string | null;
  formatLabel: string;
  source: OppRankMeaning | null | undefined;
  season: number;
  through: string | null;
}): string {
  const who = input.position ? `${input.position}s` : "the position";
  const base = `${input.formatLabel} fantasy points allowed per game to ${who}`;
  if (input.source === "fpa-current") return input.through ? `${base} through ${input.through}` : `${base} this season to date`;
  if (input.source === "fpa-archive") return `${base} in ${input.season} (Weeks 1-17)`;
  return `${base} in ${input.season} (full season)`;
}

/**
 * The Fantasy Points Allowed page in a given scoring format (WEB-033).
 *
 * The FPA page opened in Half-PPR while the player pages are PPR, so a bare
 * link landed a reader on a different column than the one every rank there
 * quotes: the 2026-11-25 audit's seven "disagreements" for Gibbs were the
 * Half-PPR RB ranks. The page now opens in PPR (DEFAULT_FPA_FORMAT), so a PPR
 * link is the bare, canonical address; any other format names itself the way
 * the FPA page's own Scoring control does.
 */
export function fpaFormatHref(base: string, format: string): string {
  if (format === DEFAULT_FPA_FORMAT) return base;
  return `${base}${base.includes("?") ? "&" : "?"}format=${encodeURIComponent(format)}`;
}
