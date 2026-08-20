/**
 * The two ways the archive can be kept moving when the feed is not directly
 * reachable from the server.
 *
 * Cloudflare challenges the deployment's egress IP in front of the real feed, so
 * "the server fetches the feed" is not something this app can rely on. Two
 * answers, both covered here:
 *
 *   - **Fallback routes.** DYNASTY_NEWS_API_URL is a list. A dead first entry
 *     must cost one failed request, not an outage.
 *   - **Push mode.** POST /api/ingest with items in the body stores them without
 *     any outbound call at all, so anything that *can* read the feed can drive
 *     the archive.
 *
 * Every stub feed here serves an empty list except where a test explicitly needs
 * a row, and that row is `test:`-prefixed and deleted afterwards — so this suite
 * cannot disturb the real archive.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

const SECRET = "test-ingest-secret";
const TEST_ID = "test:pushed-item";

/** A stub feed. `mode` decides how it answers; `hits` counts what reached it. */
function stubFeed(mode) {
  const state = { hits: 0, mode };
  const server = http.createServer((req, res) => {
    state.hits++;
    if (state.mode === "challenge") {
      // What Cloudflare actually returns to the deployment.
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<!DOCTYPE html><html><head><title>Just a moment...</title>");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: state.items ?? [] }));
  });
  state.server = server;
  state.listen = () =>
    new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
  return state;
}

let blocked;
let working;
let server;

before(async () => {
  await removeProbe();

  blocked = stubFeed("challenge");
  working = stubFeed("ok");
  const blockedPort = await blocked.listen();
  const workingPort = await working.listen();

  server = await startServer({
    // Dead route first, good route second — the production shape.
    DYNASTY_NEWS_API_URL: [
      `http://127.0.0.1:${blockedPort}/news`,
      `http://127.0.0.1:${workingPort}/news`,
    ].join(","),
    INGEST_SECRET: SECRET,
    INGEST_MIN_GAP_MS: "600000",
  });
});

after(async () => {
  await server?.stop();
  await new Promise((r) => blocked?.server.close(r));
  await new Promise((r) => working?.server.close(r));
  await removeProbe();
});

async function removeProbe() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM news_items WHERE id = $1", [TEST_ID]);
  await client.end();
}

const status = async () =>
  (await fetch(`${server.origin}/api/status`)).json();

const ingest = async (body, secret = SECRET) => {
  const res = await fetch(`${server.origin}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-ingest-secret": secret } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

describe("fallback feed routes", () => {
  test("a blocked first route falls through to a working one", async () => {
    const before = working.hits;
    const res = await ingest();

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mode, "pull");
    assert.ok(
      working.hits > before,
      "the second route should have been tried after the first was challenged",
    );

    const s = await status();
    assert.equal(s.ingest.lastError, null);
    // Both routes are reported, so a fallback silently carrying the archive is
    // visible rather than looking like the primary is healthy.
    assert.equal(s.feedHosts.length, 2);
    assert.equal(s.ingest.lastSource, s.feedHosts[1]);
  });

  test("when every route fails, the error names each one", async () => {
    working.mode = "challenge";
    try {
      const res = await ingest();
      assert.equal(res.status, 500);
      assert.match(res.body.error, /all 2 feed routes failed/);
      // The body is what distinguishes a block from a wrong URL, so it has to
      // survive into the reported error.
      assert.match(res.body.error, /Just a moment/);
    } finally {
      working.mode = "ok";
    }
  });
});

describe("push mode", () => {
  test("stores items from the request body without touching the feed", async () => {
    const feedHitsBefore = blocked.hits + working.hits;

    const res = await ingest({
      items: [
        {
          id: TEST_ID,
          title: "Test Player: Pushed straight into the archive",
          link: "https://example.com/pushed",
          pubDate: new Date(1787100000000).toISOString(),
          playerName: "Test Player",
        },
      ],
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.mode, "push");
    assert.equal(res.body.total, 1);
    assert.equal(
      blocked.hits + working.hits,
      feedHitsBefore,
      "push mode must make no outbound call — that is the entire point",
    );

    const found = await (
      await fetch(`${server.origin}/api/news?search=Pushed&limit=10`)
    ).json();
    assert.equal(found.items.filter((i) => i.id === TEST_ID).length, 1);

    const s = await status();
    assert.equal(s.ingest.lastSource, "push");
  });

  test("an empty body still means pull, so existing callers are unaffected", async () => {
    const res = await ingest();
    assert.equal(res.body.mode, "pull");
  });

  test("rejects a push without the secret", async () => {
    const res = await ingest({ items: [{ id: "test:nope", title: "nope" }] }, null);
    assert.equal(res.status, 401);
  });
});
