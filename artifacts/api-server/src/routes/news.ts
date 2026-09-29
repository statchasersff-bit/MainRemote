import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, newsItems, newsDedupeKey } from "../lib/db";
import { dataDirStatus } from "../lib/data-dir";
import { listNews } from "../lib/news-query";
import { logger } from "../lib/logger";
import { summarize, summariesEnabled } from "../lib/summarize";
import { ensureTeams } from "../lib/teams";
import { ensureFreshness, invalidateFreshness } from "../lib/freshness";
import { invalidateRenderCache } from "../lib/ssr";
import { fetchClubNews } from "../lib/club-news";
import type { RawNewsItem } from "../lib/news-item";
import { TEAMS } from "../lib/team/teams";
import { fpaSnapshotState } from "../lib/fpa/fpa-data";
import { fpaRefreshStatus } from "../lib/fpa/refresh";
import { playerRefreshStatus } from "../lib/player/live-refresh";
import { loadGameLogs } from "../lib/player/data";
import { seasonYear } from "../lib/seo";

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

export type { RawNewsItem };

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

/**
 * When an ingest is considered *unhealthy* — see GET /api/ingest/health.
 *
 * Both thresholds exist because they catch different failures. A failure count
 * catches a feed that is refusing us right now; an age catches the quieter case
 * where nothing is failing because nothing is running at all (an idle instance,
 * a timer that never fired, a scheduled trigger someone turned off).
 *
 * Defaults: three consecutive failures is ~30 minutes at the 10-minute cadence,
 * comfortably past a transient upstream blip; an hour without a success is well
 * inside the feed's rolling ~25-item window, so an alert still leaves time to
 * fix it before anything is lost for good.
 */
