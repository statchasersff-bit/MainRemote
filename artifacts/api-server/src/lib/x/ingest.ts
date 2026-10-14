/**
 * X posts into the existing news pipeline.
 *
 * The shape of this file is the point of the whole feature: it is a translation
 * step, not a second news system. A post is fetched by a provider, filtered
 * against its account's rules, turned into the same RawNewsItem the Dynasty
 * Command wire and the club feeds produce, and handed to the same storeItems()
 * they are handed to. From that call onwards an X post IS a news item - same
 * table, same dedupe, same freshness invalidation, same render cache, same
 * summary backfill, same team resolution, same feed, same team pages.
 *
 * The X-specific facts that have nowhere to live on a news row - reply and
 * repost flags, the quoted post, the media list, what the matcher decided and
 * from what - are written to x_posts alongside, keyed by the post id, which is
 * also what makes a post impossible to store twice.
 */

import { inArray } from "drizzle-orm";
import { db, xPosts, type XMonitoredAccountRow } from "@workspace/db";
import { logger } from "../logger";
import { dbAccess } from "../db-access";
import { ensureTeams } from "../teams";
import { storeItems } from "../../routes/news";
import {
  claimDueAccounts,
  normalizeHandle,
  recordFailure,
  recordSuccess,
} from "./accounts";
import {
  newsIdForPost,
  shouldKeep,
  toNewsItem,
  X_PROVIDER,
  X_SOURCE_TYPE,
} from "./post-shape";
import {
  fetchLimit,
  maxPostAgeDays,
  pollBatchSize,
  rateLimitCooldownMs,
  requestGapMs,
} from "./config";
import { getXProvider } from "./provider";
import { maxId, type XPost } from "./types";

export { X_PROVIDER, X_SOURCE_TYPE, newsIdForPost } from "./post-shape";

/**
 * When the whole poller is paused for having been rate-limited.
 *
 * Process-local and deliberately so: it is a statement about this instance's
 * outbound budget, which is not something to write to a shared table where a
 * second instance with its own IP would inherit a penalty it never earned.
 */
let cooldownUntilMs = 0;

/** A rate-limit refusal, as a provider reports it. */
function isRateLimited(message: string): boolean {
  return /\b429\b/.test(message) || /rate.?limit/i.test(message);
}

export function xCooldownRemainingMs(nowMs: number = Date.now()): number {
  return Math.max(0, cooldownUntilMs - nowMs);
}

/** For tests, and for an operator who has fixed whatever caused it. */
export function clearXCooldown(): void {
  cooldownUntilMs = 0;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pause between two polls is never a reason to keep the process alive.
    timer.unref?.();
  });

/** What one account's check produced. */
export interface AccountSweep {
  username: string;
  fetched: number;
  kept: number;
  stored: number;
  error: string | null;
}

export interface XSweepResult {
  checked: number;
  stored: number;
  errors: number;
  accounts: AccountSweep[];
  /** Set when the sweep did nothing because polling is paused. */
  cooldownMs?: number;
}

/**
 * Posts we have already stored, out of a candidate batch.
 *
 * One query for the batch rather than one per post, and a second line of
 * defense rather than the only one: the insert below is ON CONFLICT DO NOTHING
 * on the post id, so even two jobs racing on the same account between this
 * SELECT and that INSERT cannot produce a second row.
 */
async function alreadyStored(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  dbAccess("x_ingest", { what: "already_stored", ids: ids.length });
  const rows = await db
    .select({ postId: xPosts.postId })
    .from(xPosts)
    .where(inArray(xPosts.postId, ids));
  return new Set(rows.map((row) => row.postId));
}

/**
 * Check one account and store whatever is new.
 *
 * Never throws. Every failure - transport, parse, database - is recorded
 * against the account and returned, because one unreachable profile is a fact
 * about that profile and must not stop the other thirty-six, let alone reach
 * the news tool.
 */
