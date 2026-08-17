/**
 * Server-side player -> NFL team map.
 *
 * This used to run in the browser: every visitor downloaded Sleeper's full
 * player dictionary (several megabytes) just to colour a card and pick a logo.
 * That can't work for server rendering — the team colours have to be in the
 * HTML we send — and it was a large third-party fetch on every cold visit, so
 * the lookup now lives here. The team abbreviation rides along on each item in
 * the API response, and the client no longer talks to Sleeper at all.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const REFRESH_MS = 24 * 60 * 60 * 1000;

// Disk cache, so a restart (or a Sleeper outage) doesn't cost us the map.
const CACHE_PATH = path.resolve(process.cwd(), "data", "player-teams.json");

interface CacheShape {
  fetchedAt: number;
  teams: Record<string, string>;
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
    // No cache yet (or it's corrupt) — we'll fetch a fresh one.
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

async function fetchTeams(): Promise<void> {
  const res = await fetch(SLEEPER_PLAYERS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Sleeper responded ${res.status}`);

  const data = (await res.json()) as Record<
    string,
    { team?: string | null } | null
  >;

  const next: Record<string, string> = {};
  for (const id in data) {
    const team = data[id]?.team;
    if (team) next[id] = String(team).toLowerCase();
  }

  // A empty/short response means something is wrong upstream; keep what we have
  // rather than blanking every card's colours.
  if (Object.keys(next).length === 0) {
    throw new Error("Sleeper returned no teams");
  }

  teams = next;
  fetchedAt = Date.now();
  writeDiskCache();
  logger.info({ count: Object.keys(teams).length }, "Player team map refreshed");
}

/**
 * Refresh the map if it's missing or stale. Never throws — a failure just means
 * cards render without team colours, which is cosmetic.
 */
export async function ensureTeams(): Promise<void> {
  if (Date.now() - fetchedAt < REFRESH_MS && Object.keys(teams).length > 0) {
    return;
  }
  // Collapse concurrent callers onto one request; the payload is large.
  if (!inFlight) {
    inFlight = fetchTeams()
      .catch((err) => {
        logger.warn({ err }, "Player team map refresh failed");
      })
      .finally(() => {
        inFlight = null;
      });
  }
  await inFlight;
}

/** Sleeper player id embedded in a headshot URL, e.g. .../thumb/4034.jpg */
export function playerIdFromImage(url: string | null | undefined): string | null {
  const match = /\/players\/thumb\/(\d+)\./.exec(url ?? "");
  return match ? match[1]! : null;
}

/** Lowercase team abbreviation for an item's headshot, or null if unknown. */
export function teamForImage(image: string | null | undefined): string | null {
  const id = playerIdFromImage(image);
  return (id && teams[id]) || null;
}
