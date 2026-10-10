/**
 * Reading Fantasy Points Allowed for the page.
 *
 * The ingest does the work; this turns one query's worth of snapshot rows into
 * the ranked table the renderer prints, plus the two sentences that say what
 * the numbers currently are.
 *
 * **Rank 1 is the softest defense.** That is the industry convention
 * (FantasyPros and the rest) and it is the one that matches how the table is
 * read - you are looking for the matchup to attack, so the thing you want at
 * the top is the defense giving up the most. It is stated on the page too,
 * because a rank column with no stated direction is a coin flip.
 */

import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { db, fpaGames, fpaSnapshots, type FpaSnapshot } from "../db";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import {
  FANTASY_POSITIONS,
  type FantasyPosition,
  type ScoredPlayerWeek,
  type ScoringFormat,
} from "./nflverse";
import { computeFpaTable } from "./math";
import { describeDataMode, type FpaView } from "./blend";

// Re-exported so callers have one import for "the FPA read layer" - the split
// between this file and blend.ts exists to keep the pure half free of a
// database import, not to give consumers two places to look.
export { describeDataMode, parseFpaView, FPA_VIEWS, type FpaView } from "./blend";

export function parseFpaFormat(value: unknown): ScoringFormat {
  return value === "standard" || value === "ppr" || value === "half"
    ? value
    : "half";
}

export interface FpaRow {
  team: NflTeam | null;
  /** Upstream's abbreviation, kept for the rows the team table cannot resolve. */
  abbr: string;
  name: string;
  gamesPlayed: number;
  /** Points allowed per game, and the rank of that figure, per position. */
  byPos: Record<FantasyPosition, { fpa: number; rank: number }>;
  /** The four positions summed - the whole offense. */
  offFpa: number;
  offRank: number;
}

/**
 * Which table this is.
 *
 *   - `live`: the current season's blended figure, read from the snapshots the
 *     ingest writes - what the page has always served.
 *   - `archive`: a finished season in full, computed from the stored game rows
 *     (mak, 2026-10-10: "a real 2025 archive page"). No blend, no window:
 *     every figure is that season's own, weeks 1-17.
 */
export type FpaTableKind = "live" | "archive";

export interface FpaTableData {
  rows: FpaRow[];
  season: number;
  /** The season the live blend leans on early; the same as `season` for an archive. */
  baselineSeason: number;
  /** The season the bare address serves (currentFpaSeason()), whichever this table is. */
  currentSeason: number;
  kind: FpaTableKind;
  format: ScoringFormat;
  view: FpaView;
  /** Weeks of the current season played. Null in preseason. */
  weekNumber: number | null;
  isPreseason: boolean;
  /** When the served rows were written - the "Updated" date. Null when unknown. */
  updatedAtMs: number | null;
  /**
   * The finished seasons an archive page exists for, newest first, and never
   * `season` itself. What the season switch under the heading links to.
   */
  archiveSeasons: number[];
  /** A short label: "Preseason Baseline", "Week 3". */
  dataMode: string;
  /** One paragraph saying exactly what the number is a mix of. */
  methodology: string;
  /** Fingerprint of everything rendered - the render cache key. */
  version: string;
}

/** Rank 1 = most points allowed = softest matchup. */
function rankDescending(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);
  const ranks = new Array<number>(values.length);
  order.forEach((entry, i) => {
    ranks[entry.index] = i + 1;
  });
  return ranks;
}

function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export interface FpaQuery {
  season?: number;
  format?: ScoringFormat;
  view?: FpaView;
  baselineSeason?: number;
}

/**
 * The table for one (season, format, view), or null when nothing is ingested.
 *
 * Null rather than an empty table on purpose: a page of 32 zeroes is worse than
 * no page, and the caller needs to tell "the ingest has not run" from "these
 * are the numbers".
 */
/** The season the live table describes: FPA_CURRENT_SEASON, 2026 unset. */
export function currentFpaSeason(): number {
  return Number(process.env["FPA_CURRENT_SEASON"] ?? 2026);
}

/**
 * Is this season served as an archive - that is, not the current one?
 *
 * The current season is the snapshots' blended figure; every other season
 * with stored game rows is read in full. A request for the current season by
 * name is the default table under another spelling, and is read as such.
 */
