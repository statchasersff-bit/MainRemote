/**
 * The Bio pipeline's HTTP client (Bio spec, Part 7.1).
 *
 * Every source the pipeline reads gets its own instance, and each instance
 * enforces the source's etiquette on its own:
 *
 *   - one request at a time, spaced at least `minGapMs` apart (the token
 *     bucket, set below the source's published limit);
 *   - the descriptive User-Agent on every request;
 *   - conditional requests: the last ETag / Last-Modified is kept in the raw
 *     cache and sent back, and a 304 is served from the cached body;
 *   - retries on 429 and 5xx that honor Retry-After, else exponential backoff
 *     with jitter (1s, 2s, 4s ... capped at 5 minutes), up to 6 attempts;
 *   - a circuit breaker: 3 consecutive 429s or 403s trips the source for 30
 *     minutes. Every later call throws `SourcePaused` at once, so a run moves
 *     on to the other sources instead of hammering one that is refusing it;
 *   - the raw response (URL, status, headers, time, body) cached on disk, so
 *     parsing can be re-run without fetching again.
 *
 * The cache lives outside the repo's data (see CACHE_DIR): it is a courtesy to
 * the sources, not a record, and the facts derived from it are what gets
 * committed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APP_DIR } from "../paths.mjs";

export const USER_AGENT = "StatChasersBot/1.0 (+https://statchasers.com/bot; data@statchasers.com)";

export const CACHE_DIR =
  process.env.SC_BIO_CACHE_DIR?.trim() || path.join(APP_DIR, ".cache", "bio-sources");

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 5 * 60_000;
const BREAKER_TRIPS_AFTER = 3;
const BREAKER_PAUSE_MS = 30 * 60_000;

export class SourcePaused extends Error {
  constructor(source, untilMs) {
    super(`${source} paused until ${new Date(untilMs).toISOString()} after repeated 429/403`);
    this.name = "SourcePaused";
    this.source = source;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null if absent. */
export function retryAfterMs(value, nowMs = Date.now()) {
  if (value == null || value === "") return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** 1s, 2s, 4s ... with up to 25% jitter, capped at five minutes. */
export function backoffMs(attempt, random = Math.random) {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (1 + random() * 0.25)));
}

function cacheKey(url, body) {
  return crypto.createHash("sha1").update(`${url}\n${body ?? ""}`).digest("hex");
}

/**
 * A client for one source.
 *
 *   const wiki = politeClient("wikidata", { minGapMs: 1000 });
 *   const res = await wiki.fetch(url);   // { status, body, fromCache, retrievedAt, etag, lastModified }
 */
export function politeClient(name, { minGapMs, fetchImpl = globalThis.fetch, now = Date.now, wait = sleep, log = () => {} } = {}) {
  let lastStart = 0;
  let queue = Promise.resolve();
  let strikes = 0;
  let pausedUntil = 0;
  const dir = path.join(CACHE_DIR, name);

  const readCache = (key) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8"));
    } catch {
      return null;
    }
  };
  const writeCache = (key, record) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
    fs.renameSync(`${file}.tmp`, file);
  };

  async function once(url, init) {
    if (now() < pausedUntil) throw new SourcePaused(name, pausedUntil);
    const key = cacheKey(url, init.body);
    const cached = readCache(key);
    const headers = { "User-Agent": USER_AGENT, ...(init.headers ?? {}) };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    for (let attempt = 1; ; attempt += 1) {
      const gap = lastStart + minGapMs - now();
      if (gap > 0) await wait(gap);
      lastStart = now();

      let res;
      try {
        res = await fetchImpl(url, { ...init, headers, redirect: "follow" });
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        const ms = backoffMs(attempt);
        log(`${name}: network error (${err.message}); retry ${attempt} in ${ms}ms`);
        await wait(ms);
        continue;
      }

      if (res.status === 429 || res.status === 403) {
        strikes += 1;
        if (strikes >= BREAKER_TRIPS_AFTER) {
          pausedUntil = now() + BREAKER_PAUSE_MS;
          log(`${name}: ALERT ${strikes} consecutive ${res.status}s, pausing for 30 minutes`);
          throw new SourcePaused(name, pausedUntil);
        }
      } else {
        strikes = 0;
      }

      if (res.status === 304 && cached) {
        return { ...cached, status: 200, fromCache: true };
      }
      if (res.ok) {
        const body = await res.text();
        const record = {
          url,
          status: res.status,
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          retrievedAt: new Date(now()).toISOString(),
          body,
        };
        writeCache(key, record);
        return { ...record, fromCache: false };
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`${name}: HTTP ${res.status} for ${url}`);
      }
      const ms = retryAfterMs(res.headers.get("retry-after"), now()) ?? backoffMs(attempt);
      log(`${name}: HTTP ${res.status}; retry ${attempt} in ${ms}ms`);
      await wait(Math.min(ms, MAX_BACKOFF_MS));
    }
  }

  return {
    name,
    /** Serialized: a second call waits for the first, so the source sees one at a time. */
    fetch(url, init = {}) {
      const run = queue.then(() => once(url, init));
      queue = run.catch(() => {});
      return run;
    },
    get paused() {
      return now() < pausedUntil;
    },
  };
}
