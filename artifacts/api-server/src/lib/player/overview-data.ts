/**
 * The data the Overview tab's lower sections read and nothing else does.
 *
 * Four things, all derived from files already on disk: the efficiency meters
 * (percentiles against the position, from the season's game logs), the
 * teammates the written read names, the depth-chart role the sidebar and the
 * outlook card print, and the club a player was with in each season.
 *
 * The meters are NOT lib/player/benchmarks.ts. Those four readings are the
 * receiving line for every position - yards per catch for a running back -
 * which is the right frame for the Stats tab's efficiency rows and the wrong
 * one for a meter labeled "yards per carry". These are per position, and
 * where a metric the spec names needs data the logs do not carry (routes, yards
 * after contact, sacks), the nearest one they do carry stands in, under its own
 * honest label.
 */

import { getEntryPoints, type ScoringFormat } from "./scoring";
import { hasParticipation, leagueWeeksLogged, teamCode } from "./ranks";
import { loadDepthCharts, loadGameLogs, loadIndexedSlugs } from "./data";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { GameLogStats, Player } from "./types";

/* ------------------------------------------------------------------ meters */

export interface OverviewMeter {
  key: string;
  label: string;
  /** Printed beside the label: "64.1%", "7.2". */
  value: string;
  /** 0–100: the share of qualified players at the position below this one. */
  percentile: number;
}

export interface OverviewMeters {
  position: string;
  season: number;
  /** The volume a player needs to be ranked, and what it is counted in. */
  threshold: number;
  unit: string;
  /** How many players qualified - the population the percentiles are out of. */
  qualified: number;
  /** Null when the player is below the threshold: the section is hidden. */
  meters: OverviewMeter[] | null;
}

interface Totals {
  att: number;
  cmp: number;
  passYd: number;
  passTd: number;
  rushAtt: number;
  rushYd: number;
  tgt: number;
  rec: number;
  recYd: number;
  teamTgt: number;
  pts: number;
}

const ZERO: Totals = {
  att: 0, cmp: 0, passYd: 0, passTd: 0, rushAtt: 0, rushYd: 0,
  tgt: 0, rec: 0, recYd: 0, teamTgt: 0, pts: 0,
};

interface MetricDef {
  key: string;
  label: string;
  of: (t: Totals) => number | null;
  print: (v: number) => string;
}

const pctOf = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
const per = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const pct1 = (v: number): string => `${v.toFixed(1)}%`;
const dec = (digits: number) => (v: number): string => v.toFixed(digits);

/**
 * The four meters per position, and the volume that qualifies a player.
 *
 * `perWeek` is scaled by the weeks the league has logged, so the bar is the
 * same share of a season in Week 3 as in Week 17 - a flat 30 targets would
 * rank six receivers in September and every one of them in December.
 */
const METERS: Record<string, { unit: string; perWeek: number; volume: (t: Totals) => number; defs: MetricDef[] }> = {
  QB: {
    unit: "pass attempts",
    perWeek: 15,
    volume: (t) => t.att,
    defs: [
      { key: "cmp", label: "Completion rate", of: (t) => pctOf(t.cmp, t.att), print: pct1 },
      { key: "ypa", label: "Yards per attempt", of: (t) => per(t.passYd, t.att), print: dec(1) },
      { key: "tdr", label: "TD rate", of: (t) => pctOf(t.passTd, t.att), print: pct1 },
      // Dropbacks need sacks and scrambles, which the logs do not carry. Every
      // pass and every carry is the nearest count they do.
      { key: "ppp", label: "Fantasy points per play", of: (t) => per(t.pts, t.att + t.rushAtt), print: dec(2) },
    ],
  },
  RB: {
    unit: "carries and targets",
    perWeek: 6,
    volume: (t) => t.rushAtt + t.tgt,
    defs: [
      { key: "ypc", label: "Yards per carry", of: (t) => per(t.rushYd, t.rushAtt), print: dec(1) },
      // Yards after contact is not in the logs; yards per touch is the nearest
      // reading of what a back does with the ball once he has it.
      { key: "ypt", label: "Yards per touch", of: (t) => per(t.rushYd + t.recYd, t.rushAtt + t.rec), print: dec(1) },
      { key: "tsh", label: "Target share", of: (t) => pctOf(t.tgt, t.teamTgt), print: pct1 },
      { key: "ppo", label: "Fantasy points per opportunity", of: (t) => per(t.pts, t.rushAtt + t.tgt), print: dec(2) },
    ],
  },
  WR: {
    unit: "targets",
    perWeek: 3,
    volume: (t) => t.tgt,
    defs: [
      { key: "tsh", label: "Target share", of: (t) => pctOf(t.tgt, t.teamTgt), print: pct1 },
      // Routes are not in the logs, so yards per route run cannot be; yards per
      // target is the same question asked of the looks he actually got.
      { key: "ypt", label: "Yards per target", of: (t) => per(t.recYd, t.tgt), print: dec(1) },
      { key: "ctc", label: "Catch rate", of: (t) => pctOf(t.rec, t.tgt), print: pct1 },
      { key: "ppt", label: "Fantasy points per target", of: (t) => per(t.pts, t.tgt), print: dec(2) },
    ],
  },
};
METERS["TE"] = { ...METERS["WR"]!, perWeek: 2 };

