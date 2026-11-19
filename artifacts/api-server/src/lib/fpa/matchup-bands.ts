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
