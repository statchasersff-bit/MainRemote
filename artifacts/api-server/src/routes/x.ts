/**
 * The X integration's own surface: monitored accounts, status, manual sweep.
 *
 * Mounted at the root by app.ts, the way the embed and team routers are, so
 * that the API (/api/x/...) and the page it drives (/admin/x) can live in one
 * file instead of being split across two mounts. Everything that writes
 * is behind INGEST_SECRET — the same guard, presented the same way
 * (`x-ingest-secret`), as the existing ingest endpoints. Reusing it rather than
 * inventing a second scheme is deliberate: this app has no user accounts and no
 * session, and adding an auth system for one settings page would be a far
 * bigger change to the product than the feature warrants.
 *
 * Nothing here can hang a request or take the tool down with it: every handler
 * is bounded, catches its own errors, and answers a status code rather than
 * throwing into Express.
 */

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireIngestSecret } from "../lib/ingest-auth";
import { eq } from "drizzle-orm";
import { db, xMonitoredAccounts } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  getAccount,
  listAccounts,
  normalizeHandle,
  seedAccounts,
} from "../lib/x/accounts";
import { DEFAULT_RULES, ingestPosts } from "../lib/x/ingest";
import {
  buildFilterRules,
  expectedWebhookSecret,
  readDelivery,
  ruleTag,
} from "../lib/x/webhook";
import { findPosts, normalizeApiTweet } from "../lib/x/rest-provider";
import { tick } from "../lib/x/scheduler";

/**
 * Bounds on one pushed batch.
 *
 * A request is parsed, normalised and written inside one handler, so its size
 * is the size of a unit of work this server cannot decline halfway through. A
 * collector with a backlog sends several batches, which is also how it finds
 * out early that something is wrong.
 */
const MAX_PUSH_POSTS = 200;

/** Ceiling on a push's own age window — see the route. */
const MAX_PUSH_AGE_DAYS = 365;
import { xSchedulerStatus } from "../lib/x/scheduler";
import { xIngestionEnabled } from "../lib/x/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router: Router = Router();

/** Booleans arrive from JSON and from a form; accept both, reject neither. */
function boolField(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return undefined;
}

const PRIORITIES = new Set(["high", "normal", "low"]);

/**
 * GET /api/x/accounts — the monitored list.
 *
 * Readable without the secret. It is a list of public reporters' handles and
 * when we last read them; there is nothing in it that is not already visible on
 * the cards it produces.
 */
router.get("/api/x/accounts", (_req, res) => {
  void (async () => {
    try {
      const accounts = await listAccounts();
      res.set("Cache-Control", "no-store").json({
        ok: true,
        enabled: xIngestionEnabled(),
        count: accounts.length,
        accounts,
      });
    } catch (err) {
      logger.error({ err }, "[X INGEST] could not list accounts");
      res.status(500).json({ ok: false, error: "failed to list accounts" });
    }
  })();
});

/** POST /api/x/accounts — add a reporter. No deploy required, which is the point. */
router.post("/api/x/accounts", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = normalizeHandle(String(body["username"] ?? ""));

    // X's own rule: 1-15 characters, letters, digits and underscore.
    if (!/^[a-z0-9_]{1,15}$/.test(username)) {
      res.status(400).json({ ok: false, error: "invalid X handle" });
      return;
    }

    const priority = String(body["priority"] ?? "normal").toLowerCase();

    try {
      const [row] = await db
        .insert(xMonitoredAccounts)
        .values({
          username,
          displayName: String(body["displayName"] ?? "").trim() || null,
          priority: PRIORITIES.has(priority) ? priority : "normal",
          category: String(body["category"] ?? "").trim() || null,
          teamAbbr: String(body["teamAbbr"] ?? "").trim().toLowerCase() || null,
          ...(boolField(body["includeOriginals"]) !== undefined
            ? { includeOriginals: boolField(body["includeOriginals"])! }
            : {}),
          ...(boolField(body["includeReplies"]) !== undefined
            ? { includeReplies: boolField(body["includeReplies"])! }
            : {}),
          ...(boolField(body["includeReposts"]) !== undefined
            ? { includeReposts: boolField(body["includeReposts"])! }
            : {}),
          ...(boolField(body["includeQuotes"]) !== undefined
            ? { includeQuotes: boolField(body["includeQuotes"])! }
            : {}),
        })
        // Adding a handle that is already monitored is not an error, it is a
        // no-op — the operator's intent ("watch this reporter") is already true.
        .onConflictDoNothing({ target: xMonitoredAccounts.username })
        .returning();

      res.status(row ? 201 : 200).json({
        ok: true,
        created: Boolean(row),
        account: row ?? (await getAccount(username)),
      });
    } catch (err) {
      logger.error({ err, username }, "[X INGEST] could not add account");
      res.status(500).json({ ok: false, error: "failed to add account" });
    }
  })();
});

