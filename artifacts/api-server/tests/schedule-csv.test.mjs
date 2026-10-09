/**
 * games.csv is one file holding every season, and the schedule caches each
 * season on its own. These pin the two things that follow from that:
 *
 *   - one download serves every season asked for close together, so a crawler
 *     walking ?season= does not fetch the whole file once per season;
 *   - an export is named after the season it holds. March to May the current
 *     season falls back to the one just played, and the file used to keep the
 *     name of the season that was asked for.
 *
 * The fixture is the real 2024 slate relabeled as last season, so the current
 * season has no rows and the fallback is what serves.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "schedule-2024.csv");

// The league year turns over on March 1 (seasonYear in lib/seo.ts).
const now = new Date();
const CURRENT = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const LAST = CURRENT - 1;

let feed;
let hits = 0;
let server;

before(async () => {
  const csv = fs
    .readFileSync(FIXTURE, "utf8")
    .replace(/^([^,\n]+),2024,/gm, `$1,${LAST},`);
  feed = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    res.end(csv);
  });
  await new Promise((resolve) => feed.listen(0, "127.0.0.1", resolve));
  server = await startServer({
    SC_SCHEDULE_CSV_URL: `http://127.0.0.1:${feed.address().port}/games.csv`,
    SC_SCHEDULE_ESPN: "0",
    // Unpinned, so the current season may fall back to the last one.
    SC_SCHEDULE_SEASON: "",
  });
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => feed?.close(resolve));
});

describe("games.csv", () => {
  test("one download serves several seasons", async () => {
    for (const season of [CURRENT, LAST, LAST - 1, LAST - 2]) {
      await fetch(`${server.origin}/schedule?season=${season}`);
    }
    assert.equal(hits, 1);
  });
});

describe("exports", () => {
  test("the CSV is named after the season it holds", async () => {
    const res = await fetch(`${server.origin}/schedule/download.csv`);
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("content-disposition"),
      new RegExp(`nfl-schedule-${LAST}-season\\.csv`),
    );
  });

  test("and so is the calendar", async () => {
    const res = await fetch(`${server.origin}/schedule/schedule.ics`);
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("content-disposition"),
      new RegExp(`nfl-schedule-${LAST}-season\\.ics`),
    );
  });
});
