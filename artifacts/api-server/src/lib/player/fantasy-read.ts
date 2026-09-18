/**
 * The interpretation layer behind the Overview tab.
 *
 * The rule the whole player page is now split on:
 *
 *   "What happened?"    -> Stats and Game Log.
 *   "What does it mean?" -> Overview.
 *
 * So 277 passing yards is a Stats fact and "strong passing volume" is an
 * Overview one; 73% completion is Stats and "accuracy has been a strength" is
 * Overview. This file holds the second half — the words, and the thresholds
 * that earn them.
 *
 * Everything here is DERIVED. Each phrase is a restatement of a number that is
 * either printed beside it or one tab away, and the threshold that produced it
 * is written down in this file rather than in somebody's head. Nothing here is
 * authored copy and nothing here forecasts: "currently producing as a QB2" is a
 * description of games played, which is what rule 3 in player-render.ts allows
 * an interpretation to be.
 */

import { finishBadge, type GameLogSummary, type TdDependency } from "./metrics";
import type { GameLogEntry } from "./types";

/* ------------------------------------------------------- reading a percentile */

/**
 * What a percentile means, in words.
 *
 * Five steps rather than three: the middle of a distribution is genuinely
 * different from the edges of it, and collapsing 45th and 55th into one word
 * with 25th and 75th makes the label useless exactly where most players live.
 */
export function percentileRead(percentile: number | null): string {
  if (percentile === null) return "";
  if (percentile >= 85) return "Elite for the position";
  if (percentile >= 65) return "Above average";
  if (percentile >= 35) return "Around league average";
  if (percentile >= 15) return "Below average";
  return "Bottom of the position";
}

/** The same five steps, as a level for the accent. */
export function percentileLevel(percentile: number | null): string {
  if (percentile === null) return "";
  if (percentile >= 65) return "high";
  if (percentile >= 35) return "mid";
  return "low";
}

/* --------------------------------------------------------- the weekly range */

export interface WeeklyRange {
  /** Worst weekly positional finish — the larger number. */
  floor: number;
  /** The median week. */
  typical: number;
  /** Best weekly positional finish — the smaller number. */
  ceiling: number;
  weeks: number;
}

/**
 * Where his weeks actually landed, as a range of positional finishes.
 *
 * Observed, not projected — this is the Overview's answer to "what kind of week
 * does he give you", and it is measured off the weeks he has played. The
 * Outlook tab carries the projected version, which is authored and labelled as
 * a projection; these two must never be confused, so this one is always stamped
 * with how many weeks it is drawn from.
 *
 * Null under two games: one week is not a range, and printing it as one would
 * be the page inventing a spread from a single point.
 */
export function weeklyFinishRange(entries: GameLogEntry[]): WeeklyRange | null {
  const ranks = entries
    .filter((entry) => entry.game_status === "active")
    .map((entry) => entry.pos_rank)
    .filter((rank): rank is number => typeof rank === "number" && rank > 0)
    .sort((a, b) => a - b);

  if (ranks.length < 2) return null;

  const mid = Math.floor(ranks.length / 2);
  const typical =
    ranks.length % 2 === 1
      ? ranks[mid]!
      : Math.round(((ranks[mid - 1] ?? 0) + (ranks[mid] ?? 0)) / 2);

  return {
    ceiling: ranks[0]!,
    typical,
    floor: ranks[ranks.length - 1]!,
    weeks: ranks.length,
  };
}

/* ---------------------------------------------------------- the profile rows */

export interface ProfileRow {
  label: string;
  value: string;
  detail: string;
  level?: string;
}

/**
 * The fantasy profile: six readings, no counting stats.
 *
 * Deliberately contains not one raw total. Yards, completions and touchdowns
 * are on the Stats tab; what belongs here is what they add up to — the tier he
 * is producing at, how repeatable it has been, and what the points are made of.
 */
