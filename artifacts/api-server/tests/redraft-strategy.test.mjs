/**
 * Redraft draft strategy analysis.
 *
 * Two halves. The model (lib/redraft-strategy/model.ts) is held to the
 * standalone app's own code: tests/fixtures/redraft-strategy-source-2026-10-10.json
 * is what the app's lib/stats.ts, lib/filter-utils.ts and the arithmetic cut
 * verbatim out of its React components (StrategyTable, StrategyCharts,
 * CompareTable, CompareRoundValueTable, RobustRbRebound, at 33f0cb3) computed
 * over the packed data for four league formats and two comparisons, and
 * every score, interval, volatility and sentence here must match it. Then the
 * routes are checked over HTTP: the page, the fragment the plugin prints and
 * the slices the bundle redraws from.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";
import { importModule } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data", "redraft-strategy");
const model = await importModule("lib/redraft-strategy/model");
const charts = await importModule("lib/redraft-strategy/charts");
const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "redraft-strategy-source-2026-10-10.json"), "utf8"));
const combo = (key) => JSON.parse(readFileSync(path.join(DATA, "combos", `${key}.json`), "utf8"));
const trend = (key) => JSON.parse(readFileSync(path.join(DATA, "trends", `${key}.json`), "utf8"));

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

/** The app wrote " — " in its sentences; the house rule is a comma. */
const noDash = (s) => s.replace(/\s+—\s+/g, ", ");

