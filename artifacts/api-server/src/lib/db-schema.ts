/**
 * The runtime-created tables, made once per process rather than on every use.
 *
 * practice-store.ts, depth-charts.ts and image-versions.ts each used to run
 * CREATE TABLE IF NOT EXISTS before every read and write, so a publish that
 * skipped the schema push still worked. The statement is cheap for Postgres
 * but it is a round trip, and on a database that suspends when idle a round
 * trip is a wake-up. Here it runs once, at startup or on the first use that
 * gets there first, and the stores only query after it has settled.
 *
 * Nothing destructive: IF NOT EXISTS, the same definitions as the drizzle
 * schema under lib/db/src/schema, and no ALTER of any kind.
 */

import { dbAccess } from "./db-access";
import { logger } from "./logger";

const STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS practice_reports (season integer PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS depth_charts (season integer PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS player_image_versions (" +
    "player_id text PRIMARY KEY, version text, source_etag text, " +
    "checked_at timestamp with time zone NOT NULL DEFAULT now(), " +
    "updated_at timestamp with time zone NOT NULL DEFAULT now())",
];

let ready: Promise<boolean> | null = null;

/**
 * True once the runtime tables exist. False, and retried on the next call,
 * when the database could not be reached. Null DATABASE_URL is false without
 * a connection attempt, which leaves every store in its file-only mode.
 */
export function ensureRuntimeTables(): Promise<boolean> {
  if (!process.env["DATABASE_URL"]) return Promise.resolve(false);
  ready ??= (async () => {
    const { pool } = await import("@workspace/db");
    dbAccess("schema_init", { tables: STATEMENTS.length });
    try {
      for (const statement of STATEMENTS) await pool.query(statement);
      return true;
    } catch (err) {
      logger.warn({ err }, "runtime tables could not be created; stores fall back to files or memory");
      ready = null;
      return false;
    }
  })();
  return ready;
}
