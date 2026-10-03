/**
 * A small keyed cache with stale-while-revalidate semantics, shared by the
 * team-page data providers.
 *
 * The shape of the problem: a team page needs four upstream documents, each of
 * which is per-team, slow-moving, and served by somebody else. Fetching them on
 * every request would put a stranger's latency in front of our TTFB - which is
 * the floor under LCP - and fetching them once and never again would let a
 * schedule go stale for the life of the process.
 *
 * So: a cold key is awaited (bounded by a timeout, because a hanging upstream
 * must not hang the page); a warm key is returned instantly; a stale key is
 * returned instantly AND refreshed in the background. Only the very first
 * visitor for a team ever waits, and nobody waits forever.
 *
 * Failures are recorded, not swallowed. `entry()` exposes the last error and
 * when it happened so a caller can tell "we have no schedule" from "we have
 * last hour's schedule and the refresh failed", and every failure is logged
 * once with its key.
 */

import { logger } from "../logger";

interface Entry<T> {
  value: T | null;
  fetchedAt: number;
  /** Last failure, for diagnosis. Never rendered to a reader. */
  error: string | null;
  errorAt: number;
}

export interface KeyedCache<T> {
  /** Whatever is cached right now, without any network call. */
  peek(key: string): Entry<T>;
  /** Cached value, refreshing if stale and awaiting only when cold. */
  ensure(key: string): Promise<T | null>;
}

export interface KeyedCacheOptions<T> {
  /** Used in log lines so a failure says which provider it came from. */
  name: string;
  /** How long a value is served without any refresh attempt. */
  ttlMs: number;
  /** How long the first (cold) caller waits before giving up on the load. */
  timeoutMs?: number;
  /**
   * How long a failure suppresses further attempts for that key. Without it a
   * down upstream gets one request per page view - the classic way a partial
   * outage becomes a full one.
   */
  errorBackoffMs?: number;
  /**
   * A per-key lifetime, when some keys never change: a finished season's
   * schedule or league stats is the same document forever, and refetching it
   * every six hours is load on ESPN for nothing. Falls back to ttlMs.
   */
  ttlFor?(key: string): number;
  load(key: string, signal: AbortSignal): Promise<T>;
}

const EMPTY: Entry<never> = {
  value: null,
  fetchedAt: 0,
  error: null,
  errorAt: 0,
};

/** How long a finished season's documents are kept: they do not change. */
export const PAST_SEASON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createKeyedCache<T>(
  options: KeyedCacheOptions<T>,
): KeyedCache<T> {
  const {
    name,
    ttlMs,
    timeoutMs = 6_000,
    errorBackoffMs = 60_000,
    ttlFor,
    load,
  } = options;

  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T | null>>();

  function peek(key: string): Entry<T> {
    return entries.get(key) ?? (EMPTY as Entry<T>);
  }

  function refresh(key: string): Promise<T | null> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    // AbortSignal.timeout rather than a bare fetch timeout: it also cancels a
    // load that is stuck between two requests (the ESPN coach lookup is two
    // hops), which a per-request timeout would not.
    const controller = AbortSignal.timeout(timeoutMs);
    const promise = load(key, controller)
      .then((value) => {
        entries.set(key, { value, fetchedAt: Date.now(), error: null, errorAt: 0 });
        return value;
      })
      .catch((err: unknown) => {
        const previous = peek(key);
        const message = err instanceof Error ? err.message : String(err);
        // Keep the last good value. A team page that shows an hour-old schedule
        // is far better than one that drops the section because a refresh
        // timed out.
        entries.set(key, {
          value: previous.value,
          fetchedAt: previous.fetchedAt,
          error: message,
          errorAt: Date.now(),
        });
        logger.warn({ provider: name, key, err }, "Team data provider failed");
        return previous.value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  async function ensure(key: string): Promise<T | null> {
    const entry = peek(key);
    const now = Date.now();

    if (entry.value !== null && now - entry.fetchedAt < (ttlFor?.(key) ?? ttlMs)) {
      return entry.value;
    }

    // Recent failure with nothing cached: don't retry on this request. The
    // section renders its unavailable state and the next visitor after the
    // backoff tries again.
    if (entry.value === null && entry.errorAt > 0 && now - entry.errorAt < errorBackoffMs) {
      return null;
    }

    if (entry.value !== null) {
      // Stale but usable: hand back what we have and refresh behind the
      // response. void, not await - this is the whole point of the cache.
      // Not while a refresh of it has just failed, though: the backoff applies
      // to a stale value too, or a down upstream got one attempt per request
      // for as long as it stayed down.
      if (!(entry.errorAt > 0 && now - entry.errorAt < errorBackoffMs)) {
        void refresh(key);
      }
      return entry.value;
    }

    return refresh(key);
  }

  return { peek, ensure };
}

/**
 * The identity every team-page provider sends.
 *
 * Named rather than left as Node's default `user-agent: node`, for the reason
 * already recorded for the news ingest: an anonymous automation string is what
 * bot management scores badly, and a WAF rule can only allow a caller it can
 * see. The news ingest's own UA is separate and stays separate.
 *
 * The bare hostname is deliberate. The conventional `(+https://example.com)`
 * form - which the ingest uses, and which the first version of this file used -
 * is rejected outright by ESPN's edge with a 403 on every request, apparently
 * for containing a URL scheme. `(+statchasers.com)` passes and still says who
 * is calling. Do not "fix" this back to a full URL without re-testing.
 */
export const TEAM_USER_AGENT = "StatChasersTeamPages/1.0 (+statchasers.com)";

/** JSON GET with a named user-agent, shared by every upstream call here. */
export async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  userAgent: string,
): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal,
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as T;
}
