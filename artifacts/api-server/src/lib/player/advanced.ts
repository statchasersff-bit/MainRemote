/**
 * The Advanced Stats tab's data.
 *
 * `data/player/advanced_stats/<pos>_<season>.json` is a self-describing table:
 * a column list with types and default visibility, and one row per qualifying
 * player. That shape is doing real work — it means a rebuilt table with new
 * metrics in it renders without a code change, which is why nothing here has a
 * hard-coded list of statistics.
 *
 * What this module adds is the two things a single row cannot say by itself:
 * which GROUP each column belongs in (usage, efficiency, explosiveness…), so
 * forty numbers read as five ideas; and where the player sits in the column's
 * distribution, because a raw 0.347 targets per route run means nothing until
 * you know it is the best in football.
 *
 * Columns whose direction is "lower is better" are inverted before ranking, so
 * a high percentile always means good on every bar the page draws.
 */

import { loadAdvancedStats } from "./data";

export type StatPosition = "qb" | "rb" | "wr" | "te";

export const ADVANCED_POSITIONS = new Set<string>(["QB", "RB", "WR", "TE"]);

export interface AdvancedColumn {
  key: string;
  label: string;
  type: "number" | "decimal" | "string";
  defaultVisible: boolean;
}

interface AdvancedTable {
  updated_at?: string;
  season?: number;
  week?: number;
  table?: string;
  columns?: AdvancedColumn[];
  rows?: Record<string, unknown>[];
}

/** Identity and ranking columns — shown as page furniture, never as a metric. */
const PINNED_KEYS = new Set([
  "rank",
  "playerName",
  "player_name",
  "name",
  "team",
  "nfl_team",
]);

/**
 * Columns that never appear.
 *
 * The identity fields are duplicated in the page header. The last two are
 * sourced but empty for every row in the current tables — a column of dashes is
 * worse than no column.
 */
const ALWAYS_HIDDEN = new Set([
  "playerId",
  "player_id",
  "sleeper_id",
  "sleeperId",
  "season",
  "position",
  "age",
  "contestedCatchRate",
  "yardsAfterContactPerReception",
]);

const QB_GROUPS: Record<string, string> = {
  attempts: "Volume / Usage", completions: "Volume / Usage", passingYards: "Volume / Usage",
  airYards: "Volume / Usage", completedAirYards: "Volume / Usage", redZoneAttempts: "Volume / Usage",
  passingTouchdowns: "Volume / Usage", rushAttempts: "Volume / Usage", rushYards: "Volume / Usage",
  rushTouchdowns: "Volume / Usage", games: "Volume / Usage",
  completedAirYardsPerCompletion: "Aggressiveness", yardsPerCatch: "Aggressiveness",
  completionPct: "Efficiency", onTargetPct: "Efficiency", poorThrows: "Efficiency",
  badThrowPct: "Efficiency", interceptions: "Efficiency", epaPerPlay: "Efficiency",
  successRate: "Efficiency", cpoe: "Efficiency",
  passes10Plus: "Explosiveness", passes20Plus: "Explosiveness", passes30Plus: "Explosiveness",
  passes40Plus: "Explosiveness", passes50Plus: "Explosiveness", longestPass: "Explosiveness",
  deepAttemptPct: "Explosiveness",
  pocketTime: "Pressure & Pocket", timeToThrow: "Pressure & Pocket", throwaways: "Pressure & Pocket",
  battedPasses: "Pressure & Pocket", scrambleRate: "Pressure & Pocket", yardsPerScramble: "Pressure & Pocket",
  hurries: "Pressure & Pocket", blitzes: "Pressure & Pocket", knockdowns: "Pressure & Pocket",
  sacks: "Pressure & Pocket", sackYardsLost: "Pressure & Pocket", fumbles: "Pressure & Pocket",
  pressurePct: "Pressure & Pocket",
  fantasyPoints: "Scoring",
};

