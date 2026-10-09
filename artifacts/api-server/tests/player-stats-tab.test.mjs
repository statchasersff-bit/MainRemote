/**
 * The Stats tab, rendered against hand-built states.
 *
 * Like tests/player-overview.test.mjs: the edge states the spec lists -
 * preseason, a one-season rookie, a traded season, a player below the
 * qualifying line - are not reliably on the roster on any given day.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";
import { APP_DIR } from "./helpers/server.mjs";

const st = await importModule("lib/player/stats-tab");

after(cleanupBundles);

const ARI = {
  code: "ARI", slug: "arizona-cardinals", nickname: "Cardinals", fullName: "Arizona Cardinals",
  primaryColor: "#97233F", secondaryColor: "#FFB612", logo: "",
};

/** A QB week: `pts` fantasy points, `rank` his weekly finish. */
const qb = (week, pts, rank, team = "ARI", extra = {}) => ({
  week, opp: "SEA", team, game_status: "active", pos_rank: rank,
  stats: { pts_ppr: pts, pass_att: 30, pass_cmp: 20, pass_yd: 200, pass_td: 1, pass_int: 1, rush_att: 3, rush_yd: 10, rush_td: 0, ...extra },
});

const metric = (label, value, read, standing, pct, pctl = pct) => ({ label, value, read, standing, pct, pctl });

const CURRENT = {
  season: 2026, throughWeek: 3, inProgress: true, games: 3, qualified: true, qualifiedCount: 36,
  metrics: [
    metric("EPA per play", "+0.10", "16th of 36 QBs", "mid", 56),
    metric("Success rate", "48.5%", "13th of 36 QBs", "mid", 64),
    metric("Completion rate", "70.1%", "81st percentile", "good", 81),
    metric("Yards per attempt", "5.6", "8th percentile", "bad", 8),
    metric("TD rate", "3.4%", "28th percentile", "bad", 28),
    metric("Pass attempts per game", "39.0", "86th percentile", "good", 86),
  ],
  row: {}, pct: {},
};

const LAST = {
  season: 2025, throughWeek: null, inProgress: false, games: 13, qualified: true, qualifiedCount: 41,
  metrics: [
    metric("Time to throw", "2.94s", "Slower to throw than 76% of QBs", "muted", null, 76),
    metric("Air yards per attempt", "7.6", "Deeper than 41% of QBs", "muted", null),
    metric("Deep-attempt rate", "8.7%", "More aggressive than 17% of QBs", "muted", null),
    metric("Completion % over expected", "+0.9", "54th percentile", "mid", 54),
    metric("EPA per play", "+0.01", "24th of 41 QBs", "mid", 41),
    metric("Pressure rate", "26.1%", "37 sacks, 17th percentile", "bad", 17),
  ],
  row: {}, pct: { deep: 17, ttt: 76 },
};

function state(overrides = {}) {
  return {
    player: { id: "1", slug: "jacoby-brissett", name: "Jacoby Brissett", position: "QB" },
    team: ARI,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    leagueWeek: 3,
    schedule: [
      { week: 1, status: "final", homeAway: "home" },
      { week: 2, status: "final", homeAway: "away" },
      { week: 3, status: "final", homeAway: "away" },
    ],
    production: [{ season: 2026, posFinishPpg: 17 }],
    seasonRank: 17,
    logCareer: [
      { season: 2026, weeks: [qb(1, 16.5, 15), qb(2, 7.5, 28), qb(3, 25.6, 4)], finish: 20 },
      { season: 2025, weeks: Array.from({ length: 14 }, (_, i) => qb(i + 1, 16, 12)), finish: 16 },
      { season: 2024, weeks: Array.from({ length: 8 }, (_, i) => qb(i + 1, 6, 30, "NE", { pass_att: 10 })), finish: 46 },
    ],
    statsAdvanced: { current: CURRENT, last: LAST },
    teammates: [{ name: "Trey McBride", slug: "trey-mcbride", position: "TE" }],
    ...overrides,
  };
}