export async function sweepAccount(
  account: XMonitoredAccountRow,
): Promise<AccountSweep> {
  const username = account.username;
  const result: AccountSweep = {
    username,
    fetched: 0,
    kept: 0,
    stored: 0,
    error: null,
  };

  const provider = getXProvider();
  if (!provider) {
    result.error = "no provider configured";
    return result;
  }

  logger.debug({ username }, `[X INGEST] Checking @${username}`);

  let posts: XPost[];
  try {
    posts = await provider.fetchLatestPosts(username, {
      sinceId: account.lastSeenPostId,
      limit: fetchLimit(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;

    if (isRateLimited(message)) {
      // Pauses every account, not just this one - see cooldownUntilMs.
      cooldownUntilMs = Date.now() + rateLimitCooldownMs();
      logger.warn(
        { cooldownMs: rateLimitCooldownMs() },
        "[X INGEST] rate limited - pausing all polling",
      );
    }

    // Recorded, not thrown. The failure count is what backs this account off,
    // and it is the reason a renamed or deleted profile costs one request an
    // hour instead of one every five minutes forever.
    await recordFailure(account.id, message).catch((dbErr: unknown) => {
      logger.error({ err: dbErr, username }, "[X INGEST] could not record failure");
    });
    logger.warn(`[X INGEST] @${username} failed: ${message}`);
    return result;
  }

  result.fetched = posts.length;

  // The watermark moves past everything the provider returned, including the
  // posts the account's rules discard: they have been considered, and
  // re-considering them every five minutes forever is work with a known answer.
  // Turning replies on for an account therefore applies to its future replies,
  // not its past ones - the honest trade for not re-reading the same timeline.
  const watermark = posts.reduce<string | null>(
    (newest, post) => maxId(newest, post.externalId),
    account.lastSeenPostId,
  );

  const displayName = posts.find((p) => p.authorName)?.authorName ?? null;

  const stored = await ingestPosts(posts, () => account);
  result.kept = stored.kept;
  result.stored = stored.stored;

  await recordSuccess({
    id: account.id,
    lastSeenPostId: watermark,
    displayName,
  });

  if (stored.stored > 0) {
    logger.info(
      { username, found: stored.stored },
      `[X INGEST] ${stored.stored} new post${stored.stored === 1 ? "" : "s"} found for @${username}`,
    );
  }

  return result;
}

/** Which kinds of post to keep - an account's four toggles, or the defaults. */
export type IngestRules = Pick<
  XMonitoredAccountRow,
  "includeOriginals" | "includeReplies" | "includeReposts" | "includeQuotes"
>;

/**
 * What an account that is not in the monitored table gets.
 *
 * Only reachable through the push route below, for a post whose author nobody
 * has configured. The same defaults a new account row is created with, so a
 * reporter behaves identically whether or not someone got round to adding them.
 */
export const DEFAULT_RULES: IngestRules = {
  includeOriginals: true,
  includeReplies: false,
  includeReposts: false,
  includeQuotes: true,
};

export interface StorePostsResult {
  considered: number;
  kept: number;
  stored: number;
}

/**
 * Store a batch of posts. Never fetches anything.
 *
 * The half of the pipeline below the provider: filter by the author's rules and
 * the age cutoff, drop what is already stored, normalize, and write. Both entry
 * points go through here - the poller, and the push route - so a pushed post
 * and a polled post are treated identically in every respect that matters.
 * There is no second path into the archive for X, in the same way the wire's
 * pull and push modes share storeItems().
 *
 * @param resolveRules The author's toggles. A function rather than a value
 *   because a pushed batch can carry several reporters, each with their own.
 */
export async function ingestPosts(
  posts: XPost[],
  resolveRules: (username: string) => IngestRules,
  options: { maxAgeDays?: number } = {},
): Promise<StorePostsResult> {
  const result: StorePostsResult = {
    considered: posts.length,
    kept: 0,
    stored: 0,
  };

  // The roster index is what turns "Christian McCaffrey" in a sentence into a
  // player, a team and a headshot, and a post is tagged ONCE, on the way in -
  // nothing re-reads a stored row. So the index has to be warm HERE, in the
  // function that does the tagging, rather than in the poller: the push route
  // never goes near the poller, and a cold start that accepted a pushed batch
  // would file every post under nobody, permanently.
  //
  // Self-throttling and non-throwing (it swallows its own fetch failure), so
  // this is a no-op on every call but the first after a restart.
  try {
    await ensureTeams();
  } catch (err) {
    // Belt and braces: an untagged post is still worth storing, so a roster
    // that cannot be refreshed must not fail the batch.
    logger.warn({ err }, "[X INGEST] roster refresh failed - posts may be untagged");
  }

  const maxAgeDays = options.maxAgeDays ?? maxPostAgeDays();
  const cutoffMs = Date.now() - maxAgeDays * 86_400_000;

  const candidates = posts.filter((post) => {
    if (!post.text.trim()) return false;
    // A cached timeline reaches years back and the archive never deletes a row
    // - see maxPostAgeDays. A post with no timestamp at all is not old, it is
    // unknown, and is kept.
    if (post.createdAtMs !== null && post.createdAtMs < cutoffMs) return false;
    return shouldKeep(post, resolveRules(normalizeHandle(post.authorUsername)));
  });

  result.kept = candidates.length;
  if (candidates.length === 0) return result;

  const seen = await alreadyStored(candidates.map((p) => p.externalId));
  const fresh = candidates.filter((post) => !seen.has(post.externalId));
  if (fresh.length === 0) return result;

  const prepared = fresh.map((post) => ({ post, ...toNewsItem(post) }));

  // The news half first. If this throws, nothing is written to x_posts either,
  // and the post is simply picked up again on the next sweep - an absent row is
  // recoverable, an x_posts row pointing at a news item that was never created
  // is not, because the post id would then be permanently marked as handled.
  await storeItems(
    prepared.map((entry) => entry.item),
    X_PROVIDER,
    X_SOURCE_TYPE,
  );

  dbAccess("x_ingest", { what: "x_posts", posts: prepared.length });
  const written = await db
    .insert(xPosts)
    .values(
      prepared.map(({ post, player, team, category }) => ({
        postId: post.externalId,
        authorUsername: normalizeHandle(post.authorUsername),
        authorName: post.authorName ?? null,
        text: post.text,
        url: post.url,
        createdAtMs: post.createdAtMs,
        isReply: post.isReply,
        isRepost: post.isRepost,
        isQuote: post.isQuote,
        quotedPostId: post.quoted?.postId ?? null,
        quotedAuthor: post.quoted?.authorUsername ?? null,
        quotedText: post.quoted?.text ?? null,
        media: post.media,
        playerName: player,
        teamAbbr: team,
        category,
        newsItemId: newsIdForPost(post.externalId),
      })),
    )
    // The post id is the primary key, so this is what makes double storage
    // impossible rather than unlikely - two jobs, two instances, or a restart
    // mid-sweep all converge on one row.
    .onConflictDoNothing({ target: xPosts.postId })
    .returning({ postId: xPosts.postId });

  result.stored = written.length;

  for (const row of written) {
    logger.info(`[X INGEST] Saved post ${row.postId}`);
  }

  return result;
}

/**
 * One tick of the poller: claim what is due, check it, and report.
 *
 * Never throws. The scheduler calls this on a timer and the admin route calls
 * it on demand, and neither has anything useful to do with an exception - a
 * failure here is a fact about X, not about the news tool.
 */
export async function runXSweep(limit?: number): Promise<XSweepResult> {
  const result: XSweepResult = { checked: 0, stored: 0, errors: 0, accounts: [] };

  // Checked before claiming, so a paused poller does not burn every account's
  // due time on a tick it was never going to spend.
  const cooldown = xCooldownRemainingMs();
  if (cooldown > 0) {
    result.cooldownMs = cooldown;
    return result;
  }

  let due: XMonitoredAccountRow[];
  try {
    due = await claimDueAccounts(limit ?? pollBatchSize());
  } catch (err) {
    logger.error({ err }, "[X INGEST] could not claim accounts");
    result.errors++;
    return result;
  }

  // Sequential, deliberately. The batch is small and the stagger is the point:
  // four accounts checked one after another spreads four requests across a few
  // seconds, where Promise.all would put them on the wire together and undo
  // exactly what the tick size was chosen to achieve.
  for (const account of due) {
    // Between accounts, never before the first: a tick that checks one account
    // should not spend two seconds doing nothing first.
    if (result.checked > 0) await sleep(requestGapMs());
    if (xCooldownRemainingMs() > 0) break;

    let sweep: AccountSweep;
    try {
      sweep = await sweepAccount(account);
    } catch (err) {
      // sweepAccount is written not to throw; this is the belt to that braces,
      // so an unforeseen failure on one account cannot end the tick.
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, username: account.username }, "[X INGEST] sweep threw");
      sweep = {
        username: account.username,
        fetched: 0,
        kept: 0,
        stored: 0,
        error: message,
      };
    }

    result.accounts.push(sweep);
    result.checked++;
    result.stored += sweep.stored;
    if (sweep.error) result.errors++;
  }

  return result;
}
