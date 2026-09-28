/**
 * Reading Fantasy Points Allowed for the page.
 *
 * The ingest does the work; this turns one query's worth of snapshot rows into
 * the ranked table the renderer prints, plus the two sentences that say what
 * the numbers currently are.
 *
 * **Rank 1 is the softest defense.** That is the industry convention
 * (FantasyPros and the rest) and it is the one that matches how the table is
 * read — you are looking for the matchup to attack, so the thing you want at
 * the top is the defense giving up the most. It is stated on the page too,
 * because a rank column with no stated direction is a coin flip.
 */

import { and, desc, eq } from "drizzle-orm";
import { db, fpaSnapshots, type FpaSnapshot } from "../db";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { FANTASY_POSITIONS, type FantasyPosition, type ScoringFormat } from "./nflverse";
import { describeDataMode, type FpaView } from "./blend";

// Re-exported so callers have one import for "the FPA read layer" — the split
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
  /** The four positions summed — the whole offense. */
  offFpa: number;
  offRank: number;
}

export interface FpaTableData {
  rows: FpaRow[];
  season: number;
  format: ScoringFormat;
  view: FpaView;
  /** Weeks of the current season played. Null in preseason. */
  weekNumber: number | null;
  isPreseason: boolean;
  /** A short label: "Preseason Baseline", "Week 3". */
  dataMode: string;
  /** One paragraph saying exactly what the number is a mix of. */
  methodology: string;
  /** Fingerprint of everything rendered — the render cache key. */
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
export async function getFpaTable(
  query: FpaQuery = {},
): Promise<FpaTableData | null> {
  const season = query.season ?? Number(process.env["FPA_CURRENT_SEASON"] ?? 2026);
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
    running = readFpaTable(season, baselineSeason, format, view).finally(() => {
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
 * run from another process — scripts/ingest-fpa.mjs — takes to show.
 */
const TABLE_MEMO_MS = 5 * 60 * 1000;
const tableMemo = new Map<string, { table: FpaTableData; at: number }>();
const tableInFlight = new Map<string, Promise<FpaTableData | null>>();

export function invalidateFpaTableCache(): void {
  tableMemo.clear();
  tableInFlight.clear();
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

  const base = snapshots.map((s) => ({
    snapshot: s,
    abbr: s.defenseTeamAbbr,
    team: getTeamByAbbreviation(s.defenseTeamAbbr),
    name: s.defenseTeamName,
    gamesPlayed: s.gamesPlayed,
    fpa: {
      QB: pick(s.qbFpaRaw, s.qbFpaAdj),
      RB: pick(s.rbFpaRaw, s.rbFpaAdj),
      WR: pick(s.wrFpaRaw, s.wrFpaAdj),
      TE: pick(s.teFpaRaw, s.teFpaAdj),
    } as Record<FantasyPosition, number>,
    offFpa: pick(s.offFpaRaw, s.offFpaAdj),
  }));

  const ranksByPos = Object.fromEntries(
    FANTASY_POSITIONS.map((p) => [p, rankDescending(base.map((r) => r.fpa[p]))]),
  ) as Record<FantasyPosition, number[]>;
  const offRanks = rankDescending(base.map((r) => r.offFpa));

  const rows: FpaRow[] = base.map((row, i) => ({
    team: row.team,
    abbr: row.abbr,
    // Prefer the canonical name over the one stored at ingest time, so a
    // rename lands everywhere at once rather than on the next ingest.
    name: row.team?.fullName ?? row.name,
    gamesPlayed: row.gamesPlayed,
    byPos: Object.fromEntries(
      FANTASY_POSITIONS.map((p) => [
        p,
        { fpa: row.fpa[p], rank: ranksByPos[p][i]! },
      ]),
    ) as FpaRow["byPos"],
    offFpa: row.offFpa,
    offRank: offRanks[i]!,
  }));

  // Softest overall first — the table's default reading, and the one the sort
  // control starts from.
  rows.sort((a, b) => a.offRank - b.offRank);

  const weekNumber = snapshots[0]!.weekNumber;
  const { dataMode, methodology, isPreseason } = describeDataMode(
    weekNumber,
    baselineSeason,
    season,
  );

  return {
    rows,
    season,
    format,
    view,
    weekNumber,
    isPreseason,
    dataMode,
    methodology,
    version: [
      season,
      format,
      view,
      weekNumber ?? 0,
      rows.length,
      // The newest row's insert time, so a fresh ingest invalidates the render
      // and nothing else does.
      snapshots.reduce(
        (newest, s) => Math.max(newest, s.createdAt?.getTime() ?? 0),
        0,
      ),
    ].join("-"),
  };
}

/**
 * When the served rows were written, and what they are.
 *
 * Read from the database rather than from process memory, which is the whole
 * point of it: `fpaRefreshStatus()` says what this process has done since it
 * started, and a deployment that has never run an ingest looks identical there
 * to one that ran a perfect ingest before its last redeploy. This is the figure
 * that would have said, out loud, that production was serving a table written
 * two days earlier — so it is what /api/status reports.
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
  /** What the blend was — "preseason_baseline", "week_3". Null with no rows. */
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
