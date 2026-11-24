#!/usr/bin/env node
/**
 * WEB-040: walk one game from pregame to final through the public-page path
 * and record when a visitor sees each transition.
 *
 *   SC_WP_DIR=/path/to/env SC_PHP=/path/to/php node scripts/schedule/web040-cache-replay.mjs
 *
 * SC_WP_DIR holds a throwaway WordPress at ./wordpress (plugin active, a page
 * at /nfl/nfl-schedule/ carrying [statchasers_schedule], pretty permalinks,
 * STATCHASERS_NEWS_ORIGIN read from $SC_ORIGIN) and ./router.php for php -S.
 * Build the app first (node build.mjs).
 *
 * What is real and what is a model:
 *   REAL   nflverse + ESPN as local fakes the script changes mid-run; the app
 *          (live layer, fragment cache, ETag, cache-policy headers); WordPress
 *          with the plugin: transients in MariaDB, template_redirect, the
 *          shortcode, the headers it sends.
 *   MODEL  WP Rocket's page cache: stores a page unless the response says
 *          `page-cache=skip` (the plugin's X-SC-Schedule-Cache, sent exactly
 *          when it defines DONOTCACHEPAGE), 24 h lifespan as configured live.
 *   MODEL  the edge, two ways at once:
 *          "observed" - what production does today: origin Cache-Control and
 *          Expires are dropped and s-maxage=2592000 stamped on every 200, so
 *          the TTL is 30 days whatever the page says;
 *          "honoring" - the host passes Cloudflare-CDN-Cache-Control through
 *          and Cloudflare obeys it (the route-scoped change asked for in
 *          docs/WEB-040-SCHEDULE-STATUS.md).
 * The clocks are shortened through SC_SCHEDULE_TEST_TIMING (app) only; the
 * edge and WP Rocket models run on real seconds, so the pregame and live
 * lifetimes the plugin picks are exercised as they would be in production.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");
const { startServer } = await import(path.join(APP, "tests", "helpers", "server.mjs"));

const WP_DIR = process.env.SC_WP_DIR;
const PHP = process.env.SC_PHP || "php";
if (!WP_DIR || !fs.existsSync(path.join(WP_DIR, "router.php"))) {
  console.error("SC_WP_DIR must hold ./wordpress and ./router.php");
  process.exit(2);
}
const WP_PORT = 18082;
const LEAD_S = Number(process.env.SC_LEAD_S || 45); // warm this long before kickoff

/* ---------------------------------------------------------- the sources */

const IND_HOU = "401873066";
const t0 = Date.now();
const kickoffMs = Math.ceil((t0 + LEAD_S * 1000) / 1000) * 1000;
const eastern = (ms, opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ...opts }).format(new Date(ms));
const etDate = (ms) => eastern(ms, {});
const etTime = (ms) => eastern(ms, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function slate({ final }) {
  const text = fs.readFileSync(path.join(APP, "tests", "fixtures", "schedule-2026-week11.csv"), "utf8");
  const [header, ...rows] = text.trim().split("\n");
  const cols = header.split(",");
  const at = (n) => cols.indexOf(n);
  const out = rows.map((line) => {
    const c = line.split(",");
    if (c[at("game_id")] === "2026_11_IND_HOU") {
      c[at("gameday")] = etDate(kickoffMs);
      c[at("gametime")] = etTime(kickoffMs);
      c[at("away_score")] = final ? "3" : "";
      c[at("home_score")] = final ? "26" : "";
    } else if (c[at("game_id")] === "2026_11_CIN_WAS") {
      c[at("away_score")] = "20";
      c[at("home_score")] = "17";
    }
    return c.join(",");
  });
  const w12 = rows[0].split(",");
  w12[at("game_id")] = "2026_12_HOU_IND";
  w12[at("week")] = "12";
  w12[at("gameday")] = etDate(t0 + 3 * 86400_000);
  w12[at("gametime")] = "13:00";
  w12[at("away_team")] = "HOU";
  w12[at("home_team")] = "IND";
  w12[at("away_score")] = "";
  w12[at("home_score")] = "";
  w12[at("espn")] = "409990012";
  return [header, ...out, w12.join(",")].join("\n") + "\n";
}

function event(state, shortDetail, period, clock, away, home) {
  return {
    id: IND_HOU,
    date: new Date(kickoffMs).toISOString(),
    status: { period, clock, type: { name: state === "pre" ? "STATUS_SCHEDULED" : "STATUS_IN_PROGRESS", state, completed: false, shortDetail } },
    competitions: [{ timeValid: true, competitors: [{ homeAway: "home", score: String(home) }, { homeAway: "away", score: String(away) }], broadcasts: [{ names: ["Prime Video"] }] }],
  };
}

const source = { csv: slate({ final: false }), events: [event("pre", "Pregame", 0, 0, 0, 0)], refuse: false };
const upstream = http.createServer((req, res) => {
  if (req.url === "/games.csv") return res.end(source.csv);
  if (req.url.startsWith("/espn/apis/site/v2/sports/football/nfl/scoreboard")) {
    if (source.refuse) {
      res.writeHead(403);
      return res.end();
    }
    const week = new URL(req.url, "http://x").searchParams.get("week");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ events: week === "11" ? source.events : [] }));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const up = `http://127.0.0.1:${upstream.address().port}`;

const layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "web040-replay-"));
const app = await startServer({
  SC_SCHEDULE_CSV_URL: `${up}/games.csv`,
  SC_SCHEDULE_SEASON: "2026",
  SC_ESPN_SITE_BASE: `${up}/espn`,
  SC_SCHEDULE_ESPN: "1",
  SC_SCHEDULE_LAYER_DIR: layerDir,
  SC_SCHEDULE_TEST_TIMING: JSON.stringify({ liveTtlMs: 1000, idleTtlMs: 2000, staleMs: 8000, slateTtlMs: 2000 }),
});