const RB_GROUPS: Record<string, string> = {
  snapPct: "Usage / Workload", routes: "Usage / Workload", rushAttempts: "Usage / Workload",
  redZoneOpportunities: "Usage / Workload", goalLineCarries: "Usage / Workload",
  targets: "Usage / Workload", targetSharePct: "Usage / Workload", receptions: "Usage / Workload",
  redZoneTargets: "Usage / Workload", endZoneTargets: "Usage / Workload", games: "Usage / Workload",
  rushYards: "Production", yardsPerCarry: "Production", rushTouchdowns: "Production",
  receivingYards: "Production", yardsPerReception: "Production", receivingYardsAfterCatch: "Production",
  yardsPerRouteRun: "Production", receivingTouchdowns: "Production", epaPerPlay: "Production",
  rushes10Plus: "Explosive Play Ability", rushes20Plus: "Explosive Play Ability",
  rushes30Plus: "Explosive Play Ability", rushes40Plus: "Explosive Play Ability",
  rushes50Plus: "Explosive Play Ability", explosiveRunPct: "Explosive Play Ability",
  breakawayRunPct: "Explosive Play Ability", longestRush: "Explosive Play Ability",
  longestRushTouchdown: "Explosive Play Ability",
  brokenTackles: "Contact & Tackle Breaking", rushAttemptsPerBrokenTackle: "Contact & Tackle Breaking",
  yardsBeforeContactPerAttempt: "Contact & Tackle Breaking",
  yardsAfterContactPerAttempt: "Contact & Tackle Breaking", tackleEludedRate: "Contact & Tackle Breaking",
  fumbles: "Ball Security", tacklesForLoss: "Ball Security",
  tacklesForLossYards: "Ball Security", rushAttForNegativeYards: "Ball Security",
  fantasyPoints: "Scoring",
};

const WR_TE_GROUPS: Record<string, string> = {
  snapPct: "Usage / Role", routes: "Usage / Role", routePct: "Usage / Role", targets: "Usage / Role",
  targetsPerRouteRun: "Usage / Role", targetSharePct: "Usage / Role", airYardsPerTarget: "Usage / Role",
  airYardsPerReception: "Usage / Role", airYardsSharePct: "Usage / Role", wopr: "Usage / Role",
  redZoneTargets: "Usage / Role", endZoneTargets: "Usage / Role", games: "Usage / Role",
  receptions: "Production", receivingYards: "Production", totalYards: "Production",
  yardsBeforeCatchPerReception: "Production", yardsAfterCatchPerReception: "Production",
  yardsPerReception: "Production", yardsPerRouteRun: "Production", receivingTouchdowns: "Production",
  epaPerPlay: "Production", successRate: "Production",
  catchPct: "Hands", catchableTargets: "Hands", drops: "Hands",
  dropPct: "Hands", interceptionsWhenTargeted: "Hands", fumbles: "Hands",
  avoidedTackleRate: "Elusiveness", brokenTackles: "Elusiveness",
  receptions10Plus: "Explosiveness", receptions20Plus: "Explosiveness",
  receptions30Plus: "Explosiveness", receptions40Plus: "Explosiveness",
  receptions50Plus: "Explosiveness", longestReception: "Explosiveness",
  fantasyPoints: "Scoring",
};

const GROUPS_BY_POSITION: Record<StatPosition, Record<string, string>> = {
  qb: QB_GROUPS,
  rb: RB_GROUPS,
  wr: WR_TE_GROUPS,
  te: WR_TE_GROUPS,
};

/**
 * Metrics where a smaller number is the better one.
 *
 * Without this list a quarterback who threw two interceptions would be shown in
 * the 3rd percentile for interceptions, which is precisely backwards.
 */
const LOWER_IS_BETTER = new Set([
  "interceptions",
  "poorThrows",
  "badThrowPct",
  "throwaways",
  "battedPasses",
  "hurries",
  "knockdowns",
  "sacks",
  "sackYardsLost",
  "pressurePct",
  "fumbles",
  "drops",
  "dropPct",
  "interceptionsWhenTargeted",
  "tacklesForLoss",
  "tacklesForLossYards",
  "rushAttForNegativeYards",
  "timeToThrow",
]);

export const SECTION_ACCENTS: Record<string, string> = {
  Scoring: "#d4af37",
  "Volume / Usage": "#f59e0b",
  "Usage / Workload": "#f59e0b",
  "Usage / Role": "#f59e0b",
  Aggressiveness: "#fb923c",
  Efficiency: "#60a5fa",
  Production: "#34d399",
  Explosiveness: "#c084fc",
  "Explosive Play Ability": "#c084fc",
  "Pressure & Pocket": "#22d3ee",
  Hands: "#2dd4bf",
  Elusiveness: "#fb7185",
  "Contact & Tackle Breaking": "#22d3ee",
  "Ball Security": "#f87171",
};

export function sectionAccent(label: string): string {
  return SECTION_ACCENTS[label] ?? "#94a3b8";
}

