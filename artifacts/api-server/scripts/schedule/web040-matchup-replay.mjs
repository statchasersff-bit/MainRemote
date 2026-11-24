#!/usr/bin/env node
/**
 * WEB-040 / WEB-003: walk one game from pregame to corrected final through
 * the matchup surfaces, with fresh requests AND browser tabs left open.
 *
 *   node build.mjs && node scripts/schedule/web040-matchup-replay.mjs [--quick]
 *
 * REAL   the app (live layer, game-state record, fragment cache, cache-policy
 *        headers, /api/game-state), headless Chromium running the page's own
 *        bundle (client/game-state.ts) in two tabs opened before kickoff: the
 *        week URL and the head-to-head URL.
 * FAKE   nflverse and ESPN, changed step by step by this script: CIN @ WAS,
 *        Week 11, kickoff ~90 s after start.
 * MODEL  the edge in front of WordPress, two ways, fed the policy the plugin
 *        would apply to each response (statchasers_matchup_page_cache_policy,
 *        mirrored below): "honoring" = the host passes the plugin's
 *        Cloudflare-CDN-Cache-Control through (the change proposed in
 *        docs/WEB-040-LIVE-MATCHUP-2026-11-24b.md); "observed" = production
 *        today, 30 days on every 200.
 *
 * Real seconds throughout (the client polls every 30 s while live), so a full
 * run takes about twelve minutes; --quick skips the five-minute wait for the
 * open tab to pick up a corrected final. Chromium needs the Bash sandbox off.
 * Prints a JSON timeline; nothing is written to the repo.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");
const QUICK = process.argv.includes("--quick");
const CDP_PORTS = [Number(process.env.SC_CDP_PORT || 5433), Number(process.env.SC_CDP_PORT2 || 5436)];
const APP_PORT = Number(process.env.SC_APP_PORT || 5435);
const APP_LOG = process.env.SC_REPLAY_APP_LOG || path.join(os.tmpdir(), "web040-replay-app.log");

const CIN_WAS = "401873078";
const GAME_ID = "2026_11_CIN_WAS";
const PAIR = "cincinnati-bengals-vs-washington-commanders";
const t0 = Date.now();
const kick = Math.ceil((t0 + 90_000) / 60_000) * 60_000;
const sec = () => Math.round((Date.now() - kick) / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eastern = (ms, opts = {}) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ...opts }).format(new Date(ms));

/* -------------------------------------------------------------- sources */

