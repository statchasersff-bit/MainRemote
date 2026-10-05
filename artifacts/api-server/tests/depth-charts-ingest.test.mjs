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
});