export function isFpaArchiveSeason(season: number): boolean {
  return season !== currentFpaSeason();
}

export async function getFpaTable(
  query: FpaQuery = {},
): Promise<FpaTableData | null> {
  const season = query.season ?? currentFpaSeason();
  const baselineSeason =
    query.baselineSeason ?? Number(process.env["FPA_BASELINE_SEASON"] ?? 2025);
  const format = query.format ?? "half";
  const view = query.view ?? "raw";

  const key = `${season}|${baselineSeason}|${format}|${view}`;
  const now = Date.now();
  const memo = tableMemo.get(key);
  if (memo && now - memo.at < TABLE_MEMO_MS) return memo.table;

  let running = tableInFlight.get(key);
  if (!running) {
    running = (
      isFpaArchiveSeason(season)
        ? readFpaArchiveTable(season, format, view)
        : readFpaTable(season, baselineSeason, format, view)
    ).finally(() => {
      tableInFlight.delete(key);
    });
    tableInFlight.set(key, running);
  }
  const table = await running;
  // An empty table is not held: it is the state the first ingest is about to
  // change, and the page should show the numbers as soon as they land.
  if (table) tableMemo.set(key, { table, at: now });
  return table;
}

/**
 * The table, held briefly. It changes once a week, when an ingest runs, and
 * was read from the database on every FPA page, every matchup page (twice)
 * and every player page's upcoming games. An in-process ingest drops it
 * straight away (fpa/refresh.ts); the window only bounds how long an ingest
 * run from another process - scripts/ingest-fpa.mjs - takes to show.
 */
const TABLE_MEMO_MS = 5 * 60 * 1000;
const tableMemo = new Map<string, { table: FpaTableData; at: number }>();
const tableInFlight = new Map<string, Promise<FpaTableData | null>>();

export function invalidateFpaTableCache(): void {
  tableMemo.clear();
  tableInFlight.clear();
  archiveSeasonsMemo = null;
}

async function readFpaTable(
  season: number,
  baselineSeason: number,
  format: ScoringFormat,
  view: FpaView,
): Promise<FpaTableData | null> {

  const snapshots: FpaSnapshot[] = await db
    .select()
    .from(fpaSnapshots)
    .where(
      and(
        eq(fpaSnapshots.season, season),
        eq(fpaSnapshots.scoringFormat, format),
      ),
    );

  if (snapshots.length === 0) return null;

  const pick = (raw: string, adj: string) => toNumber(view === "raw" ? raw : adj);

  const rows = rankRows(
    snapshots.map((s) => ({
      abbr: s.defenseTeamAbbr,
      name: s.defenseTeamName,
      gamesPlayed: s.gamesPlayed,
      fpa: {
        QB: pick(s.qbFpaRaw, s.qbFpaAdj),
        RB: pick(s.rbFpaRaw, s.rbFpaAdj),
        WR: pick(s.wrFpaRaw, s.wrFpaAdj),
        TE: pick(s.teFpaRaw, s.teFpaAdj),
      } as Record<FantasyPosition, number>,
      offFpa: pick(s.offFpaRaw, s.offFpaAdj),
    })),
  );

  const weekNumber = snapshots[0]!.weekNumber;
  const { dataMode, methodology, isPreseason } = describeDataMode(
    weekNumber,
    baselineSeason,
    season,
  );

  // The newest row's insert time, so a fresh ingest invalidates the render
  // and nothing else does. It is also the page's "Updated" date.
  const updatedAtMs = snapshots.reduce(
    (newest, s) => Math.max(newest, s.createdAt?.getTime() ?? 0),
    0,
  );

  return {
    rows,
    season,
    baselineSeason,
    currentSeason: currentFpaSeason(),
    kind: "live",
    format,
    view,
    weekNumber,
    isPreseason,
    updatedAtMs: updatedAtMs || null,
    archiveSeasons: await listFpaArchiveSeasons(season),
    dataMode,
    methodology,
    version: [season, format, view, weekNumber ?? 0, rows.length, updatedAtMs].join("-"),
  };
}

