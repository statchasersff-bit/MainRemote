/**
 * Official X API v2 provider.
 *
 * The paid route, implemented now rather than later so that switching to it is
 * a configuration change on a running deployment:
 *
 *     X_PROVIDER=official
 *     X_API_BEARER_TOKEN=...
 *
 * and nothing else in the application moves. That is the test of whether the
 * adapter boundary in types.ts is real, and it is why this file exists before
 * anyone has paid for a token: an interface with one implementation is a
 * guess.
 *
 * Two calls per account, and only the first one repeats: the handle is resolved
 * to a numeric user id once and cached for the life of the process, because
 * /2/users/by/username is rate-limited far more tightly than the timeline read
 * and the mapping never changes.
 */

import {
  postUrl,
  type FetchOptions,
  type XPost,
  type XPostProvider,
} from "./types";

const API_BASE = process.env["X_API_BASE_URL"] ?? "https://api.x.com/2";

const TIMEOUT_MS = (() => {
  const raw = Number(process.env["X_FETCH_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

interface ApiTweet {
  id?: string;
  text?: string;
  created_at?: string;
  lang?: string;
  author_id?: string;
  referenced_tweets?: Array<{ type?: string; id?: string }>;
  attachments?: { media_keys?: string[] };
}

interface ApiUser {
  id?: string;
  username?: string;
  name?: string;
}

interface ApiMedia {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
}

interface TimelineResponse {
  data?: ApiTweet[];
  includes?: { media?: ApiMedia[]; users?: ApiUser[]; tweets?: ApiTweet[] };
  errors?: Array<{ detail?: string; title?: string }>;
}

export class OfficialXApiProvider implements XPostProvider {
  readonly name = "official";

  private readonly token: string;
  /** handle (lowercase) -> numeric user id. Resolved once per process. */
  private readonly userIds = new Map<string, string>();

  constructor(token: string) {
    this.token = token;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 429 carries the reset time, which is the one piece of a rate-limit
      // failure worth having in the log - everything else is guesswork.
      const reset = response.headers.get("x-rate-limit-reset");
      throw new Error(
        `${response.status} ${response.statusText}` +
          (response.status === 429 && reset ? ` (resets at ${reset})` : ""),
      );
    }

    return (await response.json()) as T;
  }

  private async userId(username: string): Promise<string> {
    const handle = username.replace(/^@/, "").toLowerCase();
    const cached = this.userIds.get(handle);
    if (cached) return cached;

    const body = await this.call<{ data?: ApiUser }>(
      `/users/by/username/${encodeURIComponent(handle)}`,
      {},
    );
    const id = body.data?.id;
    if (!id) throw new Error(`no such user: @${handle}`);

    this.userIds.set(handle, id);
    return id;
  }

  async fetchLatestPosts(
    username: string,
    options: FetchOptions = {},
  ): Promise<XPost[]> {
    const id = await this.userId(username);

    const body = await this.call<TimelineResponse>(`/users/${id}/tweets`, {
      max_results: String(Math.min(Math.max(options.limit ?? 25, 5), 100)),
      ...(options.sinceId ? { since_id: options.sinceId } : {}),
      "tweet.fields": "created_at,lang,referenced_tweets,attachments",
      expansions: "attachments.media_keys,author_id,referenced_tweets.id",
      "media.fields": "url,preview_image_url,type",
      "user.fields": "name,username",
    });

    if (body.errors?.length && !body.data?.length) {
      const first = body.errors[0];
      throw new Error(first?.detail ?? first?.title ?? "X API returned errors");
    }

    const mediaByKey = new Map(
      (body.includes?.media ?? []).map((m) => [m.media_key ?? "", m]),
    );
    const tweetsById = new Map(
      (body.includes?.tweets ?? []).map((t) => [t.id ?? "", t]),
    );
    const author =
      (body.includes?.users ?? []).find(
        (u) => u.username?.toLowerCase() === username.replace(/^@/, "").toLowerCase(),
      ) ?? null;

    const posts: XPost[] = [];

    for (const tweet of body.data ?? []) {
      const externalId = (tweet.id ?? "").trim();
      if (!externalId) continue;

      const refs = tweet.referenced_tweets ?? [];
      const repost = refs.find((r) => r.type === "retweeted");
      const quote = refs.find((r) => r.type === "quoted");
      const reply = refs.find((r) => r.type === "replied_to");

      const handle = author?.username ?? username.replace(/^@/, "");
      const createdAt = tweet.created_at ? Date.parse(tweet.created_at) : NaN;

      const media: string[] = [];
      for (const key of tweet.attachments?.media_keys ?? []) {
        const item = mediaByKey.get(key);
        const url = item?.url ?? item?.preview_image_url;
        if (url) media.push(url);
      }

      const post: XPost = {
        externalId,
        authorUsername: handle,
        authorName: author?.name ?? null,
        text: (tweet.text ?? "").trim(),
        createdAtMs: Number.isNaN(createdAt) ? null : createdAt,
        url: postUrl(handle, externalId),
        media,
        isReply: Boolean(reply),
        isRepost: Boolean(repost),
        isQuote: Boolean(quote),
        lang: tweet.lang ?? null,
      };

      if (quote?.id) {
        const quoted = tweetsById.get(quote.id);
        post.quoted = {
          postId: quote.id,
          authorUsername: null,
          text: quoted?.text?.trim() ?? null,
        };
      }

      posts.push(post);
    }

    posts.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    return posts;
  }
}
