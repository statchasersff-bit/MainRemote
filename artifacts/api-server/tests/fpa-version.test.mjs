/**
 * WEB-003: GET /embed/fpa/version, the fingerprint the WordPress plugin polls
 * to publish a new FPA dataset (statchasers-fpa-cache.php). Each variant's
 * etag must be exactly the ETag of the fragment WordPress fetches for it (the
 * same query the plugin sends: format and view always, season only on an
 * archive), or the plugin would refuse every publication as "moved".
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

let server;
let hasData = false;
before(async () => {
  server = await startServer();
  hasData = (await fetch(`${server.origin}/embed/fpa`)).status === 200;
});
after(async () => {
  await server?.stop();
});

const VARIANTS = ["ppr-raw", "ppr-adjusted", "half-raw", "half-adjusted", "standard-raw", "standard-adjusted"];

test("the version names every season's six fragment ETags, uncached", async (t) => {
  if (!hasData) return t.skip("no FPA data ingested in this database");
  const res = await fetch(`${server.origin}/embed/fpa/version`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const doc = await res.json();
  assert.match(doc.version, /^[a-z0-9]+$/);
  assert.deepEqual(Object.keys(doc.seasons).sort(), [doc.current, ...doc.archives].map(String).sort());
  assert.equal(doc.seasons[String(doc.current)].kind, "live");
  for (const year of doc.archives) assert.equal(doc.seasons[String(year)].kind, "archive");

  for (const [year, scope] of Object.entries(doc.seasons)) {
    assert.deepEqual(Object.keys(scope.variants).sort(), [...VARIANTS].sort(), `${year}: six variants`);
    assert.match(scope.version, /^[a-z0-9]+$/);
    for (const v of Object.values(scope.variants)) {
      const q = new URLSearchParams({ format: v.format, view: v.view });
      if (Number(year) !== doc.current) q.set("season", year);
      const frag = await fetch(`${server.origin}/embed/fpa?${q}`);
      assert.equal(frag.status, 200, `${year} ${v.format}/${v.view}: fragment served`);
      assert.equal(frag.headers.get("etag"), v.etag, `${year} ${v.format}/${v.view}: same ETag as the fragment`);
      const html = await frag.text();
      assert.ok(html.includes(`data-format="${v.format}"`) && html.includes(`data-view="${v.view}"`), `${year} ${v.format}/${v.view}: the fragment is that variant`);
    }
  }
  const live = doc.seasons[String(doc.current)];
  if (live.weekNumber) {
    const html = await (await fetch(`${server.origin}/embed/fpa?format=ppr&view=raw`)).text();
    assert.ok(new RegExp(`Weeks? 1[^0-9]{1,8}${live.weekNumber}\\b`).test(html) || html.includes(`Week ${live.weekNumber}`), "the through-week it announces is the one printed");
  }
});

test("the version is stable while nothing changes", async (t) => {
  if (!hasData) return t.skip("no FPA data ingested in this database");
  const a = await (await fetch(`${server.origin}/embed/fpa/version`)).json();
  const b = await (await fetch(`${server.origin}/embed/fpa/version`)).json();
  assert.equal(a.version, b.version);
  assert.deepEqual(a.seasons, b.seasons);
});

test("the default fragment and the bare one are the same table", async (t) => {
  if (!hasData) return t.skip("no FPA data ingested in this database");
  const doc = await (await fetch(`${server.origin}/embed/fpa/version`)).json();
  const bare = await fetch(`${server.origin}/embed/fpa`);
  assert.equal(bare.headers.get("etag"), doc.seasons[String(doc.current)].variants["ppr-raw"].etag, "PPR raw is the page's default");
});

test("the version is under the embed key like the fragment", async () => {
  const locked = await startServer({ SC_EMBED_KEY: "k-test-fpa" });
  try {
    const res = await fetch(`${locked.origin}/embed/fpa/version`);
    assert.equal(res.status, 403);
  } finally {
    await locked.stop();
  }
});
