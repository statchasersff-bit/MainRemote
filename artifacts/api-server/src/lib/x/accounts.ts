/**
 * The monitored-account list: seeding it, reading it, and claiming from it.
 *
 * The list of reporters lives in the database, not in this file. What lives
 * here is the SEED — the set of handles a brand-new database starts with — and
 * it is applied with onConflictDoNothing, so it is only ever additive. A row
 * the operator disabled stays disabled, a priority they changed stays changed,
 * and a reporter they removed does not come back on the next restart.
 *
 * Adding a reporter after that is a row, not a deploy: POST /api/x/accounts, or
 * the admin page at /admin/x.
 */

import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, xMonitoredAccounts, type XMonitoredAccountRow } from "@workspace/db";
import { logger } from "../logger";
import { backoffCapMs, jitterFraction, pollIntervalMs } from "./config";
import { normalizeHandle } from "./types";

// Re-exported so "the handle rule" has one import site for callers that already
// talk to this module. It lives in ./types because the pure half of the feature
// needs it too — see normalizeHandle there.
export { normalizeHandle };

/** Handles to start from. Display names are left for the provider to fill in. */
const NATIONAL = [
  "adamschefter",
  "rapsheet",
  "tompelissero",
  "mikegarafolo",
  "albertbreer",
];

const BEAT = [
  "ryanmcfadden",
  "seifertespn",
  "colton_pouncy",
  "hayscarlyon",
  "nflstroud",
  "toddarcher",
  "marcraimondi",
  "nwagoner",
  "kguregian",
  "bengoessling",
  "adamjahns",
  "danwiederer",
  "ezlazar",
  "richcimini",
  "kat_terrell",
  "christomasson",
  "miketriplett",
  "mattparrino",
  "ben_baby",
  "alexzietlow05",
  "mike_e_kaye",
  "scottsbucs",
  "jeffzrebiec",
  "nickijhabvala",
  "bydanielflick",
  "jordanraanan",
  "gregauman",
  "krisrhim1",
  "akronjackson",
  "jayskurski",
  "e_woodyard",
  "ryandunleavy",
];

export interface SeedAccount {
  username: string;
  priority: string;
  category: string | null;
}

/**
 * The seed list, in the order it is inserted.
 *
 * `category` says what kind of reporter this is, not what a post is about —
 * the news category is derived per post (lib/news-category.ts). Only the
 * national insiders are labelled, because that is the one claim about these
 * accounts that can be made without guessing someone's beat.
 */
export const SEED_ACCOUNTS: SeedAccount[] = [
  ...NATIONAL.map((username) => ({
    username,
    priority: "high",
    category: "national" as string | null,
  })),
  ...BEAT.map((username) => ({
    username,
    priority: "normal",
    category: null as string | null,
  })),
];

/**
 * Insert any seed account that is not already there. Never updates.
 *
 * Runs at startup, and never throws into it: a database that is briefly
 * unreachable must not stop the news tool from serving, and the next restart
 * (or a manual POST) will seed it.
 */
export async function seedAccounts(): Promise<number> {
  const rows = SEED_ACCOUNTS.map((account) => ({
    username: normalizeHandle(account.username),
    priority: account.priority,
    category: account.category,
  }));

  const written = await db
    .insert(xMonitoredAccounts)
    .values(rows)
    .onConflictDoNothing({ target: xMonitoredAccounts.username })
    .returning({ id: xMonitoredAccounts.id });

  if (written.length > 0) {
    logger.info({ added: written.length }, "[X INGEST] seeded monitored accounts");
  }
  return written.length;
}

/** How many accounts the poller is currently responsible for. */
export async function enabledAccountCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(xMonitoredAccounts)
    .where(eq(xMonitoredAccounts.enabled, true));
  return Number(row?.n ?? 0);
}

/** Every account, enabled first then alphabetical — the admin list's order. */
export async function listAccounts(): Promise<XMonitoredAccountRow[]> {
  return db
    .select()
    .from(xMonitoredAccounts)
    .orderBy(desc(xMonitoredAccounts.enabled), asc(xMonitoredAccounts.username));
}

export async function getAccount(
  username: string,
): Promise<XMonitoredAccountRow | null> {
  const [row] = await db
    .select()
    .from(xMonitoredAccounts)
    .where(eq(xMonitoredAccounts.username, normalizeHandle(username)))
    .limit(1);
  return row ?? null;
}

