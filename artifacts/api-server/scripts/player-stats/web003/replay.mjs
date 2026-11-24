#!/usr/bin/env node
/**
 * WEB-003 replay: two controlled snapshots through every cache layer.
 *
 * Real: the API (this worktree's dist), WordPress + MariaDB with the plugin,
 * the publication check and warm-up run as WP-cron would run them (WP-CLI).
 * Modeled (bench-mu-plugin.php and the proxy below): WP Rocket's page files
 * and the Rocket.net edge, which keeps every 200 until purged ("observed"
 * production behavior: origin cache headers ignored, 30 days stamped).
 *
 * Snapshot A = the stats tables, dataset metadata and game logs as committed
 * at bdadaa4 (Week 11 Sunday rebuild: Weeks 1-10, MNF CIN at WAS missing).
 * Snapshot B = 7a65a44 (Monday-night rebuild: Weeks 1-11). The files are
 * swapped the way buildSeason.mjs writes them (tmp + rename) and restored
 * from git at the end.
 *
 *   SC_WP_DIR=<dir holding ./wordpress, ./router.php, ./wp-cli.phar> SC_PHP=<php> node replay.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..", "..");
const REPO = path.resolve(APP, "..", "..");
const { startServer } = await import(path.join(APP, "tests", "helpers", "server.mjs"));
const WP_DIR = process.env.SC_WP_DIR;
const PHP = process.env.SC_PHP || "php";
const WP_PORT = 18092;
const EDGE_PORT = 18093;
const ROUTES = { qb: "/nfl/nfl-player-stats/", rb: "/nfl/nfl-player-stats/rb/", wr: "/nfl/nfl-player-stats/wr/", te: "/nfl/nfl-player-stats/te/" };
// One player per position who played in the Monday night game (WEB-032).
const WATCH = { qb: "Joe Burrow", rb: "Chase Brown", wr: "Ja&#39;Marr Chase", te: "Zach Ertz" };
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36";
const FILES = [
  ...["qb", "rb", "wr", "te"].map((p) => `artifacts/api-server/data/player-stats/${p}_2026.json`),
  "artifacts/api-server/data/dataset-meta.json",
  "artifacts/api-server/data/player/game_logs/2026.json",
];
const { readStats } = await import(path.join(HERE, "parse.mjs"));

const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const T0 = Date.now();

function snapshot(commit) {
  for (const f of FILES) {
    const body = execFileSync("git", ["-C", REPO, "show", `${commit}:${f}`], { maxBuffer: 1 << 30 });
    const dest = path.join(REPO, f);
    fs.writeFileSync(`${dest}.tmp`, body);
    fs.renameSync(`${dest}.tmp`, dest);
  }
}
function restore() {
  execFileSync("git", ["-C", REPO, "checkout", "HEAD", "--", ...FILES]);
}

/* ------------------------------------------------------------ edge model */
const edge = new Map();
const edgeServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__purge") {
    let body = "";
    req.on("data", (d) => (body += d)).on("end", () => {
      const { files } = JSON.parse(body);
      let n = 0;
      for (const key of [...edge.keys()]) if (files.includes(key.split(" ")[1])) { edge.delete(key); n++; }
      log(`EDGE purge: ${files.length} paths asked, ${n} entries dropped`);
      res.setHeader("content-type", "application/json").end(JSON.stringify({ success: true }));
    });
    return;
  }
  const device = /iPhone|Android|Mobile/i.test(req.headers["user-agent"] ?? "") ? "m" : "d";
  const key = `${device} ${req.url}`;
  const hit = edge.get(key);
  if (hit) {
    res.writeHead(hit.status, { ...hit.headers, "cf-cache-status": "HIT", age: String(Math.round((Date.now() - hit.at) / 1000)) });
    res.end(hit.body);
    return;
  }
  const up = http.request({ host: "127.0.0.1", port: WP_PORT, path: req.url, method: req.method, headers: { ...req.headers, connection: "close" } }, (r) => {
    const chunks = [];
    r.on("data", (c) => chunks.push(c)).on("end", () => {
      const body = Buffer.concat(chunks);
      const headers = { ...r.headers };
      delete headers["transfer-encoding"];
      delete headers["connection"];
      const origin = { cc: headers["cache-control"], cfcc: headers["cloudflare-cdn-cache-control"], sc: headers["x-sc-stats-cache"] };
      // Production today: the platform drops the origin's lifetime and stamps 30 days on a 200.
      headers["cache-control"] = "public, max-age=0, s-maxage=2592000";
      if (r.statusCode === 200 || r.statusCode === 301) edge.set(key, { status: r.statusCode, headers, body, at: Date.now(), origin });
      res.writeHead(r.statusCode, { ...headers, "cf-cache-status": "MISS" });
      res.end(body);
    });
  });
  up.on("error", (e) => { res.writeHead(502).end(String(e)); });
  req.pipe(up);
});

