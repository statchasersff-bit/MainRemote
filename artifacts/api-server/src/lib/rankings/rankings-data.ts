/**
 * Every read of `data/rankings/`, plus the domain logic over it.
 *
 * Ported from the standalone Redraft-Rankings-table app
 * (statchasersff-bit/Redraft-Rankings-table), which was a Vite SPA that fetched
 * a CSV in the browser and drew the boards from it. The rankings themselves —
 * the tier rules, the per-position limits, the side-by-side "All" view — are
 * that app's and are reproduced here unchanged. What is new is where they run:
 * on the server, so `[statchasers_rankings]` prints a finished board into a
 * WordPress page the way the other four tools do.
 *
 * Three things that were network calls over there are file reads here:
 *
 *   - **the rankings** come off disk, not `fetch("/rankings.csv")`;
 *   - **team abbreviations** come from `data/player/players.json` rather than a
 *     700 kB Sleeper name→team map shipped beside the CSV. This app already has
 *     the dictionary loaded for the player pages, and it resolves all 230
 *     displayed players;
 *   - **player links** point at this app's own player pages rather than a
 *     hard-coded statchasers.com URL, so the same rule the other tools follow
 *     applies: the shortcode decides where a link goes, not the renderer.
 *
 * A player who resolves to no page is rendered as plain text. That is rule 1
 * from fpa-render.ts — a field we do not have is not rendered — and it is why
 * the four free agents in the current board lose their link and keep their row
 * rather than pointing at a 404.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { loadPlayers, loadIndexedSlugs } from "../player/data";

const DATA_DIR = path.resolve(process.cwd(), "data", "rankings");

/* ------------------------------------------------------------------- shape */

export interface RankedPlayer {
  /** Positional rank, 1-based. QB1 is rank 1, as is RB1. */
  rank: number;
  /** Tier, derived from the rank by TIER_RULES. Never stored in the CSV. */
  tier: number;
  name: string;
  position: StatPosition;
  /** NFL team abbreviation, or null when the player is not on a roster. */
  team: string | null;
  /** This app's player-page slug, when the player has a page. */
  slug: string | null;
}

/** One row of the side-by-side board: the nth-ranked player at each position. */
export interface AllRow {
  rank: number;
  QB: RankedPlayer | null;
  RB: RankedPlayer | null;
  WR: RankedPlayer | null;
  TE: RankedPlayer | null;
}

export interface TierGroup {
  tier: number;
  players: RankedPlayer[];
}

export interface RankingsData {
  season: number;
  scoring: string;
  /** The human line the boards print, e.g. "August 31, 2026 9:33am ET". */
  updatedAt: string;
  /** The same instant as an ISO string, for `<time datetime>`. */
  updatedAtIso: string | null;
  /** Tier-grouped boards, one per position. */
  byPosition: Record<StatPosition, TierGroup[]>;
  /** The rank-aligned side-by-side board. */
  all: AllRow[];
  /** Fingerprint of the files this was built from — the response ETag. */
  version: string;
}

/* ------------------------------------------------------------- the rankings */

export const POSITIONS = ["All", "QB", "RB", "WR", "TE"] as const;
export type PositionFilter = (typeof POSITIONS)[number];

export const STAT_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type StatPosition = (typeof STAT_POSITIONS)[number];

export const POSITION_NAMES: Record<StatPosition, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
};

export const POSITION_PLURALS: Record<StatPosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
};

/**
 * Where each tier ends, as `[lastRank, tier]` in ascending order.
 *
 * These are editorial, not computed — the cliff between QB5 and QB6 is a
 * judgement about the position, and the whole point of a tiered board is that
 * somebody drew the lines. Copied verbatim from the standalone app.
 */
export const TIER_RULES: Record<StatPosition, Array<[number, number]>> = {
  QB: [[5, 1], [13, 2], [20, 3], [26, 4], [35, 5], [40, 6]],
  RB: [[4, 1], [11, 2], [15, 3], [24, 4], [31, 5], [36, 6], [50, 7]],
  WR: [[4, 1], [12, 2], [20, 3], [29, 4], [38, 5], [47, 6], [63, 7]],
  TE: [[3, 1], [9, 2], [16, 3], [21, 4], [29, 5], [39, 6]],
};

/**
 * How deep each board goes.
 *
 * The CSV runs far deeper than this — 261 wide receivers — because it is the
 * working file the rankings are maintained in. Printing all 713 would be a page
 * nobody reads past the top of, so the boards stop where the tiers do.
 */
export const POSITION_LIMITS: Record<StatPosition, number> = {
  QB: 40,
  RB: 50,
  WR: 100,
  TE: 40,
};

