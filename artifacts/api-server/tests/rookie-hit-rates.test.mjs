/**
 * Dynasty rookie hit rates.
 *
 * Three halves. The model (lib/rookie-hit-rates/model.ts) is held to the
 * standalone app's own output: tests/fixtures/rookie-hit-rates-source-2026-10-05.json
 * is what the app's cohort.ts and insight generators computed from its CSVs
 * for six filter combinations, and every number, sample size and sentence here
 * must match it. The charts' path and tick helpers are pinned on their own.
 * Then the routes are checked over HTTP: the page, the fragment the plugin
 * prints and the dataset the bundle recomputes from.
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
const data = JSON.parse(readFileSync(path.join(HERE, "..", "data", "rookie-hit-rates", "hit-rates.json"), "utf8"));
const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "rookie-hit-rates-source-2026-10-05.json"), "utf8"));

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
      assert.deepEqual(norm(ov.pickRangeInsights), norm(c.pickRangeInsights), "pick-range cards");

      const tv = model.trendsView(board, f);
      assert.deepEqual(norm(tv.series.map((s) => s.raw)), norm(c.trends), "trend series");
      assert.deepEqual(norm(tv.insights), norm(c.trendInsights), "trend cards");

      for (const g of ["pos", "round"]) {
        const cv = model.cohortsView(board, f, g);
        assert.deepEqual(norm(cv.survival), norm(c.survival[g]), `survival by ${g}`);
        assert.deepEqual(norm(cv.insights), norm(c.cohortInsights[g]), `cohort cards by ${g}`);
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
    const ov = model.overviewView(model.makeBoard(data, "sf", "ppr"), state.filters);
    assert.equal(ov.insights[0].stat, "19.6%");
    assert.equal(ov.insights[0].body, "104 of 530 rookies reached the top-12 threshold.");
  });

  test("survival never falls year over year", () => {
    const board = model.makeBoard(data, "1qb", "hppr");
    for (const g of model.computeSurvival(board.drafts, board.ranks, "round", "flex", 4, data.latestSeason)) {
      for (let i = 1; i < g.data.length; i += 1) assert.ok(g.data[i].pct >= g.data[i - 1].pct, g.group);
    }
  });

  test("the player explorer sorts and pages as the app's table did", () => {
    const board = model.makeBoard(data, "sf", "ppr");
    const state = model.defaultState(data);
    const all = model.playerSummaries(board, state.filters);
    const byYear = model.filterPlayers(all, state);
    assert.equal(byYear.length, 530);
    assert.equal(byYear[0].rookie_year, 2025, "newest class first by default");
    const best = model.filterPlayers(all, { ...state, sortField: "best_finish", sortDir: "asc" });
    assert.equal(best[0].best_rank, 1);
    assert.equal(best.at(-1).best_finish, "N/A", "players with no finish sink");
    const search = model.filterPlayers(all, { ...state, search: "BIJAN" });
    assert.deepEqual(search.map((p) => p.player_id), ["bijan-robinson"]);
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
    assert.equal((html.match(/class="schr-cell[^"]*" data-tier/g) ?? []).length, 20 + 80, "heatmap and pick-range cells");
    assert.equal((html.match(/<tr data-player=/g) ?? []).length, 50, "the first page of players");
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
