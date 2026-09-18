/**
 * Weekly positional ranks, opponent ranks, team usage shares and the missing
 * weeks a season needs to read as a season.
 *
 * All of it is derived at read time from the raw weekly stat lines. Nothing
 * here is stored, which is what lets the same data answer for Standard,
 * Half-PPR and PPR: change the format and every rank, share and rate below is
 * recomputed from the same numbers rather than looked up in a second table.
 *
 * The expensive pieces — a season's whole rank table, a season's team usage
 * aggregate — are computed once per (season, format) and held, because they are
 * the same for every player on the page and rebuilding them per profile would
 * make the first render of each player O(league).
 */

import { getTeamByAbbreviation } from "../team/teams";
import { seasonYear } from "../seo";
import { getEntryPoints, type ScoringFormat } from "./scoring";
import { loadByeWeeks, loadGameLogs, loadGameScores } from "./data";
import type { GameLogEntry, GameLogStats, GameScore, Player } from "./types";

/**
 * The canonical upper-case code for whatever upstream called a team.
 *
 * Delegates to the one team table (`lib/team/teams.ts`), so "JAC", "WSH",
 * "OAK" and "LA" land where they should without this module carrying a mapping
 * of its own. Unknown strings are passed through upper-cased rather than
 * dropped — an unrecognised opponent should still group with itself.
 */
export function teamCode(abbr: string | null | undefined): string {
  if (!abbr) return "";
  return getTeamByAbbreviation(abbr)?.code ?? abbr.trim().toUpperCase();
}

/**
 * Did the player actually take part in this game?
 *
 * The distinction that matters everywhere downstream: a zero because somebody
 * played badly is a data point, and a zero because they were inactive is not.
 * Averaging the second kind in is how a "points per game" quietly becomes
 * "points per game on the roster", which is a different and much less useful
 * number.
 */
export function hasParticipation(
  stats: GameLogStats,
  position: string | null,
): boolean {
  if ((stats.off_snp ?? 0) > 0) return true;
  if (position === "QB") {
    return (stats.pass_att ?? 0) > 0 || (stats.rush_att ?? 0) > 0;
  }
  if (position === "K") {
    return (stats.fga ?? 0) > 0 || (stats.xpa ?? 0) > 0;
  }
  return (
    (stats.rec_tgt ?? 0) > 0 ||
    (stats.rec ?? 0) > 0 ||
    (stats.rush_att ?? 0) > 0 ||
    (stats.pass_att ?? 0) > 0
  );
}

/* ------------------------------------------------------- weekly positional rank */

const weeklyRanksCache = new Map<string, Map<string, Map<number, number>>>();

/**
 * Every player's weekly finish within their own position, for one season.
 *
 * Keyed by player id, then by week. Built from the whole league at once because
 * a rank is a statement about everybody: you cannot compute one player's Week 4
 * finish without scoring every other player's Week 4.
 */
export function buildWeeklyRanks(
  season: number,
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
  format: ScoringFormat,
): Map<string, Map<number, number>> {
  const cacheKey = `${season}_${format}`;
  const hit = weeklyRanksCache.get(cacheKey);
  if (hit) return hit;

  const posById = new Map<string, string>();
  for (const p of players) if (p.position) posById.set(p.id, p.position);

  const byWeek = new Map<number, Map<string, { id: string; pts: number }[]>>();
  for (const [id, entries] of Object.entries(logs)) {
    const pos = posById.get(id);
    if (!pos) continue;
    for (const entry of entries) {
      if (!hasParticipation(entry.stats, pos)) continue;
      let posBucket = byWeek.get(entry.week);
      if (!posBucket) {
        posBucket = new Map();
        byWeek.set(entry.week, posBucket);
      }
      let bucket = posBucket.get(pos);
      if (!bucket) {
        bucket = [];
        posBucket.set(pos, bucket);
      }
      bucket.push({ id, pts: getEntryPoints(entry.stats, format) });
    }
  }

  const ranks = new Map<string, Map<number, number>>();
  for (const [week, posBucket] of byWeek) {
    for (const bucket of posBucket.values()) {
      bucket.sort((a, b) => b.pts - a.pts);
      bucket.forEach((row, i) => {
        let perPlayer = ranks.get(row.id);
        if (!perPlayer) {
          perPlayer = new Map();
          ranks.set(row.id, perPlayer);
        }
        perPlayer.set(week, i + 1);
      });
    }
  }

  weeklyRanksCache.set(cacheKey, ranks);
  return ranks;
}

