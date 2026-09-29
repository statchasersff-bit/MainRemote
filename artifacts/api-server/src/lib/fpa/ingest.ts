/**
 * The Fantasy Points Allowed ingest.
 *
 * Pulls weekly player stats from nflverse, scores them, groups by
 * (season, week, defense, position) and derives, per defense and position:
 *
 *     raw FPA = points that position scored against this defense
 *               ÷ games this defense played
 *
 * Two things make the served number more than that division.
 *
 * **The blend.** Before the season starts there is no current-season data, so
 * the figure is last season's. Once games exist the two are mixed, with the
 * weight on live data rising by week (wk1 .25 → wk4 .80) until week 12, past
 * which a rolling ten-week window of the current season is used alone. This is
 * the whole reason the number is precomputed rather than queried: it is a
 * weighted mix over two seasons, and recomputing it per request would put a
 * 7MB CSV parse in front of TTFB.
 *
 * **The adjustment.** Raw FPA flatters a defense that has played weak
 * offenses. Adjusted FPA subtracts how much stronger or weaker than league
 * average the offenses it actually faced were, at that position. Both are
 * stored and both are served; raw is the default, because it is what happened
 * and the adjustment is a model.
 *
 * Writes replace rather than accumulate: the ingest is idempotent, and running
 * it twice leaves exactly what running it once does.
 */

import {
  db,
  fpaGames,
  fpaSnapshots,
  type InsertFpaGame,
  type InsertFpaSnapshot,
} from "../db";
import { eq, inArray, max } from "drizzle-orm";
import { logger } from "../logger";
import { getTeamByAbbreviation } from "../team/teams";
import { currentSeasonWeight } from "./blend";
import {
  fetchScoredWeeklyStats,
  FANTASY_POSITIONS,
  SCORING_FORMATS,
  NflverseSeasonUnavailableError,
  type FantasyPosition,
  type ScoringFormat,
  type ScoredPlayerWeek,
} from "./nflverse";

export const DEFAULT_BASELINE_SEASON = Number(
  process.env["FPA_BASELINE_SEASON"] ?? 2025,
);
export const DEFAULT_CURRENT_SEASON = Number(
  process.env["FPA_CURRENT_SEASON"] ?? 2026,
);

const ROLLING_WINDOW_WEEKS = 10;

/**
 * Both seasons stop at week 17.
 *
 * Mirrors the industry's "Weeks 1-17" tables: week 18 is rested starters and
 * settled playoff seeding, and including it makes several defenses look
 * materially softer than they played. The current season is capped too, so
 * a January ingest does not fold week 18 into the table.
 */
const MAX_WEEK = 17;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The display name for a defense.
 *
 * Routed through the canonical team table rather than a local map — the alias
 * handling (LA, OAK, SD, STL, WSH) is already there. An abbreviation it cannot
 * resolve is passed through rather than dropped, so an expansion team shows up
 * as its code instead of vanishing from the table.
 */
function defenseName(abbr: string): string {
  return getTeamByAbbreviation(abbr)?.fullName ?? abbr;
}

/* ------------------------------------------------------------ the FPA table */

interface PositionFpa {
  /** Points allowed per game, as measured. */
  raw: number;
  /** The same, corrected for strength of schedule. */
  adj: number;
}