function csv() {
  const text = fs.readFileSync(path.join(APP, "tests", "fixtures", "schedule-2026-week11.csv"), "utf8");
  const [header, ...rows] = text.trim().split("\n");
  const cols = header.split(",");
  const at = (n) => cols.indexOf(n);
  return [header, ...rows.map((line) => {
    if (!line.startsWith(`${GAME_ID},`)) return line;
    const c = line.split(",");
    c[at("gameday")] = eastern(kick);
    c[at("gametime")] = eastern(kick, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    c[at("away_score")] = "";
    c[at("home_score")] = "";
    return c.join(",");
  })].join("\n") + "\n";
}
function ev({ state, completed = false, name, detail, period = 0, away = 0, home = 0 }) {
  return {
    id: CIN_WAS,
    date: new Date(kick).toISOString(),
    status: { period, type: { name, state, completed, shortDetail: detail, detail } },
    competitions: [{ timeValid: true, competitors: [{ homeAway: "home", score: String(home) }, { homeAway: "away", score: String(away) }], broadcasts: [{ names: ["CBS"] }] }],
  };
}
const source = { csv: csv(), event: ev({ state: "pre", name: "STATUS_SCHEDULED", detail: "Pregame" }), refuse: false };
const upstream = http.createServer((req, res) => {
  if (req.url === "/games.csv") return res.end(source.csv);
  if (req.url.startsWith("/espn/apis/site/v2/sports/football/nfl/scoreboard")) {
    if (source.refuse) { res.writeHead(403); return res.end(); }
    const week = new URL(req.url, "http://x").searchParams.get("week");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ events: week === "11" ? [source.event] : [] }));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const up = `http://127.0.0.1:${upstream.address().port}`;
const layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "web040-mu-"));
const appEnv = {
  SC_SCHEDULE_CSV_URL: `${up}/games.csv`,
  SC_SCHEDULE_SEASON: "2026",
  SC_ESPN_SITE_BASE: `${up}/espn`,
  SC_SCHEDULE_ESPN: "1",
  SC_SCHEDULE_LAYER_DIR: layerDir,
  // The app's own clocks shortened; the client's and the edge model's are real.
  SC_SCHEDULE_TEST_TIMING: JSON.stringify({ liveTtlMs: 1000, idleTtlMs: 2000, slateTtlMs: 2000, staleMs: 20_000, failBackoffLiveMs: 2000 }),
  PUBLIC_ORIGIN: "request",
  INGEST_SECRET: "web040-replay",
};
// The app, spawned here rather than through tests/helpers/server.mjs so its
// log survives (SC_REPLAY_APP_LOG) if it dies mid-run.
const appLog = fs.openSync(APP_LOG, "w");
const appProc = spawn(process.execPath, ["--max-old-space-size=1024", path.join(APP, "dist", "index.mjs")], {
  cwd: APP,
  env: { ...process.env, DYNASTY_NEWS_API_URL: "", SC_ROTOWIRE_SWEEP: "0", SC_EMBED_KEY: "", SC_BROWSER_PROXY: "", SC_MINIFIED_CSS: "0", NODE_ENV: "test", ...appEnv, PORT: String(APP_PORT) },
  stdio: ["ignore", appLog, appLog],
});
const app = {
  origin: `http://127.0.0.1:${APP_PORT}`,
  stop: () => new Promise((resolve) => { if (appProc.exitCode !== null) return resolve(); appProc.once("exit", resolve); appProc.kill("SIGTERM"); }),
};
for (let i = 0; ; i += 1) {
  try { if ((await fetch(`${app.origin}/api/healthz`)).ok) break; } catch {}
  if (i > 180 || appProc.exitCode !== null) throw new Error(`app did not start; see ${APP_LOG}`);
  await new Promise((r) => setTimeout(r, 250));
}

/* ------------------------------------------------------------ the edge model */

/** statchasers_matchup_page_cache_policy(), in seconds; null = the host default. */
function pluginTtl(state, changeAt, nowS) {
  const until = changeAt > nowS ? changeAt - nowS : 0;
  switch (state) {
    case "settled": return until > 0 && until < 30 * 86400 ? until : null;
    case "recent": return until > 0 ? Math.min(3600, until) : 3600;
    case "pregame": return changeAt <= 0 ? 21600 : until > 0 ? Math.min(21600, until) : 60;
    default: return 60;
  }
}
const edges = { honoring: new Map(), observed: new Map() };
async function viaEdge(kind, p) {
  const hit = edges[kind].get(p);
  if (hit && hit.expires > Date.now()) return { ...hit.value, edge: "HIT", age: Math.round((Date.now() - hit.at) / 1000) };
  const res = await fetch(`${app.origin}${p}`, { headers: { "X-SC-Matchup-Preview": "1" } });
  const html = await res.text();
  const state = res.headers.get("x-sc-matchup-cache-state") ?? "";
  const changeAt = Number(res.headers.get("x-sc-matchup-change-at") ?? 0);
  const ttl = kind === "observed" ? 30 * 86400 : (pluginTtl(state, changeAt, Math.floor(Date.now() / 1000)) ?? 30 * 86400);
  const value = { status: res.status, cacheState: state, ttl, strip: strip(html), kind: res.headers.get("x-matchup-game") };
  edges[kind].set(p, { value, expires: Date.now() + ttl * 1000, at: Date.now() });
  return { ...value, edge: "MISS", age: 0 };
}
function strip(html) {
  const m = html.match(/<section class="sct-gs"([^>]*)>([\s\S]*?)<\/section>/);
  if (!m) return null;
  return { phase: m[1].match(/data-phase="([^"]*)"/)?.[1], hidden: /\shidden/.test(m[1]), text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
}

/* -------------------------------------------------------------- chromium */