export function attachRanks(
  entries: GameLogEntry[],
  playerId: string,
  ranks: Map<string, Map<number, number>>,
): GameLogEntry[] {
  const mine = ranks.get(playerId);
  if (!mine) return entries;
  return entries.map((e) => ({ ...e, pos_rank: mine.get(e.week) ?? null }));
}

/* -------------------------------------------------------------- opponent ranks */

const oppRanksCache = new Map<string, Map<string, number>>();

/**
 * How generous each defence is to each position, ranked 1 (stingiest) to 32.
 *
 * Season-long points allowed per game to the position, which is the crude but
 * honest version of this number. It is used only to tint a matchup column; the
 * page never presents it as a projection.
 */
export function buildOppRanks(
  season: number,
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
  format: ScoringFormat,
): Map<string, number> {
  const cacheKey = `${season}_${format}`;
  const hit = oppRanksCache.get(cacheKey);
  if (hit) return hit;

  const infoById = new Map<string, string>();
  for (const p of players) if (p.position && p.team) infoById.set(p.id, p.position);

  const allowed = new Map<string, number[]>();
  for (const [id, entries] of Object.entries(logs)) {
    const pos = infoById.get(id);
    if (!pos) continue;
    for (const entry of entries) {
      if (!hasParticipation(entry.stats, pos)) continue;
      const key = `${teamCode(entry.opp)}:${pos}`;
      const list = allowed.get(key);
      const pts = getEntryPoints(entry.stats, format);
      if (list) list.push(pts);
      else allowed.set(key, [pts]);
    }
  }

  const byPosition = new Map<string, { team: string; avg: number }[]>();
  for (const [key, points] of allowed) {
    const [team, pos] = key.split(":");
    const avg = points.reduce((sum, v) => sum + v, 0) / points.length;
    const group = byPosition.get(pos!);
    if (group) group.push({ team: team!, avg });
    else byPosition.set(pos!, [{ team: team!, avg }]);
  }

  const ranks = new Map<string, number>();
  for (const [pos, teams] of byPosition) {
    teams.sort((a, b) => a.avg - b.avg);
    teams.forEach((row, i) => ranks.set(`${row.team}:${pos}`, i + 1));
  }

  oppRanksCache.set(cacheKey, ranks);
  return ranks;
}

export function attachOppRanks(
  entries: GameLogEntry[],
  position: string | null,
  oppRanks: Map<string, number>,
): GameLogEntry[] {
  if (!position) return entries;
  return entries.map((e) => ({
    ...e,
    opp_rank_vs_pos: oppRanks.get(`${teamCode(e.opp)}:${position}`) ?? null,
  }));
}

/* ------------------------------------------------------------- team usage share */

interface TeamWeekAgg {
  tgt: number;
  pass_att: number;
  rush_att: number;
}

const teamAggCache = new Map<number, Map<string, TeamWeekAgg>>();

function buildTeamAggregates(
  season: number,
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
): Map<string, TeamWeekAgg> {
  const hit = teamAggCache.get(season);
  if (hit) return hit;

  const teamById = new Map<string, string>();
  const posById = new Map<string, string | null>();
  for (const p of players) {
    if (p.team && p.team !== "FA") teamById.set(p.id, teamCode(p.team));
    posById.set(p.id, p.position);
  }

  const agg = new Map<string, TeamWeekAgg>();
  for (const [id, entries] of Object.entries(logs)) {
    const team = teamById.get(id);
    if (!team) continue;
    const pos = posById.get(id);
    for (const e of entries) {
      const key = `${team}_${e.week}`;
      let row = agg.get(key);
      if (!row) {
        row = { tgt: 0, pass_att: 0, rush_att: 0 };
        agg.set(key, row);
      }
      // A quarterback's "targets" are somebody else's throw, and a kicker has
      // none; counting either into the team's target pool would deflate every
      // receiver's share on the page.
      if (pos !== "QB" && pos !== "K") row.tgt += e.stats.rec_tgt ?? 0;
      if (pos === "QB") row.pass_att += e.stats.pass_att ?? 0;
      row.rush_att += e.stats.rush_att ?? 0;
    }
  }

  teamAggCache.set(season, agg);
  return agg;
}

