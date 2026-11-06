/**
 * The national outlets: ProFootballTalk, Yahoo Sports and CBS Sports, read
 * from their public NFL RSS feeds (mak, 2026-11-06). The same three feeds
 * Redraft Command's player research reads (its server/news/feeds.ts), under
 * the same rules:
 *
 *   - HEADLINE ONLY. The title, credited to the outlet and linked to its
 *     story. The feed's description is never stored, shown or summarized, so
 *     a row in this lane has no summary - and backfillSummaries() skips the
 *     lane, so no model writes one either.
 *   - ESPN stays out: its RSS sits behind a bot challenge, and getting around
 *     that is not something we do.
 *
 * Tagging. A national headline carries no player or team field, so one is
 * read from the words: the first rostered player named in full (a suffix
 * such as "II" optional, a name two rostered players share skipped), else
 * the one club named by nickname. A headline that names neither, or names
 * two clubs and no player, is not stored - there is no page it belongs on.
 * Every stored row therefore has a team, which keeps the lane off the main
 * player-wire feed (lib/news-query.ts listNews: `team_abbr IS NULL`) and puts
 * it on that team's hub and, when a player was named, on his page.
 */

import { XMLParser } from "fast-xml-parser";
import { logger } from "./logger";
import type { RawNewsItem } from "./news-item";
import { loadPlayers } from "./player/data";
import { searchKey } from "./render";
import { teamForPlayerName } from "./team/roster";
import { TEAMS } from "./team/teams";

export interface Outlet {
  /** Stable short key, used in the row id. */
  key: string;
  /** The credit shown on the page. */
  name: string;
  url: string;
}

export const OUTLETS: readonly Outlet[] = [
  { key: "pft", name: "ProFootballTalk", url: "https://www.nbcsports.com/profootballtalk.rss" },
  { key: "yahoo", name: "Yahoo Sports", url: "https://sports.yahoo.com/nfl/rss/" },
  { key: "cbs", name: "CBS Sports", url: "https://www.cbssports.com/rss/headlines/nfl/" },
];

const USER_AGENT = "StatChasersNews/1.0 (+https://news.statchasers.com)";
const FEED_TIMEOUT_MS = 12_000;
/** Older than this is not news. The feeds hold a day or two anyway. */
const MAX_ITEM_AGE_DAYS = 14;

export interface OutletItem extends RawNewsItem {
  id: string;
  title: string;
  source: string;
  teamAbbr: string;
  summary?: undefined;
}

/* ------------------------------------------------------------------ parse */

const parser = new XMLParser({
  ignoreAttributes: true,
  cdataPropName: "__cdata",
  trimValues: true,
  processEntities: false,
  isArray: (_name, jpath) => jpath === "rss.channel.item",
});

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "...",
};

/** Feed titles arrive entity-encoded, CDATA or not ("He&#39;s earned it"). */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

function text(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number") {
    const value = String(node).replace(/\s+/g, " ").trim();
    return value ? decodeEntities(value) : null;
  }
  if (typeof node === "object") {
    const cdata = (node as { __cdata?: unknown }).__cdata;
    if (cdata !== undefined) return text(cdata);
    const value = (node as { "#text"?: unknown })["#text"];
    if (value !== undefined) return text(value);
  }
  return null;
}

export interface ParsedHeadline {
  guid: string;
  title: string;
  link: string | null;
  pubDate: string | null;
}

/** The feed's items as headlines. The description is read past, never kept. */
export function parseOutletFeed(xml: string): ParsedHeadline[] {
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const out: ParsedHeadline[] = [];
  for (const raw of parsed.rss?.channel?.item ?? []) {
    const title = text(raw["title"]);
    const link = text(raw["link"]);
    const guid = text(raw["guid"]) ?? link;
    if (!title || !guid) continue;
    out.push({ guid, title, link, pubDate: text(raw["pubDate"]) });
  }
  return out;
}

/* -------------------------------------------------------------------- tag */

interface Tagger {
  /** Folded full name (and the name without a suffix) -> player, or null when shared. */
  players: Map<string, { name: string; id: string; team: string } | null>;
  /** Folded nickname -> our team code. */
  teams: Map<string, string>;
  longest: number;
}

const SUFFIX = /\s(jr|sr|ii|iii|iv|v)$/;