/** PATCH /api/x/accounts/:username — enable, re-prioritise, toggle post kinds. */
router.patch("/api/x/accounts/:username", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    const username = normalizeHandle(String(req.params["username"] ?? ""));
    const body = (req.body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const enabled = boolField(body["enabled"]);
    if (enabled !== undefined) updates["enabled"] = enabled;

    for (const field of [
      "includeOriginals",
      "includeReplies",
      "includeReposts",
      "includeQuotes",
    ] as const) {
      const value = boolField(body[field]);
      if (value !== undefined) updates[field] = value;
    }

    if (body["priority"] !== undefined) {
      const priority = String(body["priority"]).toLowerCase();
      if (!PRIORITIES.has(priority)) {
        res.status(400).json({ ok: false, error: "invalid priority" });
        return;
      }
      updates["priority"] = priority;
      // A change of cadence should take effect now rather than after the old
      // one elapses, so the account is made due again.
      updates["lastCheckedAt"] = null;
    }

    if (body["category"] !== undefined) {
      updates["category"] = String(body["category"]).trim() || null;
    }
    if (body["teamAbbr"] !== undefined) {
      updates["teamAbbr"] = String(body["teamAbbr"]).trim().toLowerCase() || null;
    }
    if (body["displayName"] !== undefined) {
      updates["displayName"] = String(body["displayName"]).trim() || null;
    }

    // Re-enabling a reporter who has been failing should try again straight
    // away rather than serve out the backoff earned while nobody was watching.
    if (enabled === true) {
      updates["consecutiveFailures"] = 0;
      updates["lastError"] = null;
      updates["lastCheckedAt"] = null;
    }

    try {
      const [row] = await db
        .update(xMonitoredAccounts)
        .set(updates)
        .where(eq(xMonitoredAccounts.username, username))
        .returning();

      if (!row) {
        res.status(404).json({ ok: false, error: "no such account" });
        return;
      }

      res.json({ ok: true, account: row });
    } catch (err) {
      logger.error({ err, username }, "[X INGEST] could not update account");
      res.status(500).json({ ok: false, error: "failed to update account" });
    }
  })();
});

/**
 * DELETE /api/x/accounts/:username — stop monitoring a reporter.
 *
 * Removes the account row and nothing else. The posts it already produced stay
 * in the archive: they are news that was published, and deleting a reporter
 * from the watch list is not a statement that what they reported never
 * happened.
 */
router.delete("/api/x/accounts/:username", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    const username = normalizeHandle(String(req.params["username"] ?? ""));

    try {
      const [row] = await db
        .delete(xMonitoredAccounts)
        .where(eq(xMonitoredAccounts.username, username))
        .returning({ id: xMonitoredAccounts.id });

      if (!row) {
        res.status(404).json({ ok: false, error: "no such account" });
        return;
      }

      res.json({ ok: true, removed: username });
    } catch (err) {
      logger.error({ err, username }, "[X INGEST] could not remove account");
      res.status(500).json({ ok: false, error: "failed to remove account" });
    }
  })();
});

