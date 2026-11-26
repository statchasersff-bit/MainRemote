/**
 * Weekly positional ranks, opponent ranks, team usage shares and the missing
 * weeks a season needs to read as a season.
 *
 * All of it is derived at read time from the raw weekly stat lines. Nothing
 * here is stored, which is what lets the same data answer for Standard,
 * Half-PPR and PPR: change the format and every rank, share and rate below is
 * recomputed from the same numbers rather than looked up in a second table.
 *
 * The expensive pieces - a season's whole rank table, a season's team usage
 * aggregate - are computed once per (season, format) and held, because they are
 * the same for every player on the page and rebuilding them per profile would
 * make the first render of each player O(league).
 */

import { getTeamByAbbreviation } from "../team/teams";
import { seasonYear } from "../seo";
import { getEntryPoints, type ScoringFormat } from "./scoring";
import { scoringTotalsSource } from "../scoring/house-rules";
import { loadByeWeeks, loadGameLogs, loadGameScores } from "./data";
import { rankFpaValues } from "../fpa/math";
import type { GameLogEntry, GameLogStats, GameScore, Player } from "./types";

/**
 * The canonical upper-case code for whatever upstream called a team.
 *
 * Delegates to the one team table (`lib/team/teams.ts`), so "JAC", "WSH",
 * "OAK" and "LA" land where they should without this module carrying a mapping
 * of its own. Unknown strings are passed through upper-cased rather than
 * dropped - an unrecognized opponent should still group with itself.
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
  return hasTouch(stats, position);
}

/**
 * A game played, the way a games-played column counts it (2026-11-04).
 *
 * Sleeper logs `gp: 1` for every game a player was active for, snap or no
 * snap - the same count as a reference site's "G" - and that is what the
 * career table has always printed for a finished season. The chart, the
 * career rates and the read were counting only weeks with a touch, which
 * put Gardner Minshew's 2023 at 16 games in one place and 17 in the next on
 * the same page. Everything that prints a games-played figure on the Stats
 * tab goes through this one rule. Rows written before the builder kept
 * `gp` fall back to a touch, so an unrebuilt season still counts.
 */
export function isGamePlayed(entry: { stats: GameLogStats; game_status?: string | null }, position: string | null): boolean {
  if (entry.game_status === "out" || entry.game_status === "bye") return false;
  const gp = (entry.stats as { gp?: number }).gp;
  if (typeof gp === "number") return gp > 0 || hasTouch(entry.stats, position);
  return hasTouch(entry.stats, position);
}

function hasTouch(
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
 * How generous each defense is to each position, ranked 1 (softest) to 32.
 *
 * The game-log fallback for a season the FPA tables do not hold (2024 and
 * earlier; the archive starts at 2025). It is the FPA table's own raw
 * arithmetic (fpa/math.ts computeFpaTable) over the stored weekly logs: for
 * each defense, every point the position scored against it, summed, divided
 * by the games that defense played. A per-game average of TEAM totals - not a
 * season total (a club with a bye still to come would rank softer than it
 * is), and not an average of single player lines (a defense that faced a
 * three-back committee would rank stingier than one that faced a bell cow,
 * which is what this function did before 2026-11-26, WEB-033).
 *
 * **Rank 1 allows the MOST.** Same direction as lib/fpa/fpa-data.ts, and for
 * the same reason it gives: it is the industry convention, and it is what a
 * reader looking for a matchup to attack expects at the top. Ties go to the
 * team code, alphabetically, as on the FPA table (fpa/math.ts rankFpaValues), so the
 * order never depends on the order rows were read in.
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

  // Points allowed per (defense, position), and the weeks each defense played.
  const totals = new Map<string, number>();
  const weeks = new Map<string, Set<number>>();
  for (const [id, entries] of Object.entries(logs)) {
    const pos = infoById.get(id);
    if (!pos) continue;
    for (const entry of entries) {
      if (!hasParticipation(entry.stats, pos)) continue;
      const defense = teamCode(entry.opp);
      if (!defense) continue;
      let played = weeks.get(defense);
      if (!played) {
        played = new Set();
        weeks.set(defense, played);
      }
      played.add(entry.week);
      const key = `${defense}:${pos}`;
      totals.set(key, (totals.get(key) ?? 0) + getEntryPoints(entry.stats, format));
    }
  }

  const byPosition = new Map<string, { team: string; value: number }[]>();
  for (const [key, total] of totals) {
    const [team, pos] = key.split(":");
    const games = weeks.get(team!)?.size || 1;
    const group = byPosition.get(pos!);
    const row = { team: team!, value: total / games };
    if (group) group.push(row);
    else byPosition.set(pos!, [row]);
  }

  const ranks = new Map<string, number>();
  for (const [pos, teams] of byPosition) {
    const order = rankFpaValues(teams);
    teams.forEach((row, i) => ranks.set(`${row.team}:${pos}`, order[i]!));
  }

  oppRanksCache.set(cacheKey, ranks);
  return ranks;
}