// One browser per tab: a second tab in the same browser is a background tab,
// and the client deliberately pauses a hidden tab (it catches up when shown).
const profiles = CDP_PORTS.map(() => fs.mkdtempSync(path.join(os.tmpdir(), "web040-chrome-")));
const chromes = CDP_PORTS.map((port, i) => spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profiles[i]}`, "--blink-settings=imagesEnabled=false", "about:blank"], { stdio: "ignore" }));
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  for (const chrome of chromes) { try { chrome.kill(); } catch {} }
  await app.stop().catch(() => {});
  upstream.close();
  fs.rmSync(layerDir, { recursive: true, force: true });
  for (const profile of profiles) fs.rmSync(profile, { recursive: true, force: true });
};
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

async function cdpJson(port, p, method = "GET") {
  for (let i = 0; i < 50; i += 1) {
    try { return await (await fetch(`http://127.0.0.1:${port}${p}`, { method })).json(); } catch { await sleep(200); }
  }
  throw new Error("chromium did not start");
}
async function openTab(port, url) {
  const target = await cdpJson(port, `/json/new?${encodeURIComponent(url)}`, "PUT");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return {
    async read() {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => { const s = document.querySelector("[data-sc-game-state]"); return s ? { phase: s.dataset.phase, hidden: s.hidden, text: s.innerText.replace(/\\s+/g, " ").trim(), link: !!s.querySelector(".sct-gs-action") } : null; })()`,
      });
      return r.result?.result?.value ?? null;
    },
    async visible() {
      const r = await send("Runtime.evaluate", { returnByValue: true, expression: "document.visibilityState" });
      return r.result?.result?.value ?? null;
    },
    close: () => ws.close(),
  };
}

/* --------------------------------------------------------------- the run */

const WEEK = `/nfl/${PAIR}/2026-week-11/`;
const H2H = `/nfl/${PAIR}/`;
const timeline = [];

async function observe(step) {
  try {
    await observeOnce(step);
  } catch (err) {
    console.error(`[${sec()}s] ${step}: observation failed (${err?.cause?.code ?? err}); app exit code ${appProc.exitCode}; log ${APP_LOG}`);
    timeline.push({ step, t: sec(), error: String(err?.cause?.code ?? err), appExit: appProc.exitCode });
    if (appProc.exitCode !== null) throw err;
  }
}

async function observeOnce(step) {
  const [api, sched] = await Promise.all([
    fetch(`${app.origin}/api/game-state/${GAME_ID}`).then((r) => r.json()),
    fetch(`${app.origin}/embed/schedule?view=week&week=11`).then(async (r) => ({ state: r.headers.get("x-sc-schedule-state"), html: await r.text() })),
  ]);
  const at = sched.html.indexOf(`id="scs-game-${GAME_ID}"`);
  const row = sched.html.slice(sched.html.lastIndexOf("<article", at), sched.html.indexOf("</article>", at));
  const entry = {
    step,
    t: sec(),
    api: { phase: api.game.phase, score: [api.game.away.score, api.game.home.score], clock: api.game.clock, period: api.game.period, label: api.game.label, readAt: api.game.scoreReadAtMs, lastVerified: api.game.lastVerified },
    schedule: { state: sched.state, row: (row.match(/<span class="scs-game-status"[^>]*>(.*?)<\/span><\/div>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim(), score: [...row.matchAll(/scs-game-score">(\d+)</g)].map((m) => Number(m[1])) },
    fresh: {},
    honoring: {},
    observed: {},
    tabs: {
      week: { ...(await tabs.week.read()), visibility: await tabs.week.visible() },
      h2h: { ...(await tabs.h2h.read()), visibility: await tabs.h2h.visible() },
    },
  };
  for (const p of [WEEK, H2H]) {
    const key = p === WEEK ? "week" : "h2h";
    const res = await fetch(`${app.origin}/embed/matchup/${PAIR}${p === WEEK ? "?game=2026-week-11" : ""}`, { headers: { "X-SC-Matchup-Preview": "1" } });
    entry.fresh[key] = { status: res.status, cacheState: res.headers.get("x-sc-matchup-cache-state"), changeAt: res.headers.get("x-sc-matchup-change-at"), kind: res.headers.get("x-matchup-game"), state: res.headers.get("x-matchup-state"), strip: strip(await res.text()) };
    const e1 = await viaEdge("honoring", `/embed/matchup/${PAIR}${p === WEEK ? "?game=2026-week-11" : ""}`);
    const e2 = await viaEdge("observed", `/embed/matchup/${PAIR}${p === WEEK ? "?game=2026-week-11" : ""}`);
    entry.honoring[key] = { edge: e1.edge, age: e1.age, ttl: e1.ttl, phase: e1.strip?.phase ?? (e1.kind === "archived" ? "final (box score)" : null) };
    entry.observed[key] = { edge: e2.edge, age: e2.age, phase: e2.strip?.phase ?? (e2.kind === "archived" ? "final (box score)" : null) };
  }
  timeline.push(entry);
  console.error(`[${entry.t}s] ${step}: api=${entry.api.phase} ${entry.api.score.join("-")} ${entry.api.clock ?? ""} | sched=${entry.schedule.row} | tab week=${entry.tabs.week?.phase} "${entry.tabs.week?.text ?? ""}" | tab h2h=${entry.tabs.h2h?.phase} | edge(honoring) week=${entry.honoring.week.phase} ${entry.honoring.week.edge} | edge(observed) week=${entry.observed.week.phase} ${entry.observed.week.edge}`);
}

const tabs = {};
try {
  // Warm the edge models and open the tabs a minute before kickoff: the
  // "preview cached shortly before kickoff" case.
  while (Date.now() < kick - 60_000) await sleep(500);
  tabs.week = await openTab(CDP_PORTS[0], `${app.origin}${WEEK}`);
  tabs.h2h = await openTab(CDP_PORTS[1], `${app.origin}${H2H}`);
  await sleep(4000);
  await observe("pregame, a minute before kickoff (tabs opened, edges warmed)");

  while (Date.now() < kick + 2_000) await sleep(500);
  source.event = ev({ state: "in", name: "STATUS_IN_PROGRESS", detail: "14:55 - 1st", period: 1 });
  await sleep(35_000);
  await observe("kickoff: in progress");

  source.event = ev({ state: "in", name: "STATUS_HALFTIME", detail: "Halftime", period: 2, away: 10, home: 7 });
  await sleep(35_000);
  await observe("halftime");

  source.event = ev({ state: "in", name: "STATUS_IN_PROGRESS", detail: "8:30 - 3rd", period: 3, away: 17, home: 10 });
  await sleep(35_000);
  await observe("second half");

  source.event = ev({ state: "in", name: "STATUS_IN_PROGRESS", detail: "5:00 - OT", period: 5, away: 20, home: 20 });
  await sleep(35_000);
  await observe("overtime");

  source.refuse = true;
  await sleep(35_000);
  await observe("ESPN refusing (pending after the 20 s replay staleness)");
  source.refuse = false;

  source.event = ev({ state: "post", completed: true, name: "STATUS_FINAL", detail: "Final/OT", period: 5, away: 23, home: 20 });
  await sleep(35_000);
  await observe("final/OT");

  source.event = ev({ state: "post", completed: true, name: "STATUS_FINAL", detail: "Final/OT", period: 5, away: 26, home: 20 });
  await sleep(QUICK ? 5_000 : 5.5 * 60_000);
  await observe(QUICK ? "corrected final (fresh only; --quick)" : "corrected final (open tab after its 5-minute check)");

  source.event = ev({ state: "in", name: "STATUS_IN_PROGRESS", detail: "2:00 - 4th", period: 4, away: 17, home: 17 });
  await sleep(10_000);
  await observe("an older in-progress response after the final");

  const events = await (await fetch(`${app.origin}/api/game-events`, { headers: { "x-ingest-secret": "web040-replay" } })).json();
  console.log(JSON.stringify({ kickoff: new Date(kick).toISOString(), timeline, purgeEvents: events.events.filter((e) => e.gameId === GAME_ID) }, null, 2));
} finally {
  tabs.week?.close();
  tabs.h2h?.close();
  await cleanup();
}
