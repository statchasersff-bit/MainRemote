/**
 * Traffic-triggered refresh.
 *
 * The deployment idles between requests, so the in-process 10-minute timer
 * cannot be relied on to keep the archive moving — requests have to drive it
 * too. What matters is that they drive it at a bounded rate: an ingest per
 * visitor would hammer the upstream feed.
 *
 * The feed here is a local stub returning an empty item list. That keeps the
 * test off the real upstream API and, just as importantly, keeps it from
 * writing anything into the shared database — only the number of times the
 * server reaches for the feed is under test.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

/**
 * How long the server must wait between ingests, for this run. Comfortably
 * longer than the tests that have to fit inside one window, so the burst below
 * isn't racing the clock.
 */
const GAP_MS = 1500;

let feed;
let feedHits = 0;
let server;

/**
 * What the stub feed serves. Empty for the throttle tests — nothing is written,
 * so those cannot disturb the shared database — and set to a real item only for
 * the retitle test below, which cleans up after itself.
 */
let feedItems = [];

/** Namespaced so the cleanup below cannot touch anything real. */
const TEST_ID = "test:retitle-regression";

before(async () => {
  feed = http.createServer((req, res) => {
    feedHits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: feedItems }));
  });
  await new Promise((resolve) => feed.listen(0, "127.0.0.1", resolve));

  server = await startServer({
    DYNASTY_NEWS_API_URL: `http://127.0.0.1:${feed.address().port}/news`,
    INGEST_MIN_GAP_MS: String(GAP_MS),
    INGEST_SECRET: "ingest-test-secret",
  });
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => feed?.close(resolve));

  // This file is the only one that writes rows, so it is the only one that has
  // to clean up. Leaving a fake story in the archive would show up in the tool.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM news_items WHERE id = $1", [TEST_ID]);
  await client.end();
});

/** Requests fire the refresh on response "finish", so give it a moment to land. */
const settle = () => new Promise((r) => setTimeout(r, 120));

describe("traffic-triggered refresh", () => {
  test("ingests once at startup", async () => {
    await settle();
    assert.equal(feedHits, 1, "expected exactly one ingest on boot");
  });

  test("a burst of requests does not mean an ingest per request", async () => {
    const before = feedHits;
    await Promise.all(
      Array.from({ length: 8 }, () => fetch(`${server.origin}/api/news?limit=1`)),
    );
    await settle();

    // The invariant is "at most one ingest per window", not "none": if the
    // window happens to lapse mid-burst, one refresh is exactly right. What must
    // never happen is eight of them.
    const fired = feedHits - before;
    assert.ok(
      fired <= 1,
      `8 concurrent requests caused ${fired} ingests; at most 1 allowed`,
    );
  });

  test("a request after the window refreshes the archive", async () => {
    const before = feedHits;
    await new Promise((r) => setTimeout(r, GAP_MS + 50));

    await fetch(`${server.origin}/api/news?limit=1`);
    await settle();

    assert.equal(feedHits, before + 1, "expected one refresh past the window");

    // And the throttle re-arms rather than staying open.
    await fetch(`${server.origin}/api/news?limit=1`);
    await settle();
    assert.equal(feedHits, before + 1, "throttle should close again after firing");
  });

  test("refreshing never delays the response", async () => {
    await new Promise((r) => setTimeout(r, GAP_MS + 50));

    // The stub answers instantly, so this cannot prove much about a slow feed —
    // what it does prove is that the response is not awaiting the ingest at all,
    // since the refresh is hung off the response's own "finish" event.
    const started = Date.now();
    const res = await fetch(`${server.origin}/api/news?limit=1`);
    const elapsed = Date.now() - started;

    assert.equal(res.status, 200);
    assert.ok(elapsed < 1000, `response took ${elapsed}ms`);
  });
});

describe("upstream editing a story it already sent", () => {
  /** Force an ingest regardless of the throttle by calling the endpoint. */
  async function ingest() {
    const res = await fetch(`${server.origin}/api/ingest`, {
      method: "POST",
      headers: { "x-ingest-secret": "ingest-test-secret" },
    });
    return { status: res.status, body: await res.json() };
  }

  test("a retitled item updates in place instead of failing the batch", async () => {
    // Upstream keeps an item's id and rewords its headline. The fingerprint is
    // derived from the title, so the row stops matching on fingerprint and looks
    // new — and inserting it collides with the id already stored. That is a
    // primary-key violation, and because the batch is one transaction it takes
    // every other item down with it: a single reworded headline stops the
    // archive dead. This is what happened in production.
    feedItems = [
      {
        id: TEST_ID,
        title: "Test Player: Original headline",
        link: "https://example.com/a",
        pubDate: new Date(1787000000000).toISOString(),
        playerName: "Test Player",
      },
    ];
    const first = await ingest();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.ok, true);

    feedItems = [
      {
        ...feedItems[0],
        title: "Test Player: Reworded headline",
      },
    ];
    const second = await ingest();

    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.ok, true, "the retitled item must not fail ingest");
    assert.equal(second.body.updated, 1, "expected an in-place update");
    assert.equal(second.body.inserted, 0, "must not store the story twice");

    // And it is genuinely one row, carrying the new title.
    const found = await (
      await fetch(`${server.origin}/api/news?search=Reworded&limit=10`)
    ).json();
    const mine = found.items.filter((i) => i.id === TEST_ID);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].title, "Test Player: Reworded headline");

    feedItems = [];
  });

  test("a story re-sent unchanged is seen, not updated, and moves no cache", async () => {
    // Every wire run re-sends the ~25 stories it sent last time and every club
    // sweep ~1,800. Counting those as updates reset the news ETag and render
    // cache on every run and wrote them back a row at a time.
    const story = {
      id: TEST_ID,
      title: "Test Player: Same headline twice",
      link: "https://example.com/b",
      pubDate: new Date(1787000100000).toISOString(),
      playerName: "Test Player",
      image: "https://sleepercdn.com/content/nfl/players/thumb/1.jpg",
    };
    feedItems = [story];
    const first = await ingest();
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const etagBefore = (await fetch(`${server.origin}/`)).headers.get("etag");

    const again = await ingest();
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.updated, 0, "re-seeing a story is not an update");
    assert.equal(again.body.unchanged, 1);
    assert.equal(again.body.inserted, 0);

    const etagAfter = (await fetch(`${server.origin}/`)).headers.get("etag");
    assert.ok(etagBefore, "the page carries an ETag");
    assert.equal(etagAfter, etagBefore, "a no-op ingest must not change the page's version");

    // A real edit still lands, and still counts.
    feedItems = [{ ...story, image: "https://sleepercdn.com/content/nfl/players/thumb/2.jpg" }];
    const edited = await ingest();
    assert.equal(edited.body.updated, 1, "a changed image is an update");
    assert.equal(edited.body.unchanged, 0);

    feedItems = [];
  });
});
