/**
 * A layer entry saved before kickoff must not hide a final the feed already
 * has. A week closes in the feed and the live layer never asks ESPN about it
 * again, so an entry stored as "pre" stays "pre" for good: on 2026-11-18 it
 * held DAL @ PHI Week 7 as an upcoming 0-0, and its dated page 404'd.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2024.csv"), "utf8");

let upstream;
let server;
let layerDir;
before(async () => {
  layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-layer-"));
  // BUF @ MIA, 2024 Week 2: 31-10 in the feed, never seen past kickoff here.
  fs.writeFileSync(
    path.join(layerDir, "espn-layer-2024.json"),
    JSON.stringify({
      401671807: {
        network: "Prime Video",
        state: "pre",
        completed: false,
        detail: "9/12 - 8:15 PM EDT",
        awayScore: 0,
        homeScore: 0,
      },
    }),
  );
  upstream = http.createServer((req, res) => {
    if (req.url === "/games.csv") {
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(CSV);
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
    SC_SCHEDULE_ESPN: "1",
    SC_SCHEDULE_LAYER_DIR: layerDir,
  });
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => upstream?.close(resolve));
  fs.rmSync(layerDir, { recursive: true, force: true });
});

test("a stale pre-kickoff layer entry keeps the feed's final score", async () => {
  const csv = await (await fetch(`${server.origin}/schedule/download.csv?week=2`)).text();
  const row = csv.split("\n").find((line) => /Buffalo|BUF/.test(line) && /Miami|MIA/.test(line));
  assert.ok(row, csv.slice(0, 400));
  assert.match(row, /\b31\b/, row);
  assert.match(row, /\b10\b/, row);
  assert.doesNotMatch(row, /\b0\s*-\s*0\b/, row);
});
