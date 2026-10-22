/**
 * The measured half of the Outlook tab's spec sections (outlook-tab.ts): the
 * three driver rows with their rank strips, and the six-cell advanced row.
 *
 * Read from the same place the tab's existing driver cards read
 * (outlook-drivers.ts): last season's advanced line on every player's outlook
 * record. A player is in the field - and is ranked - only with six or more
 * games, the same threshold, so "5th of 41" here and "5th of 41" in the old
 * cards are the same count.
 *
 * Every metric ranks higher-is-better, so a rank is the player's place in the
 * field sorted descending, ties sharing the better place.
 *
 * Substitutions from the spec, where no file here has its metric:
 *   RB efficiency   yards after contact per carry, for rush yards over expected
 *   RB advanced     explosive-run rate for "8+ in the box" and red-zone
 *                   opportunities for red-zone carries
 *   WR/TE advanced  route participation for slot rate
 */

import { loadAdvancedStats, loadFantasyOutlook2026 } from "./data";
import type { FantasyOutlook2026, OutlookKeyStats } from "./types";

/** Below this many games a player is neither in the field nor ranked. */
export const MIN_GAMES = 6;

/**
 * In season the threshold scales with the calendar (mak, 2026-10-22: the
 * drivers read the current season, not last year's): through Week 6 a player
 * qualifies with five games, so a bye does not drop him out of the field,
 * and the bar climbs to the spec's six once the season allows it.
 */
export function minGames(week: number | null): number {
  return week === null ? MIN_GAMES : Math.min(MIN_GAMES, Math.max(1, week - 1));
}

/** One `advanced_stats/<pos>_<season>.json` table, as much of it as is read here. */
interface AdvancedTable {
  season?: number;
  week?: number;
  inProgress?: boolean;
  rows?: OutlookKeyStats[];
}

/**
 * The current season's advanced line for a player, and the table it is in,
 * or null before Week 1 / for a player without a row yet.
 */
function currentLine(
  position: string,
  season: number,
  playerId: string | null,
): { table: AdvancedTable; stats: OutlookKeyStats; week: number } | null {
  if (!playerId || !position) return null;
  const table = loadAdvancedStats(position, season) as AdvancedTable | null;
  if (!table || !Array.isArray(table.rows)) return null;
  const week = num(table.week);
  if (week === null || week < 1) return null;
  const stats = table.rows.find((r) => String(r.playerId ?? "") === playerId);
  if (!stats || (num(stats.games) ?? 0) < 1) return null;
  return { table, stats, week };
}

export type Tier = "good" | "mid" | "bad";

export interface DriverRow {
  label: string;
  /** "Heavy", "Average", "Limited": the tier's word. Null when unranked. */
  word: string | null;
  tier: Tier | null;
  /** "34.6". */
  value: string;
  /** "attempts per game". */
  unit: string;
  /** 1-based, or null when he is below the games threshold. */
  rank: number | null;
  /** The size of the field. */
  of: number;
}

export interface AdvancedCell {
  label: string;
  value: string;
}

export interface OutlookMeasures {
  /** The season the lines are from. */
  season: number;
  /** The week the season's table runs through; null for a finished season. */
  week: number | null;
  /** Games a player needs to be in the field. */
  minGames: number;
  position: string;
  /** Qualified players at the position. */
  field: number;
  games: number;
  drivers: DriverRow[];
  advanced: AdvancedCell[];
  /** The line the rows were read from, for the triggers' sacks and drops. */
  line: OutlookKeyStats;
}

