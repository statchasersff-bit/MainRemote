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
      live: { state: "in", completed: false, detail: "12:04 - 4th", period: 4, seenAtMs: NOW - 60_000, awayScore: 3 },
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

/** Today in US Eastern, as nflverse files a game day. */
function easternToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * nflverse's real Week 11, with CIN @ WAS moved to today at 00:01 ET: the live
 * layer re-reads only today's and yesterday's weeks between full sweeps, so a
 * replay run on any later date still has a live week to re-read.
 */
function week11Csv() {
  const text = fs.readFileSync(path.join(HERE, "fixtures", "schedule-2026-week11.csv"), "utf8");
  const [header, ...rows] = text.trim().split("\n");
  const cols = header.split(",");
  const at = (name) => cols.indexOf(name);
  return [
    header,
    ...rows.map((line) => {
      if (!line.startsWith("2026_11_CIN_WAS,")) return line;
      const cells = line.split(",");
      cells[at("gameday")] = easternToday();
      cells[at("gametime")] = "00:01";
      return cells.join(",");
    }),
  ].join("\n") + "\n";
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

/** The 12:04-of-the-4th entry that sat beside the final on 2026-11-19. */
const IND_HOU_STALE_CLOCK = event(IND_HOU, {
  state: "in",
  completed: false,
  name: "STATUS_IN_PROGRESS",
  shortDetail: "12:04 - 4th",
  period: 4,
  clock: 724,
  away: 3,
  home: 26,
});

const CIN_WAS_LIVE = event(CIN_WAS, {
  state: "in",
  completed: false,
  name: "STATUS_IN_PROGRESS",
  shortDetail: "6:11 - 4th",
  period: 4,
  clock: 371,
  away: 17,
  home: 17,
});

const CIN_WAS_FINAL_OT = event(CIN_WAS, {
  state: "post",
  completed: true,
  name: "STATUS_FINAL",
  // ESPN's final word; the payload still carries the last period and clock.
  shortDetail: "Final/OT",
  period: 5,
  clock: 0,
  away: 20,
  home: 17,
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

describe("schedule routes, Week 11 replay", () => {
  let upstream;
  let server;
  let layerDir;
  const scoreboard = { events: [IND_HOU_STALE_CLOCK, CIN_WAS_LIVE] };

  before(async () => {
    layerDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-web040-"));
    const csv = week11Csv();
    upstream = http.createServer((req, res) => {
      if (req.url === "/games.csv") {
        res.writeHead(200, { "Content-Type": "text/csv" });
        res.end(csv);
      } else if (req.url.startsWith("/espn/apis/site/v2/sports/football/nfl/scoreboard")) {
        const week = new URL(req.url, "http://x").searchParams.get("week");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(week === "11" ? scoreboard : { events: [] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${upstream.address().port}`;
    server = await startServer({
      SC_SCHEDULE_CSV_URL: `${origin}/games.csv`,
      SC_SCHEDULE_SEASON: "2026",
      SC_ESPN_SITE_BASE: `${origin}/espn`,
      SC_SCHEDULE_ESPN: "1",
      SC_SCHEDULE_LAYER_DIR: layerDir,
      SC_SCHEDULE_ESPN_LIVE_TTL_MS: "500",
    });
  });

  after(async () => {
    await server?.stop();
    await new Promise((resolve) => upstream?.close(resolve));
    fs.rmSync(layerDir, { recursive: true, force: true });
  });

  const get = (p, headers = {}) => fetch(`${server.origin}${p}`, { headers });

  test("IND @ HOU 3-26 prints Final on the week page and the fragment, never 12:04", async () => {
    for (const p of ["/schedule/week-11", "/embed/schedule?view=week&week=11"]) {
      const res = await get(p);
      assert.equal(res.status, 200, p);
      const html = await res.text();
      const game = rowStatus(html, "2026_11_IND_HOU");
      assert.equal(game.text, "FINAL", `${p}: ${game.text}`);
      assert.equal(game.status, "final");
      assert.doesNotMatch(game.row, /12:04/, p);
      assert.doesNotMatch(game.attrs, /data-kickoff/, `${p}: the browser must not relabel a final`);
      assert.match(game.row, /<strong class="scs-game-score">3<\/strong>/);
      assert.match(game.row, /<strong class="scs-game-score">26<\/strong>/);
      assert.match(game.row, /3 to 26, Thu, Nov 19, FINAL/, "the spoken line agrees");
    }
  });

  test("the season hub renders from the same status and carries no clock", async () => {
    for (const p of ["/schedule", "/embed/schedule?view=matrix"]) {
      const res = await get(p);
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.match(html, /scs-matrix/, p);
      assert.doesNotMatch(html, /12:04/, p);
    }
  });

  test("a genuinely live 4th quarter keeps its clock, dot, score and Updated stamp", async () => {
    const res = await get("/embed/schedule?view=week&week=11");
    assert.equal(res.headers.get("x-sc-schedule-volatile"), "1");
    assert.match(res.headers.get("cache-control") ?? "", /max-age=30\b/);
    const html = await res.text();
    const game = rowStatus(html, "2026_11_CIN_WAS");
    assert.equal(game.text, "6:11 - 4TH");
    assert.equal(game.status, "live");
    assert.match(game.row, /scs-live-dot/);
    assert.match(game.row, /<strong class="scs-game-score">17<\/strong>/);
    assert.match(html, /<p class="scs-updated"><time datetime="[^"]+">Updated \d{1,2}:\d{2} [AP]M ET<\/time><\/p>/);
  });

  test("warm cache: live to final replaces the clock on both routes and the ETag moves", async () => {
    const page = "/schedule/week-11";
    const fragment = "/embed/schedule?view=week&week=11";
    const warm = {};
    for (const p of [page, fragment]) {
      const res = await get(p);
      const html = await res.text();
      assert.equal(rowStatus(html, "2026_11_CIN_WAS").text, "6:11 - 4TH", p);
      warm[p] = res.headers.get("etag");
      assert.ok(warm[p], `${p} has an ETag`);
    }

    scoreboard.events = [IND_HOU_STALE_CLOCK, CIN_WAS_FINAL_OT];
    // Past the (test-shortened) live TTL. The first request after it starts
    // the refresh; poll until the layer has landed.
    let html = "";
    const deadline = Date.now() + 10_000;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      html = await (await get(fragment)).text();
      if (!/6:11/.test(html) || Date.now() > deadline) break;
    }

    for (const p of [page, fragment]) {
      const res = await get(p, { "If-None-Match": warm[p] });
      assert.equal(res.status, 200, `${p}: the old ETag must not revalidate the live render`);
      assert.notEqual(res.headers.get("etag"), warm[p]);
      assert.equal(res.headers.get("x-sc-schedule-volatile"), "0", p);
      assert.match(res.headers.get("cache-control") ?? "", /max-age=300\b/);
      const body = await res.text();
      const game = rowStatus(body, "2026_11_CIN_WAS");
      assert.equal(game.text, "FINAL/OT", p);
      assert.doesNotMatch(game.row, /6:11|scs-live-dot/, p);
      assert.match(game.row, /<strong class="scs-game-score">20<\/strong>/);
      assert.doesNotMatch(body, /class="scs-updated"/, `${p}: no live game, no stamp`);
      assert.equal(rowStatus(body, "2026_11_IND_HOU").text, "FINAL", p);
    }
  });
});
