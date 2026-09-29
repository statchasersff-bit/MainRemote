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
    assert.equal(mod.parseScheduleView("week"), "week");
    assert.equal(mod.parseScheduleView("MATRIX"), "matrix");
    // The grid is the default, because the bare path is the grid.
    assert.equal(mod.parseScheduleView("nonsense"), "matrix");
    assert.equal(mod.parseScheduleView(undefined), "matrix");

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

  /**
   * ESPN switched on against a stub, counting scoreboard calls. The slate
   * still comes from the fixture feed; only ESPN's URL is intercepted.
   */
  async function withEspn(respond, run) {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("site.api.espn.com")) {
        calls += 1;
        return respond();
      }
      return realFetch(url, init);
    };
    process.env.SC_SCHEDULE_ESPN = "1";
    mod.invalidateScheduleCaches();
    try {
      await run(() => calls);
    } finally {
      globalThis.fetch = realFetch;
      process.env.SC_SCHEDULE_ESPN = "0";
      mod.invalidateScheduleCaches();
    }
  }

  test("between the league year and the schedule release, last season shows", async (t) => {
    // March 1 to about mid-May, the calendar's season has no schedule yet. The
    // board used to be empty (and /embed/schedule a 503) for those ten weeks.
    // April 2025: the calendar says 2025, the fixture has only 2024.
    const previous = process.env.SC_SCHEDULE_SEASON;
    delete process.env.SC_SCHEDULE_SEASON;
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(SEASON + 1, 3, 1) });
    try {
      assert.equal(mod.scheduleSeason(), SEASON + 1);
      const data = await mod.getSchedule(SEASON + 1);
      assert.ok(data, "not an empty board");
      assert.equal(data.season, SEASON, "the season just played, labelled as such");
    } finally {
      t.mock.timers.reset();
      if (previous !== undefined) process.env.SC_SCHEDULE_SEASON = previous;
    }
  });

  test("concurrent requests share one ESPN sweep", async () => {
    await withEspn(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      },
      async (calls) => {
        const now = Date.now();
        await Promise.all(
          Array.from({ length: 5 }, () => mod.getSchedule(SEASON, now)),
        );
        assert.equal(calls(), mod.TOTAL_WEEKS, "one 18-week sweep, not five");
      },
    );
  });

  test("a refused sweep is not repeated at the next idle expiry", async () => {
    // ESPN refuses this host for hours at a time. The idle clock is 15
    // minutes, and every expiry used to repeat the whole 18-week sweep.
    await withEspn(
      async () => new Response("forbidden", { status: 403 }),
      async (calls) => {
        const now = Date.now();
        await mod.getSchedule(SEASON, now);
        assert.equal(calls(), mod.TOTAL_WEEKS);
        await mod.getSchedule(SEASON, now + 16 * 60 * 1000);
        assert.equal(calls(), mod.TOTAL_WEEKS, "backed off, not retried");
        await mod.getSchedule(SEASON, now + 61 * 60 * 1000);
        assert.equal(calls(), 2 * mod.TOTAL_WEEKS, "and tried again after the hour");
      },
    );
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

  test("the frame a mark is drawn in starts at the origin", () => {
    // The regression this exists for: the outer <svg> repeated the symbol's
    // CROP, offset and all, while <use> places the symbol at the outer user
    // space's origin — so the window sat one whole offset away from the
    // artwork. The Netflix N lost its left 5.4 of 13.2 units on production and
    // YouTube's wordmark, cropped from x=409.29, missed its box entirely.
    for (const mark of Object.values(marks.NETWORK_MARKS)) {
      const frame = marks.markFrame(mark).split(/\s+/).map(Number);
      const crop = mark.viewBox.trim().split(/\s+/).map(Number);
      assert.deepEqual(
        frame.slice(0, 2),
        [0, 0],
        `${mark.title}'s frame must sit at the origin, not at its crop`,
      );
      assert.deepEqual(
        frame.slice(2),
        crop.slice(2),
        `${mark.title}'s frame must be the size of its crop`,
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
    assert.equal(
      doc.querySelectorAll("th.scs-matrix-team").length,
      32,
      "the grid is in the HTML the bare path serves",
    );
    assert.match(doc.querySelector("title").textContent, /2024 NFL Schedule/);

    const week = await page("/schedule/week-3");
    const games = week.doc.querySelectorAll("article.scs-game");
    assert.ok(games.length > 0, "the week's games are in the HTML too");
  });

  /**
   * Every row is a door into the two clubs' own page.
   *
   * The link is the point, but the ADDRESS is what this asserts. There are two
   * of them and matchup/pair.ts owns the rule that picks between them: a
   * finished game the pair's page has let go of has a dated address of its own,
   * and everything else is the pair. The fixture is the whole of 2024, so every
   * row here is on the far side of that fourteen-day window — which makes this
   * the dated case, and the one a reader opening a past week actually wants.
   */
  test("every game on the board opens the two clubs' own page", async () => {
    const { doc } = await page("/schedule/week-3");
    const rows = [...doc.querySelectorAll("article.scs-game")];
    assert.ok(rows.length > 0);

    for (const row of rows) {
      const link = row.querySelector(".scs-game-go a.scs-go");
      assert.ok(link, `a row with no matchup link: ${row.id}`);
      assert.match(
        link.getAttribute("href"),
        /^\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\/2024-week-3\/$/,
        "a finished game long past has a dated address of its own",
      );
    }
  });

  /**
   * One page per pair, not one per direction.
   *
   * The board draws away-then-home, so a row's two teams arrive in playing
   * order and the URL must not: canonicalizeMatchupPair() sorts them by slug so
   * that the Bills at the Dolphins and the Dolphins at the Bills are one
   * address. A board that spelled the pair in row order would mint a second
   * address for half the league's meetings, which is the whole reason that
   * function exists.
   */
  test("the pair in the URL is alphabetical, not the row's order", async () => {
    const { doc } = await page("/schedule/week-3");

    let checked = 0;
    for (const row of [...doc.querySelectorAll("article.scs-game")]) {
      const href = row.querySelector("a.scs-go")?.getAttribute("href") ?? "";
      const pair = href.split("/")[2] ?? "";
      const [a, b] = pair.split("-vs-");
      assert.ok(a && b, `not a pair: ${href}`);
      assert.ok(a < b, `${pair} is not in slug order`);
      checked += 1;
    }
    assert.ok(checked > 10, "the whole slate was checked");
  });

  /**
   * The link says who is playing whom, in words.
   *
   * Rule 4 at the top of schedule-render.ts, applied to the one control on the
   * row whose visible text disappears: below 900px of board the label is a
   * chevron, so without this span the link reads as "›" and thirteen of them
   * read as thirteen identical links. Home and away are stated, never left to
   * the order two logos were printed in.
   */
  test("the matchup link names both clubs and which is at home", async () => {
    const { doc } = await page("/schedule/week-3");
    const row = doc.querySelector("article.scs-game");
    const link = row.querySelector("a.scs-go");

    const spoken = link.querySelector(".scs-visually-hidden").textContent;
    assert.match(spoken, /^Matchup: .+ (at|vs) .+$/, spoken);

    // And the visible label is not the accessible name — it is decoration that
    // the stylesheet is free to drop.
    for (const hidden of link.querySelectorAll("[aria-hidden='true']")) {
      assert.ok(
        ["scs-go-label", "scs-go-chev"].includes(hidden.className),
        `an unexpected aria-hidden part: ${hidden.className}`,
      );
    }
  });

  /**
   * The head row still lines up with the rows under it.
   *
   * The board is a grid and the heading row is a sibling of the game rows
   * sharing its template, so a fourth cell in one and three in the other is a
   * board whose headings sit over the wrong columns — which looks like a CSS
   * bug and is a markup one.
   */
  test("the board's head has one cell per column", async () => {
    const { doc } = await page("/schedule/week-3");
    const head = [...doc.querySelectorAll(".scs-board-head > span")];
    assert.equal(head.length, 4);
    assert.deepEqual(
      head.map((cell) => cell.textContent),
      ["When", "Game", "TV", ""],
      "the middle column is the fixture; the last is the link to its page",
    );

    const cells = doc.querySelector("article.scs-game").children;
    // The visually hidden line is positioned out of the grid, so the row's
    // grid items are the four divs.
    const divs = [...cells].filter((el) => el.tagName === "DIV");
    assert.equal(divs.length, 4);
  });

  /**
   * The grid has no such links, and should not.
   *
   * A cell there is already a link — to that week's board — and 576 of them
   * pointing somewhere else instead would make the matrix a different tool.
   */
  test("the season grid carries no matchup links", async () => {
    const { doc } = await page("/schedule?view=matrix");
    assert.equal(doc.querySelectorAll("a.scs-go").length, 0);
  });

  test("the matrix carries all 32 teams and all 18 weeks", async () => {
    const { res, doc } = await page("/schedule");
    assert.equal(res.status, 200);
    const rows = doc.querySelectorAll("th.scs-matrix-team");
    assert.equal(rows.length, 32, "one row per team");
    // 18 week columns plus the corner cell.
    assert.equal(doc.querySelectorAll("thead th").length, 19);
  });

  /**
   * The grid's own questions.
   *
   * Two things are being defended. The first is that the matrix has a FAQ at
   * all — it is a different set from the weekly board's, it is about the board
   * rather than about a fixture, and both are one <h2> and a stack of folds.
   *
   * The second is the one that matters: every number in those answers is
   * counted off the slate rather than recited from the league's usual
   * arithmetic. The fixture is a real, whole 2024 season, so 32, 18, 272 and 17
   * are all derivable — and matrixFacts() withholds the count questions
   * entirely when the rows disagree, which is the case a half-loaded feed would
   * otherwise answer with a false claim about the season.
   */
  test("the matrix answers questions about the grid, counted off the grid", async () => {
    const { doc } = await page("/schedule?view=matrix");

    assert.equal(
      doc.querySelector(".scs-faq-title").textContent,
      `${SEASON} NFL Schedule Grid FAQ`,
    );

    const items = [...doc.querySelectorAll(".scs-faq-item")];
    // A floor, not a count: two of the entries are withheld when the rows
    // disagree. The ceiling is the point of the assertion — the four
    // near-duplicate "where can I see the full schedule" phrasings were merged
    // into one on purpose, and a set that grows back past a dozen is the
    // thin-content regression rather than better coverage.
    assert.ok(
      items.length >= 9 && items.length <= 12,
      `the grid is asked ${items.length} questions`,
    );

    const questions = items.map((item) => item.querySelector(".scs-faq-q").textContent);
    assert.equal(
      new Set(questions).size,
      questions.length,
      "no question is asked twice",
    );

    const answers = items.map((item) => item.querySelector(".scs-faq-a").textContent);
    const prose = answers.join(" ");

    assert.ok(prose.includes(`${TOTAL_GAMES} games`), "the slate is counted");
    assert.ok(prose.includes("all 32 NFL teams"), "the rows are counted");
    assert.ok(prose.includes("Week 1 through Week 18"), "the columns are counted");
    assert.ok(prose.includes("17 games"), "a team's own games are counted");
    assert.ok(prose.includes("one bye week"), "the byes are counted");

    // The fixture is a finished season, so nothing claims it is still being
    // played. "Runs 18 weeks" about 2024 is the error the verb table exists for.
    assert.ok(
      prose.includes("ran 18 weeks") && !prose.includes("runs 18 weeks"),
      "a season behind us is described in the past tense",
    );

    // And none of it is a week's board: no game is described. The answers point
    // at the weekly board for kickoffs and TV, they never stand in for it.
    assert.ok(
      !/\bat \d{1,2}:\d{2}\b/.test(prose),
      "the grid answers for no fixture's kickoff",
    );

    // The FAQPage node is the same list, not a second one.
    const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((tag) => JSON.parse(tag.textContent))
      .filter((node) => node["@type"] === "FAQPage");
    assert.equal(nodes.length, 1, "one FAQPage node");
    assert.equal(nodes[0].mainEntity.length, items.length);
    assert.deepEqual(
      nodes[0].mainEntity.map((entry) => entry.name),
      questions,
    );
  });

  /**
   * The two views are asked different things, and the heading says which.
   *
   * A matrix that inherited "NFL Week 3 Schedule FAQ", or a board that answered
   * "what does @ mean", would be one view describing the other — which is the
   * whole failure mode of hanging two question sets off one renderer.
   */
  test("the weekly board keeps its own questions", async () => {
    const week = await page("/schedule/week-3");
    assert.equal(
      week.doc.querySelector(".scs-faq-title").textContent,
      "NFL Week 3 Schedule FAQ",
    );

    const matrix = await page("/schedule");
    const ask = (doc) =>
      [...doc.querySelectorAll(".scs-faq-q")].map((q) => q.textContent);
    const shared = ask(week.doc).filter((q) => ask(matrix.doc).includes(q));
    assert.deepEqual(shared, [], "the two sets share no question");
  });

  /**
   * The page says what it is exactly once.
   *
   * The grid used to name itself again above the board — "2026 NFL Schedule
   * Grid" under an <h1> reading "2026 NFL Schedule", with the same sentence
   * under both. The heading and the standfirst are what the page is found by,
   * so they are asserted here; the second copy of them is asserted gone.
   */
  test("the page names itself once, above the board", async () => {
    const { doc } = await page("/schedule");

    assert.equal(
      doc.querySelector("h1.scs-title").textContent,
      `${SEASON} NFL Schedule`,
    );
    assert.match(
      doc.querySelector(".scs-head .scs-lede").textContent,
      new RegExp(`View the full ${SEASON} NFL schedule for every team in one board`),
    );

    assert.equal(doc.querySelectorAll("h1").length, 1, "one heading, not two");
    assert.equal(
      doc.querySelector(".scs-viewlede"),
      null,
      "the grid no longer names itself a second time",
    );
    assert.equal(
      [...doc.querySelectorAll(".scs-view-title")].length,
      0,
      "and prints no heading of its own at all",
    );

    // The instruction the reader actually needs is still there.
    assert.match(
      doc.querySelector(".scs-viewhead .scs-view-note").textContent,
      /marks a road game/,
    );
  });

  test("a week page's heading says which week", async () => {
    const { doc } = await page("/schedule/week-3");
    assert.equal(
      doc.querySelector("h1.scs-title").textContent,
      `${SEASON} NFL Schedule: Week 3`,
    );
    assert.match(
      doc.querySelector(".scs-head .scs-lede").textContent,
      /Every Week 3 game of the/,
    );
    // The board's own "Week 3 / 18" counter is not a second heading.
    assert.equal(doc.querySelectorAll("h1").length, 1);
  });

  /**
   * Embedded, the host page owns the heading — its own or the one the plugin
   * generates — so the fragment prints none. `?h1=1` is the host saying it has
   * stood its title down, which is the only case where the fragment's heading
   * is the page's.
   */
  test("the fragment prints a heading only when the host asks for one", async () => {
    const bare = await fetch(`${server.origin}/embed/schedule`);
    const bareDoc = new JSDOM(await bare.text()).window.document;
    assert.equal(bareDoc.querySelectorAll("h1").length, 0);
    assert.equal(bareDoc.querySelector(".scs-head"), null);
    assert.equal(bareDoc.querySelector(".scs-lede"), null, "and no standfirst");

    const asked = await fetch(`${server.origin}/embed/schedule?h1=1`);
    const askedDoc = new JSDOM(await asked.text()).window.document;
    assert.equal(
      askedDoc.querySelector("h1.scs-title").textContent,
      `${SEASON} NFL Schedule`,
    );

    const week = await fetch(`${server.origin}/embed/schedule?view=week&week=7&h1=1`);
    const weekDoc = new JSDOM(await week.text()).window.document;
    assert.equal(
      weekDoc.querySelector("h1.scs-title").textContent,
      `${SEASON} NFL Schedule: Week 7`,
    );
  });

  /**
   * The team lens was this tool's third view until the team hub's Schedule tab
   * took it over. Every link to it — a bookmark, a paste, the bye card on an
   * old cached page — has to land on the season it asked for rather than on
   * whatever week the board happens to be showing today.
   */
  test("a team lens link is redirected to that team's Schedule tab", async () => {
    for (const alias of ["ne", "NE", "patriots", "new-england-patriots"]) {
      const res = await fetch(
        `${server.origin}/schedule?view=team&team=${alias}`,
        { redirect: "manual" },
      );
      assert.equal(res.status, 301, `${alias} is redirected`);
      assert.equal(
        res.headers.get("location"),
        "/team/new-england-patriots/schedule/",
        `${alias} resolves to the one canonical team`,
      );
    }

    // And the address it names is a page, not a 404 waiting to happen.
    const landed = await fetch(`${server.origin}/team/new-england-patriots/schedule/`);
    assert.equal(landed.status, 200, "the tab it points at renders");
  });

  test("a team lens link with no team falls back to the grid", async () => {
    const res = await fetch(`${server.origin}/schedule?view=team`, {
      redirect: "manual",
    });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/schedule");
  });

  test("the tool offers two views, and the lens is not one", async () => {
    const { doc } = await page("/schedule");
    const labels = [...doc.querySelectorAll(".scs-view-link")].map((a) =>
      a.textContent.trim(),
    );
    // The grid first, because the grid is what the bare path serves: a tab
    // order that disagreed with the URL would open on its second tab.
    assert.deepEqual(labels, ["Season matrix", "Weekly board"]);
    assert.equal(
      doc.querySelector(".scs-view-link.is-active").textContent.trim(),
      "Season matrix",
    );
  });

  test("each view's tab is that view's own address", async () => {
    const { doc } = await page("/schedule");
    const hrefs = [...doc.querySelectorAll(".scs-view-link")].map((a) =>
      a.getAttribute("href"),
    );
    assert.equal(hrefs[0], "/schedule", "the grid is the bare path");
    // Not `?view=week`: the board's tab points at the week the season is on,
    // which is an address rather than a way of looking at this one.
    assert.match(hrefs[1], /^\/schedule\/week-\d{1,2}$/);
  });

  test("a season past the current one is the current board, not an empty one", async () => {
    // A future season has no rows. It used to render an empty 200 and cost a
    // fresh download of the whole games.csv every minute it was asked for.
    const bare = await (await fetch(`${server.origin}/schedule`)).text();
    const future = await (await fetch(`${server.origin}/schedule?season=2099`)).text();
    assert.equal(future, bare);
  });

  test("view and filter never change the canonical", async () => {
    const canonical = async (pathname) => {
      const { doc } = await page(pathname);
      return doc.querySelector('link[rel="canonical"]').getAttribute("href");
    };

    // What is left of the query string is ways of LOOKING at a page rather
    // than names of a different one, so each canonicalises to the path it is
    // looked at from.
    for (const query of ["?season=2024", "?embed=1"]) {
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

  test("the bare path is the grid, and is its own page", async () => {
    const { doc } = await page("/schedule");
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      `${server.origin}/schedule`,
      "the grid is the same page all season, so it points at itself",
    );
    assert.match(
      doc.querySelector("title").textContent,
      /NFL Schedule Grid/,
      "and it is titled as the grid, not as whatever week it is",
    );
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
    assert.equal(res.headers.location, "/schedule");
  });

  /**
   * `?view=` renders nothing on either route now: the path is the only thing
   * that says which view a rendering is, so every spelling that used to be a
   * second address for one of them is a redirect to it.
   */
  test("?view= is an old spelling, not an address", async () => {
    const matrix = await rawGet("/schedule?view=matrix");
    assert.equal(matrix.status, 301);
    assert.equal(matrix.headers.location, "/schedule");

    // Saying what the path already says is dropped the same way.
    const onWeek = await rawGet("/schedule/week-2?view=week");
    assert.equal(onWeek.status, 301);
    assert.equal(onWeek.headers.location, "/schedule/week-2");

    // `?view=week` with no week named means the week the season is on — which
    // is a moving target, hence 302, and an address, hence a redirect at all.
    const board = await rawGet("/schedule?view=week&filter=division");
    assert.equal(board.status, 302);
    assert.match(board.headers.location, /^\/schedule\/week-\d{1,2}\?filter=division$/);
    assert.equal((await rawGet(board.headers.location)).status, 200);
  });

  test("a filter is not carried onto the grid, which cannot use it", async () => {
    const res = await rawGet("/schedule/week-2?view=matrix&filter=division");
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, "/schedule");
  });

  /**
   * The address the board hands out is a page, not a redirect.
   *
   * This is the assertion the link is worth having. Which of a pair's two
   * addresses a finished game has is a rule with a fourteen-day constant in it,
   * and a board that got it wrong would not look broken — every link would
   * still work, through a 301, and nothing on the page would say so. Asked of
   * the server rather than of the rule, so a change to either side shows up
   * here.
   */
  test("a row's matchup link resolves without a redirect", async () => {
    const { doc } = await page("/schedule/week-3");
    const hrefs = [...doc.querySelectorAll("a.scs-go")]
      .map((link) => link.getAttribute("href"))
      .slice(0, 3);
    assert.equal(hrefs.length, 3);

    for (const href of hrefs) {
      const res = await rawGet(href);
      assert.equal(res.status, 200, `${href} answered ${res.status}`);
    }
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
    for (const route of ["/schedule", "/schedule/week-3", "/embed/schedule"]) {
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

    // A <script> is allowed here only as INERT DATA — the FAQ island the
    // plugin lifts into the host page's own graph, which is the arrangement
    // team-render.ts and rankings-render.ts already use and which this
    // assertion used to predate. What the fragment must never carry is
    // anything the browser would run: no src, and no type a browser treats as
    // JavaScript. Asserted per tag rather than as one negative lookahead, so
    // the failure names the script that broke the rule.
    const tags = res.body.match(/<script\b[^>]*>/gi) ?? [];
    for (const tag of tags) {
      assert.ok(!/\bsrc=/i.test(tag), `a fragment loaded a script: ${tag}`);
      const type = /\btype="([^"]*)"/i.exec(tag)?.[1];
      assert.ok(
        type === "application/json" || type === "application/ld+json",
        `a fragment shipped something that runs: ${tag}`,
      );
    }
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
        SC_MATCHUP_PATH_PREFIX: "/nfl/head-to-head/",
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
    const { doc } = await fragment("/embed/schedule?view=week");
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

  /**
   * And the matchup links land on the site's matchup pages.
   *
   * Embedded, every address in the fragment belongs to WordPress, and this one
   * has its own env var because the pair pages are a different WordPress page
   * from the team hubs — the same split the team hub and the pair page itself
   * already read. A fragment that fell back to this origin's /nfl/ would send
   * a reader on statchasers.com to a URL on the API host.
   */
  test("the matchup links land on the site's own pair pages", async () => {
    const { doc } = await fragment("/embed/schedule?view=week&week=3");
    const hrefs = [...doc.querySelectorAll("a.scs-go")].map((a) =>
      a.getAttribute("href"),
    );
    assert.ok(hrefs.length > 0, "the embedded board still carries the links");
    for (const href of hrefs) {
      assert.match(href, /^\/nfl\/head-to-head\/[a-z0-9-]+-vs-[a-z0-9-]+\/2024-week-3\/$/, href);
    }
    // Same reasoning as the week rail above: ?embed=1 is meaningless once the
    // links point at the site.
    assert.ok(!hrefs.some((href) => href.includes("?")));
  });

  test("the other views keep the page's bare path", async () => {
    const { doc } = await fragment("/embed/schedule?view=week");
    const views = [...doc.querySelectorAll(".scs-view-link")].map((a) =>
      a.getAttribute("href"),
    );
    assert.ok(
      views.some((href) => href === "/nfl/nfl-schedule/"),
      `the matrix IS the page itself: ${views.join(" ")}`,
    );
  });

  test("the fragment's bare call is the grid, like the page it mounts on", async () => {
    const { doc } = await fragment("/embed/schedule");
    assert.equal(doc.querySelectorAll("th.scs-matrix-team").length, 32);
    assert.equal(doc.querySelectorAll(".scs-rail-link").length, 0);
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
    // `?team=` on an export is not the view that went away: the file has always
    // been scoped by the request rather than by what was on screen.
    const res = await fetch(
      `${server.origin}/schedule/download.csv?team=ne`,
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
    for (const path of ["/", "/fpa", "/rest-of-season-rankings", "/schedule"]) {
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


/*
 * The rules that hold the matrix's shape inside a host theme.
 *
 * Asserted on the stylesheet's TEXT, which this suite does nowhere else, and
 * only because these are specificity facts — the thing a browser test would
 * have to re-derive and a reading of the file cannot be trusted to keep.
 *
 * The matrix is 19 columns by 32 rows, so a few pixels of cell padding is
 * multiplied both ways. Measured against a simulated Divi page before the
 * armour existed: 2px of side padding became 24px on the headers and 6px on
 * the cells, and the table went from 726px wide to 1152px — 59% wider, 400px
 * taller, inside a scroller the reader drags half again as far.
 *
 * `.scs-matrix th` is one class and two elements and so is Divi's
 * `.entry-content tr th` — a TIE, settled by whichever stylesheet WordPress
 * enqueued last. fpa.css bet a layout on that coin toss and lost it in
 * production, so the `.scs` in front of these is load-bearing.
 */
describe("the schedule stylesheet outranks the host theme", () => {
  let css;

  before(async () => {
    css = await (await fetch(`${server.origin}/schedule.css`)).text();
  });

  test("every matrix cell is armed above Divi's tie, not level with it", () => {
    assert.ok(
      css.includes(".scs .scs-matrix th,\n.scs .scs-matrix td {"),
      "the cell rule must carry the second class",
    );
    assert.ok(
      css.includes(".scs .scs-matrix thead th {"),
      "and so must the week numbers across the top",
    );
  });

  test("the grid never adopts a border-top it does not draw", () => {
    const armed = css.slice(css.indexOf("Theme armour"));
    assert.ok(
      /\.scs \.scs-matrix th,\n\.scs \.scs-matrix td \{[^}]*border-top: 0/.test(armed),
      "the matrix draws bottom and left lines only; a theme's top line is 600 of them",
    );
  });

  /**
   * The font armour pins every element with `!important`, so it must pin each
   * one to the family its own rule chose. Pinned to `--sc-font` it turned every
   * Space Grotesk title, score and matrix cell into DM Sans, standalone too.
   */
  test("the font armour keeps the display family where a rule set it", () => {
    assert.ok(
      css.includes("font-family: var(--scs-ff) !important;"),
      "the armour must read the per-element token, not the one text family",
    );
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = bare.match(/[^{}]+\{[^}]*\}/g) ?? [];
    for (const rule of rules) {
      const m = rule.match(/font-family: var\((--scs-font(?:-display)?)\);/);
      if (!m || /^\s*:where/.test(rule)) continue;
      const selector = rule.slice(0, rule.indexOf("{")).trim();
      if (/^\.scs\s*$|^body\.scs-page$/.test(selector)) continue;
      assert.ok(
        rule.includes("--scs-ff:"),
        `${selector} sets ${m[1]} but not --scs-ff, so the armour overrides it`,
      );
    }
  });

  /**
   * The board's three width thresholds stay in the order that makes them mean
   * something.
   *
   * They are one mechanism in three blocks: below `compact` the row prints
   * codes instead of names, between `compact` and `scale` it shrinks its type,
   * and above `label` it can afford to spell out the matchup link and widen
   * that link's column to fit. Each was measured (see the comments beside
   * them), and a later edit that moved one without the others would not look
   * broken — it would truncate "Commanders" on some band of widths nobody
   * happens to open. This asserts only the relationship, which is the part that
   * can be checked without a browser; the values themselves come from the
   * sweep.
   */
  test("the row's width thresholds are ordered", () => {
    const at = (pattern) => {
      const found = pattern.exec(css);
      assert.ok(found, `no threshold matched ${pattern}`);
      return Number(found[1]);
    };

    const compact = at(/@container \(max-width: (\d+)px\) \{\s*\.scs-game-name/);
    const scale = at(/@container \(max-width: (\d+)px\) \{\s*\.scs-board-head/);
    const wide = at(/@container \(min-width: (\d+)px\) \{\s*\.scs-board-head/);

    assert.ok(compact < scale, `compact ${compact} must sit inside the scaling band ${scale}`);
    assert.ok(scale <= wide, `the wide columns at ${wide} must not turn on inside the squeeze at ${scale}`);

    // And the scaling band's clamp counts down from its own threshold. A clamp
    // still counting from the old number is the shape this went wrong in once.
    assert.ok(
      css.includes(`calc(16px - (${scale}px - 100cqw) / 48.3)`),
      `the clamp does not count from ${scale}px`,
    );
  });

  /**
   * The row's "MATCHUP" label holds until the names themselves drop to codes.
   * It was once hidden below 800px of board; a width sweep found no name
   * truncating with it on above 584px once the row's columns followed the
   * board instead of the window.
   */
  test("the matchup label goes with the names, and no row column follows the window", () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const hides = [...bare.matchAll(/\.scs-go-label\s*\{[^}]*display:\s*none/g)];
    assert.equal(hides.length, 1, "the label is hidden in exactly one place");
    const compact = bare.slice(bare.lastIndexOf("@container", hides[0].index), hides[0].index);
    assert.match(compact, /^@container \(max-width: \d+px\) \{\s*\.scs-game-name/,
      "and that place is the block that drops the names to codes");
    const phone = bare.slice(bare.lastIndexOf("@media (max-width: 640px)"));
    assert.match(phone, /\.scs-go-label\s*\{\s*display:\s*inline/,
      "the phone layout, which has a row for it, shows it again");

    const media = css.match(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? [];
    for (const block of media) {
      if (/max-width: 640px/.test(block)) continue; // the phone layout is its own grid
      assert.ok(
        !/\.scs-game\s*\{[^}]*grid-template-columns/.test(block),
        `a media query sets the row's columns from the window: ${block.slice(0, 60)}`,
      );
    }
  });

  test("links keep the colour of the cell they fill", () => {
    const armed = css.slice(css.indexOf("Theme armour"));
    assert.ok(armed.includes(".scs .scs-matrix a {"), "the grid's links are unarmed");
    assert.ok(armed.includes(".scs .scs-rail-link"), "the week rail is unarmed");
    assert.ok(armed.includes(".scs .scs-game-name"), "the board's game titles are unarmed");
    // One class against Divi's `.entry-content a`, which is a class and an
    // element: the theme wins outright, and every row ends in a bright blue
    // MATCHUP on a board whose own accent is the gold.
    assert.ok(armed.includes(".scs .scs-go {"), "the row's matchup link is unarmed");
  });
});