/** POST /api/x/accounts/seed — re-apply the seed list. Additive; never updates. */
router.post("/api/x/accounts/seed", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;
    try {
      res.json({ ok: true, added: await seedAccounts() });
    } catch (err) {
      logger.error({ err }, "[X INGEST] seeding failed");
      res.status(500).json({ ok: false, error: "failed to seed accounts" });
    }
  })();
});

/**
 * POST /api/x/ingest — run a sweep now.
 *
 * Bounded by the same claim the timer uses, so "run now" cannot check an
 * account that is not due and cannot double up with a tick already in flight.
 */
router.post("/api/x/ingest", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    if (!xIngestionEnabled()) {
      res.status(409).json({
        ok: false,
        error: "X ingestion is disabled (X_NEWS_INGESTION_ENABLED)",
      });
      return;
    }

    const rawLimit = Number(req.body?.limit ?? req.query["limit"]);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 40)
        : undefined;

    const result = await tick();
    if (!result) {
      res.status(409).json({ ok: false, error: "a sweep is already running" });
      return;
    }
    res.json({ ok: true, limit: limit ?? null, ...result });
  })();
});

/**
 * POST /api/x/posts — store posts this server did not fetch.
 *
 * The push counterpart to the poller, and the same idea as POST /api/ingest's
 * push mode: whatever collected these posts is not this server's concern, and
 * everything after they arrive is. They go through `ingestPosts()` — the exact
 * code path a polled post takes — so a pushed post is deduplicated on its post
 * id, filtered by its author's toggles, tagged with a player, a team and a
 * category, and rendered on a card, identically to one the poller found.
 *
 * This exists so the acquisition half can live wherever it has to. If you have
 * an arrangement with X, an enterprise credential, a vendor's webhook, a
 * collector running somewhere with its own agreement in place, or a person with
 * a keyboard — any of them can drive this, and none of them requires a change
 * to the news tool.
 *
 * The body is tolerant on purpose: it accepts a bare array or `{posts: [...]}`,
 * and each post may be in the normalised shape or in any of the vendor shapes
 * the API provider already understands (X's v1.1 object, X API v2, or the
 * camelCase reseller shape). Whatever your collector already has in hand is
 * very likely postable without reshaping it.
 *
 * Guarded by INGEST_SECRET and — unlike the pull route — it does NOT require
 * X_NEWS_INGESTION_ENABLED: the flag governs whether this server polls anyone,
 * which is a separate question from whether it will accept posts you hand it.
 *
 * The monitored accounts' watermarks are deliberately left alone. A push says
 * what one collector saw, and moving `last_seen_post_id` past it would tell the
 * poller to skip a range it may cover differently. Storing the same post twice
 * is already impossible; skipping one for good is not worth risking to save a
 * lookup.
 */
