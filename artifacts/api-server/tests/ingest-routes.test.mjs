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
 * Also covered here, because both are about the same thing — the archive quietly
 * stopping while everything reports fine:
 *
 *   - **An empty 200 is a failure.** A feed that answers with no items would
 *     otherwise store nothing and still be recorded as a successful ingest.
 *   - **GET /api/ingest/health.** The endpoint a monitor watches, which answers
 *     503 rather than describing the problem in a 200 body nobody is reading.
 *
 * Every row these stubs serve is `test:`-prefixed and deleted afterwards, so this
 * suite cannot disturb the real archive.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

const SECRET = "test-ingest-secret";
const TEST_ID = "test:pushed-item";
const FEED_ID = "test:fallback-item";
const FUTURE_ID = "test:future-dated-item";

/** What the working stub serves. Non-empty: an empty 200 is now a failure. */
const FEED_ITEM = {
  id: FEED_ID,
  title: "Test Player: Served by the fallback route",
  link: "https://example.com/fallback",
  pubDate: new Date(1787100000000).toISOString(),
  playerName: "Test Player",
};

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
  working.items = [FEED_ITEM];
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
  await client.query("DELETE FROM news_items WHERE id = ANY($1)", [
    [TEST_ID, FEED_ID, FUTURE_ID],
  ]);
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

  test("a publish time in the future is held at the time it was seen", async () => {
    const before = Date.now();
    const item = {
      id: FUTURE_ID,
      title: "Test Player: Dated a year ahead by a broken feed",
      link: "https://example.com/future",
      pubDate: new Date(before + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal((await ingest({ items: [item] })).status, 200);

    const found = await (
      await fetch(`${server.origin}/api/news?search=${encodeURIComponent("a year ahead")}&limit=10`)
    ).json();
    const row = found.items.find((i) => i.id === FUTURE_ID);
    assert.ok(row, "the item was stored");
    assert.ok(row.pubDateMs >= before && row.pubDateMs <= Date.now(), String(row.pubDateMs));

    // Re-sent as is, it is unchanged rather than re-clamped to a new "now".
    const again = await ingest({ items: [item] });
    assert.equal(again.body.unchanged, 1, JSON.stringify(again.body));
  });

  test("rejects a push without the secret", async () => {
    const res = await ingest({ items: [{ id: "test:nope", title: "nope" }] }, null);
    assert.equal(res.status, 401);
  });

  test("a pull without the secret is refused too", async () => {
    const res = await ingest(undefined, null);
    assert.equal(res.status, 401);
  });
});

describe("a server with no INGEST_SECRET", () => {
  test("refuses every write instead of leaving it open", async () => {
    // These used to treat "no secret" as "not exposed" and let anyone in.
    const open = await startServer({
      DYNASTY_NEWS_API_URL: `http://127.0.0.1:${working.server.address().port}/news`,
      INGEST_SECRET: "",
    });
    try {
      for (const [method, route] of [
        ["POST", "/api/ingest"],
        ["POST", "/api/ingest/clubs"],
        ["POST", "/api/fpa/ingest"],
        ["POST", "/api/x/ingest"],
        ["POST", "/api/x/posts"],
        ["POST", "/api/x/accounts"],
        ["DELETE", "/api/x/accounts/sc_test_nobody"],
      ]) {
        const res = await fetch(`${open.origin}${route}`, {
          method,
          headers: { "Content-Type": "application/json", "x-ingest-secret": "anything" },
          body: method === "POST" ? "{}" : undefined,
        });
        assert.equal(res.status, 503, `${method} ${route}`);
        assert.match((await res.json()).error, /INGEST_SECRET is not configured/);
      }
    } finally {
      await open.stop();
    }
  });
});

