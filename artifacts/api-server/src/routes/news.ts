import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, newsItems, newsDedupeKey } from "../lib/db";
import { listNews } from "../lib/news-query";
import { logger } from "../lib/logger";
import { summarize, summariesEnabled } from "../lib/summarize";
import { ensureTeams } from "../lib/teams";
import { ensureFreshness, invalidateFreshness } from "../lib/freshness";
import { invalidateRenderCache } from "../lib/ssr";

// Per-ingest cap so a large backlog fills gradually instead of one huge burst.
const SUMMARY_BATCH = 25;
const SUMMARY_CONCURRENCY = 3;

// Generate synopses for the newest items still missing one.
async function backfillSummaries(): Promise<void> {
  if (!summariesEnabled()) return;

  const rows = await db
    .select({ id: newsItems.id, title: newsItems.title })
    .from(newsItems)
    .where(and(isNull(newsItems.summary), isNotNull(newsItems.title)))
    .orderBy(
      sql`${newsItems.pubDateMs} desc nulls last`,
      desc(newsItems.firstSeenAt),
    )
    .limit(SUMMARY_BATCH);

  if (rows.length === 0) return;

  let generated = 0;

  for (let i = 0; i < rows.length; i += SUMMARY_CONCURRENCY) {
    const chunk = rows.slice(i, i + SUMMARY_CONCURRENCY);
    const results = await Promise.all(chunk.map((r) => summarize(r.title)));
    for (let j = 0; j < chunk.length; j++) {
      const text = results[j];
      if (text) {
        await db
          .update(newsItems)
          .set({ summary: text })
          .where(eq(newsItems.id, chunk[j]!.id));
        generated++;
      }
    }
  }

  if (generated > 0) {
    // Revises existing items rather than adding news: the rendered cards change
    // (so caches must drop), but the archive is not newer, so the public
    // "last updated" date stays put.
    invalidateFreshness(false);
    invalidateRenderCache();
  }

  logger.info({ generated, attempted: rows.length }, "Summaries backfilled");
}

const router = Router();

/**
 * Where to fetch the feed, in order of preference.
 *
 * A comma-separated list, not a single URL, because the feed is reachable by
 * more than one route and which routes work is not under this app's control.
 * Cloudflare sits in front of `api.statchasers.com` and challenges this
 * deployment's egress IP; the API's own `*.replit.app` origin is not proxied and
 * is not challenged. Listing both means an unreachable first choice costs one
 * failed request rather than an outage, and a route that comes back is used
 * again automatically.
 *
 * It also makes the origin hostname safe to guess: put it first, and if it is
 * wrong the ingest simply falls through to the next entry.
 */
