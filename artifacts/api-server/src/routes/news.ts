import { Router } from "express";
import { db } from "../lib/db";
import { logger } from "../lib/logger";

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

  const upsert = db.prepare(`
    INSERT INTO news_items (id, title, link, pubDate, playerName, image, source, firstSeenAt, lastSeenAt)
    VALUES (@id, @title, @link, @pubDate, @playerName, @image, @source, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      link = excluded.link,
      pubDate = excluded.pubDate,
      playerName = excluded.playerName,
      image = excluded.image,
      lastSeenAt = excluded.lastSeenAt
  `);

  const countBefore = (db.prepare("SELECT COUNT(*) as c FROM news_items").get() as { c: number }).c;

  const insertMany = db.transaction((items: RawNewsItem[]) => {
    for (const item of items) {
      const id =
        item.id?.toString().trim() || makeFallbackId(item);

      upsert.run({
        id,
        title: item.title ?? "(no title)",
        link: item.link ?? null,
        pubDate: item.pubDate ?? null,
        playerName: item.playerName ?? null,
        image: item.image ?? null,
        source: "Dynasty Command",
        now,
      });
    }
  });

  insertMany(rawItems);

  const countAfter = (db.prepare("SELECT COUNT(*) as c FROM news_items").get() as { c: number }).c;
  const inserted = countAfter - countBefore;
  const updated = rawItems.length - inserted;

  logger.info(
    { total: rawItems.length, inserted, updated },
    "Ingest complete",
  );

  return { inserted, updated, total: rawItems.length };
}

// POST /api/ingest
router.post("/ingest", async (req, res) => {
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
  const rawLimit = parseInt(String(req.query["limit"] ?? "100"), 10);
  const limit = Math.min(Math.max(rawLimit, 1), 250);
  const search = String(req.query["search"] ?? "").trim();

  let items: unknown[];

  if (search) {
    const pattern = `%${search}%`;
    items = db
      .prepare(
        `SELECT * FROM news_items
         WHERE title LIKE ? OR playerName LIKE ?
         ORDER BY pubDate DESC, firstSeenAt DESC
         LIMIT ?`,
      )
      .all(pattern, pattern, limit);
  } else {
    items = db
      .prepare(
        `SELECT * FROM news_items
         ORDER BY pubDate DESC, firstSeenAt DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  res.json({ ok: true, count: items.length, items });
});

export default router;
