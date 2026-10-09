/**
 * Dynasty rookie hit rates.
 *
 * Three halves. The model (lib/rookie-hit-rates/model.ts) is held to the
 * standalone app's own output: tests/fixtures/rookie-hit-rates-source-2026-10-08.json
 * is what the app's cohort.ts, insight generators, patience math and class
 * table computed from its CSVs (at 9c69b00) for six filter combinations, and
 * every number, sample size and sentence here must match it. The charts' path
 * and tick helpers and the draft board's layout ladder are pinned on their
 * own. Then the routes are checked over HTTP: the page, the fragment the
 * plugin prints and the dataset the bundle recomputes from.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";
import { importModule } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = await importModule("lib/rookie-hit-rates/model");
const charts = await importModule("lib/rookie-hit-rates/charts");
const layout = await importModule("lib/rookie-hit-rates/board-layout");
const data = JSON.parse(readFileSync(path.join(HERE, "..", "data", "rookie-hit-rates", "hit-rates.json"), "utf8"));
const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "rookie-hit-rates-source-2026-10-08.json"), "utf8"));

/** Round like the fixture, and compare keys in any order. */
function norm(value) {
  const sort = (x) =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]))
        : typeof x === "number"
          ? Math.round(x * 1e9) / 1e9
          : x;
  return sort(JSON.parse(JSON.stringify(value)));
}

describe("the model reproduces the standalone app", () => {
  for (const [i, c] of fixture.cases.entries()) {
    const f = c.filters;
    const label = `case ${i}: ${f.format}/${f.scoring}/${f.outcome} ${f.yearStart}-${f.yearEnd} pos ${f.positions.join("") || "all"} rd ${f.rounds.join("") || "all"} ${f.minGames}g`;
    test(label, () => {
      const board = model.makeBoard(data, f.format, f.scoring);
      const ov = model.overviewView(board, f);
      assert.deepEqual(norm(ov.cohorts), norm(c.cohorts), "heatmap cohorts");
      assert.deepEqual(norm(ov.pickRange), norm(c.pickRange), "pick-range cohorts");
      assert.deepEqual(norm(ov.insights), norm(c.overviewInsights), "overview cards");

      const tv = model.trendsView(board, f);
      assert.deepEqual(norm(tv.series.map((s) => s.raw)), norm(c.trends), "class series");
      assert.deepEqual(norm(tv.insights), norm(c.trendInsights), "class cards");
      assert.deepEqual(norm(tv.classes), norm(c.classRows), "players who hit by class");
      for (const row of tv.classes) {
        const board2 = model.draftBoard(board.drafts, board.ranks, f, row.year).map((p) => [p.id, p.round, p.pick, p.hit]);
        assert.deepEqual(board2, c.boards[row.year], `draft board ${row.year}`);
      }

      for (const g of ["pos", "round"]) {
        const cv = model.cohortsView(board, f, g);
        assert.deepEqual(norm(cv.survival), norm(c.survival[g]), `survival by ${g}`);
        assert.deepEqual(norm(cv.insights), norm(c.cohortInsights[g]), `cohort cards by ${g}`);
        assert.deepEqual(norm(cv.patience), norm(c.patience[g]), `hit rates after year 1 by ${g}`);
        const rows = cv.roster.rows.map(({ group, n, y1, y2, y3, ceiling, remY3, afterY1, afterY2, afterY3 }) => ({
          group, n, y1, y2, y3, ceiling, remY3, afterY1, afterY2, afterY3,
        }));
        assert.deepEqual(norm(rows), norm(c.roster[g].rows), `remaining hit odds by ${g}`);
        assert.equal(cv.roster.takeaway, c.roster[g].takeaway, `takeaway by ${g}`);
      }

      if (c.players) {
        const ps = model.playerSummaries(board, f);
        assert.deepEqual(
          ps.map((p) => [p.player_id, p.best_finish, p.breakout_time, p.hit_type]),
          c.players,
          "player explorer rows",
        );
      }
    });
  }

  test("the default view is the one readers see first", () => {
    const state = model.defaultState(data);
    assert.deepEqual(state.filters, {
      yearStart: 2017,
      yearEnd: 2025,
      format: "sf",
      scoring: "ppr",
      outcome: "elite",
      positions: ["QB", "RB", "WR", "TE"],
      rounds: [1, 2, 3, 4, 5],
      minGames: 8,
    });
    assert.equal(state.tableView, "simple");
    assert.deepEqual(state.classSort, { key: "year", dir: "asc" });
    const ov = model.overviewView(model.makeBoard(data, "sf", "ppr"), state.filters);
    assert.equal(ov.insights[0].stat, "19.6%");
    assert.equal(ov.insights[0].body, "104 of 530 rookies reached the top-12 threshold.");
    assert.equal(ov.insights.length, 4, "the Overview shows up to six cards; the default makes four");
  });

  test("survival never falls year over year", () => {
    const board = model.makeBoard(data, "1qb", "hppr");
    for (const g of model.computeSurvival(board.drafts, board.ranks, "round", "flex", 4, data.latestSeason)) {
      for (let i = 1; i < g.data.length; i += 1) assert.ok(g.data[i].pct >= g.data[i - 1].pct, g.group);
    }
  });

  test("a season before the rookie year never counts as a hit", () => {
    // The source's 9c69b00 fix: a few ids carry an earlier player's seasons.
    const board = model.makeBoard(data, "sf", "ppr");
    for (const p of model.playerSummaries(board, model.defaultFilters(data))) {
      assert.ok(p.breakout_time === null || p.breakout_time >= 1, `${p.player_id} breakout ${p.breakout_time}`);
      assert.ok(p.best_finish === "N/A" || p.best_finish_year >= p.rookie_year, `${p.player_id} best finish ${p.best_finish}`);
    }
  });

  test("the player explorer sorts and pages as the app's table does", () => {
    const board = model.makeBoard(data, "sf", "ppr");
    const state = model.defaultState(data);
    const all = model.playerSummaries(board, state.filters);
    const byYear = model.filterPlayers(all, state);
    assert.equal(byYear.length, 530);
    assert.equal(byYear[0].rookie_year, 2025, "newest class first by default");
    const best = model.filterPlayers(all, { ...state, sortField: "best_finish", sortDir: "asc" });
    assert.equal(best[0].best_rank, 1);
    assert.equal(best.at(-1).best_finish, "N/A", "players with no finish sink");
    const bestDesc = model.filterPlayers(all, { ...state, sortField: "best_finish", sortDir: "desc" });
    assert.equal(bestDesc.at(-1).best_finish, "N/A", "...whichever way the column runs");
    assert.ok(bestDesc[0].best_rank > best[0].best_rank);
    const breakout = model.filterPlayers(all, { ...state, sortField: "breakout_time", sortDir: "desc" });
    assert.equal(breakout.at(-1).breakout_time, null, "no breakout sinks too");
    assert.ok(breakout[0].breakout_time >= 1);
    const search = model.filterPlayers(all, { ...state, search: "BIJAN" });
    assert.deepEqual(search.map((p) => p.player_id), ["bijan-robinson"]);
  });

  test("the class table sorts with the year as the tie-break", () => {
    const rows = [
      { year: 2019, QB: 2, RB: 1, WR: 0, TE: 0, total: 3 },
      { year: 2017, QB: 2, RB: 0, WR: 0, TE: 0, total: 2 },
      { year: 2018, QB: 1, RB: 2, WR: 0, TE: 0, total: 3 },
    ];
    assert.deepEqual(model.sortClassRows(rows, { key: "year", dir: "asc" }).map((r) => r.year), [2017, 2018, 2019]);
    assert.deepEqual(model.sortClassRows(rows, { key: "total", dir: "desc" }).map((r) => r.year), [2018, 2019, 2017]);
    assert.deepEqual(model.sortClassRows(rows, { key: "QB", dir: "desc" }).map((r) => r.year), [2017, 2019, 2018]);
  });

  test("names shorten as the app's did", () => {
    assert.equal(model.abbreviateName("Ja'Marr Chase"), "J. Chase");
    assert.equal(model.abbreviateName("Amon-Ra St. Brown"), "A. St. Brown");
    assert.equal(model.abbreviateName("Cher"), "Cher");
  });
});

