/**
 * GET /embed/depth-charts/version and the fragment's X-SC-Depth-Version
 * (audit WEB-003, docs/WEB-003-DEPTH-CHARTS-CACHE.md).
 *
 * The WordPress publication check polls the version, re-fetches the clubs
 * whose hash moved, and trusts a fragment only when its X-SC-Depth-Version
 * is the version announced. So: the endpoint is behind the embed key; it
 * names all 32 clubs; a snapshot swapped on disk (tmp + rename, as a publish
 * lands) is served by the running process at once, the club that changed
 * gets a new hash and the others keep theirs; and the fragment's header and
 * markup move with it, even when the document's fetchedAt did not.
 *
 * The server reads a scratch copy of the snapshot (SC_DEPTH_CHARTS_FILE), so
 * the real one is never touched. Offline: the providers are replayed.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

const SNAPSHOT = path.join(APP_DIR, "data/depth-charts/statchasers/depth-charts.json");
const KEY = "test-embed-key";
const MARK = "Zzyzx Webthree";

let server;
let replay;
let dir;
let file;

function write(doc) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${file}.tmp`, file);
  // A second apart at least, whatever the filesystem's mtime resolution.
  const t = new Date(Date.now() + Math.floor(Math.random() * 1000) + 2000);
  fs.utimesSync(file, t, t);
}

function snapshotWithBillsQb(name, fetchedAt) {
  const doc = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  if (fetchedAt) doc.fetchedAt = fetchedAt;
  const buf = doc.teams.find((t) => t.team.abbr === "BUF");
  buf.positions.QB[0].name = name;
  for (const slot of buf.slots ?? []) {
    if (slot.slot === "QB" && slot.players[0]) slot.players[0].name = name;
  }
  return doc;
}

async function get(pathname, key = KEY) {
  const res = await fetch(`${server.origin}${pathname}`, { headers: key ? { "X-StatChasers-Key": key } : {} });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function version() {
  const res = await get("/embed/depth-charts/version");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  return JSON.parse(res.body);
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-depth-version-"));
  file = path.join(dir, "depth-charts.json");
  fs.copyFileSync(SNAPSHOT, file);
  replay = await startUpstreamReplay();
  server = await startServer({ ...replay.env, SC_DEPTH_CHARTS_FILE: file, SC_EMBED_KEY: KEY });
});

after(async () => {
  await server?.stop();
  await replay?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("depth-chart publication version", () => {
  test("is behind the embed key, like every /embed/ path", async () => {
    const res = await get("/embed/depth-charts/version", "");
    assert.equal(res.status, 403);
  });

  test("names all 32 clubs, each with a hash and <fetchedAt>~<hash>", async () => {
    const v = await version();
    const committed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    assert.equal(v.fetchedAt, committed.fetchedAt);
    assert.equal(Object.keys(v.teams).length, 32);
    for (const [slug, info] of Object.entries(v.teams)) {
      assert.match(info.hash, /^[0-9a-f]{16}$/, slug);
      assert.equal(info.version, `${v.fetchedAt}~${info.hash}`, slug);
    }
    assert.equal(v.teams["buffalo-bills"].abbr, "BUF");
    assert.ok(v.version.length > 0);
  });

  test("the fragment says which snapshot it was rendered from", async () => {
    const v = await version();
    const res = await get("/embed/team/buffalo-bills?section=depth-chart");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-sc-depth-version"), v.teams["buffalo-bills"].version);
  });

  test("a snapshot swapped on disk is served at once, and only the changed club moves", async () => {
    const before = await version();
    // Same fetchedAt: the content hash alone has to carry the change.
    write(snapshotWithBillsQb(MARK));
    const after = await version();
    assert.notEqual(after.version, before.version, "the fingerprint moves");
    assert.equal(after.fetchedAt, before.fetchedAt);
    assert.notEqual(after.teams["buffalo-bills"].hash, before.teams["buffalo-bills"].hash, "BUF moves");
    for (const slug of Object.keys(before.teams)) {
      if (slug !== "buffalo-bills") assert.equal(after.teams[slug].hash, before.teams[slug].hash, `${slug} stays`);
    }
    const res = await get("/embed/team/buffalo-bills?section=depth-chart");
    assert.equal(res.headers.get("x-sc-depth-version"), after.teams["buffalo-bills"].version);
    assert.ok(res.body.includes(MARK), "the new starter is in the markup (no stale render cache)");
  });

  test("a new fetchedAt moves every club's version but not the unchanged hashes", async () => {
    const before = await version();
    write(snapshotWithBillsQb(MARK, "2099-01-01T00:00:00+00:00"));
    const after = await version();
    assert.equal(after.fetchedAt, "2099-01-01T00:00:00+00:00");
    assert.equal(after.teams["dallas-cowboys"].hash, before.teams["dallas-cowboys"].hash);
    assert.notEqual(after.teams["dallas-cowboys"].version, before.teams["dallas-cowboys"].version);
    const res = await get("/embed/team/dallas-cowboys?section=depth-chart");
    assert.equal(res.headers.get("x-sc-depth-version"), after.teams["dallas-cowboys"].version);
  });

  test("the snapshot back as it was: the Bills' hash returns to the committed one", async () => {
    fs.copyFileSync(SNAPSHOT, `${file}.tmp`);
    fs.renameSync(`${file}.tmp`, file);
    const t = new Date(Date.now() + 10_000);
    fs.utimesSync(file, t, t);
    const v = await version();
    const res = await get("/embed/team/buffalo-bills?section=depth-chart");
    assert.ok(!res.body.includes(MARK));
    assert.equal(res.headers.get("x-sc-depth-version"), v.teams["buffalo-bills"].version);
  });
});