/** Rows of the All board shown before "Show all" is used. */
export const ALL_VIEW_COLLAPSED_ROWS = 50;

export function getTier(position: StatPosition, rank: number): number {
  const rules = TIER_RULES[position];
  for (const [maxRank, tier] of rules) {
    if (rank <= maxRank) return tier;
  }
  return rules[rules.length - 1]?.[1] ?? 1;
}

/**
 * Fold a name to something two spellings of the same player agree on.
 *
 * Strips generational suffixes and punctuation, so the CSV's "Michael Pittman
 * Jr." matches the dictionary's "Michael Pittman" and "Ja'Marr Chase" matches
 * "JaMarr Chase". Both sides of every lookup go through this.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ the CSV */

/**
 * Parse the rankings CSV.
 *
 * Hand-rolled rather than papaparse, because the file this reads is one we
 * produce: three columns, no quoting, no embedded newlines. A row that is not
 * those three things is dropped rather than guessed at — a malformed line
 * should cost one player, not the board.
 */
export function parseRankingsCsv(csv: string): Array<{
  position: StatPosition;
  rank: number;
  name: string;
}> {
  const rows: Array<{ position: StatPosition; rank: number; name: string }> = [];
  const known = new Set<string>(STAT_POSITIONS);

  for (const line of csv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const first = trimmed.indexOf(",");
    const second = trimmed.indexOf(",", first + 1);
    if (first === -1 || second === -1) continue;

    const position = trimmed.slice(0, first).trim().toUpperCase();
    const rank = Number.parseInt(trimmed.slice(first + 1, second).trim(), 10);
    // Everything after the second comma, so a name with a comma in it survives.
    const name = trimmed.slice(second + 1).trim();

    if (!known.has(position)) continue; // also skips the header row
    if (!Number.isFinite(rank) || rank < 1) continue;
    if (name === "") continue;

    rows.push({ position: position as StatPosition, rank, name });
  }

  return rows;
}

/* --------------------------------------------------------- the player index */

interface Resolved {
  team: string | null;
  slug: string | null;
}

let resolverCache: Map<string, Resolved> | null = null;

/**
 * name+position → team and page slug, from the player dictionary.
 *
 * Keyed on the position too, because normalised names are not unique across the
 * league and matching a wide receiver against a quarterback of the same name
 * would print the wrong team. Where several entries collide on one key the one
 * with a page wins, then the active one — the dictionary carries retired
 * players, and the board is about who is playing.
 *
 * `slug` is only set for players the player-page index actually covers, so a
 * link is only ever rendered to a page that exists.
 */
function resolver(): Map<string, Resolved> {
  if (resolverCache) return resolverCache;

  const indexed = new Set(loadIndexedSlugs());
  const positions = new Set<string>(STAT_POSITIONS);
  const best = new Map<string, { value: Resolved; score: number }>();

  for (const player of loadPlayers()) {
    if (!player.position || !positions.has(player.position)) continue;

    const hasPage = indexed.has(player.slug);
    const score = (hasPage ? 2 : 0) + (player.status === "Active" ? 1 : 0);
    const key = `${normalizeName(player.name)}|${player.position}`;

    const prev = best.get(key);
    if (prev && prev.score >= score) continue;

    best.set(key, {
      score,
      value: {
        team: player.team ? player.team.toUpperCase() : null,
        slug: hasPage ? player.slug : null,
      },
    });
  }

  resolverCache = new Map(
    Array.from(best, ([key, entry]) => [key, entry.value] as const),
  );
  logger.info(
    { players: resolverCache.size },
    "Built the rankings player resolver",
  );
  return resolverCache;
}

/** Testing seam, and what the data-file watcher would call. */
export function invalidateRankingsCache(): void {
  resolverCache = null;
  dataCache.clear();
  seasonsCache = null;
}

/* ------------------------------------------------------------ the boards */

/** The top `limit` players at one position, tier-tagged and rank-sorted. */
export function buildPositionBoard(
  rows: Array<{ position: StatPosition; rank: number; name: string }>,
  position: StatPosition,
): RankedPlayer[] {
  const index = resolver();

  return rows
    .filter((row) => row.position === position)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, POSITION_LIMITS[position])
    .map((row) => {
      const found = index.get(`${normalizeName(row.name)}|${position}`);
      return {
        rank: row.rank,
        tier: getTier(position, row.rank),
        name: row.name,
        position,
        team: found?.team ?? null,
        slug: found?.slug ?? null,
      };
    });
}

