#!/usr/bin/env node
/**
 * WEB-003 replay for the Fantasy Points Allowed page: a weekly publication
 * through every cache layer (docs/FPA-AUDIT-WEB-003-2026-11-27.md).
 *
 * Real: WordPress + MariaDB with this worktree's plugin (the publication
 * check, the warm-up and the page render run exactly as on the host, the
 * check and warm-up through WP-CLI as WP-cron would call them), and the
 * API's own version document and fragments, captured from this worktree's
 * dist at the start (dataset A).
 * Modeled: WP Rocket's page files (desktop + mobile; query strings not
 * stored, as on the host: cache_query_strings is empty) and the Rocket.net
 * edge, which keeps every 200 per device and per full URL until purged,
 * whatever the origin's headers say. Both live in the player-stats bench's
 * mu-plugin (scripts/player-stats/web003/bench-mu-plugin.php) and below.
 *
 * Dataset B is A with the current season moved on a week the way an ingest
 * moves it: every "Week 11" label one week on, the island's weekNumber, and
 * Tennessee's games played and QB figure set to recognizable values, with new
 * ETags. The API is served from those fixtures (one port) so the bench writes
 * nothing to any database the API reads; that the real version document's
 * ETags are the real fragments' is tests/fpa-version.test.mjs.
 *
 *   SC_WP_DIR=<dir holding ./wordpress, ./router.php, ./wp-cli.phar, ./data>
 *   SC_PHP=<php-with-extensions> SC_MARIADBD=<mariadbd> node replay.mjs
 *
 * Ports 18400 (WordPress), 18401 (edge = WP_HOME), 18402 (API fixtures).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..", "..");
const WP_DIR = process.env.SC_WP_DIR;
const PHP = process.env.SC_PHP || "php";
const MARIADBD = process.env.SC_MARIADBD;
const WP_PORT = 18400;
const EDGE_PORT = 18401;
const API_PORT = 18402;
const BASE = "/nfl/fantasy-points-allowed-by-position/";
const ARCHIVE = "/nfl/fantasy-points-allowed-by-position/2025/";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

/* --------------------------------------------------- dataset A, captured */

async function capture() {
  const { startServer } = await import(path.join(APP, "tests", "helpers", "server.mjs"));
  const api = await startServer({ NODE_ENV: "production", SC_PLAYER_LIVE_REFRESH: "0" });
  try {
    // The rail's boards build on the first request; read until two agree.
    let doc;
    for (let i = 0; i < 4; i++) {
      const next = await (await fetch(`${api.origin}/embed/fpa/version`)).json();
      if (doc && next.version === doc.version) break;
      doc = next;
      await sleep(500);
    }
    const frags = {};
    for (const [year, scope] of Object.entries(doc.seasons)) {
      for (const [key, v] of Object.entries(scope.variants)) {
        const q = new URLSearchParams({ format: v.format, view: v.view });
        if (Number(year) !== doc.current) q.set("season", year);
        const r = await fetch(`${api.origin}/embed/fpa?${q}`);
        const etag = r.headers.get("etag");
        if (etag !== v.etag) throw new Error(`capture: ${year} ${key} ETag ${etag} is not the announced ${v.etag}`);
        frags[`${year} ${key}`] = { etag, html: await r.text() };
      }
    }
    return { doc, frags };
  } finally {
    await api.stop();
  }
}