describe("the dataset", () => {
  test("carries the app's four boards and only drafted players' seasons", () => {
    assert.deepEqual(Object.keys(data.boards).sort(), ["1qb-hppr", "1qb-ppr", "sf-hppr", "sf-ppr"]);
    assert.equal(Object.values(data.boards).reduce((n, b) => n + b.length, 0), 2150);
    assert.equal(data.players.length, data.seasons.length);
    assert.equal(data.latestSeason, 2025);
    assert.ok(!data.players.some((p) => p[4] === "JAC"), "Jacksonville is JAX here");
  });
});

describe("chart helpers", () => {
  test("the monotone curve never leaves the band its points span", () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 100 },
    ];
    const d = charts.monotonePath(pts);
    const ys = [...d.matchAll(/[MC]([^A-Z]+)/g)].flatMap((m) =>
      m[1].split(/[ ,]/).filter(Boolean).filter((_, i) => i % 2 === 1).map(Number),
    );
    assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 100, d);
  });

  test("percentage axes end on a round tick", () => {
    assert.deepEqual(charts.niceTicks(0.559), { max: 0.6, ticks: [0, 0.2, 0.4, 0.6] });
    assert.deepEqual(charts.niceTicks(0.37).max, 0.4);
    assert.ok(charts.niceTicks(0).ticks.length >= 2);
  });

  test("a line chart can start above zero", () => {
    const opts = {
      width: 400,
      height: 200,
      xs: [1, 2],
      yMax: 0.4,
      yTicks: [0.2, 0.4],
      series: [{ key: "a", name: "a", color: "#000", points: [{ x: 1, y: 0.2 }, { x: 2, y: 0.4 }] }],
      label: "t",
    };
    const floor = charts.renderLineChart({ ...opts, yMin: 0.2 });
    const zero = charts.renderLineChart(opts);
    const firstY = (svg) => Number(svg.match(/<path d="M[\d.]+,([\d.]+)/)[1]);
    assert.ok(firstY(floor) > firstY(zero), "the 20% point sits lower when the axis starts at 20%");
  });
});