/**
 * Which team a player's season belongs to.
 *
 * Read from the game logs first, because that is the only source that cannot be
 * wrong about a completed season: a player traded in March still played last
 * year for whoever the logs say. The current roster is the fallback, and the
 * opponent-matching heuristic below it is for old logs with no per-entry team
 * at all.
 */
export function resolveSeasonTeam(
  playerTeam: string | null,
  entries: GameLogEntry[],
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
): string | null {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.team) continue;
    const t = teamCode(e.team);
    if (!t || t === "FA") continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const fromEntries = mostCommon(counts);
  if (fromEntries) return fromEntries;

  if (playerTeam && playerTeam !== "FA") return teamCode(playerTeam);

  if (entries.length === 0) return null;

  // Last resort: somebody else played this opponent in this week, and we know
  // who they play for, so this player plays for whoever that opponent faced.
  const weekOppToTeam = new Map<string, string>();
  for (const p of players) {
    if (!p.team || p.team === "FA") continue;
    const theirTeam = teamCode(p.team);
    for (const e of logs[p.id] ?? []) {
      if (!e.opp) continue;
      const key = `${e.week}_${teamCode(e.opp)}`;
      if (!weekOppToTeam.has(key)) weekOppToTeam.set(key, theirTeam);
    }
  }
  const inferred = new Map<string, number>();
  for (const e of entries) {
    if (!e.opp) continue;
    const resolved = weekOppToTeam.get(`${e.week}_${teamCode(e.opp)}`);
    if (resolved) inferred.set(resolved, (inferred.get(resolved) ?? 0) + 1);
  }
  return mostCommon(inferred);
}

function mostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

/**
 * Add target share and team pass rate to each week.
 *
 * Both are shares of the team's own week, not of the league, which is the whole
 * point: eight targets means something different on a team that threw 25 times
 * than on one that threw 45.
 */
export function enrichWithTeamMetrics(
  entries: GameLogEntry[],
  playerTeam: string | null,
  season: number,
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
): GameLogEntry[] {
  const team = resolveSeasonTeam(playerTeam, entries, logs, players);
  if (!team) return entries;
  const agg = buildTeamAggregates(season, logs, players);

  return entries.map((e) => {
    const tw = agg.get(`${team}_${e.week}`);
    if (!tw) return e;
    const tgt = e.stats.rec_tgt ?? 0;
    const totalAtt = tw.pass_att + tw.rush_att;
    return {
      ...e,
      stats: {
        ...e.stats,
        target_share: tw.tgt > 0 ? Math.round((tgt / tw.tgt) * 1000) / 10 : null,
        team_pass_rate:
          totalAtt > 0 ? Math.round((tw.pass_att / totalAtt) * 1000) / 10 : null,
        team_tgt: tw.tgt,
        team_pass_att: tw.pass_att,
      },
    };
  });
}

/* ---------------------------------------------------------- missing weeks, scores */

const seasonMaxWeekCache = new Map<number, number>();
const teamMaxWeekCache = new Map<string, number>();

/**
 * The last week THIS TEAM has a logged game for, in a season.
 *
 * Needed because the league does not play a week at once. On a Friday in
 * September two teams have played the Thursday game and thirty have not, so a
 * league-wide "weeks played" pads twenty-eight rosters with an absence from a
 * game that has not kicked off — and then counts it against them as a game
 * missed. The unit is the team's schedule, not the calendar.
 */
function getTeamMaxWeek(season: number, team: string | null): number {
  if (!team) return 0;
  const code = teamCode(team);
  const key = `${season}:${code}`;
  const hit = teamMaxWeekCache.get(key);
  if (hit !== undefined) return hit;

  let max = 0;
  for (const entries of Object.values(loadGameLogs(season))) {
    for (const e of entries) {
      if (e.week > max && e.team && teamCode(e.team) === code) max = e.week;
    }
  }
  teamMaxWeekCache.set(key, max);
  return max;
}

