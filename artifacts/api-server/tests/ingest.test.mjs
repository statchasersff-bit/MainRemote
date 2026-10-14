/**
 * The ingest's relationship with the database (Phase 1, 2026-10-14).
 *
 * The feed is re-read on a timer and used to be re-read after any request
 * once ten minutes had passed, and every read opened a transaction to learn
 * that nothing had changed. On a database that bills while awake, that was
 * the bill. Three things are under test here:
 *
 *   - no request ever starts an ingest; only the timer and POST /api/ingest do;
 *   - a feed that has not moved is recognized from memory, with ZERO queries;
 *   - a feed that has moved is still stored, retitles still update in place,
 *     and a restart rebuilds the memory from the table.
 *
 * The feed here is a local stub. The throttle tests serve an empty list, so
 * nothing is written to the shared database; the others write one namespaced
 * story and clean up after themselves.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

const SECRET = "ingest-test-secret";

let feed;
let feedHits = 0;
let server;

/** What the stub feed serves. Empty unless a test sets a story. */
let feedItems = [];

/** Namespaced so the cleanup below cannot touch anything real. */
const TEST_ID = "test:retitle-regression";

async function boot() {
  return startServer({
    DYNASTY_NEWS_API_URL: `http://127.0.0.1:${feed.address().port}/news`,
    INGEST_SECRET: SECRET,
  });
}

before(async () => {
  feed = http.createServer((req, res) => {
    feedHits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: feedItems }));
  });
  await new Promise((resolve) => feed.listen(0, "127.0.0.1", resolve));
  server = await boot();
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

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Force an ingest regardless of the timer by calling the endpoint. */
async function ingest() {
  const res = await fetch(`${server.origin}/api/ingest`, {
    method: "POST",
    headers: { "x-ingest-secret": SECRET },
  });
  return { status: res.status, body: await res.json() };
}

/** How many times each reason has reached the database since boot. */
async function dbCounts() {
  const s = await (await fetch(`${server.origin}/api/status`)).json();
  return { total: s.db.total, ...Object.fromEntries(Object.entries(s.db.byReason).map(([k, v]) => [k, v.count])) };
}

describe("no request starts an ingest", () => {
  test("ingests once at startup", async () => {
    // The startup ingest waits for the state restore, so give it a moment.
    const deadline = Date.now() + 5_000;
    while (feedHits < 1 && Date.now() < deadline) await settle(100);
    assert.equal(feedHits, 1, "expected exactly one ingest on boot");
  });

  test("a burst of requests starts nothing", async () => {
    const before = feedHits;
    await Promise.all(
      Array.from({ length: 8 }, () => fetch(`${server.origin}/api/news?limit=1`)),
    );
    await settle();
    assert.equal(feedHits, before, "a visitor must never trigger an ingest");
  });

  test("nor does a request after any amount of time", async () => {
    const before = feedHits;
    await settle(1_500);
    await fetch(`${server.origin}/api/news?limit=1`);
    await fetch(`${server.origin}/`);
    await settle();
    assert.equal(feedHits, before, "the old traffic-triggered refresh must stay gone");
  });

  test("public reads of the news are answered without the database", async () => {
    await fetch(`${server.origin}/api/news?limit=5`);
    const first = await dbCounts();
    for (let i = 0; i < 5; i++) await fetch(`${server.origin}/api/news?limit=5`);
    await fetch(`${server.origin}/`);
    await fetch(`${server.origin}/embed/ssr`);
    const again = await dbCounts();
    assert.equal(again.news_read ?? 0, first.news_read ?? 0, "repeat reads must come from the read cache");
    assert.equal(again.freshness_read ?? 0, first.freshness_read ?? 0, "freshness is held in memory, never re-queried by traffic");
  });
});

describe("a feed that has not moved", () => {
  const story = {
    id: TEST_ID,
    title: "Test Player: Same headline twice",
    link: "https://example.com/b",
    pubDate: new Date(1787000100000).toISOString(),
    playerName: "Test Player",
    image: "https://sleepercdn.com/content/nfl/players/thumb/1.jpg",
  };

  test("is stored the first time, with one database visit", async () => {
    feedItems = [story];
    const before = await dbCounts();
    const first = await ingest();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.dbTouched, true);
    assert.equal(first.body.inserted + first.body.updated + first.body.unchanged, 1);
    const after = await dbCounts();
    assert.equal((after.news_ingest ?? 0) - (before.news_ingest ?? 0), 1, "one ingest, one database visit");
  });

  test("is recognized from memory on every poll after that: zero queries", async () => {
    const etagBefore = (await fetch(`${server.origin}/`)).headers.get("etag");
    const before = await dbCounts();

    for (let i = 0; i < 3; i++) {
      const again = await ingest();
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(again.body.unchanged, 1, "re-seeing a story is not a change");
      assert.equal(again.body.updated, 0);
      assert.equal(again.body.inserted, 0);
      assert.equal(again.body.dbTouched, false, "an unchanged feed must not open the database");
    }

    const after = await dbCounts();
    assert.equal(after.total, before.total, `duplicate polls reached the database: ${JSON.stringify(after)}`);

    const etagAfter = (await fetch(`${server.origin}/`)).headers.get("etag");
    assert.ok(etagBefore, "the page carries an ETag");
    assert.equal(etagAfter, etagBefore, "a no-op ingest must not change the page's version");
  });

  test("a real edit still lands, and still counts", async () => {
    feedItems = [{ ...story, image: "https://sleepercdn.com/content/nfl/players/thumb/2.jpg" }];
    const edited = await ingest();
    assert.equal(edited.body.updated, 1, "a changed image is an update");
    assert.equal(edited.body.unchanged, 0);
    assert.equal(edited.body.dbTouched, true);

    // And the edit is what the memory now holds.
    const again = await ingest();
    assert.equal(again.body.unchanged, 1);
    assert.equal(again.body.dbTouched, false);
  });

  test("a restart rebuilds the memory from the table", async () => {
    await server.stop();
    server = await boot();
    // The boot ingest already saw the same feed; whichever way it went, the
    // next explicit run must be answered from memory.
    await settle(500);
    const again = await ingest();
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.unchanged, 1, JSON.stringify(again.body));
    assert.equal(again.body.dbTouched, false, "the restored memory must recognize the stored story");
    feedItems = [];
  });
});

describe("upstream editing a story it already sent", () => {
  test("a retitled item updates in place instead of failing the batch", async () => {
    // Upstream keeps an item's id and rewords its headline. The fingerprint is
    // derived from the title, so the row stops matching on fingerprint and looks
    // new - and inserting it collides with the id already stored. That is a
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

    // The old title must not linger in the memory as "unchanged": sending it
    // again is an edit back, and goes to the database.
    feedItems = [{ ...feedItems[0], title: "Test Player: Original headline" }];
    const back = await ingest();
    assert.equal(back.body.updated, 1, "reverting the title is an update, not a memory hit");

    feedItems = [];
  });
});
