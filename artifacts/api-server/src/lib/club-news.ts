/**
 * The 32 clubs' own news feeds.
 *
 * A second provider beside the Dynasty Command player wire, not a replacement
 * for it. The two answer different questions and neither covers the other:
 *
 *   - The wire reports players. "Jayden Higgins: Suffers torn ACL at practice"
 *     is tagged with a player and a headshot, which is what the news cards and
 *     the derived team filter are built on, and it is the only one of the two
 *     that carries injury and practice notes.
 *   - A club reports itself. Signings, roster moves, depth-chart news, previews
 *     — published first-party, minutes after they happen, and tagged with a
 *     team by construction because the team IS the feed we fetched.
 *
 * That last point is the reason this exists at all. Team is not stored on a
 * wire row (see lib/news-query.ts): it is inferred per row from the headshot
 * and then the player's name, which cannot be pushed into a WHERE clause, so a
 * team page reads a window of the whole archive and filters it in memory. A
 * club row knows its team before it is written, so it goes in the column and
 * the read becomes an index seek.
 *
 * All 32 clubs run on one NFL platform and answer the same path, so this is one
 * fetch repeated 32 times rather than 32 scrapers. It is RSS, not HTML — a
 * documented, stable, machine-readable format the clubs publish deliberately —
 * and robots.txt on the club domains disallows only /search/, /_libraries/ and
 * /_mobileview/.
 */

import { logger } from "./logger";
import { TEAMS } from "./team/teams";
import type { NflTeam } from "./team/teams";
import {
  clubFeedUrl,
  clubOutlet,
  parseClubFeed,
  type ClubNewsItem,
} from "./club-feed-parse";

export { clubFeedUrl, clubOutlet, type ClubNewsItem };

/** Identifies this server to the club feeds, as the player wire's fetch does. */
const USER_AGENT = "StatChasersNews/1.0 (+https://newsfeed.replit.app)";

/** Per-feed timeout. One slow club must not hold up the other 31. */
const FEED_TIMEOUT_MS = 12_000;

/**
 * How many clubs to fetch at once.
 *
 * Deliberately not 32. These are 32 hostnames on shared infrastructure and a
 * simultaneous burst from one IP every ten minutes is the shape of traffic that
 * gets an IP rate-limited — which is exactly the failure the player wire spent
 * a week on (docs/ingest-cloudflare.md). Six at a time finishes the sweep in
 * about three seconds and looks like a reader rather than a scraper.
 */
const FEED_CONCURRENCY = 6;

/**
 * Oldest club item worth storing, in days.
 *
 * The feeds are not uniform archives. Most carry a few weeks; some carry a
 * single stale outlier (Dallas serves one 2018 article); and one — Washington —
 * is an abandoned feed whose newest item is months old and whose back catalogue
 * is Redskins-era. Without a cutoff, the first ingest would backfill the archive
 * with years-old stories that would then sit in it permanently, because nothing
 * here ever deletes a row.
 *
 * 45 days rather than the team page's 180: this provider's job is what the club
 * is saying now. The archive deepens by accumulating, which is the same way the
 * wire's back catalogue was built.
 */
const MAX_ITEM_AGE_DAYS = 45;

/**
 * How quiet a feed has to be before we say so, in days.
 *
 * A club feed that stops is indistinguishable from a club that has no news, and
 * both look like a healthy 200 carrying items. Washington's feed is in exactly
 * that state today — it answers 200 with 20 items, the newest from June — so
 * this is a real condition rather than a hypothetical one. Logged rather than
 * thrown: one dead feed is not an ingest failure, it is a fact about one team.
 */
const STALE_FEED_DAYS = 21;

export interface ClubIngestSummary {
  /** Clubs whose feed answered with at least one usable item. */
  ok: number;
  /** Clubs whose feed could not be read at all, with the reason. */
  failed: Array<{ team: string; error: string }>;
  /** Clubs answering 200 whose newest item is older than STALE_FEED_DAYS. */
  stale: Array<{ team: string; newestMs: number | null }>;
  /** Items inside the age cutoff, across every club. */
  items: ClubNewsItem[];
  /** Items dropped for being older than MAX_ITEM_AGE_DAYS. */
  tooOld: number;
}