router.post("/api/x/posts", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    const body = req.body as unknown;
    const raw = Array.isArray(body)
      ? body
      : Array.isArray((body as { posts?: unknown } | null)?.posts)
        ? ((body as { posts: unknown[] }).posts)
        : findPosts(body);

    if (raw.length === 0) {
      res.status(400).json({
        ok: false,
        error: "no posts in the request body",
        hint: "send an array of posts, or {\"posts\": [...]}",
      });
      return;
    }

    if (raw.length > MAX_PUSH_POSTS) {
      res.status(413).json({
        ok: false,
        error: `at most ${MAX_PUSH_POSTS} posts per request`,
      });
      return;
    }

    // A backfill is a legitimate reason to push something older than the poller
    // would ever accept, so the window is overridable per request — bounded, so
    // a typo cannot drag a decade of posts into an archive that never deletes.
    const askedAge = Number(
      (body as { maxAgeDays?: unknown } | null)?.maxAgeDays ?? NaN,
    );
    const maxAgeDays =
      Number.isFinite(askedAge) && askedAge > 0
        ? Math.min(askedAge, MAX_PUSH_AGE_DAYS)
        : undefined;

    const posts = [];
    const rejected = [];

    for (const item of raw) {
      if (!item || typeof item !== "object") {
        rejected.push("not an object");
        continue;
      }
      // The same tolerant reader the API provider uses, so a collector can post
      // whatever shape it already holds rather than translating first.
      const post = normalizeApiTweet(item as Record<string, unknown>, "");
      if (!post) {
        rejected.push("no usable post id");
        continue;
      }
      if (!post.authorUsername.trim()) {
        rejected.push(`${post.externalId}: no author handle`);
        continue;
      }
      posts.push(post);
    }

    if (posts.length === 0) {
      res.status(400).json({ ok: false, error: "no usable posts", rejected });
      return;
    }

    try {
      // Each author's own toggles, read once for the batch. An author nobody
      // has configured gets the same defaults a new account row would.
      const handles = [...new Set(posts.map((p) => normalizeHandle(p.authorUsername)))];
      const configured = new Map(
        (await listAccounts())
          .filter((account) => handles.includes(account.username))
          .map((account) => [account.username, account]),
      );

      const result = await ingestPosts(
        posts,
        (username) => configured.get(username) ?? DEFAULT_RULES,
        maxAgeDays ? { maxAgeDays } : {},
      );

      logger.info(
        { received: raw.length, ...result, handles: handles.length },
        "[X INGEST] push accepted",
      );

      res.json({
        ok: true,
        received: raw.length,
        ...result,
        // Named so a collector can tell "you already had it" (kept but not
        // stored) from "your filters dropped it" (considered but not kept) —
        // two very different things to be debugging at 3am.
        ...(rejected.length > 0 ? { rejected } : {}),
      });
    } catch (err) {
      logger.error({ err }, "[X INGEST] push failed");
      res.status(500).json({ ok: false, error: "failed to store posts" });
    }
  })();
});

/**
 * POST /api/x/webhook — a delivery from the provider's filter rule.
 *
 * The real-time path. A rule registered at the provider watches the monitored
 * handles and POSTs here when one of them posts; this hands what arrives to the
 * same `ingestPosts()` the poller and the push route use, so a webhook post is
 * deduplicated, filtered, tagged and rendered identically to every other one.
 *
 * Three rules a webhook endpoint has to follow, all of them here:
 *
 *   1. **Acknowledge almost anything.** A delivery this cannot read is still a
 *      delivery, and answering non-2XX makes the provider retry a payload that
 *      will never work. Only a failed *secret* is rejected; a malformed body is
 *      logged and acknowledged.
 *   2. **Be quick.** The work is a filter, a dedupe query and one insert —
 *      tens of milliseconds once warm. The one slow case is a cold process
 *      whose roster index has not loaded, and that is already warmed by the
 *      startup ingest long before a delivery could arrive.
 *   3. **Never trust the body.** It is parsed through the same tolerant reader
 *      as every other provider's JSON, and nothing in it selects a code path.
 *
 * Unlike the pull route this does NOT require X_NEWS_INGESTION_ENABLED: that
 * flag governs whether this server polls anyone, which is a different question
 * from whether it accepts what a provider delivers. Turning the poller off and
 * running on webhooks alone is a supported configuration — and the cheaper one.
 */
