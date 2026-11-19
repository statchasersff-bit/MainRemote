/**
 * The FPTS column of every advanced-stats table, re-scored from the player
 * game logs (audit WEB-031/036, 2026-11-19).
 *
 * The tables' own `fantasyPoints` is nflverse's (2026) or the snapshot
 * vendor's (2023-2025): Standard scoring with -2 per interception. So St.
 * Brown read 118.4 in the NFL WR table and 183.4 on his page, and his Stats
 * tab's "fantasy points per target" was Standard (1.30) beside the hub's PPR
 * (2.02). Every reader of those files - the NFL Player Stats tables
 * (stats-data.ts), the Stats tab (stats-tab-data.ts) and the Outlook drivers
 * (outlook-tab-data.ts) - passes its rows through here, which sums the same
 * getEntryPoints() over the same game-log entries the player pages sum.
 *
 * Only the weeks the table covers count: 1-17, or 1 through the week a season
 * in progress has reached. A row with no game-log entry gets null (printed
 * "-"), never the feed's Standard figure under a PPR label.
 */

import { loadGameLogs } from "../player/data";
import { getEntryPoints } from "../player/scoring";
import { DEFAULT_SCORING_FORMAT, type ScoringFormat } from "../scoring/house-rules";

export function housePointsFor(
  playerId: string | null,
  seasons: number[],
  lastWeek: number,
  format: ScoringFormat = DEFAULT_SCORING_FORMAT,
): number | null {
  if (!playerId) return null;
  let total = 0;
  let found = false;
  for (const y of seasons) {
    const games = loadGameLogs(y)[playerId];
    if (!games) continue;
    for (const g of games) {
      if (g.week > lastWeek) continue;
      found = true;
      total += getEntryPoints(g.stats, format);
    }
  }
  return found ? Math.round(total * 10) / 10 : null;
}

/** A table's rows with `fantasyPoints` replaced by the house PPR figure. */
export function withHousePoints<R extends Record<string, unknown>>(
  rows: R[],
  seasons: number[],
  lastWeek: number,
  format: ScoringFormat = DEFAULT_SCORING_FORMAT,
): R[] {
  return rows.map((row) => {
    if (!("fantasyPoints" in row)) return row;
    const id = row["playerId"] == null ? null : String(row["playerId"]);
    // The feed's own figure is kept beside it (fantasyPointsSource): the
    // grades are defined on it (stats-data.ts GRADE_FPTS) and must not move
    // because the displayed column changed format.
    return {
      ...row,
      fantasyPointsSource: "fantasyPointsSource" in row ? row["fantasyPointsSource"] : row["fantasyPoints"],
      fantasyPoints: housePointsFor(id, seasons, lastWeek, format),
    };
  });
}

/** The week a raw table covers through: its `week` when in progress, else 17. */
export function tableLastWeek(raw: { week?: unknown; inProgress?: unknown }): number {
  return typeof raw.week === "number" && raw.week > 0 ? raw.week : 17;
}
