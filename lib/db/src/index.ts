import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const ms = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A suspended or failing database must fail a query, not hang a request.
  connectionTimeoutMillis: ms("DB_CONNECT_TIMEOUT_MS", 10_000),
  idleTimeoutMillis: ms("DB_IDLE_TIMEOUT_MS", 30_000),
  statement_timeout: ms("DB_STATEMENT_TIMEOUT_MS", 30_000),
});

// An idle client the server drops (the database suspending, a failover, an
// admin terminate) is emitted here. With no listener Node treats it as an
// uncaught 'error' and the whole process exits; the pool already discards the
// broken client and opens a fresh one on the next query.
pool.on("error", (err) => {
  console.warn(`[db] idle client error: ${err.message}`);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
