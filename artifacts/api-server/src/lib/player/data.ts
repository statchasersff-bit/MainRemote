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
import { dataPath } from "../data-dir";
import { logger } from "../logger";
import { searchKey } from "../render";
import type {
  BioFacts,
  DraftRecord,
  DynastyData,
  FantasyOutlook2026,
  GameLogEntry,
  Player,
  PlayerBio,
  RosterPctDoc,
} from "./types";
import type { BioSourcesDoc } from "./bio-tab-data";

const DATA_DIR = dataPath("player");

const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const INDEXED_FILE = path.join(DATA_DIR, "indexed_players.json");
const INDEXED_BY_TEAM_FILE = path.join(DATA_DIR, "indexed_players_by_team.json");
const GAME_LOGS_DIR = path.join(DATA_DIR, "game_logs");
const BYE_WEEKS_FILE = path.join(DATA_DIR, "bye_weeks.json");
const DEPTH_CHARTS_FILE = path.join(DATA_DIR, "depth_charts.json");
const GAME_SCORES_FILE = path.join(DATA_DIR, "game_scores.json");
const DYNASTY_FILE = path.join(DATA_DIR, "dynasty_rankings.json");
const BIOS_FILE = path.join(DATA_DIR, "bios.json");
const BIO_FACTS_FILE = path.join(DATA_DIR, "bio_facts.json");
const BIO_SOURCES_FILE = path.join(DATA_DIR, "bio_sources.json");
const DRAFT_FILE = path.join(DATA_DIR, "draft.json");
const OUTLOOK_FILE = path.join(DATA_DIR, "fantasy_outlook_2026.json");
const PRODUCTION_FILE = path.join(DATA_DIR, "player_production.json");
const INJURIES_FILE = path.join(DATA_DIR, "player_injuries.json");
const ROSTER_PCT_FILE = path.join(DATA_DIR, "roster_pct.json");
const SLUG_LEDGER_FILE = path.join(DATA_DIR, "player_slugs.json");
const STATS_COPY_FILE = path.join(DATA_DIR, "stats_copy.json");
const COLLEGE_FILE = path.join(DATA_DIR, "college_stats.json");
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
/** Every lazy loader's reset, so resetPlayerData() can drop them all. */
const lazyResets: Array<() => void> = [];

function lazy<T>(file: string, fallback: T): () => T {
  let value: T | null = null;
  lazyResets.push(() => {
    value = null;
  });
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
  // Rebuilt with the dictionary, not alongside it: it is derived from these
  // rows, so a stale index outliving a reload would hand out slugs for players
  // the file no longer has.
  slugsByName = null;
  // Derived from the dictionary too: they refuse any alias a live player
  // holds, so a reload that changes who holds what has to rebuild them.
  slugIndexes = null;
  playersMtimeMs = mtimeMs;
  logger.info({ count: rows.length }, "Loaded player dictionary");
  return rows;
}

export function getPlayerBySlug(slug: string): Player | null {
  if (!playersBySlug) loadPlayers();
  return playersBySlug?.get(slug) ?? null;
}

/* -------------------------------------------------------------- slug aliases */

/**
 * The addresses a player used to answer at, from `player_slugs.json`.
 *
 * A slug can change: two players share a name and the better claim to the bare
 * form moves, or a source corrects a spelling. The page is the same page, so
 * the old address has to keep working — as a 301, not as a second copy.
 *
 * The ledger is the build's output and this is the only thing that reads it at
 * runtime. A deployment without the file simply has no aliases, which is the
 * behaviour every other optional data file here has.
 */
interface SlugLedger {
  players?: Record<string, { slug?: string; previous?: string[] }>;
}

let slugIndexes: {
  /** old slug -> the slug that answers now. */
  aliases: Map<string, string>;
  /** player id -> the addresses he has left behind. */
  previous: Map<string, string[]>;
} | null = null;

