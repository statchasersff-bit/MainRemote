#!/usr/bin/env node
/**
 * The depth-chart snapshot's other readers through every cache layer: the
 * Bills hub's Draft tab (Pos column) and the Chiefs at Bills preview's Player
 * Battles, on the pair's page and the dated game page
 * (docs/DEPTH-SNAPSHOT-CONSUMERS-2026-11-25.md).
 *
 * Real: the API (this worktree's dist) behind a stable origin address, with
 * the embed key and the version endpoint; WordPress + MariaDB with the
 * plugin: team and matchup transients, the matchup cache policy, the
 * five-minute publication checks run as WP-cron runs them.
 * Modeled: WP Rocket's page files and Rocket.net's purge API
 * (scripts/player-stats/web003/bench-mu-plugin.php) and the Rocket.net edge
 * (keeps every 200 per device until purged, origin cache headers ignored, as
 * production does today).
 *
 * Snapshots: A = the committed snapshot (BUF LB1 Dorian Williams, LB2
 * Terrel Bernard; EDGE1 Greg Rousseau, Questionable); B = the same with
 * LB1/LB2 swapped and Rousseau listed Out. The LB swap moves two Draft Pos
 * cells (both are Bills draftees). Player Battles picks the Chiefs' best
 * matchup against the Bills' defense from inputs that differ between
 * processes (a tight end against LB1 + S1, or the quarterback against the
 * front's two leading pass rushers, Rousseau among them), so both units
 * change: in B neither Williams nor Rousseau may appear. Each publication is a file swap (tmp + rename) on a scratch
 * path plus an API restart, as a Replit publish is.
 *
 *   SC_WP_DIR=<dir holding ./wordpress, ./router.php, ./wp-cli.phar> SC_PHP=<php> node replay.mjs
 *   SC_POLL_MIN=7 (minutes of ordinary requests after publication B, default 7)
 *
 * Ports 18150 (WordPress), 18151 (edge = WP_HOME), 18152 (API origin); SC_BENCH_PORT_BASE
 * moves all three (the bench wp-config must name base+1 and base+2).
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
const { startServer } = await import(path.join(APP, "tests", "helpers", "server.mjs"));
const { startUpstreamReplay } = await import(path.join(APP, "tests", "helpers", "upstream-replay.mjs"));
const WP_DIR = process.env.SC_WP_DIR;
const PHP = process.env.SC_PHP || "php";
const POLL_MIN = Number(process.env.SC_POLL_MIN || 7);
const PORT_BASE = Number(process.env.SC_BENCH_PORT_BASE || 18150);
const WP_PORT = PORT_BASE;
const EDGE_PORT = PORT_BASE + 1;
const ORIGIN_PORT = PORT_BASE + 2;
const KEY = "bench-embed-key";
const HUB = "/nfl/teams/buffalo-bills/";
const PAIR = "/nfl/buffalo-bills-vs-kansas-city-chiefs/";
const GAME = "/nfl/buffalo-bills-vs-kansas-city-chiefs/2026-week-12/";
const PAGES = { hub: HUB, pair: PAIR, game: GAME };
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36";
const SNAPSHOT = path.join(APP, "data", "depth-charts", "statchasers", "depth-charts.json");

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
      const origin = { cc: headers["cache-control"], cdncc: headers["cdn-cache-control"], matchup: headers["x-sc-matchup-cache"] };
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

/* --------------------------------------------------------------- readers */

/** Draft tab: the Pos-column slot on Dorian Williams's row: LB1 in A, LB2 in B. */
function draftSlot(html) {
  const at = html.indexOf("Dorian Williams</");
  if (at < 0) return "-";
  const row = html.slice(at, html.indexOf("</tr>", at));
  return (row.match(/class="sct-dr-slot"[^>]*>([^<]+)</) ?? [])[1] ?? "none";
}

/** Player Battles: which of the A defenders the Bills' card names (B names neither). */
const A_NAMES = ["Dorian Williams", "Greg Rousseau"];
function battleCorner(html) {
  const at = html.indexOf("sct-mpp-card is-battles");
  if (at < 0) return "no battles";
  const card = html.slice(at, html.indexOf("</section>", at));
  const names = A_NAMES.filter((n) => card.includes(n));
  return names.length ? names.join("+") : `neither${card.includes("Terrel Bernard") ? " (Bernard)" : ""}`;
}