/**
 * The last good read of each club's feed, with the validators it came with.
 *
 * A club publishes a handful of times a day and is swept 48 times, so most
 * sweeps re-download a feed that has not changed — ~1,500 full documents a day
 * per running instance. Sending the validators back turns those into a 304 with
 * no body. The items are kept so a 304 answers exactly what the 200 did: the
 * sweep's stale-feed check and the store's `lastSeenAt` touch see the same rows
 * either way, and nothing downstream has to know which one happened.
 *
 * In memory only. A restart costs one full read per club, which is what every
 * sweep cost before this.
 */
interface ClubFeedMemo {
  etag: string | null;
  lastModified: string | null;
  items: ClubNewsItem[];
}
const feedMemo = new Map<string, ClubFeedMemo>();

async function fetchClub(team: NflTeam): Promise<ClubNewsItem[]> {
  const memo = feedMemo.get(team.abbreviation);
  const headers: Record<string, string> = {
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    // Node's fetch otherwise sends `user-agent: node`, which is what bot
    // management scores as anonymous automation.
    "User-Agent": USER_AGENT,
  };
  if (memo?.etag) headers["If-None-Match"] = memo.etag;
  if (memo?.lastModified) headers["If-Modified-Since"] = memo.lastModified;

  const response = await fetch(clubFeedUrl(team), {
    headers,
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });

  // Only possible when validators were sent, which is only when there is a
  // memo to answer from.
  if (response.status === 304 && memo) {
    return memo.items;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const items = parseClubFeed(team, await response.text());

  // A 200 carrying no items is a failure, not a quiet success — the same call
  // the wire's fetch makes, for the same reason. A club feed is never
  // legitimately empty; an empty parse means the document was not what we think
  // it is, and reporting that as "0 new stories" would hide a format change.
  if (items.length === 0) {
    throw new Error("responded 200 but carried no items");
  }

  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (etag || lastModified) {
    feedMemo.set(team.abbreviation, { etag, lastModified, items });
  } else {
    feedMemo.delete(team.abbreviation);
  }

  return items;
}

/** Run `task` over `list`, at most `limit` at a time, in order. */
async function pooled<T, R>(
  list: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await task(list[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Every club's feed, fetched in parallel and reduced to storable items.
 *
 * Never throws for a single club. One team's site being down, slow, or newly
 * reformatted is a normal Tuesday across 32 independent hosts, and it must not
 * cost the other 31 their ingest — so failures are collected and reported, and
 * the caller decides what an acceptable number of them is.
 */
export async function fetchClubNews(
  nowMs: number = Date.now(),
): Promise<ClubIngestSummary> {
  const cutoff = nowMs - MAX_ITEM_AGE_DAYS * 86_400_000;
  const staleBefore = nowMs - STALE_FEED_DAYS * 86_400_000;

  const summary: ClubIngestSummary = {
    ok: 0,
    failed: [],
    stale: [],
    items: [],
    tooOld: 0,
  };

  const perClub = await pooled(TEAMS, FEED_CONCURRENCY, async (team) => {
    try {
      return { team, items: await fetchClub(team), error: null as string | null };
    } catch (err) {
      return {
        team,
        items: [] as ClubNewsItem[],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  for (const { team, items, error } of perClub) {
    if (error !== null) {
      summary.failed.push({ team: team.abbreviation, error });
      continue;
    }
    summary.ok++;

    let newestMs: number | null = null;
    for (const item of items) {
      const ms = item.pubDate ? Date.parse(item.pubDate) : NaN;
      if (Number.isFinite(ms) && (newestMs === null || ms > newestMs)) newestMs = ms;

      // Undated items are kept: they sort last and the wire's rows are treated
      // the same way. Only a date we can read AND that is old enough to be
      // backfill rather than news is a reason to drop one.
      if (Number.isFinite(ms) && ms < cutoff) {
        summary.tooOld++;
        continue;
      }
      summary.items.push(item);
    }

    if (newestMs === null || newestMs < staleBefore) {
      summary.stale.push({ team: team.abbreviation, newestMs });
    }
  }

  if (summary.failed.length > 0) {
    logger.warn(
      { failed: summary.failed },
      "Some club news feeds could not be read",
    );
  }
  if (summary.stale.length > 0) {
    logger.warn(
      {
        stale: summary.stale.map((s) => ({
          team: s.team,
          newest: s.newestMs ? new Date(s.newestMs).toISOString() : null,
        })),
      },
      "Club feeds answering 200 but carrying nothing recent — the team page will look quiet for a reason that is not the team",
    );
  }

  return summary;
}

export const __internals = {
  pooled,
  fetchClub,
  feedMemo,
  MAX_ITEM_AGE_DAYS,
  STALE_FEED_DAYS,
};
