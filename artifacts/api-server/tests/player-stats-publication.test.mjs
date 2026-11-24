/**
 * WEB-003: GET /embed/player-stats/version, the fingerprint the WordPress
 * plugin polls to publish a new stats snapshot (statchasers-player-stats-cache.php).
 * Its per-position etag must be exactly the ETag of the fragment WordPress
 * prints, or the plugin would refuse every publication as "moved".
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server;
before(async () => {
  server = await startServer({ SC_PLAYER_LIVE_REFRESH: "0" });
});
after(async () => {
  await server?.stop();
});

test("the version names each position's fragment ETag, uncached", async () => {
  const res = await fetch(`${server.origin}/embed/player-stats/version`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const doc = await res.json();
  assert.match(doc.version, /^[a-z0-9]+$/);
  assert.deepEqual(Object.keys(doc.positions), ["qb", "rb", "wr", "te"]);
  assert.ok(doc.seasons.includes(String(doc.season)));
  for (const pos of ["qb", "rb", "wr", "te"]) {
    const frag = await fetch(`${server.origin}/embed/player-stats?pos=${pos}`);
    assert.equal(frag.headers.get("etag"), doc.positions[pos].etag, `${pos}: same ETag as the fragment`);
    const html = await frag.text();
    const weeks = doc.positions[pos].weeks;
    if (weeks) assert.ok(html.includes(`Weeks ${weeks.replace("-", "–")}`), `${pos}: the weeks it announces are the ones printed`);
    assert.equal((html.match(/<tr class="sca-row/g) || []).length, doc.positions[pos].players, `${pos}: player count`);
  }
});

test("the version is stable while nothing changes", async () => {
  const a = await (await fetch(`${server.origin}/embed/player-stats/version`)).json();
  const b = await (await fetch(`${server.origin}/embed/player-stats/version`)).json();
  assert.equal(a.version, b.version);
});

test("a complete snapshot is dated by its last successful ingestion", async () => {
  const doc = await (await fetch(`${server.origin}/embed/player-stats/version`)).json();
  const meta = JSON.parse(await readFile(path.join(APP_DIR, "data", "dataset-meta.json"), "utf8"));
  const m = meta.datasets.player_stats[String(doc.season)];
  if (m && m.lastIngestedAt && !(Date.parse(m.lastAggregatedAt) > Date.parse(m.lastIngestedAt))) {
    assert.equal(doc.positions.wr.updatedAt, m.lastIngestedAt);
  }
});

test("the fragment ETag carries a hash of the markup", async () => {
  const res = await fetch(`${server.origin}/embed/player-stats?pos=wr`);
  const etag = res.headers.get("etag");
  assert.match(etag, /^W\/"WR_\d{4}-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+"$/);
});
