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
    firstSeenAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_pubDate ON news_items(pubDate DESC);
  CREATE INDEX IF NOT EXISTS idx_news_playerName ON news_items(playerName);
`);

logger.info({ path: DB_PATH }, "Database initialized");
