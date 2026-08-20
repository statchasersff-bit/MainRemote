/**
 * The served page must track the archive even when this instance's own ingest
 * is broken.
 *
 * This is the production failure. `invalidateFreshness()` / `invalidateRenderCache()`
 * only fire from an ingest *in this process* that *succeeded* and *changed*
 * something — so when the deployment's ingest failed every time (its environment
 * was missing the feed URL; `.replit`'s `[userenv.shared]` configures the
 * workspace, not the deployment), nothing ever invalidated. The ETag never moved,
 * the rendered fragment never dropped, and the page served byte-identical HTML
 * indefinitely no matter what was in the database. A cache whose only
 * invalidation path is the very thing that is broken.
 *
 * The same hole applies whenever anything else writes: the scheduled deployment
 * POSTing /api/ingest to a different instance, a second instance, a manual import.
 *
 * So the server is started here exactly as broken as production was — the helper
 * already sets DYNASTY_NEWS_API_URL to "", which makes every ingest throw — and
 * then a row is written to the archive from *outside* the server process. The
 * page must still pick it up.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

/** Short enough for a test to wait out; production runs the 60s default. */
const MAX_AGE_MS = 1000;

/** Namespaced so the cleanup below cannot touch anything real. */
const TEST_ID = "test:external-writer";
const TEST_TITLE = "Test Probe: written by something other than this server";

let server;

before(async () => {
  await removeProbe();
  server = await startServer({ FRESHNESS_MAX_AGE_MS: String(MAX_AGE_MS) });
});

after(async () => {
  await server?.stop();
  await removeProbe();
});

async function withClient(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function removeProbe() {
  await withClient((c) =>
    c.query("DELETE FROM news_items WHERE id = $1", [TEST_ID]),
  );
}

/** Write a story into the archive behind the server's back. */
async function insertProbe() {
  const now = new Date();
  await withClient((c) =>
    c.query(
      `INSERT INTO news_items
         (id, dedupe_key, title, link, pub_date, pub_date_ms,
          player_name, source, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        TEST_ID,
        TEST_TITLE.toLowerCase(),
        TEST_TITLE,
        "https://example.com/test-probe",
        now.toUTCString(),
        now.getTime(),
        "Test Probe",
        "TEST",
        now,
      ],
    ),
  );
}

async function getPage() {
  const res = await fetch(`${server.origin}/`);
  return { etag: res.headers.get("etag"), html: await res.text() };
}

describe("an archive change this server did not make", () => {
  test("reaches the rendered page and moves the ETag", async () => {
    const before = await getPage();
    assert.ok(before.etag, "expected an ETag on the page");
    assert.ok(
      !before.html.includes(TEST_TITLE),
      "probe story must not be in the archive yet",
    );

    await insertProbe();

    // Generous next to MAX_AGE_MS so this asserts "picked up", not "picked up in
    // exactly one tick". Before the fix it never arrives at all, at any timeout.
    const deadline = Date.now() + 15_000;
    let after = before;
    while (Date.now() < deadline) {
      after = await getPage();
      if (after.html.includes(TEST_TITLE)) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    assert.ok(
      after.html.includes(TEST_TITLE),
      "the page kept serving a cached fragment that predates the new story",
    );
    assert.notEqual(
      after.etag,
      before.etag,
      "the ETag must move, or every client revalidates to a 304 forever",
    );
  });

  test("reaches the embed fragment the WordPress mount renders from", async () => {
    // /embed/ssr is served entirely from the same render cache and is what the
    // plugin prints into the host page, so it has to drop as well.
    const res = await fetch(`${server.origin}/embed/ssr`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes(TEST_TITLE),
      "the embed fragment is still serving pre-change markup",
    );
  });
});

describe("GET /api/status", () => {
  test("reports an ingest that cannot run, rather than a bare ok", async () => {
    const res = await fetch(`${server.origin}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();

    // This server was started the way production was broken: no feed URL.
    assert.equal(
      body.feedConfigured,
      false,
      "expected the missing feed URL to be reported",
    );
    // Which feed this environment actually got is the whole point: the
    // workspace and the deployment are configured separately and can disagree.
    assert.equal(body.feedHost, null);
    assert.equal(body.ingest.lastSuccess, null);
    assert.ok(
      body.ingest.lastError,
      "a failing ingest must surface its error here, not only in the log",
    );
    assert.ok(body.ingest.consecutiveFailures >= 1);

    // And the archive half is real, so "ingest broken" can be told apart from
    // "ingest fine, upstream quiet".
    assert.ok(body.archive.items > 0);
  });

  test("healthz still answers ok, which is why status exists", async () => {
    const res = await fetch(`${server.origin}/api/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});
