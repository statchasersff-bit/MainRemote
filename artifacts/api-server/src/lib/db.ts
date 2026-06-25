import Database from "better-sqlite3";
import path from "node:path";
import { logger } from "./logger";

const DB_PATH = path.resolve(process.cwd(), "data", "statchasers.db");

// Ensure data directory exists
import { mkdirSync } from "node:fs";
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    link TEXT,
    pubDate TEXT,
    playerName TEXT,
    image TEXT,
    source TEXT DEFAULT 'Dynasty Command',
    summary TEXT,
    pubDateMs INTEGER,
    firstSeenAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_playerName ON news_items(playerName);
`);

// Migration: add the summary column to pre-existing databases.
const columns = db.prepare("PRAGMA table_info(news_items)").all() as {
  name: string;
}[];
if (!columns.some((c) => c.name === "summary")) {
  db.exec("ALTER TABLE news_items ADD COLUMN summary TEXT");
}

// Migration: add a sortable epoch-ms timestamp. pubDate is a human-readable
// string (e.g. "Wed, 17 Jun 2026 8:17:00 AM PDT") that sorts wrong as text, so
// we parse it once into pubDateMs and order by that instead.
if (!columns.some((c) => c.name === "pubDateMs")) {
  db.exec("ALTER TABLE news_items ADD COLUMN pubDateMs INTEGER");
  const rows = db
    .prepare("SELECT id, pubDate FROM news_items WHERE pubDate IS NOT NULL")
    .all() as { id: string; pubDate: string }[];
  const update = db.prepare("UPDATE news_items SET pubDateMs = ? WHERE id = ?");
  const backfill = db.transaction(() => {
    for (const r of rows) {
      const ms = Date.parse(r.pubDate);
      update.run(Number.isNaN(ms) ? null : ms, r.id);
    }
  });
  backfill();
}

// Index the sort column once it's guaranteed to exist (fresh DB via CREATE
// TABLE, existing DB via the migration above).
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_news_pubDateMs ON news_items(pubDateMs DESC)",
);

// A stable content fingerprint for an item. We dedupe on this rather than the
// upstream id: the feed has historically changed both its id scheme and its
// pubDate formatting, and the old fallback id (a hash of title|link|pubDate)
// produced a fresh row for the same article every time that string changed —
// which is how the backlog ended up with each story stored twice.
export function newsDedupeKey(item: {
  title?: string | null;
  id?: string | null;
}): string {
  const title = (item.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return title || `id:${(item.id ?? "").trim()}`;
}

// Migration: add the dedupe key, collapse pre-existing duplicates, and enforce
// uniqueness so the same story can never be stored twice again. Idempotent —
// safe to run on every startup, which lets production self-heal on deploy.
if (!columns.some((c) => c.name === "dedupeKey")) {
  db.exec("ALTER TABLE news_items ADD COLUMN dedupeKey TEXT");
}

{
  const rows = db
    .prepare("SELECT rowid, id, title, summary, firstSeenAt FROM news_items")
    .all() as {
    rowid: number;
    id: string;
    title: string | null;
    summary: string | null;
    firstSeenAt: string;
  }[];

  const setKey = db.prepare("UPDATE news_items SET dedupeKey = ? WHERE rowid = ?");
  const deleteRow = db.prepare("DELETE FROM news_items WHERE rowid = ?");

  // Group rows by their content fingerprint so duplicates land together.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = newsDedupeKey(r);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  let removed = 0;
  const cleanup = db.transaction(() => {
    for (const [key, group] of groups) {
      // Keep the best copy: prefer one that already has a generated summary,
      // then the earliest-seen row. Backfill the key, drop the rest.
      group.sort((a, b) => {
        if (!!a.summary !== !!b.summary) return a.summary ? -1 : 1;
        return a.firstSeenAt < b.firstSeenAt ? -1 : 1;
      });
      const [keep, ...rest] = group;
      setKey.run(key, keep!.rowid);
      for (const dup of rest) {
        deleteRow.run(dup.rowid);
        removed++;
      }
    }
  });
  cleanup();

  if (removed > 0) {
    logger.warn({ removed }, "Removed duplicate news items");
  }
}

db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_news_dedupeKey ON news_items(dedupeKey)",
);

logger.info({ path: DB_PATH }, "Database initialized");
