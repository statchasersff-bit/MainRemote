/**
 * The Stats tab's Efficiency ladders: five per-play rates for each unit, with
 * league ranks, read from `data/team/efficiency_<season>.json`.
 *
 * scripts/team/buildEfficiency.mjs builds that file from play-by-play; its
 * header defines every rate and the ranking rule. Nothing is computed here
 * beyond formatting: a rate the builder could not measure is null and its row
 * is left out, and a season with no file renders no ladder at all.
 *
 * The rows come out as StatRow so the Offense and Defense ladders' renderer
 * draws them unchanged - same label column, same percentile track, same rank
 * pill, same tier tints.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";
import { ordinal, type StatRow } from "./stats";

export interface EfficiencyMetric {
  value: number;
  /** 1-32; ties share a rank. */
  rank: number;
  tied: boolean;
  /** The percentile the rank implies: 1st is the 100th, 32nd the 0th. */
  pct: number;
}

export interface EfficiencySide {
  plays: number;
  dropbacks: number;
  rushes: number;
  /** Dropbacks the charting feed covered; the blitz rows' denominator. */
  chartedDropbacks?: number;
  epaPlay: EfficiencyMetric | null;
  epaDropback: EfficiencyMetric | null;
  epaRush: EfficiencyMetric | null;
  successRate: EfficiencyMetric | null;
  explosiveRate: EfficiencyMetric | null;
  /** Pass Protection (offense: faced) / Pass Rush (defense: sent). */
  blitzRate?: EfficiencyMetric | null;
  epaVsBlitz?: EfficiencyMetric | null;
  epaVsFourMan?: EfficiencyMetric | null;
  /** Seconds. Offense: its passers. Defense: the passers it faced. */
  timeToThrow?: EfficiencyMetric | null;
}

export interface EfficiencyTeam {
  games: number;
  offense: EfficiencySide;
  defense: EfficiencySide;
}

export interface EfficiencyDoc {
  season: number;
  builtAt: string;
  throughWeek: number;
  teams: Record<string, EfficiencyTeam>;
}

export function getEfficiencyDoc(season: number): EfficiencyDoc | null {
  return readDataJson<EfficiencyDoc>(dataPath("team", `efficiency_${season}.json`));
}

/** The file's mtime, for the page cache key; "" when there is no file. */
export function efficiencyVersion(season: number): string {
  try {
    return String(fs.statSync(dataPath("team", `efficiency_${season}.json`)).mtimeMs);
  } catch {
    return "";
  }
}

type MetricKey = keyof Pick<
  EfficiencySide,
  | "epaPlay"
  | "epaDropback"
  | "epaRush"
  | "successRate"
  | "explosiveRate"
  | "blitzRate"
  | "epaVsBlitz"
  | "epaVsFourMan"
  | "timeToThrow"
>;

interface MetricDef {
  key: MetricKey;
  label: string;
  /** Spelled out for assistive tech, which never sees the abbreviation. */
  describe: (unit: "offense" | "defense") => string;
  format: (value: number) => string;
  /**
   * True on a rate with no better end (blitz rate, time to throw): ranked
   * most to least and left untinted, the Volume tiles' rule.
   */
  volume?: boolean;
}

const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(2)}`;
const percent = (v: number): string => `${v.toFixed(1)}%`;
const seconds = (v: number): string => `${v.toFixed(2)}s`;

const METRICS: MetricDef[] = [
  {
    key: "epaPlay",
    label: "EPA/Play",
    describe: (u) => `Expected points added per play${u === "defense" ? " allowed" : ""}`,
    format: signed,
  },
  {
    key: "epaDropback",
    label: "EPA/DB",
    describe: (u) => `Expected points added per dropback${u === "defense" ? " allowed" : ""}`,
    format: signed,
  },
  {
    key: "epaRush",
    label: "EPA/Rush",
    describe: (u) => `Expected points added per designed run${u === "defense" ? " allowed" : ""}`,
    format: signed,
  },
  {
    key: "successRate",
    label: "Success Rate",
    describe: (u) =>
      u === "defense"
        ? "Share of plays allowed with positive expected points added"
        : "Share of plays with positive expected points added",
    format: percent,
  },
  {
    key: "explosiveRate",
    label: "Explosive %",
    describe: (u) =>
      u === "defense"
        ? "Share of plays allowed gaining 15+ yards on a dropback or 10+ on a run"
        : "Share of plays gaining 15+ yards on a dropback or 10+ on a run",
    format: percent,
  },
];

/** Pass Protection (offense) / Pass Rush (defense), in ladder order. */
const PASS_RUSH: MetricDef[] = [
  {
    key: "blitzRate",
    label: "Blitz %",
    describe: (u) =>
      u === "defense"
        ? "Share of dropbacks this defense rushed five or more; ranked most to least"
        : "Share of dropbacks this offense faced five or more rushers; ranked most to least",
    format: percent,
    volume: true,
  },
  {
    key: "epaVsBlitz",
    label: "EPA vs Blitz",
    describe: (u) =>
      u === "defense"
        ? "Expected points added allowed per dropback when blitzing"
        : "Expected points added per dropback against the blitz",
    format: signed,
  },
  {
    key: "epaVsFourMan",
    label: "EPA vs 4-Man",
    describe: (u) =>
      u === "defense"
        ? "Expected points added allowed per dropback with a four-man rush"
        : "Expected points added per dropback against a four-man rush",
    format: signed,
  },
  {
    key: "timeToThrow",
    label: "Time to Throw",
    describe: (u) =>
      u === "defense"
        ? "Average seconds opposing passers held the ball against this defense; ranked longest to shortest"
        : "Average seconds from snap to throw; ranked longest to shortest",
    format: seconds,
    volume: true,
  },
];

function rowsFor(
  defs: MetricDef[],
  team: EfficiencyTeam,
  unit: "offense" | "defense",
): StatRow[] {
  const side = team[unit];
  const rows: StatRow[] = [];
  for (const def of defs) {
    const m = side[def.key];
    if (!m) continue;
    rows.push({
      key: `eff-${unit === "offense" ? "off" : "def"}-${def.key}`,
      label: def.label,
      description: def.describe(unit),
      value: def.format(m.value),
      rank: m.rank,
      cumulative: false,
      rankLabel: `${m.tied ? "T-" : ""}${ordinal(m.rank)}`,
      previousRank: null,
      direction: def.volume ? "volume" : unit === "offense" ? "high" : "low",
    });
  }
  return rows;
}

/**
 * One unit's efficiency rows, in ladder order. Both units rank with 1st best,
 * the Stats tab's rule, so the renderer's tier tints read the same way on each.
 */
export function efficiencyRows(
  team: EfficiencyTeam,
  unit: "offense" | "defense",
): StatRow[] {
  return rowsFor(METRICS, team, unit);
}

/**
 * The Pass Protection (offense) or Pass Rush (defense) rows. Blitz rate and
 * time to throw come through as `volume`: ranked, never tinted.
 */
export function passRushRows(
  team: EfficiencyTeam,
  unit: "offense" | "defense",
): StatRow[] {
  return rowsFor(PASS_RUSH, team, unit);
}
