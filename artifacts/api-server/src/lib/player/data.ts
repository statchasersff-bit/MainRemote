/**
 * Every read of `data/player/`, in one place.
 *
 * The player pages are built from a pile of JSON that a set of build scripts
 * produces offline (see `scripts/player/`), not from a live API. That is the
 * whole reason these pages can be server-rendered cheaply: assembling a profile
 * is arithmetic over objects that are already in memory, with no upstream in
 * the request path at all.
 *
 * Three rules hold here.
 *
 * First, **every file is optional**. A deployment that has not been given
 * `bios.json` renders a profile without a bio section rather than a 500. The
 * loaders return an empty collection and log once, mirroring how the team hub
 * treats a provider that is down: a missing section, never an empty shell.
 *
 * Second, **nothing is re-read per request**. These files total ~13MB and never
 * change while a process is alive (they are committed, not written at runtime),
 * so each is parsed at most once and held. `players.json` is the exception —
 * it is re-stat'd on an interval so a rebuilt file is picked up without a
 * restart, which is what the build scripts expect during development.
 *
 * Third, **the mtimes are the version**. `dataStamp()` fingerprints the files
 * on disk, and the render cache keys on it, so replacing a data file
 * invalidates every rendered fragment and nothing else does.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import type {
  BioFacts,
  DraftRecord,
  DynastyData,
  FantasyOutlook2026,
  GameLogEntry,
  Player,
  PlayerBio,
} from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data", "player");

const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const INDEXED_FILE = path.join(DATA_DIR, "indexed_players.json");
const INDEXED_BY_TEAM_FILE = path.join(DATA_DIR, "indexed_players_by_team.json");
const GAME_LOGS_DIR = path.join(DATA_DIR, "game_logs");
const BYE_WEEKS_FILE = path.join(DATA_DIR, "bye_weeks.json");
const GAME_SCORES_FILE = path.join(DATA_DIR, "game_scores.json");
const DYNASTY_FILE = path.join(DATA_DIR, "dynasty_rankings.json");
const BIOS_FILE = path.join(DATA_DIR, "bios.json");
const BIO_FACTS_FILE = path.join(DATA_DIR, "bio_facts.json");
const DRAFT_FILE = path.join(DATA_DIR, "draft.json");
const OUTLOOK_FILE = path.join(DATA_DIR, "fantasy_outlook_2026.json");
const PRODUCTION_FILE = path.join(DATA_DIR, "player_production.json");
const INJURIES_FILE = path.join(DATA_DIR, "player_injuries.json");
const ADVANCED_DIR = path.join(DATA_DIR, "advanced_stats");

/** How often `players.json` is re-stat'd for an out-of-band rebuild. */
const PLAYERS_RECHECK_MS = 10 * 60 * 1000;

/**
 * Read and parse one JSON file, or return the fallback.
 *
 * Failures are logged once per file rather than per call: a missing data file
 * is a deployment fact, and repeating it on every page view would bury
 * everything else in the log.
 */
const warned = new Set<string>();

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    if (!warned.has(file)) {
      warned.add(file);
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      logger.warn(
        { file: path.basename(file), err: missing ? undefined : err },
        missing
          ? "Player data file not found; the sections it feeds will be omitted"
          : "Player data file could not be parsed; the sections it feeds will be omitted",
      );
    }
    return fallback;
  }
}

/** A lazily-loaded, permanently-held JSON document. */
function lazy<T>(file: string, fallback: T): () => T {
  let value: T | null = null;
  return () => {
    if (value === null) value = readJson<T>(file, fallback);
    return value;
  };
}

/* ------------------------------------------------------------------ players */

let playersCache: Player[] | null = null;
let playersBySlug: Map<string, Player> | null = null;
let playersMtimeMs = 0;
let playersCheckedAt = 0;

/**
 * The full player dictionary.
 *
 * Team abbreviations are left exactly as the file has them (upper case, and
 * occasionally an alias like JAC or WSH). Normalising happens at the point of
 * use through `lib/team/teams.ts`, which is the only thing in this codebase
 * allowed to hold a team mapping.
 */
export function loadPlayers(): Player[] {
  const now = Date.now();

  if (playersCache && now - playersCheckedAt < PLAYERS_RECHECK_MS) {
    return playersCache;
  }
  playersCheckedAt = now;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(PLAYERS_FILE).mtimeMs;
  } catch {
    if (!playersCache) {
      playersCache = readJson<Player[]>(PLAYERS_FILE, []);
      playersBySlug = new Map();
    }
    return playersCache;
  }

  if (playersCache && mtimeMs === playersMtimeMs) return playersCache;

  const rows = readJson<Player[]>(PLAYERS_FILE, []);
  playersCache = rows;
  playersBySlug = new Map(rows.map((p) => [p.slug, p]));
  playersMtimeMs = mtimeMs;
  logger.info({ count: rows.length }, "Loaded player dictionary");
  return rows;
}

export function getPlayerBySlug(slug: string): Player | null {
  if (!playersBySlug) loadPlayers();
  return playersBySlug?.get(slug) ?? null;
}

/* ---------------------------------------------------------------- game logs */

const gameLogsCache = new Map<number, Record<string, GameLogEntry[]>>();

