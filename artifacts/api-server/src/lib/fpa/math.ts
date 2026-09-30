/**
 * The arithmetic of the FPA table, with no database behind it: the
 * strength-of-schedule adjustment, the preseason baseline, the blend with the
 * current season and the rolling window. ingest.ts does the fetching and the
 * writing around it. Kept apart, like blend.ts, so the tests can load it on
 * its own (tests/fpa-math.test.mjs).
 */

import { currentSeasonWeight } from "./blend";
import {
  FANTASY_POSITIONS,
  type FantasyPosition,
  type ScoringFormat,
  type ScoredPlayerWeek,
} from "./nflverse";

/** From week 12 the current season is read over its last this-many weeks. */
export const ROLLING_WINDOW_WEEKS = 10;

/* ------------------------------------------------------------ the FPA table */

export interface PositionFpa {
  /** Points allowed per game, as measured. */
  raw: number;
  /** The same, corrected for strength of schedule. */
  adj: number;
}

export interface DefenseFpa {
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

export type FpaTable = Map<string, DefenseFpa>;

export function emptyPosRecord<T>(make: () => T): Record<FantasyPosition, T> {
  return Object.fromEntries(
    FANTASY_POSITIONS.map((p) => [p, make()]),
  ) as Record<FantasyPosition, T>;
}

/**
 * Raw and adjusted FPA for every defense, for one scoring format.
 *
 * Offense strength is each team's own per-game production at the position — the
 * mirror image of FPA — averaged over the opponents a defense actually faced,
 * counting repeat meetings each time. A defense that faced offenses averaging
 * two points a game above league average has two points taken off its raw
 * figure.
 */
export function computeFpaTable(
  rows: ScoredPlayerWeek[],
  format: ScoringFormat,
): FpaTable {
  // Defense side: points allowed, weeks played, and who was faced each week.
  const defWeeks = new Map<string, Set<number>>();
  const defTotals = new Map<string, Record<FantasyPosition, number>>();
  const defFacedByWeek = new Map<string, Map<number, string>>();

  // Offense side: points produced and weeks played.
  const offWeeks = new Map<string, Set<number>>();
  const offTotals = new Map<string, Record<FantasyPosition, number>>();

  for (const r of rows) {
    const pts = r.points[format];
    const D = r.defenseTeam;
    const O = r.team;

    let dWeeks = defWeeks.get(D);
    if (!dWeeks) {
      dWeeks = new Set();
      defWeeks.set(D, dWeeks);
      defTotals.set(D, emptyPosRecord(() => 0));
      defFacedByWeek.set(D, new Map());
    }
    dWeeks.add(r.week);
    defTotals.get(D)![r.position] += pts;
    defFacedByWeek.get(D)!.set(r.week, O);

    let oWeeks = offWeeks.get(O);
    if (!oWeeks) {
      oWeeks = new Set();
      offWeeks.set(O, oWeeks);
      offTotals.set(O, emptyPosRecord(() => 0));
    }
    oWeeks.add(r.week);
    offTotals.get(O)![r.position] += pts;
  }

  // Per-game offensive production by position.
  const offPpg = new Map<string, Record<FantasyPosition, number>>();
  for (const [O, weeks] of offWeeks) {
    const games = weeks.size || 1;
    const totals = offTotals.get(O)!;
    const perGame = emptyPosRecord<number>(() => 0);
    for (const p of FANTASY_POSITIONS) perGame[p] = totals[p] / games;
    offPpg.set(O, perGame);
  }

  const leagueAvg = emptyPosRecord(() => 0);
  for (const p of FANTASY_POSITIONS) {
    let sum = 0;
    let count = 0;
    for (const perGame of offPpg.values()) {
      sum += perGame[p];
      count += 1;
    }
    leagueAvg[p] = count ? sum / count : 0;
  }

  const table: FpaTable = new Map();
  for (const [D, weeks] of defWeeks) {
    const games = weeks.size || 1;
    const totals = defTotals.get(D)!;
    const faced = [...defFacedByWeek.get(D)!.values()];

    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      const raw = totals[p] / games;

      let sosSum = 0;
      let sosCount = 0;
      for (const off of faced) {
        const perGame = offPpg.get(off);
        if (perGame) {
          sosSum += perGame[p];
          sosCount += 1;
        }
      }
      const sos = sosCount ? sosSum / sosCount : leagueAvg[p];
      byPos[p] = { raw, adj: raw - (sos - leagueAvg[p]) };
    }

    table.set(D, { games, byPos });
  }

  return table;
}

/* -------------------------------------------------------------- the blend */

export function distinctWeeksDesc(rows: ScoredPlayerWeek[]): number[] {
  return [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
}

export function rowsForWeeks(
  rows: ScoredPlayerWeek[],
  weeks: Set<number>,
): ScoredPlayerWeek[] {
  return rows.filter((r) => weeks.has(r.week));
}

export interface BlendedDefense {
  abbr: string;
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

export function buildPreseasonBaseline(full: FpaTable): Map<string, BlendedDefense> {
  const out = new Map<string, BlendedDefense>();
  for (const [abbr, def] of full) {
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) byPos[p] = { ...def.byPos[p] };
    out.set(abbr, { abbr, games: def.games, byPos });
  }
  return out;
}

export function blendWithCurrent(
  baseline: Map<string, BlendedDefense>,
  current: FpaTable,
  weeksPlayed: number,
): Map<string, BlendedDefense> {
  const w = currentSeasonWeight(weeksPlayed);
  const out = new Map<string, BlendedDefense>();

  for (const abbr of new Set([...baseline.keys(), ...current.keys()])) {
    const base = baseline.get(abbr);
    const cur = current.get(abbr);
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      // A defense present in only one of the two is blended with itself rather
      // than against a zero, which would halve its number for no reason.
      const b = base?.byPos[p] ?? cur!.byPos[p];
      const c = cur?.byPos[p] ?? b;
      byPos[p] = {
        raw: (1 - w) * b.raw + w * c.raw,
        adj: (1 - w) * b.adj + w * c.adj,
      };
    }
    out.set(abbr, { abbr, games: cur?.games ?? base?.games ?? 0, byPos });
  }

  return out;
}

/** The current-season weeks the table reads: all of them, or from week 12 the last ten. */
export function currentWindowWeeks(rows: ScoredPlayerWeek[], weeksPlayed: number): Set<number> {
  return weeksPlayed >= 12
    ? new Set(distinctWeeksDesc(rows).slice(0, ROLLING_WINDOW_WEEKS))
    : new Set(rows.map((r) => r.week));
}
