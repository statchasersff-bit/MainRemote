#!/usr/bin/env node
/**
 * WEB-003 depth-chart replay: two recognizable snapshots through every cache
 * layer, for the league page and one club's Depth Chart tab
 * (docs/WEB-003-DEPTH-CHARTS-CACHE.md).
 *
 * Real: the API (this worktree's dist) behind a stable origin address, its
 * render cache and the new version endpoint, behind the embed key;
 * WordPress + MariaDB with the plugin: the league refresh
 * (SCDC_Refresh::run_and_store through the scdc_cron_refresh hook, writing
 * the uploads JSON and the meta), `scdc_published`, the team fragment
 * transients, the team-tab publication check and the warm-ups, each run as
 * WP-cron runs it (do_action through WP-CLI).
 *
 * Modeled: WP Rocket's page files and Rocket.net's purge API
 * (scripts/player-stats/web003/bench-mu-plugin.php), the Rocket.net edge
 * (below: keeps every 200 for desktop and phone separately until purged,
 * with origin cache headers ignored, as production does today), and the
 * league sources (bench-sources.php: the captured ESPN Bills chart with a
 * marker QB1, everything else offline).
 *
 * Snapshots. League page: QB1 "Hub Alpha QB" (A), then "Hub Bravo QB" (B);
 * a control publication between them ("Hub Control QB") runs with the new
 * hook removed, to show what the old plugin left at the edge. Team tab: the
 * committed snapshot (A, QB1 Josh Allen), then the same document with the
 * Bills' QB1 renamed "Snapshot Bravo QB" (B), swapped in (tmp + rename) on a
 * scratch path and followed by an API restart, as a Replit publish is.
 *
 *   SC_WP_DIR=<dir holding ./wordpress, ./router.php, ./wp-cli.phar> SC_PHP=<php> node replay.mjs
 *
 * Ports 18100 (WordPress), 18101 (edge = WP_HOME), 18102 (API origin).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..", "..");
const REPO = path.resolve(APP, "..", "..");
const { startServer } = await import(path.join(APP, "tests", "helpers", "server.mjs"));
const { startUpstreamReplay } = await import(path.join(APP, "tests", "helpers", "upstream-replay.mjs"));
const WP_DIR = process.env.SC_WP_DIR;
const PHP = process.env.SC_PHP || "php";
const WP_PORT = 18100;
const EDGE_PORT = 18101;
const ORIGIN_PORT = 18102;
const KEY = "bench-embed-key";
const HUB = "/nfl/nfl-depth-charts/";
const TEAM = "/nfl/teams/buffalo-bills/depth-chart/";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36";
const SNAPSHOT = path.join(APP, "data", "depth-charts", "statchasers", "depth-charts.json");
const ESPN_BUF = path.join(REPO, "wordpress-plugin", "tests", "depth-charts", "fixtures", "sources", "espn-buf.json");
const TEAM_B = "Snapshot Bravo QB";

const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ edge model */
const edge = new Map();
const edgeServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__purge") {
    let body = "";
    req.on("data", (d) => (body += d)).on("end", () => {
      const { files } = JSON.parse(body);
      let n = 0;
      for (const key of [...edge.keys()]) if (files.includes(key.split(" ")[1])) { edge.delete(key); n++; }
      log(`EDGE purge: ${files.join(" ")} -> ${n} entries dropped`);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true }));
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
      const origin = { cc: headers["cache-control"], cdncc: headers["cdn-cache-control"], cfcc: headers["cloudflare-cdn-cache-control"], sc: headers["x-sc-depth-cache"] };
      // Production today: the platform drops the origin's lifetime and stamps 30 days on a 200.
      headers["cache-control"] = "public, max-age=0, s-maxage=2592000";
      if (r.statusCode === 200 || r.statusCode === 301) edge.set(key, { status: r.statusCode, headers, body, at: Date.now(), origin });
      res.writeHead(r.statusCode, { ...headers, "cf-cache-status": "MISS" });
      res.end(body);
    });
  });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
});