/**
 * Format one cell.
 *
 * Deliberately not locale-aware beyond thousands separators: `lib/render.ts`'s
 * rule against locale defaults applies here too, since the same string has to
 * come out of the server and out of a browser in another timezone identically.
 */
export function formatAdvanced(value: unknown, type: AdvancedColumn["type"]): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (type === "decimal") return value.toFixed(2);
    if (Number.isInteger(value)) return groupDigits(value);
    return Math.abs(value) >= 1000 ? groupDigits(value) : value.toFixed(2);
  }
  if (typeof value === "string") return value || "—";
  return String(value);
}

function groupDigits(value: number): string {
  const [whole, fraction] = Math.abs(value).toFixed(0).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export interface AdvancedCell {
  key: string;
  label: string;
  value: string;
  /** 0-100, already oriented so higher is always better. Null when unrankable. */
  percentile: number | null;
}

export interface AdvancedGroup {
  label: string;
  accent: string;
  cells: AdvancedCell[];
}

export interface AdvancedProfile {
  position: StatPosition;
  season: number | "all";
  /** The table's own coverage stamp, e.g. "through Week 18". */
  throughWeek: number | null;
  updatedAt: string | null;
  /** This player's overall rank within the table, when it has one. */
  rank: number | null;
  qualifyingPlayers: number;
  groups: AdvancedGroup[];
}

function percentileRank(value: number, values: number[]): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) if (v < value) below += 1;
  return Math.round((below / values.length) * 100);
}

/** Which seasons this position actually has an advanced table for. */
export function advancedSeasons(
  position: string,
  seasons: number[],
): number[] {
  const pos = position.toLowerCase();
  return seasons.filter((season) => {
    const table = loadAdvancedStats(pos, season) as AdvancedTable | null;
    return Boolean(table?.rows?.length);
  });
}

/** Does this player appear in the table at all? */
export function hasAdvancedProfile(
  playerId: string,
  position: string,
  season: number | "all",
): boolean {
  const table = loadAdvancedStats(position.toLowerCase(), season) as AdvancedTable | null;
  return Boolean(table?.rows?.some((row) => String(row["playerId"]) === playerId));
}

/**
 * One player's advanced profile, grouped and ranked.
 *
 * Returns null when the player is not in the table — which is the normal case
 * for a backup, and why the tab is hidden rather than shown empty.
 */
export function advancedProfile(
  playerId: string,
  position: string,
  season: number | "all",
): AdvancedProfile | null {
  const pos = position.toLowerCase() as StatPosition;
  if (!(pos in GROUPS_BY_POSITION)) return null;

  const table = loadAdvancedStats(pos, season) as AdvancedTable | null;
  const rows = table?.rows;
  const columns = table?.columns;
  if (!rows?.length || !columns?.length) return null;

  const row = rows.find((r) => String(r["playerId"]) === playerId);
  if (!row) return null;

  const groupMap = GROUPS_BY_POSITION[pos];
  const order: string[] = [];
  const byLabel = new Map<string, AdvancedCell[]>();

  for (const column of columns) {
    if (PINNED_KEYS.has(column.key) || ALWAYS_HIDDEN.has(column.key)) continue;
    if (!column.defaultVisible) continue;

    const raw = row[column.key];
    const label = groupMap[column.key] ?? "Other";

    let percentile: number | null = null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const values = rows
        .map((r) => r[column.key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (values.length > 1) {
        const rank = percentileRank(raw, values);
        percentile = LOWER_IS_BETTER.has(column.key) ? 100 - rank : rank;
      }
    }

    const cells = byLabel.get(label);
    const cell: AdvancedCell = {
      key: column.key,
      label: column.label,
      value: formatAdvanced(raw, column.type),
      percentile,
    };
    if (cells) cells.push(cell);
    else {
      byLabel.set(label, [cell]);
      order.push(label);
    }
  }

  if (order.length === 0) return null;

  const rank = typeof row["rank"] === "number" ? (row["rank"] as number) : null;

  return {
    position: pos,
    season,
    throughWeek: typeof table?.week === "number" ? table.week : null,
    updatedAt: typeof table?.updated_at === "string" ? table.updated_at : null,
    rank,
    qualifyingPlayers: rows.length,
    groups: order.map((label) => ({
      label,
      accent: sectionAccent(label),
      cells: byLabel.get(label)!,
    })),
  };
}
