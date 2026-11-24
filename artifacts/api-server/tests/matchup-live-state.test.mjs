/**
 * WEB-040 / WEB-003 (2026-11-24): one stable URL per game, live on every
 * matchup surface, and caches that follow the game.
 *
 * The audit (Colts at Texans, 2026-11-19): the head-to-head page showed the
 * preview through the whole game, the week URL answered 404 until 11:13 PM ET,
 * three cache refreshes during the game still produced a preview, and the
 * schedule printed the final beside a frozen "12:04 - 4TH".
 *
 * These tests replay one game through the running server, with nflverse and
 * ESPN as local fakes the test changes step by step:
 *   scheduled -> live -> halftime -> overtime -> ESPN stops answering
 *   (pending, last verified score kept) -> final/OT -> corrected final ->
 *   an older in-progress response after the final (ignored),
 * and at each step checks that the week page, the head-to-head page's strip,
 * the schedule row and /api/game-state/<id> say the same thing, with the
 * cache state each surface sends. A second replay covers a final whose box
 * score has not arrived. game-state.ts and pair.ts are checked directly too.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------- the helpers */

describe("game-state.ts and the link rule", () => {
  let gs;
  let pair;
  before(async () => {
    gs = await importModule("lib/matchup/game-state");
    pair = await importModule("lib/matchup/pair");
  });
  after(cleanupBundles);

  const NOW = Date.UTC(2026, 10, 20, 3, 0, 0);
  const KICK = Date.UTC(2026, 10, 20, 1, 15, 0);
  const row = (over) => ({
    id: "2026_11_IND_HOU", espnId: "401873066", week: 11, awayCode: "IND", homeCode: "HOU",
    awayScore: null, homeScore: null, kickoffMs: KICK, status: "scheduled", statusDetail: null,
    statusConfirmed: true, statusObservedAtMs: null, liveLastSeen: null, ...over,
  });
  const rec = (over, detailsReady = null) => gs.gameStateRecord(row(over), { season: 2026, seasonType: "regular", detailsReady });

  test("each phase prints only what the source supports", () => {
    const live = rec({ status: "live", statusDetail: "12:04 - 4th", awayScore: 3, homeScore: 26, statusObservedAtMs: NOW - 5000 });
    assert.deepEqual([live.phase, live.clock, live.period, live.away.score, live.home.score], ["live", "12:04", "4th", 3, 26]);
    assert.equal(live.scoreReadAtMs, NOW - 5000);

    const half = rec({ status: "live", statusDetail: "Halftime", awayScore: 3, homeScore: 13 });
    assert.deepEqual([half.phase, half.clock, half.period], ["halftime", null, "Halftime"], "no clock at halftime");

    const delayed = rec({ status: "scheduled", statusDetail: "Delayed" });
    assert.deepEqual([delayed.phase, delayed.clock, delayed.away.score], ["delayed", null, null]);

    const ot = rec({ status: "live", statusDetail: "5:00 - OT", awayScore: 20, homeScore: 20, statusObservedAtMs: NOW });
    assert.equal(gs.stripParts(ot).status, "Overtime, 5:00");

    const pending = rec({ status: "live", statusConfirmed: false, liveLastSeen: { awayScore: 3, homeScore: 26, detail: "12:04 - 4th", seenAtMs: NOW - 20 * 60_000 } });
    assert.equal(pending.phase, "pending");
    assert.equal(pending.clock, null, "a stale clock is never printed");
    assert.equal(pending.away.score, null, "a stale score is never printed as the score");
    assert.deepEqual(pending.lastVerified, { away: 3, home: 26, label: "12:04 - 4th", atMs: NOW - 20 * 60_000 });

    const postponed = rec({ status: "postponed", statusDetail: "Postponed" });
    assert.deepEqual([postponed.phase, postponed.clock, postponed.away.score], ["postponed", null, null]);

    const final = rec({ status: "final", statusDetail: "Final/OT", awayScore: 3, homeScore: 26 }, true);
    assert.deepEqual([final.phase, final.label, final.clock, final.period], ["final", "Final/OT", null, null]);
  });

  test("open tabs poll only while the game can change", () => {
    assert.deepEqual(gs.pollPlan(rec({}), KICK - 3 * 3600_000), { active: false, everyMs: 0 }, "hours before kickoff");
    assert.deepEqual(gs.pollPlan(rec({}), KICK - 10 * 60_000), { active: true, everyMs: 30_000 }, "ten minutes before");
    assert.equal(gs.pollPlan(rec({ status: "live", statusDetail: "Halftime" }), NOW).everyMs, 30_000);
    assert.deepEqual(gs.pollPlan(rec({ status: "final", statusDetail: "Final", awayScore: 3, homeScore: 26 }, false), NOW), { active: true, everyMs: 120_000 }, "final, box score still arriving");
    assert.deepEqual(gs.pollPlan(rec({ status: "final", statusDetail: "Final", awayScore: 3, homeScore: 26 }, true), NOW), { active: true, everyMs: 300_000 }, "final with its box score: every five minutes for a correction");
    assert.equal(gs.pollPlan(rec({ status: "final", statusDetail: "Final", awayScore: 3, homeScore: 26 }, true), KICK + 60 * 3600_000).active, false, "after 48 hours: stop");
  });

  test("the cache policy: a preview expires at kickoff, live is short, a final is recent for 48 hours", () => {
    const pre = gs.matchupCachePolicy(rec({}), KICK - 60_000);
    assert.deepEqual(pre, { state: "pregame", changeAtMs: KICK }, "a preview cached a minute before kickoff is good for that minute");
    assert.equal(gs.matchupCachePolicy(rec({}), KICK + 1000).state, "live", "kicked off, no word yet");
    assert.equal(gs.matchupCachePolicy(rec({ status: "live", statusDetail: "Halftime" }), NOW).state, "live");
    const fin = (ready) => rec({ status: "final", statusDetail: "Final", awayScore: 3, homeScore: 26 }, ready);
    assert.equal(gs.matchupCachePolicy(fin(true), NOW).state, "recent");
    assert.equal(gs.matchupCachePolicy(fin(true), KICK + 60 * 3600_000).state, "settled", "after 48 hours");
    assert.equal(gs.matchupCachePolicy(fin(false), KICK + 60 * 3600_000).state, "recent", "still waiting for the box score");
    assert.deepEqual(gs.matchupCachePolicy(null, NOW, NOW + 3 * 86400_000), { state: "settled", changeAtMs: NOW + 3 * 86400_000 }, "the pair page's own flip");
  });

  test("one stable URL: every unplayed game of the season links its own dated page", () => {
    const now = Date.UTC(2026, 10, 24);
    const day = 86400_000;
    const at = (m) => ({ ...m, season: 2026 });
    const previewing = [at({ kickoffMs: now - 60 * day, isFinal: true }), at({ kickoffMs: now + 2 * day, isFinal: false })];
    assert.equal(pair.meetingLinkTarget(previewing[1], previewing, 2026, now), "own", "inside the pair page's preview window too");
    const live = [at({ kickoffMs: now - 3600_000, isFinal: false, inPlay: true })];
    assert.equal(pair.meetingLinkTarget(live[0], live, 2026, now), "own", "while it is being played");
    assert.equal(pair.meetingLinkTarget(at({ kickoffMs: now, isFinal: false, canceled: true }), [], 2026, now), "pair", "a canceled game has no page");
  });

  test("a game still in play stays the pair page's current game past the four-hour grace", () => {
    const now = Date.UTC(2026, 10, 24, 6);
    const kick = now - 5 * 3600_000;
    assert.equal(pair.isUpcomingFixture(false, kick, now), false, "no source says it is in play: grace over");
    assert.equal(pair.isUpcomingFixture(false, kick, now, true), true, "a source says in play: still current");
    assert.equal(pair.pairInPreviewMode([{ kickoffMs: kick, isFinal: false, inPlay: true }], now), true);
  });
});

