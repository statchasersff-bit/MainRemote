/**
 * The depth-chart snapshot's other pages on GET /embed/depth-charts/version
 * (docs/DEPTH-SNAPSHOT-CONSUMERS-2026-11-25.md): each hub's Draft-tab hash
 * and each matchup preview's hash, so the WordPress check purges only the
 * pages a publication changed.
 *
 * The change: the Bills' LB1 and LB2 trade places (Dorian Williams and
 * Terrel Bernard, both Bills draftees). The Bills' hub prints both in its
 * Draft tab's Pos column and the Bills' previews print LB1 in Player Battles
 * (a tight end against LB1 + S1), so those hashes move; every other hub and every preview without
 * the Bills keeps its hash, and the hub's markup carries the new slots.
 *
 * A scratch copy of the snapshot (SC_DEPTH_CHARTS_FILE); offline providers.
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

let server;
let replay;
let dir;
let file;

function swapBillsLinebackers() {
  const doc = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const buf = doc.teams.find((t) => t.team.abbr === "BUF");
  const cb = buf.positions.LB;
  const a = cb.find((r) => r.name === "Dorian Williams");
  const b = cb.find((r) => r.name === "Terrel Bernard");
  assert.ok(a && b, "the committed snapshot lists both linebackers");
  [a.rank, b.rank] = [b.rank, a.rank];
  buf.positions.LB = [...cb].sort((x, y) => x.rank - y.rank);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${file}.tmp`, file);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { headers: { "X-StatChasers-Key": KEY } });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function version() {
  const res = await get("/embed/depth-charts/version");
  assert.equal(res.status, 200);
  return JSON.parse(res.body);
}

/** The Draft tab's Pos-column slot printed on the row naming this player. */
function slotOf(html, name) {
  const at = html.indexOf(name);
  if (at < 0) return null;
  const row = html.slice(at, html.indexOf("</tr>", at));
  return (row.match(/class="sct-dr-slot"[^>]*>([^<]+)</) ?? [])[1] ?? null;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-depth-consumers-"));
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

describe("depth snapshot consumers on the version document", () => {
  test("every club carries its hub path and a Draft hash; previews are path -> {hash, kickoff}", async () => {
    const v = await version();
    for (const [slug, info] of Object.entries(v.teams)) {
      assert.equal(info.hub, `/nfl/teams/${slug}/`, slug);
      assert.match(info.draft, /^([0-9a-f]{16}|none)$/, slug);
    }
    assert.ok(v.previews === null || typeof v.previews === "object");
    for (const [p, info] of Object.entries(v.previews ?? {})) {
      assert.match(p, /^\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\/(\d{4}-week-\d+\/)?$/, p);
      assert.match(info.hash, /^[0-9a-f]{16}$/, p);
    }
  });

  test("a Bills LB1/LB2 swap moves the Bills' Draft hash and Bills previews only", async () => {
    const hubBefore = await get("/embed/team/buffalo-bills");
    assert.equal(slotOf(hubBefore.body, "Dorian Williams"), "LB1");
    assert.equal(slotOf(hubBefore.body, "Terrel Bernard"), "LB2");
    const before = await version();

    swapBillsLinebackers();
    const after = await version();

    assert.notEqual(after.teams["buffalo-bills"].draft, before.teams["buffalo-bills"].draft, "the Bills' Draft tab moved");
    for (const slug of Object.keys(before.teams)) {
      if (slug !== "buffalo-bills") assert.equal(after.teams[slug].draft, before.teams[slug].draft, `${slug} Draft tab unchanged`);
    }
    let billsPreviews = 0;
    for (const [p, info] of Object.entries(after.previews ?? {})) {
      const was = before.previews?.[p];
      if (!was) continue;
      if (p.includes("buffalo-bills")) {
        billsPreviews++;
        assert.notEqual(info.hash, was.hash, `${p} moved`);
      } else assert.equal(info.hash, was.hash, `${p} unchanged`);
    }
    // Through the 2026 regular season the Bills have games left to preview.
    if (Date.now() < Date.parse("2027-01-03T00:00:00Z")) assert.ok(billsPreviews > 0, "Bills previews listed");

    const hubAfter = await get("/embed/team/buffalo-bills");
    assert.equal(slotOf(hubAfter.body, "Dorian Williams"), "LB2", "the hub re-renders with the new slot");
    assert.equal(slotOf(hubAfter.body, "Terrel Bernard"), "LB1");
  });
});