const n = (stats: GameLogStats, key: keyof GameLogStats): number => {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/** Every player's season totals at one position, and each club's weekly targets. */
const seasonCache = new Map<string, Map<string, Totals>>();

function positionTotals(
  season: number,
  position: string,
  format: ScoringFormat,
  positionById: Map<string, string | null>,
): Map<string, Totals> {
  const key = `${season}|${position}|${format}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;

  const logs = loadGameLogs(season);

  // The club's targets each week: the denominator of a target share.
  const teamTargets = new Map<string, number>();
  for (const entries of Object.values(logs)) {
    for (const e of entries) {
      if (!e.team) continue;
      const k = `${teamCode(e.team)}_${e.week}`;
      teamTargets.set(k, (teamTargets.get(k) ?? 0) + n(e.stats, "rec_tgt"));
    }
  }

  const out = new Map<string, Totals>();
  for (const [id, entries] of Object.entries(logs)) {
    if (positionById.get(id) !== position) continue;
    const t: Totals = { ...ZERO };
    for (const e of entries) {
      if (!hasParticipation(e.stats, position)) continue;
      t.att += n(e.stats, "pass_att");
      t.cmp += n(e.stats, "pass_cmp");
      t.passYd += n(e.stats, "pass_yd");
      t.passTd += n(e.stats, "pass_td");
      t.rushAtt += n(e.stats, "rush_att");
      t.rushYd += n(e.stats, "rush_yd");
      t.tgt += n(e.stats, "rec_tgt");
      t.rec += n(e.stats, "rec");
      t.recYd += n(e.stats, "rec_yd");
      t.pts += getEntryPoints(e.stats, format);
      if (e.team) t.teamTgt += teamTargets.get(`${teamCode(e.team)}_${e.week}`) ?? 0;
    }
    out.set(id, t);
  }
  seasonCache.set(key, out);
  return out;
}

export function overviewMeters(
  player: Player,
  season: number,
  format: ScoringFormat,
  allPlayers: Player[],
): OverviewMeters | null {
  const position = player.position ?? "";
  const spec = METERS[position];
  if (!spec) return null;

  const weeks = Math.max(1, Math.min(18, leagueWeeksLogged(season) || 18));
  const threshold = Math.round(spec.perWeek * weeks);
  const positionById = new Map(allPlayers.map((p) => [p.id, p.position]));
  const totals = positionTotals(season, position, format, positionById);

  const qualified = [...totals.values()].filter((t) => spec.volume(t) >= threshold);
  const own = totals.get(player.id);
  const base = { position, season, threshold, unit: spec.unit, qualified: qualified.length };
  if (!own || spec.volume(own) < threshold || qualified.length < 5) {
    return { ...base, meters: null };
  }

  const meters: OverviewMeter[] = [];
  for (const def of spec.defs) {
    const value = def.of(own);
    if (value === null) continue;
    const pool = qualified.map(def.of).filter((v): v is number => v !== null);
    const below = pool.filter((v) => v < value).length;
    meters.push({
      key: def.key,
      label: def.label,
      value: def.print(value),
      percentile: Math.round((below / pool.length) * 100),
    });
  }
  return { ...base, meters: meters.length >= 2 ? meters : null };
}

/* --------------------------------------------------------------- teammates */

export interface Teammate {
  name: string;
  /** Null for a teammate with no page of his own, who is named but not linked. */
  slug: string | null;
  position: string;
}

/**
 * Who the written read names beside him.
 *
 * A quarterback's two most-targeted pass catchers; anyone else's quarterback,
 * by pass attempts. Counted only in games on his current club, so a receiver
 * traded in October names the passer he has now.
 */
export function overviewTeammates(
  player: Player,
  season: number,
  allPlayers: Player[],
): Teammate[] {
  const logs = loadGameLogs(season);
  const mine = logs[player.id] ?? [];
  const club = [...mine].reverse().find((e) => e.team)?.team;
  if (!club) return [];
  const code = teamCode(club);

  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const indexed = new Set(loadIndexedSlugs());
  const isQB = player.position === "QB";

  const score = new Map<string, number>();
  for (const [id, entries] of Object.entries(logs)) {
    if (id === player.id) continue;
    const other = byId.get(id);
    if (!other?.position) continue;
    const wanted = isQB ? ["WR", "TE", "RB"].includes(other.position) : other.position === "QB";
    if (!wanted) continue;
    for (const e of entries) {
      if (!e.team || teamCode(e.team) !== code) continue;
      score.set(id, (score.get(id) ?? 0) + n(e.stats, isQB ? "rec_tgt" : "pass_att"));
    }
  }

  return [...score.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, isQB ? 2 : 1)
    .map(([id]) => {
      const p = byId.get(id)!;
      return { name: p.name, slug: indexed.has(p.slug) ? p.slug : null, position: p.position ?? "" };
    });
}

/* ------------------------------------------------------------- depth chart */

export interface DepthRole {
  /** "QB", "WR" - the fantasy position the chart files him under. */
  position: string;
  /** 1 for the starter. */
  order: number;
  /** The next name down at the same spot, for the outlook card. */
  next: { name: string; slug: string | null } | null;
}

/** His spot on his club's depth chart, or null when the chart does not list him. */
export function depthRole(player: Player, team: NflTeam | null): DepthRole | null {
  if (!team) return null;
  const teams = loadDepthCharts().teams ?? {};
  const key = Object.keys(teams).find((k) => getTeamByAbbreviation(k)?.slug === team.slug);
  const groups = key ? teams[key] ?? [] : [];
  const indexed = new Set(loadIndexedSlugs());

  for (const group of groups) {
    const players = [...group.players].sort((a, b) => a.depth_order - b.depth_order);
    const i = players.findIndex(
      (p) => p.sleeper_id === player.id || (p.sleeper_slug && p.sleeper_slug === player.slug),
    );
    if (i === -1) continue;
    const after = players[i + 1];
    return {
      position: group.fantasy_position || group.role,
      order: players[i]!.depth_order,
      next: after
        ? { name: after.name, slug: after.sleeper_slug && indexed.has(after.sleeper_slug) ? after.sleeper_slug : null }
        : null,
    };
  }
  return null;
}

/* ------------------------------------------------------------ season clubs */

/**
 * The clubs he played for in each season, in the order he played for them.
 *
 * Read off the weekly logs rather than the dictionary, which only knows where
 * he is now - so a mid-season trade prints as "ARI/NYJ" on its season row.
 */
export function seasonClubs(playerId: string, seasons: number[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const season of seasons) {
    const entries = [...(loadGameLogs(season)[playerId] ?? [])].sort((a, b) => a.week - b.week);
    const clubs: string[] = [];
    for (const e of entries) {
      if (!e.team) continue;
      const code = getTeamByAbbreviation(e.team)?.code ?? e.team.toUpperCase();
      if (!clubs.includes(code)) clubs.push(code);
    }
    if (clubs.length) out[season] = clubs;
  }
  return out;
}