/**
 * Opponent ranks from the FPA table - the Fantasy Points Allowed page's own
 * figures (audit WEB-033). Keyed like buildOppRanks(), "DET:RB". Null when
 * the table has no row for the position.
 */
export function fpaOppRanks(
  rows: Array<{ team: { code: string } | null; abbr: string; byPos: Record<string, { rank: number } | undefined> }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const code = row.team?.code ?? teamCode(row.abbr);
    for (const [pos, cell] of Object.entries(row.byPos)) {
      if (cell && Number.isFinite(cell.rank)) out.set(`${code}:${pos}`, cell.rank);
    }
  }
  return out;
}

/**
 * Which table an opponent rank came from:
 *   fpa-current  the live FPA table: today's season-to-date rank, NOT the
 *                rank the defense had before that game was played
 *   fpa-archive  a finished season's FPA archive, weeks 1-17
 *   gamelog      the game-log fallback (buildOppRanks), for a finished
 *                season the FPA archive does not hold; same arithmetic
 *   unavailable  the current season with no FPA table to read: no rank is
 *                printed, never one from a second calculation
 */
export type OppRankSource = "fpa-current" | "fpa-archive" | "gamelog" | "unavailable";

export function attachOppRanks(
  entries: GameLogEntry[],
  position: string | null,
  oppRanks: Map<string, number>,
  source: OppRankSource = "gamelog",
): GameLogEntry[] {
  if (!position) return entries;
  return entries.map((e) => ({
    ...e,
    opp_rank_vs_pos: oppRanks.get(`${teamCode(e.opp)}:${position}`) ?? null,
    opp_rank_source: source,
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
    const current = teamById.get(id);
    const pos = posById.get(id);
    for (const e of entries) {
      // The club he played FOR that week. A player traded in midseason is on
      // his new club's roster now, and crediting his earlier targets to it
      // emptied the old club's weeks: his old teammates read 66.7% of a pool
      // that was really 28.6% theirs (Tyler Warren, IND Week 3, 2026).
      const team = e.team ? teamCode(e.team) : current;
      if (!team || team === "FA") continue;
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
    // Each game against its own club's week: a traded player's earlier games
    // belong to the club he left, not the one he plays for now.
    const tw = agg.get(`${e.team ? teamCode(e.team) : team}_${e.week}`);
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

/* --------------------------------------------------- the season's standings */

/**
 * The four-game minimum on a points-per-game rank.
 *
 * Without it a player who caught two touchdowns in his only appearance
 * finishes as the WR1 for the season, which is arithmetically true and a lie
 * about football. Four is the threshold the profile header's rank cell uses,
 * and this is the constant both sides read so they cannot drift apart.
 */
export const PPG_MIN_GAMES = 4;

/* ------------------------------------------------ the one PPG position rank */

/** One player's line in his position's points-per-game table. */
export interface PpgRankRow {
  id: string;
  /** Season points in the format, over the games below. */
  total: number;
  /** Games he took part in (hasParticipation), which the rate is over. */
  games: number;
  /** total / games, unrounded. */
  ppg: number;
  /** His PPG rank at the position, or null under PPG_MIN_GAMES games. */
  rank: number | null;
}

export interface PpgPositionTable {
  /** The eligible players (PPG_MIN_GAMES+ games), best rate first. */
  ranked: PpgRankRow[];
  /** Every player at the position with a game, eligible or not. */
  byId: Map<string, PpgRankRow>;
  /** The games each of those players took part in. */
  played: Map<string, GameLogEntry[]>;
}

/** A rate as an integer key, so 15 and 30/2 tie and float dust does not split them. */
const ppgKey = (ppg: number): number => Math.round(ppg * 1e6);

const ppgTableCache = new WeakMap<object, WeakMap<object, Map<string, PpgPositionTable>>>();

/**
 * The PPG position rank: the ONE calculation every surface prints (the
 * player header, the peers rail, the player index, the matchup preview),
 * so a player cannot be the WR17 on his page and the WR19 in a preview
 * (2026-11-24: the preview ranked the usage feed's rounded nflverse points
 * over a 2-game minimum while the page ranked these logs over four).
 *
 * The rules, all in here:
 * - Pool: every player whose players.json position is `position`, league-wide,
 *   with at least one game in the season's logs. Nobody is dropped for team,
 *   roster or roster percentage; a surface picks whom to SHOW afterwards.
 * - Games: a game he took part in (hasParticipation), not a roster week.
 * - Points: getEntryPoints() in the format, under the active scoring policy.
 * - Cutoff: whatever the season's game logs hold, the latest data.
 * - Eligibility: PPG_MIN_GAMES games; under that, rank null (the surface's
 *   own "no rank" state), though the row keeps his rate and games.
 * - Order: unrounded rate, best first. Equal rates share the better rank
 *   (15.0, 15.0, 14.9 -> 1, 1, 3); within a tie rows sort by id so the
 *   order is stable.
 *
 * Built once per loaded game-log object, player list, position, format and
 * scoring policy.
 */
export function ppgPositionTable(
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
  position: string,
  format: ScoringFormat,
): PpgPositionTable {
  let byPlayers = ppgTableCache.get(logs);
  if (!byPlayers) ppgTableCache.set(logs, (byPlayers = new WeakMap()));
  let byKey = byPlayers.get(players);
  if (!byKey) byPlayers.set(players, (byKey = new Map()));
  const key = `${position}|${format}|${scoringTotalsSource()}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const atPosition = new Set<string>();
  for (const p of players) if (p.position === position) atPosition.add(p.id);

  const byId = new Map<string, PpgRankRow>();
  const played = new Map<string, GameLogEntry[]>();
  const ranked: PpgRankRow[] = [];
  for (const [id, entries] of Object.entries(logs)) {
    if (!atPosition.has(id)) continue;
    const games = entries.filter((e) => hasParticipation(e.stats, position));
    if (games.length === 0) continue;
    const total = games.reduce((sum, e) => sum + getEntryPoints(e.stats, format), 0);
    const row: PpgRankRow = { id, total, games: games.length, ppg: total / games.length, rank: null };
    byId.set(id, row);
    played.set(id, games);
    if (games.length >= PPG_MIN_GAMES) ranked.push(row);
  }
  ranked.sort((a, b) => ppgKey(b.ppg) - ppgKey(a.ppg) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranked.forEach((row, i) => {
    const prev = ranked[i - 1];
    row.rank = prev && ppgKey(prev.ppg) === ppgKey(row.ppg) ? prev.rank : i + 1;
  });

  const table = { ranked, byId, played };
  byKey.set(key, table);
  return table;
}

/** Where one player stands in his position's table for a season. */
export interface SeasonStanding {
  /** His place in it: 14 for the QB14. */
  rank: number;
  /** The number that put him there - a rate or a total, per `measure`. */
  value: number;
  /** Which of the two tables he came off. */
  measure: "ppg" | "total";
  /** Games he took part in, which is what the rate is over. */
  games: number;
}

export interface SeasonStandings {
  season: number;
  format: ScoringFormat;
  /** The newest week anybody in the league has a logged game for. */
  week: number;
  byId: Map<string, SeasonStanding>;
}

const standingsCache = new Map<string, SeasonStandings>();

/**
 * Every player's positional finish for one season, the whole league at once.
 *
 * The same question positionalFinish() in player-data.ts answers for ONE
 * player, asked once for everybody - because the player index prints six
 * hundred of these and doing it a player at a time would sort the league's
 * points six hundred times over.
 *
 * Both tables are built and the rule for choosing between them is the profile
 * header's, restated here so the index cannot disagree with the page it links
 * to: the rate table when the player is in it, the points table until he is.
 * In September nobody has four games and every standing is a points rank; by
 * October most are rates, and a row says which it is rather than leaving the
 * reader to assume. A player who has not taken part in a game this season is
 * in neither table and gets no standing at all, which is the honest rendering
 * of "he has not played" - not a rank of last.
 */
export function buildSeasonStandings(
  season: number,
  logs: Record<string, GameLogEntry[]>,
  players: Player[],
  format: ScoringFormat,
): SeasonStandings {
  const cacheKey = `${season}_${format}`;
  const hit = standingsCache.get(cacheKey);
  if (hit) return hit;

  const posById = new Map<string, string>();
  for (const p of players) if (p.position) posById.set(p.id, p.position);

  interface Row {
    id: string;
    value: number;
    games: number;
  }

  const byPos = new Map<string, { totals: Row[] }>();
  let week = 0;

  for (const [id, entries] of Object.entries(logs)) {
    const pos = posById.get(id);
    if (!pos) continue;

    let total = 0;
    let games = 0;
    for (const entry of entries) {
      if (entry.week > week) week = entry.week;
      if (!hasParticipation(entry.stats, pos)) continue;
      total += getEntryPoints(entry.stats, format);
      games += 1;
    }
    if (games === 0) continue;

    let tables = byPos.get(pos);
    if (!tables) {
      tables = { totals: [] };
      byPos.set(pos, tables);
    }
    tables.totals.push({ id, value: total, games });
  }

  const byId = new Map<string, SeasonStanding>();

  for (const [pos, tables] of byPos) {
    tables.totals.sort((a, b) => b.value - a.value);

    // Points first, rates second, and the second overwrites: every player who
    // played gets a standing, and the ones who clear the minimum then take
    // their place on the table the page prefers. Written in this order rather
    // than as a conditional per player because the two tables are ranked
    // independently - a player's index in one says nothing about the other.
    tables.totals.forEach((row, i) => {
      byId.set(row.id, {
        rank: i + 1,
        value: row.value,
        measure: "total",
        games: row.games,
      });
    });
    // The rate ranks are the shared PPG table's (ppgPositionTable), the same
    // rank the profile header and the matchup preview print.
    for (const row of ppgPositionTable(logs, players, pos, format).ranked) {
      byId.set(row.id, {
        rank: row.rank!,
        value: row.ppg,
        measure: "ppg",
        games: row.games,
      });
    }
  }

  const standings: SeasonStandings = { season, format, week, byId };
  standingsCache.set(cacheKey, standings);
  return standings;
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
 * game that has not kicked off - and then counts it against them as a game
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

/**
 * The last week anybody in the league has a logged game for, or 0.
 *
 * League-wide rather than per team, which is the difference that matters to
 * the profile header: a club on its bye is a week behind the league, and the
 * header has to know the league has moved on to say whether the bye is next.
 */
export function leagueWeeksLogged(season: number): number {
  const hit = seasonMaxWeekCache.get(season);
  if (hit !== undefined) return hit;
  let max = 0;
  for (const entries of Object.values(loadGameLogs(season))) {
    for (const e of entries) if (e.week > max) max = e.week;
  }
  seasonMaxWeekCache.set(season, max);
  return max;
}

function getSeasonMaxWeek(season: number, team: string | null): number {
  const max = leagueWeeksLogged(season);
  // 18 weeks from 2021, 17 before - a season with no logs yet still shows its
  // full shape rather than collapsing to nothing.
  const fullSeason = season >= 2021 ? 18 : 17;

  /*
   * A season IN PROGRESS is padded only as far as the league has played.
   *
   * Padding it to its full shape is what the rule above does for a finished
   * season, and it is right there: the weeks a player is missing from a
   * completed season are weeks he missed. In September it is a different claim
   * entirely - sixteen rows of "Did not play" under a player who has not missed
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

/**
 * A club's bye: the week its results skip, when the season's results are
 * stored, else the bye table. The results come first because the table has
 * been wrong (2024 Raiders filed as Week 11, played every week but Week 10)
 * and a week with no game between two played weeks is not a judgment call.
 * The first gap only: a club has one bye, and a gap after its last stored
 * result is the season still being played.
 */
function getByeWeek(season: number, team: string | null): number | null {
  if (!team) return null;
  const code = teamCode(team);
  const scores = loadGameScores()[String(season)];
  if (scores) {
    const weeks = new Set<number>();
    for (const key of Object.keys(scores)) {
      const m = /^([A-Z]+)_(\d+)$/.exec(key);
      if (m && m[1] === code) weeks.add(Number(m[2]));
    }
    if (weeks.size >= 2) {
      const last = Math.max(...weeks);
      for (let w = 1; w < last; w += 1) if (!weeks.has(w)) return w;
    }
  }
  return loadByeWeeks()[String(season)]?.[code] ?? null;
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
 * page - a bye is nothing, five straight "out" weeks is the story - so they are
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
      opp: isBye ? "BYE" : "-",
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
      // The score of the club he played for that week: after a trade the
      // season team's result is somebody else's game (Josh Downs, KC Week 10,
      // 2026, read IND's "W 24-22" instead of KC's 35-13).
      score:
        status === "active"
          ? (entry.score ??
            getGameScore(season, entry.team ? teamCode(entry.team) : team, entry.week))
          : (entry.score ?? null),
    };
  });
}

/** Drops the per-season derived tables. Used by the tests. */
export function resetRankCaches(): void {
  weeklyRanksCache.clear();
  standingsCache.clear();
  oppRanksCache.clear();
  teamAggCache.clear();
  seasonMaxWeekCache.clear();
  teamMaxWeekCache.clear();
}
