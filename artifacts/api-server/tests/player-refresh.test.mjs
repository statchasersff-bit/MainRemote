/**
 * The after-game player stats refresh (src/lib/player/live-refresh.ts, refresh-schedule.ts).
 *
 * Two things are pinned here. The game-log builder, which now runs unattended,
 * must never lose a week because one request failed — it rebuilds the whole
 * season, and it used to write the file without any week Sleeper did not
 * answer. And the scheduling rule: when a refresh is due.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { APP_DIR } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const SEASON = 2031;
const BUILDER = path.join(APP_DIR, "scripts", "player", "buildGameLogs.js");

function run(env) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [BUILDER, String(SEASON)], { env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout),
    );
  });
}

describe("the game-log builder", () => {
  let dir;
  let stub;
  let failWeek = 0;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-gamelogs-"));
    fs.writeFileSync(
      path.join(dir, "players.json"),
      JSON.stringify([{ id: "1", name: "Test Back", position: "RB" }]),
    );
    // Weeks 1-3 have a game for player 1; the week named in failWeek answers 500.
    stub = http.createServer((req, res) => {
      const week = Number(req.url.split("?")[0].split("/").pop());
      if (week === failWeek) {
        res.writeHead(500);
        res.end();
        return;
      }
      const rows =
        week <= 3
          ? [{ player_id: "1", team: "ARI", opponent: "LAC", stats: { gp: 1, rush_yd: 10 * week, pts_ppr: week } }]
          : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows));
    });
    await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise((r) => stub.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const env = () => ({
    SC_PLAYER_DATA_DIR: dir,
    SC_SLEEPER_STATS_BASE: `http://127.0.0.1:${stub.address().port}`,
  });
  const weeksOnDisk = () =>
    JSON.parse(fs.readFileSync(path.join(dir, "game_logs", `${SEASON}.json`), "utf8"))["1"].map((r) => r.week);

  test("builds every week the API answers", async () => {
    failWeek = 0;
    await run(env());
    assert.deepEqual(weeksOnDisk(), [1, 2, 3]);
  });

  test("a week that fails keeps its rows from disk instead of vanishing", async () => {
    failWeek = 2;
    await run(env());
    assert.deepEqual(weeksOnDisk(), [1, 2, 3], "week 2 must survive its failed request");
  });
});

describe("when a refresh is due", () => {
  let mod;
  before(async () => {
    mod = await importModule("lib/player/refresh-schedule");
  });
  after(() => cleanupBundles());

  const H = 60 * 60 * 1000;
  // Thursday 1 Oct 2026, 8:15 PM ET kickoff = 00:15 UTC Friday.
  const thursdayKickoff = Date.UTC(2026, 9, 2, 0, 15);

  test("not before the game can be over", () => {
    assert.equal(mod.latestDueMs([thursdayKickoff], thursdayKickoff + 3 * H), 0);
  });

  test("four hours after kickoff", () => {
    assert.equal(mod.latestDueMs([thursdayKickoff], thursdayKickoff + 5 * H), thursdayKickoff + 4 * H);
  });

  test("and again at the morning-after catch-up", () => {
    const now = Date.UTC(2026, 9, 2, 14, 0);
    assert.equal(mod.latestDueMs([thursdayKickoff], now), Date.UTC(2026, 9, 2, 13, 0));
  });

  test("no catch-up once the last game is days old", () => {
    const now = Date.UTC(2026, 9, 9, 14, 0);
    assert.equal(mod.latestDueMs([thursdayKickoff], now), thursdayKickoff + 4 * H);
  });
});
