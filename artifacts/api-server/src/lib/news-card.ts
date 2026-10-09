/**
 * The pieces a news card is built from, shared by the two surfaces that draw
 * one.
 *
 * The team hub and the player pages render news into the same card - photo
 * above, kicker and stamp, headline, byline, a way through to the report - and
 * each used to own its own copy of the small decisions that card makes: which
 * timezone a stamp is in, what the kicker says when the item is an X post,
 * whether the player's name is stripped off the front of a headline the feed
 * wrote as "Name: Rest". Two copies meant the two pages could quietly drift
 * into telling a reader different things about the same story, which is the
 * one thing this pair of pages must not do.
 *
 * Markup stays with each renderer: the two carry different class prefixes and
 * different heading levels, and neither is trying to become the other.
 */

import { escapeHtml, isXItem, searchKey, type NewsItem } from "./render";
import { categoryLabel } from "./news-category";

const MONTHS_UPPER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export interface DateParts {
  monthUpper: string;
  month: string;
  day: string;
  year: string;
  weekday: string;
  time: string;
}

/**
 * Date pieces in US Eastern - the league's own timezone, and the same one the
 * news cards already format in. Pinned rather than locale-derived so a cached
 * render is correct for every reader and identical on every request.
 */
export function easternParts(ms: number): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const monthIndex = Number(get("month")) - 1;
  return {
    monthUpper: MONTHS_UPPER[monthIndex] ?? "",
    month: (MONTHS_UPPER[monthIndex] ?? "").charAt(0) + (MONTHS_UPPER[monthIndex] ?? "").slice(1).toLowerCase(),
    day: get("day"),
    year: get("year"),
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} ET`,
  };
}

/**
 * The headline with the leading player name removed.
 *
 * The feed writes titles as "TreVeyon Henderson: Dealing with ankle injury",
 * and these cards print the player's name on its own line directly beneath.
 * Left alone the name would appear twice on every card. Only stripped when the
 * title really does start with the stored player name, so a title in any other
 * shape is passed through untouched.
 */
export function splitHeadline(item: NewsItem): string {
  const title = item.title.trim();
  const name = (item.playerName ?? "").trim();
  if (!name) return title;
  const separator = title.indexOf(":");
  if (separator <= 0) return title;
  if (searchKey(title.slice(0, separator)) !== searchKey(name)) return title;
  const rest = title.slice(separator + 1).trim();
  return rest || title;
}

/**
 * The kicker above a headline.
 *
 * The item's derived category for the wire and the club feeds, and the reporter
 * for an X post: these pages have their own card renderers, so a post arriving
 * on one would otherwise be labeled as something it is not. The feed's card
 * makes the same substitution in the same slot - see renderCardLabel in
 * lib/render.ts, which is also where the reasoning for showing the category
 * rather than a fixed "Player News" is written down.
 */
export function newsKicker(item: NewsItem): string {
  if (!isXItem(item)) return categoryLabel(item.category);
  const name = (item.source ?? "").trim();
  return name || (item.authorHandle ? `@${item.authorHandle}` : "X");
}

/**
 * The stamp line: kicker, a dot, then the date in Eastern.
 *
 * `data-ts` is what the client refines into "3 hours ago" for a recent story
 * and leaves alone for an old one - see wireTimestamps in client/enhance.ts.
 * The class prefix differs between the two pages, so it is passed in rather
 * than assumed.
 */
export function newsStamp(item: NewsItem, ts: number | null, prefix: string): string {
  const kicker = escapeHtml(newsKicker(item));
  if (ts === null) return `<span class="${prefix}-news-kicker">${kicker}</span>`;
  const parts = easternParts(ts);
  return (
    `<p class="${prefix}-news-meta">` +
    `<span class="${prefix}-news-kicker">${kicker}</span>` +
    `<span class="${prefix}-dot" aria-hidden="true"></span>` +
    `<time datetime="${escapeHtml(new Date(ts).toISOString())}" data-ts="${ts}">` +
    `${escapeHtml(`${parts.monthUpper} ${parts.day}`)}` +
    `<span class="${prefix}-news-time"> · ${escapeHtml(parts.time)}</span>` +
    `</time></p>`
  );
}