const FEED_URLS: string[] = (process.env["DYNASTY_NEWS_API_URL"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Identifies this server to the upstream feed. See the fetch below. */
const USER_AGENT = "StatChasersNews/1.0 (+https://newsfeed.replit.app)";

/**
 * Header carrying the shared secret that proves this caller to the feed's WAF.
 *
 * Cloudflare sits in front of api.statchasers.com and challenges this
 * deployment — it answers "Just a moment..." (the JS interstitial), which a
 * server cannot solve, so the ingest 403s forever. The block is scored on
 * egress IP reputation, not on anything in the request: the workspace and the
 * deployment send byte-identical calls and only the deployment is challenged.
 *
 * A WAF Skip rule keyed on this header lets the ingest through without
 * weakening the API for anyone else. Keyed on a *secret* rather than on the
 * User-Agent because a User-Agent is trivially spoofable by anyone who reads
 * it, and it would hand every scraper the same bypass. Not IP-allowlisted
 * because Replit's egress addresses are not guaranteed stable.
 */
const FEED_KEY_HEADER = "X-SC-Ingest-Key";

/**
 * The secret itself. Inert when unset: no header is sent and nothing changes,
 * so this is safe to ship before the WAF rule exists (and for any other
 * deployment that does not need it).
 */
const FEED_KEY = process.env["DYNASTY_NEWS_API_KEY"]?.trim() || undefined;

/**
 * A URL's hostname, for reporting.
 *
 * The host — not the full URL — because that is the whole diagnostic: it says
 * which feed this environment is actually pointed at, which is what
 * distinguishes "the deployment still holds a retired URL" from "the right URL
 * is being refused". `[userenv.shared]` in .replit configures the workspace
 * only, so the two environments genuinely can disagree, and nothing else exposes
 * which one a running instance got. A hostname is not a secret; a query string
 * could be, so it is dropped.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Set but unparseable — worth surfacing, since a stray quote or newline in
    // the deployment's environment lands here and nowhere else.
    return "(not a valid URL)";
  }
}

function makeFallbackId(item: {
  title?: string;
  link?: string;
  pubDate?: string;
}): string {
  const raw = `${item.title ?? ""}|${item.link ?? ""}|${item.pubDate ?? ""}`;
  // Simple deterministic hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fallback-${Math.abs(hash).toString(36)}`;
}

interface RawNewsItem {
  id?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  playerName?: string;
  image?: string;
  [key: string]: unknown;
}

/**
 * Traffic-triggered refresh.
 *
 * The 10-minute `setInterval` in index.ts only fires while a process is alive,
 * and this deployment does not stay alive between requests — it idles, the timer
 * never fires, and the archive stops moving until something cold-starts the
 * instance. Observed in production: an ingest ran at 17:28 and the next one
 * never happened, so the page served hours-old news while upstream had more.
 *
 * So requests drive the refresh as well. Any request may kick an ingest, but at
 * most one per REFRESH_MIN_GAP_MS and never more than one at a time — a busy
 * page must not mean an ingest per visitor.
 */
const REFRESH_MIN_GAP_MS = (() => {
  // Overridable so the throttle can be exercised in a test without waiting ten
  // minutes. Not meant as production tuning — a smaller value in production just
  // means more calls to a feed that changes every few minutes at best.
  const raw = Number(process.env["INGEST_MIN_GAP_MS"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10 * 60 * 1000;
})();

/** When an ingest last STARTED, whether by timer, by request, or by POST. */
let lastIngestStartedMs = 0;
let ingestInFlight: Promise<unknown> | null = null;

/**
 * Outcome of the most recent ingest, for GET /api/status.
 *
 * A failing ingest used to be a log line and nothing else, which made the one
 * failure mode that matters here — a deployment whose environment is missing
 * DYNASTY_NEWS_API_URL, so every run throws before it fetches anything —
 * indistinguishable from a healthy server with quiet upstream. `/api/healthz`
 * answered "ok" either way. This is the state that tells the two apart from
 * outside the box.
 */
interface IngestState {
  lastAttemptMs: number | null;
  lastSuccessMs: number | null;
  lastResult: { inserted: number; updated: number; total: number } | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Which configured route last worked, or "push" — see runIngest(). */
  lastSource: string | null;
}

const ingestState: IngestState = {
  lastAttemptMs: null,
  lastSuccessMs: null,
  lastResult: null,
  lastError: null,
  consecutiveFailures: 0,
  lastSource: null,
};

export function ingestStatus(): IngestState & {
  feedConfigured: boolean;
  feedHosts: string[];
  feedKeyConfigured: boolean;
} {
  return {
    ...ingestState,
    feedConfigured: FEED_URLS.length > 0,
    feedHosts: FEED_URLS.map(hostOf),
    // Whether the WAF bypass secret reached this environment — never its value.
    // Without this the only way to tell a missing secret from a wrong WAF rule
    // is to change one and see, which is the loop this endpoint exists to end.
    feedKeyConfigured: Boolean(FEED_KEY),
  };
}

/**
 * Pure so the throttle can be reasoned about (and tested) without a server.
 * `lastMs` of 0 means "never ingested", which must always pass.
 */
export function shouldRefresh(
  nowMs: number,
  lastMs: number,
  gapMs: number = REFRESH_MIN_GAP_MS,
): boolean {
  return lastMs === 0 || nowMs - lastMs >= gapMs;
}

/**
 * Start an ingest if one is due. Returns immediately — the caller is a request
 * that has already been answered, and must never wait on this.
 */
export function refreshIfStale(): void {
  if (ingestInFlight) return;
  if (!shouldRefresh(Date.now(), lastIngestStartedMs)) return;

  ingestInFlight = runIngest()
    .then((result) => {
      logger.info(result, "Traffic-triggered ingest complete");
    })
    .catch((err) => {
      // Stamped before the attempt, so a feed that is down costs one request
      // every ten minutes rather than one per visitor.
      logger.error({ err }, "Traffic-triggered ingest failed");
    })
    .finally(() => {
      ingestInFlight = null;
    });
}

export interface IngestResult {
  inserted: number;
  updated: number;
  total: number;
}

/**
 * Run an ingest and record how it went. Every caller — startup, the timer, the
 * traffic hook, POST /api/ingest — goes through here, so `ingestStatus()` always
 * describes the last real attempt.
 */
export async function runIngest(pushed?: RawNewsItem[]): Promise<IngestResult> {
  // Stamped before the guard: a missing feed URL is still an attempt, and
  // retrying it on every single request would be pointless load.
  lastIngestStartedMs = Date.now();
  ingestState.lastAttemptMs = lastIngestStartedMs;

  try {
    // Pushed items skip the fetch entirely, which is the point of push mode:
    // nothing outbound, so nothing between here and the feed can block it.
    const source = pushed ? "push" : null;
    const { items, from } = pushed
      ? { items: pushed, from: "push" }
      : await fetchFeed();

    const result = await storeItems(items);

    ingestState.lastSuccessMs = Date.now();
    ingestState.lastResult = result;
    ingestState.lastError = null;
    ingestState.consecutiveFailures = 0;
    ingestState.lastSource = source ?? from;
    return result;
  } catch (err) {
    ingestState.lastError = err instanceof Error ? err.message : String(err);
    ingestState.consecutiveFailures++;
    throw err;
  }
}

/**
 * Fetch the feed, trying each configured route in order.
 *
 * A route failing is expected rather than exceptional — see FEED_URLS — so the
 * loop carries on and only gives up once every route has failed. The thrown
 * error names each one and why it failed, because "which of my three URLs is
 * broken" is otherwise invisible from outside.
 */
async function fetchFeed(): Promise<{ items: RawNewsItem[]; from: string }> {
  if (FEED_URLS.length === 0) {
    throw new Error("DYNASTY_NEWS_API_URL is not set");
  }

  const failures: string[] = [];

  for (const url of FEED_URLS) {
    try {
      return { items: await fetchFeedFrom(url), from: hostOf(url) };
    } catch (err) {
      failures.push(
        `${hostOf(url)} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    failures.length === 1
      ? failures[0]!
      : `all ${failures.length} feed routes failed: ${failures.join(" | ")}`,
  );
}

async function fetchFeedFrom(feedUrl: string): Promise<RawNewsItem[]> {
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/json",
      // Node's fetch otherwise sends `user-agent: node`, which is exactly what
      // bot management in front of an API scores as anonymous automation. The
      // upstream feed sits behind Cloudflare, and a 403 there looks identical to
      // a 403 from anywhere else. Identifying the caller is both the polite
      // thing to do when calling our own API and the difference between a WAF
      // rule that can allow this traffic and one that cannot see who it is.
      "User-Agent": USER_AGENT,
      // Only when configured — see FEED_KEY_HEADER.
      ...(FEED_KEY ? { [FEED_KEY_HEADER]: FEED_KEY } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // The status alone cannot tell a wrong URL from a blocked one — both are
    // "403: Forbidden". The body can: the retired feed answers
    // {"error":"forbidden"}, a WAF answers an HTML challenge page. Kept short,
    // and failure to read it must not mask the original error.
    const detail = await response
      .text()
      .then((body) => body.trim().replace(/\s+/g, " ").slice(0, 200))
      .catch(() => "");

    throw new Error(
      `Dynasty Command API responded with ${response.status}: ${response.statusText}` +
        (detail ? ` — ${detail}` : ""),
    );
  }

  const data = (await response.json()) as unknown;
  return coerceItems(data);
}

/**
 * Accept either a bare array or `{ items: [...] }`. Shared by the fetch path and
 * the pushed-body path so both understand the same two shapes.
 */
export function coerceItems(data: unknown): RawNewsItem[] {
  if (Array.isArray(data)) return data as RawNewsItem[];
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as RawNewsItem[]) : [];
}

/** Write a batch of feed items into the archive. Never fetches anything. */
async function storeItems(rawItems: RawNewsItem[]): Promise<IngestResult> {
  const now = new Date();

  // Dedupe on the content fingerprint (newsDedupeKey), not the raw id. If a row
  // with the same fingerprint already exists we update it in place — keeping its
  // original id, summary, and firstSeenAt — so a changed upstream id or pubDate
  // format can never spawn a second copy of the same story.
  //
  // Collapse duplicates *within* the batch first. The old row-at-a-time SQLite
  // loop let a later item overwrite an earlier one with the same fingerprint;
  // a single multi-row INSERT would instead trip the unique index, so last-wins
  // is applied here rather than left to the database.
  const incoming = new Map<string, { id: string; item: RawNewsItem }>();
  for (const item of rawItems) {
    const id = item.id?.toString().trim() || makeFallbackId(item);
    incoming.set(newsDedupeKey({ title: item.title, id }), { id, item });
  }

  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    const keys = [...incoming.keys()];
    if (keys.length === 0) return;

    // Look up by BOTH keys. Matching only on the fingerprint misses the case
    // that upstream keeps an item's id and edits its title: the new title is a
    // new fingerprint, so the row looks new, and inserting it collides with the
    // id already in the table. That is a primary-key violation, which aborts the
    // whole transaction — one retitled story and NOTHING ingests. Seen in
    // production, where the archive silently stopped moving for hours after
    // upstream reworded a headline.
    //
    // One lookup for the whole batch, so the work is two round trips plus the
    // writes rather than a query per item.
    const ids = [...incoming.values()].map((entry) => entry.id);
    const existing = await tx
      .select({ id: newsItems.id, dedupeKey: newsItems.dedupeKey })
      .from(newsItems)
      .where(
        or(inArray(newsItems.dedupeKey, keys), inArray(newsItems.id, ids)),
      );
    const idByKey = new Map(existing.map((row) => [row.dedupeKey, row.id]));
    const keyById = new Map(existing.map((row) => [row.id, row.dedupeKey]));

    const inserts: (typeof newsItems.$inferInsert)[] = [];

    for (const [dedupeKey, { id, item }] of incoming) {
      const parsedMs = item.pubDate ? Date.parse(item.pubDate) : NaN;
      const fields = {
        title: item.title ?? "(no title)",
        link: item.link ?? null,
        pubDate: item.pubDate ?? null,
        pubDateMs: Number.isNaN(parsedMs) ? null : parsedMs,
        playerName: item.playerName ?? null,
        image: item.image ?? null,
      };

      const existingId = idByKey.get(dedupeKey);
      if (existingId) {
        // firstSeenAt, summary and the original id are deliberately untouched.
        await tx
          .update(newsItems)
          .set({ ...fields, lastSeenAt: now })
          .where(eq(newsItems.id, existingId));
        updated++;
      } else if (keyById.has(id)) {
        // Same story, reworded upstream. Update in place and move the
        // fingerprint with it, so the next ingest matches on the new title
        // instead of colliding here again.
        await tx
          .update(newsItems)
          .set({ ...fields, dedupeKey, lastSeenAt: now })
          .where(eq(newsItems.id, id));
        updated++;
      } else {
        inserts.push({
          ...fields,
          id,
          dedupeKey,
          source: "Dynasty Command",
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }

    if (inserts.length > 0) {
      // DO NOTHING rather than an error: a concurrent ingest (the 10-minute
      // timer overlapping a manual POST /api/ingest) can insert the same story
      // between the SELECT above and this INSERT.
      const written = await tx
        .insert(newsItems)
        .values(inserts)
        // No target, so this covers a race on the id as well as on the
        // fingerprint. A concurrent ingest (the refresh timer overlapping a
        // POST /api/ingest) can write either one between the SELECT and here,
        // and neither is worth failing the batch over.
        .onConflictDoNothing()
        .returning({ id: newsItems.id });
      inserted = written.length;
    }
  });

  // Only a run that actually changed something invalidates the freshness
  // timestamp and the render cache. An ingest that re-sees the same items is
  // not a content change, and must not move the "Last updated" date.
  if (inserted > 0 || updated > 0) {
    invalidateFreshness();
    invalidateRenderCache();
  }

  logger.info(
    { total: rawItems.length, inserted, updated },
    "Ingest complete",
  );

  await backfillSummaries();

  // Piggyback the player -> team refresh on the ingest cycle. It self-throttles
  // to once a day and never throws, so this is just a convenient heartbeat.
  await ensureTeams();

  return { inserted, updated, total: rawItems.length };
}

/**
 * POST /api/ingest — refresh now.
 *
 * Two modes:
 *
 *   - **Pull** (empty body): the server fetches the feed itself. Simplest, and
 *     what the timer and the traffic hook use.
 *   - **Push** (`{"items": [...]}` or a bare array): the caller supplies the
 *     items and the server just stores them. Nothing outbound is involved, so
 *     this works even when the server cannot reach the feed at all — which is
 *     exactly the situation Cloudflare's bot challenge creates. Anything that
 *     *can* read the feed (a laptop, a CI job, the API itself) can drive the
 *     archive with it. See scripts/ingest.mjs, which does both.
 *
 * Guard both modes with INGEST_SECRET. Push mode writes caller-supplied content
 * straight into the archive, so an open endpoint is a way to put arbitrary
 * headlines on the page.
 */
router.post("/ingest", async (req, res) => {
  // Opt-in guard: when INGEST_SECRET is set, callers must present it. Keeps the
  // externally-triggerable ingest endpoint from being abused. No secret = open.
  const secret = process.env["INGEST_SECRET"];
  if (secret && req.get("x-ingest-secret") !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  // An empty body is the pull mode this endpoint has always had; only a body
  // that actually carries items switches modes, so existing callers (and the
  // scheduled trigger) are unaffected.
  const pushed = coerceItems(req.body);
  const mode = pushed.length > 0 ? "push" : "pull";

  if (secret === undefined && mode === "push") {
    // Refusing rather than accepting: pull mode only ever stores what the
    // configured feed served, so leaving it open is a throttling question. Push
    // mode stores whatever the caller sent, which is a different kind of risk
    // and must not be available anonymously by default.
    res.status(401).json({
      ok: false,
      error: "push mode requires INGEST_SECRET to be configured on the server",
    });
    return;
  }

  try {
    const result = await runIngest(mode === "push" ? pushed : undefined);
    res.json({ ok: true, mode, ...result });
  } catch (err) {
    req.log.error({ err }, "Ingest failed");
    res.status(500).json({ ok: false, mode, error: String(err) });
  }
});

/**
 * GET /api/status — is this instance actually keeping the archive moving?
 *
 * `/api/healthz` answers "ok" as soon as the process is listening, which says
 * nothing about the thing that has actually broken in production twice now: the
 * ingest. This reports whether the feed URL reached this environment at all,
 * when an ingest last ran, whether it succeeded, and what the archive looks like
 * as a result — enough to tell "upstream is quiet" from "this deployment has
 * never once managed to fetch the feed" without reading the logs.
 *
 * Deliberately unauthenticated and free of secrets: booleans, timestamps, counts
 * and an error message, never the feed URL or the connection string.
 */
router.get("/status", (_req, res) => {
  void (async () => {
    const ingest = ingestStatus();
    const nowMs = Date.now();

    try {
      const { changedAtMs, count } = await ensureFreshness();
      res.set("Cache-Control", "no-store").json({
        ok: true,
        now: new Date(nowMs).toISOString(),
        feedConfigured: ingest.feedConfigured,
        feedHosts: ingest.feedHosts,
        feedKeyConfigured: ingest.feedKeyConfigured,
        pushModeAvailable: Boolean(process.env["INGEST_SECRET"]),
        ingest: {
          lastAttempt: iso(ingest.lastAttemptMs),
          lastSuccess: iso(ingest.lastSuccessMs),
          secondsSinceLastSuccess:
            ingest.lastSuccessMs === null
              ? null
              : Math.round((nowMs - ingest.lastSuccessMs) / 1000),
          // Which route actually worked, so a fallback quietly carrying the
          // archive is visible rather than looking like the primary is fine.
          lastSource: ingest.lastSource,
          lastResult: ingest.lastResult,
          lastError: ingest.lastError,
          consecutiveFailures: ingest.consecutiveFailures,
          minGapMs: REFRESH_MIN_GAP_MS,
        },
        archive: {
          items: count,
          newestContentAt: iso(changedAtMs),
        },
      });
    } catch (err) {
      // The archive half failed, but the ingest half is the interesting part and
      // is held in memory — still answer with it rather than a bare 500.
      logger.error({ err }, "Failed to read archive state for /api/status");
      res.status(500).set("Cache-Control", "no-store").json({
        ok: false,
        now: new Date(nowMs).toISOString(),
        feedConfigured: ingest.feedConfigured,
        ingest,
        error: "failed to read archive state",
      });
    }
  })();
});

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

// GET /api/news
router.get("/news", (req, res) => {
  void (async () => {
    const rawLimit = parseInt(String(req.query["limit"] ?? ""), 10);
    const search = String(req.query["search"] ?? "").trim();

    try {
      // Shared with the server-side renderer so the JSON the browser refreshes
      // with is the same shape — including the resolved `team` — that SSR used.
      const items = await listNews({
        ...(Number.isNaN(rawLimit) ? {} : { limit: rawLimit }),
        search,
      });

      res.json({ ok: true, count: items.length, items });
    } catch (err) {
      // The client falls back to the markup already on the page, so a failed
      // poll costs nothing visible — but it must not be silent in the log.
      logger.error({ err }, "Failed to list news");
      res.status(500).json({ ok: false, error: "failed to list news" });
    }
  })();
});

export default router;
