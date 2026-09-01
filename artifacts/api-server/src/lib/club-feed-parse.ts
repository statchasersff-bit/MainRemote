/**
 * A club's RSS document, turned into rows. No network, no logging, no state.
 *
 * Split from lib/club-news.ts so the part with the interesting failure modes —
 * CDATA, a channel with exactly one item, an item with no guid, a feed that
 * carries no standfirst — can be exercised directly. The orchestration next
 * door is a pool and a loop; this is where a wrong assumption about the format
 * silently stores a truncated headline.
 */

import { XMLParser } from "fast-xml-parser";
import type { RawNewsItem } from "./news-item";

/** The part of a team this module needs. Structural, so a test can pass two fields. */
export interface ClubFeedTeam {
  abbreviation: string;
  siteDomain: string;
}

/**
 * A club feed item.
 *
 * The ingest contract narrowed to what a club actually carries: an id and a
 * title always, a team and an outlet always (both are known here, which is the
 * whole point), and never a playerName — clubs write about themselves and do
 * not tag the players they mention.
 */
export interface ClubNewsItem extends RawNewsItem {
  id: string;
  title: string;
  // Optional rather than nullable, to match RawNewsItem: storeItems() reads
  // `item.x ?? null` throughout, and a field that is present-and-null there
  // means the same as absent. One convention, so a club item can be handed
  // straight to it.
  link?: string;
  pubDate?: string;
  image?: string;
  /** The club's own standfirst. Free, and better than a generated one. */
  summary?: string;
  /** Our lowercase code, e.g. "ne". Known, not inferred. */
  teamAbbr: string;
  /** The reporting outlet, e.g. "Patriots.com". Here it is genuinely known. */
  source: string;
  playerName?: undefined;
}

export function clubFeedUrl(team: ClubFeedTeam): string {
  return `https://www.${team.siteDomain}/rss/news`;
}

/**
 * The outlet name for a club: its domain, verbatim.
 *
 * "patriots.com", not "New England Patriots" — this field names the
 * publication, which is the thing `source` means everywhere else in the
 * archive, and the site is the publication. Not title-cased: capitalising the
 * first letter gives "Patriots.com" for the clubs whose domain is one word and
 * "Therams.com", "Azcardinals.com", "Neworleanssaints.com" for the fifteen it
 * is not, and there is no rule that recovers the word boundaries the domain
 * threw away. Lowercase is how a domain is written anyway.
 *
 * Derived rather than a 33rd column, because the domain is already the identity
 * and two spellings of it would drift.
 */
export function clubOutlet(team: ClubFeedTeam): string {
  return team.siteDomain;
}

/**
 * XML in, plain objects out.
 *
 * A parser rather than a handful of regexes. The feeds are machine-generated
 * and look uniform enough to slice up by hand, but every field here is CDATA
 * wrapping arbitrary editorial text — apostrophes, ampersands, the occasional
 * bracket — and a regex that is wrong about one of those does not throw, it
 * silently stores a truncated headline.
 *
 * `isArray` pins <item> to an array. Without it a club with exactly one story
 * parses to an object rather than a list of one, which is the classic way this
 * kind of code works for 31 teams and crashes on the 32nd.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  trimValues: true,
  isArray: (name, jpath) => jpath === "rss.channel.item",
});

/** CDATA, a bare string, or a number, reduced to trimmed text. */
function text(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number") {
    const value = String(node).trim();
    return value || null;
  }
  if (typeof node === "object") {
    const cdata = (node as { __cdata?: unknown }).__cdata;
    if (cdata !== undefined) return text(cdata);
    const value = (node as { "#text"?: unknown })["#text"];
    if (value !== undefined) return text(value);
  }
  return null;
}

/** An attribute off a node that may have been parsed as one object or a list. */
function attr(node: unknown, name: string): string | null {
  const first = Array.isArray(node) ? node[0] : node;
  if (!first || typeof first !== "object") return null;
  return text((first as Record<string, unknown>)[`@_${name}`]);
}

interface RssItem {
  title?: unknown;
  description?: unknown;
  link?: unknown;
  pubDate?: unknown;
  guid?: unknown;
  enclosure?: unknown;
  "media:content"?: unknown;
}

/**
 * One <item> to one stored row, or null if it cannot be identified.
 *
 * The id is namespaced with the club rather than taken raw. A club's <guid> is
 * a bare UUID with no issuer in it, so two providers' ids share one primary key
 * space and nothing but the prefix would stop a collision from overwriting a
 * wire story with a club one. It also makes a row say where it came from
 * without a join.
 */
function toItem(team: ClubFeedTeam, raw: RssItem): ClubNewsItem | null {
  const title = text(raw.title);
  if (!title) return null;

  const link = text(raw.link);
  const guid = text(raw.guid) ?? link;
  if (!guid) return null;

  // The enclosure first: it is the typed image/jpeg, where media:content is
  // sometimes a PNG of the same asset. Either is a real editorial hero.
  const image = attr(raw.enclosure, "url") ?? attr(raw["media:content"], "url");

  const pubDate = text(raw.pubDate);
  const summary = text(raw.description);

  return {
    id: `club:${team.abbreviation}:${guid}`,
    title,
    ...(link ? { link } : {}),
    ...(pubDate ? { pubDate } : {}),
    ...(image ? { image } : {}),
    ...(summary ? { summary } : {}),
    teamAbbr: team.abbreviation,
    source: clubOutlet(team),
  };
}

/**
 * Every usable item in one club's feed document.
 *
 * Items that cannot be identified — no title, or neither a guid nor a link —
 * are dropped rather than stored under a generated id. A row whose identity is
 * invented is a row the next ingest cannot recognise, which is how an archive
 * fills up with copies of the same story.
 */
export function parseClubFeed(
  team: ClubFeedTeam,
  xml: string,
): ClubNewsItem[] {
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem[] } };
  };
  return (parsed.rss?.channel?.item ?? [])
    .map((raw) => toItem(team, raw))
    .filter((item): item is ClubNewsItem => item !== null);
}

/** Exposed for the test; everything here is pure. */
export const __internals = { toItem, text, attr };
