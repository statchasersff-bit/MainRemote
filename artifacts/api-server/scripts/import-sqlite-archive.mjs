/**
 * One-time import of the old SQLite archive into Postgres.
 *
 * The store moved from a file in `data/` to Postgres because a GCE deployment
 * rebuilds its filesystem on every publish, so the file was never a store of
 * record. This carries the rows that file had accumulated - including each
 * item's original firstSeenAt and any generated summary, neither of which can
 * be recovered from the upstream feed - into the new home.
 *
 * Idempotent: rows already present (matched on the content fingerprint) are
 * left exactly as they are, so running it twice imports nothing the second
 * time. Safe to run against a populated database.
 *
 * Usage:  node ./scripts/import-sqlite-archive.mjs [path/to/statchasers.db]
 * Needs:  DATABASE_URL
 */

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import pg from "pg";

const sqlitePath = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), "data", "statchasers.db"),
);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`No SQLite database at ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const rows = sqlite
  .prepare(
    `SELECT id, dedupeKey, title, link, pubDate, pubDateMs, playerName, image,
            source, summary, firstSeenAt, lastSeenAt
       FROM news_items
      ORDER BY firstSeenAt ASC`,
  )
  .all();
sqlite.close();

console.log(`Read ${rows.length} rows from ${sqlitePath}`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const before = (await client.query("SELECT COUNT(*)::int AS n FROM news_items"))
  .rows[0].n;

let imported = 0;
try {
  await client.query("BEGIN");
  for (const row of rows) {
    // The fallback matters: dedupeKey was added by a later migration, so the
    // oldest rows in some copies of this file never had one backfilled.
    const dedupeKey =
      row.dedupeKey ||
      (row.title ?? "").toLowerCase().replace(/\s+/g, " ").trim() ||
      `id:${row.id}`;

    const result = await client.query(
      `INSERT INTO news_items
         (id, dedupe_key, title, link, pub_date, pub_date_ms, player_name,
          image, source, summary, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [
        row.id,
        dedupeKey,
        row.title ?? "(no title)",
        row.link,
        row.pubDate,
        row.pubDateMs,
        row.playerName,
        row.image,
        row.source ?? "Dynasty Command",
        row.summary,
        row.firstSeenAt,
        row.lastSeenAt,
      ],
    );
    imported += result.rowCount ?? 0;
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  const after = (
    await client.query("SELECT COUNT(*)::int AS n FROM news_items")
  ).rows[0].n;
  console.log(
    `Imported ${imported} new rows (skipped ${rows.length - imported} already present). ` +
      `news_items: ${before} -> ${after}`,
  );
  await client.end();
}