describe("a feed that answers 200 with nothing", () => {
  test("counts as a failure rather than a silent no-op", async () => {
    // The failure this guards against is not a crash — it is a run that stores
    // nothing, reports success, and leaves the archive frozen behind a healthy
    // /api/status. Both routes empty here, so the whole attempt has to fail.
    working.items = [];
    try {
      const res = await ingest();

      assert.equal(res.status, 500, JSON.stringify(res.body));
      assert.match(res.body.error, /carried no items/);

      const s = await status();
      assert.notEqual(
        s.ingest.lastError,
        null,
        "an empty feed must not leave lastError null",
      );
    } finally {
      working.items = [FEED_ITEM];
    }
  });

  test("falls through to the next route, like any other bad one", async () => {
    // An empty first route is a broken route, so the list should keep going
    // rather than give up — same as a challenge or a 404.
    const emptyFirst = stubFeed("ok");
    emptyFirst.items = [];
    const emptyPort = await emptyFirst.listen();

    const alt = await startServer({
      DYNASTY_NEWS_API_URL: [
        `http://127.0.0.1:${emptyPort}/news`,
        `http://127.0.0.1:${working.server.address().port}/news`,
      ].join(","),
      INGEST_SECRET: SECRET,
      INGEST_MIN_GAP_MS: "600000",
    });

    try {
      const res = await fetch(`${alt.origin}/api/ingest`, {
        method: "POST",
        headers: { "x-ingest-secret": SECRET },
      });
      const body = await res.json();

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.total, 1, "the second route's item should have landed");

      const s = await (await fetch(`${alt.origin}/api/status`)).json();
      assert.equal(s.ingest.lastError, null);
      assert.equal(s.ingest.lastSource, s.feedHosts[1]);
    } finally {
      await alt.stop();
      await new Promise((r) => emptyFirst.server.close(r));
    }
  });
});

describe("GET /api/ingest/health — the endpoint a monitor watches", () => {
  const health = async () => {
    const res = await fetch(`${server.origin}/api/ingest/health`);
    return {
      status: res.status,
      cacheControl: res.headers.get("cache-control"),
      body: await res.json(),
    };
  };

  test("answers 200 while the archive is moving", async () => {
    await ingest();

    const h = await health();
    assert.equal(h.status, 200, JSON.stringify(h.body));
    assert.equal(h.body.ok, true);
    assert.deepEqual(h.body.reasons, []);
    assert.equal(h.body.consecutiveFailures, 0);
    // Must not be cacheable, or a monitor ends up polling a stale verdict and
    // the alert arrives late — or never clears.
    assert.match(h.cacheControl, /no-store/);
  });

  test("answers 503 once failures pass the threshold, and recovers", async () => {
    working.mode = "challenge";
    try {
      const { maxFailures } = (await health()).body.thresholds;
      for (let i = 0; i < maxFailures; i++) {
        const res = await ingest();
        assert.equal(res.status, 500, "the stub feeds should both be failing");
      }

      const bad = await health();
      assert.equal(bad.status, 503, JSON.stringify(bad.body));
      assert.equal(bad.body.ok, false);
      assert.match(bad.body.reasons[0], /consecutive ingest failures/);
      // The alert has to carry enough to act on without opening the logs.
      assert.match(bad.body.lastError, /Just a moment/);
    } finally {
      working.mode = "ok";
    }

    // A single success clears it — the check reports the state now, not a
    // sticky flag someone has to remember to reset.
    await ingest();
    const good = await health();
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(good.body.ok, true);
  });

  test("is not the platform liveness probe", async () => {
    // /api/healthz must stay 200 through an ingest outage: failing it would have
    // the platform restart a healthy process, which fixes nothing about a feed
    // that is refusing us.
    working.mode = "challenge";
    try {
      for (let i = 0; i < 3; i++) await ingest();

      assert.equal((await health()).status, 503);

      const live = await fetch(`${server.origin}/api/healthz`);
      assert.equal(live.status, 200, "liveness must not fail on a stale ingest");
    } finally {
      working.mode = "ok";
      await ingest();
    }
  });
});
