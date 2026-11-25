/**
 * Startup restore must not roll the team depth chart back (2026-11-25).
 *
 * restoreDepthCharts() runs once per process and used to put the stored push
 * back whenever its fetchedAt was later than the file's. fetchedAt is a fetch
 * time, not a publication time, so an older stored push with a later
 * fetchedAt replaced a newer committed snapshot at every boot. Now a row wins
 * only when it was pushed on top of the very snapshot on disk (basedOn) and
 * is a strictly later fetch.
 *
 * Scratch file (SC_DEPTH_CHARTS_FILE) and season 2098 rows, deleted after, so
 * the real chart and the real row are never touched. Needs DATABASE_URL.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const SECRET = "test-ingest-secret";
const SEASON = 2098;
const SNAPSHOT = path.join(APP_DIR, "data/depth-charts/statchasers/depth-charts.json");
const T1 = "2026-11-24T12:00:00Z";
const at = (hours) => new Date(Date.parse(T1) + hours * 3_600_000).toISOString();

let dir;
let file;
let client;
let server;

/** The committed snapshot as season 2098, the Patriots' QB1 renamed to a marker. */
function doc(fetchedAt, qb1) {
  const d = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  d.season = SEASON;
  d.fetchedAt = fetchedAt;
  d.teams.find((t) => t.team.abbr === "NE").positions.FAN_QB[0].name = qb1;
  for (const t of d.teams) delete t.updatedAt;
  return d;
}

function commit(d) {
  fs.writeFileSync(file, JSON.stringify(d));
}

async function boot() {
  await server?.stop();
  server = await startServer({ INGEST_SECRET: SECRET, SC_DEPTH_CHARTS_FILE: file });
}

async function tabQb() {
  const html = await (await fetch(`${server.origin}/team/new-england-patriots/depth-chart/`)).text();
  const m = html.match(/(Committed New QB|Stale Pushed QB|Pushed On Top QB|Second Push QB|Second Snapshot QB)/);
  return m ? m[1] : "?";
}

async function push(d) {
  const res = await fetch(`${server.origin}/api/depth-charts/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Secret": SECRET },
    body: JSON.stringify(d),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}

async function row() {
  return (await client.query("SELECT doc FROM depth_charts WHERE season = $1", [SEASON])).rows[0]?.doc ?? null;
}

describe("depth charts startup restore", { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-depth-restore-"));
    file = path.join(dir, "depth-charts.json");
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    // The table exists once any server has started (lib/db-schema.ts).
    await client.query(
      "CREATE TABLE IF NOT EXISTS depth_charts (season integer PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now())",
    );
    await client.query("DELETE FROM depth_charts WHERE season = $1", [SEASON]);
  });

  after(async () => {
    await server?.stop();
    await client?.query("DELETE FROM depth_charts WHERE season = $1", [SEASON]).catch(() => {});
    await client?.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("an older stored push with a LATER fetchedAt does not replace a newer committed snapshot", async () => {
    // What a manual snapshot + publish ships, over a push stored weeks ago
    // whose fetch time is later (the old rule restored it).
    commit(doc(T1, "Committed New QB"));
    await client.query(
      "INSERT INTO depth_charts (season, doc, updated_at) VALUES ($1, $2, now() - interval '30 days')",
      [SEASON, JSON.stringify(doc(at(24), "Stale Pushed QB"))],
    );
    await boot();
    assert.equal(await tabQb(), "Committed New QB");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).fetchedAt, T1, "the file was not overwritten");
  });

  test("a push made on top of the snapshot on disk survives a publish of that same snapshot", async () => {
    const res = await push(doc(at(48), "Pushed On Top QB"));
    assert.equal(res.stored, true);
    const stored = await row();
    assert.ok(stored.basedOn, "the push records the publication it sits on");
    assert.equal(await tabQb(), "Pushed On Top QB");

    // A second push in the chain keeps the same root.
    await push(doc(at(72), "Second Push QB"));
    assert.equal((await row()).basedOn, stored.basedOn, "a chain of pushes names one root");

    // A publish ships the committed file again; the push is put back.
    commit(doc(T1, "Committed New QB"));
    await boot();
    assert.equal(await tabQb(), "Second Push QB");
  });

  test("a NEW committed snapshot wins over that push, even with an earlier fetchedAt", async () => {
    // Fetched before the stored push (at(72)), published after it.
    commit(doc(at(6), "Second Snapshot QB"));
    await boot();
    assert.equal(await tabQb(), "Second Snapshot QB");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).basedOn, undefined, "the committed file stays as shipped");
  });
});
