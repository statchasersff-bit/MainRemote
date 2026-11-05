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
    // The career-rate tiles' section has no heading (mak, 2026-10-22): it is
    // the strip under the chart, named for assistive tech only.
    assert.equal(doc.querySelector("section.scp-st-sec-rates").getAttribute("aria-label"), "Career rates");
    // The StatChasers Analysis module is its own headingless section under
    // the career table since 2026-11-05 (mak), named for assistive tech.
    assert.equal(doc.querySelector("section.scp-st-scasec").getAttribute("aria-label"), "StatChasers analysis");
    assert.ok(doc.querySelector("section.scp-st-scasec .scp-st-read.scp-st-sca"), "the module lives in it");
    const order = [...doc.querySelectorAll("section")].map((s) => s.className);
    assert.ok(order.indexOf("scp-ox-sec scp-st-scasec") > order.findIndex((c) => /advsec/.test(c)), "after the advanced section");
    const heads = [...doc.querySelectorAll("section:not(.scp-st-sec-rates):not(.scp-st-scasec)")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      assert.ok(sec.querySelector(".scp-ox-lede") || h2.id === "scp-st-read-h" || h2.id === "scp-st-arc-h", `${h2.id} has a lede`);
      return text(h2);
    });
    assert.deepEqual(heads, [
      "Jacoby Brissett 2026 Stats",
      "Jacoby Brissett Passing Stats",
      "Jacoby Brissett Fantasy Football Stats",
      "What His Career Numbers Say",
    ]);
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

    // One light-gray rail of cells, label / figure / muted second line. The
    // Fantasy (PPR) block beside it is gone (mak, 2026-10-22).
    // Games and starts open the rail, sacks and fumbles lost joined it
    // (the standard-stat audit, 2026-11-04).
    const cells = [...doc.querySelectorAll(".scp-st-rail > .scp-st-cell")];
    assert.deepEqual(cells.map((c) => text(c.querySelector("dt"))), ["Games", "Pass yards", "Comp %", "Pass TD", "INT", "Sacks", "Rushing"]);
    const cell = (c) => [...c.querySelectorAll("dt, dd")].map(text).join(" ");
    assert.equal(cell(cells[0]), "Games 3", "the figure alone (mak, 2026-11-05)");
    assert.equal(cells[0].querySelector("[data-total]"), null, "games played has no per-game figure");
    assert.equal(cell(cells[5]), "Sacks 0 0 Fum lost");
    const yards = cells[1].querySelector(".scp-st-cv [data-total]");
    assert.equal(yards.textContent, "600");
    assert.equal(yards.dataset.pg, "200.0");
    const cmpAtt = cells[2].querySelector(".scp-st-cs [data-total]");
    assert.equal(cmpAtt.dataset.pg, "20.0/30.0");
    assert.equal(cells[2].querySelector(".scp-st-cv [data-total]"), null, "completion % is a rate");
    // Rushing is the yards alone as the figure (mak, 2026-10-22); the TDs ride the second line.
    assert.match(text(cells[6].querySelector(".scp-st-cv")), /^\S+$/);
    assert.doesNotMatch(text(cells[6].querySelector(".scp-st-cv")), /TD/);
    assert.match(text(cells[6].querySelector(".scp-st-cs")), /0 TD$/);
    assert.equal(doc.querySelector(".scp-st-fan"), null, "the Fantasy (PPR) block is gone");
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
    const yards = doc.querySelector(".scp-st-cell:nth-child(2) .scp-st-cv [data-total]");
    pg.click();
    assert.equal(yards.textContent, "200.0");
    assert.equal(pg.getAttribute("aria-pressed"), "true");
    assert.equal(totals.getAttribute("aria-pressed"), "false");
    assert.equal(text(doc.querySelector(".scp-st-cell:nth-child(3) .scp-st-cv")), "66.7%", "rates never change");
    assert.equal(text(doc.querySelector(".scp-st-cell:nth-child(1) .scp-st-cv")), "3", "games played never changes");
    totals.click();
    assert.equal(yards.textContent, "600");
    dom.window.close();
  });

  test("advanced: tier ladders in the team pages' style, this season only, one footnote", () => {
    const doc = render(state());
    assert.equal(doc.querySelector(".scp-st-advcard"), null, "the cards are a table now (mak, 2026-09-30)");
    assert.equal(doc.querySelector("table.scp-st-advt"), null, "and ladders since 2026-10-22 (mak)");
    // One season, so no group heading; the previous-season column went 2026-10-22.
    assert.equal(doc.querySelector(".scp-st-ladgroup"), null);
    // Two columns (mak, 2026-10-22): Efficiency, then one stacked card of the
    // other tiers; the fixture has only Usage rows there this season. No
    // captions under the titles.
    const ladders = [...doc.querySelectorAll(".scp-st-ladder")];
    assert.deepEqual(ladders.map((l) => text(l.querySelector(".scp-st-ladder-title"))), ["Efficiency", "Usage"]);
    assert.ok(!ladders[0].classList.contains("is-wide"));
    assert.ok(ladders[1].classList.contains("is-stack"));
    assert.equal(ladders[0].dataset.tier, "efficiency");
    assert.equal(doc.querySelector(".scp-st-ladder-caption"), null);
    const rows = [...doc.querySelectorAll(".scp-st-stat")];
    assert.equal(rows.length, 6);
    const rowOf = (label) => rows.find((r) => r.querySelector(".scp-st-stat-label").firstChild.textContent === label);
    assert.equal(rowOf("Time to throw"), undefined, "last season's style rows no longer appear");
    // label | bar | value | rank: the rank, not the percentile (mak,
    // 2026-10-22), as bare tinted text with the full sentence as its title.
    const epa = rowOf("EPA per play");
    assert.equal(text(epa.querySelector(".scp-st-stat-value")), "+0.10");
    assert.equal(text(epa.querySelector(".scp-st-stat-rank")), "16th of 36");
    assert.equal(epa.querySelector(".scp-st-stat-rank").dataset.tier, "mid");
    assert.equal(epa.querySelector(".scp-st-stat-rank").getAttribute("title"), "16th of 36 QBs");
    // Better rank, longer bar.
    assert.equal(epa.querySelector(".scp-st-stat-fill").getAttribute("style"), fill(16, 36));
    // The visible rank cells never say "percentile" (the fixture's reads do, as screen-reader text).
    for (const r of doc.querySelectorAll(".scp-st-stat-rank")) assert.doesNotMatch(text(r), /percentile/);
    // 0-24 poor, 25-74 mid, 75+ good: the percentile still tints the bar and the rank.
    const ypa = rowOf("Yards per attempt");
    assert.equal(ypa.querySelector(".scp-st-stat-bar").dataset.tier, "poor");
    assert.equal(ypa.querySelector(".scp-st-stat-rank").dataset.tier, "poor");
    const ypaM = CURRENT.metrics.find((m) => m.label === "Yards per attempt");
    const ord = (n) => `${n}${n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
    assert.equal(text(ypa.querySelector(".scp-st-stat-rank")), `${ord(ypaM.rank)} of 36`);
    assert.equal(ypa.querySelector(".scp-st-stat-fill").getAttribute("style"), fill(ypaM.rank, 36));
    assert.equal(rowOf("Completion rate").querySelector(".scp-st-stat-rank").dataset.tier, "good");
    // The footnote names this season's pool only; no gray rows, so no gray note.
    assert.equal(
      text(doc.querySelector(".scp-st-foot-note")),
      "Ranks: 2026 through Week 3 among 36 qualified QBs.",
    );
    // Every metric's definition is its label's tooltip (2026-11-04).
    assert.match(epa.querySelector(".scp-st-stat-label").getAttribute("title"), /^Expected points added per play/);
    assert.match(rowOf("Completion rate").querySelector(".scp-st-stat-label").getAttribute("title"), /completions divided by pass attempts/);
    assert.equal(doc.querySelector(".scp-st-src"), null, "mak removed the sources line, 2026-09-30");
    // The StatChasers Analysis module (was "SC Analysis" until 2026-11-04): the profile, then the fantasy impact.
    const read = doc.querySelector(".scp-st-read.scp-st-sca");
    assert.deepEqual([...read.querySelectorAll("h3")].map(text), ["Passing profile", "Fantasy impact"]);
    const paras = [...read.querySelectorAll("p")].map(text);
    assert.match(paras[0], /^Brissett .+\.$/);
    // Three games is a small sample (2026-11-04): what he did, the TD share,
    // and that the trends are not established - never a "floor" off three games.
    assert.equal(
      paras[1],
      "Brissett threw for 600 yards and three touchdowns on 90 attempts across his first three appearances of 2026. " +
        "Touchdown passes generated 24% of his fantasy points. With only 3 games played, his season-long efficiency and workload trends are not yet established.",
    );
    assert.equal(text(read.querySelector(".scp-st-sca-note")), "Small sample · 3 games · 90 attempts");
    // The header (mak, 2026-10-05): the name H2, then a one-line read; no dek, no tags.
    assert.equal(doc.querySelector(".scp-st-dek"), null);
    assert.equal(doc.querySelector(".scp-st-tags"), null);
    assert.match(text(doc.querySelector("#scp-st-adv-h + .scp-st-sum")), /volume · \S+ efficiency$|efficiency$/);
  });

  test("below the qualifying line: no ranks, one footnote says why, no row repeats it", () => {
    const unqualified = {
      ...CURRENT, qualified: false, qualifyNote: "50+ pass attempts, 6+ games and a 25%+ snap share",
      metrics: CURRENT.metrics.map((m) => ({ ...m, read: "Not enough attempts to rank", standing: "muted", pct: null, pctl: null, rank: null, of: null })),
    };
    const doc = render(state({ statsAdvanced: { current: unqualified, last: null } }));
    // One qualification note, with the line itself (2026-11-04), and not
    // "Not enough attempts to rank" on every row.
    assert.equal(text(doc.querySelector(".scp-st-foot-note")), "Ranks: 2026: below the qualifying line so far (50+ pass attempts, 6+ games and a 25%+ snap share), so no ranks.");
    assert.equal(doc.querySelectorAll(".scp-st-pb:not(.is-muted)").length, 0);
    assert.doesNotMatch(text(doc.querySelector(".scp-st-advsec")).replace(text(doc.querySelector(".scp-st-foot-note")), ""), /Not enough attempts/);
    assert.equal(doc.querySelectorAll(".scp-st-stat .scp-sr").length, 0, "no screen-reader read on an unranked row");
    assert.doesNotMatch(text(doc.querySelector("section .scp-ox-lede")), /percentile/);
  });

  test("the fantasy impact reads by sample: a starter's floor, a reserve's playing time, a stale season says so", () => {
    // A starter's season: 14 games at 30 attempts.
    const starter = render(state({ leagueWeek: 15, logCareer: [{ season: 2026, weeks: Array.from({ length: 14 }, (_, i) => qb(i + 1, 16, 12, "ARI", { gs: 1 })), finish: 16 }] }));
    const impact = (doc) => text([...doc.querySelectorAll(".scp-st-sca-part")].find((p) => text(p.querySelector("h3")) === "Fantasy impact").querySelector("p"));
    assert.equal(impact(starter), "His floor is his volume: 30.0 pass attempts and 3.0 carries a game across 14 games this season. Efficiency decides how much of it becomes points.");
    assert.equal(starter.querySelector(".scp-st-sca-note"), null);
    // A reserve: 8 games at 10 attempts, 1 start.
    const reserve = render(state({ leagueWeek: 9, logCareer: [{ season: 2026, weeks: Array.from({ length: 8 }, (_, i) => qb(i + 1, 4, 40, "ARI", { pass_att: 10, gs: i === 0 ? 1 : 0 })), finish: 50 }] }));
    assert.equal(impact(reserve), "Brissett has made 8 appearances (1 start) this season at 10.0 pass attempts and 3.0 carries a game: a reserve's workload, so his fantasy value turns on playing time before efficiency.");
    assert.equal(text(reserve.querySelector(".scp-st-sca-note")), "Reserve role · 8 games · 1 start");
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
    assert.equal([...doc.querySelector(".scp-st-rail > .scp-st-cell").querySelectorAll("dt, dd")].map(text).join(" "), "Games 3");
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
    assert.match(text(doc.querySelector("#scp-st-prod-h").closest("section").querySelector(".scp-ox-lede")), /^(Touchdowns accounted|He didn't score)/);
    assert.ok(doc.querySelector("[data-scp-seg]"));
    // Last season stands in alone until this season has a line; no group heading for one season.
    assert.equal(doc.querySelector(".scp-st-ladgroup"), null);
    assert.ok([...doc.querySelectorAll(".scp-st-stat-label")].some((l) => l.firstChild.textContent === "Time to throw"));
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
    const { top } = st.renderStatsTabParts(state(), {}, { careerTable: table });
    const dom = new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${top}</div></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const sec = doc.querySelector("#scp-st-career-h").closest("section");
    const seg = sec.querySelector("[data-scp-view-seg]");
    assert.ok(sec.querySelector(".scp-st-headrow [data-scp-view-seg]"), "the switch rides the heading row");
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
    // The heading shares a row with the totals/per-game toggle (2026-09-30).
    const lede = doc.querySelector(".scp-st-headrow:has(> #scp-st-prod-h) + .scp-ox-lede");
    assert.equal(lede.querySelector("a").getAttribute("href"), "/nfl/players/trey-mcbride/");
    assert.equal(lede.querySelector("b"), null, "HTML prints as text");
    assert.match(text(lede), /<b>no HTML<\/b>/);
    // Not given: the generated summary line stays.
    assert.match(text(doc.querySelector(".scp-st-sum")), /efficiency$/);
    assert.equal(text(doc.querySelector(".scp-st-read")), "StatChasers AnalysisFantasy impactA volume passer.");
    const paras = [...doc.querySelectorAll(".scp-ox-prose p")].map(text);
    assert.deepEqual(paras.slice(0, 2), ["First.", "Second."]);
    assert.equal(paras.length, 3, "blank paragraphs dropped, Redraft Command paragraph kept");
    assert.ok(doc.querySelector('.scp-ox-prose [data-cta="redraft-command-stats-prose"]'));
    assert.equal(doc.querySelector(".scp-st-byline"), null, "an analyst's date prints no byline either");
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
    // Two sets of ladders, each headed: this season, then college (2026-10-22 layout).
    assert.deepEqual([...doc.querySelectorAll(".scp-st-ladgroup")].map(text), ["2026 Current · thru Wk 3", "College NC State 2025"]);
    assert.match(text(doc.querySelector(".scp-st-foot-note")), /College: ranked among 88 college passers with 150\+ attempts\./);
    const college = doc.querySelectorAll(".scp-st-ladgroup-wrap")[1];
    const rows = [...college.querySelectorAll(".scp-st-stat")];
    const labels = rows.map((r) => r.querySelector(".scp-st-stat-label").firstChild.textContent);
    for (const label of ["Completion %", "Passing TDs", "Interceptions", "Rushing yards", "EPA per play (PPA)"]) {
      assert.ok(labels.includes(label), label);
    }
    const cmp = rows[labels.indexOf("Completion %")];
    assert.equal(cmp.querySelector(".scp-st-stat-rank").dataset.tier, "good");
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

const prm = await importModule("lib/player/stats-premium");

describe("the premium comparison block (mak's brief, 2026-11-05)", () => {
  const table =
    `<div class="scp-scroll"><table class="scp-table scp-table--filled scp-table--career" data-scp-sortable data-scp-view="nfl">` +
    `<thead><tr><th>Season</th><th class="is-nfl">Cmp</th><th class="is-fan">FPTS</th></tr></thead>` +
    `<tbody><tr class="scp-row is-current"><th scope="row">2026</th><td class="is-nfl">17</td><td class="is-fan">19.5</td></tr></tbody></table></div>`;
  const both = (s = state()) => {
    const { top, rest } = st.renderStatsTabParts(s, {}, { careerTable: table });
    const html = `${top}${rest}${prm.renderPremiumStats(s, { careerTable: table })}`;
    return new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`).window.document;
  };

  test("it stands under the existing sections, labelled, and the old markup is untouched", () => {
    const s = state();
    const before = st.renderStatsTabParts(s, {}, { careerTable: table });
    const doc = both(s);
    const label = doc.querySelector(".scp-stp-label");
    const block = doc.querySelector('[data-scp-premium="stats"]');
    assert.ok(label && block, "label and block");
    assert.equal(label.textContent, "New design - comparison");
    assert.equal(label.nextElementSibling, block);
    // Everything before the label is the current tab, byte for byte: the
    // premium markup is appended to the parts, never woven into them.
    const html = `${before.top}${before.rest}${prm.renderPremiumStats(s, { careerTable: table })}`;
    assert.ok(html.startsWith(before.top + before.rest));
    assert.equal(html.indexOf('class="scp-stp-label"'), (before.top + before.rest).length + "<p ".length);
  });

  test("the KPI cards are the rail's cells: the same figures, the same per-game data", () => {
    const doc = both();
    const rail = [...doc.querySelectorAll(".scp-st-rail .scp-st-cell")].map((c) => ({ label: text(c.querySelector("dt")), main: text(c.querySelector(".scp-st-cv")) }));
    const kpis = [...doc.querySelectorAll(".scp-stp-kpi")].map((c) => ({ label: text(c.querySelector(".scp-stp-kpi-label")), main: text(c.querySelector(".scp-stp-kpi-value")) }));
    assert.equal(kpis.length, 5);
    assert.deepEqual(kpis.map((k) => k.label), ["Games", "Pass yards", "Pass TD", "INT", "Comp %"]);
    for (const k of kpis) assert.equal(k.main, rail.find((r) => r.label === k.label).main, k.label);
    // The per-game figure rides along for the toggle, inside the premium block's own section.
    const yards = doc.querySelector(".scp-stp-kpi:nth-child(2) [data-total]");
    assert.ok(yards && yards.dataset.pg, "per-game data on the counting stat");
    assert.ok(doc.querySelector('[data-scp-premium="stats"] [data-scp-seg] button[data-mode="pg"]'), "its own totals / per-game switch");
  });

  test("the metric rows are the ladder's: the same values, ranks and tints, in Efficiency then Usage & Style", () => {
    const doc = both();
    const ladder = [...doc.querySelectorAll(".scp-st-stat")].map((r) => ({
      label: text(r.querySelector(".scp-st-stat-label")).replace(/ - .*$/, ""),
      value: text(r.querySelector(".scp-st-stat-value")),
      rank: text(r.querySelector(".scp-st-stat-rank")),
      tier: r.querySelector(".scp-st-stat-rank").dataset.tier,
    }));
    const rows = [...doc.querySelectorAll(".scp-stp-row")].map((r) => ({
      label: text(r.querySelector(".scp-stp-row-label")),
      value: text(r.querySelector(".scp-stp-row-value")),
      rank: text(r.querySelector(".scp-stp-rank")),
      tier: r.querySelector(".scp-stp-rank").dataset.tier,
    }));
    assert.equal(rows.length, ladder.length);
    for (const row of rows) {
      const l = ladder.find((x) => x.label === row.label);
      assert.ok(l, row.label);
      assert.equal(row.value, l.value, row.label);
      assert.equal(row.tier, l.tier, row.label);
      assert.equal(row.rank.replace(/ percentile$/, ""), l.rank.replace(/ percentile$/, ""), row.label);
    }
    // The QB fixture carries no Style metric, so the right card is "Usage" alone.
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-card-title")].map(text), ["Efficiency", "Usage"]);
    assert.deepEqual([...doc.querySelectorAll(".scp-stp-row")].map((r) => r.dataset.family), ["eff", "eff", "eff", "eff", "eff", "use"]);
    assert.match(text(doc.querySelector(".scp-stp-note")), /^Ranks: 2026 through Week 3 among 36 qualified QBs/);
    assert.equal(text(doc.querySelector(".scp-stp-note")), text(doc.querySelector(".scp-st-foot-note")));
  });

  test("the career table and the analysis are the same markup and the same sentences", () => {
    const doc = both();
    const copies = doc.querySelectorAll("table.scp-table--career");
    assert.equal(copies.length, 2);
    assert.equal(copies[1].outerHTML, copies[0].outerHTML);
    assert.ok(doc.querySelector('[data-scp-premium="stats"] [data-scp-view-seg]'), "its own NFL / Fantasy switch");
    const oldParts = [...doc.querySelectorAll(".scp-st-sca-part")].map((p) => [text(p.querySelector("h3")), text(p.querySelector("p"))]);
    const newParts = [...doc.querySelectorAll(".scp-stp-analysis-part")].map((p) => [text(p.querySelector("h4")), text(p.querySelector("p"))]);
    assert.deepEqual(newParts, oldParts);
    assert.equal(text(doc.querySelector(".scp-stp-brand-text")), "StatChasers Analysis");
  });

  test("the premium block's own toggles work: per game swaps its KPI figures, Fantasy swaps its table view", async () => {
    const s = state();
    const { top, rest } = st.renderStatsTabParts(s, {}, { careerTable: table });
    const html = `${top}${rest}${prm.renderPremiumStats(s, { careerTable: table })}`;
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    const dom = new JSDOM(`<body><div data-scp-root><div class="scp-ox scp-st">${html}</div></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const block = doc.querySelector('[data-scp-premium="stats"]');
    const yards = block.querySelector(".scp-stp-kpi:nth-child(2) [data-total]");
    assert.equal(yards.textContent, "600");
    block.querySelector('[data-scp-seg] button[data-mode="pg"]').click();
    assert.equal(yards.textContent, "200.0", "the premium KPI follows its own switch");
    // The current tab's rail did not move: each switch scopes to its section.
    assert.equal(doc.querySelector(".scp-st-rail [data-total]").textContent, "600");
    const tbl = block.querySelector("table[data-scp-view]");
    assert.equal(tbl.dataset.scpView, "nfl");
    block.querySelector('[data-scp-view-seg] button[data-view="fantasy"]').click();
    assert.equal(tbl.dataset.scpView, "fantasy");
    assert.equal(doc.querySelector("#scp-st-career-h").closest("section").querySelector("table[data-scp-view]").dataset.scpView, "nfl", "the current table kept its view");
  });

  test("no season on the page: nothing premium renders", () => {
    assert.equal(prm.renderPremiumStats(state({ logCareer: [], player: { ...state().player, position: "K" } })), "");
  });
});
