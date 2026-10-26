/**
 * The Stats tab's Efficiency ladders: the per-play rates for each unit, with
 * league ranks, read from `data/team/efficiency_<season>.json`, and the Pass
 * Protection / Pass Rush ladders beside them.
 *
 * scripts/team/buildEfficiency.mjs builds that file from play-by-play; its
 * header defines every rate and the ranking rule. Nothing is computed here
 * beyond formatting: a rate the builder could not measure is null and its row
 * is left out, and a season with no file renders no ladder at all.
 *
 * Every row on these four ladders comes from that one file, so a ladder is
 * never two weeks at once. Until 2026-10-26 the yardage rows (Yds/Play,
 * Yds/Pass Att, Yds/Carry, Passer Rtg) and the sack counts were read live
 * from the stats provider, which is a week ahead of the file from Sunday
 * until the next build: one ladder, one "through Week N" caption, two weeks
 * of numbers. The builder now derives them from the same plays with the
 * box-score definitions, so they still match the official totals.
 *
 * The rows come out as StatRow so the Offense and Defense ladders' renderer
 * draws them unchanged - same label column, same percentile track, same rank
 * pill, same tier tints.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";
import { ordinal, type Side, type StatRow } from "./stats";

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
  /**
   * The yardage rows, box-score definitions (kneels, spikes and scrambles
   * counted as a box score counts them). Absent on a file built before
   * 2026-10-26.
   */
  yardsPerPlay?: EfficiencyMetric | null;
  yardsPerPassAttempt?: EfficiencyMetric | null;
  yardsPerCarry?: EfficiencyMetric | null;
  passerRating?: EfficiencyMetric | null;
  /** A count: the offense's sacks taken, the defense's sacks made. */
  sacks?: EfficiencyMetric | null;
}

export interface EfficiencyTeam {
  games: number;
  /** The weeks counted, ascending. Absent on a file built before 2026-10-26. */
  weeks?: number[];
  /**
   * The box-score sheet the rest of the Stats tab reads (lib/team/stats.ts):
   * what the club did and what opponents did against it. Absent on a file
   * built before 2026-10-26, when the tab falls back to the stats provider.
   */
  box?: { own: Side; opponent: Side };
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
  | "yardsPerPlay"
  | "yardsPerPassAttempt"
  | "yardsPerCarry"
  | "passerRating"
  | "sacks"
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
  /**
   * True where less is better for the offense and more for the defense
   * (sacks): the tint direction runs the other way from every rate.
   */
  inverted?: boolean;
  /** True on a count that grows with games played rather than a rate. */
  cumulative?: boolean;
  /** The offense's label where it differs ("Sacks Allowed"). */
  offenseLabel?: string;
}

const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(2)}`;
const percent = (v: number): string => `${v.toFixed(1)}%`;
const seconds = (v: number): string => `${v.toFixed(2)}s`;
const two = (v: number): string => v.toFixed(2);
const one = (v: number): string => v.toFixed(1);
const whole = (v: number): string => String(Math.round(v));

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
  // The same idea in yards, the labels and descriptions the stats provider's
  // rows carried before 2026-10-26.
  {
    key: "yardsPerPlay",
    label: "Yds/Play",
    describe: (u) =>
      u === "defense" ? "Net yards allowed per play" : "Net yards gained per offensive play",
    format: two,
  },
  {
    key: "yardsPerPassAttempt",
    label: "Yds/Pass Att",
    describe: (u) =>
      u === "defense" ? "Yards allowed per pass attempt" : "Yards gained per pass attempt",
    format: two,
  },
  {
    key: "yardsPerCarry",
    label: "Yds/Carry",
    describe: (u) =>
      u === "defense" ? "Yards allowed per rushing attempt" : "Yards gained per rushing attempt",
    format: two,
  },
  {
    key: "passerRating",
    label: "Passer Rtg",
    describe: (u) =>
      u === "defense"
        ? "Passer rating allowed to opposing quarterbacks"
        : "Passer rating produced by this offense",
    format: one,
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
  {
    key: "sacks",
    label: "Sacks",
    offenseLabel: "Sacks Allowed",
    describe: (u) =>
      u === "defense" ? "Sacks recorded by this defense" : "Sacks given up by this offense",
    format: whole,
    inverted: true,
    cumulative: true,
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
    const high = unit === "offense" ? !def.inverted : !!def.inverted;
    rows.push({
      key: `eff-${unit === "offense" ? "off" : "def"}-${def.key}`,
      label: unit === "offense" && def.offenseLabel ? def.offenseLabel : def.label,
      description: def.describe(unit),
      value: def.format(m.value),
      rank: m.rank,
      cumulative: !!def.cumulative,
      rankLabel: `${m.tied ? "T-" : ""}${ordinal(m.rank)}`,
      previousRank: null,
      direction: def.volume ? "volume" : high ? "high" : "low",
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
