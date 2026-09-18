/**
 * A post's shape as a news item: its identity, its headline, and whether it is
 * reporting at all.
 *
 * Split out of lib/x/ingest.ts rather than living beside the sweep, and for the
 * same reason lib/news-item.ts sits apart from the route that stores things:
 * none of this needs a database, a provider or a network, and a test that wants
 * to pin down "is a bare quote post news" should not have to open a connection
 * pool to ask.
 */

import { categorize } from "../news-category";
import type { RawNewsItem } from "../news-item";
import type { XMonitoredAccountRow } from "@workspace/db";
import { detectEntities } from "./entities";
import { headshotUrl } from "../team/roster";
import { normalizeHandle, type XPost } from "./types";

/** The provider label these rows carry when the author has no display name. */
export const X_PROVIDER = "X";

/** The lane, as written to news_items.source_type. */
export const X_SOURCE_TYPE = "x";

/** news_items.id for a post. Prefixed so a row's origin is legible in the table. */
export function newsIdForPost(externalId: string): string {
  return `x-${externalId}`;
}

/**
 * The dedupe fingerprint for a post.
 *
 * The post id and nothing else. Unlike the wire, there is a real external
 * identifier here, and it is stable in a way a title is not: reporters post the
 * same sentence about two different players all the time, and a content
 * fingerprint would silently keep one of those and drop the other.
 */
export function dedupeKeyForPost(externalId: string): string {
  return `x:${externalId}`;
}

/**
 * The card's headline.
 *
 * A post is a paragraph and a card wants a headline, so the first sentence (or
 * the first clause that fits) becomes the title and the rest stays in the
 * summary. Trailing links are dropped from the headline only — a t.co URL is
 * never the interesting part of the first line, and the card links to the post
 * itself anyway.
 */
export function postHeadline(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").replace(/https?:\/\/\S+/g, "").trim();
  if (!cleaned) return "(no text)";

  const firstLine = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;
  const candidate = firstLine.length >= 20 ? firstLine : cleaned;

  if (candidate.length <= 150) return candidate.trim();
  // Cut on a word boundary rather than mid-word, and say that it was cut.
  const cut = candidate.slice(0, 150);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Does this account want this kind of post?
 *
 * Pure, and exported, because it is the rule the whole "reporting, not chatter"
 * default rests on and it should be verifiable without a network or a database.
 *
 * A quote post is treated as an original when it says something of its own: a
 * bare "This." over someone else's post is a retweet with extra steps, while
 * "Confirmed — he's active" over an injury report is the news. The line is
 * drawn at whether the quoting text carries any words of substance.
 */
export function shouldKeep(
  post: XPost,
  account: Pick<
    XMonitoredAccountRow,
    "includeOriginals" | "includeReplies" | "includeReposts" | "includeQuotes"
  >,
): boolean {
  if (post.isRepost) return account.includeReposts;
  if (post.isQuote) {
    if (!account.includeQuotes) return false;
    // Meaningful original text, not just a reaction or a bare link.
    const own = post.text.replace(/https?:\/\/\S+/g, "").trim();
    return own.length >= 15;
  }
  if (post.isReply) return account.includeReplies;
  return account.includeOriginals;
}

/**
 * One post, as the news store wants it.
 *
 * Everything a card needs is filled in here rather than at render time, because
 * this is the point where the post's full text is in hand: the player, the
 * team, the category and the headline all come out of the same string, once.
 */
export function toNewsItem(post: XPost): {
  item: RawNewsItem;
  player: string | null;
  team: string | null;
  category: string;
} {
  const quotedText = post.quoted?.text ?? null;
  const full = post.text.replace(/\s+/g, " ").trim();

  // The quoted post's words are read for entity and category detection — "this
  // is about Hurts" is frequently only true of the post being quoted — but they
  // are not shown as this post's own text.
  const { player, team } = detectEntities(post.text, quotedText);
  const playerName = player?.name ?? null;
  const category = categorize(post.text, quotedText);

  const title = postHeadline(post.text);
  // Only when it adds something: a one-line post is already entirely in the
  // title, and repeating it underneath would be the same sentence twice.
  const summary = full && full !== title ? full : null;

  const authorName = post.authorName?.trim() || null;

  const item: RawNewsItem = {
    id: newsIdForPost(post.externalId),
    dedupeKey: dedupeKeyForPost(post.externalId),
    title,
    link: post.url,
    // A string, because that is what the store parses pubDateMs out of. ISO so
    // it cannot be misread the way the wire's locale-formatted dates were.
    ...(post.createdAtMs
      ? { pubDate: new Date(post.createdAtMs).toISOString() }
      : {}),
    // The reporter is the outlet here, so the card's attribution is their name
    // rather than the relaying provider's. See RawNewsItem.source.
    source: authorName ?? `@${post.authorUsername}`,
    authorHandle: normalizeHandle(post.authorUsername),
    sourceType: X_SOURCE_TYPE,
    ...(playerName ? { playerName } : {}),
    ...(team ? { teamAbbr: team } : {}),
    ...(summary ? { summary } : {}),
  };

  // The card's image slot, in order of what it is worth showing: the player's
  // headshot when we know who this is about — which makes an X card look like
  // every other card in the feed rather than a foreign object — then the post's
  // own media, then nothing, which renders the same badge a headshot-less wire
  // row already renders.
  const image = player ? headshotUrl(player.id) : (post.media[0] ?? null);
  if (image) item.image = image;

  return { item, player: playerName, team, category };
}