function buildSlugIndexes(): NonNullable<typeof slugIndexes> {
  const ledger = readJson<SlugLedger>(SLUG_LEDGER_FILE, {});
  const aliases = new Map<string, string>();
  const previous = new Map<string, string[]>();

  for (const [id, entry] of Object.entries(ledger.players ?? {})) {
    const current = entry?.slug;
    if (!current) continue;

    const left: string[] = [];
    for (const old of entry.previous ?? []) {
      // The builder already strips an old address that somebody else now
      // publishes at, but these maps are what actually send a reader
      // somewhere, so they check again rather than trusting the file.
      // Redirecting a live page onto a different player is the one failure
      // worth two guards.
      if (old === current || playersBySlug?.has(old)) continue;
      aliases.set(old, current);
      left.push(old);
    }

    if (left.length) previous.set(id, left);
  }

  return { aliases, previous };
}

function slugIndex(): NonNullable<typeof slugIndexes> {
  if (!playersBySlug) loadPlayers();
  if (!slugIndexes) slugIndexes = buildSlugIndexes();
  return slugIndexes;
}

/**
 * The current slug for an address that has moved, or null.
 *
 * Null for a slug that is current, and for one that never existed — the caller
 * cannot tell those apart and does not need to; both mean "do not redirect".
 */
export function resolveSlugAlias(slug: string): string | null {
  if (!playersBySlug) loadPlayers();
  if (playersBySlug?.has(slug)) return null;
  const current = slugIndex().aliases.get(slug);
  return current && current !== slug ? current : null;
}

/**
 * Every address this player has left behind, oldest first, or [].
 *
 * Handed to the WordPress builder so it can move a page it already created
 * rather than publish a second one beside it.
 */
export function previousSlugsFor(id: string): string[] {
  return slugIndex().previous.get(id) ?? [];
}

/* ------------------------------------------------------- name lookup */

/**
 * `searchKey(name)` -> slug, for the players that have a profile page.
 *
 * Null for "not built yet"; a name that resolves to nothing is absent from the
 * map rather than mapped to null.
 */
let slugsByName: Map<string, string> | null = null;

