/**
 * What the Outlook tab needs to look FORWARD, gathered in one place (the
 * reviewer's brief mak forwarded on 2026-11-05: "give the Outlook generator a
 * shared, validated data snapshot containing current role, production,
 * opportunity metrics, schedule, depth chart").
 *
 *   - the club's listed starting quarterback, from the depth chart, with the
 *     passes he has thrown this season - so a receiver's page names the man
 *     under center NOW, and knows when he is not the one who threw most of the
 *     season (Minshew for Brissett, 2026-11-02);
 *   - the player's season in the team usage report (data/team/usage_<season>.json:
 *     xFP, FPOE, target share, first-read share, snaps), every club summed
 *     under the player pages' one share definition (usage-share.ts), his
 *     trends, and his rank on each among the qualified players at his
 *     position league-wide;
 *   - his rank on the rest-of-season board (data/rankings/ros-<season>.csv).
 *
 * Every function returns null when its file has nothing for him; the tab
 * leaves the section out rather than guessing.
 */

import { loadDepthCharts, loadGameLogs, loadPlayers } from "./data";
import { computeGameLogStats } from "./metrics";
import type { Player } from "./types";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { getUsageDoc, trend, type Trend, type UsagePlayer } from "../team/usage";
import { getRankings, normalizeName } from "../rankings/rankings-data";
import { minGames } from "./outlook-tab-data";
import { playedSeasonRow, playedSeasonRows, type PlayedSeasonRow } from "../team/usage-share";

/* ------------------------------------------------------------ the passer */

export interface StartingQb {
  name: string;
  /** His page's slug when he has one; the chart's slug otherwise, unverified. */
  slug: string | null;
  /** Pass attempts for this club this season, from the weekly logs. */
  attempts: number;
  /** The last week he threw a pass for the club; null when he has not. */
  lastWeek: number | null;
}

/**
 * The listed QB1 on the player's club, from the depth-chart file (ourlads,
 * refreshed by the snapshot script). Null for a quarterback's own page, or a
 * club the file does not list.
 */
export function startingQb(player: Player, team: NflTeam | null, season: number, allPlayers: readonly Player[] = []): StartingQb | null {
  if (!team || player.position === "QB") return null;
  const teams = loadDepthCharts().teams ?? {};
  const key = Object.keys(teams).find((k) => getTeamByAbbreviation(k)?.slug === team.slug);
  const groups = key ? teams[key] ?? [] : [];
  const qbs = groups.find((g) => (g.fantasy_position || g.role) === "QB");
  if (!qbs) return null;
  const first = [...qbs.players].sort((a, b) => a.depth_order - b.depth_order)[0];
  if (!first) return null;
  // The dictionary's spelling when the chart carries his Sleeper id ("Michael
  // Penix JR." on the chart, "Michael Penix Jr." everywhere else).
  const known = first.sleeper_id ? allPlayers.find((p) => p.id === first.sleeper_id) : undefined;
  const logs = first.sleeper_id ? loadGameLogs(season)[first.sleeper_id] ?? [] : [];
  const code = team.code.toUpperCase();
  let attempts = 0;
  let lastWeek: number | null = null;
  for (const e of logs) {
    if (!e.team || (getTeamByAbbreviation(e.team)?.code ?? e.team.toUpperCase()) !== code) continue;
    const att = typeof e.stats?.pass_att === "number" ? e.stats.pass_att : 0;
    if (att <= 0) continue;
    attempts += att;
    if (lastWeek === null || e.week > lastWeek) lastWeek = e.week;
  }
  return { name: known?.name ?? first.name, slug: known?.slug ?? first.sleeper_slug ?? null, attempts, lastWeek };
}