router.post("/api/x/webhook", (req, res) => {
  void (async () => {
    const expected = expectedWebhookSecret();

    // Both header names: the provider documents X-API-Key, and x-ingest-secret
    // is what everything else in this app is guarded with.
    const presented =
      req.get("x-api-key")?.trim() || req.get("x-ingest-secret")?.trim() || "";

    if (!expected) {
      // Refusing rather than accepting. This endpoint writes caller-supplied
      // content into the archive, and an unguarded public URL that does that is
      // a way to put arbitrary headlines on the page — the same call
      // POST /api/ingest makes about its push mode.
      logger.error(
        "[X INGEST] webhook delivery refused — set X_WEBHOOK_SECRET (or X_API_KEY)",
      );
      res.status(503).json({ ok: false, error: "webhook is not configured" });
      return;
    }

    if (presented !== expected) {
      // No detail in the response and no secret in the log: the only thing
      // worth recording is that someone tried.
      logger.warn("[X INGEST] webhook delivery rejected — bad key");
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const delivery = readDelivery(req.body);

    if (delivery.eventType !== "tweet") {
      // A ping, a test, a heartbeat — acknowledged and not mistaken for posts.
      logger.info(
        { eventType: delivery.eventType },
        "[X INGEST] webhook delivery with no posts in it",
      );
      res.json({ ok: true, ignored: delivery.eventType });
      return;
    }

    if (delivery.posts.length === 0) {
      logger.warn(
        { rejected: delivery.rejected.slice(0, 5) },
        "[X INGEST] webhook delivery carried no readable posts",
      );
      // 200, deliberately: retrying this will produce the same nothing.
      res.json({ ok: true, received: 0, rejected: delivery.rejected });
      return;
    }

    try {
      const handles = [
        ...new Set(delivery.posts.map((p) => normalizeHandle(p.authorUsername))),
      ];
      const configured = new Map(
        (await listAccounts())
          .filter((account) => handles.includes(account.username))
          .map((account) => [account.username, account]),
      );

      const result = await ingestPosts(
        delivery.posts,
        (username) => configured.get(username) ?? DEFAULT_RULES,
      );

      logger.info(
        { rule: delivery.ruleTag, ...result },
        `[X INGEST] webhook delivered ${result.stored} new post${result.stored === 1 ? "" : "s"}`,
      );

      res.json({ ok: true, received: delivery.posts.length, ...result });
    } catch (err) {
      logger.error({ err }, "[X INGEST] webhook delivery failed to store");
      // 500 here, unlike the cases above: this one IS worth retrying, because
      // the delivery was fine and our side was not.
      res.status(500).json({ ok: false, error: "failed to store posts" });
    }
  })();
});

/**
 * GET /api/x/webhook/rules — the filter expressions for the current watchlist.
 *
 * Read-only, and it calls nothing external: registering a rule costs money and
 * creating a duplicate one costs money every time it matches, so this shows
 * exactly what to register and leaves the spending to a deliberate act
 * (scripts/x-webhook-rules.mjs --register).
 *
 * It answers from the accounts that are enabled right now, so after adding a
 * reporter the honest answer to "do I need to update my rules" is this endpoint
 * rather than someone's memory.
 */
router.get("/api/x/webhook/rules", (req, res) => {
  void (async () => {
    try {
      const accounts = (await listAccounts()).filter((a) => a.enabled);
      const suffix = String(req.query["suffix"] ?? "").trim();
      const rules = buildFilterRules(
        accounts.map((a) => a.username),
        suffix ? { suffix } : {},
      );

      res.set("Cache-Control", "no-store").json({
        ok: true,
        accounts: accounts.length,
        // Plural because the watchlist does not fit in one — see MAX_RULE_LENGTH.
        rules: rules.map((value, index) => ({
          tag: ruleTag(index, rules.length),
          value,
          length: value.length,
        })),
        webhookConfigured: Boolean(expectedWebhookSecret()),
      });
    } catch (err) {
      logger.error({ err }, "[X INGEST] could not build filter rules");
      res.status(500).json({ ok: false, error: "failed to build rules" });
    }
  })();
});

/** GET /api/x/status — is the poller running, and what did it last do? */
router.get("/api/x/status", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ ok: true, ...xSchedulerStatus() });
});

/**
 * GET /admin/x — the management page.
 *
 * A plain static file rather than a rendered template: it talks to the JSON API
 * above and has no server state of its own, so there is nothing for a renderer
 * to do. Sent with noindex for the obvious reason.
 */
router.get("/admin/x", (_req, res) => {
  res
    .set("X-Robots-Tag", "noindex, nofollow")
    .set("Cache-Control", "no-store")
    .sendFile(path.resolve(__dirname, "..", "public", "admin-x.html"));
});

export default router;
