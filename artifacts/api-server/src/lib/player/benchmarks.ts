/**
 * Where a player's efficiency sits among everyone else at their position.
 *
 * The page's one piece of genuine league context. Efficiency rates - yards per
 * catch, catch rate, touchdowns per target - are meaningless in isolation:
 * 12.8 yards per catch is excellent for a tight end and unremarkable for a
 * deep-threat receiver. So each rate is reported against the position's own
 * distribution for that season, as a percentile.
 *
 * Two guards keep this honest.
 *
 * A **volume threshold** (30 targets for receivers, 20 for everyone else)
 * decides who is in the distribution at all. Without it a player with four
 * catches for 90 yards ranks as the most efficient receiver in football, which
 * is true and useless.
 *
 * The same threshold decides whether the PLAYER gets percentiles. Below it the
 * benchmarks still render - the position averages are worth seeing - but the
 * player's own percentiles are withheld rather than computed from a sample too
 * small to mean anything. `playerQualified` says which case the reader is
 * looking at, and the renderer says so on the page.
 */

import { getEntryPoints } from "./scoring";
import { hasParticipation } from "./ranks";
import { percentileOf } from "./metrics";
import { loadGameLogs } from "./data";
import type { GameLogStats, Player, PlayerBenchmarks } from "./types";

/** Positions with a meaningful efficiency distribution to be ranked within. */
const SUPPORTED = new Set(["QB", "RB", "WR", "TE"]);

function volumeThreshold(position: string): number {
  return position === "WR" ? 30 : 20;
}

interface PositionBenchmarks {
  position: string;
  season: number;
  qualThreshold: number;
  posAvg: {
    yardsPerCatch: number | null;
    catchPct: number | null;
    tdPerTarget: number | null;
    fpPerUsage: number | null;
  };
  /** All ascending, for percentile lookups. */
  yardsPerCatch: number[];
  catchPct: number[];
  tdPerTarget: number[];
  fpPerUsage: number[];
}

const cache = new Map<string, PositionBenchmarks>();

function statValue(stats: GameLogStats, key: string): number {
  return (stats as unknown as Record<string, number | null | undefined>)[key] ?? 0;
}

/**
 * The season-long efficiency distribution for one position.
 *
 * A quarterback's "targets" are pass attempts and their "catches" are
 * completions, so the same three rates describe throwing accuracy for a QB and
 * receiving for everyone else. Quarterbacks additionally get fantasy points per
 * usage - attempts plus twice carries - which is the closest thing to an
 * efficiency-per-opportunity number the position has.
 */