interface DefenseFpa {
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

type FpaTable = Map<string, DefenseFpa>;

function emptyPosRecord<T>(make: () => T): Record<FantasyPosition, T> {
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
function computeFpaTable(
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

function distinctWeeksDesc(rows: ScoredPlayerWeek[]): number[] {
  return [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
}

function rowsForWeeks(
  rows: ScoredPlayerWeek[],
  weeks: Set<number>,
): ScoredPlayerWeek[] {
  return rows.filter((r) => weeks.has(r.week));
}

interface BlendedDefense {
  abbr: string;
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

function buildPreseasonBaseline(full: FpaTable): Map<string, BlendedDefense> {
  const out = new Map<string, BlendedDefense>();
  for (const [abbr, def] of full) {
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) byPos[p] = { ...def.byPos[p] };
    out.set(abbr, { abbr, games: def.games, byPos });
  }
  return out;
}

function blendWithCurrent(
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

/* ------------------------------------------------------------- row builders */

function buildGamesRows(
  rows: ScoredPlayerWeek[],
  isBaseline: boolean,
): InsertFpaGame[] {
  const acc = new Map<string, { row: ScoredPlayerWeek; pts: number }>();
  for (const r of rows) {
    for (const format of SCORING_FORMATS) {
      const key = `${r.season}|${r.week}|${r.defenseTeam}|${r.position}|${format}`;
      const existing = acc.get(key);
      if (existing) existing.pts += r.points[format];
      else acc.set(key, { row: r, pts: r.points[format] });
    }
  }

  const out: InsertFpaGame[] = [];
  for (const [key, { row, pts }] of acc) {
    out.push({
      season: row.season,
      week: row.week,
      defenseTeamAbbr: row.defenseTeam,
      offenseTeamAbbr: row.team,
      position: row.position,
      scoringFormat: key.split("|")[4] as ScoringFormat,
      fantasyPoints: round2(pts).toString(),
      gamesCount: 1,
      isBaseline,
    });
  }
  return out;
}

function buildSnapshotRows(
  blended: Map<string, BlendedDefense>,
  format: ScoringFormat,
  season: number,
  weekNumber: number | null,
  dataMode: string,
): InsertFpaSnapshot[] {
  const out: InsertFpaSnapshot[] = [];
  for (const def of blended.values()) {
    const p = def.byPos;
    out.push({
      season,
      weekNumber,
      defenseTeamAbbr: def.abbr,
      defenseTeamName: defenseName(def.abbr),
      scoringFormat: format,
      qbFpaRaw: round2(p.QB.raw).toString(),
      rbFpaRaw: round2(p.RB.raw).toString(),
      wrFpaRaw: round2(p.WR.raw).toString(),
      teFpaRaw: round2(p.TE.raw).toString(),
      offFpaRaw: round2(p.QB.raw + p.RB.raw + p.WR.raw + p.TE.raw).toString(),
      qbFpaAdj: round2(p.QB.adj).toString(),
      rbFpaAdj: round2(p.RB.adj).toString(),
      wrFpaAdj: round2(p.WR.adj).toString(),
      teFpaAdj: round2(p.TE.adj).toString(),
      offFpaAdj: round2(p.QB.adj + p.RB.adj + p.WR.adj + p.TE.adj).toString(),
      gamesPlayed: def.games,
      dataMode,
    });
  }
  return out;
}

/* ------------------------------------------------------------- the ingest */

export interface IngestResult {
  currentSeason: number;
  baselineSeason: number;
  weekNumber: number | null;
  dataMode: string;
  isPreseason: boolean;
  snapshotRows: number;
  gameRows: number;
}

export interface IngestOptions {
  baselineSeason?: number;
  currentSeason?: number;
}

export async function ingestFpa(
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const baselineSeason = opts.baselineSeason ?? DEFAULT_BASELINE_SEASON;
  const currentSeason = opts.currentSeason ?? DEFAULT_CURRENT_SEASON;

  logger.info({ baselineSeason, currentSeason }, "FPA ingest started");

  const baselineRows = (await fetchScoredWeeklyStats(baselineSeason)).filter(
    (r) => r.week >= 1 && r.week <= MAX_WEEK,
  );
  if (baselineRows.length === 0) {
    throw new Error(`No baseline rows scored for ${baselineSeason}; aborting`);
  }

  // A season that has not started 404s, which is the normal preseason state
  // and not a failure. Any other fetch failure rethrows and writes nothing.
  let currentRows: ScoredPlayerWeek[] = [];
  try {
    currentRows = (await fetchScoredWeeklyStats(currentSeason)).filter(
      (r) => r.week >= 1 && r.week <= MAX_WEEK,
    );
  } catch (err) {
    if (err instanceof NflverseSeasonUnavailableError) {
      logger.info({ currentSeason }, "current season unpublished — baseline only");
    } else {
      throw err;
    }
  }

  const weeksPlayed = currentRows.length
    ? new Set(currentRows.map((r) => r.week)).size
    : 0;
  const isPreseason = weeksPlayed === 0;
  const weekNumber = isPreseason
    ? null
    : Math.max(...currentRows.map((r) => r.week));
  const dataMode = isPreseason ? "preseason_baseline" : `week_${weekNumber}`;

  // Weeks only move forward. A run that would serve fewer weeks than the table
  // already holds — nflverse briefly publishing a partial file, or a season
  // that 404s after it has been ingested — is a bad upstream day, not news.
  // Refusing keeps the last good table up; the next scheduled run tries again.
  const [stored] = await db
    .select({ week: max(fpaSnapshots.weekNumber) })
    .from(fpaSnapshots)
    .where(eq(fpaSnapshots.season, currentSeason));
  const storedWeek = stored?.week ?? null;
  if (storedWeek !== null && (weekNumber ?? 0) < storedWeek) {
    throw new Error(
      `FPA ingest refused: ${currentSeason} would go back from week ${storedWeek} ` +
        `to ${weekNumber === null ? "preseason" : `week ${weekNumber}`}`,
    );
  }

  const snapshotRows: InsertFpaSnapshot[] = [];
  for (const format of SCORING_FORMATS) {
    let blended = buildPreseasonBaseline(
      computeFpaTable(baselineRows, format),
    );

    if (!isPreseason) {
      const curWeeks =
        weeksPlayed >= 12
          ? new Set(distinctWeeksDesc(currentRows).slice(0, ROLLING_WINDOW_WEEKS))
          : new Set(currentRows.map((r) => r.week));
      blended = blendWithCurrent(
        blended,
        computeFpaTable(rowsForWeeks(currentRows, curWeeks), format),
        weeksPlayed,
      );
    }

    snapshotRows.push(
      ...buildSnapshotRows(blended, format, currentSeason, weekNumber, dataMode),
    );
  }

  const gameRows = [
    ...buildGamesRows(baselineRows, true),
    ...buildGamesRows(currentRows, false),
  ];

  const touchedSeasons = [baselineSeason];
  if (currentRows.length) touchedSeasons.push(currentSeason);

  // Replace, in one transaction: a reader must never see half of one ingest and
  // half of the last.
  await db.transaction(async (tx) => {
    await tx.delete(fpaSnapshots).where(eq(fpaSnapshots.season, currentSeason));
    await tx.delete(fpaGames).where(inArray(fpaGames.season, touchedSeasons));

    for (let i = 0; i < gameRows.length; i += 1000) {
      await tx.insert(fpaGames).values(gameRows.slice(i, i + 1000));
    }
    if (snapshotRows.length) {
      await tx.insert(fpaSnapshots).values(snapshotRows);
    }
  });

  logger.info(
    {
      currentSeason,
      baselineSeason,
      isPreseason,
      weekNumber,
      snapshots: snapshotRows.length,
      games: gameRows.length,
    },
    "FPA ingest complete",
  );

  return {
    currentSeason,
    baselineSeason,
    weekNumber,
    dataMode,
    isPreseason,
    snapshotRows: snapshotRows.length,
    gameRows: gameRows.length,
  };
}
