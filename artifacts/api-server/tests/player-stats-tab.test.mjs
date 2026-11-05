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

// Every ranked metric carries a rank and the pool's size (2026-10-22): from
// the "16th of 36 QBs" read when it says so, else placed by its percentile.
const metric = (label, value, read, standing, pct, pctl = pct, of = 36) => {
  const m = /(\d+)(?:st|nd|rd|th) of (\d+)/.exec(read);
  const rank = m ? Number(m[1]) : pctl == null ? null : of - Math.round((pctl / 100) * (of - 1));
  return { label, value, read, standing, pct, pctl, rank, of: rank == null ? null : m ? Number(m[2]) : of };
};
const fill = (rank, of) => `width:${(((of - rank + 1) / of) * 100).toFixed(1)}%`;

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
    metric("Completion % over expected", "+0.9", "54th percentile", "mid", 54, 54, 41),
    metric("EPA per play", "+0.01", "24th of 41 QBs", "mid", 41),
    metric("Pressure rate", "26.1%", "37 sacks, 17th percentile", "bad", 17, 17, 41),
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

const prm = await importModule("lib/player/stats-premium");

/** The tab as the page composes it: the premium head (stats-premium.ts), then the parts. */
function render(data, options = {}, inserts = {}) {
  const html = prm.renderPremiumStats(data, inserts) + st.renderStatsTab(data, options);
  return new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`).window.document;
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** A card's figures as "label: value" pairs. */
const pairs = (card) =>
  [...card.querySelectorAll("dl > div")].map((d) => `${text(d.querySelector("dt"))}: ${text(d.querySelector("dd"))}`);

describe("stats tab", () => {
  test("the sections in the spec's order, each with an H2 and aria-labelledby", () => {
    const doc = render(state());
    // The career-rate tiles' section has no heading (mak, 2026-10-22): it is
    // the strip under the chart, named for assistive tech only.
    assert.equal(doc.querySelector("section.scp-st-sec-rates").getAttribute("aria-label"), "Career rates");
    // The old production rail, ladders, career-table section and analysis
    // module are gone (mak, 2026-11-05); the premium head carries them.
    assert.equal(doc.querySelector(".scp-st-rail"), null);
    assert.equal(doc.querySelector(".scp-st-advsec"), null);
    assert.equal(doc.querySelector(".scp-st-scasec"), null);
    const heads = [...doc.querySelectorAll("section:not(.scp-st-sec-rates)")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      return text(h2);
    });
    // The SEO ladder's H2s, in order, the same ids as before (the lead one is
    // promoted to the H1 on a section page).
    assert.deepEqual(heads, [
      "Jacoby Brissett 2026 Stats",
      "Jacoby Brissett Passing Stats",
      "Jacoby Brissett Fantasy Football Stats",
      "What His Career Numbers Say",
    ]);
    assert.equal(doc.querySelector("h2#scp-st-prod-h").className.includes("is-lead"), true);
    assert.ok(doc.querySelector("h2#scp-st-adv-h"));
    // The SEO ladder (mak, 2026-11-04): the chart's old title is its caption.
    assert.equal(text(doc.querySelector("#scp-st-arc-h + figure > figcaption.scp-st-arc-cap")), "Fantasy points per game, every season");
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

    // Five KPI cards per position (the brief's list for a QB): label, the
    // figure, the support beside it. Games has no per-game figure.
    const cards = [...doc.querySelectorAll(".scp-stp-kpi")];
    assert.deepEqual(cards.map((c) => text(c.querySelector(".scp-stp-kpi-label"))), ["Games", "Pass yards", "Pass TD", "INT", "Comp %"]);
    assert.equal(text(cards[0].querySelector(".scp-stp-kpi-value")), "3");
    assert.equal(cards[0].querySelector("[data-total]"), null, "games played has no per-game figure");
    const yards = cards[1].querySelector(".scp-stp-kpi-value [data-total]");
    assert.equal(yards.textContent, "600");
    assert.equal(yards.dataset.pg, "200.0");
    assert.equal(text(cards[1].querySelector(".scp-stp-kpi-sub")), "6.7 Y/A");
    const cmpAtt = cards[4].querySelector(".scp-stp-kpi-sub [data-total]");
    assert.equal(cmpAtt.dataset.pg, "20.0/30.0");
    assert.equal(cards[4].querySelector(".scp-stp-kpi-value [data-total]"), null, "completion % is a rate");
    assert.equal(doc.querySelector(".scp-st-fan"), null, "the Fantasy (PPR) block is gone");
    assert.equal(doc.querySelectorAll(".scp-stp-kpis").length, 1);
  });

  test("the toggle, clicked, through the real client bundle", async () => {
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    assert.ok(fs.existsSync(bundle), "pnpm test builds the bundle first");
    const html = prm.renderPremiumStats(state()) + st.renderStatsTab(state());
    const dom = new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    // The bundle boots on DOMContentLoaded, which jsdom fires on a later tick.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const [totals, pg] = doc.querySelectorAll("[data-scp-seg] button");
    const yards = doc.querySelector(".scp-stp-kpi:nth-child(2) .scp-stp-kpi-value [data-total]");
    pg.click();
    assert.equal(yards.textContent, "200.0");
    assert.equal(pg.getAttribute("aria-pressed"), "true");
    assert.equal(totals.getAttribute("aria-pressed"), "false");
    assert.equal(text(doc.querySelector(".scp-stp-kpi:nth-child(5) .scp-stp-kpi-value")), "66.7%", "rates never change");
    assert.equal(text(doc.querySelector(".scp-stp-kpi:nth-child(1) .scp-stp-kpi-value")), "3", "games played never changes");
    totals.click();
    assert.equal(yards.textContent, "600");
    dom.window.close();
  });

  test("advanced: the metric panels, this season only, one footnote, the analysis under the table", () => {
    const doc = render(state());
    assert.equal(doc.querySelector(".scp-st-ladder"), null, "the old ladders are gone (mak, 2026-11-05)");
    // Two panels: Efficiency, then the other tiers; the fixture has only Usage
    // rows there this season.
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-card-title")].map(text), ["Efficiency", "Usage"]);
    const rows = [...doc.querySelectorAll(".scp-stp-row")];
    assert.equal(rows.length, 6);
    const rowOf = (label) => rows.find((r) => text(r.querySelector(".scp-stp-row-label")) === label);
    assert.equal(rowOf("Time to throw"), undefined, "last season's style rows no longer appear");
    // label | bar | value | rank pill: the rank, not the percentile (mak,
    // 2026-10-22), tinted by the percentile, the full sentence as its title.
    const epa = rowOf("EPA per play");
    assert.equal(text(epa.querySelector(".scp-stp-row-value")), "+0.10");
    assert.equal(text(epa.querySelector(".scp-stp-rank")), "16th of 36");
    assert.equal(epa.querySelector(".scp-stp-rank").dataset.tier, "mid");
    assert.equal(epa.querySelector(".scp-stp-rank").getAttribute("title"), "16th of 36 QBs");
    // Better rank, longer bar.
    assert.equal(epa.querySelector(".scp-stp-bar-fill").getAttribute("style"), fill(16, 36));
    for (const r of doc.querySelectorAll(".scp-stp-rank")) assert.doesNotMatch(text(r), /percentile/);
    // 0-24 poor, 25-74 mid, 75+ good: the percentile tints the bar and the pill.
    const ypa = rowOf("Yards per attempt");
    assert.equal(ypa.querySelector(".scp-stp-bar-track").dataset.tier, "poor");
    assert.equal(ypa.querySelector(".scp-stp-rank").dataset.tier, "poor");
    const ypaM = CURRENT.metrics.find((m) => m.label === "Yards per attempt");
    const ord = (n) => `${n}${n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
    assert.equal(text(ypa.querySelector(".scp-stp-rank")), `${ord(ypaM.rank)} of 36`);
    assert.equal(ypa.querySelector(".scp-stp-bar-fill").getAttribute("style"), fill(ypaM.rank, 36));
    assert.equal(rowOf("Completion rate").querySelector(".scp-stp-rank").dataset.tier, "good");
    assert.deepEqual(rows.map((r) => r.dataset.family), ["eff", "eff", "eff", "eff", "eff", "use"]);
    // The footnote names this season's pool only.
    assert.equal(text(doc.querySelector(".scp-stp-note")), "Ranks: 2026 through Week 3 among 36 qualified QBs.");
    // Every metric's definition is its label's tooltip (2026-11-04).
    assert.match(epa.querySelector(".scp-stp-row-label").getAttribute("title"), /^Expected points added per play/);
    assert.match(rowOf("Completion rate").querySelector(".scp-stp-row-label").getAttribute("title"), /completions divided by pass attempts/);
    // The StatChasers Analysis panel: the profile, then the fantasy impact.
    const parts = [...doc.querySelectorAll(".scp-stp-analysis-part")];
    assert.deepEqual(parts.map((p) => text(p.querySelector("h4"))), ["Passing profile", "Fantasy impact"]);
    const paras = parts.map((p) => text(p.querySelector("p")));
    assert.match(paras[0], /^Brissett .+\.$/);
    // Three games is a small sample (2026-11-04): what he did, the TD share,
    // and that the trends are not established - never a "floor" off three games.
    assert.equal(
      paras[1],
      "Brissett threw for 600 yards and three touchdowns on 90 attempts across his first three appearances of 2026. " +
        "Touchdown passes generated 24% of his fantasy points. With only 3 games played, his season-long efficiency and workload trends are not yet established.",
    );
    assert.equal(text(doc.querySelector(".scp-stp-analysis-note")), "Small sample · 3 games · 90 attempts");
    assert.equal(text(doc.querySelector(".scp-stp-brand-text")), "StatChasers Analysis");
    // The section bar: the name H2, then the one-line read.
    assert.match(text(doc.querySelector("#scp-st-adv-h + .scp-stp-bar-sub")), /volume · \S+ efficiency$|efficiency$/);
  });

  test("below the qualifying line: no ranks, one footnote says why, no row repeats it", () => {
    const unqualified = {
      ...CURRENT, qualified: false, qualifyNote: "50+ pass attempts, 6+ games and a 25%+ snap share",
      metrics: CURRENT.metrics.map((m) => ({ ...m, read: "Not enough attempts to rank", standing: "muted", pct: null, pctl: null, rank: null, of: null })),
    };
    const doc = render(state({ statsAdvanced: { current: unqualified, last: null } }));
    // One qualification note, with the line itself (2026-11-04), and not
    // "Not enough attempts to rank" on every row.
    assert.equal(text(doc.querySelector(".scp-stp-note")), "Ranks: 2026: below the qualifying line so far (50+ pass attempts, 6+ games and a 25%+ snap share), so no ranks.");
    const sec = doc.querySelector("#scp-st-adv-h").closest("section");
    assert.doesNotMatch(text(sec).replace(text(doc.querySelector(".scp-stp-note")), ""), /Not enough attempts/);
    for (const pill of sec.querySelectorAll(".scp-stp-rank")) {
      assert.equal(text(pill), "Unranked");
      assert.equal(pill.dataset.tier, "none");
    }
    assert.equal(sec.querySelectorAll(".scp-stp-bar-track.is-empty").length, sec.querySelectorAll(".scp-stp-row").length, "no bar on an unranked row");
  });

  test("the fantasy impact reads by sample: a starter's floor, a reserve's playing time, a stale season says so", () => {
    // A starter's season: 14 games at 30 attempts.
    const starter = render(state({ leagueWeek: 15, logCareer: [{ season: 2026, weeks: Array.from({ length: 14 }, (_, i) => qb(i + 1, 16, 12, "ARI", { gs: 1 })), finish: 16 }] }));
    const impact = (doc) => text([...doc.querySelectorAll(".scp-stp-analysis-part")].find((p) => text(p.querySelector("h4")) === "Fantasy impact").querySelector("p"));
    assert.equal(impact(starter), "His floor is his volume: 30.0 pass attempts and 3.0 carries a game across 14 games this season. Efficiency decides how much of it becomes points.");
    assert.equal(starter.querySelector(".scp-stp-analysis-note"), null);
    // A reserve: 8 games at 10 attempts, 1 start.
    const reserve = render(state({ leagueWeek: 9, logCareer: [{ season: 2026, weeks: Array.from({ length: 8 }, (_, i) => qb(i + 1, 4, 40, "ARI", { pass_att: 10, gs: i === 0 ? 1 : 0 })), finish: 50 }] }));
    assert.equal(impact(reserve), "Brissett has made 8 appearances (1 start) this season at 10.0 pass attempts and 3.0 carries a game: a reserve's workload, so his fantasy value turns on playing time before efficiency.");
    assert.equal(text(reserve.querySelector(".scp-stp-analysis-note")), "Reserve role · 8 games · 1 start");
    // Not played this season: the latest season, named as such.
    const stale = render(state({ season: 2025, leagueWeek: 9, logCareer: state().logCareer.slice(1) }));
    assert.match(impact(stale), /^Brissett has not played in 2026; these are his 2025 numbers\. His floor is his volume: .* in 2025\./);
  });

  test("games played: a week he was active for counts, snap or no snap (Sleeper's gp), as the table counts it", () => {
    // Week 2: active (gp 1), no snap, no attempt - the game the chart used to
    // drop while the career table kept it (Minshew, 2023).
    const idle = { week: 2, opp: "SEA", team: "ARI", game_status: "active", pos_rank: null, stats: { pts_ppr: 0, gp: 1, gs: 0, off_snp: 0, pass_att: 0 } };
    const weeks = [qb(1, 16, 12, "ARI", { gp: 1, gs: 1 }), idle, qb(3, 16, 12, "ARI", { gp: 1, gs: 1 })];
    const doc = render(state({ logCareer: [{ season: 2026, weeks, finish: 20 }] }));
    assert.equal(text(doc.querySelector(".scp-stp-kpi:first-child .scp-stp-kpi-value")), "3");
    assert.match(text(doc.querySelector(".scp-st-x")), /3 GP/);
    assert.match(text(doc.querySelector(".scp-st-rates")), /10\.7Career PPG3 games, 1 season · PPR/);
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
    // The club under every bar (mak, 2026-10-22), the current club marked;
    // no separate team row.
    assert.equal(fig.querySelector(".scp-st-teams"), null);
    const clubs = [...fig.querySelectorAll(".scp-st-x > div > em")];
    assert.deepEqual(clubs.map((p) => [text(p), p.className]), [["NE", ""], ["ARI", "is-cur"], ["ARI", "is-cur"]]);
    assert.deepEqual([...fig.querySelectorAll(".scp-st-x > div")].map((d) => [...d.children].map((e) => e.tagName)), Array(3).fill(["STRONG", "SMALL", "EM"]));
  });

  test("a traded season: the chart names both clubs", () => {
    const weeks = [qb(1, 10, 20, "NYJ"), qb(2, 10, 20, "NYJ"), qb(3, 10, 20, "ARI")];
    const doc = render(state({ logCareer: [{ season: 2026, weeks, finish: 20 }] }));
    assert.equal(text(doc.querySelector(".scp-st-x em")), "NYJ/ARI");
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
    assert.match(text(doc.querySelector("#scp-st-prod-h + .scp-stp-bar-sub")), /^(Touchdowns accounted|He didn't score)/);
    assert.ok(doc.querySelector("[data-scp-seg]"));
    // Last season stands in alone until this season has a line; no column heading for one season.
    assert.equal(doc.querySelector(".scp-stp-colhead"), null);
    assert.ok([...doc.querySelectorAll(".scp-stp-row-label")].some((l) => text(l) === "Time to throw"));
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
    // The rates sit in their own section under the career chart, where the
    // season snapshot strip was (mak, 2026-10-22), ahead of the read.
    const rates = doc.querySelector(".scp-st-sec-rates > .scp-st-rates");
    assert.ok(rates, "the rates have their own section");
    assert.ok(doc.querySelector("#scp-st-chart-h, .scp-st-plot")?.compareDocumentPosition(rates) & 4, "rates after the chart");
    assert.ok(rates.compareDocumentPosition(doc.querySelector("#scp-st-read-h")) & 4, "rates before the read's heading");
    assert.equal(doc.querySelector("#scp-st-read-h").closest("section").querySelector(".scp-st-rates"), null, "and not inside the read");
    const tiles = [...doc.querySelectorAll(".scp-st-rate h3")].map(text);
    // "Appearance rate", not availability, and the top-12 WEEKS counted out
    // beside their share (2026-11-04).
    assert.deepEqual(tiles, ["Career PPG", "Appearance rate", "Top-12 weeks", "Weekly swing"]);
    const captions = [...doc.querySelectorAll(".scp-st-rate p:last-child")].map(text);
    assert.equal(captions[0], "25 games, 3 seasons · PPR");
    assert.equal(captions[1], "Share of team games appeared in");
    assert.equal(captions[2], "15 of 25 weeks inside the weekly top 12");
    // The read says "season finish" so the two cannot be read against each other,
    // and a thin season is not a trend.
    const read = text(doc.querySelector(".scp-ox-prose"));
    assert.match(read, /without a top-12 season finish\./);
    assert.match(read, /So far in 2026 he has 3 games \(16\.5 a game\) against 14 appearances in 2025: too little on one side to call a trend\./);
    assert.doesNotMatch(read, /up \d/);
    assert.equal(doc.querySelectorAll(".scp-st-bests li").length, 4);
  });

  test("the career table's column switch: NFL stats or fantasy, through the real client bundle", async () => {
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    // player-render's table, stood in for by its shape: the view attribute and the two column sets.
    const table =
      `<div class="scp-scroll"><table class="scp-table scp-table--career" data-scp-sortable data-scp-view="nfl">` +
      `<thead><tr><th>Season</th><th class="is-nfl">Cmp</th><th class="is-fan">FPTS</th></tr></thead>` +
      `<tbody><tr class="scp-row"><th scope="row">2026</th><td class="is-nfl">17</td><td class="is-fan">19.5</td></tr></tbody></table></div>`;
    const html = prm.renderPremiumStats(state(), { careerTable: table }) + st.renderStatsTab(state());
    const dom = new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const sec = doc.querySelector("#scp-st-career-h").closest("section");
    const seg = sec.querySelector("[data-scp-view-seg]");
    assert.ok(sec.querySelector(".scp-stp-bar [data-scp-view-seg]"), "the switch rides the title bar");
    const [nfl, fan] = seg.querySelectorAll("button");
    assert.deepEqual([text(nfl), text(fan)], ["NFL stats", "Fantasy"]);
    const tbl = sec.querySelector("table[data-scp-view]");
    assert.equal(tbl.dataset.scpView, "nfl");
    fan.click();
    assert.equal(tbl.dataset.scpView, "fantasy");
    assert.equal(fan.getAttribute("aria-pressed"), "true");
    assert.equal(nfl.getAttribute("aria-pressed"), "false");
    nfl.click();
    assert.equal(tbl.dataset.scpView, "nfl");
    dom.window.close();
  });

  test("the FAQ is not this file's: the page's Stats FAQ asks it (faq-pools.ts)", () => {
    const sink = [];
    const doc = render(state(), { faqSink: sink });
    assert.equal(doc.querySelector(".scp-st-faq, .scp-tab-faq"), null);
    assert.equal(sink.length, 0);
    assert.equal(st.statsTabFaqs, undefined);
  });

  test("career highs, no byline, and the scoring footer", () => {
    const doc = render(state({ statsUpdatedMs: Date.UTC(2026, 8, 29, 12) }));
    const highs = [...doc.querySelectorAll(".scp-st-bests li")].map((li) => [...li.children].map(text));
    // One strip: figure, short label, the season under it (mak, 2026-09-30).
    assert.deepEqual(highs, [
      ["2,800", "Pass yards", "2025"],
      ["14", "Pass TD", "2025"],
      ["224.0", "Fantasy pts", "2025 · QB16"],
      ["5,000", "Career pass yds", "2024–2026"],
    ]);
    // "By the StatChasers staff. Updated <date>." is gone (mak, 2026-10-22).
    assert.equal(doc.querySelector(".scp-st-byline"), null, "no byline, even with a date");
    assert.match(text(doc.querySelector(".scp-st-foot")), /full PPR scoring: 1 point per reception/);
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
    // The lede sits under the hero title, in the title bar.
    const lede = doc.querySelector("#scp-st-prod-h + .scp-stp-bar-sub");
    assert.equal(lede.querySelector("a").getAttribute("href"), "/nfl/players/trey-mcbride/");
    assert.equal(lede.querySelector("b"), null, "HTML prints as text");
    assert.match(text(lede), /<b>no HTML<\/b>/);
    // Not given: the generated summary line stays.
    assert.match(text(doc.querySelector("#scp-st-adv-h + .scp-stp-bar-sub")), /efficiency$/);
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-analysis-part")].map((p) => `${text(p.querySelector("h4"))}: ${text(p.querySelector("p"))}`), ["Fantasy impact: A volume passer."]);
    const paras = [...doc.querySelectorAll(".scp-ox-prose p")].map(text);
    assert.deepEqual(paras.slice(0, 2), ["First.", "Second."]);
    assert.equal(paras.length, 3, "blank paragraphs dropped, Redraft Command paragraph kept");
    assert.ok(doc.querySelector('.scp-ox-prose [data-cta="redraft-command-stats-prose"]'));
    assert.equal(doc.querySelector(".scp-st-byline"), null, "an analyst's date prints no byline either");
    // A link to anything but http(s) or a root path stays text.
    const bad = render(state({ statsCopy: { prod_lede: "[x](javascript:alert(1))" } }));
    assert.equal(bad.querySelector("#scp-st-prod-h + .scp-stp-bar-sub a"), null);
    assert.ok(bad.querySelector("#scp-st-prod-h + .scp-stp-bar-sub"), "the lede is still there");
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
    // Two sets of panels, each headed: this season, then college (2026-10-22 layout).
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-colhead")].map(text), ["2026 Current · thru Wk 3", "College NC State 2025"]);
    assert.match(text(doc.querySelector(".scp-stp-note")), /College: ranked among 88 college passers with 150\+ attempts\./);
    const college = doc.querySelectorAll(".scp-stp-cards")[1];
    const rows = [...college.querySelectorAll(".scp-stp-row")];
    const labels = rows.map((r) => text(r.querySelector(".scp-stp-row-label")));
    for (const label of ["Completion %", "Passing TDs", "Interceptions", "Rushing yards", "EPA per play (PPA)"]) {
      assert.ok(labels.includes(label), label);
    }
    const cmp = rows[labels.indexOf("Completion %")];
    assert.equal(cmp.querySelector(".scp-stp-rank").dataset.tier, "good");
    // No college table once he has NFL games, and no NFL table here either:
    // the career table is the original content's.
    assert.equal(doc.querySelector(".scp-st-table"), null);
  });

  test("a veteran never gets the college card, even with college data on file", () => {
    const doc = render(state({ college: COLLEGE }));
    assert.equal(doc.querySelector(".scp-st-ladgroup"), null, "one season, no College set");
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

describe("the premium head (mak's brief, 2026-11-05; the old sections removed the same day)", () => {
  const table =
    `<div class="scp-scroll"><table class="scp-table scp-table--filled scp-table--career" data-scp-sortable data-scp-view="nfl">` +
    `<thead><tr><th>Season</th><th class="is-nfl">Cmp</th><th class="is-fan">FPTS</th></tr></thead>` +
    `<tbody><tr class="scp-row is-current"><th scope="row">2026</th><td class="is-nfl">17</td><td class="is-fan">19.5</td></tr></tbody></table></div>`;
  const both = (s = state()) => render(s, {}, { careerTable: table });

  test("one block heads the tab, with no comparison label, and the parts carry nothing premium", () => {
    const s = state();
    const parts = st.renderStatsTabParts(s, {}, { careerTable: table });
    const doc = both(s);
    assert.equal(doc.querySelector(".scp-stp-label"), null, "the comparison label is gone with the old version");
    assert.equal(doc.querySelectorAll('[data-scp-premium="stats"]').length, 1);
    assert.ok(!parts.top.includes("scp-stp") && !parts.rest.includes("scp-stp"), "nothing premium inside the parts");
    assert.ok(!parts.top.includes("scp-st-rail") && !parts.top.includes("scp-st-advsec"), "the old sections are gone from the parts");
  });

  test("the block's toggles work: per game swaps its KPI figures, Fantasy swaps its table view", async () => {
    const s = state();
    const html = prm.renderPremiumStats(s, { careerTable: table }) + st.renderStatsTab(s);
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    const dom = new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const block = doc.querySelector('[data-scp-premium="stats"]');
    const yards = block.querySelector(".scp-stp-kpi:nth-child(2) [data-total]");
    assert.equal(yards.textContent, "600");
    block.querySelector('[data-scp-seg] button[data-mode="pg"]').click();
    assert.equal(yards.textContent, "200.0", "the KPI follows the switch");
    const tbl = block.querySelector("table[data-scp-view]");
    assert.equal(doc.querySelectorAll("table.scp-table--career").length, 1, "one career table on the tab");
    assert.equal(tbl.dataset.scpView, "nfl");
    block.querySelector('[data-scp-view-seg] button[data-view="fantasy"]').click();
    assert.equal(tbl.dataset.scpView, "fantasy");
  });

  test("no season on the page: nothing premium renders", () => {
    assert.equal(prm.renderPremiumStats(state({ logCareer: [], player: { ...state().player, position: "K" } })), "");
  });
});

const cp = await importModule("lib/player/career-premium");

describe("the premium career comparison block (mak's brief, 2026-11-05)", () => {
  const doc = (s = state()) => new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${st.renderStatsTab(s)}${cp.renderPremiumCareer(s)}</div></div></body>`).window.document;

  test("it follows the whole existing section under a comparison label, and that section is untouched", () => {
    const s = state();
    const before = st.renderStatsTab(s);
    const html = cp.renderPremiumCareer(s);
    assert.ok(html.startsWith('<p class="scp-cp-label"'));
    assert.ok(!before.includes("scp-cp"), "nothing premium inside the existing section");
    const d = doc(s);
    assert.equal(d.querySelector(".scp-cp-label").textContent, "New design - comparison");
    assert.equal(d.querySelector(".scp-cp-label").nextElementSibling, d.querySelector('[data-scp-premium="career"]'));
    assert.ok(d.querySelector("#scp-st-read-h"), "the existing read is still there, before it");
  });

  test("the chart: one bar per season with the same PPG, the same career average, the finish under each, hatch on the season in progress only", () => {
    const d = doc();
    const oldVals = [...d.querySelectorAll(".scp-st-col b")].map(text);
    const newVals = [...d.querySelectorAll(".scp-cp-val")].map(text);
    assert.deepEqual(newVals, oldVals);
    assert.equal(text(d.querySelector(".scp-cp-avg b")), text(d.querySelector(".scp-st-avg b")));
    // Career points over career games (the existing definition), never a mean of season means.
    const s = state();
    const games = s.logCareer.reduce((n, l) => n + l.weeks.length, 0);
    const pts = s.logCareer.reduce((n, l) => n + l.weeks.reduce((m, w) => m + w.stats.pts_ppr, 0), 0);
    assert.equal(text(d.querySelector(".scp-cp-avg b")), (pts / games).toFixed(1));
    assert.deepEqual([...d.querySelectorAll(".scp-cp-fin")].map(text), ["QB46", "QB16", "QB17"], "the table's season finishes, oldest first");
    const cols = [...d.querySelectorAll(".scp-cp-col")];
    assert.deepEqual(cols.map((c) => c.classList.contains("is-now")), [false, false, true]);
    assert.deepEqual(cols.map((c) => c.classList.contains("is-last")), [false, true, false]);
    assert.match(cols[2].getAttribute("title"), /^2026 \(in progress\) · ARI · 3 GP · 16\.5 PPR PPG · 49\.6 points · QB17 so far$/);
    for (const c of cols) assert.equal(c.getAttribute("tabindex"), "0", "keyboard-focusable");
    // A truthful scale from zero: the top tick is a whole number above the tallest bar.
    const ticks = [...d.querySelectorAll(".scp-cp-y span")].map(text);
    assert.equal(ticks[ticks.length - 1], "0");
    assert.ok(Number(ticks[0]) >= Math.max(...newVals.map(Number)));
    assert.match(text(d.querySelector(".scp-cp-legend")), /Current season, in progress/);
    assert.equal(d.querySelector(".scp-cp-chart").style.getPropertyValue("--scp-cp-n"), "3");
  });

  test("the KPI cards, the read, the Redraft Command card and the highs are the existing ones", () => {
    const d = doc();
    const oldRates = [...d.querySelectorAll(".scp-st-rate")].map((r) => `${text(r.querySelector(".scp-st-v"))}|${text(r.querySelector("h3"))}|${text(r.querySelectorAll("p")[1])}`);
    const newRates = [...d.querySelectorAll(".scp-cp-kpi")].map((r) => `${text(r.querySelector(".scp-cp-kpi-value"))}|${text(r.querySelector(".scp-cp-kpi-label"))}|${text(r.querySelector(".scp-cp-kpi-sub"))}`);
    assert.deepEqual(newRates, oldRates);
    assert.equal(newRates.length, 4);
    assert.match(d.querySelector(".scp-cp-kpi:last-child").getAttribute("title"), /standard deviation/);
    const oldP = [...d.querySelectorAll("#scp-st-read-h ~ .scp-ox-read .scp-ox-prose p")].map((p) => p.innerHTML);
    const newP = [...d.querySelectorAll(".scp-cp-prose p")].map((p) => p.innerHTML);
    assert.deepEqual(newP, oldP, "the same paragraphs, links included");
    assert.equal(d.querySelector("a.scp-cp-rc-btn").getAttribute("href"), d.querySelector(".scp-ox-aside a.scp-ox-btn").getAttribute("href"));
    assert.equal(text(d.querySelector(".scp-cp-rc-h")), "Redraft Command");
    assert.equal(text(d.querySelector(".scp-cp-rc p")), text(d.querySelector(".scp-ox-aside .is-rc p")));
    const oldHighs = [...d.querySelectorAll(".scp-st-bests li")].map((li) => [...li.children].map(text).join(" "));
    const newHighs = [...d.querySelectorAll(".scp-cp-high")].map((h) => [".scp-cp-high-v", ".scp-cp-high-l", ".scp-cp-high-s"].map((c) => text(h.querySelector(c))).join(" "));
    assert.deepEqual(newHighs, oldHighs);
  });

  test("no NFL season: nothing renders", () => {
    assert.equal(cp.renderPremiumCareer(state({ logCareer: [] })), "");
  });
});
