/**
 * Server-side player -> NFL team map.
 *
 * This used to run in the browser: every visitor downloaded Sleeper's full
 * player dictionary (several megabytes) just to color a card and pick a logo.
 * That can't work for server rendering - the team colors have to be in the
 * HTML we send - and it was a large third-party fetch on every cold visit, so
 * the lookup now lives here. The team abbreviation rides along on each item in
 * the API response, and the client no longer talks to Sleeper at all.
 *
 * The same response also feeds the team pages' roster index
 * (lib/team/roster.ts): depth chart, injury designations and headshots all come
 * out of this one download. Fetching them separately would mean pulling ~14MB
 * twice to read different fields off the same objects.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./data-dir";
import { logger } from "./logger";
import {
  indexRoster,
  namedPlayerCount,
  restoreRosterIndex,
  rosterFetchedAt,
  snapshotRosterIndex,
  type NamedPlayer,
  type SleeperPlayer,
  type TeamRoster,
} from "./team/roster";
import { SLEEPER } from "./team/upstream";

const SLEEPER_PLAYERS_URL = `${SLEEPER}/v1/players/nfl`;

/**
 * Twelve hours rather than twenty-four.
 *
 * The player->team map barely moves and would happily live for a day, but the
 * same payload now carries injury designations, and an "Ankle / Questionable"
 * that is a day old is exactly the stale-shown-as-current problem the team
 * pages must not have. Twice a day is the compromise; the page also stamps the
 * snapshot time onto Injury Watch, so it never claims to be fresher than it is.
 */
const REFRESH_MS = 12 * 60 * 60 * 1000;

/** How long a failed refresh is left alone before the next attempt. */
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
let lastFailureAt = 0;

// Disk cache, so a restart (or a Sleeper outage) doesn't cost us the map.
const CACHE_PATH = dataPath("player-teams.json");

/**
 * The roster index gets its own file rather than being folded into the one
 * above: it is an order of magnitude larger, and keeping them apart means a
 * corrupt or absent roster cache costs the team pages one refresh instead of
 * taking the news tool's team colors down with it.
 */
const ROSTER_CACHE_PATH = dataPath("team-roster.json");

interface CacheShape {
  fetchedAt: number;
  teams: Record<string, string>;
}

interface RosterCacheShape {
  fetchedAt: number;
  byTeam: Record<string, TeamRoster>;
  teamByPlayerName: Record<string, string>;
  /** Optional: a cache written before free-text name matching existed has none. */
  playerByName?: Record<string, NamedPlayer>;
}

let teams: Record<string, string> = {};
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;

function readDiskCache(): void {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CacheShape;
    if (parsed && parsed.teams && typeof parsed.fetchedAt === "number") {
      teams = parsed.teams;
      fetchedAt = parsed.fetchedAt;
      logger.info(
        { count: Object.keys(teams).length },
        "Player team map loaded from disk cache",
      );
    }
  } catch {
    // No cache yet (or it's corrupt) - we'll fetch a fresh one.
  }
}

function readRosterDiskCache(): void {
  try {
    const raw = fs.readFileSync(ROSTER_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as RosterCacheShape;
    if (parsed?.byTeam && typeof parsed.fetchedAt === "number") {
      restoreRosterIndex(
        parsed.byTeam,
        parsed.teamByPlayerName ?? {},
        parsed.fetchedAt,
        parsed.playerByName ?? {},
      );
      logger.info(
        { teams: Object.keys(parsed.byTeam).length },
        "Team roster index loaded from disk cache",
      );
    }
  } catch {
    // No cache yet (or it's corrupt) - the next refresh rebuilds it.
  }
}

function writeRosterDiskCache(): void {
  try {
    const snapshot = snapshotRosterIndex();
    fs.writeFileSync(
      ROSTER_CACHE_PATH,
      JSON.stringify({
        fetchedAt: snapshot.fetchedAt,
        byTeam: snapshot.byTeam,
        teamByPlayerName: snapshot.teamByPlayerName,
        playerByName: snapshot.playerByName,
      } satisfies RosterCacheShape),
    );
  } catch (err) {
    logger.warn({ err }, "Could not write team roster cache");
  }
}

function writeDiskCache(): void {
  try {
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ fetchedAt, teams } satisfies CacheShape),
    );
  } catch (err) {
    logger.warn({ err }, "Could not write player team cache");
  }
}

