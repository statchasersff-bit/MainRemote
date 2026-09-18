/**
 * Public-timeline provider.
 *
 * Reads the profile timeline X itself publishes for embedded widgets:
 * syndication.twitter.com/srv/timeline-profile/screen-name/<handle>. That
 * document is served unauthenticated to anyone, is what every "latest tweets"
 * embed on the web renders from, and needs no login, no token and no cookie.
 *
 * Nothing here attempts to reach content that is not public. There is no
 * credential, no session, no challenge solving, no rotation and no retry storm:
 * one plain GET per account per poll with an honest User-Agent, and a failure
 * is recorded and backed off from rather than worked around.
 *
 * What it costs in exchange for being free: the endpoint serves a CACHED and
 * partly CURATED slice of a timeline, not a live chronological one. Measured
 * across the monitored list, some accounts come back current to within a day
 * and others return a months-old "greatest hits" set with a pinned post at the
 * top. So this provider is honest but not complete — it is the zero-cost
 * starting point, and lib/x/official-provider.ts is the drop-in for when the
 * feed is worth paying for. Neither the poller nor the feed can tell which one
 * produced a post.
 */

import { logger } from "../logger";
import {
  isNewerId,
  postUrl,
  type FetchOptions,
  type XPost,
  type XPostProvider,
} from "./types";

/**
 * Where to read a profile timeline. `{username}` is substituted.
 *
 * Overridable so the operator can point this at another permitted public
 * source — a self-hosted bridge, a mirror — without a deploy or a code change.
 * The parser below is defensive about shape for the same reason.
 */
const TIMELINE_URL =
  process.env["X_PUBLIC_TIMELINE_URL"] ??
  "https://syndication.twitter.com/srv/timeline-profile/screen-name/{username}";

