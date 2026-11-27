/**
 * Which weeks the live FPA table holds in full (2026-11-20, the WEB-032 rule
 * applied to Fantasy Points Allowed).
 *
 * The ingest stamps a snapshot with the highest week in nflverse's weekly
 * file, so one Thursday game turned the page into "Weeks 1-11" with thirteen
 * Week 11 games still to play, and the player pages' matchup notes into
 * "Measured through Week 11". The 10-10 spec asks for the last COMPLETED week
 * in the title and H1; this works it out from what the table holds.
 *
 * `present` is every "week:TEAM" with stored game rows (fantasy_points_allowed_games,
 * which keeps every current-season week whatever the blend window). A game is
 * held when both of its defenses have rows that week. A week is complete when
 * every game the schedule has for it is held; byes have no game and so never
 * hold a week back. Only the schedule's weeks and teams are read, never its
 * scores, so a stale score column cannot move the answer.
 */

import { getTeamByAbbreviation } from "../team/teams";

/**
 * The club-weeks a set of stored game rows holds, "11:IND". One entry per
 * (week, defense) however many rows carry it - a game has a row per player
 * and position, and a duplicated row adds nothing - so rows can only ever
 * show a game present, never stand in for the other team's missing side.
 * Abbreviations go through the team table so "LA" and "LAR" are one club.
 */
export function heldClubWeeks(rows: Iterable<{ week: number; defense: string }>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!Number.isInteger(r.week) || !r.defense) continue;
    out.add(`${r.week}:${getTeamByAbbreviation(r.defense)?.code ?? r.defense.toUpperCase()}`);
  }
  return out;
}

export interface FpaScheduleGame {
  week: number;
  away: string;
  home: string;
  gameday?: string;
  gametime?: string | null;
}

export interface FpaWeekCoverage {
  /** Every scheduled game up to and including this week is in the table. 0 = none. */
  completeThroughWeek: number;
  /** The first incomplete week, when it already has games in the table. */
  partialWeek: number | null;
  /** Held games after the complete weeks, "IND at HOU", in kickoff order. */
  partialGames: string[];
}

export function fpaWeekCoverage(
  present: Set<string>,
  games: FpaScheduleGame[],
  maxWeek = 17,
): FpaWeekCoverage | null {
  const sched = games.filter((g) => g.week >= 1 && g.week <= maxWeek);
  if (sched.length === 0 || present.size === 0) return null;
  const order = (a: FpaScheduleGame, b: FpaScheduleGame) =>
    a.week - b.week || `${a.gameday ?? ""}${a.gametime ?? ""}`.localeCompare(`${b.gameday ?? ""}${b.gametime ?? ""}`);
  const held = (g: FpaScheduleGame) => present.has(`${g.week}:${g.away}`) && present.has(`${g.week}:${g.home}`);

  const weeks = [...new Set(sched.map((g) => g.week))].sort((a, b) => a - b);
  let complete = 0;
  for (const w of weeks) {
    if (sched.filter((g) => g.week === w).every(held)) complete = w;
    else break;
  }
  const later = sched.filter((g) => g.week > complete && held(g)).sort(order);
  const partialWeek = later.length ? later[0]!.week : null;
  return {
    completeThroughWeek: complete,
    partialWeek,
    // That week's games only, so "1 Week 11 game" never counts a Week 12 one.
    partialGames: later.filter((g) => g.week === partialWeek).map((g) => `${g.away} at ${g.home}`),
  };
}

/** "1 Week 11 game", "3 Week 11 games": the partial week in a few words. */
export function partialGameWords(week: number, games: string[]): string {
  return `${games.length} Week ${week} game${games.length === 1 ? "" : "s"}`;
}

/**
 * The rows of the weeks every scheduled game of which is held. Weeks after
 * the first incomplete one are left out too, so a late-week game never
 * stands in for a whole week. With no schedule to tell by, every row counts
 * (the old behavior), so a missing games.csv cannot empty the table.
 */
export function completeWeekRows<T extends { week: number; defenseTeam: string }>(
  rows: T[],
  games: FpaScheduleGame[],
  maxWeek = 17,
): T[] {
  if (rows.length === 0) return rows;
  const cover = fpaWeekCoverage(
    heldClubWeeks(rows.map((r) => ({ week: r.week, defense: r.defenseTeam }))),
    games,
    maxWeek,
  );
  if (!cover) return rows;
  return rows.filter((r) => r.week <= cover.completeThroughWeek);
}
