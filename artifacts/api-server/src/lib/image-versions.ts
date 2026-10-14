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
 * The table is created once per process by lib/db-schema.ts, so a publish
 * that skipped the schema push still works.
 *
 * Writes are batched (Phase 1, 2026-10-14). A cold render can learn fifty
 * versions in a second and each used to be its own INSERT, which on a
 * database that bills while awake is fifty reasons to be awake. Now a change
 * goes into a pending queue and the queue is flushed about once a minute,
 * as one statement per kind, and only when it holds something. The map is
 * updated at once; only the durable copy waits.
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

import { dbAccess } from "./db-access";
import { ensureRuntimeTables } from "./db-schema";
import { logger } from "./logger";
import { imageKeyFor } from "./image-urls";
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

/** How often the pending writes go to the table, when there are any. */
export const FLUSH_INTERVAL_MS = (() => {
  const raw = Number(process.env["IMAGE_VERSIONS_FLUSH_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

function dbEnabled(): boolean {
  return Boolean(process.env["DATABASE_URL"]) && process.env["IMAGE_VERSIONS_DB"] !== "0";
}

type Pool = typeof import("@workspace/db")["pool"];

async function database(): Promise<Pool | null> {
  if (!dbEnabled()) return null;
  if (!(await ensureRuntimeTables())) return null;
  const { pool } = await import("@workspace/db");
  return pool;
}

/** Fill the map from the table. Returns how many rows were loaded. */
export async function loadImageVersions(): Promise<number> {
  const pool = await database();
  if (!pool) return 0;
  try {
    dbAccess("startup_restore", { what: "image_versions" });
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
  return imageVersionFor(imageKeyFor(url));
}

export function imageEtagFor(id: string): string | null {
  return known.get(id)?.etag ?? null;
}

export function imageCheckedAt(id: string): number | undefined {
  return known.get(id)?.checkedAtMs;
}

// --- the write queue --------------------------------------------------------

/** Rows whose version or etag changed: a full upsert each. */
const pendingUpserts = new Map<string, { version: string | null; etag: string | null }>();
/** Rows merely re-checked and found unchanged: only checked_at moves. */
const pendingTouches = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer || !dbEnabled()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushImageVersions();
  }, FLUSH_INTERVAL_MS);
  // Never hold the process open for a flush that may have nothing to write.
  flushTimer.unref?.();
}

/**
 * Write what is pending, as one statement per kind. Public so a test or a
 * shutdown hook can force it; a no-op when nothing is pending.
 */
export function flushImageVersions(): Promise<void> {
  if (flushing) return flushing;
  if (pendingUpserts.size === 0 && pendingTouches.size === 0) return Promise.resolve();
  flushing = (async () => {
    const pool = await database();
    if (!pool) {
      pendingUpserts.clear();
      pendingTouches.clear();
      return;
    }
    // Taken off the queue first, so anything recorded while the statements
    // run lands in the next flush rather than being lost or written twice.
    const upserts = [...pendingUpserts];
    pendingUpserts.clear();
    const touches = [...pendingTouches].filter((id) => !upserts.some(([other]) => other === id));
    pendingTouches.clear();
    dbAccess("image_version_flush", { upserts: upserts.length, touches: touches.length });
    try {
      if (upserts.length > 0) {
        const values: string[] = [];
        const params: (string | null)[] = [];
        upserts.forEach(([id, entry], i) => {
          values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, now(), now())`);
          params.push(id, entry.version, entry.etag);
        });
        await pool.query(
          "INSERT INTO player_image_versions (player_id, version, source_etag, checked_at, updated_at) " +
            `VALUES ${values.join(", ")} ` +
            "ON CONFLICT (player_id) DO UPDATE SET version = EXCLUDED.version, source_etag = EXCLUDED.source_etag, " +
            "checked_at = now(), updated_at = CASE WHEN player_image_versions.version IS DISTINCT FROM EXCLUDED.version THEN now() ELSE player_image_versions.updated_at END",
          params,
        );
      }
      if (touches.length > 0) {
        await pool.query("UPDATE player_image_versions SET checked_at = now() WHERE player_id = ANY($1)", [touches]);
      }
    } catch (err) {
      // Put them back for the next flush: the map already holds the truth, so
      // a lost write only costs a re-resolve after the next restart.
      for (const [id, entry] of upserts) if (!pendingUpserts.has(id)) pendingUpserts.set(id, entry);
      for (const id of touches) pendingTouches.add(id);
      logger.warn({ err, upserts: upserts.length, touches: touches.length }, "could not store player image versions; retrying next flush");
      scheduleFlush();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** For /api/status and tests: what is waiting to be written. */
export function imageVersionsPendingWrites(): number {
  return pendingUpserts.size + pendingTouches.size;
}

/** Record what a fetch established. Persists (batched), and tells the caches if it changed. */
export function recordImageVersion(id: string, version: string | null, etag: string | null): void {
  const before = known.get(id);
  const now = Date.now();
  known.set(id, { version, etag, checkedAtMs: now });
  const changed = !before || before.version !== version;
  if (changed) bump();
  // Memory-only (no table): nothing to queue, so nothing can pile up.
  if (!dbEnabled()) return;
  pendingTouches.delete(id);
  pendingUpserts.set(id, { version, etag });
  scheduleFlush();
}

/** A re-check found the photo unchanged: only the check time moves. */
export function touchImageChecked(id: string): void {
  const entry = known.get(id);
  if (!entry) return;
  entry.checkedAtMs = Date.now();
  if (!dbEnabled()) return;
  if (!pendingUpserts.has(id)) pendingTouches.add(id);
  scheduleFlush();
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
 * Put each item's image key and version on it, waiting a bounded moment for
 * any the store has not met before. Items whose image is from a host the
 * route does not serve are left alone.
 */
export async function stampImageVersions(items: NewsItem[], budgetMs = 0): Promise<void> {
  const keys = items
    .map((item) => imageKeyFor(item.image))
    .filter((key): key is string => key !== null);
  await ensureImageVersions(keys, budgetMs);
  for (const item of items) {
    const key = imageKeyFor(item.image);
    if (!key) continue;
    item.imageKey = key;
    item.imageVersion = imageVersionFor(key);
  }
}

/** For /api/status. */
export function imageVersionsStatus(): { known: number; withoutPhoto: number; pending: number; pendingWrites: number } {
  let withoutPhoto = 0;
  for (const entry of known.values()) if (entry.version === null) withoutPhoto += 1;
  return { known: known.size, withoutPhoto, pending: pending.size, pendingWrites: imageVersionsPendingWrites() };
}
