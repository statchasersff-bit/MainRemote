import { Router } from "express";
import { db, newsDedupeKey } from "../lib/db";
import { listNews } from "../lib/news-query";
import { logger } from "../lib/logger";
import { summarize, summariesEnabled } from "../lib/summarize";
import { ensureTeams } from "../lib/teams";
import { invalidateFreshness } from "../lib/freshness";
import { invalidateRenderCache } from "../lib/ssr";

// Per-ingest cap so a large backlog fills gradually instead of one huge burst.
const SUMMARY_BATCH = 25;
const SUMMARY_CONCURRENCY = 3;

// Generate synopses for the newest items still missing one.
async function backfillSummaries(): Promise<void> {
  if (!summariesEnabled()) return;

  const rows = db
    .prepare(
      `SELECT id, title FROM news_items
       WHERE summary IS NULL AND title IS NOT NULL
       ORDER BY pubDateMs DESC, firstSeenAt DESC
       LIMIT ?`,
    )
    .all(SUMMARY_BATCH) as { id: string; title: string }[];

  if (rows.length === 0) return;

  const update = db.prepare("UPDATE news_items SET summary = ? WHERE id = ?");
  let generated = 0;

  for (let i = 0; i < rows.length; i += SUMMARY_CONCURRENCY) {
    const chunk = rows.slice(i, i + SUMMARY_CONCURRENCY);
    const results = await Promise.all(chunk.map((r) => summarize(r.title)));
    for (let j = 0; j < chunk.length; j++) {
      const text = results[j];
      if (text) {
        update.run(text, chunk[j]!.id);
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

  const now = new Date().toISOString();

  // Dedupe on the content fingerprint (newsDedupeKey), not the raw id. If a row
  // with the same fingerprint already exists we update it in place — keeping its
  // original id, summary, and firstSeenAt — so a changed upstream id or pubDate
  // format can never spawn a second copy of the same story.
  const findByKey = db.prepare("SELECT id FROM news_items WHERE dedupeKey = ?");

  const insert = db.prepare(`
    INSERT INTO news_items (id, dedupeKey, title, link, pubDate, pubDateMs, playerName, image, source, firstSeenAt, lastSeenAt)
    VALUES (@id, @dedupeKey, @title, @link, @pubDate, @pubDateMs, @playerName, @image, @source, @now, @now)
  `);

  const update = db.prepare(`
    UPDATE news_items SET
      title = @title,
      link = @link,
      pubDate = @pubDate,
      pubDateMs = @pubDateMs,
      playerName = @playerName,
      image = @image,
      lastSeenAt = @now
    WHERE id = @id
  `);

  let inserted = 0;
  let updated = 0;

  const insertMany = db.transaction((items: RawNewsItem[]) => {
    for (const item of items) {
      const id = item.id?.toString().trim() || makeFallbackId(item);
      const dedupeKey = newsDedupeKey({ title: item.title, id });
      const parsedMs = item.pubDate ? Date.parse(item.pubDate) : NaN;

      const row = {
        title: item.title ?? "(no title)",
        link: item.link ?? null,
        pubDate: item.pubDate ?? null,
        pubDateMs: Number.isNaN(parsedMs) ? null : parsedMs,
        playerName: item.playerName ?? null,
        image: item.image ?? null,
        now,
      };

      const existing = findByKey.get(dedupeKey) as { id: string } | undefined;
      if (existing) {
        update.run({ ...row, id: existing.id });
        updated++;
      } else {
        insert.run({
          ...row,
          id,
          dedupeKey,
          source: "Dynasty Command",
        });
        inserted++;
      }
    }
  });

  insertMany(rawItems);

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
  const rawLimit = parseInt(String(req.query["limit"] ?? ""), 10);
  const search = String(req.query["search"] ?? "").trim();

  // Shared with the server-side renderer so the JSON the browser refreshes with
  // is the same shape — including the resolved `team` — that SSR used.
  const items = listNews({
    ...(Number.isNaN(rawLimit) ? {} : { limit: rawLimit }),
    search,
  });

  res.json({ ok: true, count: items.length, items });
});

export default router;