const TIMEOUT_MS = (() => {
  const raw = Number(process.env["X_FETCH_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

/**
 * Identifies this server, as the wire and club fetches already do.
 *
 * A browser-shaped UA string with the tool named in it: the endpoint serves
 * embed widgets, so it expects a browser, and the contact URL is there so
 * anyone looking at their logs can see exactly who this is and ask us to stop.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; StatChasersNews/1.0; +https://newsfeed.replit.app)";

/** The embedded JSON blob the page carries its timeline in. */
const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

/** Shape of the fields we read. Everything is optional — it is third-party. */
interface RawTweet {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  lang?: string;
  in_reply_to_screen_name?: string | null;
  in_reply_to_status_id_str?: string | null;
  retweeted_status?: RawTweet | null;
  quoted_tweet?: RawTweet | null;
  permalink?: string;
  user?: { screen_name?: string; name?: string } | null;
  entities?: { media?: Array<{ media_url_https?: string }> } | null;
  extended_entities?: { media?: Array<{ media_url_https?: string; type?: string; video_info?: unknown }> } | null;
}

interface TimelineEntry {
  type?: string;
  content?: { tweet?: RawTweet } | null;
}

function timelineUrlFor(username: string): string {
  return TIMELINE_URL.replace(
    /\{username\}/g,
    encodeURIComponent(username.replace(/^@/, "")),
  );
}

/**
 * Pull the timeline entries out of the embed page.
 *
 * Exported for the tests, which run it against a captured fixture: this parser
 * reads a document we do not control and whose shape has changed before, and
 * the only way that failure surfaces as something other than "the feed went
 * quiet" is a test that fails when the shape it expects stops matching.
 */
export function parseTimelineHtml(html: string): RawTweet[] {
  const match = NEXT_DATA_RE.exec(html);
  if (!match?.[1]) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const entries = (
    parsed as {
      props?: { pageProps?: { timeline?: { entries?: TimelineEntry[] } } };
    } | null
  )?.props?.pageProps?.timeline?.entries;

  if (!Array.isArray(entries)) return [];

  const tweets: RawTweet[] = [];
  for (const entry of entries) {
    if (entry?.type && entry.type !== "tweet") continue;
    const tweet = entry?.content?.tweet;
    if (tweet && typeof tweet === "object") tweets.push(tweet);
  }
  return tweets;
}

function mediaUrls(tweet: RawTweet): string[] {
  const list =
    tweet.extended_entities?.media ?? tweet.entities?.media ?? [];
  const urls: string[] = [];
  for (const item of list) {
    const url = item?.media_url_https;
    if (typeof url === "string" && /^https:\/\//.test(url)) urls.push(url);
  }
  // Same photo can appear in both entity blocks.
  return [...new Set(urls)];
}

/**
 * One raw tweet to the normalised shape, or null when it is not usable.
 *
 * A repost is reported as a repost of the ORIGINAL author's text, with the
 * reposting account as the author — the poller decides whether to keep it, and
 * it needs both facts to make that call.
 */
export function normalizeTweet(
  tweet: RawTweet,
  fallbackUsername: string,
): XPost | null {
  const externalId = (tweet.id_str ?? "").trim();
  if (!/^\d+$/.test(externalId)) return null;

  const reposted = tweet.retweeted_status ?? null;
  const quoted = tweet.quoted_tweet ?? null;

  const username =
    tweet.user?.screen_name?.trim() || fallbackUsername.replace(/^@/, "");
  const text = (reposted?.full_text ?? tweet.full_text ?? tweet.text ?? "").trim();

  const createdAt = tweet.created_at ? Date.parse(tweet.created_at) : NaN;

  const post: XPost = {
    externalId,
    authorUsername: username,
    authorName: tweet.user?.name?.trim() || null,
    text,
    createdAtMs: Number.isNaN(createdAt) ? null : createdAt,
    url: postUrl(username, externalId),
    media: mediaUrls(reposted ?? tweet),
    isReply: Boolean(
      tweet.in_reply_to_status_id_str || tweet.in_reply_to_screen_name,
    ),
    isRepost: Boolean(reposted),
    isQuote: Boolean(quoted),
    lang: tweet.lang ?? null,
  };

  if (quoted) {
    post.quoted = {
      postId: quoted.id_str ?? null,
      authorUsername: quoted.user?.screen_name ?? null,
      text: (quoted.full_text ?? quoted.text ?? "").trim() || null,
    };
  }

  return post;
}

export class PublicXProvider implements XPostProvider {
  readonly name = "public";

  async fetchLatestPosts(
    username: string,
    options: FetchOptions = {},
  ): Promise<XPost[]> {
    const url = timelineUrlFor(username);

    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      // A slow profile must not hold the queue: one account, one bounded wait.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const raw = parseTimelineHtml(html);

    // A 200 that parses to nothing is a shape change, not a quiet account.
    // Said out loud so it reads as the provider breaking rather than the
    // reporter having a slow day — the distinction the club sweep learned to
    // make, for the same reason.
    if (raw.length === 0) {
      throw new Error("responded 200 but carried no timeline entries");
    }

    const posts: XPost[] = [];
    for (const tweet of raw) {
      const post = normalizeTweet(tweet, username);
      if (!post) continue;
      // Advisory watermark — the caller filters again, and post-id dedup is
      // what actually prevents a second copy.
      if (options.sinceId && !isNewerId(post.externalId, options.sinceId)) {
        continue;
      }
      posts.push(post);
    }

    // The endpoint does NOT return entries in time order (a pinned post leads,
    // and the rest are ordered by an opaque sort index), so ordering is applied
    // here. Everything downstream — the watermark, the "newest first" feed —
    // assumes newest-first and would otherwise be reading a shuffled list.
    posts.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    const limit = options.limit ?? 25;
    if (posts.length > limit) posts.length = limit;

    logger.debug(
      { username, parsed: raw.length, returned: posts.length },
      "[X INGEST] public timeline parsed",
    );

    return posts;
  }
}