/* --------------------------------------- the API at one stable address */
let api;
const originServer = http.createServer((req, res) => {
  if (!api) { res.writeHead(502); res.end("API down"); return; }
  const u = new URL(api.origin);
  const up = http.request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: { ...req.headers, host: u.host, connection: "close" } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end("API down"); });
  req.pipe(up);
});

function get(pathname, ua = DESKTOP, port = EDGE_PORT, extra = {}) {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    http.get({ host: "127.0.0.1", port, path: pathname, headers: { "user-agent": ua, host: `127.0.0.1:${EDGE_PORT}`, connection: "close", ...extra } }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d)).on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: b, ms: Date.now() - t }));
    }).on("error", reject);
  });
}

/** League page: the ?v= the HTML names, and the Bills' QB1 in the JSON it points at (fetched through the edge too). */
async function readHub(r, ua) {
  const endpoint = (r.body.match(/data-endpoint="([^"]+)"/) ?? [])[1]?.replace(/&amp;/g, "&") ?? "";
  const updated = (r.body.match(/data-last-updated="([^"]*)"/) ?? [])[1] ?? "-";
  if (!endpoint) return { v: "-", qb1: "-", updated, json: "-" };
  const u = new URL(endpoint);
  const j = await get(u.pathname + u.search, ua);
  let qb1 = "-";
  try {
    const doc = JSON.parse(j.body);
    qb1 = doc.teams.find((t) => t.team.abbr === "BUF")?.positions?.QB?.[0]?.name ?? "-";
  } catch { /* not JSON */ }
  return { v: u.searchParams.get("v"), qb1, updated, json: j.headers["cf-cache-status"] ?? "origin" };
}

/** Team tab: whose name opens the Bills' QB row. */
function readTeam(r) {
  const row = r.body.match(/data-pos="QB"[\s\S]{0,4000}?<\/li>/);
  const qb1 = row ? (row[0].includes(TEAM_B) ? TEAM_B : row[0].includes("Josh Allen") ? "Josh Allen" : "?") : "-";
  return { qb1, bravoAnywhere: r.body.includes(TEAM_B) };
}

const results = [];
async function show(label, which, ua = DESKTOP, query = "", port = EDGE_PORT) {
  const route = which === "hub" ? HUB : TEAM;
  const r = await get(route + query, ua, port);
  const device = ua === PHONE ? "phone" : "desktop";
  const layer = `${(r.headers["cf-cache-status"] ?? "origin").padEnd(6)} ${r.headers["x-bench-rocket"] ? "rocket-file" : "wp-render  "}`;
  if (which === "hub") {
    const h = await readHub(r, ua);
    log(`${label.padEnd(22)} hub  ${device.padEnd(7)} ${r.status} ${layer} ${String(r.ms).padStart(5)}ms  ?v=${h.v}  JSON ${h.json.padEnd(6)} BUF QB1: ${h.qb1}  (Updated ${h.updated})`);
    results.push({ label, which, device, cf: r.headers["cf-cache-status"] ?? "origin", qb1: h.qb1, v: h.v });
    return h;
  }
  const t = readTeam(r);
  log(`${label.padEnd(22)} team ${device.padEnd(7)} ${r.status} ${layer} ${String(r.ms).padStart(5)}ms  BUF QB1: ${t.qb1}`);
  results.push({ label, which, device, cf: r.headers["cf-cache-status"] ?? "origin", qb1: t.qb1 });
  return t;
}

async function wp(...args) {
  const { stdout } = await execFileAsync(PHP, [path.join(WP_DIR, "wp-cli.phar"), `--path=${path.join(WP_DIR, "wordpress")}`, ...args], { env: { ...process.env }, maxBuffer: 1 << 26 });
  return stdout.trim();
}
const evalJson = (php) => wp("eval", php);

// php -S forks PHP_CLI_SERVER_WORKERS children that outlive a plain kill of
// the parent; it runs in its own process group so the whole group goes.
let wpProc;
function stopWp() {
  if (!wpProc) return;
  try { process.kill(-wpProc.pid, "SIGTERM"); } catch {}
  wpProc = null;
}
async function startWp() {
  wpProc = spawn(PHP, ["-S", `127.0.0.1:${WP_PORT}`, "-t", path.join(WP_DIR, "wordpress"), path.join(WP_DIR, "router.php")], {
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: "4" },
    stdio: "ignore",
    detached: true,
  });
  await sleep(1500);
}

