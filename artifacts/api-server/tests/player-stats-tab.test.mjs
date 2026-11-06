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
const cp = await importModule("lib/player/career-premium");

/** The tab as the page composes it: the premium head (stats-premium.ts), the career section (career-premium.ts), then the parts. */
function render(data, options = {}, inserts = {}) {
  const html = prm.renderPremiumStats(data, inserts) + cp.renderPremiumCareer(data, options) + st.renderStatsTab(data, options);
  return new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`).window.document;
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** A card's figures as "label: value" pairs. */
const pairs = (card) =>
  [...card.querySelectorAll("dl > div")].map((d) => `${text(d.querySelector("dt"))}: ${text(d.querySelector("dd"))}`);

describe("stats tab", () => {
  test("the sections in the spec's order, each with an H2 and aria-labelledby", () => {
    const doc = render(state());
    // The old production rail, ladders, career-table section and analysis
    // module are gone (mak, 2026-11-05); the premium head carries them. So
    // are the old chart, the career-rate tiles, the read and the highs
    // strip (mak, later the same day); the career block carries them.
    for (const gone of [".scp-st-rail", ".scp-st-advsec", ".scp-st-scasec", ".scp-st-arc", ".scp-st-sec-rates", ".scp-st-rates", ".scp-st-bests", ".scp-cp-label"]) {
      assert.equal(doc.querySelector(gone), null, `${gone} is gone`);
    }
    const heads = [...doc.querySelectorAll("section")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      return text(h2);
    });
    // The SEO ladder's H2s, in order, the same ids as before (the lead one is
    // promoted to the H1 on a section page); the read's H2 is inside the
    // career section now, not a section of its own.
    assert.deepEqual(heads, [
      "Jacoby Brissett 2026 Stats",
      "Jacoby Brissett Passing Stats",
      "Jacoby Brissett Fantasy Football Stats",
    ]);
    assert.deepEqual([...doc.querySelectorAll("h2")].map((h) => h.id), ["scp-st-prod-h", "scp-st-adv-h", "scp-st-arc-h", "scp-st-read-h"]);
    assert.equal(doc.querySelector("h2#scp-st-prod-h").className.includes("is-lead"), true);
    assert.ok(doc.querySelector("h2#scp-st-adv-h"));
    assert.ok(doc.querySelector(".scp-cp h2#scp-st-arc-h.scp-cp-bar-title"), "the career block's bar is the section's H2");
    assert.ok(doc.querySelector(".scp-cp h2#scp-st-read-h.scp-cp-h"), "the read's H2 is in the career block");
    assert.equal(text(doc.querySelector("#scp-st-arc-h + .scp-cp-bar-sub")), "Fantasy points per game, every season.");
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
    const html = prm.renderPremiumStats(state()) + cp.renderPremiumCareer(state()) + st.renderStatsTab(state());
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
    // Three games is a small sample: no trends to read, so no StatChasers
    // Analysis panel at all (mak, 2026-11-05) - not even the profile.
    assert.equal(doc.querySelector(".scp-stp-analysis"), null);
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
    const impact = (doc) => text([...doc.querySelectorAll(".scp-stp-analysis-part")].find((p) => text(p.querySelector("h4")) === "Fantasy impact").querySelector("p:not(.scp-stp-analysis-lede)"));
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
    assert.match(text(doc.querySelector(".scp-cp-x")), /3 GP/);
    assert.match(text(doc.querySelector(".scp-cp-kpi")), /10\.7Career PPG3 games, 1 season · PPR/);
  });

  test("the chart: a zero-based scale, the latest full season green, the current one hatched, the average line, the club under each bar", () => {
    const doc = render(state());
    const fig = doc.querySelector("figure.scp-cp-chart");
    assert.match(fig.getAttribute("style"), /--scp-cp-n:3/);
    const cols = [...fig.querySelectorAll(".scp-cp-col")];
    assert.deepEqual(cols.map((c) => c.className), ["scp-cp-col", "scp-cp-col is-last", "scp-cp-col is-now"]);
    assert.deepEqual([...fig.querySelectorAll(".scp-cp-val")].map(text), ["6.0", "16.0", "16.5"]);
    // Best PPG 16.5 and a whole-number top tick: 20, so the 16.0 bar is 80%.
    assert.equal(cols[1].querySelector("i").getAttribute("style"), "height:80.0%");
    assert.deepEqual([...fig.querySelectorAll(".scp-cp-y span")].map(text), ["20", "15", "10", "5", "0"]);
    assert.ok(fig.classList.contains("has-avg"));
    const plot = fig.querySelector(".scp-cp-plot");
    assert.equal(plot.getAttribute("role"), "img");
    assert.match(plot.getAttribute("aria-label"), /2024 6\.0 \(QB46\), 2025 16\.0 \(QB16\), 2026 16\.5 \(QB20\), in progress\. Career average/);
    assert.equal(fig.querySelector(".scp-cp-xs").getAttribute("aria-hidden"), "true");
    // The year, the finish and "GP · club" under every bar, the current club marked.
    assert.deepEqual([...fig.querySelectorAll(".scp-cp-x")].map((d) => [...d.children].map((e) => e.tagName)), Array(3).fill(["STRONG", "SPAN", "SMALL"]));
    assert.deepEqual([...fig.querySelectorAll(".scp-cp-x small")].map(text), ["8 GP · NE", "14 GP · ARI", "3 GP · ARI"]);
    assert.deepEqual([...fig.querySelectorAll(".scp-cp-x")].map((d) => d.classList.contains("is-cur")), [false, true, true]);
    assert.match(text(fig.querySelector(".scp-cp-legend")), /Current season, in progress.*Latest full season.*Earlier seasons.*Career avg/);
  });

  test("a traded season: the chart names both clubs", () => {
    const weeks = [qb(1, 10, 20, "NYJ"), qb(2, 10, 20, "NYJ"), qb(3, 10, 20, "ARI")];
    const doc = render(state({ logCareer: [{ season: 2026, weeks, finish: 20 }] }));
    assert.match(text(doc.querySelector(".scp-cp-x small")), /NYJ\/ARI/);
  });

  test("one NFL season: a single bar, no average line, no weekly swing", () => {
    const doc = render(state({ logCareer: [state().logCareer[0]] }));
    assert.equal(doc.querySelectorAll(".scp-cp-col").length, 1);
    assert.equal(doc.querySelector(".scp-cp-chart.has-avg"), null);
    assert.equal(doc.querySelector(".scp-cp-avg"), null);
    assert.doesNotMatch(text(doc.querySelector(".scp-cp-kpis")), /Weekly swing/);
    assert.doesNotMatch(text(doc.querySelector(".scp-cp-prose")), /without a top-12/);
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
    assert.equal(doc.querySelector(".scp-cp-col.is-now"), null);
    assert.equal(doc.querySelector(".scp-st-table tr.is-cur"), null);
  });

  test("no NFL games: no tab at all", () => {
    assert.equal(st.renderStatsTab(state({ logCareer: [] })), "");
  });

  test("the read names his targets from data, and the Redraft Command links carry the slug and CTA", () => {
    const doc = render(state());
    const prose = doc.querySelector(".scp-cp-prose");
    assert.match(text(prose), /Trey McBride/);
    const ctas = [...doc.querySelectorAll("[data-cta]")].map((el) => [el.dataset.cta, el.getAttribute("href")]);
    assert.deepEqual(ctas, [
      ["redraft-command-stats-prose", "https://statchasers.com/redraft-command/?player=jacoby-brissett"],
      ["redraft-command-stats-sidebar", "https://statchasers.com/redraft-command/?player=jacoby-brissett"],
    ]);
    assert.ok(doc.querySelector("a.scp-cp-rc-btn[data-cta='redraft-command-stats-sidebar']"), "the sidebar's button");
    // The KPI cards sit under the chart, ahead of the read.
    const kpis = doc.querySelector(".scp-cp-kpis");
    assert.ok(doc.querySelector(".scp-cp-chart").compareDocumentPosition(kpis) & 4, "cards after the chart");
    assert.ok(kpis.compareDocumentPosition(doc.querySelector("#scp-st-read-h")) & 4, "cards before the read's heading");
    const tiles = [...doc.querySelectorAll(".scp-cp-kpi-label")].map(text);
    // "Games appeared in", not availability (2026-11-04, renamed 2026-11-06),
    // and the top-12 WEEKS counted out beside their share, over ranked weeks.
    assert.deepEqual(tiles, ["Career PPG", "Games appeared in", "Top-12 weeks", "Weekly swing"]);
    const captions = [...doc.querySelectorAll(".scp-cp-kpi-sub")].map(text);
    assert.equal(captions[0], "25 games, 3 seasons · PPR");
    assert.match(captions[1], /^\d+ of \d+ team games$/);
    assert.equal(captions[2], "15 of 25 ranked weeks");
    assert.equal(captions[3], "Std. dev. of weekly points", "no fixed-band word like \"Moderate\"");
    // Each tile's definition sits behind its info button, closed by default.
    for (const k of doc.querySelectorAll(".scp-cp-kpi")) {
      const btn = k.querySelector("button[data-scp-info]");
      const def = doc.getElementById(btn.getAttribute("aria-controls"));
      assert.ok(def && def.hasAttribute("hidden") && text(def).length > 20, "a closed definition");
    }
    assert.match(doc.querySelector(".scp-cp-kpi:last-child").getAttribute("title"), /standard deviation/);
    // The read says "season finish" so the two cannot be read against each other,
    // and a thin season is not a trend.
    const read = text(prose);
    assert.match(read, /without a top-12 season finish\./);
    assert.match(read, /So far in 2026 he has 3 games \(16\.5 a game\) against 14 appearances in 2025: too little on one side to call a trend\./);
    assert.doesNotMatch(read, /up \d/);
    assert.equal(doc.querySelectorAll(".scp-cp-high").length, 4);
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
    const highs = [...doc.querySelectorAll(".scp-cp-high")].map((li) => [".scp-cp-high-v", ".scp-cp-high-l", ".scp-cp-high-s"].map((c) => text(li.querySelector(c))));
    // Four highs: figure, short label, the season under it (mak, 2026-09-30).
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
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-analysis-part")].map((p) => `${text(p.querySelector("h4"))}: ${text(p.querySelector("p:not(.scp-stp-analysis-lede)"))}`), ["Fantasy impact: A volume passer."]);
    // The phone's copy of the hero lede rides at the top of the fantasy-impact
    // read (mak's mobile brief, 2026-11-05); the hero's own is marked moved.
    assert.ok(doc.querySelector(".scp-stp-analysis-lede"));
    assert.ok(doc.querySelector(".scp-stp-bar-sub.is-moved"));
    const paras = [...doc.querySelectorAll(".scp-cp-prose p")].map(text);
    assert.deepEqual(paras.slice(0, 2), ["First.", "Second."]);
    assert.equal(paras.length, 3, "blank paragraphs dropped, Redraft Command paragraph kept");
    assert.ok(doc.querySelector('.scp-cp-prose [data-cta="redraft-command-stats-prose"]'));
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
    assert.match(text(doc.querySelector(".scp-cp-val")), /^−1\.2$/);
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

describe("the career section (mak's briefs of 2026-11-05, approved the same day)", () => {
  const doc = (s = state()) => render(s);

  test("the tab carries one career block, mounted by the page, and the parts carry none of the old section", () => {
    const s = state();
    const parts = st.renderStatsTabParts(s, {}, { careerTable: "" });
    assert.equal(parts.top, "", "the chart and the tiles are gone from the parts");
    assert.equal(parts.rest, "", "the read is gone from the parts");
    assert.ok(parts.foot.includes("scp-st-foot") || parts.foot.length > 0, "the footer stays");
    const d = doc(s);
    assert.equal(d.querySelectorAll(".scp-cp").length, 1);
    assert.equal(d.querySelector(".scp-cp-label"), null, "no comparison label");
    assert.equal(d.querySelector("[data-scp-premium='career']"), null);
    assert.equal(d.querySelector(".scp-cp").getAttribute("aria-labelledby"), "scp-st-arc-h");
  });

  test("the chart's figures are the model's: per-game points, and the average as career points over career games", () => {
    const s = state();
    const d = doc(s);
    const games = s.logCareer.reduce((n, l) => n + l.weeks.filter((w) => w.game_status !== "inactive").length, 0);
    const pts = s.logCareer.reduce((n, l) => n + l.weeks.reduce((m, w) => m + (w.stats.pts_ppr ?? 0), 0), 0);
    assert.equal(text(d.querySelector(".scp-cp-avg b")), (pts / games).toFixed(1));
    assert.deepEqual([...d.querySelectorAll(".scp-cp-fin")].map(text), ["QB46", "QB16", "QB20"], "season finishes by total points, the season in progress too");
    const cols = [...d.querySelectorAll(".scp-cp-col")];
    assert.match(cols[2].getAttribute("title"), /^2026 \(in progress\) · ARI · 3 GP · 16\.5 PPR PPG · 49\.6 points · QB20 in total points so far$/);
    for (const c of cols) assert.equal(c.getAttribute("tabindex"), "0", "keyboard-focusable");
  });

  test("the Redraft Command card and the highs are the model's", () => {
    const d = doc();
    assert.equal(text(d.querySelector(".scp-cp-rc-h")), "Redraft Command");
    assert.equal(d.querySelector(".scp-cp-rc-h").tagName, "H3");
    assert.match(text(d.querySelector(".scp-cp-rc p")), /^Career stats tell you who he's been/);
    assert.match(text(d.querySelector("a.scp-cp-rc-btn")), /^Open Brissett in Redraft Command/);
    assert.deepEqual([...d.querySelectorAll(".scp-cp-high-l")].map(text).length, 4);
    assert.equal(d.querySelector(".scp-cp-h.is-highs").tagName, "H3");
  });

  test("no NFL season: nothing renders", () => {
    assert.equal(cp.renderPremiumCareer(state({ logCareer: [] })), "");
  });
});