export function groupByTier(players: RankedPlayer[]): TierGroup[] {
  const groups = new Map<number, RankedPlayer[]>();
  for (const player of players) {
    const bucket = groups.get(player.tier);
    if (bucket) bucket.push(player);
    else groups.set(player.tier, [player]);
  }
  return Array.from(groups.keys())
    .sort((a, b) => a - b)
    .map((tier) => ({ tier, players: groups.get(tier) ?? [] }));
}

/**
 * The side-by-side board: row n is the nth-ranked player at each position.
 *
 * Deliberately NOT an overall board. These are four positional rankings aligned
 * by rank, which is a draft-board reading ("if I take a receiver here, what am I
 * passing up at running back?") and not a claim that QB7 and RB7 are worth the
 * same pick. The caption says so, because the shape invites the other reading.
 */
export function buildAllBoard(
  boards: Record<StatPosition, RankedPlayer[]>,
): AllRow[] {
  const depth = Math.max(...STAT_POSITIONS.map((pos) => boards[pos].length));

  return Array.from({ length: depth }, (_, i) => ({
    rank: i + 1,
    QB: boards.QB[i] ?? null,
    RB: boards.RB[i] ?? null,
    WR: boards.WR[i] ?? null,
    TE: boards.TE[i] ?? null,
  }));
}

/* ----------------------------------------------------------------- loading */

interface RankingsMeta {
  season?: number;
  scoring?: string;
  updatedAt?: string;
  updatedAtIso?: string;
}

let seasonsCache: number[] | null = null;

/** Seasons with a rankings file, newest first. */
export function getRankingsSeasons(): number[] {
  if (seasonsCache) return seasonsCache;

  let names: string[] = [];
  try {
    names = fs.readdirSync(DATA_DIR);
  } catch {
    logger.warn("No data/rankings directory; the rankings board will be empty");
  }

  seasonsCache = names
    .map((name) => /^redraft-(\d{4})\.csv$/.exec(name)?.[1])
    .map((year) => Number.parseInt(year ?? "", 10))
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a);

  return seasonsCache;
}

const dataCache = new Map<number, RankingsData>();

/**
 * The board for one season, or null when there is no file for it.
 *
 * Cached on the CSV's mtime, in the same spirit as `dataStamp()` on the player
 * side: replacing the file is what invalidates a render, and nothing else does.
 * A rankings update is a commit, so this costs one stat per request and never
 * re-parses a file that has not moved.
 */
export function getRankings(season?: number): RankingsData | null {
  const resolved = season ?? getRankingsSeasons()[0];
  if (resolved === undefined) return null;

  const csvFile = path.join(DATA_DIR, `redraft-${resolved}.csv`);

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(csvFile).mtimeMs;
  } catch {
    return null;
  }

  const version = `${resolved}-${Math.round(mtimeMs).toString(36)}`;
  const hit = dataCache.get(resolved);
  if (hit && hit.version === version) return hit;

  let csv: string;
  try {
    csv = fs.readFileSync(csvFile, "utf8");
  } catch (err) {
    logger.warn({ err, season: resolved }, "Could not read the rankings CSV");
    return null;
  }

  let meta: RankingsMeta = {};
  try {
    meta = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, `redraft-${resolved}.meta.json`), "utf8"),
    ) as RankingsMeta;
  } catch {
    // Optional, like every file on the player side: without it the board still
    // renders and simply does not claim a date it cannot support.
  }

  const rows = parseRankingsCsv(csv);
  if (rows.length === 0) {
    logger.warn({ season: resolved }, "The rankings CSV parsed to no rows");
    return null;
  }

  const boards = {} as Record<StatPosition, RankedPlayer[]>;
  for (const pos of STAT_POSITIONS) boards[pos] = buildPositionBoard(rows, pos);

  const byPosition = {} as Record<StatPosition, TierGroup[]>;
  for (const pos of STAT_POSITIONS) byPosition[pos] = groupByTier(boards[pos]);

  const data: RankingsData = {
    season: meta.season ?? resolved,
    scoring: meta.scoring ?? "PPR",
    updatedAt: meta.updatedAt ?? "",
    updatedAtIso: meta.updatedAtIso ?? null,
    byPosition,
    all: buildAllBoard(boards),
    version,
  };

  dataCache.set(resolved, data);
  logger.info(
    { season: data.season, players: rows.length },
    "Loaded redraft rankings",
  );
  return data;
}

/** Every player on the boards, rank order within position. Used by the CSV. */
export function flattenRankings(data: RankingsData): RankedPlayer[] {
  return STAT_POSITIONS.flatMap((pos) =>
    data.byPosition[pos].flatMap((group) => group.players),
  );
}
