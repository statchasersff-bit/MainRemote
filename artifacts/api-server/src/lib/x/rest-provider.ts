/**
 * A provider for any JSON API that serves X posts.
 *
 * This is the route to CURRENT posts at a price that is not the official API's.
 * The public embed timeline (public-provider.ts) is free and turned out not to
 * be usable at this volume — measured from this deployment, twelve requests
 * spaced nine seconds apart were all refused with 429, and the slice it serves
 * is a cached one that can be months behind. The official API (official-provider.ts)
 * is current and authoritative and, on the pay-per-use pricing that replaced the
 * $200 Basic tier, costs roughly $0.005 per post read.
 *
 * Between those sits a tier of commercial APIs that resell X data for cents per
 * thousand posts. They differ in host and in the exact shape of their JSON, and
 * they all converge on the same handful of field names — because they are all
 * mirroring X's own tweet object. So rather than a class per vendor, this is one
 * adapter driven by configuration:
 *
 *     X_PROVIDER=api
 *     X_API_URL=https://<vendor>/...?userName={username}&sinceId={sinceId}
 *     X_API_KEY=...            # sent as X-API-Key unless X_API_KEY_HEADER says otherwise
 *
 * and a normaliser below that accepts the aliases those vendors actually use.
 * Nothing about the rest of the news tool changes, which is the whole point of
 * the XPostProvider boundary.
 *
 * It does no scraping of its own: it is an HTTP client for an API the operator
 * has an account with. Whatever that vendor's terms are is a contract between
 * the operator and the vendor, and is worth reading before relying on one.
 */

import { logger } from "../logger";
import {
  postUrl,
  type FetchOptions,
  type XPost,
  type XPostProvider,
} from "./types";