function get(url, ua = DESKTOP, host = `127.0.0.1:${EDGE_PORT}`) {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const u = new URL(url);
    http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { "user-agent": ua, host, connection: "close" } }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d)).on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: b, ms: Date.now() - t }));
    }).on("error", reject);
  });
}

async function table(label, base, ua = DESKTOP, query = "") {
  for (const [pos, route] of Object.entries(ROUTES)) {
    const r = await get(`${base}${route}${query}`, ua);
    const s = readStats(r.body, WATCH[pos]);
    if (process.env.SC_DUMP && !s.rows) fs.writeFileSync(`/tmp/claude-1000/sa/dump-${pos}.html`, r.body);
    log(
      `${label.padEnd(16)} ${pos} ${String(r.status)} ${(r.headers["cf-cache-status"] ?? "origin").padEnd(6)} ${r.headers["x-bench-rocket"] ? "rocket-file " : "wp-render   "}` +
        `${String(r.ms).padStart(5)}ms  Weeks ${s.weeks}  Updated ${s.updated}  ${WATCH[pos].replace("&#39;", "'")}: G ${s.player?.games ?? "-"} FPTS ${s.player?.fpts ?? "-"}  rows ${s.rows}`,
    );
  }
}

// Asynchronous: the edge model lives in this process and has to answer the
// purge and the warm-up while WP-CLI waits on them.
async function wp(...args) {
  const { stdout } = await execFileAsync(PHP, [path.join(WP_DIR, "wp-cli.phar"), `--path=${path.join(WP_DIR, "wordpress")}`, ...args], { env: { ...process.env }, maxBuffer: 1 << 26 });
  return stdout.trim();
}
// The game-window refresh would rewrite tracked data mid-replay.
const API_ENV = { NODE_ENV: "production", SC_PLAYER_LIVE_REFRESH: "0" };

// php -S forks PHP_CLI_SERVER_WORKERS children that outlive a plain kill of
// the parent; it runs in its own process group so the whole group goes.
function stopWp() {
  if (!wpProc) return;
  try { process.kill(-wpProc.pid, "SIGTERM"); } catch {}
  wpProc = null;
}
async function restartWp() {
  stopWp();
  await new Promise((r) => setTimeout(r, 500));
  wpProc = spawn(PHP, ["-S", `127.0.0.1:${WP_PORT}`, "-t", path.join(WP_DIR, "wordpress"), path.join(WP_DIR, "router.php")], {
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: "8" },
    stdio: "ignore",
    detached: true,
  });
  await new Promise((r) => setTimeout(r, 1500));
}

