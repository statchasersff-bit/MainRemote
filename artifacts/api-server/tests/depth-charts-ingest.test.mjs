/**
 * POST /api/depth-charts/ingest - the depth-charts plugin's push - and the
 * team hub's Depth Chart tab reading what it stored.
 *
 * The server writes to a scratch copy of the snapshot (SC_DEPTH_CHARTS_FILE),
 * and its database row is season 2099, deleted afterwards, so this suite
 * cannot touch the real chart. Restore reads only the file's own season, so
 * the row could not reach the real chart even while it exists.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const SECRET = "test-ingest-secret";
const SEASON = 2099;
const SNAPSHOT = path.join(APP_DIR, "data/depth-charts/statchasers/depth-charts.json");

let server;
let dir;
let file;

/** The committed snapshot, with the Patriots' QB1 renamed so a push is visible. */
function push(fetchedAt, qb1 = "Test Quarterback") {
  const doc = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  doc.season = SEASON;
  doc.fetchedAt = fetchedAt;
  const ne = doc.teams.find((t) => t.team.abbr === "NE");
  ne.positions.FAN_QB[0].name = qb1;
  return doc;
}

function post(body, secret = SECRET) {
  return fetch(`${server.origin}/api/depth-charts/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-Ingest-Secret": secret } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function depthTab() {
  const res = await fetch(`${server.origin}/team/new-england-patriots/depth-chart/`);
  return res.text();
}

describe("depth charts push", () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-depth-"));
    file = path.join(dir, "depth-charts.json");
    fs.copyFileSync(SNAPSHOT, file);
    server = await startServer({ INGEST_SECRET: SECRET, SC_DEPTH_CHARTS_FILE: file });
  });

  after(async () => {
    await server?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    if (process.env.DATABASE_URL) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      await client.query("DELETE FROM depth_charts WHERE season = $1", [SEASON]).catch(() => {});
      await client.end();
    }
  });

  test("refuses a push without the secret", async () => {
    assert.equal((await post(push(new Date().toISOString()), "wrong")).status, 401);
    assert.equal((await post(push(new Date().toISOString()), null)).status, 401);
  });

  test("refuses a body that is not a depth-charts document", async () => {
    const bad = await post({ version: 1, season: SEASON, fetchedAt: "now", teams: [] });
    assert.equal(bad.status, 400);
    assert.equal((await post({ ...push(new Date().toISOString()), version: 2 })).status, 400);
  });

  test("takes a ~430KB push, past the app-wide 100kb parser", async () => {
    const body = JSON.stringify(push(new Date(Date.now() + 1000).toISOString()));
    assert.ok(body.length > 200_000, `the test body is ${body.length} bytes`);
    const res = await post(body);
    assert.equal(res.status, 200, await res.clone().text());
    const json = await res.json();
    assert.equal(json.stored, true);
    assert.equal(json.teams, 32);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).fetchedAt, JSON.parse(body).fetchedAt);
  });

  test("the hub's Depth Chart tab shows the push", async () => {
    const html = await depthTab();
    assert.ok(html.includes("Test Quarterback"), "the pushed QB1 is on the tab");
  });

  test("an older refresh does not roll the chart back", async () => {
    const res = await post(push("2020-01-01T00:00:00Z", "Stale Quarterback"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, false);
    const html = await depthTab();
    assert.ok(!html.includes("Stale Quarterback"));
    assert.ok(html.includes("Test Quarterback"));
  });

  test("keeps only the fields the views read", async () => {
    const doc = push(new Date(Date.now() + 5000).toISOString(), "Clean Quarterback");
    doc.teams[0].positions.QB[0].extra = "<script>";
    doc.teams[0].positions.QB[0].headshot = "javascript:alert(1)";
    doc.teams[0].positions["<bad>"] = [{ rank: 1, name: "X" }];
    assert.equal((await post(doc)).status, 200);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.teams[0].positions.QB[0].extra, undefined);
    assert.equal(stored.teams[0].positions.QB[0].headshot, null);
    assert.equal(stored.teams[0].positions["<bad>"], undefined);
  });

  test("a push's slot rows become the football chart, and are checked field by field", async () => {
    const doc = push(new Date(Date.now() + 8000).toISOString(), "Slot Quarterback");
    const ne = doc.teams.find((t) => t.team.abbr === "NE");
    ne.slots = [
      { key: "wr1", slot: "WR", side: "offense", players: [{ rank: 1, name: "First Receiver" }, { rank: 2, name: "Fourth Receiver" }] },
      { key: "wr2", slot: "WR", side: "offense", players: [{ rank: 1, name: "Second Receiver" }] },
      { key: "qb", slot: "QB", side: "offense", players: [{ rank: 1, name: "Slot Quarterback", extra: "<script>" }] },
      { key: "pk", slot: "PK", side: "specialTeams", players: [{ rank: 1, name: "Slot Kicker" }] },
      { key: "mlb", slot: "MLB", side: "defense", players: [{ rank: 1, name: "Slot Backer" }] },
      { key: "<bad>", slot: "WR", side: "offense", players: [{ rank: 1, name: "Dropped" }] },
      { key: "nb", slot: "NB", side: "elsewhere", players: [{ rank: 1, name: "Dropped Too" }] },
      { key: "wr1", slot: "WR", side: "offense", players: [{ rank: 1, name: "Duplicate Key" }] },
    ];
    ne.formations = { offense: "2WR 2TE", defense: "Base 4-3 D", bogus: "x" };
    assert.equal((await post(doc)).status, 200);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")).teams.find((t) => t.team.abbr === "NE");
    assert.deepEqual(stored.slots.map((s) => s.key), ["wr1", "wr2", "qb", "pk", "mlb"]);
    assert.equal(stored.slots[2].players[0].extra, undefined);
    assert.deepEqual(stored.formations, { offense: "2WR 2TE", defense: "Base 4-3 D" });

    const html = await depthTab();
    // Two WR rows, the source's order, the kicker printed as K.
    const rows = [...html.matchAll(/<div class="sct-dcx-row" data-pos="([^"]+)" data-slot="([^"]+)">/g)].map((m) => `${m[2]}:${m[1]}`);
    assert.deepEqual(rows, ["wr1:WR", "wr2:WR", "qb:QB", "mlb:MLB", "pk:K"]);
    assert.ok(html.indexOf("First Receiver") < html.indexOf("Second Receiver"), "slots in the pushed order");
    assert.match(html, /Base offense: 2 WR, 2 TE/);
    assert.match(html, /Base defense: 4-3/);
    assert.ok(!html.includes("Dropped"), "rows that failed the checks are not on the page");
  });

  test("a document without slots folds the football chart from the columns and says so", async () => {
    const doc = push(new Date(Date.now() + 9000).toISOString(), "Column Quarterback");
    for (const team of doc.teams) {
      delete team.slots;
      delete team.formations;
    }
    assert.equal((await post(doc)).status, 200);
    const html = await depthTab();
    assert.match(html, /sct-dcx-folded/);
    assert.equal([...html.matchAll(/data-sct-dc-panel="offense"[\s\S]*?<div class="sct-dcx-row" data-pos="WR"/g)].length, 1, "one folded WR row");
    assert.ok(html.includes("Column Quarterback"));
  });
});