const TIMEOUT_MS = (() => {
  const raw = Number(process.env["X_FETCH_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

/** A JSON object, as far as this file is concerned. */
type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The first value present under any of these keys, walking dotted paths.
 *
 * The alias list IS the vendor compatibility layer: `id_str` (X's own),
 * `id` (most mirrors), `tweet_id`, `rest_id` (X's GraphQL shape). Rather than
 * ask an operator to describe their vendor's schema in six environment
 * variables, the reader tries the names that exist in the wild.
 */
function pick(source: Json, keys: string[]): unknown {
  for (const key of keys) {
    let value: unknown = source;
    for (const part of key.split(".")) {
      if (!isObject(value)) {
        value = undefined;
        break;
      }
      value = value[part];
    }
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/**
 * A timestamp from whatever the vendor calls it, in whatever unit it uses.
 *
 * Seconds and milliseconds are told apart by magnitude: an epoch in seconds for
 * any plausible post is ten digits, in milliseconds thirteen. Anything else is
 * handed to Date.parse, which covers both ISO 8601 and X's own
 * "Wed Sep 16 18:30:00 +0000 2026".
 */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  const text = str(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseTimestamp(Number(text));
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Does this look like a post rather than some other object in the response? */
function looksLikeTweet(value: unknown): boolean {
  if (!isObject(value)) return false;
  const hasId = pick(value, ["id_str", "id", "tweet_id", "rest_id"]) !== undefined;
  const hasText =
    pick(value, ["full_text", "text", "content", "legacy.full_text"]) !== undefined;
  return hasId && hasText;
}

/**
 * Find the array of posts in a response, wherever the vendor put it.
 *
 * Every one of these APIs wraps its results differently — `{data: [...]}`,
 * `{tweets: [...]}`, `{data: {tweets: [...]}}`, `{results: [...]}`, or a bare
 * array. Configuring the path per vendor would be one more thing to get wrong
 * in an environment variable, so the array is found by looking for one whose
 * contents look like posts.
 *
 * Exported for the tests: this is the part most likely to meet a shape nobody
 * anticipated, and it should fail as "no posts found" rather than as a crash.
 */
export function findPosts(body: unknown, depth = 0): Json[] {
  if (Array.isArray(body)) {
    return body.filter(looksLikeTweet) as Json[];
  }
  if (!isObject(body) || depth > 3) return [];

  // Named containers first, so a response carrying both posts and, say, a
  // `includes.tweets` block of quoted originals picks the timeline itself.
  for (const key of ["data", "tweets", "results", "items", "statuses", "timeline"]) {
    const value = body[key];
    if (value !== undefined) {
      const found = findPosts(value, depth + 1);
      if (found.length > 0) return found;
    }
  }

  for (const value of Object.values(body)) {
    if (Array.isArray(value) || isObject(value)) {
      const found = findPosts(value, depth + 1);
      if (found.length > 0) return found;
    }
  }

  return [];
}

function mediaFrom(raw: Json): string[] {
  const urls: string[] = [];

  const candidates: unknown[] = [
    pick(raw, ["extendedEntities.media", "extended_entities.media", "entities.media"]),
    pick(raw, ["media", "mediaUrls", "media_urls", "photos"]),
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      // Some vendors give objects, some give bare URL strings.
      const url =
        typeof item === "string"
          ? item
          : isObject(item)
            ? str(
                pick(item, [
                  "media_url_https",
                  "mediaUrlHttps",
                  "url",
                  "preview_image_url",
                  "previewImageUrl",
                ]),
              )
            : null;
      if (url && /^https:\/\//.test(url)) urls.push(url);
    }
  }

  return [...new Set(urls)];
}

/**
 * One vendor's post object to the shape the news tool uses.
 *
 * Exported and tested against three different vendor shapes, because this
 * function is the entire compatibility promise — "switching providers is a
 * config change" is only true if it holds.
 */
export function normalizeApiTweet(
  raw: Json,
  fallbackUsername: string,
): XPost | null {
  const externalId = str(pick(raw, ["id_str", "id", "tweet_id", "rest_id"]));
  if (!externalId) return null;

  const repostOf = pick(raw, [
    "retweeted_status",
    "retweeted_tweet",
    "retweetedStatus",
    "retweeted_status_result",
  ]);
  const quoteOf = pick(raw, [
    "quoted_status",
    "quoted_tweet",
    "quotedStatus",
    "quoted_status_result",
  ]);

  // X API v2 reports both as entries in referenced_tweets instead.
  const referenced = pick(raw, ["referenced_tweets", "referencedTweets"]);
  const refs = Array.isArray(referenced) ? (referenced as Json[]) : [];
  const refType = (type: string): Json | undefined =>
    refs.find((ref) => str(pick(ref, ["type"])) === type);

  const text =
    str(pick(raw, ["full_text", "text", "content", "legacy.full_text"])) ?? "";

  const username =
    str(
      pick(raw, [
        "author.userName",
        "author.username",
        "author.screen_name",
        "author.screenName",
        "user.screen_name",
        "user.username",
        "user.userName",
        "username",
        "screen_name",
        "screenName",
      ]),
    ) ?? fallbackUsername.replace(/^@/, "");

  const authorName = str(pick(raw, ["author.name", "user.name", "name"]));

  const createdAtMs = parseTimestamp(
    pick(raw, [
      "created_at",
      "createdAt",
      "created_at_ms",
      "timestamp",
      "date",
      "time",
      "legacy.created_at",
    ]),
  );

  const isRepost =
    repostOf !== undefined ||
    refType("retweeted") !== undefined ||
    bool(pick(raw, ["isRetweet", "is_retweet", "retweeted"])) ||
    // The last resort, and a real one: several mirrors flatten a repost into
    // plain text and say so nowhere else.
    /^RT @\w+:/.test(text);

  const isQuote =
    quoteOf !== undefined ||
    refType("quoted") !== undefined ||
    bool(pick(raw, ["isQuote", "is_quote", "is_quote_status", "isQuoteStatus"]));

  const isReply =
    refType("replied_to") !== undefined ||
    bool(pick(raw, ["isReply", "is_reply"])) ||
    pick(raw, [
      "in_reply_to_status_id_str",
      "in_reply_to_status_id",
      "inReplyToId",
      "in_reply_to_screen_name",
      "inReplyToUsername",
      "conversationId",
    ]) !== undefined &&
      // conversation_id equal to the post's own id means it STARTED the thread.
      str(pick(raw, ["conversationId", "conversation_id_str", "conversation_id"])) !==
        externalId;

  const post: XPost = {
    externalId,
    authorUsername: username,
    authorName,
    text,
    createdAtMs,
    url:
      str(pick(raw, ["url", "twitterUrl", "tweetUrl", "permalink"])) ??
      postUrl(username, externalId),
    media: mediaFrom(raw),
    isReply,
    isRepost,
    isQuote,
    lang: str(pick(raw, ["lang", "language"])),
  };

  const quoted = isObject(quoteOf) ? quoteOf : refType("quoted");
  if (post.isQuote && quoted) {
    post.quoted = {
      postId: str(pick(quoted, ["id_str", "id", "tweet_id"])),
      authorUsername: str(
        pick(quoted, ["author.userName", "author.screen_name", "user.screen_name"]),
      ),
      text: str(pick(quoted, ["full_text", "text"])),
    };
  }

  return post;
}

/**
 * Fill {username}, {sinceId} and {limit} into the configured URL.
 *
 * A query parameter whose placeholder resolved to nothing is DROPPED rather
 * than sent empty: `&sinceId=` is not the same request as no `sinceId` at all,
 * and some vendors treat the empty one as an error rather than as "no
 * watermark".
 */
export function buildUrl(
  template: string,
  values: { username: string; sinceId?: string | null; limit?: number },
): string {
  const filled = template
    .replace(/\{username\}/g, encodeURIComponent(values.username.replace(/^@/, "")))
    .replace(/\{sinceId\}/g, values.sinceId ? encodeURIComponent(values.sinceId) : "")
    .replace(/\{limit\}/g, values.limit ? String(values.limit) : "");

  const [base, query] = filled.split("?");
  if (!query) return filled;

  const kept = query
    .split("&")
    .filter((pair) => {
      const [, value] = pair.split("=");
      return value === undefined || value !== "";
    })
    .join("&");

  return kept ? `${base}?${kept}` : (base ?? filled);
}

export class RestXProvider implements XPostProvider {
  readonly name = "api";

  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  /**
   * Build from the environment, or null when it is not configured.
   *
   * Null rather than a throw, for the reason the factory gives: a
   * misconfigured optional subsystem should be idle and say so, not take a
   * startup down with it.
   */
  static fromEnv(): RestXProvider | null {
    const url = process.env["X_API_URL"]?.trim();
    if (!url) {
      logger.error(
        "[X INGEST] X_PROVIDER=api but X_API_URL is not set — X ingestion is idle",
      );
      return null;
    }
    if (!/\{username\}/.test(url)) {
      logger.error(
        "[X INGEST] X_API_URL must contain the {username} placeholder — X ingestion is idle",
      );
      return null;
    }

    const headers: Record<string, string> = { Accept: "application/json" };

    const bearer = process.env["X_API_BEARER_TOKEN"]?.trim();
    const key = process.env["X_API_KEY"]?.trim();

    if (key) {
      headers[process.env["X_API_KEY_HEADER"]?.trim() || "X-API-Key"] = key;
    } else if (bearer) {
      headers["Authorization"] = `Bearer ${bearer}`;
    } else {
      // Not fatal: a self-hosted or allowlisted endpoint may need no key. Said
      // out loud because "401 from the vendor" is otherwise a puzzle.
      logger.warn(
        "[X INGEST] neither X_API_KEY nor X_API_BEARER_TOKEN is set — calling X_API_URL unauthenticated",
      );
    }

    return new RestXProvider(url, headers);
  }

  async fetchLatestPosts(
    username: string,
    options: FetchOptions = {},
  ): Promise<XPost[]> {
    const url = buildUrl(this.url, {
      username,
      sinceId: options.sinceId ?? null,
      limit: options.limit ?? 25,
    });

    const response = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries the vendor's own explanation — "quota exceeded",
      // "unknown user" — and a status alone cannot tell those apart.
      const detail = await response
        .text()
        .then((body) => body.trim().replace(/\s+/g, " ").slice(0, 200))
        .catch(() => "");
      throw new Error(
        `${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const body = (await response.json()) as unknown;
    const raw = findPosts(body);

    const posts: XPost[] = [];
    for (const item of raw) {
      const post = normalizeApiTweet(item, username);
      if (post) posts.push(post);
    }

    // An empty result is legitimate here, unlike the public provider's: with a
    // sinceId watermark, "nothing new since last time" is the normal answer for
    // most accounts most of the time. A response that parsed to nothing AND
    // carried no watermark is the suspicious case, and is reported.
    if (posts.length === 0 && !options.sinceId && raw.length === 0) {
      throw new Error("responded 200 but carried no recognisable posts");
    }

    posts.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    const limit = options.limit ?? 25;
    if (posts.length > limit) posts.length = limit;

    return posts;
  }
}