/* ----------------------------------------------------------------- run */
let api, wpProc;
try {
  snapshot("bdadaa4");
  api = await startServer(API_ENV);
  process.env.SC_ORIGIN = api.origin;
  process.env.SC_BENCH_EDGE_PURGE = `http://127.0.0.1:${EDGE_PORT}/__purge`;
  log(`API ${api.origin}; snapshot A (bdadaa4) on disk`);
  await new Promise((r) => edgeServer.listen(EDGE_PORT, "127.0.0.1", r));
  await restartWp();

  // A clean start: no published version, no fragment copies, no page files.
  await wp("eval", "delete_option('statchasers_player_stats_published'); delete_option('bench_rocket_cleans'); delete_option('bench_fragment_fetches'); statchasers_player_stats_flush(true); array_map('unlink', glob(WP_CONTENT_DIR.'/cache/sc-bench/*') ?: array());");

  log("--- 1. snapshot A published (first check), then visitors fill every layer");
  log("check: " + await wp("eval", "echo wp_json_encode(statchasers_player_stats_publish_check());"));
  await table("public 1st", `http://127.0.0.1:${EDGE_PORT}`);
  await table("public repeat", `http://127.0.0.1:${EDGE_PORT}`);
  await table("public phone", `http://127.0.0.1:${EDGE_PORT}`, PHONE);

  log("    origin before: " + JSON.stringify(readStats((await get(`http://127.0.0.1:${WP_PORT}${ROUTES.wr}?zz=0`)).body, WATCH.wr)));
  log("--- 2. snapshot B lands (as on 11-24: rebuilt files, then a publish restarts the API)");
  snapshot("7a65a44");
  await api.stop();
  api = await startServer(API_ENV);
  process.env.SC_ORIGIN = api.origin;
  log(`API restarted at ${api.origin}`);
  await restartWp();
  await table("origin ?zz", `http://127.0.0.1:${WP_PORT}`, DESKTOP, "?zz=1");
  await table("public (stale)", `http://127.0.0.1:${EDGE_PORT}`);
  log("    ^ the 11-24 report: origin Weeks 1-11, public Weeks 1-10");

  log("--- 3. the publication check runs (WP-cron, every 5 min)");
  log("check: " + await wp("eval", "echo wp_json_encode(statchasers_player_stats_publish_check());"));
  log("rocket_clean_files calls: " + await wp("eval", "echo wp_json_encode(get_option('bench_rocket_cleans'));"));
  log("--- 4. the warm-up a minute later (scheduled single event), then visitors");
  log("warm: " + await wp("eval", "echo wp_json_encode(statchasers_player_stats_warm());"));
  await table("public", `http://127.0.0.1:${EDGE_PORT}`);
  await table("public repeat", `http://127.0.0.1:${EDGE_PORT}`);
  await table("public phone", `http://127.0.0.1:${EDGE_PORT}`, PHONE);
  const sample = [...edge.values()][0]?.origin;
  log(`origin cache headers on the stats pages: ${JSON.stringify(sample)}`);

  log("--- 5. a second check with nothing new: no purge");
  log("check: " + await wp("eval", "echo wp_json_encode(statchasers_player_stats_publish_check()['result']);"));

  log("--- 6. upstream failure: the API goes down; the next check keeps snapshot B");
  await api.stop();
  log("check: " + await wp("eval", "echo wp_json_encode(statchasers_player_stats_publish_check()['result']);"));
  await wp("eval", "statchasers_player_stats_flush(false);"); // fresh copies gone too: only the backups are left
  await table("origin, API down", `http://127.0.0.1:${WP_PORT}`, DESKTOP, "?zz=2");
  await table("public, API down", `http://127.0.0.1:${EDGE_PORT}`);

  log("--- 7. concurrent misses: 12 simultaneous origin renders of /wr/ with no fresh copy");
  api = await startServer(API_ENV);
  process.env.SC_ORIGIN = api.origin;
  await restartWp();
  // The cache key carries the API origin, and the bench API just came back on
  // a new port: one render first leaves the backup production would have.
  await get(`http://127.0.0.1:${WP_PORT}${ROUTES.wr}?zz=prime`);
  await wp("eval", "statchasers_player_stats_flush(false); delete_option('bench_fragment_fetches');");
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => get(`http://127.0.0.1:${WP_PORT}${ROUTES.wr}?zz=b${i}`)));
  log(`burst: statuses ${burst.map((r) => r.status).join(",")}; complete ${burst.filter((r) => readStats(r.body, WATCH.wr).rows === 214).length}/12; API fragment fetches by WordPress: ${await wp("option", "get", "bench_fragment_fetches")}`);
} finally {
  restore();
  stopWp();
  await api?.stop?.().catch(() => {});
  edgeServer.close();
  log("snapshot files restored from git");
}
process.exit(0);