function getSeasonMaxWeek(season: number, team: string | null): number {
  const hit = seasonMaxWeekCache.get(season);
  let max = hit;
  if (max === undefined) {
    max = 0;
    for (const entries of Object.values(loadGameLogs(season))) {
      for (const e of entries) if (e.week > max) max = e.week;
    }
    seasonMaxWeekCache.set(season, max);
  }
  // 18 weeks from 2021, 17 before — a season with no logs yet still shows its
  // full shape rather than collapsing to nothing.
  const fullSeason = season >= 2021 ? 18 : 17;

  /*
   * A season IN PROGRESS is padded only as far as the league has played.
   *
   * Padding it to its full shape is what the rule above does for a finished
   * season, and it is right there: the weeks a player is missing from a
   * completed season are weeks he missed. In September it is a different claim
   * entirely — sixteen rows of "Did not play" under a player who has not missed
   * anything, for weeks nobody has played. The table would be asserting
   * absences from the future.
   *
   * "In progress" is the current season with fewer weeks logged than it has.
   * A PRIOR season short of a full log is missing data, not unplayed, and still
   * shows its whole shape.
   */
  const inProgress = season >= seasonYear() && max > 0 && max < fullSeason;
  if (!inProgress) return Math.max(max, fullSeason);

  // In progress: this team's own last game, falling back to the league's when
  // the player has no team on record and there is no schedule to read.
  const teamWeeks = getTeamMaxWeek(season, team);
  return teamWeeks > 0 ? teamWeeks : max;
}

function getByeWeek(season: number, team: string | null): number | null {
  if (!team) return null;
  return loadByeWeeks()[String(season)]?.[teamCode(team)] ?? null;
}

function getGameScore(
  season: number,
  team: string | null,
  week: number,
): GameScore | null {
  if (!team) return null;
  const entry =
    loadGameScores()[String(season)]?.[`${teamCode(team)}_${week}`];
  if (!entry) return null;
  return { tm: entry.tm, opp: entry.opp, r: entry.r as GameScore["r"] };
}

/**
 * Pad a season out to every week, and say what each absence was.
 *
 * A game log that lists only the weeks somebody played reads as a clean season.
 * The weeks that are missing are frequently the most important thing on the
 * page — a bye is nothing, five straight "out" weeks is the story — so they are
 * printed as rows rather than left as gaps for the reader to notice.
 */
export function fillMissingWeeks(
  entries: GameLogEntry[],
  season: number,
  team: string | null,
  position: string | null = null,
): GameLogEntry[] {
  if (entries.length === 0) return entries;

  const byeWeek = getByeWeek(season, team);
  const present = new Set(entries.map((e) => e.week));
  const maxWeek = getSeasonMaxWeek(season, team);
  const filled: GameLogEntry[] = [...entries];

  for (let w = 1; w <= maxWeek; w += 1) {
    if (present.has(w)) continue;
    const isBye = byeWeek === w;
    filled.push({
      week: w,
      opp: isBye ? "BYE" : "—",
      stats: { pts_ppr: 0 },
      game_status: isBye ? "bye" : "out",
    });
  }

  filled.sort((a, b) => a.week - b.week);

  return filled.map((entry) => {
    // The POSITION matters here, and passing null was a real bug: a kicker's
    // participation is his attempts, and the position-blind check looks only at
    // targets, catches, carries and pass attempts. Every kicker's log therefore
    // read "Did not play" for every game he kicked in.
    const status =
      entry.game_status ??
      (hasParticipation(entry.stats, position) ? "active" : "out");
    return {
      ...entry,
      game_status: status,
      score:
        status === "active"
          ? (entry.score ?? getGameScore(season, team, entry.week))
          : (entry.score ?? null),
    };
  });
}

/** Drops the per-season derived tables. Used by the tests. */
export function resetRankCaches(): void {
  weeklyRanksCache.clear();
  oppRanksCache.clear();
  teamAggCache.clear();
  seasonMaxWeekCache.clear();
  teamMaxWeekCache.clear();
}
