import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The X (Twitter) reporters this tool watches.
 *
 * A table rather than a constant, because the operator has to be able to add,
 * disable or re-prioritise a reporter without a deploy — the admin surface at
 * /admin/x writes here and the poller reads here, and nothing in between needs
 * to know the list. The seed list in the api-server's lib/x/accounts.ts only
 * fills in rows that do not exist yet; it never overwrites a row the operator
 * has edited, and never re-enables one they disabled.
 */
export const xMonitoredAccounts = pgTable(
  "x_monitored_accounts",
  {
    id: serial("id").primaryKey(),

    /**
     * The handle, lowercased and WITHOUT the leading @.
     *
     * Lowercase is the stored form because X treats handles case-insensitively
     * and the admin UI, the seed list and a URL path would otherwise each be
     * able to create a second row for the same reporter. Display case lives in
     * displayName.
     */
    username: text("username").notNull().unique(),
    displayName: text("display_name"),

    /** Off means the poller skips it entirely. Rows are disabled, not deleted. */
    enabled: boolean("enabled").notNull().default(true),

    /** Free text: "national", "beat", "insider". Shown in the admin list. */
    category: text("category"),

    /** Lowercase club code when a reporter covers one team, else null. */
    teamAbbr: text("team_abbr"),

    /** "high" | "normal" | "low" — see POLL_INTERVALS in lib/x/config.ts. */
    priority: text("priority").notNull().default("normal"),

    /**
     * Which kinds of post from this account are worth storing.
     *
     * Per-account rather than global because the answer genuinely differs: a
     * national insider breaks news in reply threads, a beat writer's replies
     * are conversation. Defaults match the product default — original posts and
     * quote posts with their own text, nothing else.
     */
    includeOriginals: boolean("include_originals").notNull().default(true),
    includeReplies: boolean("include_replies").notNull().default(false),
    includeReposts: boolean("include_reposts").notNull().default(false),
    includeQuotes: boolean("include_quotes").notNull().default(true),

    /**
     * The polling claim.
     *
     * Moved by an atomic conditional UPDATE before the fetch, not after it —
     * that write IS the lock. Two workers, or the same worker re-entered after
     * a restart, cannot both claim an account, because only one of them can win
     * the `last_checked_at < cutoff` predicate. See claimDueAccounts().
     */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),

    /**
     * Newest post id we have already handled for this account.
     *
     * The watermark the provider is asked to fetch since. It is a floor, not
     * the dedupe mechanism — x_posts.post_id is that — so losing it costs a
     * little redundant work and never a duplicate row.
     */
    lastSeenPostId: text("last_seen_post_id"),

    /** Consecutive failures, for the backoff in dueAfter(). Reset on success. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The poller's only read: enabled accounts, least-recently-checked first.
    index("idx_x_accounts_enabled_last_checked").on(
      table.enabled,
      table.lastCheckedAt,
    ),
  ],
);

export type XMonitoredAccountRow = typeof xMonitoredAccounts.$inferSelect;
export type InsertXMonitoredAccount = typeof xMonitoredAccounts.$inferInsert;

/**
 * The source record for one X post.
 *
 * Deliberately separate from news_items rather than a dozen more nullable
 * columns on it. news_items is the feed's projection — a headline, a time, a
 * player, a link — and every consumer of it (the renderer, the team pages, the
 * WordPress fragment) reads all of those. Reply/repost/quote flags, quoted-post
 * text and media lists are true of an X post and of nothing else in the
 * archive, and putting them on the shared table would make every other
 * provider's rows carry eleven columns that can only ever be null.
 *
 * The association runs the other way instead: newsItemId points at the row this
 * post produced in the normal feed. One post, one news item, and the post id is
 * the primary key — so a post cannot be stored twice however many jobs see it.
 */
export const xPosts = pgTable(
  "x_posts",
  {
    /** X's own post id (the snowflake), as a string. The dedupe identity. */
    postId: text("post_id").primaryKey(),

    /** Lowercase handle, matching x_monitored_accounts.username. */
    authorUsername: text("author_username").notNull(),
    /** "Adam Schefter" — as the source gave it, when it gave one. */
    authorName: text("author_name"),

    text: text("text").notNull(),
    url: text("url").notNull(),

    /** Post time as epoch ms. The feed orders on this. */
    createdAtMs: bigint("created_at_ms", { mode: "number" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    isReply: boolean("is_reply").notNull().default(false),
    isRepost: boolean("is_repost").notNull().default(false),
    isQuote: boolean("is_quote").notNull().default(false),

    quotedPostId: text("quoted_post_id"),
    quotedAuthor: text("quoted_author"),
    quotedText: text("quoted_text"),

    /** Media URLs as a JSON array of strings. Empty array when there are none. */
    media: jsonb("media").$type<string[]>(),

    /** What the shared pipeline made of the text — stored for auditing. */
    playerName: text("player_name"),
    teamAbbr: text("team_abbr"),
    category: text("category"),

    /** news_items.id of the row this post produced, once it is in the feed. */
    newsItemId: text("news_item_id"),
  },
  (table) => [
    index("idx_x_posts_author_created").on(
      table.authorUsername,
      table.createdAtMs.desc(),
    ),
    index("idx_x_posts_created").on(table.createdAtMs.desc()),
  ],
);

export type XPostRow = typeof xPosts.$inferSelect;
export type InsertXPost = typeof xPosts.$inferInsert;
