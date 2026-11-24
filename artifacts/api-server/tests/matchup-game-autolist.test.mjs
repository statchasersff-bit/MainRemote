/**
 * A game that turns final joins the game sitemap and the schedule's links on
 * the next slate refresh, with no URL added by hand (WEB-001, 2026-11-24).
 *
 * Exercises the refresh path the site runs: the nflverse slate (here read from
 * a copy of data/schedule/games.csv through SC_SCHEDULE_CSV_FILE, with the
 * slate cache shortened) is the only input that changes. Before: Bengals at
 * Commanders, Week 11 2026, with no score (the slate before the game ended).
 * After: the stored final, 22-20. The ESPN layer is off, so nothing else can
 * mark the game final.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const GAME_ID = "2026_11_CIN_WAS";
const PATH = "/nfl/cincinnati-bengals-vs-washington-commanders/2026-week-11/";
const STORED = fs.readFileSync(path.join(APP_DIR, "data", "schedule", "games.csv"), "utf8");

/** The stored slate with the game's score columns blanked, as before the final. */
function beforeFinal() {
  const lines = STORED.split("\n");
  const header = lines[0].split(",");
  const blank = ["away_score", "home_score", "result", "total", "overtime"].map((c) => header.indexOf(c));
  return lines
    .map((line) => {
      if (!line.startsWith(`${GAME_ID},`)) return line;
      const cells = line.split(",");
      for (const i of blank) cells[i] = "";
      return cells.join(",");
    })
    .join("\n");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-autolist-"));
const csv = path.join(dir, "games.csv");
let server;

before(async () => {
  assert.ok(STORED.includes(`${GAME_ID},2026,REG,11,`), "the stored slate has the game");
  fs.writeFileSync(csv, beforeFinal());
  server = await startServer({
    SC_SCHEDULE_CSV_FILE: csv,
    SC_SCHEDULE_ESPN: "0",
    SC_SCHEDULE_TEST_TIMING: JSON.stringify({ slateTtlMs: 100 }),
  });
});
after(async () => {
  await server?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const listed = async () => {
  const body = await (await fetch(`${server.origin}/embed/matchup-games.json`)).json();
  assert.equal(body.ok, true);
  return body.games.filter((g) => g.path === PATH);
};

test("not final: not in the game sitemap", async () => {
  assert.deepEqual(await listed(), []);
});

test("final on the next slate refresh: listed once, self-canonical, linked from the schedule week", async () => {
  fs.writeFileSync(csv, STORED);
  await new Promise((resolve) => setTimeout(resolve, 300));

  let rows = await listed();
  // A team schedule or page cache may still hold the earlier read for a moment.
  for (let i = 0; i < 20 && rows.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    rows = await listed();
  }
  assert.equal(rows.length, 1, "listed exactly once");
  assert.equal(rows[0].season, 2026);
  assert.equal(rows[0].week, 11);

  const page = await fetch(`${server.origin}${PATH}`, { redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(canon.length, 1, "one canonical");
  assert.ok(canon[0].endsWith(PATH), `${canon[0]} is the game's own address`);
  // Robots: the raw API page is noindex, indexifembedded by design; the
  // public page's robots are WordPress's (checked on a local WordPress).
  assert.match(html, /"eventStatus":"https:\/\/schema.org\/EventCompleted"/);

  const week = await (await fetch(`${server.origin}/schedule/week-11?season=2026`)).text();
  assert.ok(week.includes(`href="${PATH}"`) || week.includes(PATH), "the week's schedule links the game page");
});