interface UnrankedRow {
  abbr: string;
  name: string;
  gamesPlayed: number;
  fpa: Record<FantasyPosition, number>;
  offFpa: number;
}

/**
 * Rank the 32 defenses and sort them softest overall first - the table's
 * default reading, and the one the sort control starts from. Shared by the
 * live and archive reads so the two tables can never rank differently.
 */
function rankRows(base: UnrankedRow[]): FpaRow[] {
  const ranksByPos = Object.fromEntries(
    FANTASY_POSITIONS.map((p) => [p, rankDescending(base.map((r) => r.fpa[p]))]),
  ) as Record<FantasyPosition, number[]>;
  const offRanks = rankDescending(base.map((r) => r.offFpa));

  const rows: FpaRow[] = base.map((row, i) => {
    const team = getTeamByAbbreviation(row.abbr);
    return {
      team,
      abbr: row.abbr,
      // Prefer the canonical name over the one stored at ingest time, so a
      // rename lands everywhere at once rather than on the next ingest.
      name: team?.fullName ?? row.name,
      gamesPlayed: row.gamesPlayed,
      byPos: Object.fromEntries(
        FANTASY_POSITIONS.map((p) => [
          p,
          { fpa: row.fpa[p], rank: ranksByPos[p][i]! },
        ]),
      ) as FpaRow["byPos"],
      offFpa: row.offFpa,
      offRank: offRanks[i]!,
    };
  });

  rows.sort((a, b) => a.offRank - b.offRank);
  return rows;
}

/* ---------------------------------------------------------------- archive */

/** Both tables stop at week 17; see MAX_WEEK in ingest.ts. */
const ARCHIVE_MAX_WEEK = 17;

/**
 * A finished season in full, from the stored game rows.
 *
 * The ingest keeps one row per (season, week, defense, position, format) for
 * every season it has read - the prior season as the blend's baseline, the
 * current one as it goes - and never deletes a season it has stopped reading.
 * So last season's whole table is already in the database, and this computes
 * it with the same arithmetic the ingest applies (computeFpaTable: raw per
 * game, and the adjustment for the offenses faced), with nothing blended in.
 *
 * Null when the season has no rows, which is the 404 the routes answer with.
 */
async function readFpaArchiveTable(
  season: number,
  format: ScoringFormat,
  view: FpaView,
): Promise<FpaTableData | null> {
  const games = await db
    .select({
      week: fpaGames.week,
      defense: fpaGames.defenseTeamAbbr,
      offense: fpaGames.offenseTeamAbbr,
      position: fpaGames.position,
      points: fpaGames.fantasyPoints,
      createdAt: fpaGames.createdAt,
    })
    .from(fpaGames)
    .where(
      and(
        eq(fpaGames.season, season),
        eq(fpaGames.scoringFormat, format),
        lte(fpaGames.week, ARCHIVE_MAX_WEEK),
      ),
    );

  if (games.length === 0) return null;

  // computeFpaTable reads `points[format]`; one format's rows are loaded, so
  // the same figure is written under all three names.
  const scored: ScoredPlayerWeek[] = [];
  let updatedAtMs = 0;
  for (const g of games) {
    if (!(FANTASY_POSITIONS as readonly string[]).includes(g.position)) continue;
    const pts = toNumber(g.points);
    scored.push({
      season,
      week: g.week,
      seasonType: "REG",
      position: g.position as FantasyPosition,
      team: g.offense,
      defenseTeam: g.defense,
      receptions: 0,
      points: { standard: pts, half: pts, ppr: pts },
    });
    updatedAtMs = Math.max(updatedAtMs, g.createdAt?.getTime() ?? 0);
  }
  if (scored.length === 0) return null;

  const table = computeFpaTable(scored, format);
  const pick = (p: { raw: number; adj: number }) => (view === "raw" ? p.raw : p.adj);
  const rows = rankRows(
    [...table.entries()].map(([abbr, def]) => {
      const fpa = Object.fromEntries(
        FANTASY_POSITIONS.map((p) => [p, pick(def.byPos[p])]),
      ) as Record<FantasyPosition, number>;
      return {
        abbr,
        name: getTeamByAbbreviation(abbr)?.fullName ?? abbr,
        gamesPlayed: def.games,
        fpa,
        offFpa: FANTASY_POSITIONS.reduce((sum, p) => sum + fpa[p], 0),
      };
    }),
  );

  const throughWeek = Math.max(...scored.map((r) => r.week));

  return {
    rows,
    season,
    baselineSeason: season,
    currentSeason: currentFpaSeason(),
    kind: "archive",
    format,
    view,
    weekNumber: throughWeek,
    isPreseason: false,
    // A finished season has no "Updated" date worth printing: the rows' write
    // time is whenever the ingest last re-read the baseline, not news about
    // the figures. The version below still carries it, so a re-ingest that
    // changed a row still invalidates the render.
    updatedAtMs: null,
    archiveSeasons: await listFpaArchiveSeasons(season),
    dataMode: "Full season",
    methodology:
      `The complete ${season} regular season, weeks 1-${throughWeek}: every figure ` +
      `is ${season} data, with nothing blended in from another season. Week 18 ` +
      `is left out, as it is from the current table.`,
    version: [season, format, view, "archive", rows.length, updatedAtMs].join("-"),
  };
}

