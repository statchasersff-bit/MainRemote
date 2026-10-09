/**
 * Real-time delivery: a filter rule at the provider, a webhook here.
 *
 * The polling queue asks 37 questions every five minutes and is told "nothing
 * new" almost every time. A filter rule inverts that: the provider watches the
 * accounts and POSTs only when one of them actually posts. Fewer moving parts
 * on our side, lower latency, and - with a provider that bills per matched
 * tweet rather than per request - an order of magnitude cheaper, because we
 * stop paying for the silence.
 *
 * Nothing downstream changes. A webhook delivery goes through the same
 * `ingestPosts()` a polled post does, which is the same one a pushed post does.
 * This file is only the two pieces that are specific to rule-based delivery:
 * turning a watchlist into filter expressions, and reading what arrives.
 */

import { normalizeApiTweet } from "./rest-provider";
import type { XPost } from "./types";

/**
 * The provider's cap on one rule's filter expression.
 *
 * 255 characters, which is the whole reason this file has a chunker in it: the
 * 37 seeded reporters come to roughly 740 characters as `from:` terms, so the
 * watchlist does not fit in one rule and never will. Splitting is not an
 * optimization, it is the only way to express the question.
 */
export const MAX_RULE_LENGTH = 255;

export interface BuildRulesOptions {
  /** Provider's limit. Overridable because it is theirs to change, not ours. */
  maxLength?: number;
  /**
   * Appended to every rule - e.g. "-filter:retweets".
   *
   * Worth using when no monitored account wants reposts: a tweet excluded at
   * the provider is a tweet that is never matched, never delivered and never
   * billed, whereas one excluded by shouldKeep() has already been paid for.
   * It is not applied automatically, because the rules are global and the
   * repost toggle is per account - inferring one from the other would silently
   * override an account someone deliberately switched reposts on for.
   */
  suffix?: string;
}

/**
 * A watchlist as filter expressions, each within the provider's length cap.
 *
 * Greedy rather than balanced: filling each rule before starting the next
 * produces the fewest rules, and rule count is what the operator has to
 * register, pay attention to, and eventually clean up by hand.
 *
 * A handle too long to fit in an empty rule is dropped rather than silently
 * truncated into a `from:` term for somebody else - at 255 characters that
 * cannot happen with a real handle (X caps them at 15), but a truncated rule
 * would be the kind of failure that looks like a quiet account.
 */
export function buildFilterRules(
  usernames: string[],
  options: BuildRulesOptions = {},
): string[] {
  const maxLength = options.maxLength ?? MAX_RULE_LENGTH;
  const suffix = options.suffix?.trim() ?? "";
  // The suffix is joined with a space and has to fit alongside the terms.
  const budget = maxLength - (suffix ? suffix.length + 1 : 0);

  const rules: string[] = [];
  let current = "";

  for (const raw of usernames) {
    const username = raw.trim().replace(/^@+/, "").toLowerCase();
    if (!username) continue;

    const term = `from:${username}`;
    if (term.length > budget) continue;

    const candidate = current ? `${current} OR ${term}` : term;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      rules.push(current);
      current = term;
    }
  }

  if (current) rules.push(current);

  return suffix ? rules.map((rule) => `${rule} ${suffix}`) : rules;
}

/** What a rule is called at the provider, so a delivery can be traced back. */
export function ruleTag(index: number, total: number): string {
  return `statchasers-nfl-${index + 1}-of-${total}`;
}

export interface WebhookDelivery {
  /** "tweet" for a delivery carrying posts; anything else is informational. */
  eventType: string;
  ruleId: string | null;
  ruleTag: string | null;
  posts: XPost[];
  /** Entries that arrived but could not be read, with why. */
  rejected: string[];
}

/**
 * Read a delivery.
 *
 * Tolerant in the same way the API provider is, and for the same reason: the
 * documented payload is `{event_type, rule_id, rule_tag, tweets: [...]}`, but
 * the objects inside `tweets` are the provider's own tweet shape, which is
 * theirs to extend. Reading them through normalizeApiTweet means a delivery
 * and a polled response are understood by exactly one piece of code.
 *
 * Never throws: a delivery this cannot read is still a delivery that must be
 * acknowledged, or the provider will retry a payload that will never work.
 */
export function readDelivery(body: unknown): WebhookDelivery {
  const envelope = (body ?? {}) as Record<string, unknown>;

  const eventType =
    typeof envelope["event_type"] === "string"
      ? envelope["event_type"]
      : typeof envelope["eventType"] === "string"
        ? (envelope["eventType"] as string)
        : "tweet";

  const rawTweets = Array.isArray(envelope["tweets"])
    ? (envelope["tweets"] as unknown[])
    : Array.isArray(envelope["data"])
      ? (envelope["data"] as unknown[])
      : [];

  const posts: XPost[] = [];
  const rejected: string[] = [];

  for (const item of rawTweets) {
    if (!item || typeof item !== "object") {
      rejected.push("not an object");
      continue;
    }
    const post = normalizeApiTweet(item as Record<string, unknown>, "");
    if (!post) {
      rejected.push("no usable post id");
      continue;
    }
    if (!post.authorUsername.trim()) {
      rejected.push(`${post.externalId}: no author handle`);
      continue;
    }
    posts.push(post);
  }

  return {
    eventType,
    ruleId:
      typeof envelope["rule_id"] === "string" ? envelope["rule_id"] : null,
    ruleTag:
      typeof envelope["rule_tag"] === "string" ? envelope["rule_tag"] : null,
    posts,
    rejected,
  };
}

/**
 * The secret a delivery has to present.
 *
 * The provider sends the account's own API key in `X-API-Key`, so by default
 * that is what is checked. X_WEBHOOK_SECRET overrides it for a provider that
 * lets you choose the value, which is the better arrangement: it means the key
 * that can spend money is not also the one sitting in an inbound header.
 */
export function expectedWebhookSecret(): string | null {
  return (
    process.env["X_WEBHOOK_SECRET"]?.trim() ||
    process.env["X_API_KEY"]?.trim() ||
    null
  );
}