describe("the model reproduces the standalone app", () => {
  for (const [key, c] of Object.entries(fixture.combos)) {
    test(`league format ${key}`, () => {
      const data = combo(key);
      const merged = model.mergeStrategies(data.best_strategies, data.worst_strategies);
      assert.deepEqual(merged.map((r) => r.strategy), c.merged_names, "best then worst, deduplicated");
      const scored = model.computeScores(merged);
      assert.deepEqual(
        scored.map((r) => ({ strategy: r.strategy, safety_score: r.safety_score, upside_score: r.upside_score })),
        c.scored,
        "floor and ceiling scores",
      );
      const byLift = model.strategyTableView(merged, model.defaultTableState());
      assert.deepEqual(byLift.rows.map((r) => r.strategy), c.by_lift, "the default sort, by lift");
      const byName = model.strategyTableView(merged, { ...model.defaultTableState(), sortKey: "strategy", sortDir: "asc" });
      assert.deepEqual(byName.rows.map((r) => r.strategy), c.by_name, "sorted by name");
      assert.deepEqual(merged.map((r) => model.strategyExplanation(r)), c.explanations.map(noDash), "row explanations");
      assert.deepEqual(merged.map((r) => model.trustTier(r.sample_size).label), c.trust, "trust tiers");

      const five = model.strategyTableView(data.best_first_five_builds, model.defaultTableState(), 250);
      assert.equal(five.hiddenCount, c.first_five_hidden, "low-sample builds hidden");
      assert.deepEqual(five.rows.map((r) => [r.strategy, r.safety_score, r.upside_score]), c.first_five_scored, "scored over what is visible");

      const view = model.chartView([...data.best_strategies, ...data.worst_strategies], data.baseline.playoff_rate, "playoff_rate");
      assert.deepEqual(view.bars.map((b) => [b.name, model.barTier(b.value, view.baseline).color]), c.bar_colors, "bar order and tier colors");

      assert.deepEqual(model.roundView(data.round_value.rounds, 1).qualifying.map((p) => p.strategy), c.round1, "round 1 positions with sample");
    });
  }

  for (const [key, t] of Object.entries(fixture.trends)) {
    test(`comparison ${key}`, () => {
      const data = trend(key);
      const check = (rows, name, minSample, metric, weighting, want) => {
        const view = model.compareTableView(rows, { ...model.defaultCompareState(), metric, weighting, sortKey: "name", sortDir: "asc" }, minSample);
        const got = view.rows.map((r) => ({ name: r.name, rate: r.agg.rate, n: r.agg.n, ci: r.agg.ci, vol: r.volatility }));
        const wantSorted = [...want].sort((a, b) => a.name.localeCompare(b.name));
        assert.deepEqual(norm(got), norm(wantSorted), `${name} ${metric} ${weighting}`);
      };
      check(data.overall_strategies, "overall", 10, "playoff", "pooled", t.overall.playoff_pooled);
      check(data.overall_strategies, "overall", 10, "playoff", "balanced", t.overall.playoff_balanced);
      check(data.overall_strategies, "overall", 10, "pf", "pooled", t.overall.pf_pooled);
      check(data.overall_strategies, "overall", 10, "pf", "balanced", t.overall.pf_balanced);
      check(data.first_two_pick_combos, "first two", 25, "playoff", "pooled", t.first_two.playoff_pooled);
      check(data.first_two_pick_combos, "first two", 25, "pf", "balanced", t.first_two.pf_balanced);

      for (const [round, want] of Object.entries(t.rounds)) {
        const v = model.compareRoundView(data.round_value, Number(round));
        assert.deepEqual(
          norm(v.rows.map((r) => ({ position: r.pos.position, avg: r.avg, vol: r.volatility }))),
          norm(want),
          `round ${round}`,
        );
      }

      const robust = model.periodPair(data, "Robust RB");
      const zero = model.periodPair(data, "Zero RB");
      assert.deepEqual(norm(robust), norm(t.robust), "Robust RB periods");
      assert.deepEqual(norm(zero), norm(t.zero), "Zero RB periods");
    });
  }

  test("the comparison's default sort is the pooled average, descending", () => {
    const data = trend("one_qb__ppr__no_tep__12");
    const view = model.compareTableView(data.overall_strategies, model.defaultCompareState(), 10);
    for (let i = 1; i < view.rows.length; i += 1) assert.ok(view.rows[i - 1].agg.rate >= view.rows[i].agg.rate);
    assert.deepEqual(view.shown, ["2021", "2022", "2023", "2024", "2025"]);
  });

  test("filters follow the app's rules", () => {
    for (const [f, want] of fixture.filters.unsupported) assert.equal(model.isUnsupportedFormat(f), want, JSON.stringify(f));
    for (const [k, v, f, want] of fixture.filters.would) assert.equal(model.wouldSelectUnsupportedFormat(f, k, v), want, `${k}=${v}`);
    assert.deepEqual(model.coerceSupportedFormat({ qb: "one_qb", scoring: "half_ppr", tep: "tep", size: "10", season: "2024" }), fixture.filters.coerce);
    assert.equal(model.comboKey({ qb: "superflex", scoring: "half_ppr", tep: "tep", size: "12", season: "compare" }), fixture.filters.key);
    assert.deepEqual(model.parseFilters({ qb: "nope", season: "compare" }), { ...model.DEFAULT_FILTERS, season: "compare" });
    assert.deepEqual(model.parseFilters({ qb: "one_qb", scoring: "half_ppr", tep: "tep", size: "10" }).size, "12", "a stale unsupported format is nudged to 12 teams");
    assert.equal(model.parseKey("one_qb__ppr__no_tep__12__2025"), "one_qb__ppr__no_tep__12__2025");
    assert.equal(model.parseKey("../x"), null);
  });

  test("the statistics are the app's", () => {
    assert.deepEqual(
      norm([[0.5, 100], [0.381, 1422], [0.9, 5], [0, 10], [0.5, 0]].map(([p, n]) => model.wilson95(p, n))),
      norm(fixture.stats.wilson),
    );
    assert.deepEqual(norm(model.pooled([{ rate: 0.5, n: 100 }, { rate: 0.6, n: 300 }, { rate: null, n: 5 }])), norm(fixture.stats.pooled));
    assert.deepEqual(norm(model.seasonBalanced([{ rate: 0.5, n: 100 }, { rate: 0.6, n: 300 }, { rate: 0.7, n: 0 }])), norm(fixture.stats.balanced));
    assert.equal(model.fmtCiPp(model.wilson95(0.5, 100)), fixture.stats.ciPp);
    assert.equal(model.fmtCiRange(model.wilson95(0.381, 1422)), fixture.stats.ciRange);
  });

  test("the draft board numbers its picks as a snake", () => {
    const boards = JSON.parse(readFileSync(path.join(DATA, "boards.json"), "utf8"));
    assert.equal(boards.length, 7);
    const v = model.boardView(boards[0], { index: 0, strategy: "" });
    assert.equal(v.cells[0][0].label, "1.01");
    assert.equal(v.cells[0][11].label, "1.12");
    assert.equal(v.cells[1][11].label, "2.01", "round two starts at the last slot");
    assert.equal(v.cells[1][0].label, "2.12");
    assert.equal(v.cells[0][0].rank, "RB1", "the first back off the board");
    assert.equal(v.chosen, boards[0].strategies[0].strategy, "the first strategy is highlighted by default");
    assert.ok(v.cells[0].some((c) => c.featured));
    assert.deepEqual(v.groups.flatMap((g) => g.slots).sort((a, b) => a - b), v.slots);
    assert.equal(model.abbreviateFirstName("Christian McCaffrey"), "C. McCaffrey");
    assert.equal(model.abbreviateFirstName("Christian McCaffrey", true), "CM");
    assert.equal(model.initialsOf("Amon-Ra St. Brown"), "AB");
  });
});

