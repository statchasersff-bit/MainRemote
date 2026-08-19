import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The news archive.
 *
 * Rows arrive from the Dynasty Command feed on a timer and are never deleted —
 * this is the store of record for what the tool renders, and the reason it can
 * show a back catalogue the upstream feed no longer carries (upstream returns
 * only its latest ~25 items).
 */
export const newsItems = pgTable(
  "news_items",
  {
    id: text("id").primaryKey(),

    /**
     * Content fingerprint (normalised title) — what an ingest dedupes on, NOT
     * the upstream id. The feed has changed both its id scheme and its pubDate
     * formatting before, and keying on either stored the same story twice. The
     * unique index below is what makes that impossible rather than merely
     * unlikely.
     */
    dedupeKey: text("dedupe_key").notNull().unique(),

    title: text("title").notNull(),
    link: text("link"),

    /** The feed's own string, kept verbatim for display and debugging. */
    pubDate: text("pub_date"),
    /**
     * The same instant as epoch milliseconds. pubDate is human-readable
     * ("Wed, 17 Jun 2026 8:17:00 AM PDT") and sorts wrong as text, so ordering
     * always uses this column.
     */
    pubDateMs: bigint("pub_date_ms", { mode: "number" }),

    playerName: text("player_name"),
    image: text("image"),
    source: text("source").default("Dynasty Command"),

    /** Generated synopsis; null until the summary backfill reaches the row. */
    summary: text("summary"),

    /**
     * When the story entered the archive, and when an ingest last saw it
     * upstream. firstSeenAt drives the "last updated" stamp: lastSeenAt moves
     * on every ingest that re-sees an unchanged item, so it cannot.
     */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The list's only ordering, newest first.
    index("idx_news_pub_date_ms").on(table.pubDateMs.desc()),
    index("idx_news_player_name").on(table.playerName),
  ],
);

export type NewsItemRow = typeof newsItems.$inferSelect;
export type InsertNewsItem = typeof newsItems.$inferInsert;
