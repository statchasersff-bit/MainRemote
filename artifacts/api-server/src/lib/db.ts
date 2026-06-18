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
    firstSeenAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_pubDate ON news_items(pubDate DESC);
  CREATE INDEX IF NOT EXISTS idx_news_playerName ON news_items(playerName);
`);

// Migration: add the summary column to pre-existing databases.
const columns = db.prepare("PRAGMA table_info(news_items)").all() as {
  name: string;
}[];
if (!columns.some((c) => c.name === "summary")) {
  db.exec("ALTER TABLE news_items ADD COLUMN summary TEXT");
}

logger.info({ path: DB_PATH }, "Database initialized");
