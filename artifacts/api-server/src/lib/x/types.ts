/**
 * The boundary between "where X posts come from" and everything else.
 *
 * Nothing downstream of this file — not the poller, not the normaliser, not the
 * news store, not the feed — knows how a post was obtained. That is the whole
 * point: the first ingestion route is a public, unauthenticated one, and the
 * likely second is the paid official API. Swapping them must be a provider
 * swap and a config change, not a rewrite of the news tool.
 *
 * So a provider's job is deliberately tiny: given a handle and a watermark,
 * return posts in this shape. Everything else — which accounts, how often,
 * which kinds of post to keep, what the text means, how it is stored and
 * rendered — happens on this side of the interface and is written once.
 */

/** One post, normalised. The only shape the rest of the app ever sees. */
export interface XPost {
  /** X's own post id. The deduplication identity, end to end. */
  externalId: string;
  /** Handle without the @. Case as the source gave it. */
  authorUsername: string;
  /** Display name, when the source carries one. */
  authorName?: string | null;
  text: string;
  /** Epoch ms. Null only when the source gave an unparseable time. */
  createdAtMs: number | null;
  /** Canonical permalink on x.com. */
  url: string;
  /** Direct media URLs (photos, video thumbnails). Empty when there are none. */
  media: string[];
  isReply: boolean;
  isRepost: boolean;
  isQuote: boolean;
  /** Present only when isQuote. */
  quoted?: {
    postId?: string | null;
    authorUsername?: string | null;
    text?: string | null;
  };
  /** BCP-47 language tag when the source reports one. */
  lang?: string | null;
}

export interface FetchOptions {
  /**
   * Return only posts newer than this id, when the provider can express that.
   *
   * Advisory. A provider that cannot filter server-side may return more, and
   * the caller filters again — the watermark is an optimisation, and post-id
   * deduplication is what actually guarantees no double storage.
   */
  sinceId?: string | null;
  /** Upper bound on posts to return. Providers may return fewer. */
  limit?: number;
}

/**
 * A source of public X posts.
 *
 * Implementations must only read content that is publicly available, and must
 * fail by throwing a plain Error with a human-readable reason — the poller
 * records it against the account, backs off, and carries on with the others.
 */
export interface XPostProvider {
  /** Short identifier for logs and /api/status, e.g. "public" or "official". */
  readonly name: string;
  /**
   * Newest-first posts for one handle. Throws on a transport or parse failure.
   * An account that genuinely has no new posts returns an empty array.
   */
  fetchLatestPosts(username: string, options?: FetchOptions): Promise<XPost[]>;
}

/**
 * The stored form of a handle: lowercase, no leading @.
 *
 * Here rather than beside the account table, because both halves of the feature
 * need it and only one of them has a database — the admin route normalising
 * what an operator typed, and the post shaper normalising what a provider
 * returned, must agree exactly or the same reporter ends up as two rows.
 */
export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

/** Canonical permalink for a post. */
export function postUrl(username: string, externalId: string): string {
  return `https://x.com/${username}/status/${externalId}`;
}

/**
 * Compare two X ids numerically without assuming they fit in a double.
 *
 * Post ids are 64-bit snowflakes; Number() loses precision above 2^53, which is
 * every id minted since 2015. So "is this newer than the watermark" is a
 * length-then-lexicographic comparison on the digits instead — exact, and it
 * needs no BigInt support from whatever runs it.
 */
export function isNewerId(id: string, thanId: string | null | undefined): boolean {
  const a = (id ?? "").trim();
  const b = (thanId ?? "").trim();
  if (!b) return true;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return true;
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/** The newer of two ids, treating null/empty as "no id yet". */
export function maxId(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return isNewerId(b, a) ? b : a;
}
