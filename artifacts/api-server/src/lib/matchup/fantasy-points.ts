/**
 * Fantasy points for one player in one game, from his box-score line.
 *
 * The one scoring engine the matchup pages use. The Sleeper logs carry their
 * own PPR figure, but only for the regular season's offensive players; a
 * playoff game has no log at all. Computing from the line means every game —
 * Wild Card included — scores the same way, and a figure on the page can be
 * checked by hand against the stats printed beside it.
 *
 * Pure: a stat line and a format in, a number rounded to one decimal out.
 */

export type ScoringFormat = "ppr" | "half" | "standard";

/**
 * The counting stats scoring reads. Every field is optional: a receiver has
 * no passing line, and a missing field is a zero, not an unknown.
 */
export interface FantasyStatLine {
  passYds?: number;
  passTd?: number;
  passInt?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  fumblesLost?: number;
  /** Two-point conversions this player scored, running or catching. */
  twoPtScored?: number;
  /** Two-point conversions this player threw. */
  twoPtPassed?: number;
}

const PER_RECEPTION: Record<ScoringFormat, number> = { ppr: 1, half: 0.5, standard: 0 };

export function fantasyPoints(stats: FantasyStatLine, format: ScoringFormat): number {
  const n = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const points =
    n(stats.passYds) * 0.04 +
    n(stats.passTd) * 4 -
    n(stats.passInt) * 2 +
    (n(stats.rushYds) + n(stats.recYds)) * 0.1 +
    (n(stats.rushTd) + n(stats.recTd)) * 6 +
    n(stats.rec) * PER_RECEPTION[format] -
    n(stats.fumblesLost) * 2 +
    (n(stats.twoPtScored) + n(stats.twoPtPassed)) * 2;
  // Rounded through an integer so 24.28 prints 24.3 and 0.1 * 3 is not 0.30000000000000004.
  return Math.round(points * 10) / 10;
}
