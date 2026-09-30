/**
 * A local stand-in for ESPN and Sleeper, serving responses recorded on
 * 2026-09-30 (tests/fixtures/team-upstream-2026-09-30.json.gz) for the ten
 * teams tests/team.test.mjs visits: NE, WAS, LV, CAR, PHI, BUF, DAL, BAL, CIN
 * and GB.
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
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "fixtures", "team-upstream-2026-09-30.json.gz");

export async function startUpstreamReplay() {
  const recorded = JSON.parse(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString("utf8"));
  const misses = [];
  const server = http.createServer((req, res) => {
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
    },
    misses,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