function positionBenchmarks(
  season: number,
  position: string,
  allPlayers: Player[],
): PositionBenchmarks {
  const key = `${season}_${position}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const threshold = volumeThreshold(position);
  const logs = loadGameLogs(season);
  const positionById = new Map(allPlayers.map((p) => [p.id, p.position]));

  let sumYards = 0;
  let sumRec = 0;
  let sumTgt = 0;
  let sumTd = 0;
  let sumQbFp = 0;
  let sumQbUsage = 0;

  const yardsPerCatch: number[] = [];
  const catchPct: number[] = [];
  const tdPerTarget: number[] = [];
  const fpPerUsage: number[] = [];

  for (const [id, entries] of Object.entries(logs)) {
    if (positionById.get(id) !== position) continue;

    let pYards = 0;
    let pRec = 0;
    let pTgt = 0;
    let pTd = 0;
    let pFp = 0;
    let pUsage = 0;

    for (const e of entries) {
      if (!hasParticipation(e.stats, position)) continue;
      if (position === "QB") {
        pTgt += statValue(e.stats, "pass_att");
        pRec += statValue(e.stats, "pass_cmp");
        pYards += statValue(e.stats, "pass_yd");
        pTd += statValue(e.stats, "pass_td");
        pFp += getEntryPoints(e.stats, "ppr");
        pUsage += statValue(e.stats, "pass_att") + 2 * statValue(e.stats, "rush_att");
      } else {
        pTgt += statValue(e.stats, "rec_tgt");
        pRec += statValue(e.stats, "rec");
        pYards += statValue(e.stats, "rec_yd");
        pTd += statValue(e.stats, "rec_td");
      }
    }

    if (pTgt < threshold) continue;

    sumYards += pYards;
    sumRec += pRec;
    sumTgt += pTgt;
    sumTd += pTd;

    if (position === "QB") {
      if (pTgt > 0) yardsPerCatch.push(pYards / pTgt);
      if (pUsage > 0) {
        fpPerUsage.push(pFp / pUsage);
        sumQbFp += pFp;
        sumQbUsage += pUsage;
      }
    } else if (pRec > 0) {
      yardsPerCatch.push(pYards / pRec);
    }

    if (pTgt > 0) {
      catchPct.push((pRec / pTgt) * 100);
      tdPerTarget.push((pTd / pTgt) * 100);
    }
  }

  const asc = (a: number, b: number) => a - b;

  const result: PositionBenchmarks = {
    position,
    season,
    qualThreshold: threshold,
    posAvg: {
      yardsPerCatch:
        position === "QB"
          ? sumTgt > 0
            ? sumYards / sumTgt
            : null
          : sumRec > 0
            ? sumYards / sumRec
            : null,
      catchPct: sumTgt > 0 ? (sumRec / sumTgt) * 100 : null,
      tdPerTarget: sumTgt > 0 ? (sumTd / sumTgt) * 100 : null,
      fpPerUsage: position === "QB" && sumQbUsage > 0 ? sumQbFp / sumQbUsage : null,
    },
    yardsPerCatch: yardsPerCatch.sort(asc),
    catchPct: catchPct.sort(asc),
    tdPerTarget: tdPerTarget.sort(asc),
    fpPerUsage: fpPerUsage.sort(asc),
  };

  cache.set(key, result);
  return result;
}

/**
 * Standard deviation with a floor.
 *
 * The floor exists because these numbers are divided into elsewhere: a position
 * whose whole distribution collapses to one value would otherwise produce an
 * infinite z-score rather than the "no spread to speak of" it means.
 */
function stdDev(values: number[], floor: number): number {
  if (values.length < 2) return floor;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(
    floor,
    Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length),
  );
}

export interface PlayerRates {
  yardsPerCatch: number;
  catchPct: number;
  tdPerTarget: number;
  fpPerUsage?: number;
}

export function playerBenchmarks(
  season: number,
  position: string,
  allPlayers: Player[],
  rates: PlayerRates,
  playerVolume: number,
): PlayerBenchmarks | null {
  if (!SUPPORTED.has(position)) return null;

  const bench = positionBenchmarks(season, position, allPlayers);
  if (
    bench.posAvg.yardsPerCatch === null &&
    bench.posAvg.catchPct === null &&
    bench.posAvg.tdPerTarget === null
  ) {
    return null;
  }

  const threshold = volumeThreshold(position);
  // A quarterback who played at all has enough attempts for these rates to
  // mean something; a receiver needs the volume gate.
  const qualified = position === "QB" || playerVolume >= threshold;

  return {
    position,
    season,
    qualifiedThreshold: threshold,
    posAvg: bench.posAvg,
    posStdDev: {
      tdPerTarget: stdDev(bench.tdPerTarget, 0.5),
      fpPerUsage:
        position === "QB" ? stdDev(bench.fpPerUsage, 0.01) : undefined,
    },
    percentile: qualified
      ? {
          yardsPerCatch: percentileOf(bench.yardsPerCatch, rates.yardsPerCatch),
          catchPct: percentileOf(bench.catchPct, rates.catchPct),
          tdPerTarget: percentileOf(bench.tdPerTarget, rates.tdPerTarget),
          fpPerUsage:
            position === "QB" && rates.fpPerUsage != null
              ? percentileOf(bench.fpPerUsage, rates.fpPerUsage)
              : null,
        }
      : null,
    playerQualified: qualified,
  };
}

/** Drops the per-season distributions. Used by the tests. */
export function resetBenchmarkCache(): void {
  cache.clear();
}