/* ------------------------------------------------------------ WordPress */

const wp = spawn(PHP, ["-S", `127.0.0.1:${WP_PORT}`, "-t", path.join(WP_DIR, "wordpress"), path.join(WP_DIR, "router.php")], {
  cwd: WP_DIR,
  env: { ...process.env, SC_ORIGIN: app.origin, PHP_CLI_SERVER_WORKERS: "4" },
  stdio: "ignore",
});
const cleanup = () => {
  try {
    wp.kill();
  } catch {}
};
process.on("exit", cleanup);
process.on("uncaughtException", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
for (let i = 0; i < 50; i++) {
  try {
    await origin("/");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

/* --------------------------------------------- page cache + edge models */

// node:http rather than fetch: php -S closes its connections in a way
// undici's parser asserts on.
function origin(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: WP_PORT, path: p, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}

function rocketModel() {
  const files = new Map();
  return async (p, now) => {
    const f = files.get(p);
    if (f && now - f.at < 24 * 3600_000) return { ...f.res, rocket: "HIT" };
    const res = await origin(p);
    const skip = /page-cache=skip/.test(res.headers["x-sc-schedule-cache"] ?? "");
    if (!skip && res.status === 200) files.set(p, { at: now, res });
    return { ...res, rocket: skip ? "SKIP" : "MISS" };
  };
}

function edgeModel(mode) {
  const rocket = rocketModel();
  const entries = new Map();
  return async (p) => {
    const now = Date.now();
    const e = entries.get(p);
    if (e && now < e.expires) return { ...e.res, edge: "HIT", age: Math.round((now - e.at) / 1000) };
    const res = await rocket(p, now);
    let ttl = 2592000;
    if (mode === "honoring") {
      const m = /max-age=(\d+)/.exec(res.headers["cloudflare-cdn-cache-control"] ?? "");
      if (m) ttl = Number(m[1]);
    }
    if (res.status === 200) entries.set(p, { at: now, expires: now + ttl * 1000, res, ttl });
    return { ...res, edge: e ? "EXPIRED" : "MISS", age: 0, ttl };
  };
}

const edges = { honoring: edgeModel("honoring"), observed: edgeModel("observed") };
const URLS = { hub: "/nfl/nfl-schedule/", week: "/nfl/nfl-schedule/week-11/" };

/* --------------------------------------------------------- the timeline */

const rel = (ms = Date.now()) => `${((ms - kickoffMs) / 1000).toFixed(0).padStart(4)}s`;
const log = [];
const note = (line) => {
  log.push(`${rel()}  ${line}`);
  console.log(`${rel()}  ${line}`);
};

function seen(body) {
  const at = body.indexOf('id="scs-game-2026_11_IND_HOU"');
  if (at < 0) return body.includes("scs-matrix") ? "(grid)" : "(no board)";
  const row = body.slice(at, body.indexOf("</article>", at));
  const m = row.match(/<span class="scs-game-status"[^>]*>(.*?)<\/span><\/div>/);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "(?)";
}

const last = {};
async function visit(tag) {
  for (const [mode, edge] of Object.entries(edges)) {
    for (const [name, p] of Object.entries(URLS)) {
      const r = await edge(p);
      const words = name === "week" ? seen(r.body) : seen(r.body);
      const policy = r.headers["x-sc-schedule-cache"] ?? "-";
      const key = `${mode}/${name}`;
      const sig = `${words} | ${policy}`;
      if (last[key] !== sig || tag) {
        note(`${key.padEnd(17)} sees ${words.padEnd(16)} edge=${r.edge}${r.edge === "HIT" ? ` age=${r.age}s` : ` ttl=${r.ttl}s`} rocket=${r.rocket ?? "-"} origin-policy: ${policy}`);
        last[key] = sig;
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function at(sFromKickoff) {
  while (Date.now() < kickoffMs + sFromKickoff * 1000) {
    await visit(false);
    await sleep(2000);
  }
}

note(`kickoff at ${new Date(kickoffMs).toISOString()} (${etTime(kickoffMs)} ET); warming hub + week page`);
await visit(true);

await at(5);
source.events = [event("in", "14:55 - 1st", 1, 895, 0, 0)];
note("SOURCE: ESPN reads IND @ HOU in progress, 14:55 - 1st");

await at(75);
source.events = [event("in", "12:04 - 4th", 4, 724, 3, 26)];
note("SOURCE: ESPN reads 12:04 - 4th, 3-26");

await at(145);
source.refuse = true;
source.csv = slate({ final: true });
note("SOURCE: ESPN stops answering (last read 12:04 - 4th); nflverse posts the final 3-26");

const until = kickoffMs + (145 + 200) * 1000;
while (Date.now() < until) {
  await visit(false);
  const done =
    /FINAL/.test(last["honoring/week"] ?? "") &&
    /settled/.test(last["honoring/week"] ?? "") &&
    /pregame/.test(last["honoring/hub"] ?? "");
  if (done) break;
  await sleep(2000);
}
await visit(true);

fs.writeFileSync(path.join(os.tmpdir(), "web040-cache-replay.log"), log.join("\n") + "\n");
wp.kill();
await app.stop();
upstream.close();
fs.rmSync(layerDir, { recursive: true, force: true });
console.log(`\n(timeline also written to ${path.join(os.tmpdir(), "web040-cache-replay.log")})`);
