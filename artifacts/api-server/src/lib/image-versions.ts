/**
 * Which picture Sleeper currently has for each player, as a content version.
 *
 * The headshot URLs carry a version (lib/image-urls.ts) so that browsers and
 * Cloudflare can hold a derivative for a year without ever holding a stale
 * one: a replaced photo gets a new version and a new URL. The version is the
 * digest of the original's bytes, learned the first time the image is fetched
 * - which means the renderer, which prints the URL BEFORE anyone fetches the
 * image, needs somewhere to look it up. This is that place.
 *
 * In memory, a map of player id to version, consulted synchronously by the
 * renderers. Behind it, the player_image_versions table, so the map survives
 * a redeploy: the deployment's own disk is replaced on every publish, and
 * without the table every cold start would print `latest` for every player
 * and answer each with a redirect until the photo had been fetched again.
 * The table is created on first use, as practice-store.ts does, so a publish
 * that skipped the schema push still works.
 *
 * A player Sleeper has no photo for is recorded as version null, and the
 * renderers draw their fallback instead of an <img> that would 404.
 *
 * Unknown ids are resolved in the background: a renderer that meets one calls
 * enqueueImageResolve(), the resolver (lib/image-cache.ts, registered at its
 * import) fetches and processes the photo, and the render caches listening on
 * onImageVersionsChanged() drop their copies so the next render prints the
 * real version. The news fragment goes one better and waits a bounded moment
 * for the first page's photos (stampImageVersions), so the common case is a
 * versioned URL on the very first render.
 */

import { logger } from "./logger";
import { sleeperHeadshotId } from "./image-urls";
import type { NewsItem } from "./render";

interface Known {
  /** Null: Sleeper has no photo for this player. */
  version: string | null;
  etag: string | null;
  checkedAtMs: number;
}

const known = new Map<string, Known>();
let epoch = 0;

type Listener = () => void;
const listeners = new Set<Listener>();
let notifyTimer: NodeJS.Timeout | null = null;

/** How long a stored version is trusted before the photo is re-checked. */
export const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function dbEnabled(): boolean {
  return Boolean(process.env["DATABASE_URL"]) && process.env["IMAGE_VERSIONS_DB"] !== "0";
}

let tableReady: Promise<boolean> | null = null;

type Pool = typeof import("@workspace/db")["pool"];

async function database(): Promise<Pool | null> {
  if (!dbEnabled()) return null;
  const { pool } = await import("@workspace/db");
  tableReady ??= pool
    .query(
      "CREATE TABLE IF NOT EXISTS player_image_versions (" +
        "player_id text PRIMARY KEY, version text, source_etag text, " +
        "checked_at timestamp with time zone NOT NULL DEFAULT now(), " +
        "updated_at timestamp with time zone NOT NULL DEFAULT now())",
    )
    .then(() => true)
    .catch((err: unknown) => {
      logger.warn({ err }, "player_image_versions table unavailable; versions are memory-only");
      return false;
    });
  return (await tableReady) ? pool : null;
}

/** Fill the map from the table. Returns how many rows were loaded. */
export async function loadImageVersions(): Promise<number> {
  const pool = await database();
  if (!pool) return 0;
  try {
    const res = await pool.query<{ player_id: string; version: string | null; source_etag: string | null; checked_at: Date }>(
      "SELECT player_id, version, source_etag, checked_at FROM player_image_versions",
    );
    for (const row of res.rows) {
      if (known.has(row.player_id)) continue;
      known.set(row.player_id, {
        version: row.version,
        etag: row.source_etag,
        checkedAtMs: new Date(row.checked_at).getTime(),
      });
    }
    if (res.rows.length) bump();
    return res.rows.length;
  } catch (err) {
    logger.warn({ err }, "could not load player image versions");
    return 0;
  }
}

function bump(): void {
  epoch += 1;
  if (notifyTimer) return;
  // Coalesced: a cold render can learn fifty versions in a second, and the
  // listeners drop whole render caches.
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        logger.warn({ err }, "image version listener failed");
      }
    }
  }, 750);
  notifyTimer.unref?.();
}

/** Changes whenever a version is learned or changes; render caches key on it. */
export function imageVersionsEpoch(): number {
  return epoch;
}

export function onImageVersionsChanged(fn: Listener): void {
  listeners.add(fn);
}

/**
 * The version for a player: a string, null for "no photo", or undefined
 * for "not known yet".
 */
export function imageVersionFor(id: string | null | undefined): string | null | undefined {
  if (!id) return undefined;
  return known.get(id)?.version;
}