/**
 * The seasons an archive table can be read for, newest first: every season
 * with stored game rows other than the current one, and other than `except`
 * (the season being rendered, which does not link to itself). Memoized with
 * the tables; the set changes once a year.
 */
export async function listFpaArchiveSeasons(except?: number): Promise<number[]> {
  const now = Date.now();
  if (!archiveSeasonsMemo || now - archiveSeasonsMemo.at >= TABLE_MEMO_MS) {
    const current = currentFpaSeason();
    const found = await db
      .select({ season: fpaGames.season, weeks: sql<number>`count(distinct ${fpaGames.week})` })
      .from(fpaGames)
      .where(ne(fpaGames.season, current))
      .groupBy(fpaGames.season);
    const seasons = found
      // A season with a handful of weeks is not an archive; the baseline has 17.
      .filter((r) => Number(r.weeks) >= ARCHIVE_MIN_WEEKS)
      .map((r) => r.season)
      .sort((a, b) => b - a);
    archiveSeasonsMemo = { seasons, at: now };
  }
  return archiveSeasonsMemo.seasons.filter((s) => s !== except);
}

/** Fewer distinct weeks than this and a season is not offered as an archive. */
const ARCHIVE_MIN_WEEKS = 15;
let archiveSeasonsMemo: { seasons: number[]; at: number } | null = null;

/**
 * When the served rows were written, and what they are.
 *
 * Read from the database rather than from process memory, which is the whole
 * point of it: `fpaRefreshStatus()` says what this process has done since it
 * started, and a deployment that has never run an ingest looks identical there
 * to one that ran a perfect ingest before its last redeploy. This is the figure
 * that would have said, out loud, that production was serving a table written
 * two days earlier - so it is what /api/status reports.
 *
 * Newest row rather than an aggregate: one ingest writes every row for the
 * season inside one transaction, so the newest one carries the week and the
 * blend mode as well as the time.
 */
export interface FpaSnapshotState {
  season: number;
  /** When the rows were written. Null when the season has no rows at all. */
  writtenAtMs: number | null;
  /** Weeks of the season the figure includes. Null in preseason, or with no rows. */
  weekNumber: number | null;
  /** What the blend was - "preseason_baseline", "week_3". Null with no rows. */
  dataMode: string | null;
}

export async function fpaSnapshotState(
  season?: number,
): Promise<FpaSnapshotState> {
  const target = season ?? Number(process.env["FPA_CURRENT_SEASON"] ?? 2026);

  const [newest] = await db
    .select({
      createdAt: fpaSnapshots.createdAt,
      weekNumber: fpaSnapshots.weekNumber,
      dataMode: fpaSnapshots.dataMode,
    })
    .from(fpaSnapshots)
    .where(eq(fpaSnapshots.season, target))
    .orderBy(desc(fpaSnapshots.createdAt))
    .limit(1);

  return {
    season: target,
    writtenAtMs: newest?.createdAt?.getTime() ?? null,
    weekNumber: newest?.weekNumber ?? null,
    dataMode: newest?.dataMode ?? null,
  };
}
