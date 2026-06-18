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

logger.info({ path: DB_PATH }, "Database initialized");