/**
 * How long this account's next check should wait, including its backoff.
 *
 * Pure, so the schedule can be reasoned about and tested without a clock or a
 * database — the same treatment shouldRefresh() and evaluateIngestHealth() get
 * in routes/news.ts, and for the same reason: this is the arithmetic that
 * decides how much traffic we send someone else.
 */
export function dueAfterMs(args: {
  priority: string | null | undefined;
  consecutiveFailures: number;
}): number {
  const base = pollIntervalMs(args.priority);
  const failures = Math.max(0, args.consecutiveFailures);
  if (failures === 0) return base;
  // 2^failures, but computed with a shift guard so a long-dead account cannot
  // overflow into Infinity on its way to being capped anyway.
  const factor = Math.min(2 ** Math.min(failures, 16), Number.MAX_SAFE_INTEGER);
  return Math.min(base * factor, backoffCapMs());
}

/**
 * Take ownership of up to `limit` accounts that are due for a check.
 *
 * The claim is the write. Each account is moved to `last_checked_at = now()`
 * by an UPDATE whose WHERE clause still contains the due test, so if two
 * processes — two instances, or a restart overlapping the tick it interrupted —
 * try to claim the same account, exactly one UPDATE matches a row and the other
 * matches nothing. There is no lock to leak and no in-memory set to lose on a
 * restart, which is what makes "the same post processed by two jobs" impossible
 * rather than unlikely.
 *
 * Stamping the time BEFORE the fetch is deliberate, and matches the wire's
 * refresh throttle: an account that fails costs one request per interval rather
 * than one per tick.
 */
export async function claimDueAccounts(
  limit: number,
  nowMs: number = Date.now(),
): Promise<XMonitoredAccountRow[]> {
  const jitter = jitterFraction();
  const claimed: XMonitoredAccountRow[] = [];

  // Candidates first, then a conditional UPDATE each. Two round trips per
  // account rather than one CTE, because the due window depends on the row's
  // own priority and failure count — arithmetic that belongs in dueAfterMs()
  // where it can be tested, not spelled twice in SQL.
  const candidates = await db
    .select()
    .from(xMonitoredAccounts)
    .where(eq(xMonitoredAccounts.enabled, true))
    .orderBy(sql`${xMonitoredAccounts.lastCheckedAt} asc nulls first`)
    // A little wider than `limit` so an account whose interval has not elapsed
    // does not block the ones behind it in the ordering.
    .limit(Math.max(limit * 4, 8));

  for (const account of candidates) {
    if (claimed.length >= limit) break;

    const interval = dueAfterMs({
      priority: account.priority,
      consecutiveFailures: account.consecutiveFailures,
    });
    // Jitter shortens the wait by up to `jitter` of it, so accounts drift out
    // of lockstep rather than re-forming a burst after every restart.
    const wait = interval * (1 - Math.random() * jitter);
    const cutoff = new Date(nowMs - wait);

    const [row] = await db
      .update(xMonitoredAccounts)
      .set({ lastCheckedAt: new Date(nowMs) })
      .where(
        and(
          eq(xMonitoredAccounts.id, account.id),
          eq(xMonitoredAccounts.enabled, true),
          or(
            isNull(xMonitoredAccounts.lastCheckedAt),
            lte(xMonitoredAccounts.lastCheckedAt, cutoff),
          ),
        ),
      )
      .returning();

    // No row means someone else claimed it, or it simply is not due yet.
    if (row) claimed.push(row);
  }

  return claimed;
}

/** Record a successful check: clear the failure state, move the watermark. */
export async function recordSuccess(args: {
  id: number;
  lastSeenPostId: string | null;
  displayName?: string | null;
}): Promise<void> {
  await db
    .update(xMonitoredAccounts)
    .set({
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      updatedAt: new Date(),
      ...(args.lastSeenPostId ? { lastSeenPostId: args.lastSeenPostId } : {}),
      // Learned from the source rather than seeded, so the admin list fills in
      // real names on its own and never shows one we invented.
      ...(args.displayName ? { displayName: args.displayName } : {}),
    })
    .where(eq(xMonitoredAccounts.id, args.id));
}

/** Record a failed check. The count drives the backoff in dueAfterMs(). */
export async function recordFailure(id: number, error: string): Promise<void> {
  await db
    .update(xMonitoredAccounts)
    .set({
      consecutiveFailures: sql`${xMonitoredAccounts.consecutiveFailures} + 1`,
      lastError: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(xMonitoredAccounts.id, id));
}
