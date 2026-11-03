/**
 * A local stand-in for ESPN and Sleeper, serving responses recorded on
 * 2026-09-30 (tests/fixtures/team-upstream-2026-09-30.json.gz) for the ten
 * teams tests/team.test.mjs visits: NE, WAS, LV, CAR, PHI, BUF, DAL, BAL, CIN
 * and GB, plus the league standings table (recorded 2026-10-03).
 *
 * Point a server at it with `replay.env` (the SC_*_BASE overrides in
 * src/lib/team/upstream.ts). Anything not recorded answers 404, which the
 * pages treat as that upstream being down, and is listed in `replay.misses`.
 *
 * To re-record: run a server with a fetch wrapper that saves each ESPN and
 * Sleeper response under `/<espn-site|espn-web|espn-core|sleeper><path><query>`,
 * load those teams' pages and sections, and gzip the map.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "fixtures", "team-upstream-2026-09-30.json.gz");
const GAMES_FIXTURE = path.join(HERE, "..", "fixtures", "games-2026-10-20.csv.gz");
/**
 * ESPN's scoreboard for all 18 weeks of 2026, reduced to the fields the slate
 * reads (timeValid, neutralSite, venue, broadcasts, status, score) and made
 * consistent with the games fixture: weeks the 2026-10-20 snapshot had not
 * scored are "scheduled" with no score. Recorded 2026-11-03. It carries the
 * league's TBDs (Week 16's Saturday pool, all of Week 18) and the neutral
 * flags of the international games, which is what the schedule tests need.
 */
const SCOREBOARD_FIXTURE = path.join(HERE, "..", "fixtures", "espn-scoreboard-2026.json.gz");

/**
 * @param {{scoreboard?: boolean}} [options] `scoreboard: true` also replays
 *   ESPN's scoreboard and switches the slate's live layer on, with the layer
 *   file sent to a scratch directory so a run never reads or writes the
 *   repo's real one.
 */
export async function startUpstreamReplay(options = {}) {
  const recorded = JSON.parse(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString("utf8"));
  // The slate the team hubs read their schedules from since 2026-10-20 (they
  // used to ask ESPN per team): nflverse's games.csv as snapshotted that day.
  const gamesCsv = zlib.gunzipSync(fs.readFileSync(GAMES_FIXTURE)).toString("utf8");
  const scoreboard = options.scoreboard
    ? JSON.parse(zlib.gunzipSync(fs.readFileSync(SCOREBOARD_FIXTURE)).toString("utf8"))
    : null;
  const layerDir = options.scoreboard
    ? fs.mkdtempSync(path.join(os.tmpdir(), "sc-schedule-layer-"))
    : "";
  const misses = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/nflverse/games.csv") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      res.end(gamesCsv);
      return;
    }
    const week = scoreboard && /^\/espn-site\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?dates=2026&seasontype=2&week=(\d+)$/.exec(req.url ?? "");
    if (week) {
      const body = scoreboard[week[1]];
      if (body) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
    }
    const body = recorded[req.url];
    if (body === undefined) {
      misses.push(req.url);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"not recorded"}');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    env: {
      SC_ESPN_SITE_BASE: `${origin}/espn-site`,
      SC_ESPN_WEB_BASE: `${origin}/espn-web`,
      SC_ESPN_CORE_BASE: `${origin}/espn-core`,
      SC_SLEEPER_BASE: `${origin}/sleeper`,
      SC_SCHEDULE_CSV_URL: `${origin}/nflverse/games.csv`,
      // Without the scoreboard, no live layer: the fixture's scores are
      // nflverse's. With it, the layer reads the replay and keeps its file
      // in a scratch directory.
      SC_SCHEDULE_ESPN: scoreboard ? "1" : "0",
      ...(layerDir ? { SC_SCHEDULE_LAYER_DIR: layerDir } : {}),
    },
    misses,
    layerDir,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          if (layerDir) fs.rmSync(layerDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
