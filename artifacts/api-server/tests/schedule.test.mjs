/**
 * NFL schedule regression tests.
 *
 * Same posture as fpa.test.mjs and rankings.test.mjs: assert on the served HTML
 * without executing any JavaScript, because the whole point of the port is that
 * the board arrives complete. The standalone app this replaced shipped an empty
 * container and drew the season from React state, so the assertion that matters
 * most here is the boring one — that a response nobody ran a bundle against
 * already contains every game.
 *
 * ## Why this suite serves its own slate
 *
 * Every other suite here reads data that is already in the repository. This
 * tool's data is a file on nflverse's server, and pointing the tests at it
 * would mean a suite that fails when a Thursday game is flexed, when a score is
 * corrected, or when GitHub is slow — none of which are bugs in this code. So
 * the tests serve tests/fixtures/schedule-2024.csv over loopback and pin the
 * season to 2024 (SC_SCHEDULE_CSV_URL, SC_SCHEDULE_SEASON), and the live layer
 * is switched off (SC_SCHEDULE_ESPN=0).
 *
 * The fixture is not synthetic: it is the real 2024 regular season as nflverse
 * published it, reduced to the columns the parser reads. A made-up slate would
 * let a normalization bug through precisely where the real feed is awkward —
 * the five neutral-site internationals, the Thanksgiving and Christmas games,
 * and the two teams whose codes the feed spells differently from ours.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "schedule-2024.csv");

const SEASON = 2024;
/** 32 teams x 17 games / 2. */
const TOTAL_GAMES = 272;

