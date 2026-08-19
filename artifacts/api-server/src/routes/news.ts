import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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

const DYNASTY_NEWS_API_URL = process.env["DYNASTY_NEWS_API_URL"];

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

export async function runIngest(): Promise<{
  inserted: number;
  updated: number;
  total: number;
}> {
  if (!DYNASTY_NEWS_API_URL) {
    throw new Error("DYNASTY_NEWS_API_URL is not set");
  }

  const response = await fetch(DYNASTY_NEWS_API_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Dynasty Command API responded with ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as unknown;
  const rawItems: RawNewsItem[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: RawNewsItem[] }).items)
      : [];

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

    // One lookup for the whole batch, so the work is two round trips plus the
    // writes rather than a query per item.
    const existing = await tx
      .select({ id: newsItems.id, dedupeKey: newsItems.dedupeKey })
      .from(newsItems)
      .where(inArray(newsItems.dedupeKey, keys));
    const idByKey = new Map(existing.map((row) => [row.dedupeKey, row.id]));

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
        .onConflictDoNothing({ target: newsItems.dedupeKey })
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

// POST /api/ingest
router.post("/ingest", async (req, res) => {
  // Opt-in guard: when INGEST_SECRET is set, callers must present it. Keeps the
  // externally-triggerable ingest endpoint from being abused. No secret = open.
  const secret = process.env["INGEST_SECRET"];
  if (secret && req.get("x-ingest-secret") !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    const result = await runIngest();
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Ingest failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

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