/* ------------------------------------------------------ the server replay */

const CIN_WAS = "401873078";
const GAME_ID = "2026_11_CIN_WAS";
const PAIR = "cincinnati-bengals-vs-washington-commanders";
const WEEK_FRAGMENT = `/embed/matchup/${PAIR}?game=2026-week-11`;
const PAIR_FRAGMENT = `/embed/matchup/${PAIR}`;
const SCHEDULE = "/embed/schedule?view=week&week=11";

function eastern(ms, opts = {}) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ...opts }).format(new Date(ms));
}
const etTime = (ms) => eastern(ms, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** nflverse's real Week 11 with CIN @ WAS moved to `kick`, optionally scored. */
function csvWith({ kick, scores = null, extra = "" }) {
  const text = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2026-week11.csv"), "utf8");
  const [header, ...rows] = text.trim().split("\n");
  const cols = header.split(",");
  const at = (name) => cols.indexOf(name);
  const out = rows.map((line) => {
    if (!line.startsWith(`${GAME_ID},`)) return line;
    const c = line.split(",");
    c[at("gameday")] = eastern(kick);
    c[at("gametime")] = etTime(kick);
    c[at("away_score")] = scores ? String(scores[0]) : "";
    c[at("home_score")] = scores ? String(scores[1]) : "";
    return c.join(",");
  });
  return [header, ...out, ...(extra ? [extra] : [])].join("\n") + "\n";
}

function espnEvent(id, kick, { state, completed = false, name, detail, period = 0, away = 0, home = 0 }) {
  return {
    id,
    date: new Date(kick).toISOString(),
    status: { period, type: { name, state, completed, shortDetail: detail, detail } },
    competitions: [{ timeValid: true, competitors: [{ homeAway: "home", score: String(home) }, { homeAway: "away", score: String(away) }], broadcasts: [{ names: ["CBS"] }] }],
  };
}

async function replay(source, timing) {
  const layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-web040-live-"));
  const upstream = http.createServer((req, res) => {
    if (req.url === "/games.csv") {
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(source.csv);
    } else if (req.url.startsWith("/espn/apis/site/v2/sports/football/nfl/scoreboard")) {
      if (source.refuse) {
        res.writeHead(403);
        res.end();
        return;
      }
      const week = new URL(req.url, "http://x").searchParams.get("week");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ events: source.events[week] ?? [] }));
    } else {
      // The summary (box score) and anything else: not available.
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const server = await startServer({
    SC_SCHEDULE_CSV_URL: `${origin}/games.csv`,
    SC_SCHEDULE_SEASON: "2026",
    SC_ESPN_SITE_BASE: `${origin}/espn`,
    SC_SCHEDULE_ESPN: "1",
    SC_SCHEDULE_LAYER_DIR: layerDir,
    SC_SCHEDULE_TEST_TIMING: JSON.stringify(timing),
    INGEST_SECRET: "web040-test",
  });
  const get = (p, headers = {}) => fetch(`${server.origin}${p}`, { headers: { "X-SC-Matchup-Preview": "1", ...headers } });
  return {
    get,
    async stop() {
      await server.stop();
      await new Promise((resolve) => upstream.close(resolve));
      fs.rmSync(layerDir, { recursive: true, force: true });
    },
  };
}

/** The strip's attributes and words, or null when the page has none. */
function strip(html) {
  const m = html.match(/<section class="sct-gs"([^>]*)>([\s\S]*?)<\/section>/);
  if (!m) return null;
  const attr = (name) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
  return {
    phase: attr("data-phase"),
    hidden: /\shidden(\s|$)/.test(m[1]),
    text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

/** The schedule row's status words for CIN @ WAS. */
function scheduleRow(html) {
  const at = html.indexOf(`id="scs-game-${GAME_ID}"`);
  assert.ok(at > 0, "schedule row missing");
  const row = html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
  const cell = row.match(/<span class="scs-game-status"[^>]*>(.*?)<\/span><\/div>/);
  return { status: row.match(/data-status="([a-z]+)"/)?.[1], text: cell ? cell[1].replace(/<[^>]+>/g, "").trim() : "" };
}

/** Every surface, read once. */
async function surfaces(app) {
  const [api, week, pairPage, sched] = await Promise.all([
    app.get(`/api/game-state/${GAME_ID}`).then((r) => r.json()),
    app.get(WEEK_FRAGMENT),
    app.get(PAIR_FRAGMENT),
    app.get(SCHEDULE),
  ]);
  const weekHtml = await week.text();
  const pairHtml = await pairPage.text();
  return {
    game: api.game,
    poll: api.poll,
    week: { status: week.status, cache: week.headers.get("x-sc-matchup-cache-state"), changeAt: week.headers.get("x-sc-matchup-change-at"), kind: week.headers.get("x-matchup-game"), strip: strip(weekHtml), html: weekHtml },
    pair: { cache: pairPage.headers.get("x-sc-matchup-cache-state"), strip: strip(pairHtml), state: pairPage.headers.get("x-matchup-state") },
    schedule: { cache: sched.headers.get("x-sc-schedule-state"), row: scheduleRow(await sched.text()) },
  };
}

async function until(app, done, ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await surfaces(app);
    if (done(s) || Date.now() > deadline) return s;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe("one game, scheduled to corrected final, on every matchup surface", () => {
  let app;
  // Kickoff a few minutes out, today in US Eastern: the live layer re-reads
  // only today's and yesterday's weeks between full sweeps.
  const kick = Math.ceil((Date.now() + 5 * 60_000) / 60_000) * 60_000;
  const source = {
    csv: csvWith({ kick }),
    events: { 11: [espnEvent(CIN_WAS, kick, { state: "pre", name: "STATUS_SCHEDULED", detail: "Pregame" })] },
    refuse: false,
  };
  const set = (spec) => {
    source.events = { 11: [espnEvent(CIN_WAS, kick, spec)] };
  };
  const log = [];
  before(async () => {
    app = await replay(source, { liveTtlMs: 300, idleTtlMs: 300, slateTtlMs: 300, staleMs: 2000, failBackoffLiveMs: 300 });
  });
  after(async () => {
    await app?.stop();
    if (process.env.SC_WEB040_LOG) fs.writeFileSync(process.env.SC_WEB040_LOG, JSON.stringify(log, null, 2));
  });
  const record = (step, s) =>
    log.push({ step, api: { phase: s.game.phase, away: s.game.away.score, home: s.game.home.score, clock: s.game.clock, label: s.game.label }, week: { status: s.week.status, kind: s.week.kind, cache: s.week.cache, strip: s.week.strip }, pair: s.pair, schedule: s.schedule });

  test("scheduled: the week URL is a 200 preview, every surface pregame until kickoff", async () => {
    const s = await surfaces(app);
    record("scheduled", s);
    assert.equal(s.game.phase, "scheduled");
    assert.equal(s.week.status, 200, "the week URL answers before kickoff");
    assert.equal(s.week.kind, "current", "the pair page is previewing it: canonical up, as before");
    assert.equal(s.week.cache, "pregame");
    assert.equal(Number(s.week.changeAt), Math.floor(kick / 1000), "a preview is good until kickoff and not a second longer");
    assert.deepEqual([s.week.strip.phase, s.week.strip.hidden], ["scheduled", true], "the strip is there, hidden, for an open tab");
    assert.equal(s.pair.strip.phase, "scheduled");
    assert.equal(s.schedule.row.status, "scheduled");
  });

  test("live: score, quarter and clock agree on the week page, the head-to-head strip, the schedule and the API", async () => {
    set({ state: "in", name: "STATUS_IN_PROGRESS", detail: "6:11 - 2nd", period: 2, away: 7, home: 3 });
    const s = await until(app, (x) => x.game.phase === "live" && x.week.strip?.phase === "live" && x.pair.strip?.phase === "live");
    record("live", s);
    assert.deepEqual([s.game.away.score, s.game.home.score, s.game.clock, s.game.period], [7, 3, "6:11", "2nd"]);
    assert.ok(s.game.scoreReadAtMs > 0, "the source read time is carried");
    for (const st of [s.week.strip, s.pair.strip]) {
      assert.equal(st.hidden, false);
      assert.match(st.text, /LIVE|Live/);
      assert.match(st.text, /CIN 7, WAS 3/);
      assert.match(st.text, /2nd quarter, 6:11/);
      assert.match(st.text, /Score as of \d{1,2}:\d{2} [AP]M ET/);
    }
    assert.equal(s.week.cache, "live");
    assert.equal(s.pair.cache, "live");
    assert.equal(s.schedule.cache, "live");
    assert.equal(s.schedule.row.status, "live");
    assert.match(s.schedule.row.text, /6:11/);
    assert.equal(s.poll.everyMs, 30_000);
  });

  test("halftime: the reported status, no clock", async () => {
    set({ state: "in", name: "STATUS_HALFTIME", detail: "Halftime", period: 2, away: 10, home: 3 });
    const s = await until(app, (x) => x.game.phase === "halftime" && x.week.strip?.phase === "halftime");
    record("halftime", s);
    assert.equal(s.game.clock, null);
    assert.match(s.week.strip.text, /Halftime/);
    assert.doesNotMatch(s.week.strip.text, /\d+:\d{2} -|quarter, \d/);
    assert.match(s.schedule.row.text, /HALFTIME/i);
  });

  test("overtime: the period says OT", async () => {
    set({ state: "in", name: "STATUS_IN_PROGRESS", detail: "5:00 - OT", period: 5, away: 17, home: 17 });
    const s = await until(app, (x) => x.game.period === "OT" && x.week.strip?.text.includes("Overtime"));
    record("overtime", s);
    assert.match(s.week.strip.text, /CIN 17, WAS 17/);
    assert.match(s.week.strip.text, /Overtime, 5:00/);
    assert.match(s.pair.strip.text, /Overtime, 5:00/);
  });

  test("ESPN stops answering: pending, no clock, the last verified score kept as such", async () => {
    source.refuse = true;
    const s = await until(app, (x) => x.game.phase === "pending" && x.week.strip?.phase === "pending");
    record("pending", s);
    assert.equal(s.game.away.score, null);
    assert.deepEqual([s.game.lastVerified.away, s.game.lastVerified.home], [17, 17]);
    assert.match(s.week.strip.text, /Live updates are paused/);
    assert.match(s.week.strip.text, /Last verified: CIN 17, WAS 17 \(5:00 - OT\) at/);
    assert.equal(s.week.cache, "live", "still short while nobody can say");
    assert.equal(s.schedule.row.text.toUpperCase(), "STATUS PENDING");
    source.refuse = false;
  });

  test("final: the clock goes, the week URL is the game's own box score, the pair page leads with it", async () => {
    set({ state: "post", completed: true, name: "STATUS_FINAL", detail: "Final/OT", period: 5, away: 20, home: 17 });
    const s = await until(app, (x) => x.game.phase === "final" && x.week.kind === "archived");
    record("final", s);
    assert.deepEqual([s.game.away.score, s.game.home.score, s.game.label, s.game.clock], [20, 17, "Final/OT", null]);
    assert.equal(s.week.status, 200);
    assert.equal(s.week.strip, null, "with the box score in, the page is the box score: no strip");
    assert.equal(s.week.cache, "recent", "an hour at the edge for the first 48 hours");
    assert.equal(s.pair.state, "recently_completed", "the head-to-head page leads with the result");
    assert.equal(s.schedule.row.text.toUpperCase(), "FINAL/OT");
    assert.doesNotMatch(s.week.html, /5:00 - OT|Overtime, 5:00/, "no live clock anywhere on the final page");
    assert.deepEqual(s.poll, { active: true, everyMs: 300_000 }, "an open tab checks for a correction every five minutes");
  });

  test("a corrected final replaces the score everywhere", async () => {
    set({ state: "post", completed: true, name: "STATUS_FINAL", detail: "Final/OT", period: 5, away: 23, home: 17 });
    const s = await until(app, (x) => x.game.away.score === 23 && x.schedule.row.status === "final");
    record("corrected final", s);
    assert.equal(s.game.home.score, 17);
    const page = await (await app.get(WEEK_FRAGMENT)).text();
    assert.match(page, /\b23\b/);
  });

  test("an older in-progress response after the final never puts the game back in play", async () => {
    set({ state: "in", name: "STATUS_IN_PROGRESS", detail: "2:00 - 4th", period: 4, away: 17, home: 17 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const s = await surfaces(app);
    record("older update after final", s);
    assert.deepEqual([s.game.phase, s.game.away.score, s.game.home.score], ["final", 23, 17]);
    assert.equal(s.week.kind, "archived");
    assert.equal(s.schedule.row.text.toUpperCase(), "FINAL/OT");
  });

  test("each status change named the pages to purge", async () => {
    const res = await app.get("/api/game-events", { "x-ingest-secret": "web040-test" });
    const { events } = await res.json();
    const mine = events.filter((e) => e.gameId === GAME_ID);
    const steps = mine.map((e) => `${e.kind}:${e.from}->${e.to}`);
    assert.ok(steps.includes("status:scheduled->live"), steps.join(", "));
    assert.ok(steps.includes("status:live->final"), steps.join(", "));
    assert.ok(steps.includes("score:20-17->23-17"), steps.join(", "));
    assert.ok(!steps.some((x) => x.startsWith("status:final->")), "the ignored older response caused no event");
    const paths = mine[0].paths;
    for (const p of [`/nfl/${PAIR}/2026-week-11/`, `/nfl/${PAIR}/`, "/nfl/nfl-schedule/week-11/", "/nfl/nfl-schedule/", "/nfl/teams/cincinnati-bengals/schedule/", "/nfl/teams/washington-commanders/"]) {
      assert.ok(paths.includes(p), `${p} in ${paths.join(" ")}`);
    }
  });
});

describe("a final whose box score has not arrived", () => {
  let app;
  // A synthetic Week 12 game with a fake ESPN id: the feed has its final, and
  // the box score (ESPN's summary) is not available.
  const kick = Date.now() - 4 * 3600_000;
  const extra = [
    "2026_12_HOU_IND", "2026", "REG", "12", eastern(kick), "Thursday", etTime(kick), "HOU", "24", "IND", "21",
  ];
  let source;
  before(async () => {
    const text = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2026-week11.csv"), "utf8");
    const [header, ...rows] = text.trim().split("\n");
    const cols = header.split(",");
    const base = rows.find((l) => l.startsWith("2026_11_IND_HOU,")).split(",");
    const set = (name, v) => (base[cols.indexOf(name)] = v);
    const names = ["game_id", "season", "game_type", "week", "gameday", "weekday", "gametime", "away_team", "away_score", "home_team", "home_score"];
    names.forEach((n, i) => set(n, extra[i]));
    set("espn", "409990012");
    source = { csv: [header, ...rows, base.join(",")].join("\n") + "\n", events: {}, refuse: false };
    app = await replay(source, { liveTtlMs: 300, idleTtlMs: 300, slateTtlMs: 300 });
  });
  after(async () => app?.stop());

  test("the final shows at once, says the stats are still arriving, keeps checking, and stays short-lived", async () => {
    const api = await (await app.get("/api/game-state/2026_12_HOU_IND")).json();
    assert.deepEqual([api.game.phase, api.game.away.score, api.game.home.score, api.game.detailsReady], ["final", 24, 21, false]);
    assert.deepEqual(api.poll, { active: true, everyMs: 120_000 });
    const week = await app.get("/embed/matchup/houston-texans-vs-indianapolis-colts?game=2026-week-12");
    assert.equal(week.status, 200, "the week URL serves the final before the box score");
    assert.equal(week.headers.get("x-sc-matchup-cache-state"), "recent");
    const s = strip(await week.text());
    assert.equal(s.phase, "final");
    assert.match(s.text, /HOU 24, IND 21/);
    assert.match(s.text, /Detailed stats are still arriving/);
  });

  test("an unknown or impossible game is a 404 everywhere", async () => {
    assert.equal((await app.get("/api/game-state/2026_99_DET_GB")).status, 404);
    assert.equal((await app.get("/api/game-state/nonsense")).status, 404);
    assert.equal((await app.get("/embed/matchup/detroit-lions-vs-green-bay-packers?game=2026-week-99")).status, 404);
  });
});