readDiskCache();
readRosterDiskCache();

async function fetchTeams(): Promise<void> {
  const res = await fetch(SLEEPER_PLAYERS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Sleeper responded ${res.status}`);

  const data = (await res.json()) as Record<string, SleeperPlayer | null>;

  const next: Record<string, string> = {};
  for (const id in data) {
    const team = data[id]?.team;
    if (team) next[id] = String(team).toLowerCase();
  }

  // A empty/short response means something is wrong upstream; keep what we have
  // rather than blanking every card's colors.
  if (Object.keys(next).length === 0) {
    throw new Error("Sleeper returned no teams");
  }

  teams = next;
  fetchedAt = Date.now();
  writeDiskCache();
  logger.info({ count: Object.keys(teams).length }, "Player team map refreshed");

  // Second pass over the payload already in hand: depth chart, injuries and
  // headshots for the team pages. Wrapped so a change in the shape of the
  // fields it reads can never take the team-color map down with it.
  try {
    indexRoster(data, fetchedAt);
    writeRosterDiskCache();
  } catch (err) {
    logger.warn({ err }, "Team roster index build failed");
  }
}

/**
 * Refresh the map if it's missing or stale. Never throws - a failure just means
 * cards render without team colors, which is cosmetic.
 */
export async function ensureTeams(): Promise<void> {
  const warm =
    Date.now() - fetchedAt < REFRESH_MS && Object.keys(teams).length > 0;
  // A warm team map with no roster behind it is the first boot after this
  // feature shipped, and any boot with a corrupt roster cache: the news tool is
  // fine, the team pages have nothing to render. Treat it as stale so a single
  // refresh fixes both.
  //
  // The same test, again, for the name index the X lane matches post text
  // against: a cache file written before that index existed restores every
  // other part of the roster and none of it, and without this check it would
  // look warm for twelve hours while every ingested post was filed under
  // nobody. The tagging happens once, on the way in, so "it will be right after
  // the next refresh" is not a recovery - those rows stay untagged for good.
  const complete =
    Object.keys(teams).length > 0 && rosterFetchedAt() > 0 && namedPlayerCount() > 0;
  if (warm && complete) return;
  // A failed refresh is not retried until the backoff runs out. Without it
  // every page request started another 14MB download and waited on it for as
  // long as Sleeper stayed down.
  if (Date.now() - lastFailureAt < FAILURE_BACKOFF_MS) return;
  // Collapse concurrent callers onto one request; the payload is large.
  if (!inFlight) {
    inFlight = fetchTeams()
      .catch((err) => {
        lastFailureAt = Date.now();
        logger.warn({ err }, "Player team map refresh failed");
      })
      .finally(() => {
        inFlight = null;
      });
  }
  // Merely stale, with every part present: serve what we have and let the
  // refresh land for the next caller, rather than hold this request on it.
  if (complete) return;
  await inFlight;
}

/** Sleeper player id embedded in a headshot URL, e.g. .../thumb/4034.jpg */
/** When the player -> team map was last fetched; a cache key for anything derived from it. */
export function teamsVersion(): number {
  return fetchedAt;
}

export function playerIdFromImage(url: string | null | undefined): string | null {
  const match = /\/players\/thumb\/(\d+)\./.exec(url ?? "");
  return match ? match[1]! : null;
}

/**
 * Every Sleeper player id the map currently puts on a team (lowercase abbr).
 *
 * The other direction of teamForImage, for pushing a team filter into SQL: a
 * wire row belongs to a team when its headshot's id is one of these. A scan of
 * the map (a few thousand keys) per call, which is nothing next to the rows it
 * saves reading.
 */
export function playerIdsForTeam(team: string): string[] {
  const wanted = team.toLowerCase();
  return Object.keys(teams).filter((id) => teams[id] === wanted);
}

/** Lowercase team abbreviation for an item's headshot, or null if unknown. */
export function teamForImage(image: string | null | undefined): string | null {
  const id = playerIdFromImage(image);
  return (id && teams[id]) || null;
}