export function imageVersionForUrl(url: string | null | undefined): string | null | undefined {
  return imageVersionFor(sleeperHeadshotId(url));
}

export function imageEtagFor(id: string): string | null {
  return known.get(id)?.etag ?? null;
}

export function imageCheckedAt(id: string): number | undefined {
  return known.get(id)?.checkedAtMs;
}

/** Record what a fetch established. Persists, and tells the caches if it changed. */
export function recordImageVersion(id: string, version: string | null, etag: string | null): void {
  const before = known.get(id);
  const now = Date.now();
  known.set(id, { version, etag, checkedAtMs: now });
  const changed = !before || before.version !== version;
  if (changed) bump();
  void database().then((pool) =>
    pool
      ?.query(
        "INSERT INTO player_image_versions (player_id, version, source_etag, checked_at, updated_at) " +
          "VALUES ($1, $2, $3, now(), now()) " +
          "ON CONFLICT (player_id) DO UPDATE SET version = EXCLUDED.version, source_etag = EXCLUDED.source_etag, " +
          "checked_at = now(), updated_at = CASE WHEN player_image_versions.version IS DISTINCT FROM EXCLUDED.version THEN now() ELSE player_image_versions.updated_at END",
        [id, version, etag],
      )
      .catch((err: unknown) => logger.warn({ err, id }, "could not store player image version")),
  );
}

/** A re-check found the photo unchanged: only the check time moves. */
export function touchImageChecked(id: string): void {
  const entry = known.get(id);
  if (!entry) return;
  entry.checkedAtMs = Date.now();
  void database().then((pool) =>
    pool
      ?.query("UPDATE player_image_versions SET checked_at = now() WHERE player_id = $1", [id])
      .catch((err: unknown) => logger.warn({ err, id }, "could not touch player image version")),
  );
}

// --- background resolution ------------------------------------------------

type Resolver = (id: string) => Promise<unknown>;
let resolver: Resolver | null = null;
/** Ids queued or running, each with the promise its callers wait on. */
const pending = new Map<string, { promise: Promise<void>; settle: () => void }>();
const queue: string[] = [];
let running = 0;
const CONCURRENCY = 4;

/** lib/image-cache.ts registers the function that fetches and processes a photo. */
export function setImageResolver(fn: Resolver): void {
  resolver = fn;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    const entry = pending.get(id);
    const run = resolver;
    if (!entry) continue;
    if (!run) {
      pending.delete(id);
      entry.settle();
      continue;
    }
    running += 1;
    run(id)
      .catch((err: unknown) => {
        logger.warn({ err, id }, "player image resolution failed");
      })
      .finally(() => {
        running -= 1;
        pending.delete(id);
        entry.settle();
        pump();
      });
  }
}

/**
 * Resolve an unknown player's version in the background. Returns a promise
 * that settles when it is done, for callers that want to wait a little.
 */
export function enqueueImageResolve(id: string): Promise<void> {
  const existing = pending.get(id);
  if (existing) return existing.promise;
  if (known.has(id) || !resolver) return Promise.resolve();
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  pending.set(id, { promise, settle });
  queue.push(id);
  pump();
  return promise;
}

/**
 * Wait up to `budgetMs` for these ids to be known. Whatever is not resolved by
 * then keeps resolving in the background; the caller renders with `latest`
 * for those and the cache listeners re-render once they land.
 */
export async function ensureImageVersions(ids: Iterable<string>, budgetMs: number): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const id of new Set(ids)) {
    if (known.has(id)) continue;
    waits.push(enqueueImageResolve(id));
  }
  if (!waits.length || budgetMs <= 0) return;
  let timer: NodeJS.Timeout | null = null;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  await Promise.race([Promise.all(waits).then(() => undefined), budget]);
  if (timer) clearTimeout(timer);
}

/**
 * Put each item's headshot version on it, waiting a bounded moment for any
 * the store has not met before. Items whose image is not a Sleeper thumb are
 * left alone.
 */
export async function stampImageVersions(items: NewsItem[], budgetMs = 0): Promise<void> {
  const ids = items
    .map((item) => sleeperHeadshotId(item.image))
    .filter((id): id is string => id !== null);
  await ensureImageVersions(ids, budgetMs);
  for (const item of items) {
    const id = sleeperHeadshotId(item.image);
    if (!id) continue;
    item.imageVersion = imageVersionFor(id);
  }
}

/** For /api/status. */
export function imageVersionsStatus(): { known: number; withoutPhoto: number; pending: number } {
  let withoutPhoto = 0;
  for (const entry of known.values()) if (entry.version === null) withoutPhoto += 1;
  return { known: known.size, withoutPhoto, pending: pending.size };
}