describe("the chart", () => {
  test("snaps its axis to 5pp steps around the bars and marks the neutral band", () => {
    const data = combo("one_qb__ppr__no_tep__12__2025");
    const view = model.chartView([...data.best_strategies, ...data.worst_strategies], 0.5, "playoff_rate");
    assert.equal(view.baseline, 0.5);
    assert.equal(view.domMin, 0.35);
    assert.equal(view.domMax, 0.6);
    assert.deepEqual([view.bandLo, view.bandHi], [0.48, 0.52]);
    assert.ok(view.bars[0].value <= view.bars.at(-1).value, "ascending, as the app fed recharts");
    assert.deepEqual(charts.axisTicks(0.35, 0.6), [0.35, 0.4125, 0.475, 0.5375, 0.6]);
    assert.equal(charts.chartHeight(10), 360);
    assert.equal(charts.chartHeight(4), 340);
  });

  test("uses the metric's mean as the baseline for the other two rates", () => {
    const data = combo("one_qb__ppr__no_tep__12__2025");
    const rows = [...data.best_strategies, ...data.worst_strategies];
    const view = model.chartView(rows, 0.5, "championship_rate");
    const seen = new Set();
    const vals = rows.filter((r) => !seen.has(r.strategy) && seen.add(r.strategy)).map((r) => r.championship_rate).filter((v) => v > 0);
    assert.ok(Math.abs(view.baseline - vals.reduce((a, b) => a + b, 0) / vals.length) < 1e-12);
  });

  test("draws a bar, its labels and a hit band per row", () => {
    const data = combo("one_qb__ppr__no_tep__12__2025");
    const view = model.chartView([...data.best_strategies, ...data.worst_strategies], 0.5, "playoff_rate");
    const svg = charts.renderRankingChart(view, 900, "test");
    assert.equal((svg.match(/class="scds-bar"/g) ?? []).length, view.bars.length);
    assert.equal((svg.match(/class="scds-hit"/g) ?? []).length, view.bars.length);
    assert.match(svg, /League Avg 50\.0%/);
    assert.match(svg, /class="scds-band"/);
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

  test("the standalone page renders the default view with one H1 and stays out of the index", async () => {
    const res = await fetch(`${server.origin}/redraft-strategy`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, indexifembedded");
    const html = await res.text();
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /<title>Fantasy Football Redraft Strategy Analysis - StatChasers<\/title>/);
    assert.match(html, /<link rel="canonical" href="[^"]*\/redraft-strategy" \/>/);
    for (const label of ["Strategy Ranking", "Overall Strategies", "Round Value", "First Two Picks", "First Five Rounds", "Real Draft Examples"]) {
      assert.match(html, new RegExp(`class="scds-h2">${label}</h2>`), label);
    }
    assert.match(html, /data-scds-season="2025"/);
    assert.match(html, /class="scds-opt is-active" data-qb="one_qb"/);
    assert.match(html, /<option value="2025" selected>/);
    assert.match(html, /4,208<\/strong> leagues/);
    assert.equal((html.match(/<tr class="scds-row" data-row=/g) ?? []).length, 10 + 3 + 8 + 2, "overall, round 1, first two, first five rows");
    assert.equal((html.match(/class="scds-cell is-/g) ?? []).length, 180, "a 12-team, 15-round board");
    assert.match(html, /data-board-label="12-Team PPR · Slot 1 goes Robust RB"/);
    assert.match(html, /data-scds-data="\/embed\/redraft-strategy\/data"/);
    assert.doesNotMatch(html, /—/, "no em dashes");
    assert.doesNotMatch(html, /sleeper/i, "no source names");
    assert.doesNotMatch(html, /sleepercdn|espncdn/, "no outside image hosts");
    const avatars = html.match(/class="scds-cell-avatar"[^>]*>(?:<img [^>]*data-fallback="[A-Z0-9]{1,2}" \/>|[A-Z0-9]{1,2})<\/span>/g) ?? [];
    assert.equal(avatars.length, 180, `every pick has a headshot or its initials (${(html.match(/scds-cell-avatar/g) ?? []).length} avatars)`);
    assert.doesNotMatch(html, /scds-page-data/, "the island is for the embed only");
  });

  test("the fragment has no H1, carries the page words and points at the data", async () => {
    const res = await fetch(`${server.origin}/embed/redraft-strategy`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /<h1\b/);
    assert.match(html, /class="scds is-embed"/);
    const island = html.match(/<script type="application\/json" class="scds-page-data">(.*?)<\/script>/);
    assert.ok(island, "page-data island");
    const copy = JSON.parse(island[1]);
    assert.equal(copy.h1, "Redraft Draft Strategy Analysis");
    assert.equal(copy.title, "Fantasy Football Redraft Strategy Analysis - StatChasers");
    assert.ok(copy.description);
    assert.match(html, /data-scds-data="http:\/\/127\.0\.0\.1:\d+\/embed\/redraft-strategy\/data"/);
  });

  test("the data slices are the committed files", async () => {
    const c = await fetch(`${server.origin}/embed/redraft-strategy/data/combo/one_qb__ppr__no_tep__12__2025`);
    assert.equal(c.status, 200);
    assert.match(c.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await c.json(), combo("one_qb__ppr__no_tep__12__2025"));
    const t = await fetch(`${server.origin}/embed/redraft-strategy/data/trends/superflex__ppr__tep__10`);
    assert.equal(t.status, 200);
    assert.deepEqual(await t.json(), trend("superflex__ppr__tep__10"));
    const b = await fetch(`${server.origin}/embed/redraft-strategy/data/boards`);
    assert.equal(b.status, 200);
    const slice = await b.json();
    assert.equal(slice.boards.length, 7);
    assert.ok(slice.boards.every((board) => board.picks.every((p) => /^[A-Z0-9]+$/.test(p.player_id))), "every pick carries its Sleeper id (a number, or a club code for a defense)");
    assert.equal(typeof slice.assets?.headshots, "object", "the headshot versions ride along");
    assert.equal((await fetch(`${server.origin}/embed/redraft-strategy/data/combo/nope`)).status, 404);
    assert.equal((await fetch(`${server.origin}/embed/redraft-strategy/data/combo/one_qb__ppr__no_tep__12__2025/x`)).status, 404);
  });

  test("the stylesheet and bundle are served", async () => {
    for (const p of ["/redraft-strategy.css", "/dist/statchasers-redraft-strategy.js"]) {
      assert.equal((await fetch(`${server.origin}${p}`)).status, 200, p);
    }
  });
});