export function buildTagger(
  roster: ReadonlyArray<{ id: string; name: string; team: string | null; position?: string | null }> = loadPlayers(),
): Tagger {
  const players: Tagger["players"] = new Map();
  let longest = 1;
  const add = (key: string, p: { name: string; id: string; team: string }) => {
    if (!key || !key.includes(" ")) return;
    if (players.has(key)) {
      const prior = players.get(key);
      if (prior && prior.id !== p.id) players.set(key, null);
      return;
    }
    players.set(key, p);
    longest = Math.max(longest, key.split(" ").length);
  };
  for (const p of roster) {
    // Team defenses are in the roster as "Cincinnati Bengals": the club, not a player.
    if (!p.team || p.team.toUpperCase() === "FA" || p.position === "DEF") continue;
    const entry = { name: p.name, id: p.id, team: p.team.toLowerCase() };
    const key = searchKey(p.name);
    add(key, entry);
    if (SUFFIX.test(key)) add(key.replace(SUFFIX, ""), entry);
  }
  const teams = new Map<string, string>();
  for (const t of TEAMS) teams.set(searchKey(t.nickname), t.abbreviation);
  return { players, teams, longest };
}

export interface HeadlineTag {
  playerName: string | null;
  playerId: string | null;
  team: string;
}

/** The player or the one club a headline is about, or null. */
export function tagHeadline(title: string, tagger: Tagger): HeadlineTag | null {
  const words = searchKey(title).split(" ").filter(Boolean);
  // First player named, reading left to right; the longest name at a position wins.
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(tagger.longest, words.length - i); n >= 2; n--) {
      const hit = tagger.players.get(words.slice(i, i + n).join(" "));
      if (hit === undefined) continue;
      if (hit === null) break; // a name two players share: no guess
      const team = teamForPlayerName(hit.name) ?? hit.team;
      return { playerName: hit.name, playerId: hit.id, team };
    }
  }
  const named = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const n of [1, 2]) {
      const code = tagger.teams.get(words.slice(i, i + n).join(" "));
      if (code) named.add(code);
    }
  }
  if (named.size !== 1) return null;
  return { playerName: null, playerId: null, team: [...named][0]! };
}

/* ------------------------------------------------------------------ sweep */

export interface OutletSweepSummary {
  ok: number;
  failed: Array<{ outlet: string; error: string }>;
  items: OutletItem[];
  read: number;
  untagged: number;
  tooOld: number;
}

async function fetchFeedText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

export function toOutletItems(
  outlet: Outlet,
  headlines: ParsedHeadline[],
  tagger: Tagger,
  nowMs: number,
  counts: { untagged: number; tooOld: number } = { untagged: 0, tooOld: 0 },
): OutletItem[] {
  const cutoff = nowMs - MAX_ITEM_AGE_DAYS * 86_400_000;
  const items: OutletItem[] = [];
  for (const h of headlines) {
    const ms = h.pubDate ? Date.parse(h.pubDate) : NaN;
    if (Number.isFinite(ms) && ms < cutoff) {
      counts.tooOld++;
      continue;
    }
    const tag = tagHeadline(h.title, tagger);
    if (!tag) {
      counts.untagged++;
      continue;
    }
    items.push({
      id: `outlet:${outlet.key}:${h.guid}`,
      title: h.title,
      ...(h.link ? { link: h.link } : {}),
      ...(h.pubDate ? { pubDate: h.pubDate } : {}),
      ...(tag.playerName ? { playerName: tag.playerName } : {}),
      ...(tag.playerId ? { image: `https://sleepercdn.com/content/nfl/players/thumb/${tag.playerId}.jpg` } : {}),
      source: outlet.name,
      teamAbbr: tag.team,
    });
  }
  return items;
}

/** Every outlet, read and reduced to tagged headlines. Never throws for one feed. */
export async function fetchOutletNews(
  nowMs: number = Date.now(),
  fetchText: (url: string) => Promise<string> = fetchFeedText,
): Promise<OutletSweepSummary> {
  const summary: OutletSweepSummary = { ok: 0, failed: [], items: [], read: 0, untagged: 0, tooOld: 0 };
  const tagger = buildTagger();
  const results = await Promise.all(
    OUTLETS.map(async (outlet) => {
      try {
        const headlines = parseOutletFeed(await fetchText(outlet.url));
        if (headlines.length === 0) throw new Error("responded 200 but carried no items");
        return { outlet, headlines, error: null as string | null };
      } catch (err) {
        return { outlet, headlines: [] as ParsedHeadline[], error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  for (const { outlet, headlines, error } of results) {
    if (error !== null) {
      summary.failed.push({ outlet: outlet.key, error });
      continue;
    }
    summary.ok++;
    summary.read += headlines.length;
    summary.items.push(...toOutletItems(outlet, headlines, tagger, nowMs, summary));
  }
  if (summary.failed.length) logger.warn({ failed: summary.failed }, "Some national outlet feeds could not be read");
  return summary;
}
