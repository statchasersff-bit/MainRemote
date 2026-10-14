/**
 * The served page must track the archive even when this instance's own ingest
 * is broken - once it has been told.
 *
 * The freshness state and the render caches only move from an ingest *in this
 * process* that *succeeded* and *changed* something. That was the production
 * failure once (a deployment whose environment was missing the feed URL served
 * byte-identical HTML indefinitely), and the fix then was to re-query the
 * archive every minute. Phase 1 (2026-10-14) removed that query: on a database
 * that bills while awake, a COUNT/MAX per minute of traffic was a bill by
 * itself. The state is loaded once at startup and kept in memory, and anything
 * that writes the archive from OUTSIDE this process says so by calling
 * POST /api/cache/reload with the ingest secret.
 *
 * So the server is started here exactly as broken as production was - the helper
 * already sets DYNASTY_NEWS_API_URL to "", which makes every ingest throw - a row
 * is written to the archive from *outside* the server process, and the reload is
 * called. The page must pick it up, and must NOT have picked it up before the
 * reload (that would mean traffic is still reaching the database).
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startServer } from "./helpers/server.mjs";

const SECRET = "freshness-test-secret";

/** Namespaced so the cleanup below cannot touch anything real. */
const TEST_ID = "test:external-writer";
const TEST_TITLE = "Test Probe: written by something other than this server";

let server;

before(async () => {
  await removeProbe();
  server = await startServer({
    INGEST_SECRET: SECRET,
    // Pinned rather than inherited, so the assertions below stay deterministic
    // once this is set in a real environment.
    DYNASTY_NEWS_API_KEY: "",
  });
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

/** What an external writer calls once it has written. */
async function reload() {
  const res = await fetch(`${server.origin}/api/cache/reload`, {
    method: "POST",
    headers: { "x-ingest-secret": SECRET },
  });
  return { status: res.status, body: await res.json() };
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

    // Not yet: nothing in this process knows, and traffic must not be what
    // asks the database.
    await new Promise((r) => setTimeout(r, 1_500));
    const unaware = await getPage();
    assert.ok(
      !unaware.html.includes(TEST_TITLE),
      "the page reached the database on its own - the freshness query is back",
    );
    assert.equal(unaware.etag, before.etag);

    const reloaded = await reload();
    assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
    assert.equal(reloaded.body.ok, true);

    const after = await getPage();

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
    assert.deepEqual(body.feedHosts, []);
    // The WAF bypass secret is reported as present/absent, never echoed.
    assert.equal(body.feedKeyConfigured, false);
    assert.ok(
      !JSON.stringify(body).toLowerCase().includes("ingest-key"),
      "/api/status must never echo the shared secret or its header",
    );
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