function read(which, body) {
  return which === "hub" ? `Williams ${draftSlot(body)}` : `battles: ${battleCorner(body)}`;
}
const isB = (which, value) =>
  which === "hub" ? value === "Williams LB2" : value.includes("neither");
const isA = (which, value) => (which === "hub" ? value === "Williams LB1" : A_NAMES.some((n) => value.includes(n)));

async function show(label, which, ua = DESKTOP, query = "", port = EDGE_PORT) {
  const r = await get(PAGES[which] + query, ua, port);
  const device = ua === PHONE ? "phone" : "desktop";
  const layer = `${(r.headers["cf-cache-status"] ?? "origin").padEnd(6)} ${r.headers["x-bench-rocket"] ? "rocket-file" : "wp-render  "}`;
  const value = read(which, r.body);
  log(`${label.padEnd(24)} ${which.padEnd(4)} ${device.padEnd(7)} ${r.status} ${layer} ${String(r.ms).padStart(5)}ms  ${value}${r.headers["x-sc-matchup-cache"] ? `  [${r.headers["x-sc-matchup-cache"]}]` : ""}`);
  return { label, which, device, cf: r.headers["cf-cache-status"] ?? "origin", value, b: isB(which, value) };
}

async function apiRead(which) {
  const p = which === "hub" ? "/embed/team/buffalo-bills" : `/embed/matchup/buffalo-bills-vs-kansas-city-chiefs${which === "game" ? "?game=2026-week-12" : ""}`;
  const r = await get(p, DESKTOP, ORIGIN_PORT, { "x-statchasers-key": KEY, "x-sc-matchup-preview": "1" });
  return read(which, r.body);
}

async function wp(...args) {
  const { stdout } = await execFileAsync(PHP, [path.join(WP_DIR, "wp-cli.phar"), `--path=${path.join(WP_DIR, "wordpress")}`, ...args], { env: { ...process.env }, maxBuffer: 1 << 26 });
  return stdout.trim();
}

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

