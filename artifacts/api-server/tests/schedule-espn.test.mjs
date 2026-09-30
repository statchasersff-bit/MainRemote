/**
 * The schedule's live layer: ESPN's scoreboard, read by readEspnEvent for the
 * TV networks and the scores. schedule.test.mjs switches ESPN off so it never
 * waits on a third party, which left this parser with no test at all. Here it
 * reads a real scoreboard (2024 week 1, recorded 2026-09-30) from a local
 * replay, against the same 2024 slate the other schedule tests use.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2024.csv"), "utf8");
const SCOREBOARD = fs.readFileSync(path.join(HERE, "fixtures", "espn-scoreboard-2024-w1.json"), "utf8");
const WEEK_1 = "/espn/apis/site/v2/sports/football/nfl/scoreboard?dates=2024&seasontype=2&week=1";

let upstream;
let server;
before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === "/games.csv") {
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(CSV);
    } else if (req.url === WEEK_1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(SCOREBOARD);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  server = await startServer({
    SC_SCHEDULE_CSV_URL: `${origin}/games.csv`,
    SC_SCHEDULE_SEASON: "2024",
    SC_ESPN_SITE_BASE: `${origin}/espn`,
  });
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => upstream?.close(resolve));
});

async function week(n) {
  const html = await (await fetch(`${server.origin}/schedule/week-${n}`)).text();
  return new JSDOM(html).window.document;
}

test("the scoreboard's networks reach the board", async () => {
  const doc = await week(1);
  const networks = [...doc.querySelectorAll(".scs-tv[title]")].map((el) => el.getAttribute("title"));
  assert.equal(doc.querySelectorAll(".scs-tv-tbd").length, 0, "no game left TBD");
  // The opener, Ravens at Chiefs, on NBC and Peacock.
  assert.ok(networks.some((n) => /NBC/.test(n) && /Peacock/.test(n)), networks.join(" | "));
});

test("a week the scoreboard does not answer for falls back to TBD, not an error", async () => {
  const doc = await week(2);
  assert.ok(doc.querySelectorAll(".scs-tv-tbd").length > 0);
});