export function loadGameLogs(season: number): Record<string, GameLogEntry[]> {
  const hit = gameLogsCache.get(season);
  if (hit) return hit;
  const data = readJson<Record<string, GameLogEntry[]>>(
    path.join(GAME_LOGS_DIR, `${season}.json`),
    {},
  );
  gameLogsCache.set(season, data);
  return data;
}

let seasonsCache: number[] | null = null;

/** Seasons with a game-log file, newest first. */
export function getAvailableSeasons(): number[] {
  if (seasonsCache) return seasonsCache;
  let names: string[] = [];
  try {
    names = fs.readdirSync(GAME_LOGS_DIR);
  } catch {
    logger.warn("No player game-log directory; profiles will have no stats");
  }
  seasonsCache = names
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number.parseInt(f.slice(0, -5), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  return seasonsCache;
}

/* ------------------------------------------------------------- everything else */

export const loadByeWeeks = lazy<Record<string, Record<string, number>>>(
  BYE_WEEKS_FILE,
  {},
);

export const loadGameScores = lazy<
  Record<string, Record<string, { tm: number; opp: number; r: string }>>
>(GAME_SCORES_FILE, {});

export const loadDynastyRankings = lazy<Record<string, DynastyData>>(
  DYNASTY_FILE,
  {},
);

export const loadBios = lazy<Record<string, PlayerBio>>(BIOS_FILE, {});

/**
 * Birth date, college, high school and the season-by-season team history.
 *
 * Built by scripts/player/buildBioFacts.mjs and read by nothing but the Bio
 * tab. Separate from players.json deliberately: that document is loaded for
 * every request for every player, and these four fields serve one tab.
 */
export const loadBioFacts = lazy<Record<string, BioFacts>>(BIO_FACTS_FILE, {});

/** Draft year, round, pick, team and college, keyed by slug. */
export const loadDraft = lazy<Record<string, DraftRecord>>(DRAFT_FILE, {});

export const loadFantasyOutlook2026 = lazy<Record<string, FantasyOutlook2026>>(
  OUTLOOK_FILE,
  {},
);

/** Sleeper-backed season production snapshots, keyed by player id. */
export const loadProduction = lazy<Record<string, unknown>>(PRODUCTION_FILE, {});

/** Injury history snapshots, keyed by player id. */
export const loadInjuries = lazy<Record<string, unknown>>(INJURIES_FILE, {});

/** The indexed (fantasy-relevant) slug list, and the same grouped by team. */
export const loadIndexedSlugs = (): string[] =>
  readIndexed().slugs;

export const loadIndexedByTeam = (): Record<
  string,
  Record<string, unknown[]>
> => readIndexed().byTeam;

let indexedCache: {
  slugs: string[];
  byTeam: Record<string, Record<string, unknown[]>>;
} | null = null;

function readIndexed() {
  if (indexedCache) return indexedCache;
  const raw = readJson<{ slugs?: string[] }>(INDEXED_FILE, {});
  indexedCache = {
    slugs: raw.slugs ?? [],
    byTeam: readJson<Record<string, Record<string, unknown[]>>>(
      INDEXED_BY_TEAM_FILE,
      {},
    ),
  };
  return indexedCache;
}

const advancedCache = new Map<string, unknown>();

/**
 * One position/season advanced-stats table, e.g. ("wr", 2025).
 *
 * `season` may be the string "all" for the career table, which is how the
 * files are named.
 */
export function loadAdvancedStats(
  position: string,
  season: number | "all",
): unknown {
  const key = `${position.toLowerCase()}_${season}`;
  if (advancedCache.has(key)) return advancedCache.get(key);
  const value = readJson<unknown>(path.join(ADVANCED_DIR, `${key}.json`), null);
  advancedCache.set(key, value);
  return value;
}

/* ----------------------------------------------------------------- versioning */

let stamp: string | null = null;

/**
 * A fingerprint of the data on disk, for the render cache key.
 *
 * Built from each file's size and mtime rather than its contents: hashing 13MB
 * on every cold render would cost more than the render. Computed once — these
 * files do not change under a running process in production — except that
 * `players.json` is included by way of its live mtime, so the development loop
 * of "rebuild the data, reload the page" works.
 */
export function dataStamp(): string {
  if (stamp !== null) return stamp;
  const parts: string[] = [];
  for (const file of [
    PLAYERS_FILE,
    GAME_SCORES_FILE,
    DYNASTY_FILE,
    BIOS_FILE,
    BIO_FACTS_FILE,
    DRAFT_FILE,
    OUTLOOK_FILE,
    PRODUCTION_FILE,
    INJURIES_FILE,
  ]) {
    try {
      const st = fs.statSync(file);
      parts.push(`${Math.round(st.mtimeMs)}.${st.size}`);
    } catch {
      parts.push("0");
    }
  }
  for (const season of getAvailableSeasons()) parts.push(String(season));
  stamp = hash(parts.join("|"));
  return stamp;
}

/** Drops every cached document. Used by the tests and the dev reload path. */
export function resetPlayerData(): void {
  playersCache = null;
  playersBySlug = null;
  playersMtimeMs = 0;
  playersCheckedAt = 0;
  gameLogsCache.clear();
  advancedCache.clear();
  indexedCache = null;
  seasonsCache = null;
  stamp = null;
  warned.clear();
}

/** Short, stable, non-cryptographic — this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
