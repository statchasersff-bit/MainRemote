/**
 * Everyone who logged a line in one game, and what their season looked like
 * before it.
 *
 * Lifted out of leaders.ts when three more blocks came to need the same join.
 * The four leader cards, the player stat tables, the usage table and the
 * takeaways are all the same question asked at different widths — "who played
 * in this game and what did they do" — and each of them computing its own pass
 * over a season of logs would be three extra passes for one answer.
 *
 * Nothing here fetches. `loadGameLogs(season)` is the memoised read the game
 * log on a player page already does, and the player dictionary is the one
 * links.ts keeps warm.
 */

import { loadGameLogs, loadPlayers } from "../player/data";
import { getTeamByAbbreviation } from "../team/teams";
import type { NflTeam } from "../team/teams";
import type { GameLogEntry, GameLogStats, Player } from "../player/types";
import type { Meeting } from "./matchup-data";

export type Stats = GameLogEntry["stats"];

/**
 * Keyed rather than indexed: GameLogStats names its fields, and a typo here
 * would otherwise read as a silent zero on every row.
 */
export function num(stats: Stats, key: keyof GameLogStats): number {
  const raw = stats[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export interface Appearance {
  player: Player;
  team: NflTeam | null;
  stats: Stats;
  /**
   * What this player did in the SAME season before this week, when there is
   * anything. The takeaways read a role change off it; everything else ignores
   * it. Null when this was the player's first logged game of the season, which
   * is not the same as a zero baseline and must not be compared against one.
   */
  priorAverage: PriorAverage | null;
}

/** The season-to-date rates a single game is judged against. */
export interface PriorAverage {
  /** Games with a logged offensive snap, which is the denominator below. */
  games: number;
  /** Share of the team's offensive snaps, 0–1. */
  snapShare: number;
  /** Share of the team's targets, 0–1. Null when no prior game had targets. */
  targetShare: number | null;
  carries: number;
  targets: number;
  pprPoints: number;
}

let byId: Map<string, Player> | null = null;

function playerById(id: string): Player | null {
  if (!byId) byId = new Map(loadPlayers().map((p) => [p.id, p]));
  return byId.get(id) ?? null;
}

/** Share of the team's snaps in one logged week, or null when unknowable. */
export function snapShareOf(stats: Stats): number | null {
  const snaps = num(stats, "off_snp");
  const teamSnaps = num(stats, "tm_off_snp");
  if (teamSnaps <= 0) return null;
  return snaps / teamSnaps;
}

/**
 * Share of the team's targets in one logged week, or null.
 *
 * `target_share` is derived upstream in enrichWithTeamMetrics() and is not
 * present on every row, so it falls back to the two counts when both are there.
 */
export function targetShareOf(stats: Stats): number | null {
  const share = stats.target_share;
  if (typeof share === "number" && Number.isFinite(share) && share > 0) {
    // Upstream sends this as a fraction on some rows and a percentage on
    // others; anything above 1 is the second spelling of the same figure.
    return share > 1 ? share / 100 : share;
  }
  const teamTargets = num(stats, "team_tgt");
  if (teamTargets <= 0) return null;
  return num(stats, "rec_tgt") / teamTargets;
}

/** The season-to-date rates from the weeks before `week`, or null. */
function priorAverage(entries: GameLogEntry[], week: number): PriorAverage | null {
  const before = entries.filter(
    (entry) => entry.week < week && num(entry.stats, "off_snp") > 0,
  );
  if (before.length === 0) return null;

  let snapShareSum = 0;
  let snapShareGames = 0;
  let targetShareSum = 0;
  let targetShareGames = 0;
  let carries = 0;
  let targets = 0;
  let points = 0;

  for (const entry of before) {
    const share = snapShareOf(entry.stats);
    if (share !== null) {
      snapShareSum += share;
      snapShareGames += 1;
    }
    const tshare = targetShareOf(entry.stats);
    if (tshare !== null) {
      targetShareSum += tshare;
      targetShareGames += 1;
    }
    carries += num(entry.stats, "rush_att");
    targets += num(entry.stats, "rec_tgt");
    points += num(entry.stats, "pts_ppr");
  }

  return {
    games: before.length,
    snapShare: snapShareGames ? snapShareSum / snapShareGames : 0,
    targetShare: targetShareGames ? targetShareSum / targetShareGames : null,
    carries: carries / before.length,
    targets: targets / before.length,
    pprPoints: points / before.length,
  };
}

/**
 * Everyone who logged a line in this game.
 *
 * Matched on the log's own `team`/`opp` codes rather than on a player's current
 * team: a player traded since is in the log under the team he played for, and
 * filtering by where he is now would drop him from a game he played in.
 */
export function appearances(meeting: Meeting): Appearance[] {
  const codes = new Set(
    [meeting.home, meeting.away].map((team) => team.code.toUpperCase()),
  );
  if (codes.size !== 2) return [];

  const logs = loadGameLogs(meeting.season);
  const found: Appearance[] = [];

  for (const [id, entries] of Object.entries(logs)) {
    for (const entry of entries) {
      if (entry.week !== meeting.week) continue;
      const team = (entry.team ?? "").toUpperCase();
      const opp = (entry.opp ?? "").toUpperCase();
      // Both sides have to match, not just one: a team plays a different
      // opponent every week, and week alone would pull in the whole league.
      if (!codes.has(team) || !codes.has(opp) || team === opp) continue;
      const player = playerById(id);
      if (!player) continue;
      found.push({
        player,
        team: getTeamByAbbreviation(team),
        stats: entry.stats ?? {},
        priorAverage: priorAverage(entries, meeting.week),
      });
      break;
    }
  }
  return found;
}

/**
 * Where one week's PPR total finished among the league's players at that
 * position — the "WR8" a fantasy reader converts every score into.
 *
 * Computed from the same season file the appearances came out of, once per
 * season and week and then held: it is a pass over every logged player, and
 * four tables on one page would otherwise each make their own.
 */
const finishCache = new Map<string, Map<string, number>>();

export function positionFinishes(season: number, week: number): Map<string, number> {
  const key = `${season}:${week}`;
  const cached = finishCache.get(key);
  if (cached) return cached;

  const byPosition = new Map<string, Array<{ id: string; points: number }>>();
  let logs: Record<string, GameLogEntry[]>;
  try {
    logs = loadGameLogs(season);
  } catch {
    const empty = new Map<string, number>();
    finishCache.set(key, empty);
    return empty;
  }

  for (const [id, entries] of Object.entries(logs)) {
    const entry = entries.find((row) => row.week === week);
    if (!entry) continue;
    const player = playerById(id);
    const position = player?.position;
    if (!position) continue;
    const points = num(entry.stats ?? {}, "pts_ppr");
    // A player who did not score is not ranked. Hundreds of them tie on zero
    // and printing "WR143" for a receiver who was inactive is noise dressed as
    // a finish.
    if (points <= 0) continue;
    const list = byPosition.get(position) ?? [];
    list.push({ id, points });
    byPosition.set(position, list);
  }

  const finishes = new Map<string, number>();
  for (const list of byPosition.values()) {
    list.sort((x, y) => y.points - x.points);
    list.forEach((entry, index) => finishes.set(entry.id, index + 1));
  }
  finishCache.set(key, finishes);
  return finishes;
}