let scratch;
let upstream;
const API_ENV = () => ({ ...upstream.env, NODE_ENV: "production", SC_PLAYER_LIVE_REFRESH: "0", SC_DEPTH_CHARTS_FILE: path.join(scratch, "depth-charts.json"), SC_EMBED_KEY: KEY });

function writeSnapshot(doc) {
  const file = path.join(scratch, "depth-charts.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${file}.tmp`, file);
}
function snapshotB() {
  const doc = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const buf = doc.teams.find((t) => t.team.abbr === "BUF");
  buf.positions.QB[0].name = TEAM_B;
  for (const slot of buf.slots ?? []) if (slot.slot === "QB" && slot.players[0]) slot.players[0].name = TEAM_B;
  return doc;
}

async function both(label, which) {
  await show(`${label}`, which, DESKTOP);
  await show(`${label}`, which, PHONE);
}

/* ----------------------------------------------------------------- run */
try {
  if (!WP_DIR) throw new Error("SC_WP_DIR is not set");
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sc-dc-web003-"));
  fs.copyFileSync(SNAPSHOT, path.join(scratch, "depth-charts.json"));
  upstream = await startUpstreamReplay();
  api = await startServer(API_ENV());
  process.env.SC_ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
  process.env.SC_BENCH_EDGE_PURGE = `http://127.0.0.1:${EDGE_PORT}/__purge`;
  process.env.SC_BENCH_EMBED_KEY = KEY;
  process.env.SC_BENCH_ESPN_BUF = ESPN_BUF;
  await new Promise((r) => edgeServer.listen(EDGE_PORT, "127.0.0.1", r));
  await new Promise((r) => originServer.listen(ORIGIN_PORT, "127.0.0.1", r));
  await startWp();
  log(`API ${api.origin} behind ${process.env.SC_ORIGIN} (embed key on); team snapshot A (committed) on a scratch path`);
  const locked = await get("/embed/depth-charts/version", DESKTOP, ORIGIN_PORT);
  log(`version endpoint without the key: ${locked.status}`);

  // A clean start: nothing published, no copies, no page files, no league file.
  await wp("eval", [
    "delete_option('statchasers_depth_charts_team_published'); delete_option('statchasers_depth_charts_hub_published');",
    "delete_option('bench_rocket_cleans'); delete_option(SCDC_META_OPTION); delete_option('scdc_refresh_lock');",
    "statchasers_team_flush(true);",
    "array_map('unlink', glob(WP_CONTENT_DIR.'/cache/sc-bench/*') ?: array());",
    "array_map('unlink', glob(SCDC_Store::dir_path().'/*.json') ?: array());",
  ].join(" "));

  log("--- 1. snapshot A published on both surfaces, then visitors fill every layer");
  await wp("option", "update", "dc_bench_qb1", "Hub Alpha QB");
  await wp("eval", "do_action( SCDC_Refresh::CRON_HOOK );");
  log("league refresh: " + await evalJson("echo wp_json_encode(array_intersect_key(SCDC_Store::get_meta(), array_flip(array('status','last_refreshed_ts','teams_ok')))) . ' hub record: ' . wp_json_encode(array_intersect_key(get_option('statchasers_depth_charts_hub_published'), array_flip(array('version','edge','wp_rocket')))) ;"));
  log("team check: " + await evalJson("$r = statchasers_depth_charts_publish_check(); echo $r['result'], ' (', count($r['changed'] ?? array()), ' clubs, edge ', $r['edge'] ?? '-', ')';"));
  await wp("eval", "do_action('statchasers_depth_charts_hub_warm'); do_action('statchasers_depth_charts_team_warm');");
  log("warm-ups ran (desktop + phone)");
  await both("public A", "hub");
  await both("public A repeat", "hub");
  await both("public A", "team");
  await both("public A repeat", "team");

  log("--- 2. control: a league publication with the new hook removed (the old plugin)");
  await sleep(1100);
  await wp("option", "update", "dc_bench_qb1", "Hub Control QB");
  await wp("eval", "remove_action('scdc_published', 'statchasers_depth_charts_on_published', 10); do_action( SCDC_Refresh::CRON_HOOK );");
  await show("WP origin ?zz", "hub", DESKTOP, "?zz=1", WP_PORT);
  await both("public (old plugin)", "hub");
  log("    ^ the audit's finding: WordPress has the new ?v=, the edge keeps the old page");

  log("--- 3. snapshot B, league page: the normal path (scdc_cron_refresh -> store() -> scdc_published)");
  await sleep(1100);
  await wp("option", "update", "dc_bench_qb1", "Hub Bravo QB");
  await wp("eval", "do_action( SCDC_Refresh::CRON_HOOK );");
  log("hub record: " + await evalJson("echo wp_json_encode(array_intersect_key(get_option('statchasers_depth_charts_hub_published'), array_flip(array('version','previous','edge','wp_rocket','paths'))));"));
  await both("public B, pre-warm", "hub");
  await wp("eval", "do_action('statchasers_depth_charts_hub_warm');");
  log("hub warm: " + await evalJson("echo wp_json_encode(get_option('statchasers_depth_charts_hub_published')['warm']);"));

  log("--- 4. snapshot B, team tab: the file swapped, the API restarted (a Replit publish)");
  writeSnapshot(snapshotB());
  await api.stop();
  api = await startServer(API_ENV());
  log(`API restarted at ${api.origin}`);
  const direct = await get("/embed/team/buffalo-bills?section=depth-chart", DESKTOP, ORIGIN_PORT, { "x-statchasers-key": KEY });
  log(`API fragment          team         ${direct.status} X-SC-Depth-Version ${direct.headers["x-sc-depth-version"]}  BUF QB1: ${readTeam(direct).qb1}`);
  await show("WP origin ?zz", "team", DESKTOP, "?zz=2", WP_PORT);
  log("    ^ the API serves B at once; WordPress still prints its 5-minute fragment copy of A");
  await both("public (stale)", "team");
  log("    ^ before the check: the edge still holds A");
  log("check: " + await evalJson("$r = statchasers_depth_charts_publish_check(); echo wp_json_encode(array_intersect_key($r, array_flip(array('result','changed','paths','edge','wp_rocket'))));"));
  log("rocket_clean_files calls: " + await evalJson("echo wp_json_encode(array_map(function($c){return $c[1];}, get_option('bench_rocket_cleans', array())));"));
  await wp("eval", "do_action('statchasers_depth_charts_team_warm');");
  log("team warm: " + await evalJson("echo wp_json_encode(get_option('statchasers_depth_charts_team_published')['warm']);"));

  log("--- 5. acceptance: ordinary requests to both canonical URLs, desktop and iPhone, no cache-busters");
  await both("public B", "hub");
  await both("public B", "team");
  await both("public B repeat", "hub");
  await both("public B repeat", "team");
  const sample = edge.get(`d ${TEAM}`)?.origin;
  const sampleHub = edge.get(`d ${HUB}`)?.origin;
  log(`origin cache headers, team tab: ${JSON.stringify(sample)}`);
  log(`origin cache headers, league:   ${JSON.stringify(sampleHub)}`);

  log("--- 6. a second check with nothing new: no purge");
  log("check: " + await evalJson("echo statchasers_depth_charts_publish_check()['result'];"));

  log("--- 7. the API goes down: the check changes nothing, the public pages keep B");
  await api.stop();
  api = null;
  log("check: " + await evalJson("$r = statchasers_depth_charts_publish_check(); echo $r['result'], ' (published version still ', $r['version'], ')';"));
  await both("public, API down", "team");

  const finals = results.filter((r) => r.label === "public B" || r.label === "public B repeat");
  const ok = finals.length === 8 && finals.every((r) => (r.which === "hub" ? r.qb1 === "Hub Bravo QB" : r.qb1 === TEAM_B));
  log(`ACCEPTANCE: ${ok ? "PASS" : "FAIL"} - ${finals.length} ordinary requests after publication B, all showing B: ${ok}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  stopWp();
  await api?.stop?.().catch(() => {});
  await upstream?.stop?.().catch(() => {});
  edgeServer.close();
  originServer.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  log("scratch snapshot removed; nothing in the repo was written");
}
