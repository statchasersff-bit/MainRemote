/**
 * WEB-040: the schedule prints the status the sources agree on, never a stale
 * clock beside a final.
 *
 * 2026-11-19, Week 11: IND @ HOU ended 3-26 and the weekly board printed the
 * right score beside "12:04 - 4TH". The live layer's last word on the game was
 * a fourth-quarter clock; nflverse then posted the final; the board took its
 * status from the feed and its words from the layer. These tests replay that:
 *
 *   - game-status.ts directly, for every branch of the rule;
 *   - the running server, with nflverse's real Week 11 rows and an ESPN
 *     scoreboard that still carries IND @ HOU at 12:04 of the 4th with the
 *     final score, and a genuinely live CIN @ WAS 4th quarter;
 *   - the warm-cache live-to-final transition: a week page rendered (and its
 *     ETag taken) while CIN @ WAS is live, then the scoreboard goes final and
 *     the same requests must not get the cached clock back.
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

/* ------------------------------------------------------------ the helper */

describe("game-status.ts", () => {
  let gs;
  before(async () => {
    gs = await importModule("lib/schedule/game-status");
  });
  after(cleanupBundles);

  const NOW = Date.UTC(2026, 10, 20, 4, 0, 0);
  const KICK = Date.UTC(2026, 10, 20, 1, 15, 0);

  test("a feed final with a fourth-quarter clock still in the layer prints Final", () => {
    const r = gs.resolveGameStatus({
      feedFinal: true,
      feedOvertime: false,
      live: { state: "in", completed: false, detail: "12:04 - 4th", period: 4, seenAtMs: NOW - gs.LIVE_STALE_MS - 1, awayScore: 3 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(r.status, "final");
    assert.equal(r.detail, "Final");
    assert.equal(r.confirmed, true);
    assert.equal(r.liveScoreUsable, false, "the feed's final score, not the layer's mid-game one");
  });

  test("an ESPN final that keeps a clock string prints Final, and overtime survives", () => {
    const clock = gs.resolveGameStatus({
      feedFinal: false,
      feedOvertime: false,
      live: { state: "post", completed: true, detail: "12:04 - 4th", period: 4, seenAtMs: NOW, awayScore: 3 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(clock.detail, "Final");
    const ot = gs.resolveGameStatus({
      feedFinal: false,
      feedOvertime: false,
      live: { state: "post", completed: true, detail: "Final/OT", period: 5, seenAtMs: NOW, awayScore: 20 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(ot.detail, "Final/OT");
    const byPeriod = gs.resolveGameStatus({
      feedFinal: true,
      feedOvertime: false,
      live: { state: "post", completed: true, detail: "0:00 - OT", period: 5, seenAtMs: NOW, awayScore: 20 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(byPeriod.detail, "Final/OT");
    const byFeed = gs.resolveGameStatus({ feedFinal: true, feedOvertime: true, live: undefined, kickoffMs: KICK, nowMs: NOW });
    assert.equal(byFeed.detail, "Final/OT");
  });

  test("feed scores beside a fresh ESPN in-progress read are partial: the clock stays", () => {
    // nflverse has no completion flag; ESPN does, and it says still playing.
    const r = gs.resolveGameStatus({
      feedFinal: true,
      feedOvertime: false,
      live: { state: "in", completed: false, detail: "6:11 - 4th", period: 4, seenAtMs: NOW - 20_000, awayScore: 17 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(r.status, "live");
    assert.equal(r.detail, "6:11 - 4th");
    assert.equal(r.liveScoreUsable, true, "ESPN's live score, not the feed's partial one");
    const espnFinal = gs.resolveGameStatus({
      feedFinal: false,
      feedOvertime: false,
      live: { state: "post", completed: false, statusName: "STATUS_FINAL", detail: "Final", period: 4, seenAtMs: NOW, awayScore: 3 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(espnFinal.status, "final", "STATUS_FINAL is ESPN's explicit completion");
  });

  test("the page policy: live, pregame until the next kickoff, settled", () => {
    const g = (status, kickoffMs, extra = {}) => ({ status, statusDetail: null, statusConfirmed: true, kickoffMs, ...extra });
    assert.deepEqual(gs.schedulePagePolicy([g("final", KICK), g("scheduled", NOW + 3600_000), g("scheduled", NOW + 7200_000)], NOW), {
      state: "pregame",
      nextKickoffMs: NOW + 3600_000,
    });
    assert.equal(gs.schedulePagePolicy([g("final", KICK), g("live", KICK)], NOW).state, "live");
    assert.equal(gs.schedulePagePolicy([g("scheduled", NOW - 1000)], NOW).state, "live", "kicked off, no word yet");
    assert.equal(gs.schedulePagePolicy([g("scheduled", NOW - 1000, { statusConfirmed: false })], NOW).state, "live");
    assert.equal(gs.schedulePagePolicy([g("final", KICK), g("canceled", null)], NOW).state, "settled");
    assert.deepEqual(gs.schedulePagePolicy([g("postponed", null)], NOW), { state: "pregame", nextKickoffMs: null });
  });

  test("a fresh live clock, halftime and a delay print what ESPN says", () => {
    const at = (detail, extra = {}) =>
      gs.resolveGameStatus({
        feedFinal: false,
        feedOvertime: false,
        live: { state: "in", completed: false, detail, period: 4, seenAtMs: NOW - 30_000, awayScore: 3, ...extra },
        kickoffMs: KICK,
        nowMs: NOW,
      });
    const live = at("12:04 - 4th");
    assert.equal(live.status, "live");
    assert.equal(live.detail, "12:04 - 4th");
    assert.equal(live.confirmed, true);
    assert.equal(live.observedAtMs, NOW - 30_000);
    assert.equal(at("Halftime").detail, "Halftime");
    assert.equal(at("Delayed", { statusName: "STATUS_DELAYED" }).detail, "Delayed");
  });

  test("a live entry nobody has refreshed for ten minutes is pending, not a clock", () => {
    const r = gs.resolveGameStatus({
      feedFinal: false,
      feedOvertime: false,
      live: { state: "in", completed: false, detail: "12:04 - 4th", period: 4, seenAtMs: NOW - gs.LIVE_STALE_MS - 1, awayScore: 3 },
      kickoffMs: KICK,
      nowMs: NOW,
    });
    assert.equal(r.confirmed, false);
    assert.equal(r.detail, null);
    assert.equal(gs.gameStatusLabel({ status: r.status, statusDetail: r.detail, statusConfirmed: r.confirmed }), "Status pending");
  });

  test("scheduled shows the kickoff until it is well past; postponed and canceled say so", () => {
    const ahead = gs.resolveGameStatus({ feedFinal: false, feedOvertime: false, live: undefined, kickoffMs: NOW + 3600_000, nowMs: NOW });
    assert.equal(ahead.status, "scheduled");
    assert.equal(gs.gameStatusLabel({ status: "scheduled", statusDetail: ahead.detail, statusConfirmed: ahead.confirmed }), null);
    const past = gs.resolveGameStatus({ feedFinal: false, feedOvertime: false, live: undefined, kickoffMs: NOW - gs.KICKOFF_GRACE_MS - 1, nowMs: NOW });
    assert.equal(past.confirmed, false);
    const pre = { state: "pre", completed: false, detail: "11/19 - 8:15 PM EST", seenAtMs: NOW, awayScore: 0 };
    const pp = gs.resolveGameStatus({ feedFinal: false, feedOvertime: false, live: { ...pre, state: "post", statusName: "STATUS_POSTPONED" }, kickoffMs: KICK, nowMs: NOW });
    assert.equal(pp.status, "postponed");
    assert.equal(gs.gameStatusLabel({ status: pp.status, statusDetail: pp.detail }), "Postponed");
    const cx = gs.resolveGameStatus({ feedFinal: false, feedOvertime: false, live: { ...pre, statusName: "STATUS_CANCELED" }, kickoffMs: KICK, nowMs: NOW });
    assert.equal(cx.status, "canceled");
  });
});

/* ------------------------------------------------------ the server replay */

const IND_HOU = "401873066";
const CIN_WAS = "401873078";
const WEEK12_ESPN = "409990012";

/** Today in US Eastern, as nflverse files a game day. */
function easternDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

/**
 * nflverse's real Week 11, with CIN @ WAS moved to today at 00:01 ET (the
 * live layer re-reads only today's and yesterday's weeks between full sweeps,
 * so a replay run on any later date still has a live week to re-read), its
 * scores optionally filled in, and one synthetic Week 12 game three days out
 * for the pregame policy.
 */
function week11Csv({ cinWasScores = null } = {}) {
  const text = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2026-week11.csv"), "utf8");
  const [header, ...rows] = text.trim().split("\n");
  const cols = header.split(",");
  const at = (name) => cols.indexOf(name);
  const out = rows.map((line) => {
    if (!line.startsWith("2026_11_CIN_WAS,")) return line;
    const cells = line.split(",");
    cells[at("gameday")] = easternDate();
    cells[at("gametime")] = "00:01";
    if (cinWasScores) {
      cells[at("away_score")] = String(cinWasScores[0]);
      cells[at("home_score")] = String(cinWasScores[1]);
    }
    return cells.join(",");
  });
  const w12 = rows.find((line) => line.startsWith("2026_11_IND_HOU,")).split(",");
  w12[at("game_id")] = "2026_12_HOU_IND";
  w12[at("week")] = "12";
  w12[at("gameday")] = easternDate(Date.now() + 3 * 86400_000);
  w12[at("gametime")] = "13:00";
  w12[at("away_team")] = "HOU";
  w12[at("home_team")] = "IND";
  w12[at("away_score")] = "";
  w12[at("home_score")] = "";
  w12[at("espn")] = WEEK12_ESPN;
  return [header, ...out, w12.join(",")].join("\n") + "\n";
}

function event(id, { state, completed, name, shortDetail, period, clock, away, home }) {
  return {
    id,
    date: "2026-11-20T01:15Z",
    status: {
      clock,
      displayClock: clock === undefined ? undefined : `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}`,
      period,
      type: { name, state, completed, shortDetail, detail: shortDetail },
    },
    competitions: [
      {
        timeValid: true,
        competitors: [
          { homeAway: "home", score: String(home) },
          { homeAway: "away", score: String(away) },
        ],
        broadcasts: [{ names: ["Prime Video"] }],
      },
    ],
  };
}

/** IND @ HOU's read at 12:04 of the 4th - the one that sat beside the final on 2026-11-19. */
const IND_HOU_4TH = event(IND_HOU, {
  state: "in", completed: false, name: "STATUS_IN_PROGRESS", shortDetail: "12:04 - 4th", period: 4, clock: 724, away: 3, home: 26,
});

/** ESPN's final for the same game, still carrying the 4th-quarter period and clock. */
const IND_HOU_ESPN_FINAL = event(IND_HOU, {
  state: "post", completed: true, name: "STATUS_FINAL", shortDetail: "Final", period: 4, clock: 724, away: 3, home: 26,
});

const CIN_WAS_LIVE = event(CIN_WAS, {
  state: "in", completed: false, name: "STATUS_IN_PROGRESS", shortDetail: "6:11 - 4th", period: 4, clock: 371, away: 17, home: 17,
});

const CIN_WAS_FINAL_OT = event(CIN_WAS, {
  // ESPN's final word; the payload still carries the last period and clock.
  state: "post", completed: true, name: "STATUS_FINAL", shortDetail: "Final/OT", period: 5, clock: 0, away: 20, home: 17,
});

/** The visible status words of one game row. */
function rowStatus(html, gameId) {
  const at = html.indexOf(`id="scs-game-${gameId}"`);
  assert.ok(at > 0, `row ${gameId} missing`);
  const row = html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
  const cell = row.match(/<span class="scs-game-status"([^>]*)>(.*?)<\/span><\/div>/);
  assert.ok(cell, row.slice(0, 400));
  return {
    row,
    attrs: cell[1],
    text: cell[2].replace(/<[^>]+>/g, "").trim(),
    status: row.match(/data-status="([a-z]+)"/)?.[1],
  };
}

/** A fake nflverse + ESPN, and the app in front of them. */
async function replay({ csv, scoreboard, timing }) {
  const layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-web040-"));
  const upstream = http.createServer((req, res) => {
    if (req.url === "/games.csv") {
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(csv.text);
    } else if (req.url.startsWith("/espn/apis/site/v2/sports/football/nfl/scoreboard")) {
      if (scoreboard.refuse) {
        res.writeHead(403);
        res.end();
        return;
      }
      const week = new URL(req.url, "http://x").searchParams.get("week");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(week === "11" ? { events: scoreboard.events } : { events: [] }));
    } else {
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
  });
  return {
    get: (p, headers = {}) => fetch(`${server.origin}${p}`, { headers }),
    async stop() {
      await server.stop();
      await new Promise((resolve) => upstream.close(resolve));
      fs.rmSync(layerDir, { recursive: true, force: true });
    },
  };
}

const PAGE = "/schedule/week-11";
const FRAGMENT = "/embed/schedule?view=week&week=11";

/** Poll until `done(html)` or the deadline; returns the last body. */
async function until(get, p, done, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const html = await (await get(p)).text();
    if (done(html) || Date.now() > deadline) return html;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe("schedule routes, Week 11 with ESPN reachable", () => {
  let app;
  // CIN @ WAS carries partial feed scores (10-7) while ESPN reads it live.
  const csv = { text: week11Csv({ cinWasScores: [10, 7] }) };
  const scoreboard = { events: [IND_HOU_ESPN_FINAL, CIN_WAS_LIVE], refuse: false };
  before(async () => {
    app = await replay({ csv, scoreboard, timing: { liveTtlMs: 500 } });
  });
  after(async () => app?.stop());

  test("ESPN's final keeps a 4th-quarter period and clock: FINAL on both routes", async () => {
    for (const p of [PAGE, FRAGMENT]) {
      const res = await app.get(p);
      assert.equal(res.status, 200, p);
      const game = rowStatus(await res.text(), "2026_11_IND_HOU");
      assert.equal(game.text, "FINAL", `${p}: ${game.text}`);
      assert.doesNotMatch(game.row, /12:04/, p);
      assert.doesNotMatch(game.attrs, /data-kickoff/, `${p}: the browser must not relabel a final`);
      assert.match(game.row, /3 to 26, Thu, Nov 19, FINAL/, "the spoken line agrees");
    }
  });

  test("a fresh live 4th quarter beside partial feed scores keeps its clock, ESPN's score and the stamp", async () => {
    const res = await app.get(FRAGMENT);
    assert.equal(res.headers.get("x-sc-schedule-state"), "live");
    assert.match(res.headers.get("cache-control") ?? "", /max-age=30\b/);
    const html = await res.text();
    const game = rowStatus(html, "2026_11_CIN_WAS");
    assert.equal(game.text, "6:11 - 4TH");
    assert.equal(game.status, "live");
    assert.match(game.row, /scs-live-dot/);
    assert.match(game.row, /<strong class="scs-game-score">17<\/strong>/, "ESPN's 17-17, not the feed's 10-7");
    assert.doesNotMatch(game.row, /<strong class="scs-game-score">10<\/strong>/);
    assert.match(html, /<p class="scs-updated"><time datetime="[^"]+">Updated \d{1,2}:\d{2} [AP]M ET<\/time><\/p>/);
  });

  test("the season hub carries no clock and its policy follows the season", async () => {
    for (const p of ["/schedule", "/embed/schedule?view=matrix"]) {
      const res = await app.get(p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get("x-sc-schedule-state"), "live", `${p}: a game in the season is live`);
      const html = await res.text();
      assert.match(html, /scs-matrix/, p);
      assert.doesNotMatch(html, /12:04|6:11/, p);
    }
  });

  test("a week still to come is pregame until its kickoff", async () => {
    const res = await app.get("/embed/schedule?view=week&week=12");
    assert.equal(res.headers.get("x-sc-schedule-state"), "pregame");
    const kickoff = Number(res.headers.get("x-sc-schedule-next-kickoff"));
    assert.ok(kickoff * 1000 > Date.now() + 2 * 86400_000, `next kickoff ${kickoff}`);
    assert.match(res.headers.get("cache-control") ?? "", /max-age=300\b/);
  });

  test("warm cache: live to final replaces the clock on both routes; the week settles", async () => {
    const warm = {};
    for (const p of [PAGE, FRAGMENT]) {
      const res = await app.get(p);
      assert.equal(rowStatus(await res.text(), "2026_11_CIN_WAS").text, "6:11 - 4TH", p);
      warm[p] = res.headers.get("etag");
      assert.ok(warm[p], `${p} has an ETag`);
    }

    scoreboard.events = [IND_HOU_ESPN_FINAL, CIN_WAS_FINAL_OT];
    await until(app.get, FRAGMENT, (html) => !/6:11/.test(html));

    for (const p of [PAGE, FRAGMENT]) {
      const res = await app.get(p, { "If-None-Match": warm[p] });
      assert.equal(res.status, 200, `${p}: the old ETag must not revalidate the live render`);
      assert.notEqual(res.headers.get("etag"), warm[p]);
      assert.equal(res.headers.get("x-sc-schedule-state"), "settled", p);
      assert.match(res.headers.get("cache-control") ?? "", /max-age=300\b/);
      const body = await res.text();
      const game = rowStatus(body, "2026_11_CIN_WAS");
      assert.equal(game.text, "FINAL/OT", p);
      assert.doesNotMatch(game.row, /6:11|scs-live-dot/, p);
      assert.match(game.row, /<strong class="scs-game-score">20<\/strong>/);
      assert.doesNotMatch(body, /class="scs-updated"/, `${p}: no live game, no stamp`);
    }
    const hub = await app.get("/embed/schedule?view=matrix");
    assert.equal(hub.headers.get("x-sc-schedule-state"), "pregame", "the hub waits for Week 12");
  });
});

describe("schedule routes, Week 11 after ESPN stops answering (the 2026-11-19 incident)", () => {
  let app;
  const csv = { text: week11Csv() };
  const scoreboard = { events: [IND_HOU_4TH, CIN_WAS_LIVE], refuse: false };
  before(async () => {
    app = await replay({ csv, scoreboard, timing: { liveTtlMs: 300, staleMs: 1500 } });
  });
  after(async () => app?.stop());

  test("IND @ HOU 3-26 with ESPN's last read at 12:04 of the 4th prints FINAL once that read is stale", async () => {
    // While the read is fresh it is the better evidence: the game is on.
    const fresh = rowStatus(await (await app.get(FRAGMENT)).text(), "2026_11_IND_HOU");
    assert.equal(fresh.text, "12:04 - 4TH");

    scoreboard.refuse = true;
    await until(app.get, FRAGMENT, (html) => !/12:04/.test(html));

    for (const p of [PAGE, FRAGMENT]) {
      const res = await app.get(p);
      const html = await res.text();
      const game = rowStatus(html, "2026_11_IND_HOU");
      assert.equal(game.text, "FINAL", `${p}: ${game.text}`);
      assert.equal(game.status, "final");
      assert.doesNotMatch(game.row, /12:04/, p);
      assert.match(game.row, /<strong class="scs-game-score">3<\/strong>/);
      assert.match(game.row, /<strong class="scs-game-score">26<\/strong>/);
      assert.match(game.row, /3 to 26, Thu, Nov 19, FINAL/);

      // CIN @ WAS has no final anywhere and a stale clock: neutral words.
      const pending = rowStatus(html, "2026_11_CIN_WAS");
      assert.equal(pending.text, "STATUS PENDING", p);
      assert.equal(pending.status, "pending");
      assert.doesNotMatch(pending.row, /6:11|scs-live-dot|scs-game-score/, `${p}: no stale clock or score`);
      assert.doesNotMatch(pending.attrs, /data-kickoff/);
      assert.equal(res.headers.get("x-sc-schedule-state"), "live", "pending is short-lived");
      assert.doesNotMatch(html, /class="scs-updated"/, "no confirmed live clock, no stamp");
    }
  });
});