/** Serves the fixture slate, so nothing in this file touches the network. */
async function startFixtureFeed() {
  const csv = fs.readFileSync(FIXTURE, "utf8");
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    res.end(csv);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/games.csv`,
    get hits() {
      return hits;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The environment that pins a server to the fixture. */
function fixtureEnv(feed, extra = {}) {
  return {
    SC_SCHEDULE_CSV_URL: feed.url,
    SC_SCHEDULE_SEASON: String(SEASON),
    SC_SCHEDULE_ESPN: "0",
    ...extra,
  };
}

let feed;
let server;

before(async () => {
  feed = await startFixtureFeed();
  server = await startServer(fixtureEnv(feed));
});

after(async () => {
  await server?.stop();
  await feed?.stop();
  await cleanupBundles();
});

function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function page(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  const html = await res.text();
  return { res, doc: new JSDOM(html).window.document, html };
}

/* ------------------------------------------------------------ pure modules */

describe("the slate", () => {
  let mod;

  before(async () => {
    // Read at module scope by the data module, so it has to be set before the
    // bundle is imported rather than before the call.
    process.env.SC_SCHEDULE_CSV_URL = feed.url;
    process.env.SC_SCHEDULE_ESPN = "0";
    mod = await importModule("lib/schedule/schedule-data");
  });

  test("normalizes the whole season", async () => {
    const data = await mod.getSchedule(SEASON);
    assert.ok(data, "the fixture feed must produce a season");
    assert.equal(data.season, SEASON);
    assert.equal(data.games.length, TOTAL_GAMES);
  });

  test("every team plays 17 games and takes exactly one bye", async () => {
    const data = await mod.getSchedule(SEASON);
    const teams = new Map();
    for (const game of data.games) {
      teams.set(game.away.abbreviation, game.away);
      teams.set(game.home.abbreviation, game.home);
    }
    assert.equal(teams.size, 32, "all 32 teams resolved from the feed's codes");

    for (const abbreviation of teams.keys()) {
      assert.equal(
        mod.teamGames(data, abbreviation).length,
        17,
        `${abbreviation} plays 17 games`,
      );
    }

    // The bye is DERIVED — it is not a row in the feed — so this is the one
    // assertion that catches a normalization bug silently dropping a game.
    const table = [...teams.values()];
    const byeCounts = new Map();
    for (let week = 1; week <= mod.TOTAL_WEEKS; week += 1) {
      for (const team of mod.byeTeams(data, week, table)) {
        byeCounts.set(
          team.abbreviation,
          (byeCounts.get(team.abbreviation) ?? 0) + 1,
        );
      }
    }
    assert.equal(byeCounts.size, 32, "every team has a bye");
    for (const [team, count] of byeCounts) {
      assert.equal(count, 1, `${team} takes exactly one bye`);
    }
  });

  test("kickoffs convert from Eastern across the DST boundary", () => {
    // September is EDT (UTC-4), December is EST (UTC-5). A converter that
    // hard-codes one offset passes half of this.
    assert.equal(
      new Date(mod.easternToUtcMs("2024-09-08", "13:00")).toISOString(),
      "2024-09-08T17:00:00.000Z",
    );
    assert.equal(
      new Date(mod.easternToUtcMs("2024-12-08", "13:00")).toISOString(),
      "2024-12-08T18:00:00.000Z",
    );
  });

  test("a missing kickoff stays missing", () => {
    // A flexed week has an empty gameday and gametime. Inventing a plausible
    // Sunday afternoon would make the page confidently wrong.
    assert.equal(mod.easternToUtcMs("", "13:00"), null);
    assert.equal(mod.easternToUtcMs("2024-12-08", ""), null);
  });

  test("the holiday games are labelled", async () => {
    const data = await mod.getSchedule(SEASON);
    const thanksgiving = data.games.filter(
      (game) => game.holiday === "THANKSGIVING",
    );
    const christmas = data.games.filter((game) => game.holiday === "CHRISTMAS");
    assert.equal(thanksgiving.length, 3, "three games on Thanksgiving");
    assert.ok(christmas.length >= 1, "at least one on Christmas");
  });

  test("the internationals are flagged and the domestic games are not", async () => {
    const data = await mod.getSchedule(SEASON);
    const international = data.games.filter((game) => game.international);
    // Sao Paulo, London x3, Munich — the five neutral sites of 2024.
    assert.equal(international.length, 5);
    assert.ok(
      international.every((game) => game.venueFlag !== ""),
      "each international game carries a flag",
    );
  });

  test("query parsing clamps to what the tool can render", () => {
    assert.equal(mod.parseScheduleView("matrix"), "matrix");
    assert.equal(mod.parseScheduleView("MATRIX"), "matrix");
    assert.equal(mod.parseScheduleView("nonsense"), "week");
    assert.equal(mod.parseScheduleView(undefined), "week");

    assert.equal(mod.parseGameFilter("division"), "division");
    assert.equal(mod.parseGameFilter("nonsense"), "all");

    assert.equal(mod.parseWeek("7"), 7);
    assert.equal(mod.parseWeek("0"), null);
    assert.equal(mod.parseWeek("19"), null);
    assert.equal(mod.parseWeek("abc"), null);
  });

  test("the season pin is honoured", () => {
    const previous = process.env.SC_SCHEDULE_SEASON;
    try {
      process.env.SC_SCHEDULE_SEASON = "2019";
      assert.equal(mod.scheduleSeason(), 2019);
      process.env.SC_SCHEDULE_SEASON = "1066";
      assert.notEqual(mod.scheduleSeason(), 1066, "an implausible pin is ignored");
    } finally {
      if (previous === undefined) delete process.env.SC_SCHEDULE_SEASON;
      else process.env.SC_SCHEDULE_SEASON = previous;
    }
  });
});

/* -------------------------------------------------------- broadcaster marks */

describe("the broadcaster marks", () => {
  let render;
  let marks;

  before(async () => {
    render = await importModule("lib/schedule-render");
    marks = await importModule("lib/team/network-marks");
  });

  /** The height netMarkStyle() assigns, parsed back out of the style string. */
  function heightOf(aspect) {
    const style = render.netMarkStyle(aspect);
    const found = /--scs-net-h:([\d.]+)px/.exec(style);
    assert.ok(found, `netMarkStyle(${aspect}) sets a height`);
    return Number(found[1]);
  }

  test("a wordmark and a roundel are drawn at the same area", () => {
    // The regression this exists for: at a shared HEIGHT, ESPN's 4:1 wordmark
    // carries four times the ink of the ABC roundel it shares a cell with, and
    // reads as four times the logo. Equal area is what makes them look like the
    // same size.
    const area = (aspect) => {
      const height = heightOf(aspect);
      return height * aspect * height;
    };
    const espn = area(4.01);
    const abc = area(1.0);
    // ABC is capped by the row height rather than by area, so it is the smaller
    // of the two; what must not come back is ESPN being a multiple of it.
    assert.ok(
      espn / abc < 2,
      `ESPN is ${(espn / abc).toFixed(1)}x the ABC roundel; it was 3.6x`,
    );
  });

  test("no mark is taller than the row allows", () => {
    // Equal area alone would make a TALL mark (Netflix's N is 0.55:1) taller
    // than the row to pay for being narrow. The cap is read from the module so
    // that retuning the row's geometry does not need this test edited with it.
    const cap = render.NET_MARK_MAX_HEIGHT;
    assert.ok(cap > 0, "the module exports its cap");
    for (const mark of Object.values(marks.NETWORK_MARKS)) {
      assert.ok(
        heightOf(mark.aspect) <= cap,
        `${mark.title} must fit the row`,
      );
    }
  });

  test("a wide wordmark loses height rather than gaining width", () => {
    // Monotonic: the wider the artwork, the shorter it is drawn.
    assert.ok(heightOf(4.48) < heightOf(2.55));
    assert.ok(heightOf(2.55) < heightOf(1.38));
  });
});

/* ------------------------------------------------------------- the page */

describe("the schedule page", () => {
  test("arrives complete, with no JavaScript run", async () => {
    const { res, doc } = await page("/schedule");
    assert.equal(res.status, 200);
    const games = doc.querySelectorAll("article.scs-game");
    assert.ok(games.length > 0, "the week's games are in the HTML");
    assert.match(doc.querySelector("title").textContent, /2024 NFL Schedule/);
  });

  test("the matrix carries all 32 teams and all 18 weeks", async () => {
    const { res, doc } = await page("/schedule?view=matrix");
    assert.equal(res.status, 200);
    const rows = doc.querySelectorAll("th.scs-matrix-team");
    assert.equal(rows.length, 32, "one row per team");
    // 18 week columns plus the corner cell.
    assert.equal(doc.querySelectorAll("thead th").length, 19);
  });

  test("a team view is that team's season", async () => {
    const { res, doc, html } = await page("/schedule?view=team&team=ne");
    assert.equal(res.status, 200);
    assert.match(html, /New England Patriots/);
    const games = doc.querySelectorAll("li.scs-trow");
    assert.equal(games.length, 17, "17 games, and the bye is not one of them");
  });

  test("a team can be named any of the ways a reader would name it", async () => {
    const canonical = (await page("/schedule?view=team&team=ne")).html;
    for (const alias of ["NE", "patriots", "new-england-patriots"]) {
      const { html } = await page(`/schedule?view=team&team=${alias}`);
      assert.equal(
        html.length,
        canonical.length,
        `${alias} must resolve to the same board`,
      );
    }
  });

  test("view, team and filter never change the canonical", async () => {
    const canonical = async (pathname) => {
      const { doc } = await page(pathname);
      return doc.querySelector('link[rel="canonical"]').getAttribute("href");
    };

    // The three that are ways of LOOKING at a board, rather than names of a
    // different one, all canonicalise to the path they are looked at from.
    for (const query of ["?view=matrix", "?view=team&team=ne"]) {
      assert.equal(
        await canonical(`/schedule${query}`),
        `${server.origin}/schedule`,
        `${query} is the same page as the bare path`,
      );
    }
    for (const query of [
      "?filter=division",
      "?filter=international",
      "?season=2024",
      "?embed=1",
    ]) {
      assert.equal(
        await canonical(`/schedule/week-3${query}`),
        `${server.origin}/schedule/week-3`,
        `${query} is the same page as week 3`,
      );
    }
  });

  test("a week is a page, and says which week it is", async () => {
    const { res, doc } = await page("/schedule/week-2");
    assert.equal(res.status, 200);
    assert.match(doc.querySelector("title").textContent, /Week 2/);
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      `${server.origin}/schedule/week-2`,
    );
    const active = doc.querySelector(".scs-rail-link.is-active");
    assert.equal(active.textContent.replace(/\D/g, ""), "2");
  });

  test("the bare path is the way in, and points at the week it shows", async () => {
    const { doc, html } = await page("/schedule");
    const canonical = doc
      .querySelector('link[rel="canonical"]')
      .getAttribute("href");
    assert.match(canonical, /\/schedule\/week-\d{1,2}$/);
    // Same board, same links, one of them the address of the other: the pair
    // is a duplicate only until the canonical says which one is the page.
    const week = await page(canonical.slice(server.origin.length));
    assert.equal(week.html, html);
  });

  test("the week strip links to paths, not parameters", async () => {
    const { doc } = await page("/schedule/week-2");
    const hrefs = [...doc.querySelectorAll(".scs-rail-link")].map((a) =>
      a.getAttribute("href"),
    );
    assert.equal(hrefs.length, 18);
    assert.deepEqual(
      hrefs,
      Array.from({ length: 18 }, (_, i) => `/schedule/week-${i + 1}`),
    );
  });

  test("the old ?week= address is redirected, once and permanently", async () => {
    const res = await rawGet("/schedule?week=12&filter=division&view=week");
    assert.equal(res.status, 301);
    // The defaults are dropped on the way: view=week IS the weekly board.
    assert.equal(res.headers.location, "/schedule/week-12?filter=division");
    assert.equal((await rawGet(res.headers.location)).status, 200);
  });

  test("embed mode survives the redirect", async () => {
    const res = await rawGet("/schedule?week=4&embed=1");
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, "/schedule/week-4?embed=1");
  });

  test("a week that is not in the season is not a page", async () => {
    for (const bad of [
      "/schedule/week-0",
      "/schedule/week-19",
      "/schedule/week-02",
      "/schedule/week-two",
      "/schedule/week-",
    ]) {
      assert.equal((await rawGet(bad)).status, 404, `${bad} must 404`);
    }
  });

  test("the other views are sent back to their own addresses", async () => {
    const res = await rawGet("/schedule/week-2?view=matrix");
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, "/schedule?view=matrix");
  });

  test("the exports are not mistaken for weeks", async () => {
    assert.equal((await rawGet("/schedule/download.csv")).status, 200);
    assert.equal((await rawGet("/schedule/schedule.ics")).status, 200);
  });

  // The board no longer prints a "Div" pill, so nothing on a row says what kind
  // of game it is. The sidebar's Divisional games card still lists them, and it
  // is built from the UNFILTERED week, which makes it an independent answer to
  // check the filtered board against. Week 2 is a mix, so a filter that
  // silently did nothing fails on the count before it fails on the set.
  test("the division filter shows only division games", async () => {
    const codes = (root, selector) =>
      [...root.querySelectorAll(selector)].map((node) => node.textContent.trim());
    const board = (doc) =>
      [...doc.querySelectorAll("article.scs-game")].map((game) =>
        codes(game, ".scs-game-code").join("@"),
      );

    const { doc: unfiltered } = await page("/schedule?week=2");
    const { doc } = await page("/schedule?week=2&filter=division");
    const listed = [
      ...doc.querySelectorAll('.scs-card[data-kind="division"] .scs-mini'),
    ].map((mini) => codes(mini, ".scs-mini-code").join("@"));

    assert.ok(listed.length > 0, "week 2 has division games");
    assert.ok(
      listed.length < board(unfiltered).length,
      "week 2 is a mix, so the filter has something to remove",
    );
    assert.deepEqual(
      board(doc).sort(),
      [...listed].sort(),
      "the filtered board is exactly the week's divisional slate",
    );
  });

  test("the tool stays out of the index unless it is embedded", async () => {
    for (const route of ["/schedule", "/schedule?view=matrix", "/embed/schedule"]) {
      const res = await fetch(`${server.origin}${route}`);
      assert.match(res.headers.get("x-robots-tag"), /noindex, indexifembedded/);
    }
    const csv = await fetch(`${server.origin}/schedule/download.csv`);
    assert.match(csv.headers.get("x-robots-tag"), /noindex/);
  });

  test("repeat requests revalidate to 304", async () => {
    const first = await rawGet("/schedule");
    assert.equal(first.status, 200);
    assert.ok(first.headers.etag, "the page carries a validator");
    const second = await rawGet("/schedule", {
      "If-None-Match": first.headers.etag,
    });
    assert.equal(second.status, 304);
  });
});

/* ---------------------------------------------------------- the fragment */

describe("the embed fragment", () => {
  test("emits no canonical, title or robots directive", async () => {
    const res = await rawGet("/embed/schedule");
    assert.equal(res.status, 200);
    assert.ok(!/rel="canonical"/i.test(res.body));
    assert.ok(!/<title/i.test(res.body));
    assert.ok(!/<html/i.test(res.body), "a fragment, not a document");
  });

  test("carries no stylesheet and no executable script", async () => {
    // WordPress enqueues both separately; shipping them here would load each
    // twice and would defeat the plugin's versioning.
    const res = await rawGet("/embed/schedule");
    assert.ok(!/<link[^>]+stylesheet/i.test(res.body));
    assert.ok(!/<script(?![^>]*type="application\/ld\+json")/i.test(res.body));
  });
});

/* ------------------------------------------------------ the WordPress mount */

/**
 * The fragment as statchasers.com actually asks for it.
 *
 * The board's own controls have to link into the WordPress page rather than out
 * to this origin, which is what SC_SCHEDULE_PATH is for — and now that a week
 * is a path rather than a parameter, the link has to be spelled the way
 * WordPress spells a page address, trailing slash and all, or the rewrite rule
 * on the far end never fires.
 */
describe("the WordPress mount", () => {
  let wp;

  before(async () => {
    wp = await startServer(
      fixtureEnv(feed, {
        SC_SCHEDULE_PATH: "/nfl/nfl-schedule/",
        SC_TEAM_PATH_PREFIX: "/nfl/teams/",
      }),
    );
  });

  after(async () => {
    await wp?.stop();
  });

  async function fragment(pathname) {
    const res = await fetch(`${wp.origin}${pathname}`);
    const html = await res.text();
    return { res, doc: new JSDOM(html).window.document, html };
  }

  test("the week links land inside the WordPress page", async () => {
    const { doc } = await fragment("/embed/schedule");
    const hrefs = [...doc.querySelectorAll(".scs-rail-link")].map((a) =>
      a.getAttribute("href"),
    );
    assert.deepEqual(
      hrefs,
      Array.from({ length: 18 }, (_, i) => `/nfl/nfl-schedule/week-${i + 1}/`),
      "the page's own path, a week segment, and the slash WordPress wants back",
    );
    // `?embed=1` is only meaningful against this origin, and `embed` is a
    // reserved WordPress query var — so once the links point at the site, it
    // is gone. That is fragmentLinkQuery()'s job, and it must survive the move
    // of the week into the path.
    assert.ok(!hrefs.some((href) => href.includes("?")));
  });

  test("the other views keep the page's bare path", async () => {
    const { doc } = await fragment("/embed/schedule");
    const views = [...doc.querySelectorAll(".scs-view-link")].map((a) =>
      a.getAttribute("href"),
    );
    assert.ok(
      views.some((href) => href === "/nfl/nfl-schedule/?view=matrix"),
      `the matrix hangs off the page itself: ${views.join(" ")}`,
    );
  });

  test("the plugin still asks for a week the way it always has", async () => {
    // The shortcode passes ?week= to the fragment — it is an argument to a
    // render, not an address, and nothing about paths changes that.
    const { doc } = await fragment("/embed/schedule?week=5");
    const active = doc.querySelector(".scs-rail-link.is-active");
    assert.equal(active.textContent.replace(/\D/g, ""), "5");
  });
});

/* ----------------------------------------------------------- the exports */

describe("the exports", () => {
  test("the CSV is the whole slate, and matches the board", async () => {
    const res = await fetch(`${server.origin}/schedule/download.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(
      res.headers.get("content-disposition"),
      /filename="nfl-schedule-2024-season\.csv"/,
    );
    const lines = (await res.text()).trim().split("\n");
    assert.equal(lines.length, TOTAL_GAMES + 1, "272 games plus the header");
  });

  test("a team export is that team's season", async () => {
    const res = await fetch(
      `${server.origin}/schedule/download.csv?view=team&team=ne`,
    );
    assert.match(
      res.headers.get("content-disposition"),
      /filename="nfl-schedule-2024-ne\.csv"/,
    );
    const lines = (await res.text()).trim().split("\n");
    assert.equal(lines.length, 18, "17 games plus the header");
  });

  test("the calendar is a calendar", async () => {
    const res = await fetch(`${server.origin}/schedule/schedule.ics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/calendar/);
    const body = await res.text();
    assert.ok(body.startsWith("BEGIN:VCALENDAR"));
    assert.ok(body.trimEnd().endsWith("END:VCALENDAR"));

    const events = body.match(/BEGIN:VEVENT/g) ?? [];
    const ends = body.match(/END:VEVENT/g) ?? [];
    assert.equal(events.length, ends.length, "every event is closed");
    assert.ok(events.length > 0);

    // A game with no kickoff cannot be a calendar event with a start time, so
    // the exporter must drop it rather than emit an invalid DTSTART.
    assert.ok(!/DTSTART:(?:\s|$)/m.test(body), "no empty start times");
  });
});

/* ------------------------------------------------------- the dev switcher */

describe("the schedule development switcher", () => {
  let dev;

  before(async () => {
    dev = await startServer(fixtureEnv(feed, { NODE_ENV: "development" }));
  });

  after(async () => {
    await dev?.stop();
  });

  async function devGet(pathname) {
    const res = await fetch(`${dev.origin}${pathname}`, { redirect: "manual" });
    return { status: res.status, body: await res.text() };
  }

  test("the tool is reachable from every other tool", async () => {
    for (const path of ["/", "/fpa", "/rankings", "/schedule"]) {
      const res = await devGet(path);
      assert.equal(res.status, 200);
      assert.ok(
        res.body.includes("statchasers_schedule"),
        `${path} must offer the schedule shortcode`,
      );
    }
  });

  test("every mount in the bar resolves", async () => {
    const res = await devGet("/schedule");
    const bar = new JSDOM(res.body).window.document.querySelector("[data-scdev]");
    const hrefs = [...bar.querySelectorAll("a")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href.startsWith("/") && href.includes("schedule"));
    assert.ok(hrefs.length >= 4, "page, embed, shortcode and raw at least");
    for (const href of new Set(hrefs)) {
      assert.equal((await devGet(href)).status, 200, `${href} must resolve`);
    }
  });

  test("the harness enqueues this tool's assets and no other's", async () => {
    const res = await devGet("/preview/schedule");
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("/schedule.css"));
    assert.ok(res.body.includes("/dist/statchasers-schedule.js"));
    assert.ok(
      !res.body.includes("/fpa.css") &&
        !res.body.includes("/player.css") &&
        !res.body.includes("/styles.css"),
      "one tool's preview must not pull another tool's assets",
    );
  });

  test("the raw view shows the fragment as escaped source", async () => {
    const res = await devGet("/preview/raw/schedule");
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("/embed/schedule"), "it names the endpoint");
    assert.ok(res.body.includes("&lt;"), "the fragment is escaped source");
  });

  test("the harness is development-only", async () => {
    for (const route of ["/preview/schedule", "/preview/raw/schedule"]) {
      const res = await rawGet(route);
      assert.equal(res.status, 404, `${route} must not exist outside development`);
    }
  });
});