interface Spec {
  label: string;
  unit: string;
  read: (s: OutlookKeyStats, games: number) => number | null;
  format: (v: number) => string;
  /** Top third, middle third, bottom third. */
  words: [string, string, string];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const perGame =
  (key: string) =>
  (s: OutlookKeyStats, games: number): number | null => {
    const v = num(s[key]);
    return v === null || games <= 0 ? null : v / games;
  };
const total =
  (key: string) =>
  (s: OutlookKeyStats): number | null =>
    num(s[key]);

const one = (v: number): string => v.toFixed(1);
const two = (v: number): string => v.toFixed(2);
const pct = (v: number): string => `${v.toFixed(1)}%`;
const epa = (v: number): string => (Math.abs(v) < 0.1 ? v.toFixed(3) : v.toFixed(2));
const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
const whole = (v: number): string => String(Math.round(v));

const DRIVERS: Record<string, Spec[]> = {
  QB: [
    { label: "Passing volume", unit: "attempts per game", read: perGame("attempts"), format: one, words: ["Heavy", "Moderate", "Light"] },
    { label: "Efficiency", unit: "EPA per play", read: total("epaPerPlay"), format: epa, words: ["Strong", "Average", "Weak"] },
    { label: "Rushing", unit: "rush yards per game", read: perGame("rushYards"), format: one, words: ["Major", "Moderate", "Limited"] },
  ],
  RB: [
    { label: "Rushing volume", unit: "carries per game", read: perGame("rushAttempts"), format: one, words: ["Heavy", "Moderate", "Light"] },
    { label: "Receiving role", unit: "targets per game", read: perGame("targets"), format: one, words: ["Featured", "Moderate", "Limited"] },
    { label: "Efficiency", unit: "yards after contact per carry", read: total("yardsAfterContactPerAttempt"), format: two, words: ["Strong", "Average", "Weak"] },
  ],
  WR: [
    { label: "Target volume", unit: "target share", read: total("targetSharePct"), format: pct, words: ["Heavy", "Moderate", "Low"] },
    { label: "Downfield role", unit: "air-yards share", read: total("airYardsSharePct"), format: pct, words: ["Downfield", "Moderate", "Limited"] },
    { label: "Efficiency", unit: "yards per route run", read: total("yardsPerRouteRun"), format: two, words: ["Strong", "Average", "Weak"] },
  ],
  TE: [
    { label: "Route participation", unit: "route participation", read: total("routePct"), format: pct, words: ["Every-down", "Rotational", "Limited"] },
    { label: "Target share", unit: "target share", read: total("targetSharePct"), format: pct, words: ["Heavy", "Moderate", "Low"] },
    { label: "Efficiency", unit: "yards per route run", read: total("yardsPerRouteRun"), format: two, words: ["Strong", "Average", "Weak"] },
  ],
};

const ADVANCED: Record<string, Array<{ label: string; key: string; format: (v: number) => string }>> = {
  QB: [
    { label: "Success rate", key: "successRate", format: pct },
    { label: "CPOE", key: "cpoe", format: signed },
    { label: "Sacks taken", key: "sacks", format: whole },
    { label: "Pressure rate", key: "pressurePct", format: pct },
    { label: "Bad-throw rate", key: "badThrowPct", format: pct },
    { label: "Deep-attempt rate", key: "deepAttemptPct", format: pct },
  ],
  RB: [
    { label: "Yards after contact per carry", key: "yardsAfterContactPerAttempt", format: two },
    { label: "Broken tackles", key: "brokenTackles", format: whole },
    { label: "Explosive-run rate", key: "explosiveRunPct", format: pct },
    { label: "Red-zone opportunities", key: "redZoneOpportunities", format: whole },
    { label: "Snap share", key: "snapPct", format: pct },
    { label: "Targets", key: "targets", format: whole },
  ],
  WR: [
    { label: "Average depth of target", key: "airYardsPerTarget", format: one },
    { label: "Contested-catch rate", key: "contestedCatchRate", format: pct },
    { label: "Drop rate", key: "dropPct", format: pct },
    { label: "Red-zone targets", key: "redZoneTargets", format: whole },
    { label: "Route participation", key: "routePct", format: pct },
    { label: "YAC per reception", key: "yardsAfterCatchPerReception", format: one },
  ],
};
ADVANCED.TE = ADVANCED.WR!;

const fieldCache = new Map<string, number[]>();

/**
 * Every qualified value at the position, descending: from the current
 * season's table when one is given, else from last season's lines on the
 * outlook records.
 */
function field(position: string, spec: Spec, current: AdvancedTable | null, min: number): number[] {
  const key = `${position}:${spec.label}:${current ? `${current.season}w${current.week}` : "prior"}`;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const values: number[] = [];
  const lines: OutlookKeyStats[] = current
    ? (current.rows ?? []).filter((r) => (r.position ?? position) === position)
    : Object.values(loadFantasyOutlook2026())
        .filter((record) => record.position === position && record.keyStats)
        .map((record) => record.keyStats!);
  for (const line of lines) {
    const games = num(line.games) ?? 0;
    if (games < min) continue;
    const v = spec.read(line, games);
    if (v !== null) values.push(v);
  }
  values.sort((a, b) => b - a);
  fieldCache.set(key, values);
  return values;
}

export function resetOutlookMeasureCache(): void {
  fieldCache.clear();
}

/** The tier a rank falls in, by thirds of the field. */
export function tierOf(rank: number, of: number): Tier {
  if (rank <= Math.ceil(of / 3)) return "good";
  if (rank <= Math.ceil((2 * of) / 3)) return "mid";
  return "bad";
}

/** The Sleeper id an outlook record carries, on the record or its line. */
function recordId(record: FantasyOutlook2026 | null): string | null {
  const own = (record as unknown as { id?: unknown } | null)?.id;
  if (typeof own === "string" && own) return own;
  const line = record?.keyStats?.playerId;
  return typeof line === "string" && line ? line : null;
}

/**
 * The measures for one player.
 *
 * The current season's line when he has one (mak, 2026-10-22), ranked among
 * the position's current-season field; otherwise last season's line on his
 * outlook record, ranked the way the spec wrote it.
 */
export function outlookMeasures(
  record: FantasyOutlook2026 | null,
  options: { season?: number; playerId?: string | null; position?: string | null } = {},
): OutlookMeasures | null {
  const position = record?.position ?? options.position ?? "";
  const specs = DRIVERS[position];
  if (!specs) return null;
  const now =
    options.season !== undefined
      ? currentLine(position, options.season, options.playerId ?? recordId(record))
      : null;
  const stats = now?.stats ?? record?.keyStats;
  if (!stats) return null;
  const games = num(stats.games) ?? 0;
  const season = now ? options.season! : (num(stats.season) ?? (record?.season ?? 0) - 1);
  const week = now ? now.week : null;
  const min = minGames(week);

  const drivers: DriverRow[] = [];
  for (const spec of specs) {
    const value = spec.read(stats, games);
    if (value === null) continue;
    const values = field(position, spec, now?.table ?? null, min);
    const ranked = games >= min && values.length > 0;
    const rank = ranked ? values.findIndex((v) => v <= value) + 1 || values.length : null;
    const tier = rank === null ? null : tierOf(rank, values.length);
    drivers.push({
      label: spec.label,
      word: tier === null ? null : spec.words[tier === "good" ? 0 : tier === "mid" ? 1 : 2],
      tier,
      value: spec.format(value),
      unit: spec.unit,
      rank,
      of: values.length,
    });
  }

  const advanced: AdvancedCell[] = (ADVANCED[position] ?? []).flatMap((cell) => {
    const v = num(stats[cell.key]);
    return v === null ? [] : [{ label: cell.label, value: cell.format(v) }];
  });

  if (drivers.length === 0 && advanced.length === 0) return null;
  return {
    season,
    week,
    minGames: min,
    position,
    field: drivers[0]?.of ?? 0,
    games,
    drivers,
    advanced,
    line: stats,
  };
}