function buildSlugsByName(): Map<string, string> {
  // Only the INDEXED players. The dictionary carries ~4,000 names and the site
  // publishes a profile for ~600 of them, so matching against the whole
  // dictionary would hand out links to pages that do not exist — which is the
  // failure the caller in team/links.ts exists to avoid.
  const indexed = new Set(loadIndexedSlugs());
  const byName = new Map<string, string>();
  // Names that are not unique once normalised. "Michael Thomas" has been two
  // players; a link then has to pick one, and picking wrong is worse than
  // leaving the name as text, so an ambiguous key is dropped entirely.
  const ambiguous = new Set<string>();

  for (const player of loadPlayers()) {
    if (!indexed.has(player.slug)) continue;
    const key = searchKey(player.name);
    if (!key) continue;
    const seen = byName.get(key);
    if (seen && seen !== player.slug) {
      ambiguous.add(key);
      continue;
    }
    byName.set(key, player.slug);
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}

/**
 * The slug of the player with this name, or null.
 *
 * Matched on `searchKey`, the same normalisation the rest of the app compares
 * names with, so the punctuation the sources disagree about ("A.J." vs "AJ",
 * "Ja'Marr" vs "JaMarr") does not decide whether a name resolves.
 *
 * Null is the answer for anyone without a published profile, and callers are
 * expected to render a plain name rather than guess a URL: the slugs here are
 * the site's own, and deriving one from a name gets "A.J. Brown" wrong
 * ("a-j-brown", where the site says "aj-brown").
 */
export function getPlayerSlugByName(name: string | null | undefined): string | null {
  const key = searchKey(name ?? "");
  if (!key) return null;
  if (!slugsByName) slugsByName = buildSlugsByName();
  return slugsByName.get(key) ?? null;
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

/** When a season's game-log file was last written, or null when there is none. */
export function gameLogUpdatedMs(season: number): number | null {
  try {
    return fs.statSync(path.join(GAME_LOGS_DIR, `${season}.json`)).mtimeMs;
  } catch {
    return null;
  }
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

/** One club's depth chart, as the NFL-Depth-Charts build writes it. */
export interface DepthChartGroup {
  role: string;
  fantasy_position: string;
  players: Array<{ name: string; depth_order: number; sleeper_id?: string; sleeper_slug?: string }>;
}

export const loadDepthCharts = lazy<{ teams?: Record<string, DepthChartGroup[]> }>(
  DEPTH_CHARTS_FILE,
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

/**
 * The Bio spec's fact store (scripts/player/buildBioSources.mjs): one sourced,
 * reconciled record per field per player, plus the source table.
 */
export const loadBioSources = lazy<BioSourcesDoc>(BIO_SOURCES_FILE, { version: 0, generatedAt: "", sources: {}, players: {} });

/** Draft year, round, pick, team and college, keyed by slug. */
export const loadDraft = lazy<Record<string, DraftRecord>>(DRAFT_FILE, {});

export const loadFantasyOutlook2026 = lazy<Record<string, FantasyOutlook2026>>(
  OUTLOOK_FILE,
  {},
);

/**
 * Analyst-written copy for the Stats tab, keyed by slug. Hand-edited, like the
 * outlooks; see docs/STATS-COPY.md. Every field is optional and each one
 * replaces only its own template text.
 */
export interface StatsCopy {
  prod_lede?: string;
  adv_lede?: string;
  adv_fantasy_note?: string;
  /** One to three paragraphs; the Redraft Command paragraph always follows. */
  career_paragraphs?: string[];
  /** "2026-09-29": the byline's date. */
  updated_date?: string;
  /** The byline's name; "the StatChasers staff" without one. */
  author?: string;
}

export const loadStatsCopy = lazy<Record<string, StatsCopy>>(STATS_COPY_FILE, {});

/** One college season from CollegeFootballData.com (scripts/player/buildCollegeStats.mjs). */
export interface CollegeSeason {
  season: number;
  school: string;
  pass: { cmp: number; att: number; yds: number; td: number; int: number } | null;
  rush: { att: number; yds: number; td: number; long: number } | null;
  rec: { rec: number; yds: number; td: number; long: number } | null;
}

export interface CollegeProfile {
  name: string;
  school: string;
  finalSeason: number;
  seasons: CollegeSeason[];
  /** Final-season metrics by key, with rank and percentile when he qualified. */
  final: Record<string, { value: number; rank?: number; of?: number; pct?: number }>;
  poolSize: number;
}

export const loadCollegeStats = lazy<{ players?: Record<string, CollegeProfile> }>(COLLEGE_FILE, {});

/** Sleeper-backed season production snapshots, keyed by player id. */
export const loadProduction = lazy<Record<string, unknown>>(PRODUCTION_FILE, {});

/** Injury history snapshots, keyed by player id. */
export const loadInjuries = lazy<Record<string, unknown>>(INJURIES_FILE, {});

/**
 * Rostered and started percentages from Sleeper's leagues, for one week.
 *
 * The empty fallback carries week 0, which no season has: a deployment without
 * the file reads as "no week has been ingested" rather than as week 1 of the
 * current season with nobody rostered in it.
 */
export const loadRosterPct = lazy<RosterPctDoc>(ROSTER_PCT_FILE, {
  season: 0,
  week: 0,
  readAt: "",
  players: {},
});

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
    // The slug list itself, not only the dictionary behind it. A player added
    // to the index gains a page, and — since every page inlines the roster for
    // its search bar — has to appear in the search on every OTHER page too.
    // Without this line that is a rebuild the render cache cannot see.
    INDEXED_FILE,
    GAME_SCORES_FILE,
    DYNASTY_FILE,
    BIOS_FILE,
    BIO_FACTS_FILE,
    BIO_SOURCES_FILE,
    DRAFT_FILE,
    OUTLOOK_FILE,
    PRODUCTION_FILE,
    INJURIES_FILE,
    ROSTER_PCT_FILE,
    DEPTH_CHARTS_FILE,
    STATS_COPY_FILE,
    COLLEGE_FILE,
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
  for (const reset of lazyResets) reset();
}

/** Short, stable, non-cryptographic — this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