function publish(doc) {
  const file = path.join(scratch, "depth-charts.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${file}.tmp`, file);
}
function snapshotA() {
  return JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
}
function snapshotB() {
  const doc = snapshotA();
  const buf = doc.teams.find((t) => t.team.abbr === "BUF");
  const a = buf.positions.LB.find((r) => r.name === "Dorian Williams");
  const b = buf.positions.LB.find((r) => r.name === "Terrel Bernard");
  [a.rank, b.rank] = [b.rank, a.rank];
  buf.positions.LB.sort((x, y) => x.rank - y.rank);
  buf.positions.EDGE.find((r) => r.name === "Greg Rousseau").status = "O";
  for (const slot of buf.slots ?? []) {
    for (const p of slot.players ?? []) {
      const swap = { "Dorian Williams": "Terrel Bernard", "Terrel Bernard": "Dorian Williams" };
      if (swap[p.name]) p.name = swap[p.name];
    }
  }
  return doc;
}
async function restartApi() {
  await api.stop();
  api = await startServer(API_ENV());
}

const TABS_CHECK = "$r = statchasers_depth_charts_publish_check(); echo $r['result'], ' changed=', implode(',', $r['changed'] ?? array());";
const CONSUMERS_CHECK = "$r = statchasers_depth_consumers_check(); echo wp_json_encode(array_intersect_key($r, array_flip(array('result','changed','to_warm','edge','wp_rocket','matchups'))));";

async function everyone(label) {
  const out = [];
  for (const which of ["hub", "pair", "game"]) for (const ua of [DESKTOP, PHONE]) out.push(await show(label, which, ua));
  return out;
}

/* ----------------------------------------------------------------- run */
try {
  if (!WP_DIR) throw new Error("SC_WP_DIR is not set");
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sc-dc-consumers-"));
  publish(snapshotA());
  upstream = await startUpstreamReplay();
  api = await startServer(API_ENV());
  process.env.SC_ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
  process.env.SC_BENCH_EDGE_PURGE = `http://127.0.0.1:${EDGE_PORT}/__purge`;
  process.env.SC_BENCH_EMBED_KEY = KEY;
  await new Promise((r) => edgeServer.listen(EDGE_PORT, "127.0.0.1", r));
  await new Promise((r) => originServer.listen(ORIGIN_PORT, "127.0.0.1", r));
  await startWp();
  log(`API ${api.origin} behind ${process.env.SC_ORIGIN}; snapshot A (committed) on a scratch path`);

  await wp("eval", [
    "delete_option('statchasers_depth_charts_team_published'); delete_option('statchasers_depth_consumers_published'); delete_option('bench_rocket_cleans');",
    "statchasers_team_flush(true);",
    "global $wpdb; $wpdb->query(\"DELETE FROM {$wpdb->options} WHERE option_name LIKE '%sc_matchup_ssr%'\");",
    "array_map('unlink', glob(WP_CONTENT_DIR.'/cache/sc-bench/*') ?: array());",
  ].join(" "));

  log("--- 1. snapshot A published (both checks record it), visitors fill every layer");
  log("tabs check:      " + await wp("eval", TABS_CHECK));
  log("consumers check: " + await wp("eval", CONSUMERS_CHECK));
  for (const which of ["hub", "pair", "game"]) log(`API ${which.padEnd(4)} A: ${await apiRead(which)}`);
  await everyone("public A");
  await everyone("public A repeat");
  const filled = Date.now();
  for (const k of [`d ${PAIR}`, `d ${HUB}`]) log(`origin cache headers ${k}: ${JSON.stringify(edge.get(k)?.origin)}`);

  log("--- 2. snapshot B: Bills LB1/LB2 swapped, EDGE1 Rousseau Out, file swapped, API restarted (a Replit publish)");
  publish(snapshotB());
  await restartApi();
  const published = Date.now();
  log(`published B ${((published - filled) / 1000).toFixed(0)} s after the caches filled`);
  for (const which of ["hub", "pair", "game"]) log(`API ${which.padEnd(4)} B: ${await apiRead(which)}`);
  log("tabs check (the release, alone): " + await wp("eval", TABS_CHECK));

  log(`--- 3. today's behavior: ordinary requests for ${POLL_MIN} min, no consumer check`);
  const firstB = {};
  const note = (layer, which, r) => { if (r.b && !(`${layer} ${which}` in firstB)) firstB[`${layer} ${which}`] = Math.round((Date.now() - published) / 1000); };
  let n = 0;
  const end = published + POLL_MIN * 60_000;
  while (Date.now() < end) {
    n++;
    for (const which of ["hub", "pair", "game"]) {
      note("wp-render", which, await show(`t+${Math.round((Date.now() - published) / 1000)}s WP ?zz`, which, DESKTOP, `?zz=${n}`, WP_PORT));
      note("wp+rocket", which, await show(`t+${Math.round((Date.now() - published) / 1000)}s WP`, which, DESKTOP, "", WP_PORT));
      note("edge desktop", which, await show(`t+${Math.round((Date.now() - published) / 1000)}s public`, which, DESKTOP));
      note("edge phone", which, await show(`t+${Math.round((Date.now() - published) / 1000)}s public`, which, PHONE));
    }
    await sleep(60_000);
  }
  log(`first B seen per layer (s after publish; absent = still A at t+${POLL_MIN} min): ${JSON.stringify(firstB)}`);

  log("--- 4. the consumer check (this branch) runs on the same five-minute event");
  log("consumers check: " + await wp("eval", CONSUMERS_CHECK));
  log("rocket_clean_files calls: " + await wp("eval", "echo wp_json_encode(array_map(function($c){return $c[1];}, get_option('bench_rocket_cleans', array())));"));
  const afterB = await everyone("public B");
  await wp("eval", "do_action('statchasers_depth_consumers_warm');");
  const afterB2 = await everyone("public B repeat");

  log("--- 5. snapshot A again, checked at once (fresh WP copies of B must not refill the edge)");
  publish(snapshotA());
  await restartApi();
  for (const which of ["hub", "pair", "game"]) log(`API ${which.padEnd(4)} A again: ${await apiRead(which)}`);
  log("tabs check:      " + await wp("eval", TABS_CHECK));
  log("consumers check: " + await wp("eval", CONSUMERS_CHECK));
  const afterA = await everyone("public A again");

  log("--- 6. nothing new: no purge");
  log("consumers check: " + await wp("eval", CONSUMERS_CHECK));

  const okB = [...afterB, ...afterB2].every((r) => r.b);
  const okA = afterA.every((r) => isA(r.which, r.value));
  log(`ACCEPTANCE: ${okB && okA ? "PASS" : "FAIL"} - after B: ${okB}; after A again: ${okA}`);
  process.exitCode = okB && okA ? 0 : 1;
} finally {
  stopWp();
  await api?.stop?.().catch(() => {});
  await upstream?.stop?.().catch(() => {});
  edgeServer.close();
  originServer.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  log("scratch snapshot removed; nothing in the repo was written");
}