/** Dataset B: the current season one week on, Tennessee recognizable. */
function moveOn(frags, doc, season, { week, tenGames, tenQb }) {
  const out = structuredClone(frags);
  for (const key of Object.keys(out)) {
    if (!key.startsWith(`${season} `)) continue;
    let h = out[key].html;
    h = h.replace(new RegExp(`Week ${week + 1}\\b`, "g"), `Week ${week + 2}`);
    h = h.replace(new RegExp(`Week ${week}\\b`, "g"), `Week ${week + 1}`);
    h = h.replace(new RegExp(`1–${week}\\b`, "g"), `1–${week + 1}`);
    h = h.replace(`"weekNumber":${week}`, `"weekNumber":${week + 1}`);
    h = h.replace(/(<tr class="scf-row" data-team="TEN">[\s\S]*?<span class="scf-fpa">)[0-9.]+(<\/span>)/, `$1${tenQb}$2`);
    h = h.replace(/(<tr class="scf-row" data-team="TEN">[\s\S]*?<td class="scf-games" data-sort=")\d+(">)\d+/, `$1${tenGames}$2${tenGames}`);
    out[key] = { etag: out[key].etag.replace(/"$/, `-b${tenQb}"`), html: h };
  }
  return out;
}

/* -------------------------------------------------------- the API fixtures */

const api = { frags: null, doc: null, down: false, fail: "", requests: [] };
function versionDoc() {
  const seasons = {};
  const all = [];
  for (const [year, scope] of Object.entries(api.doc.seasons)) {
    const variants = {};
    const etags = [];
    for (const [key, v] of Object.entries(scope.variants)) {
      const etag = api.frags[`${year} ${key}`].etag;
      etags.push(etag);
      variants[key] = { ...v, etag };
    }
    const version = etags.join("|").split("").reduce((h, c) => ((h << 5) + h + c.charCodeAt(0)) | 0, 5381) >>> 0;
    all.push(`${year}:${version}`);
    const island = /"weekNumber":(\d+)/.exec(api.frags[`${year} ppr-raw`].html);
    seasons[year] = { ...scope, version: version.toString(36), weekNumber: island ? Number(island[1]) : scope.weekNumber, variants };
  }
  return { ...api.doc, version: all.join("|"), seasons };
}
const apiServer = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  api.requests.push(u.pathname + u.search);
  if (api.down) return res.writeHead(503).end("down");
  if (u.pathname === "/embed/fpa/version") {
    return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(versionDoc()));
  }
  if (u.pathname === "/embed/fpa") {
    const year = u.searchParams.get("season") ?? String(api.doc.current);
    const key = `${u.searchParams.get("format")}-${u.searchParams.get("view")}`;
    if (`${year} ${key}` === api.fail) return res.writeHead(500).end("boom");
    const f = api.frags[`${year} ${key}`];
    if (!f) return res.writeHead(404).end("none");
    return res.writeHead(200, { "content-type": "text/html", etag: f.etag, "cache-control": "public, max-age=300" }).end(f.html);
  }
  res.writeHead(404).end("not here");
});

/* ------------------------------------------------------------ edge model */

const edge = new Map();
let lastPurge = [];
const edgeServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__purge") {
    let body = "";
    req.on("data", (d) => (body += d)).on("end", () => {
      const { files } = JSON.parse(body);
      lastPurge = lastPurge.concat(files);
      let n = 0;
      for (const key of [...edge.keys()]) if (files.includes(key.slice(2))) { edge.delete(key); n++; }
      log(`EDGE purge: ${files.length} paths asked, ${n} cached entries dropped`);
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
      const origin = { cc: headers["cache-control"], cdn: headers["cdn-cache-control"], cfcc: headers["cloudflare-cdn-cache-control"], sc: headers["x-sc-fpa-cache"] };
      // Production: the platform drops the origin's lifetime and stamps 30 days on a 200.
      headers["cache-control"] = "public, max-age=0, s-maxage=2592000";
      if (r.statusCode === 200) edge.set(key, { status: r.statusCode, headers, body, at: Date.now(), origin });
      res.writeHead(r.statusCode, { ...headers, "cf-cache-status": "MISS" });
      res.end(body);
    });
  });
  up.on("error", (e) => res.writeHead(502).end(String(e)));
  req.pipe(up);
});

/* ------------------------------------------------------------ the readers */

function get(pathname, ua = DESKTOP, port = EDGE_PORT) {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    http.get({ host: "127.0.0.1", port, path: pathname, headers: { "user-agent": ua, host: `127.0.0.1:${EDGE_PORT}`, connection: "close" } }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d)).on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: b, ms: Date.now() - t }));
    }).on("error", reject);
  });
}
const decode = (s) => s.replace(/&#8211;|&ndash;/g, "–").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'");
/** What a reader compares: title, H1 week range, Updated line, TEN games + QB figure. */
function read(html) {
  const title = decode((/<title>([^<]*)<\/title>/.exec(html) ?? [])[1] ?? "-");
  const weeks = decode((/Weeks 1(?:–|&#8211;)(\d+)/.exec(html) ?? [])[0] ?? "-");
  const row = /<tr class="scf-row" data-team="TEN">([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? "";
  const qb = (/<span class="scf-fpa">([0-9.]+)<\/span>/.exec(row) ?? [])[1] ?? "-";
  const games = (/<td class="scf-games" data-sort="(\d+)"/.exec(row) ?? [])[1] ?? "-";
  const format = (/data-format="([a-z]+)"/.exec(html) ?? [])[1] ?? "-";
  return { title, weeks, qb, games, format };
}
const RESULTS = [];
async function show(label, pathname, ua = DESKTOP, port = EDGE_PORT) {
  const r = await get(pathname, ua, port);
  const s = read(r.body);
  const row = { label, pathname, device: ua === PHONE ? "phone" : "desktop", status: r.status, cache: r.headers["cf-cache-status"] ?? "origin", rocket: r.headers["x-bench-rocket"] ? "rocket-file" : "wp-render", ...s };
  RESULTS.push(row);
  log(`${label.padEnd(24)} ${pathname.replace("/nfl/fantasy-points-allowed-by-position", "").padEnd(26)} ${row.device.padEnd(7)} ${r.status} ${row.cache.padEnd(6)} ${row.rocket.padEnd(11)} ${s.format.padEnd(8)} "${s.title}"  ${s.weeks}  TEN G ${s.games} QB ${s.qb}`);
  return row;
}
/** The truth: what the API serves for that address's default table right now. */
function truth(year) {
  const s = read(api.frags[`${year} ppr-raw`].html);
  return { weeks: s.weeks, qb: s.qb, games: s.games };
}

/* -------------------------------------------------------- the processes */

async function wp(...args) {
  const { stdout } = await execFileAsync(PHP, [path.join(WP_DIR, "wp-cli.phar"), `--path=${path.join(WP_DIR, "wordpress")}`, ...args], { env: { ...process.env }, maxBuffer: 1 << 26 });
  return stdout.trim();
}
const check = async (force = false) => JSON.parse(await wp("eval", `echo wp_json_encode( array_intersect_key( statchasers_fpa_publish_check( ${force ? "true" : "false"} ), array_flip( array( 'result', 'changed', 'wp_rocket', 'rocket_urls', 'edge', 'paths', 'edge_state', 'to_warm' ) ) ) );`));
const rocketCleans = async () => JSON.parse((await wp("eval", "echo wp_json_encode( get_option( 'bench_rocket_cleans', array() ) );")) || "[]");

let dbProc;
let wpProc;
async function startDb() {
  const sock = path.join(WP_DIR, "mysql.sock");
  dbProc = spawn(MARIADBD, ["--no-defaults", `--datadir=${path.join(WP_DIR, "data")}`, `--socket=${sock}`, "--skip-networking", `--pid-file=${path.join(WP_DIR, "mariadb.pid")}`, `--log-error=${path.join(WP_DIR, "mariadb.log")}`, "--innodb-buffer-pool-size=32M"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await sleep(250);
  await sleep(1000);
}
function stopGroup(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
}
async function startWp() {
  wpProc = spawn(PHP, ["-S", `127.0.0.1:${WP_PORT}`, "-t", path.join(WP_DIR, "wordpress"), path.join(WP_DIR, "router.php")], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: "3" }, stdio: "ignore", detached: true });
  await sleep(1500);
}

/* ----------------------------------------------------------------- run */

const SUMMARY = {};
try {
  if (!WP_DIR || !MARIADBD) throw new Error("SC_WP_DIR and SC_MARIADBD are required");
  const A = await capture();
  const cur = A.doc.current;
  const week = A.doc.seasons[String(cur)].weekNumber;
  log(`captured dataset A from the API: current ${cur} through Week ${week}, archives ${A.doc.archives.join(",")}; TEN ${JSON.stringify(read(A.frags[`${cur} ppr-raw`].html))}`);
  api.doc = A.doc;
  api.frags = A.frags;

  await startDb();
  await new Promise((r) => apiServer.listen(API_PORT, "127.0.0.1", r));
  await new Promise((r) => edgeServer.listen(EDGE_PORT, "127.0.0.1", r));
  process.env.SC_ORIGIN = `http://127.0.0.1:${API_PORT}`;
  process.env.SC_BENCH_EDGE_PURGE = `http://127.0.0.1:${EDGE_PORT}/__purge`;

  // The page, as on the host: /nfl/fantasy-points-allowed-by-position/ holding the shortcode.
  log("page: " + await wp("eval", [
    "$p = get_page_by_path( 'nfl/fantasy-points-allowed-by-position' );",
    "if ( ! $p ) { $nfl = get_page_by_path( 'nfl' ); $parent = $nfl ? $nfl->ID : wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_name' => 'nfl', 'post_title' => 'NFL' ) );",
    "  $id = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_name' => 'fantasy-points-allowed-by-position', 'post_title' => 'Fantasy Points Allowed by Position', 'post_parent' => $parent, 'post_content' => '[statchasers_fpa]' ) ); $p = get_post( $id ); }",
    "echo $p->ID, ' ', get_permalink( $p );",
  ].join(" ")));
  await wp("rewrite", "flush");
  await wp("eval", "delete_option('statchasers_fpa_published'); delete_option('bench_rocket_cleans'); statchasers_fpa_flush(true); array_map('unlink', glob(WP_CONTENT_DIR.'/cache/sc-bench/*') ?: array());");
  await startWp();

  log("--- 1. dataset A published (first check), warmed, then visitors fill every layer");
  log("check: " + JSON.stringify(await check()));
  log("warm: " + await wp("eval", "echo wp_json_encode( statchasers_fpa_warm() );"));
  for (const p of [BASE, `${BASE}?format=half`, `${BASE}?view=adjusted&format=standard`, ARCHIVE]) {
    await show("public A", p);
    await show("public A", p, PHONE);
  }
  const hdrBase = [...edge.values()].find((e) => e.origin.sc?.includes("season=current"))?.origin;
  const hdrArch = [...edge.values()].find((e) => e.origin.sc?.includes("season=2025"))?.origin;
  log(`origin headers, current: ${JSON.stringify(hdrBase)}`);
  log(`origin headers, archive: ${JSON.stringify(hdrArch)}`);
  SUMMARY.headers = { current: hdrBase, archive: hdrArch };

  log("--- 2. the weekly ingest lands: the API serves dataset B (Week " + (week + 1) + ")");
  const B = moveOn(A.frags, A.doc, cur, { week, tenGames: 77, tenQb: "31.7" });
  api.frags = B;
  log(`truth B: ${JSON.stringify(truth(cur))}`);
  await show("origin ?zz (WP render)", `${BASE}?zz=1`, DESKTOP, WP_PORT);
  log("    ^ WordPress still prints its 15-minute fragment copy of A");
  await show("public (stale)", BASE);
  await show("public (stale)", BASE, PHONE);
  log("    ^ the 11-24 finding: nothing has purged the edge");

  log("--- 3. the check runs while one variant fails at the API: the last complete dataset stays");
  api.fail = `${cur} half-adjusted`;
  const edgeBefore = edge.size;
  const failed = await check();
  log("check: " + JSON.stringify(failed));
  await show("public (fail kept A)", BASE);
  await show("origin ?zz (fail)", `${BASE}?zz=2`, DESKTOP, WP_PORT);
  SUMMARY.failure = { result: failed.result, edgeEntriesBefore: edgeBefore, edgeEntriesAfter: edge.size };
  api.fail = "";

  log("--- 4. the next check: B published");
  lastPurge = [];
  await wp("eval", "delete_option('bench_rocket_cleans');");
  const pub = await check();
  log("check: " + JSON.stringify(pub));
  log("rocket_clean_files calls: " + JSON.stringify(await rocketCleans()));
  const archiveStill = [...edge.keys()].filter((k) => k.includes("/2025/"));
  log(`edge entries under /2025/ after the purge: ${archiveStill.length} (${archiveStill.join(", ")})`);
  SUMMARY.publish = { result: pub.result, changed: pub.changed, paths: pub.paths, purgedArchivePaths: lastPurge.filter((p) => p.includes("/2025/")).length, archiveEntriesKept: archiveStill.length };
  log("warm: " + await wp("eval", "echo wp_json_encode( statchasers_fpa_warm() );"));
  const after = [];
  after.push(await show("public B", BASE));
  after.push(await show("public B repeat", BASE));
  after.push(await show("public B", BASE, PHONE));
  after.push(await show("public B repeat", BASE, PHONE));
  await show("public B", `${BASE}?format=half`);
  await show("public B", `${BASE}?view=adjusted&format=standard`, PHONE);
  const arch = [await show("public 2025", ARCHIVE), await show("public 2025", ARCHIVE, PHONE)];
  const t = truth(cur);
  SUMMARY.canonical = after.map((r) => ({ device: r.device, cache: r.cache, title: r.title, weeks: r.weeks, games: r.games, qb: r.qb, matchesOrigin: r.weeks === t.weeks && r.qb === t.qb && r.games === t.games && r.title.includes(t.weeks) }));
  SUMMARY.archive = arch.map((r) => ({ device: r.device, cache: r.cache, title: r.title, weeks: r.weeks, still2025: /2025/.test(r.title) && r.weeks === "Weeks 1–17" }));
  SUMMARY.truth = t;

  log("--- 5. nothing new: no purge");
  lastPurge = [];
  log("check: " + JSON.stringify(await check()));
  SUMMARY.quiet = lastPurge.length;

  log("--- 6. a historical correction to 2025: only the archive moves");
  api.frags = moveOn(api.frags, A.doc, 2025, { week: 99, tenGames: 17, tenQb: "19.9" });
  lastPurge = [];
  const corr = await check();
  log("check: " + JSON.stringify(corr));
  log("warm: " + await wp("eval", "echo wp_json_encode( statchasers_fpa_warm() );"));
  const c1 = await show("public 2025 corrected", ARCHIVE);
  const c2 = await show("public current (kept)", BASE);
  SUMMARY.correction = { changed: corr.changed, purgedCurrentPaths: lastPurge.filter((p) => !p.includes("/2025/")).length, archiveQb: c1.qb, currentCache: c2.cache, currentQb: c2.qb };

  console.log("\nSUMMARY " + JSON.stringify(SUMMARY, null, 1));
} finally {
  stopGroup(wpProc);
  apiServer.close();
  edgeServer.close();
  stopGroup(dbProc);
  await sleep(1500);
  log("bench stopped");
}
process.exit(0);