function render(data, options = {}) {
  const html = st.renderStatsTab(data, options);
  return new JSDOM(`<body><div data-scp-root>${html}</div></body>`).window.document;
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** A card's figures as "label: value" pairs. */
const pairs = (card) =>
  [...card.querySelectorAll("dl > div")].map((d) => `${text(d.querySelector("dt"))}: ${text(d.querySelector("dd"))}`);

describe("stats tab", () => {
  test("the sections in the spec's order, each with an H2 and aria-labelledby", () => {
    const doc = render(state());
    const heads = [...doc.querySelectorAll("section")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      assert.ok(sec.querySelector(".scp-ox-lede") || h2.id === "scp-st-read-h" || h2.id === "scp-st-arc-h", `${h2.id} has a lede`);
      return text(h2);
    });
    assert.deepEqual(heads, [
      "Jacoby Brissett 2026 Stats",
      "Jacoby Brissett Passing Stats",
      "Fantasy Points per Game, Every Season",
      "What His Career Numbers Say",
    ]);
    // mak removed these 2026-09-30: the chart's lede, the table's caption, and
    // then the table itself (the original content's career table has it).
    assert.equal(doc.querySelector("#scp-st-arc-h + .scp-ox-lede"), null);
    assert.equal(doc.querySelector(".scp-st-table caption"), null);
    // Not the panel heading: that one stays with the tab's original content.
    assert.equal(doc.querySelector(".scp-h2"), null);
  });

  test("the toggle: counting stats carry both figures, rates and ranks carry neither", () => {
    const doc = render(state());
    const group = doc.querySelector("[data-scp-seg]");
    assert.equal(group.getAttribute("role"), "group");
    assert.equal(group.getAttribute("aria-label"), "Show stats as");
    const pressed = [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-pressed"));
    assert.deepEqual(pressed, ["true", "false"]);

    // One light-gray rail of cells, label / figure / muted second line, and
    // the fantasy line in its own block beside it (mak, 2026-10-03).
    const cells = [...doc.querySelectorAll(".scp-st-rail > .scp-st-cell")];
    assert.deepEqual(cells.map((c) => text(c.querySelector("dt"))), ["Pass yards", "Comp %", "Pass TD", "INT", "Rushing"]);
    const yards = cells[0].querySelector(".scp-st-cv [data-total]");
    assert.equal(yards.textContent, "600");
    assert.equal(yards.dataset.pg, "200.0");
    const cmpAtt = cells[1].querySelector(".scp-st-cs [data-total]");
    assert.equal(cmpAtt.dataset.pg, "20.0/30.0");
    assert.equal(cells[1].querySelector(".scp-st-cv [data-total]"), null, "completion % is a rate");
    assert.match(text(cells[4].querySelector(".scp-st-cv")), /^\S+ · \S+ TD$/);
    const fantasy = doc.querySelector(".scp-st-prodrow > .scp-st-fan");
    assert.equal(text(fantasy.querySelector("h3")), "Fantasy (PPR)");
    assert.deepEqual(pairs(fantasy), ["Fantasy points: 49.6", "Position rank: QB17"]);
    assert.equal(text(fantasy.querySelector(".scp-st-fan-wk")), "25.6 Best Week 3 @ SEA7.5 Worst Week 2 @ SEA");
    assert.equal(doc.querySelectorAll(".scp-st-rail").length, 1);
  });

  test("the toggle, clicked, through the real client bundle", async () => {
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    assert.ok(fs.existsSync(bundle), "pnpm test builds the bundle first");
    const html = st.renderStatsTab(state());
    const dom = new JSDOM(`<body><div data-scp-root>${html}</div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    // The bundle boots on DOMContentLoaded, which jsdom fires on a later tick.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const [totals, pg] = doc.querySelectorAll("[data-scp-seg] button");
    const yards = doc.querySelector(".scp-st-cell:nth-child(1) .scp-st-cv [data-total]");
    pg.click();
    assert.equal(yards.textContent, "200.0");
    assert.equal(pg.getAttribute("aria-pressed"), "true");
    assert.equal(totals.getAttribute("aria-pressed"), "false");
    assert.equal(text(doc.querySelector(".scp-st-cell:nth-child(2) .scp-st-cv")), "66.7%", "rates never change");
    totals.click();
    assert.equal(yards.textContent, "600");
    dom.window.close();
  });

  test("advanced: one table, the seasons side by side, percentile badges, one footnote", () => {
    const doc = render(state());
    assert.equal(doc.querySelector(".scp-st-advcard"), null, "the cards are a table now (mak, 2026-09-30)");
    const table = doc.querySelector("table.scp-st-advt");
    assert.deepEqual([...table.querySelectorAll("thead th")].map(text), ["Metric", "2026 Current · thru Wk 3", "2025 Previous · 13 games"]);
    // Six this season, five more from last season: EPA per play is one row.
    // Grouped under tier headings, Efficiency first and set heavier (2026-09-30).
    const tiers = [...table.querySelectorAll("tbody tr.scp-st-tier")].map(text);
    assert.equal(tiers[0], "Efficiency");
    assert.ok(tiers.every((t) => ["Efficiency", "Usage", "Style", "Context"].includes(t)));
    const rows = [...table.querySelectorAll("tbody tr:not(.scp-st-tier)")];
    assert.equal(rows.length, 11);
    assert.ok(rows.find((r) => text(r.querySelector("th")) === "EPA per play").classList.contains("is-key"));
    assert.ok(!rows.find((r) => text(r.querySelector("th")) === "Time to throw").classList.contains("is-key"));
    // Each season one cell, the value over its percentile (mak, 2026-10-03).
    const cellsOf = (r) => [...r.querySelectorAll("td")].map((td) => [text(td.querySelector(".scp-st-num")), text(td.querySelector(".scp-st-pb"))]);
    const epa = rows.find((r) => text(r.querySelector("th")) === "EPA per play");
    assert.deepEqual(cellsOf(epa), [["+0.10", "56th"], ["+0.01", "41st"]]);
    assert.ok(epa.querySelector("td.is-now .scp-st-bar"), "this season carries the bar");
    assert.equal(epa.querySelector("td.is-prev .scp-st-bar"), null, "last season is the ordinal alone");
    const ypa = rows.find((r) => text(r.querySelector("th")) === "Yards per attempt");
    assert.deepEqual(cellsOf(ypa), [["5.6", "8th"], ["-", "-"]]);
    assert.ok(ypa.querySelector(".scp-st-pb.is-bad"));
    assert.equal(ypa.querySelector(".scp-st-pb.is-bad").getAttribute("title"), "8th percentile");
    assert.equal(ypa.querySelector(".scp-st-pb.is-bad .scp-st-bar i").getAttribute("style"), "width:8%");
    // 0-24 red, 25-74 navy, 75+ green.
    assert.ok(epa.querySelector("td.is-now .scp-st-pb.is-mid"));
    // A style reading is gray, and the footnote says what gray means.
    const ttt = rows.find((r) => text(r.querySelector("th")) === "Time to throw");
    assert.equal(text(ttt.querySelector("td.is-now .scp-st-pb.is-muted")), "-");
    assert.equal(text(ttt.querySelector("td.is-prev .scp-st-pb.is-muted")), "76th");
    assert.equal(
      text(doc.querySelector(".scp-st-foot-note")),
      "Percentiles: 2026 through Week 3 among 36 qualified QBs · 2025 (13 games, weeks 1–17) among 41. Gray bars describe style, not quality.",
    );
    assert.equal(doc.querySelector(".scp-st-src"), null, "mak removed the sources line, 2026-09-30");
    // The SC Analysis module: the profile, then the fantasy impact.
    const read = doc.querySelector(".scp-st-read.scp-st-sca");
    assert.deepEqual([...read.querySelectorAll("h3")].map(text), ["Passing profile", "Fantasy impact"]);
    const paras = [...read.querySelectorAll("p")].map(text);
    assert.match(paras[0], /^Brissett .+\.$/);
    assert.match(paras[1], /^His floor is his volume: /);
    // The header (mak, 2026-10-05): the name H2, then a one-line read; no dek, no tags.
    assert.equal(doc.querySelector(".scp-st-dek"), null);
    assert.equal(doc.querySelector(".scp-st-tags"), null);
    assert.match(text(doc.querySelector("#scp-st-adv-h + .scp-st-sum")), /volume · \S+ efficiency$|efficiency$/);
  });

  test("below the qualifying line: no ranks, and the sub-line says why", () => {
    const unqualified = {
      ...CURRENT, qualified: false,
      metrics: CURRENT.metrics.map((m) => ({ ...m, read: "Not enough attempts to rank", standing: "muted", pct: null })),
    };
    const doc = render(state({ statsAdvanced: { current: unqualified, last: null } }));
    assert.match(text(doc.querySelector(".scp-st-foot-note")), /below the qualifying line/);
    assert.equal(doc.querySelectorAll(".scp-st-pb:not(.is-muted)").length, 0);
    assert.doesNotMatch(text(doc.querySelector("section .scp-ox-lede")), /percentile/);
  });

  test("the chart: scale, accent latest season, striped current season, average line, team strip", () => {
    const doc = render(state());
    const fig = doc.querySelector("figure.scp-st-arc");
    // Best PPG 16.5 rounds up to a scale of 18.
    const style = fig.getAttribute("style");
    assert.match(style, /--scp-n:3/);
    const cols = [...fig.querySelectorAll(".scp-st-col")];
    // Past seasons neutral, the latest finished one in the accent, the current
    // one hatched (mak, 2026-09-30); no career-best mark.
    assert.deepEqual(cols.map((c) => c.className), ["scp-st-col", "scp-st-col is-last", "scp-st-col is-now"]);
    assert.equal(cols[1].querySelector("i").getAttribute("style"), `height:${((16 / 18) * 100).toFixed(1)}%`);
    assert.ok(fig.querySelector(".scp-st-plot.has-avg"));
    const plot = fig.querySelector(".scp-st-plot");
    assert.equal(plot.getAttribute("role"), "img");
    assert.match(plot.getAttribute("aria-label"), /2024 6\.0, 2025 16\.0, 2026 16\.5 \(in progress\)\. Career average/);
    assert.equal(fig.querySelector(".scp-st-x").getAttribute("aria-hidden"), "true");
    const pills = [...fig.querySelectorAll(".scp-st-teams span")];
    // The club only where it changes.
    assert.deepEqual(pills.map((p) => [text(p), p.className]), [["NE", ""], ["ARI", "is-cur"], ["", "is-same"]]);
  });

  test("a traded season: the chart names both clubs", () => {
    const weeks = [qb(1, 10, 20, "NYJ"), qb(2, 10, 20, "NYJ"), qb(3, 10, 20, "ARI")];
    const doc = render(state({ logCareer: [{ season: 2026, weeks, finish: 20 }] }));
    assert.equal(text(doc.querySelector(".scp-st-teams span")), "NYJ/ARI");
  });

  test("one NFL season: a single bar, no average line, no weekly swing", () => {
    const doc = render(state({ logCareer: [state().logCareer[0]] }));
    assert.equal(doc.querySelectorAll(".scp-st-col").length, 1);
    assert.equal(doc.querySelector(".scp-st-plot.has-avg"), null);
    assert.equal(doc.querySelector(".scp-st-avg"), null);
    assert.doesNotMatch(text(doc.querySelector(".scp-st-rates")), /Weekly swing/);
    assert.doesNotMatch(text(doc.querySelector(".scp-ox-prose")), /without a top-12/);
  });

  test("preseason: last season's final line, no Card A, no striped bar", () => {
    const [, ...past] = state().logCareer;
    const doc = render(state({ season: 2025, logCareer: past, statsAdvanced: { current: null, last: LAST }, leagueWeek: 0 }));
    assert.equal(text(doc.querySelector("#scp-st-prod-h")), "Jacoby Brissett 2025 Stats");
    // No season-and-club kicker over the read (mak, 2026-10-05); past tense.
    assert.equal(doc.querySelector(".scp-st-kicker"), null);
    assert.match(text(doc.querySelector("#scp-st-prod-h").closest("section").querySelector(".scp-ox-lede")), /^(Touchdowns accounted|He didn't score)/);
    assert.ok(doc.querySelector("[data-scp-seg]"));
    assert.deepEqual([...doc.querySelectorAll(".scp-st-advt thead th")].map(text), ["Metric", "2025 13 games"]);
    assert.equal(doc.querySelector(".scp-st-col.is-now"), null);
    assert.equal(doc.querySelector(".scp-st-table tr.is-cur"), null);
  });

  test("no NFL games: no tab at all", () => {
    assert.equal(st.renderStatsTab(state({ logCareer: [] })), "");
  });

  test("the read names his targets from data, and the Redraft Command links carry the slug and CTA", () => {
    const doc = render(state());
    const prose = doc.querySelector(".scp-ox-prose");
    assert.match(text(prose), /Trey McBride/);
    const ctas = [...doc.querySelectorAll("[data-cta]")].map((el) => [el.dataset.cta, el.getAttribute("href")]);
    assert.deepEqual(ctas, [
      ["redraft-command-stats-prose", "https://statchasers.com/redraft-command/?player=jacoby-brissett"],
      ["redraft-command-stats-sidebar", "https://statchasers.com/redraft-command/?player=jacoby-brissett"],
    ]);
    // The rates open the section, ahead of the prose (mak, 2026-09-30).
    const rates = doc.querySelector(".scp-st-rates");
    assert.ok(rates.compareDocumentPosition(doc.querySelector(".scp-ox-prose")) & 4, "rates before the prose");
    const tiles = [...doc.querySelectorAll(".scp-st-rate h3")].map(text);
    assert.deepEqual(tiles, ["Career PPG", "Availability", "Top-12 weeks", "Weekly swing"]);
    assert.equal(doc.querySelectorAll(".scp-st-bests li").length, 4);
  });

  test("the FAQ is not this file's: the page's Stats FAQ asks it (faq-pools.ts)", () => {
    const sink = [];
    const doc = render(state(), { faqSink: sink });
    assert.equal(doc.querySelector(".scp-st-faq, .scp-tab-faq"), null);
    assert.equal(sink.length, 0);
    assert.equal(st.statsTabFaqs, undefined);
  });

  test("career highs, the byline and the scoring footer", () => {
    const doc = render(state({ statsUpdatedMs: Date.UTC(2026, 8, 29, 12) }));
    const highs = [...doc.querySelectorAll(".scp-st-bests li")].map((li) => [...li.children].map(text));
    // One strip: figure, short label, the season under it (mak, 2026-09-30).
    assert.deepEqual(highs, [
      ["2,800", "Pass yards", "2025"],
      ["14", "Pass TD", "2025"],
      ["224.0", "Fantasy pts", "2025 · QB16"],
      ["5,000", "Career pass yds", "2024–2026"],
    ]);
    const time = doc.querySelector(".scp-st-byline time");
    assert.equal(time.getAttribute("datetime"), "2026-09-29");
    assert.equal(text(time), "September 29, 2026");
    assert.match(text(doc.querySelector(".scp-st-foot")), /full PPR scoring: 1 point per reception/);
    assert.equal(render(state()).querySelector(".scp-st-byline"), null, "no date, no byline");
  });

  test("analyst copy replaces each template field it gives, and only those", () => {
    const statsCopy = {
      prod_lede: "Written lede with a [link](/nfl/players/trey-mcbride/) and <b>no HTML</b>.",
      adv_fantasy_note: "A volume passer.",
      career_paragraphs: ["First.", "  ", "Second."],
      updated_date: "2026-09-20",
      author: "Jane Analyst",
    };
    const doc = render(state({ statsCopy, statsUpdatedMs: Date.UTC(2026, 8, 29, 12) }));
    // The heading shares a row with the totals/per-game toggle (2026-09-30).
    const lede = doc.querySelector(".scp-st-headrow:has(> #scp-st-prod-h) + .scp-ox-lede");
    assert.equal(lede.querySelector("a").getAttribute("href"), "/nfl/players/trey-mcbride/");
    assert.equal(lede.querySelector("b"), null, "HTML prints as text");
    assert.match(text(lede), /<b>no HTML<\/b>/);
    // Not given: the generated summary line stays.
    assert.match(text(doc.querySelector(".scp-st-sum")), /efficiency$/);
    assert.equal(text(doc.querySelector(".scp-st-read")), "SC AnalysisFantasy impactA volume passer.");
    const paras = [...doc.querySelectorAll(".scp-ox-prose p")].map(text);
    assert.deepEqual(paras.slice(0, 2), ["First.", "Second."]);
    assert.equal(paras.length, 3, "blank paragraphs dropped, Redraft Command paragraph kept");
    assert.ok(doc.querySelector('.scp-ox-prose [data-cta="redraft-command-stats-prose"]'));
    assert.equal(text(doc.querySelector(".scp-st-byline")), "By Jane Analyst. Updated September 20, 2026.");
    // A link to anything but http(s) or a root path stays text.
    const bad = render(state({ statsCopy: { prod_lede: "[x](javascript:alert(1))" } }));
    assert.equal(bad.querySelector(".scp-st-headrow:has(> #scp-st-prod-h) + .scp-ox-lede a"), null);
    assert.ok(bad.querySelector(".scp-st-headrow:has(> #scp-st-prod-h) + .scp-ox-lede"), "the lede is still there");
  });

  const COLLEGE = {
    name: "Jacoby Brissett", school: "NC State", finalSeason: 2025, poolSize: 88,
    seasons: [
      { season: 2024, school: "Florida", pass: { cmp: 100, att: 160, yds: 1200, td: 8, int: 4 }, rush: { att: 30, yds: 90, td: 1, long: 20 }, rec: null },
      { season: 2025, school: "NC State", pass: { cmp: 270, att: 400, yds: 3400, td: 25, int: 6 }, rush: { att: 60, yds: 250, td: 4, long: 30 }, rec: null },
    ],
    final: {
      cmp: { value: 67.5, rank: 10, of: 88, pct: 89 },
      ypa: { value: 8.5, rank: 20, of: 88, pct: 77 },
      ptd: { value: 25, rank: 30, of: 88, pct: 66 },
      int: { value: 6, rank: 15, of: 88, pct: 83 },
      ryd: { value: 250, rank: 60, of: 88, pct: 32 },
      ppa: { value: 0.21, rank: 70, of: 88, pct: 20 },
    },
  };

  test("a rookie with NFL games: Card B is his final college season", () => {
    const [cur] = state().logCareer;
    const doc = render(state({ logCareer: [cur], statsAdvanced: { current: CURRENT, last: null }, college: COLLEGE }));
    const table = doc.querySelector("table.scp-st-advt");
    assert.deepEqual([...table.querySelectorAll("thead th")].map(text), ["Metric", "2026 Current · thru Wk 3", "College NC State 2025"]);
    assert.match(text(doc.querySelector(".scp-st-foot-note")), /College: ranked among 88 college passers with 150\+ attempts\./);
    const rows = [...table.querySelectorAll("tbody tr")].map((r) => text(r.querySelector("th")));
    for (const label of ["Completion %", "Passing TDs", "Interceptions", "Rushing yards", "EPA per play (PPA)"]) {
      assert.ok(rows.includes(label), label);
    }
    const cmp = [...table.querySelectorAll("tbody tr")].find((r) => text(r.querySelector("th")) === "Completion %");
    assert.match(cmp.querySelectorAll(".scp-st-pb")[1].className, /is-good/);
    // No college table once he has NFL games, and no NFL table here either:
    // the career table is the original content's.
    assert.equal(doc.querySelector(".scp-st-table"), null);
  });

  test("a veteran never gets the college card, even with college data on file", () => {
    const doc = render(state({ college: COLLEGE }));
    assert.equal([...doc.querySelectorAll(".scp-st-advt thead th")].map(text).some((t) => t.startsWith("College")), false);
  });

  test("a rookie before his first game: the college card and a college table, nothing else", () => {
    const doc = render(state({ logCareer: [], statsAdvanced: { current: null, last: null }, college: COLLEGE }));
    const heads = [...doc.querySelectorAll("section h2")].map(text);
    assert.deepEqual(heads, ["Jacoby Brissett Passing Stats", "Jacoby Brissett College Stats by Season"]);
    assert.match(text(doc.querySelector(".scp-st-sum")), /^Brissett arrives from NC State\./);
    const table = doc.querySelector(".scp-st-table");
    assert.equal(text(table.querySelector("caption")), "College stats, from CollegeFootballData.com.");
    const rows = [...table.querySelectorAll("tbody tr")].map((r) => [...r.children].slice(0, 3).map(text));
    assert.deepEqual(rows, [["2025", "NC State", "270"], ["2024", "Florida", "100"]]);
    assert.equal(table.querySelector("th.is-fan"), null, "no fantasy columns");
    assert.equal(doc.querySelector(".scp-st-arc"), null);
    assert.equal(doc.querySelector(".scp-st-faq"), null);
  });

  test("negative values use a true minus sign", () => {
    const weeks = [qb(1, -1.2, 60, "ARI", { rush_yd: -7 })];
    const doc = render(state({ logCareer: [{ season: 2026, weeks, finish: 60 }] }));
    assert.match(text(doc.querySelector(".scp-st-col b")), /^−1\.2$/);
  });
});
