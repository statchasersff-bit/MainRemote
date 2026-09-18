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
 * Rows arrive on a timer from two providers — Dynasty Command's player wire and
 * the 32 clubs' own RSS feeds — and are never deleted. This is the store of
 * record for what the tool renders, and the reason it can show a back catalogue
 * neither source still carries: the wire returns only its latest ~25 items, and
 * a club feed only its latest 5 to 100.
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

    /**
     * The club this story belongs to, as our lowercase code ("ne"), or null.
     *
     * Only set by a provider that KNOWS the team rather than infers it — which
     * today means the club feeds, where the team is the feed we fetched. The
     * player wire leaves it null and its rows are still resolved at read time
     * from the headshot and then the player's name (lib/news-query.ts).
     *
     * That split is the whole point of the column: a team page can filter the
     * club rows in SQL through the index below, and only has to scan for the
     * derived ones. Nothing backfills it for the wire, because a guess written
     * into a column is indistinguishable from a fact once it is stored.
     */
    teamAbbr: text("team_abbr"),
    image: text("image"),
    source: text("source").default("Dynasty Command"),

    /**
     * Which provider lane wrote the row: "wire", "club" or "x".
     *
     * Nullable and without a default, on purpose. Every row stored before lanes
     * were recorded is legacy and says so by being null, rather than being
     * back-dated into a claim nobody checked — and no read depends on it being
     * filled in. listNews() still separates wire from club exactly the way it
     * always did (team_abbr), and only consults this column to pull the X lane
     * into the main feed. See lib/news-query.ts.
     */
    sourceType: text("source_type"),

    /**
     * The X handle behind the item, lowercase and without the @, for the rows
     * whose author is a person rather than an outlet.
     *
     * On news_items and not only on x_posts because the feed reads it: the card
     * prints "@AdamSchefter" and the account filter narrows on it, and neither
     * should have to join a second table to render one line of a card.
     */
    authorHandle: text("author_handle"),

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
    // A team page's read: one club, newest first. Composite rather than a bare
    // team index so the ordering comes off the index too.
    index("idx_news_team_abbr_pub_date_ms").on(
      table.teamAbbr,
      table.pubDateMs.desc(),
    ),
    // The source filter's read: one lane, newest first.
    index("idx_news_source_type_pub_date_ms").on(
      table.sourceType,
      table.pubDateMs.desc(),
    ),
  ],
);

export type NewsItemRow = typeof newsItems.$inferSelect;
export type InsertNewsItem = typeof newsItems.$inferInsert;