export function fantasyProfile(input: {
  stats: GameLogSummary;
  position: string | null;
  seasonRank: number | null;
  roleLabel: string;
  formLabel: string;
  formDetail: string;
  formDirection: string;
  volatilityLabel: string;
  td: TdDependency;
}): ProfileRow[] {
  const { stats, position, seasonRank, td } = input;
  const badge = finishBadge(seasonRank, position);
  const rows: ProfileRow[] = [];

  rows.push({
    label: "Role",
    value: input.roleLabel,
    detail: `${pctText(stats.pos1Pct + stats.pos2Pct)} of weeks in starter range`,
  });

  if (badge) {
    rows.push({
      label: "Weekly tier",
      value: `${position ?? ""}${seasonRank} · ${badge.label}`,
      detail: badge.descriptor,
      level: badge.tier === "elite" || badge.tier === "starter" ? "high" : "mid",
    });
  }

  // Under four games the spread is arithmetic rather than a tendency, and the
  // row says so instead of labelling noise as "consistent".
  rows.push({
    label: "Consistency",
    value: stats.gamesPlayed < 4 ? "Low sample" : input.volatilityLabel,
    detail:
      stats.gamesPlayed < 4
        ? `${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"} is too few to read`
        : `${stats.volatility.toFixed(1)} pt swing on ${stats.ppg.toFixed(1)} PPG`,
  });

  rows.push({
    label: "Ceiling rate",
    value: pctText(stats.pos1Pct),
    detail: `${stats.pos1Games} of ${stats.gamesPlayed} weeks in the top 12`,
    level: stats.pos1Pct >= 40 ? "high" : stats.pos1Pct >= 15 ? "mid" : "low",
  });

  rows.push({
    label: "Recent form",
    value: input.formLabel,
    detail: input.formDetail,
    level:
      input.formDirection === "up"
        ? "high"
        : input.formDirection === "down"
          ? "low"
          : "mid",
  });

  if (td.label !== "N/A") {
    rows.push({
      label: "Scoring profile",
      value: td.label,
      detail: `${pctText(td.pct)} of points from touchdowns`,
      // A TD-driven line is the least repeatable kind, so it reads as the
      // caution it is rather than as a compliment.
      level: td.isHigh ? "low" : "high",
    });
  }

  return rows;
}

function pctText(value: number): string {
  return `${Math.round(value)}%`;
}

/* ------------------------------------------------------------ the one-liner */

/**
 * Two sentences on what the season has been, assembled from clauses.
 *
 * Assembled rather than written, so it cannot say anything the numbers do not.
 * A clause whose input is missing is simply left out — the sentence gets
 * shorter, never vaguer, and never speculative.
 */
export function seasonSentence(input: {
  name: string;
  position: string | null;
  season: number;
  stats: GameLogSummary;
  seasonRank: number | null;
  td: TdDependency;
  /**
   * Efficiency percentiles, when the player qualified for them.
   *
   * `phrase` is how the metric reads inside a sentence — "accuracy", not
   * "Completion rate", and certainly not "td per attempt", which is what
   * lowercasing a column label produces.
   */
  efficiency: { label: string; phrase: string; percentile: number | null }[];
}): string {
  const { name, position, season, stats, seasonRank, td, efficiency } = input;
  if (stats.gamesPlayed === 0) return "";

  const badge = finishBadge(seasonRank, position);
  const games = `${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"}`;

  const opening = badge
    ? `${name} is producing as ${aOrAn(`${position ?? ""}${seasonRank}`)} through ${games}, ` +
      `at ${stats.ppg.toFixed(1)} points per game.`
    : `${name} has averaged ${stats.ppg.toFixed(1)} points per game through ${games} in ${season}.`;

  // The strongest and weakest measured rates, named. Only when the player
  // actually qualified for a percentile — see benchmarks.ts.
  const ranked = efficiency.filter(
    (row): row is { label: string; phrase: string; percentile: number } =>
      row.percentile !== null,
  );
  const clauses: string[] = [];

  if (ranked.length > 0) {
    const best = ranked.reduce((a, b) => (b.percentile > a.percentile ? b : a));
    const worst = ranked.reduce((a, b) => (b.percentile < a.percentile ? b : a));
    if (best.percentile >= 65) {
      clauses.push(`${best.phrase} has been a strength`);
    }
    if (worst.percentile <= 35 && worst.label !== best.label) {
      clauses.push(`${worst.phrase} has lagged the rest of the line`);
    }
  }

  if (td.label !== "N/A" && td.isHigh) {
    clauses.push("the scoring has leaned heavily on touchdowns");
  }

  if (clauses.length === 0) return opening;
  return `${opening} ${capitalize(joinClauses(clauses))}.`;
}

function aOrAn(word: string): string {
  return /^[AEIOU]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
