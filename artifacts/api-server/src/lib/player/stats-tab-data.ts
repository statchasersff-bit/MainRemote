/**
 * The data behind the Stats tab's lower sections (./stats-tab.ts), to mak's
 * spec of 2026-09-29.
 *
 * Two things the rest of player-data does not already hold:
 *
 *   - the two advanced cards: this season's table from `data/player-stats/`
 *     (the one built weekly from nflverse, see buildSeason.mjs) and last
 *     season's from `data/player/advanced_stats/` (the player pages' own copy,
 *     cut to weeks 1-17). Each metric carries where the player stands among
 *     the QUALIFIED players at his position, using the same qualifiers the
 *     advanced stats tool opens on, shrunk by the share of the season played;
 *   - every season's weekly log (built in player-data's career loop), which
 *     the career chart, table, rates and highs are all summed from.
 *
 * The spec's tracking metrics that no file here has (NGS separation, cushion,
 * rush yards over expected, eight-man boxes, tight-window rate) are replaced
 * by the nearest metric the tables do have, and labelled as what they are.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { defaultThresholds, passesThresholds, type StatsPosition } from "../player-stats/stats-data";
import { loadAdvancedStats, type CollegeProfile } from "./data";
import type { GameLogEntry } from "./types";

/** One season of weekly games, for the career sections. */
export interface LogSeason {
  season: number;
  /** Games he played, in week order, each with its weekly positional rank. */
  weeks: GameLogEntry[];
  /** Season rank among his position by total points, when there is one. */
  finish: number | null;
}

export type Standing = "good" | "mid" | "bad" | "muted";

export interface AdvMetric {
  label: string;
  /** The figure as printed, or "-". */
  value: string;
  /** The line under it: a rank, a percentile or a plain read. */
  read: string;
  standing: Standing;
  /** Where he stands among the qualified, 0-100, on the metric's own direction. Null when unranked. */
  pct: number | null;
  /** The metric's key, which lines rows up across seasons in the advanced table. */
  key?: string;
  /**
   * The percentile the advanced table prints: `pct`, or for a style reading
   * (time to throw, depth) the share of the qualified he is above, which is
   * neither good nor bad and so is not a `pct`.
   */
  pctl?: number | null;
}

export interface AdvCard {
  season: number;
  /** The week the table runs through, for a season in progress. */
  throughWeek: number | null;
  inProgress: boolean;
  games: number;
  qualified: boolean;
  qualifiedCount: number;
  metrics: AdvMetric[];
  /**
   * Every metric either season's card carries, in one order, so the advanced
   * table can print the seasons side by side. `metrics` stays the card's own
   * six, which the prose reads.
   */
  all: AdvMetric[];
  /** The raw row, for the lede and the fantasy note. */
  row: Record<string, unknown>;
  /** Percentile per metric key, for the lede and the fantasy note. */
  pct: Record<string, number | null>;
}

interface Table {
  season?: number;
  week?: number;
  weeks?: string;
  inProgress?: boolean;
  rows?: Record<string, unknown>[];
}

/* ------------------------------------------------------------ reading */

const tableCache = new Map<string, Table | null>();

/** This season's table, from the advanced stats tool's weekly build. */
function loadToolTable(pos: string, season: number): Table | null {
  const key = `${pos}_${season}`;
  if (tableCache.has(key)) return tableCache.get(key)!;
  let table: Table | null = null;
  try {
    const file = path.join(dataPath("player-stats"), `${key}.json`);
    table = JSON.parse(fs.readFileSync(file, "utf8").replace(/:\s*NaN\b/g, ": null")) as Table;
  } catch {
    table = null;
  }
  tableCache.set(key, table);
  return table;
}

export function resetStatsTabCaches(): void {
  tableCache.clear();
}

/* ------------------------------------------------------------ metrics */

type Row = Record<string, unknown>;