/** The same man under two spellings: case, punctuation and suffixes aside. */
export function samePerson(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/* ----------------------------------------------------------------- usage */

/** The metrics the Outlook ranks league-wide, all read higher-is-better. */
export const USAGE_RANKED = [
  "xfpPerGame",
  "fpoePerGame",
  "firstReadShare",
  "targetShare",
  "airYardsShare",
  "woppPerGame",
  "snapShare",
] as const;
export type UsageMetric = (typeof USAGE_RANKED)[number];

export interface PlayerUsage {
  season: number;
  /** The club's last week in the report. */
  throughWeek: number;
  builtAt: string;
  teamCode: string;
  row: UsagePlayer;
  /** Target-share and snap-share trends: last three games against the three before. */
  ts: Trend;
  snap: Trend;
  /**
   * Rank among the qualified players at his position league-wide, per metric,
   * and his percentile in the same field (the share of the OTHER qualified
   * players he is above: the Stats card's rule). This field is THE
   * comparison for a share metric on every player component (WEB-035).
   */
  ranks: Partial<Record<UsageMetric, { rank: number; of: number; pct: number }>>;
  /** Who the field is, in words: "6+ games and 1.5+ targets per team game". */
  fieldNote: string;
  /** He leads (or co-leads) his club in red-zone touches. */
  leadsRz: boolean;
  rzCoLead: boolean;
  /** Teammates at his position with a bigger target share, by name. */
  aheadOfHim: string[];
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The player's season in the usage report, with his league ranks.
 *
 * One definition with the Overview meter and the Stats card (mak,
 * 2026-11-20): `row` is his season at EVERY club, from usage-share.ts
 * playedSeasonRow() - target share and snap share over the games he played,
 * counts summed, per-game rates weighted by his games at each club - so a
 * player traded last week is not read off his one-game row for the new club.
 * Points per game are the player header's: his PPR points over his games
 * played in the game logs (metrics.ts computeGameLogStats), and FPOE is
 * those points less his expected points, so the tiles add up.
 *
 * The field for a rank is one entry per player at his position, every club
 * summed the same way, who qualifies under the report's own rule and has at
 * least the Outlook's games threshold - the same field the drivers' Target
 * share row uses.
 *
 * Club-relative readings stay with his current club: the red-zone lead and
 * the red-zone touches printed beside it, and the teammates ahead of him.
 */
export function playerUsage(player: Player, team: NflTeam | null, season: number): PlayerUsage | null {
  if (!team || !player.position) return null;
  const doc = getUsageDoc(season);
  if (!doc || doc.throughWeek < 1) return null;
  const code = Object.keys(doc.teams).find((k) => getTeamByAbbreviation(k)?.slug === team.slug);
  const club = code ? doc.teams[code] : undefined;
  if (!club) return null;
  // His row for the club he is on now; none when he has not played for it
  // yet (signed or traded since his last game), and his season is still his.
  const clubRow = club.players.find((p) => p.sleeperId === player.id || (p.slug && p.slug === player.slug)) ?? null;
  const season_ = playedSeasonRow(season, { id: clubRow?.sleeperId ?? player.id, slug: clubRow?.slug ?? player.slug });
  if (!season_ || season_.row.games < 1) return null;
  const min = minGames(doc.throughWeek);
  const ppg = headerPpg(season);
  const withPoints = (r: PlayedSeasonRow): UsagePlayer => {
    const pts = r.row.sleeperId ? ppg.get(r.row.sleeperId) : undefined;
    if (pts === undefined || !finite(r.row.xfpPerGame)) return r.row;
    // FPOE off the printed figures, so the three tiles subtract cleanly.
    const shown = Number(pts.toFixed(1));
    return { ...r.row, fpPerGame: pts, fpoePerGame: Math.round((shown - r.row.xfpPerGame) * 10) / 10 };
  };
  // His club's red-zone touches, not the season sum: the sentence beside it names the club.
  const row: UsagePlayer = { ...withPoints(season_), rzTouches: clubRow?.rzTouches ?? 0 };

  const through = club.games.length ? Math.max(...club.games) : doc.throughWeek;
  const inField = (r: PlayedSeasonRow) => r.qualified && r.row.games >= min;
  const field = playedSeasonRows(season, row.pos).filter(inField).map(withPoints);
  const ranks: PlayerUsage["ranks"] = {};
  if (inField(season_)) {
    for (const metric of USAGE_RANKED) {
      const mine = row[metric];
      if (!finite(mine)) continue;
      const values = field.map((p) => p[metric]).filter(finite).sort((a, b) => b - a);
      if (!values.length) continue;
      const others = values.length - 1;
      const below = values.filter((v) => v < mine).length;
      ranks[metric] = {
        rank: values.findIndex((v) => v <= mine) + 1 || values.length,
        of: values.length,
        pct: others > 0 ? Math.round((below / others) * 100) : 100,
      };
    }
  }

  const rzMax = club.players.reduce((m, p) => Math.max(m, p.rzTouches), 0);
  const rzLeaders = club.players.filter((p) => p.rzTouches === rzMax).length;
  // Teammates on his club now with a bigger target share under the same
  // definition, among the players who would be ranked (one big game on a
  // short sample does not put a man ahead of him).
  const aheadOfHim =
    row.pos === "WR" || row.pos === "TE"
      ? club.players
          .filter((p) => p.pos === row.pos && p !== clubRow && p.sleeperId !== row.sleeperId)
          .map((p) => playedSeasonRow(season, { id: p.sleeperId, slug: p.slug }))
          .filter((p): p is PlayedSeasonRow => p !== null && inField(p) && (p.row.targetShare ?? 0) > (row.targetShare ?? 0))
          .sort((a, b) => (b.row.targetShare ?? 0) - (a.row.targetShare ?? 0))
          .map((p) => p.row.name)
      : [];

  return {
    season: doc.season,
    throughWeek: through,
    builtAt: doc.builtAt,
    teamCode: code!,
    row,
    ts: trend(row.weekly, "ts"),
    snap: trend(row.weekly, "snap"),
    ranks,
    fieldNote: usageFieldNote(row.pos, min),
    leadsRz: rzMax > 0 && clubRow?.rzTouches === rzMax,
    rzCoLead: rzMax > 0 && clubRow?.rzTouches === rzMax && rzLeaders > 1,
    aheadOfHim,
  };
}

/**
 * The usage field's qualification in words: the games threshold plus the
 * report's own volume rule (usage-share.ts mergeRows), per team game.
 */
export function usageFieldNote(pos: string, minGames: number): string {
  const volume = pos === "QB" ? "12+ dropbacks" : pos === "RB" ? "5+ weighted opportunities" : "1.5+ targets";
  return `${minGames}+ games and ${volume} per team game`;
}

const ppgCache = new WeakMap<object, Map<string, number>>();

/**
 * Every player's PPR points per game this season, the header's figure
 * (header.ts headerBoard: computeGameLogStats over his game log, PPR), by
 * Sleeper id. Cached per game-log snapshot (loadGameLogs returns the same
 * object until the logs are reloaded).
 */
function headerPpg(season: number): Map<string, number> {
  const logs = loadGameLogs(season);
  const hit = ppgCache.get(logs);
  if (hit) return hit;
  const positions = new Map(loadPlayers().map((p) => [p.id, p.position ?? null]));
  const out = new Map<string, number>();
  for (const [id, entries] of Object.entries(logs)) {
    const s = computeGameLogStats(entries, positions.get(id) ?? null, "ppr");
    if (s && s.gamesPlayed > 0) out.set(id, s.ppg);
  }
  ppgCache.set(logs, out);
  return out;
}

/* ------------------------------------------------------------- ROS board */

export interface RosRank {
  rank: number;
  position: string;
  /** "October 22, 2026", as the board's meta names it. */
  updatedAt: string;
  updatedAtIso: string | null;
  /**
   * Too old to drive current advice (audit WEB-034, 2026-11-18: the board was
   * last updated October 22 and still set the Outlook's league-fit chips).
   * In season, older than ROS_STALE_DAYS, or with no date at all.
   */
  stale: boolean;
}

/** In season, a rest-of-season board older than this is not current advice. */
export const ROS_STALE_DAYS = 7;

/** Is a board updated at `iso` stale at `now`? No date is stale: it cannot be shown to be current. */
export function rosBoardStale(iso: string | null, now: number, inSeason: boolean): boolean {
  if (!inSeason) return false;
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return true;
  return now - at > ROS_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/** His positional rank on the rest-of-season board, by slug and then by name. */
export function rosRank(
  player: Player,
  season: number,
  options: { now?: number; inSeason?: boolean } = {},
): RosRank | null {
  const pos = player.position;
  if (!pos) return null;
  const board = getRankings(season, "ros");
  if (!board) return null;
  const rows = board.byPosition[pos as keyof typeof board.byPosition]?.flatMap((g) => g.players) ?? [];
  const key = normalizeName(player.name);
  const hit = rows.find((r) => r.slug === player.slug) ?? rows.find((r) => normalizeName(r.name) === key);
  if (!hit) return null;
  return {
    rank: hit.rank,
    position: pos,
    updatedAt: board.updatedAt,
    updatedAtIso: board.updatedAtIso,
    stale: rosBoardStale(board.updatedAtIso, options.now ?? Date.now(), options.inSeason ?? true),
  };
}
