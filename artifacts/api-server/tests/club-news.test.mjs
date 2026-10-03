/**
 * The club news provider: parsing, identity, and the merge that decides what a
 * team page actually shows.
 *
 * No network. The RSS here is a byte-for-byte trim of what patriots.com and
 * vikings.com served on 2026-09-01, including the two shapes that break naive
 * parsers: CDATA around every editorial string, and a channel carrying exactly
 * one <item>.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

// Bundled at module scope rather than in a before() hook: describe() bodies run
// as the file is evaluated, and a hook that has not resolved yet leaves every
// suite referencing an undefined import.
const { __internals, clubFeedUrl, clubOutlet } = await importModule(
  "lib/club-feed-parse",
);
const { mergeNewsLanes } = await importModule("lib/news-merge");
const { newsDedupeKey } = await importModule("lib/news-item");

after(cleanupBundles);

const NE = {
  abbreviation: "ne",
  siteDomain: "patriots.com",
};

describe("club feed identity", () => {
  test("one URL pattern across every club", () => {
    assert.equal(clubFeedUrl(NE), "https://www.patriots.com/rss/news");
    assert.equal(
      clubFeedUrl({ abbreviation: "lar", siteDomain: "therams.com" }),
      "https://www.therams.com/rss/news",
    );
  });

  test("the outlet is the domain, not a title-cased guess at it", () => {
    // "Therams.com" and "Azcardinals.com" are what capitalising the first
    // letter produces, and there is no rule that recovers the word boundaries
    // the domain threw away.
    assert.equal(clubOutlet(NE), "patriots.com");
    assert.equal(clubOutlet({ siteDomain: "therams.com" }), "therams.com");
    assert.equal(clubOutlet({ siteDomain: "azcardinals.com" }), "azcardinals.com");
  });
});

describe("parsing one item", () => {
  const item = {
    title: { __cdata: "Patriots Sign 12 Players to the Practice Squad" },
    description: { __cdata: "The Patriots announced today that they have claimed TE Cameron Latu." },
    link: "https://www.patriots.com/news/patriots-make-a-series-of-transactions-x5832",
    pubDate: "Mon, 31 Aug 2026 22:00:07 GMT",
    guid: { "#text": "8a173ed4-9099-4009-b6bc-8db1f134eb74", "@_isPermaLink": "false" },
    enclosure: { "@_url": "https://static.clubs.nfl.com/hero.jpg", "@_type": "image/jpeg" },
    "media:content": { "@_url": "https://static.clubs.nfl.com/hero.png" },
  };

  test("CDATA is unwrapped rather than stored with its brackets", () => {
    const parsed = __internals.toItem(NE, item);
    assert.equal(parsed.title, "Patriots Sign 12 Players to the Practice Squad");
    assert.match(parsed.summary, /^The Patriots announced today/);
  });

  test("the club's own standfirst becomes the summary", () => {
    // The whole cost saving: 1,725 of 1,750 rows arrive with one of these, so
    // the LLM backfill never has to see them.
    const parsed = __internals.toItem(NE, item);
    assert.ok(parsed.summary.length > 20);
  });

  test("the id is namespaced by club, so two providers cannot collide", () => {
    const parsed = __internals.toItem(NE, item);
    assert.equal(parsed.id, "club:ne:8a173ed4-9099-4009-b6bc-8db1f134eb74");
  });

  test("the team is carried, and no player is invented for it", () => {
    const parsed = __internals.toItem(NE, item);
    assert.equal(parsed.teamAbbr, "ne");
    assert.equal(parsed.source, "patriots.com");
    // Clubs write about themselves and do not tag players. Guessing one from a
    // headline is how a story ends up on the wrong player's page.
    assert.equal(parsed.playerName, undefined);
  });

  test("the typed jpeg enclosure wins over the media:content png", () => {
    const parsed = __internals.toItem(NE, item);
    assert.equal(parsed.image, "https://static.clubs.nfl.com/hero.jpg");
  });

  test("media:content is used when there is no enclosure", () => {
    const { enclosure, ...withoutEnclosure } = item;
    const parsed = __internals.toItem(NE, withoutEnclosure);
    assert.equal(parsed.image, "https://static.clubs.nfl.com/hero.png");
  });

  test("an item with no title is dropped rather than stored as '(no title)'", () => {
    assert.equal(__internals.toItem(NE, { ...item, title: undefined }), null);
  });

  test("an item with no guid falls back to its link", () => {
    const parsed = __internals.toItem(NE, { ...item, guid: undefined });
    assert.equal(parsed.id, `club:ne:${item.link}`);
  });

  test("absent fields are absent, not the string 'undefined'", () => {
    // Vikings items carry no <description> at all. The row has to reach
    // backfillSummaries() with a null summary, not with something in it.
    const parsed = __internals.toItem(NE, { ...item, description: undefined });
    assert.equal("summary" in parsed, false);
  });
});

describe("two clubs, one headline", () => {
  test("a shared title is two stories, not one", () => {
    // Four clubs file "Practice Report" on the same Wednesday. Unscoped, the
    // fingerprint is identical and three team pages silently lose the item.
    const ne = newsDedupeKey({ title: "Practice Report", id: "a", scope: "ne" });
    const buf = newsDedupeKey({ title: "Practice Report", id: "b", scope: "buf" });
    assert.notEqual(ne, buf);
  });

  test("the wire's keys are untouched, so the archive does not re-ingest itself", () => {
    // Adding a scope to existing rows would make every archived story look new.
    assert.equal(
      newsDedupeKey({ title: "Vita Vea: Agrees to one-year extension", id: "x" }),
      newsDedupeKey({
        title: "Vita Vea: Agrees to one-year extension",
        id: "x",
        scope: undefined,
      }),
    );
  });
});

describe("the team page merge", () => {
  const club = (n, ms) => ({ id: `c${n}`, pubDateMs: ms });
  const wire = (n, ms) => ({ id: `w${n}`, pubDateMs: ms });
  const kinds = (list) => list.map((i) => i.id[0]).join("");

  test("a loud club week cannot take every visible slot", () => {
    // Twenty club items and three wire items, the club newer throughout: by
    // date alone the wire appears at position 21, well past the fold.
    const clubLane = Array.from({ length: 20 }, (_, i) => club(i, 2000 - i));
    const wireLane = [wire(0, 900), wire(1, 800), wire(2, 700)];
    const merged = mergeNewsLanes(clubLane, wireLane);

    const visible = merged.slice(0, 10);
    assert.equal(visible.filter((i) => i.id.startsWith("w")).length, 3);
    // Everything is still present, and nothing was dropped for the quota.
    assert.equal(merged.length, 23);
  });

  test("the quota is paid as late as the window allows", () => {
    const clubLane = Array.from({ length: 12 }, (_, i) => club(i, 2000 - i));
    const wireLane = Array.from({ length: 12 }, (_, i) => wire(i, 1000 - i));
    const merged = mergeNewsLanes(clubLane, wireLane);

    // The club is newer throughout, so it keeps taking slots on merit until
    // there are exactly enough left to pay what the wire is owed - six club,
    // then the four reserved. Late rather than spread, so date order survives
    // for as long as the quota permits rather than being broken up front.
    assert.equal(kinds(merged.slice(0, 10)), "ccccccwwww");
    // Past the window nothing is reserved and it is chronology again: the six
    // remaining club items all outdate the eight remaining wire items.
    assert.equal(kinds(merged.slice(10)), "ccccccwwwwwwww");
  });

  test("date order is respected when neither lane is starving the other", () => {
    const merged = mergeNewsLanes(
      [club(0, 500), club(1, 300)],
      [wire(0, 400), wire(1, 200)],
    );
    assert.equal(kinds(merged), "cwcw");
  });

  test("an empty lane yields its slots instead of leaving gaps", () => {
    const clubLane = Array.from({ length: 5 }, (_, i) => club(i, 500 - i));
    assert.equal(kinds(mergeNewsLanes(clubLane, [])), "ccccc");
    assert.equal(kinds(mergeNewsLanes([], clubLane)), "ccccc");
    assert.deepEqual(mergeNewsLanes([], []), []);
  });

  test("a wire lane shorter than its quota is not padded", () => {
    const clubLane = Array.from({ length: 10 }, (_, i) => club(i, 500 - i));
    const merged = mergeNewsLanes(clubLane, [wire(0, 1)]);
    assert.equal(merged.length, 11);
    assert.equal(merged.filter((i) => i.id.startsWith("w")).length, 1);
  });

  test("undated items sort last, as they do in SQL", () => {
    // Both lanes arrive newest-first out of SQL, where NULLS LAST puts the
    // undated item at the end of its own lane - so that is how it is passed.
    const merged = mergeNewsLanes([club(0, 100), club(1, null)], [wire(0, 50)]);
    assert.equal(kinds(merged), "cwc");
  });
});