const num = (row: Row, key: string): number | null => {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const ratio = (a: number | null, b: number | null, times = 1): number | null =>
  a !== null && b !== null && b > 0 ? (a / b) * times : null;

interface MetricDef {
  key: string;
  label: string;
  /** The figure off a row, or null when the row has none. */
  of: (row: Row) => number | null;
  fmt: (v: number) => string;
  /** How the line under the figure reads. */
  kind: "rank" | "pct" | "style";
  lowerIsBetter?: boolean;
  /** For a "style" metric: what a high percentile means in words. */
  more?: string;
  /** A stat printed beside the figure, e.g. sacks with a pressure rate. */
  extra?: (row: Row) => string | null;
}

const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);
const pc = (v: number): string => `${v.toFixed(1)}%`;
const signed = (v: number): string => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;
const signed1 = (v: number): string => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}`;
const int = (v: number): string => String(Math.round(v));

const perGame = (key: string) => (row: Row): number | null => ratio(num(row, key), num(row, "games"));

/** The first of several definitions this table can fill. */
function firstOf(defs: MetricDef[], rows: Row[]): MetricDef {
  return defs.find((d) => rows.some((r) => d.of(r) !== null)) ?? defs[defs.length - 1]!;
}

function currentDefs(pos: string, rows: Row[]): MetricDef[] {
  if (pos === "QB") {
    return [
      { key: "epa", label: "EPA per play", of: (r) => num(r, "epaPerPlay"), fmt: signed, kind: "rank" },
      { key: "success", label: "Success rate", of: (r) => num(r, "successRate"), fmt: pc, kind: "rank" },
      { key: "cmp", label: "Completion rate", of: (r) => num(r, "completionPct"), fmt: pc, kind: "pct" },
      { key: "ypa", label: "Yards per attempt", of: (r) => ratio(num(r, "passingYards"), num(r, "attempts")), fmt: f1, kind: "pct" },
      { key: "tdr", label: "TD rate", of: (r) => ratio(num(r, "passingTouchdowns"), num(r, "attempts"), 100), fmt: pc, kind: "pct" },
      { key: "apg", label: "Pass attempts per game", of: perGame("attempts"), fmt: f1, kind: "pct" },
    ];
  }
  if (pos === "RB") {
    return [
      { key: "yaco", label: "Yards after contact per carry", of: (r) => num(r, "yardsAfterContactPerAttempt"), fmt: f2, kind: "pct" },
      // No rush success rate in the feed: the share of carries that went 10+.
      { key: "expl", label: "Explosive run rate", of: (r) => num(r, "explosiveRunPct"), fmt: pc, kind: "pct" },
      { key: "snap", label: "Snap share", of: (r) => num(r, "snapPct"), fmt: pc, kind: "pct" },
      { key: "tgts", label: "Target share", of: (r) => num(r, "targetSharePct"), fmt: pc, kind: "pct" },
      { key: "rzo", label: "Red-zone opportunities", of: (r) => num(r, "redZoneOpportunities"), fmt: int, kind: "pct" },
      {
        key: "ppo", label: "Fantasy points per opportunity",
        of: (r) => ratio(num(r, "fantasyPoints"), (num(r, "rushAttempts") ?? 0) + (num(r, "targets") ?? 0)),
        fmt: f2, kind: "pct",
      },
    ];
  }
  return [
    { key: "tgts", label: "Target share", of: (r) => num(r, "targetSharePct"), fmt: pc, kind: "pct" },
    // YPRR and route share need nflverse's participation file, which lands
    // after the season; until then, yards per target and snap share stand in.
    firstOf([
      { key: "yprr", label: "Yards per route run", of: (r) => num(r, "yardsPerRouteRun"), fmt: f2, kind: "pct" },
      { key: "ypt", label: "Yards per target", of: (r) => ratio(num(r, "receivingYards"), num(r, "targets")), fmt: f1, kind: "pct" },
    ], rows),
    firstOf([
      { key: "route", label: "Route participation", of: (r) => num(r, "routePct"), fmt: pc, kind: "pct" },
      { key: "snap", label: "Snap share", of: (r) => num(r, "snapPct"), fmt: pc, kind: "pct" },
    ], rows),
    { key: "ays", label: "Air-yards share", of: (r) => num(r, "airYardsSharePct"), fmt: pc, kind: "pct" },
    { key: "rzt", label: "Red-zone targets", of: (r) => num(r, "redZoneTargets"), fmt: int, kind: "pct" },
    { key: "ppt", label: "Fantasy points per target", of: (r) => ratio(num(r, "fantasyPoints"), num(r, "targets")), fmt: f2, kind: "pct" },
  ];
}

function lastDefs(pos: string): MetricDef[] {
  if (pos === "QB") {
    return [
      { key: "ttt", label: "Time to throw", of: (r) => num(r, "timeToThrow"), fmt: (v) => `${v.toFixed(2)}s`, kind: "style", more: "slower to throw" },
      { key: "aya", label: "Air yards per attempt", of: (r) => ratio(num(r, "airYards"), num(r, "attempts")), fmt: f1, kind: "style", more: "deeper" },
      // No tight-window charting here: the share of throws 20+ yards downfield.
      { key: "deep", label: "Deep-attempt rate", of: (r) => num(r, "deepAttemptPct"), fmt: pc, kind: "style", more: "more aggressive" },
      { key: "cpoe", label: "Completion % over expected", of: (r) => num(r, "cpoe"), fmt: signed1, kind: "pct" },
      { key: "epa", label: "EPA per play", of: (r) => num(r, "epaPerPlay"), fmt: signed, kind: "rank" },
      {
        key: "press", label: "Pressure rate", of: (r) => num(r, "pressurePct"), fmt: pc, kind: "pct", lowerIsBetter: true,
        extra: (r) => (num(r, "sacks") !== null ? `${int(num(r, "sacks")!)} sacks` : null),
      },
    ];
  }
  if (pos === "RB") {
    return [
      { key: "ybc", label: "Yards before contact per carry", of: (r) => num(r, "yardsBeforeContactPerAttempt"), fmt: f2, kind: "pct" },
      { key: "yaco", label: "Yards after contact per carry", of: (r) => num(r, "yardsAfterContactPerAttempt"), fmt: f2, kind: "pct" },
      { key: "bt", label: "Broken tackles", of: (r) => num(r, "brokenTackles"), fmt: int, kind: "pct" },
      { key: "expl", label: "Explosive run rate", of: (r) => num(r, "explosiveRunPct"), fmt: pc, kind: "pct" },
      { key: "snap", label: "Snap share", of: (r) => num(r, "snapPct"), fmt: pc, kind: "pct" },
      { key: "tpg", label: "Targets per game", of: perGame("targets"), fmt: f1, kind: "pct" },
    ];
  }
  return [
    { key: "adot", label: "Average depth of target", of: (r) => num(r, "airYardsPerTarget"), fmt: f1, kind: "style", more: "deeper" },
    { key: "yprr", label: "Yards per route run", of: (r) => num(r, "yardsPerRouteRun"), fmt: f2, kind: "pct" },
    { key: "route", label: "Route participation", of: (r) => num(r, "routePct"), fmt: pc, kind: "pct" },
    { key: "yac", label: "YAC per reception", of: (r) => num(r, "yardsAfterCatchPerReception"), fmt: f1, kind: "pct" },
    { key: "tgts", label: "Target share", of: (r) => num(r, "targetSharePct"), fmt: pc, kind: "pct" },
    { key: "catch", label: "Catch rate", of: (r) => num(r, "catchPct"), fmt: pc, kind: "pct" },
  ];
}

/* ------------------------------------------------------------ ranking */

export function standingOf(percentile: number): Standing {
  return percentile >= 70 ? "good" : percentile >= 30 ? "mid" : "bad";
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * One metric's line: the figure, and where it stands among the qualified.
 *
 * Percentile is the share of qualified players he beats, on the metric's own
 * direction. Rank counts players strictly better, so ties share a rank.
 */
function measure(
  def: MetricDef,
  row: Row,
  pool: Row[],
  qualified: boolean,
  pos: string,
): { metric: AdvMetric; pct: number | null } {
  const v = def.of(row);
  if (v === null) return { metric: { key: def.key, label: def.label, value: "-", read: "No data", standing: "muted", pct: null }, pct: null };
  const value = def.fmt(v);
  const extra = def.extra?.(row) ?? null;
  if (!qualified) {
    return { metric: { key: def.key, label: def.label, value, read: extra ?? "Not enough attempts to rank", standing: "muted", pct: null }, pct: null };
  }
  // Everyone qualified but himself: the best of 36 is the 100th percentile, and
  // alone in the pool he is not the 0th.
  const others = pool.filter((r) => r !== row).map((r) => def.of(r)).filter((x): x is number => x !== null);
  const better = (x: number): boolean => (def.lowerIsBetter ? x < v : x > v);
  const worse = (x: number): boolean => (def.lowerIsBetter ? x > v : x < v);
  const pct = others.length ? Math.round((others.filter(worse).length / others.length) * 100) : 100;
  const rank = others.filter(better).length + 1;
  const of = others.length + 1;

  if (def.kind === "style") {
    // A style reading: higher is neither good nor bad, so it is described.
    const above = others.filter((x) => x < v).length;
    const share = others.length ? Math.round((above / others.length) * 100) : 50;
    return {
      metric: { key: def.key, label: def.label, value, read: `${def.more![0]!.toUpperCase()}${def.more!.slice(1)} than ${share}% of ${pos}s`, standing: "muted", pct: null, pctl: share },
      pct: share,
    };
  }
  const read =
    def.kind === "rank"
      ? `${ordinal(rank)} of ${of} ${pos}s`
      : `${ordinal(pct)} percentile`;
  return {
    metric: { key: def.key, label: def.label, value, read: extra ? `${extra}, ${read}` : read, standing: standingOf(pct), pct, pctl: pct },
    pct,
  };
}

function throughWeek(table: Table): number | null {
  if (typeof table.week === "number") return table.week;
  const m = /(\d+)\s*$/.exec(table.weeks ?? "");
  return m ? Number(m[1]) : null;
}

function buildCard(
  table: Table | null,
  playerId: string,
  pos: string,
  defs: (rows: Row[]) => MetricDef[],
  allDefs: MetricDef[],
): AdvCard | null {
  const rows = table?.rows ?? [];
  const row = rows.find((r) => String(r["playerId"] ?? r["player_id"] ?? "") === playerId);
  if (!table || !row) return null;
  const week = throughWeek(table);
  const inProgress = Boolean(table.inProgress) || (week !== null && week < 17);
  const scale = inProgress && week ? Math.min(1, week / 17) : 1;
  const thresholds = defaultThresholds(pos as StatsPosition, false, scale);
  const pool = rows.filter((r) => passesThresholds(r, pos as StatsPosition, thresholds));
  const qualified = pool.includes(row);
  const pct: Record<string, number | null> = {};
  const metrics = defs(rows).map((def) => {
    const m = measure(def, row, pool, qualified, pos);
    pct[def.key] = m.pct;
    return m.metric;
  });
  const all = allDefs.map((def) => measure(def, row, pool, qualified, pos).metric);
  return {
    season: Number(table.season ?? row["season"] ?? 0),
    throughWeek: inProgress ? week : null,
    inProgress,
    games: num(row, "games") ?? 0,
    qualified,
    qualifiedCount: pool.length,
    metrics,
    all,
    row,
    pct,
  };
}

/* ------------------------------------------------------------- college */

/**
 * A rookie's "College final season" card (spec, section 2 rules), from
 * data/player/college_stats.json. The keys, order and pools mirror METRICS in
 * scripts/player/collegeMatch.mjs, which ranked them when the file was built.
 */
const COLLEGE_METRICS: Record<string, { pool: string; list: Array<{ key: string; label: string; fmt: (v: number) => string }> }> = {
  QB: {
    pool: "college passers with 150+ attempts",
    list: [
      { key: "cmp", label: "Completion %", fmt: pc },
      { key: "ypa", label: "Yards per attempt", fmt: f1 },
      { key: "ptd", label: "Passing TDs", fmt: int },
      { key: "int", label: "Interceptions", fmt: int },
      { key: "ryd", label: "Rushing yards", fmt: int },
      { key: "ppa", label: "EPA per play (PPA)", fmt: signed },
    ],
  },
  RB: {
    pool: "college backs with 100+ carries",
    list: [
      { key: "car", label: "Carries", fmt: int },
      { key: "ypc", label: "Yards per carry", fmt: f1 },
      { key: "rtd", label: "Rushing TDs", fmt: int },
      { key: "rec", label: "Receptions", fmt: int },
      { key: "recyd", label: "Receiving yards", fmt: int },
      { key: "ppa", label: "EPA per play (PPA)", fmt: signed },
    ],
  },
  WR: {
    pool: "college receivers with 30+ catches",
    list: [
      { key: "rec", label: "Receptions", fmt: int },
      { key: "recyd", label: "Receiving yards", fmt: int },
      { key: "ypr", label: "Yards per reception", fmt: f1 },
      { key: "retd", label: "Receiving TDs", fmt: int },
      { key: "long", label: "Longest reception", fmt: int },
      { key: "ppa", label: "EPA per play (PPA)", fmt: signed },
    ],
  },
};
COLLEGE_METRICS.TE = { ...COLLEGE_METRICS.WR!, pool: "college tight ends with 30+ catches" };

export interface CollegeCard extends AdvCard {
  school: string;
  pool: string;
}

/** The card, or null for a position with no college metrics or no final season. */
export function collegeCard(profile: CollegeProfile | null | undefined, position: string | null): CollegeCard | null {
  const def = COLLEGE_METRICS[position ?? ""];
  if (!profile || !def) return null;
  const metrics: AdvMetric[] = def.list.map((m) => {
    const entry = profile.final?.[m.key];
    if (!entry || typeof entry.value !== "number") {
      return { key: m.key, label: m.label, value: "-", read: "No data", standing: "muted", pct: null };
    }
    const value = m.fmt(entry.value);
    if (typeof entry.rank === "number" && typeof entry.of === "number" && typeof entry.pct === "number") {
      return { key: m.key, label: m.label, value, read: `${ordinal(entry.rank)} of ${entry.of}`, standing: standingOf(entry.pct), pct: entry.pct, pctl: entry.pct };
    }
    return { key: m.key, label: m.label, value, read: m.key === "long" ? "Not ranked" : "Not enough attempts to rank", standing: "muted", pct: null };
  });
  const qualified = metrics.some((m) => m.pct !== null);
  const pct: Record<string, number | null> = {};
  def.list.forEach((m, i) => (pct[m.key] = metrics[i]!.pct));
  return {
    season: profile.finalSeason,
    throughWeek: null,
    inProgress: false,
    games: 0,
    qualified,
    qualifiedCount: profile.poolSize,
    metrics,
    all: metrics,
    row: {},
    pct,
    school: profile.school,
    pool: def.pool,
  };
}

export interface StatsTabAdvanced {
  current: AdvCard | null;
  last: AdvCard | null;
}

/**
 * The two cards. `current` only when he has played this season: a preseason
 * page hides Card A (spec, edge states).
 */
export function statsTabAdvanced(
  playerId: string,
  position: string | null,
  leagueSeason: number,
  playedThisSeason: boolean,
): StatsTabAdvanced {
  const pos = position ?? "";
  if (!["QB", "RB", "WR", "TE"].includes(pos)) return { current: null, last: null };
  const lower = pos.toLowerCase();
  const curTable = playedThisSeason ? loadToolTable(lower, leagueSeason) : null;
  const lastTable = loadAdvancedStats(lower, leagueSeason - 1) as Table | null;
  // One list for both seasons: this season's six, then last season's that are
  // not among them, so the advanced table's rows line up year over year.
  const all: MetricDef[] = [];
  for (const def of [...currentDefs(pos, curTable?.rows ?? lastTable?.rows ?? []), ...lastDefs(pos)]) {
    if (!all.some((d) => d.key === def.key)) all.push(def);
  }
  const current = curTable ? buildCard(curTable, playerId, pos, (rows) => currentDefs(pos, rows), all) : null;
  const last = buildCard(lastTable, playerId, pos, () => lastDefs(pos), all);
  return { current, last };
}