const ALERT_MAX_FAILURES = (() => {
  const raw = Number(process.env["INGEST_ALERT_MAX_FAILURES"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
})();

const ALERT_MAX_AGE_MS = (() => {
  const raw = Number(process.env["INGEST_ALERT_MAX_AGE_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
})();

/** For the age check before the first success — see evaluateIngestHealth(). */
const PROCESS_STARTED_MS = Date.now();

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
  lastResult: IngestResult | null;
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

export interface IngestHealthVerdict {
  ok: boolean;
  /** Every reason it is unhealthy, so one alert explains the whole picture. */
  reasons: string[];
}

/**
 * Is the ingest healthy enough to stay quiet about?
 *
 * Pure, like shouldRefresh above, so the thresholds can be reasoned about and
 * tested without a server or a clock.
 *
 * Before the first success of a process there is no last-success timestamp to
 * measure from, so the age is measured from process start instead. Without that
 * a deployment that has *never* managed an ingest — the exact state production
 * sat in for 17 hours — would look healthy indefinitely on the age check, which
 * is precisely backwards.
 */
export function evaluateIngestHealth(args: {
  nowMs: number;
  lastSuccessMs: number | null;
  consecutiveFailures: number;
  startedMs: number;
  maxFailures?: number;
  maxAgeMs?: number;
}): IngestHealthVerdict {
  const maxFailures = args.maxFailures ?? ALERT_MAX_FAILURES;
  const maxAgeMs = args.maxAgeMs ?? ALERT_MAX_AGE_MS;
  const reasons: string[] = [];

  if (args.consecutiveFailures >= maxFailures) {
    reasons.push(
      `${args.consecutiveFailures} consecutive ingest failures (threshold ${maxFailures})`,
    );
  }

  const since = args.lastSuccessMs ?? args.startedMs;
  const ageMs = args.nowMs - since;
  if (ageMs > maxAgeMs) {
    const mins = Math.round(ageMs / 60_000);
    reasons.push(
      args.lastSuccessMs === null
        ? `no successful ingest since this process started ${mins}m ago (threshold ${Math.round(maxAgeMs / 60_000)}m)`
        : `last successful ingest was ${mins}m ago (threshold ${Math.round(maxAgeMs / 60_000)}m)`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Start an ingest if one is due. Returns immediately — the caller is a request
 * that has already been answered, and must never wait on this.
 */
/**
 * Whether this process pulls the wire on its own (startup, timer, traffic).
 *
 * Not in the development workspace unless SC_DEV_INGEST=1. The workspace runs
 * the same schedulers as the deployment, so it doubled the upstream traffic —
 * and both wire hosts refuse it (403), so every ten minutes it asked
 * dynasty-command and then api.statchasers.com for a refusal. POST /api/ingest
 * still works there, for pushing items by hand. The club sweep's timer (index.ts)
 * reads this switch too; POST /api/ingest/clubs runs one on demand.
 */
export function wireIngestEnabled(): boolean {
  if (process.env["NODE_ENV"] !== "development") return true;
  return ["1", "true", "on"].includes((process.env["SC_DEV_INGEST"] ?? "").trim().toLowerCase());
}

export function refreshIfStale(): void {
  if (!wireIngestEnabled()) return;
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
  /** Rows the feed changed. */
  updated: number;
  /** Rows re-sent exactly as stored: seen again, not changed. */
  unchanged: number;
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

    // Logged once, on the crossing, rather than on every failure: an alert that
    // repeats every ten minutes is one people learn to scroll past, and the
    // whole problem here was a failure nobody noticed for 17 hours.
    if (ingestState.consecutiveFailures === ALERT_MAX_FAILURES) {
      logger.error(
        {
          consecutiveFailures: ingestState.consecutiveFailures,
          lastError: ingestState.lastError,
          feedHosts: FEED_URLS.map(hostOf),
        },
        "Ingest is unhealthy — the archive has stopped moving",
      );
    }

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
  const items = coerceItems(data);

  // A 200 carrying nothing is a failure, not a quiet success.
  //
  // storeItems([]) returns {inserted: 0, updated: 0} perfectly happily, which
  // would mark the run successful and leave `lastError: null` — so an upstream
  // that starts answering 200 with an empty list would freeze the archive while
  // /api/status went on reporting a healthy ingest. That is the exact shape of
  // failure this whole subsystem keeps getting caught by: the signal says fine
  // and the data says otherwise.
  //
  // Thrown here rather than in runIngest so it behaves like any other bad route:
  // the loop in fetchFeed() falls through and tries the next URL. The feed is
  // never legitimately empty — it carries a rolling ~25 items.
  if (items.length === 0) {
    throw new Error("responded 200 but carried no items");
  }

  return items;
}

/** The provider label on a club row when the item does not name an outlet. */
export const CLUB_PROVIDER = "NFL Clubs";

/**
 * How many of the 32 club feeds have to answer before a sweep counts.
 *
 * Not all of them. These are 32 independent sites and one being down is normal;
 * failing the whole run over it would throw away the 31 that worked and leave
 * the archive no fresher than doing nothing. Below this, though, the shape of
 * the failure has changed from "a club is having a bad day" to "something on
 * our side stopped reaching the internet", and that is worth reporting as a
 * failure rather than as a thin but successful ingest.
 */
const CLUB_MIN_OK = 8;

/**
 * Outcome of the last club sweep, reported alongside the wire's on /api/status.
 *
 * Separate state rather than folded into ingestState. The two providers fail
 * independently and for unrelated reasons — the wire behind a WAF, a club
 * behind its own outage — and one number covering both would say "the ingest is
 * fine" while the half of it that carries team pages was dead.
 */
interface ClubIngestState {
  lastAttemptMs: number | null;
  lastSuccessMs: number | null;
  lastResult: IngestResult | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Clubs that answered on the last sweep, out of 32. */
  clubsOk: number | null;
  /** Clubs that could not be read, by code. */
  clubsFailed: string[];
  /** Clubs answering 200 but carrying nothing recent — see lib/club-news.ts. */
  clubsStale: string[];
}

const clubState: ClubIngestState = {
  lastAttemptMs: null,
  lastSuccessMs: null,
  lastResult: null,
  lastError: null,
  consecutiveFailures: 0,
  clubsOk: null,
  clubsFailed: [],
  clubsStale: [],
};

export function clubIngestStatus(): ClubIngestState {
  return { ...clubState };
}

/**
 * Sweep all 32 club feeds and store what they carry.
 *
 * Deliberately a separate entry point from runIngest() rather than a step
 * inside it. The wire is fetched on every traffic-triggered refresh, which can
 * be as often as every ten minutes per instance; putting 32 more requests on
 * that path would multiply this app's outbound traffic by an order of magnitude
 * to re-read feeds that change a few times a day. The timer in index.ts calls
 * this on its own, slower cadence.
 */
export async function runClubIngest(): Promise<IngestResult> {
  clubState.lastAttemptMs = Date.now();

  try {
    const sweep = await fetchClubNews();

    if (sweep.ok < CLUB_MIN_OK) {
      throw new Error(
        `only ${sweep.ok} of ${sweep.ok + sweep.failed.length} club feeds answered` +
          (sweep.failed[0] ? ` — e.g. ${sweep.failed[0].team}: ${sweep.failed[0].error}` : ""),
      );
    }

    const result = await storeItems(sweep.items, CLUB_PROVIDER, CLUB_SOURCE_TYPE);

    clubState.lastSuccessMs = Date.now();
    clubState.lastResult = result;
    clubState.lastError = null;
    clubState.consecutiveFailures = 0;
    clubState.clubsOk = sweep.ok;
    clubState.clubsFailed = sweep.failed.map((f) => f.team);
    clubState.clubsStale = sweep.stale.map((s) => s.team);

    logger.info(
      {
        ...result,
        clubsOk: sweep.ok,
        clubsFailed: sweep.failed.length,
        clubsStale: sweep.stale.length,
        tooOld: sweep.tooOld,
      },
      "Club news sweep complete",
    );
    return result;
  } catch (err) {
    clubState.lastError = err instanceof Error ? err.message : String(err);
    clubState.consecutiveFailures++;
    throw err;
  }
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

/**
 * The label describing who relayed the feed we are configured to read.
 *
 * A named constant rather than a literal at the insert site because it is about
 * to stop being the only one: a second provider writes through this same
 * storeItems() and must land rows carrying its own name, or the archive merges
 * two feeds into one indistinguishable pile and no one can tell which of them
 * went quiet.
 */
export const DYNASTY_PROVIDER = "Dynasty Command";

/**
 * The provider lanes, as written to news_items.source_type.
 *
 * The X lane's name is NOT here — it belongs to lib/x, which owns that
 * provider, and the read path spells it out for itself (see X_LANE in
 * lib/news-query.ts) so the feed never has to import the ingestion half.
 */
export const WIRE_SOURCE_TYPE = "wire";
export const CLUB_SOURCE_TYPE = "club";

/**
 * Whether an update would write exactly what is already stored. Compared on
 * every column the update sets, so any real edit upstream (a reworded
 * headline, a new image, a corrected time) still lands and still counts.
 */
function sameFields(
  stored: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  return Object.entries(fields).every(([key, value]) => stored[key] === value);
}

/**
 * Write a batch of feed items into the archive. Never fetches anything.
 *
 * `provider` names whoever relayed this batch. An item may override it with its
 * own `source` when it knows the reporting outlet; see RawNewsItem.source for
 * why the current feed never does.
 */
export async function storeItems(
  rawItems: RawNewsItem[],
  provider: string = DYNASTY_PROVIDER,
  /**
   * Which provider lane these rows belong to — "wire", "club" or "x".
   *
   * A parameter rather than something inferred from `provider`, because the
   * lane is what the feed's reads are built on (see lib/news-query.ts) and it
   * must be a fact the caller states, not a string comparison that quietly
   * changes meaning the day someone renames a provider label.
   */
  sourceType: string = WIRE_SOURCE_TYPE,
): Promise<IngestResult> {
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
    // A provider that has a real external id supplies its own key and dedupes
    // on that; everyone else gets the content fingerprint. Scoped by team for
    // the club feeds, unscoped for the wire — see newsDedupeKey. Two clubs
    // filing "Practice Report" are two stories.
    const key =
      item.dedupeKey?.toString().trim() ||
      newsDedupeKey({ title: item.title, id, scope: item.teamAbbr });
    incoming.set(key, { id, item });
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

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
    // With the columns an update would write, so a row the feed merely
    // re-sent can be told apart from one it changed.
    const existing = await tx
      .select({
        id: newsItems.id,
        dedupeKey: newsItems.dedupeKey,
        title: newsItems.title,
        link: newsItems.link,
        pubDate: newsItems.pubDate,
        pubDateMs: newsItems.pubDateMs,
        playerName: newsItems.playerName,
        image: newsItems.image,
        teamAbbr: newsItems.teamAbbr,
        sourceType: newsItems.sourceType,
        authorHandle: newsItems.authorHandle,
        source: newsItems.source,
      })
      .from(newsItems)
      .where(
        or(inArray(newsItems.dedupeKey, keys), inArray(newsItems.id, ids)),
      );
    const idByKey = new Map(existing.map((row) => [row.dedupeKey, row.id]));
    const keyById = new Map(existing.map((row) => [row.id, row.dedupeKey]));
    const rowById = new Map(existing.map((row) => [row.id, row]));

    // Rows re-sent exactly as stored. They get one lastSeenAt touch for the
    // whole batch, after the loop, and do not count as updates: every wire run
    // re-sends ~25 known stories and every club sweep ~1,800, and counting those
    // as changes reset the freshness version and the render cache on every run
    // while writing a row at a time.
    const seenIds: string[] = [];

    const inserts: (typeof newsItems.$inferInsert)[] = [];

    for (const [dedupeKey, { id, item }] of incoming) {
      const parsedMs = item.pubDate ? Date.parse(item.pubDate) : NaN;
      const outlet = item.source?.toString().trim() || null;
      const teamAbbr = item.teamAbbr?.toString().trim().toLowerCase() || null;
      const fields = {
        title: item.title ?? "(no title)",
        link: item.link ?? null,
        pubDate: item.pubDate ?? null,
        pubDateMs: Number.isNaN(parsedMs) ? null : parsedMs,
        playerName: item.playerName ?? null,
        image: item.image ?? null,
        // Rewritten on every pass, unlike summary below: this is a fact about
        // which feed the row came from, and it cannot drift the way a generated
        // sentence can.
        teamAbbr,
        // Same category of fact, and for the same reason: the lane a row was
        // written by is not a judgement that can go stale.
        sourceType,
        authorHandle: item.authorHandle?.toString().trim().toLowerCase() || null,
      };

      // Attribution upgrades but never downgrades. A row that already names the
      // outlet that broke the story must not be flattened back to a relay's
      // name because a second, less specific provider re-saw the same headline
      // — and with two providers writing here, that race is routine rather than
      // hypothetical. So an update carries `source` only when this batch
      // actually knows an outlet; otherwise the stored value stands.
      const attribution = outlet ? { source: outlet } : {};

      const existingId = idByKey.get(dedupeKey);
      const stored = existingId ? rowById.get(existingId) : undefined;
      if (
        existingId &&
        stored &&
        sameFields(stored, fields) &&
        (outlet === null || stored.source === outlet)
      ) {
        seenIds.push(existingId);
        unchanged++;
      } else if (existingId) {
        // firstSeenAt, summary and the original id are deliberately untouched.
        await tx
          .update(newsItems)
          .set({ ...fields, ...attribution, lastSeenAt: now })
          .where(eq(newsItems.id, existingId));
        updated++;
      } else if (keyById.has(id)) {
        // Same story, reworded upstream. Update in place and move the
        // fingerprint with it, so the next ingest matches on the new title
        // instead of colliding here again.
        await tx
          .update(newsItems)
          .set({ ...fields, ...attribution, dedupeKey, lastSeenAt: now })
          .where(eq(newsItems.id, id));
        updated++;
      } else {
        inserts.push({
          ...fields,
          id,
          dedupeKey,
          source: outlet ?? provider,
          // Insert only. A club's standfirst is better than a generated
          // synopsis and is free, so it is worth taking on the way in — but
          // setting it on update too would overwrite whatever
          // backfillSummaries() produced for the row, on every single ingest,
          // for as long as the item stays in the feed.
          ...(item.summary?.toString().trim()
            ? { summary: item.summary.toString().trim() }
            : {}),
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }

    if (seenIds.length > 0) {
      await tx
        .update(newsItems)
        .set({ lastSeenAt: now })
        .where(inArray(newsItems.id, seenIds));
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
    { total: rawItems.length, inserted, updated, unchanged },
    "Ingest complete",
  );

  await backfillSummaries();

  // Piggyback the player -> team refresh on the ingest cycle. It self-throttles
  // to once a day and never throws, so this is just a convenient heartbeat.
  await ensureTeams();

  return { inserted, updated, unchanged, total: rawItems.length };
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
 * POST /api/ingest/clubs — sweep the 32 club feeds now.
 *
 * The club half of POST /api/ingest, kept separate for the reason
 * runClubIngest() is: the two providers run on different cadences and fail for
 * unrelated reasons, and a single endpoint that did both would make "the wire
 * is blocked" and "one club is down" the same 500.
 *
 * Pull-only. There is no push mode here because there is nothing to push
 * through — a caller with items already has POST /api/ingest, and a second
 * anonymous way to write arbitrary headlines into the archive is exactly what
 * that endpoint's guard exists to prevent.
 */
router.post("/ingest/clubs", async (req, res) => {
  const secret = process.env["INGEST_SECRET"];
  if (secret && req.get("x-ingest-secret") !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    const result = await runClubIngest();
    const clubs = clubIngestStatus();
    res.json({
      ok: true,
      ...result,
      feedsOk: clubs.clubsOk,
      feedsFailed: clubs.clubsFailed,
      feedsStale: clubs.clubsStale,
    });
  } catch (err) {
    req.log.error({ err }, "Club news sweep failed");
    res.status(500).json({ ok: false, error: String(err) });
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
 * The same question, asked of every store this deployment serves from: the two
 * news providers, the shipped data files, and the Fantasy Points Allowed table,
 * whose weekly ingest is triggered from outside and so is the one that can stop
 * most quietly.
 *
 * Deliberately unauthenticated and free of secrets: booleans, timestamps, counts
 * and an error message, never the feed URL or the connection string.
 */
router.get("/status", (_req, res) => {
  void (async () => {
    const ingest = ingestStatus();
    const clubs = clubIngestStatus();
    const fpa = fpaRefreshStatus();
    const nowMs = Date.now();

    // Its own catch, not the one below: the FPA table is a different store with
    // a different failure, and a query against it failing must not turn the
    // news status — the thing this endpoint was built for — into a 500. Null
    // means the read itself failed, which the body says rather than leaving it
    // to look like a season with no rows.
    const fpaSnapshot = await fpaSnapshotState().catch((err: unknown) => {
      logger.error({ err }, "Failed to read FPA snapshot state for /api/status");
      return null;
    });

    try {
      const { changedAtMs, count } = await ensureFreshness();
      res.set("Cache-Control", "no-store").json({
        ok: true,
        now: new Date(nowMs).toISOString(),
        feedConfigured: ingest.feedConfigured,
        feedHosts: ingest.feedHosts,
        feedKeyConfigured: ingest.feedKeyConfigured,
        pushModeAvailable: Boolean(process.env["INGEST_SECRET"]),
        // Where the shipped data files resolved to, and whether the two that
        // have no runtime fallback are actually there. A deployment whose
        // `data/` is missing does not fail — the readers all default — it
        // serves an empty player index and a rankings board with no rows, and
        // looks healthy doing it. This is the line that says so out loud.
        data: dataDirStatus(),
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
        // The second provider, reported separately for the reason
        // ClubIngestState gives: these two fail independently, and a single
        // verdict covering both would call the ingest healthy while the half
        // that feeds the team pages was dead.
        clubs: {
          lastAttempt: iso(clubs.lastAttemptMs),
          lastSuccess: iso(clubs.lastSuccessMs),
          secondsSinceLastSuccess:
            clubs.lastSuccessMs === null
              ? null
              : Math.round((nowMs - clubs.lastSuccessMs) / 1000),
          lastResult: clubs.lastResult,
          lastError: clubs.lastError,
          consecutiveFailures: clubs.consecutiveFailures,
          feedsOk: clubs.clubsOk,
          feedsTotal: TEAMS.length,
          // Named rather than counted: "3 clubs failed" sends someone to the
          // logs, "was, min, chi" is already the answer.
          feedsFailed: clubs.clubsFailed,
          feedsStale: clubs.clubsStale,
        },
        // Fantasy Points Allowed, which is a weekly ingest with no traffic
        // hook behind it and so the one most able to stop without anyone
        // noticing — as it did, serving figures two days old while everything
        // here reported healthy. `snapshotWrittenAt` is the line that matters:
        // it comes from the database, so it survives a redeploy and describes
        // the numbers actually being served rather than this process's
        // activity. The rest is this process, and resets when it restarts.
        fpa: {
          ...(fpaSnapshot === null
            ? { snapshotWrittenAt: null, error: "failed to read snapshot state" }
            : {
                season: fpaSnapshot.season,
                snapshotWrittenAt: iso(fpaSnapshot.writtenAtMs),
                secondsSinceSnapshot:
                  fpaSnapshot.writtenAtMs === null
                    ? null
                    : Math.round((nowMs - fpaSnapshot.writtenAtMs) / 1000),
                weekNumber: fpaSnapshot.weekNumber,
                dataMode: fpaSnapshot.dataMode,
              }),
          // Whether POST /api/fpa/ingest requires the secret here. Unset, the
          // endpoint is open — the same posture POST /api/ingest takes.
          ingestGuarded: Boolean(process.env["INGEST_SECRET"]),
          running: fpa.running,
          lastAttempt: iso(fpa.lastAttemptMs),
          lastSuccess: iso(fpa.lastSuccessMs),
          secondsSinceLastSuccess:
            fpa.lastSuccessMs === null
              ? null
              : Math.round((nowMs - fpa.lastSuccessMs) / 1000),
          lastResult: fpa.lastResult,
          lastError: fpa.lastError,
          consecutiveFailures: fpa.consecutiveFailures,
        },
        // The after-game refresh of the player pages' game logs. `latestWeek`
        // is what the pages are actually serving: the newest week with any
        // rows in this season's file, the first number to check when a
        // reader says last night's game is missing.
        playerStats: {
          ...playerRefreshStatus(),
          season: seasonYear(),
          latestWeek: latestLoggedWeek(seasonYear()),
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

/**
 * GET /api/ingest/health — the endpoint to point a monitor at.
 *
 * `/api/status` is for a human reading the whole picture and always answers 200,
 * which is right for diagnosis and useless for alerting: nothing pages on a 200.
 * This answers **503 when the ingest has stopped working**, so any uptime checker
 * — Replit's, UptimeRobot, a curl in cron — turns it into a notification without
 * this app needing to know how to send one.
 *
 * Deliberately NOT folded into `/api/healthz`. That one is the platform's
 * liveness probe: making it fail on a stale ingest would have Replit restart a
 * perfectly healthy process, and restarting changes nothing about a feed that is
 * refusing us.
 *
 * This outage ran for hours before anyone noticed. That gap is the thing this
 * endpoint exists to close — it fires while the page still looks fine, well
 * before the archive visibly falls behind.
 */
router.get("/ingest/health", (_req, res) => {
  const verdict = evaluateIngestHealth({
    nowMs: Date.now(),
    lastSuccessMs: ingestState.lastSuccessMs,
    consecutiveFailures: ingestState.consecutiveFailures,
    startedMs: PROCESS_STARTED_MS,
  });

  res
    .status(verdict.ok ? 200 : 503)
    .set("Cache-Control", "no-store")
    .json({
      ok: verdict.ok,
      // Plural: one alert should explain the whole picture, not the first thing
      // that tripped.
      reasons: verdict.reasons,
      consecutiveFailures: ingestState.consecutiveFailures,
      lastSuccess: iso(ingestState.lastSuccessMs),
      lastError: ingestState.lastError,
      lastSource: ingestState.lastSource,
      thresholds: {
        maxFailures: ALERT_MAX_FAILURES,
        maxAgeMs: ALERT_MAX_AGE_MS,
      },
    });
});

/** The newest week with any rows in a season's game-log file, or 0. */
function latestLoggedWeek(season: number): number {
  let latest = 0;
  for (const rows of Object.values(loadGameLogs(season))) {
    for (const row of rows) if (row.week > latest) latest = row.week;
  }
  return latest;
}

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

      // Every open news tab polls this every two minutes. A short shared
      // lifetime lets browsers and any cache in front answer the repeats
      // without a query; the ingest runs every ten minutes, so 30s costs
      // nothing in freshness.
      res.set("Cache-Control", "public, max-age=30");
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