describe("the draft board's layout ladder", () => {
  const widths = new Map([
    [1, { full: 120, abbrev: 70 }],
    [2, { full: 110, abbrev: 60 }],
    [3, { full: 100, abbrev: 65 }],
  ]);
  const rounds = [1, 2, 3];
  const ladder = layout.buildLadder(3);

  test("gives up the cheapest thing first", () => {
    const roomy = layout.chooseLayout(ladder, rounds, widths, 900, 12);
    assert.deepEqual(roomy, { abbrev: false, chrome: "normal", cols: 3, fill: true });
    const tight = layout.chooseLayout(ladder, rounds, widths, 420, 12);
    assert.equal(tight.abbrev, true);
    assert.equal(tight.cols, 3);
    const squeezed = layout.chooseLayout(ladder, rounds, widths, 200, 12);
    assert.ok(squeezed.cols < 3, "rounds wrap when nothing else fits");
    assert.equal(squeezed.chrome, "none");
  });

  test("falls back to the last rung rather than nothing", () => {
    assert.deepEqual(layout.chooseLayout(ladder, rounds, widths, 10, 12), ladder.at(-1));
  });
});

describe("routes", () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(async () => {
    await server?.stop();
  });

  test("the standalone page renders every tab with one H1 and stays out of the index", async () => {
    const res = await fetch(`${server.origin}/rookie-hit-rates`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, indexifembedded");
    const html = await res.text();
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /<title>Dynasty Rookie Hit Rates/);
    assert.match(html, /<link rel="canonical" href="[^"]*\/rookie-hit-rates" \/>/);
    for (const tab of ["overview", "trends", "cohorts", "players"]) {
      assert.match(html, new RegExp(`data-panel="${tab}"`), tab);
    }
    for (const label of ["Overview", "Draft Classes", "Year-by-Year", "Players"]) {
      assert.match(html, new RegExp(`data-tab="[a-z]+">${label}</button>`), label);
    }
    assert.equal((html.match(/class="schr-cell[^"]*" data-tier/g) ?? []).length, 20 + 80, "heatmap and pick-range cells, both tables in the page");
    assert.match(html, /data-table-view-panel="simple">/, "the heatmap shows");
    assert.match(html, /data-table-view-panel="detailed" hidden>/, "the pick ranges wait behind the toggle");
    assert.equal((html.match(/<tr class="schr-class-row" data-class-row="\d{4}">/g) ?? []).length, 9, "one class row per season");
    assert.match(html, /Players Who Hit by Class/);
    assert.match(html, /Hit Rates After Year 1/);
    assert.match(html, /Remaining Hit Odds/);
    assert.equal((html.match(/<tr data-player=/g) ?? []).length, 50, "the first page of players");
    assert.doesNotMatch(html, /Finish Yr/, "the finish-year column is gone");
    assert.doesNotMatch(html, /Patience Index|Stability|Pick Lens/, "the old modules are gone");
    assert.match(html, /104 of 530 rookies reached the top-12 threshold\./);
    assert.match(html, /data-schr-data="\/embed\/rookie-hit-rates\/data"/);
    assert.doesNotMatch(html, /—/, "no em dashes");
  });

  test("the fragment has no H1, carries the page words and points at the dataset", async () => {
    const res = await fetch(`${server.origin}/embed/rookie-hit-rates`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /<h1\b/);
    assert.match(html, /class="schr is-embed"/);
    const island = html.match(/<script type="application\/json" class="schr-page-data">(.*?)<\/script>/);
    assert.ok(island, "page-data island");
    const copy = JSON.parse(island[1]);
    assert.equal(copy.h1, "Dynasty Rookie Hit Rates");
    assert.ok(copy.title && copy.description);
    assert.match(html, /data-schr-data="http:\/\/127\.0\.0\.1:\d+\/embed\/rookie-hit-rates\/data"/);
  });

  test("the dataset is the committed file plus profile links", async () => {
    const res = await fetch(`${server.origin}/embed/rookie-hit-rates/data`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.players.length, data.players.length);
    assert.deepEqual(body.boards, data.boards);
    assert.equal(typeof body.profiles, "object");
    for (const url of Object.values(body.profiles)) assert.match(url, /^https:\/\/statchasers\.com\/nfl\/players\/[a-z0-9-]+\/$/);
  });

  test("the stylesheet and bundle are served", async () => {
    for (const p of ["/rookie-hit-rates.css", "/dist/statchasers-rookie-hit-rates.js"]) {
      assert.equal((await fetch(`${server.origin}${p}`)).status, 200, p);
    }
  });
});
