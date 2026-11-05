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
 *   - the player's own row of the team usage report (data/team/usage_<season>.json:
 *     xFP, FPOE, target share, first-read share, snaps), his trends, and his
 *     rank on each among the qualified players at his position league-wide;
 *   - his rank on the rest-of-season board (data/rankings/ros-<season>.csv).
 *
 * Every function returns null when its file has nothing for him; the tab
 * leaves the section out rather than guessing.
 */

import { loadDepthCharts, loadGameLogs } from "./data";
import type { Player } from "./types";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { getUsageDoc, trend, type Trend, type UsagePlayer } from "../team/usage";
import { getRankings, normalizeName } from "../rankings/rankings-data";
import { minGames } from "./outlook-tab-data";

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
  /** Rank among the qualified players at his position league-wide, per metric. */
  ranks: Partial<Record<UsageMetric, { rank: number; of: number }>>;
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
 * The player's row of the usage report, with his league ranks.
 *
 * The field for a rank is every player at his position, on any club, who
 * qualifies for the report and has at least the Outlook's games threshold -
 * so a WR's "10th of 96" here and the drivers' "10th of 116" (a different
 * table, a different threshold) are both true and both labelled.
 */
export function playerUsage(player: Player, team: NflTeam | null, season: number): PlayerUsage | null {
  if (!team || !player.position) return null;
  const doc = getUsageDoc(season);
  if (!doc || doc.throughWeek < 1) return null;
  const code = Object.keys(doc.teams).find((k) => getTeamByAbbreviation(k)?.slug === team.slug);
  const club = code ? doc.teams[code] : undefined;
  if (!club) return null;
  const row = club.players.find((p) => p.sleeperId === player.id || (p.slug && p.slug === player.slug));
  if (!row || row.games < 1) return null;

  const through = club.games.length ? Math.max(...club.games) : doc.throughWeek;
  const min = minGames(doc.throughWeek);
  const field = Object.values(doc.teams)
    .flatMap((t) => t.players)
    .filter((p) => p.pos === row.pos && p.qualified && p.games >= min);
  const ranks: PlayerUsage["ranks"] = {};
  for (const metric of USAGE_RANKED) {
    const mine = row[metric];
    if (!finite(mine)) continue;
    const values = field.map((p) => p[metric]).filter(finite).sort((a, b) => b - a);
    if (!values.length || !(row.qualified && row.games >= min)) continue;
    ranks[metric] = { rank: values.findIndex((v) => v <= mine) + 1 || values.length, of: values.length };
  }

  const rzMax = club.players.reduce((m, p) => Math.max(m, p.rzTouches), 0);
  const rzLeaders = club.players.filter((p) => p.rzTouches === rzMax).length;
  const aheadOfHim =
    row.pos === "WR" || row.pos === "TE"
      ? club.players
          .filter((p) => p.pos === row.pos && p !== row && (p.targetShare ?? 0) > (row.targetShare ?? 0))
          .sort((a, b) => (b.targetShare ?? 0) - (a.targetShare ?? 0))
          .map((p) => p.name)
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
    leadsRz: rzMax > 0 && row.rzTouches === rzMax,
    rzCoLead: rzMax > 0 && row.rzTouches === rzMax && rzLeaders > 1,
    aheadOfHim,
  };
}

/* ------------------------------------------------------------- ROS board */

export interface RosRank {
  rank: number;
  position: string;
  /** "October 22, 2026", as the board's meta names it. */
  updatedAt: string;
  updatedAtIso: string | null;
}

/** His positional rank on the rest-of-season board, by slug and then by name. */
export function rosRank(player: Player, season: number): RosRank | null {
  const pos = player.position;
  if (!pos) return null;
  const board = getRankings(season, "ros");
  if (!board) return null;
  const rows = board.byPosition[pos as keyof typeof board.byPosition]?.flatMap((g) => g.players) ?? [];
  const key = normalizeName(player.name);
  const hit = rows.find((r) => r.slug === player.slug) ?? rows.find((r) => normalizeName(r.name) === key);
  if (!hit) return null;
  return { rank: hit.rank, position: pos, updatedAt: board.updatedAt, updatedAtIso: board.updatedAtIso };
}
