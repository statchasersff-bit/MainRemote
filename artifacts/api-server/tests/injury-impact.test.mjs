/**
 * Injury impact analysis.
 *
 * Two halves. The model (lib/injury-impact/model.ts) is held to the standalone
 * app's own code: tests/fixtures/injury-impact-source-2026-10-20.json is what
 * the memo bodies of its pages/Dashboard.tsx (at c6a49ce), cut out verbatim by
 * scripts/injury-impact/genFixture.mjs, computed over the packed data for four
 * filter states, and every figure, label and sentence here must match. Then
 * the routes are checked over HTTP: both pages, both fragments the plugin
 * prints, and the slices the bundle redraws from.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/server.mjs";
import { importModule } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data", "injury-impact");
const model = await importModule("lib/injury-impact/model");
const player = await importModule("lib/injury-impact/player");
const durability = await importModule("lib/injury-impact/durability");
const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "injury-impact-source-2026-10-20.json"), "utf8"));
const gmFixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "injury-durability-source-2026-10-20.json"), "utf8"));

const read = (f) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));
const analysis = read("analysis.json");
const gridiron = read("gridiron.json");
// The server attaches the season in progress's bye weeks before hydrating; the test does the same.
const injuryData = await importModule("lib/injury-impact/data");
gridiron.byes = injuryData.byeWeeks(read("schedule.json")[String(gridiron.current.season)]);
const exposure = read("exposure.json");
const regression = read("regression.json");
const postReturn = read("post-return.json");
const panelPacked = read("panel.json");
const panel = panelPacked.rows.map((r) => Object.fromEntries(panelPacked.keys.map((k, i) => [k, r[i]])));

/**
 * Round like the fixture, compare keys in any order, and read the app's
 * typography as the house's: the en dash in "Picks 1–12" is a hyphen here,
 * " — " in a sentence is a comma, and a lone "—" placeholder is "-".
 */
function norm(value) {
  const sort = (x) =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]))
        : typeof x === "number"
          ? Math.round(x * 1e9) / 1e9
          : typeof x === "string"
            ? x.replace(/\s+—\s+/g, ", ").replace(/—/g, "-").replace(/–/g, "-").replace(/[“”]/g, '"')
            : x;
  return sort(JSON.parse(JSON.stringify(value)));
}

describe("the model reproduces the standalone app", () => {
  for (const [name, s] of Object.entries(fixture.states)) {
    test(`filter state ${name}`, () => {
      const f = { season: s.filters.season, adp: s.filters.adp, minGames: s.filters.minGames };
      const filtered = model.filteredPlayers(analysis, f);
      assert.equal(filtered.length, s.filteredCount, "filtered sample size");
      assert.deepEqual(norm(model.injuryOutcomes(analysis, exposure, f)), norm(s.injuryOutcomes), "injury outcomes");
      assert.deepEqual(norm(model.draftCapitalRisk(analysis, f.season)), norm(s.draftCapitalRisk), "draft-capital risk");
      assert.deepEqual(norm(model.seasonTrends(analysis, exposure, f.adp)), norm(s.seasonTrends), "season trends");
      assert.deepEqual(norm(model.seasonMetrics(analysis, f.adp)), norm(s.seasonMetrics), "season metrics");
      assert.deepEqual(norm(model.regionHeatmap(analysis, f.adp)), norm(s.regionHeatmap), "region heatmap");
      const drafted = model.draftedByPosition(analysis, f);
      assert.deepEqual(norm(drafted), norm(s.draftedByPosition), "drafted by position");
      assert.deepEqual(norm(model.positionImpact(filtered, drafted)), norm(s.positionImpact), "position impact");
      const breakdown = model.injuryTypeBreakdown(filtered, s.filters.injuryPos);
      assert.deepEqual(norm(breakdown), norm(s.injuryTypeBreakdown), "injury type breakdown");
      assert.deepEqual(model.injuryCategoryOptions(breakdown), s.injuryCategoryOptions, "category options");
      const visible = model.injuryTypeVisible(breakdown, s.filters.injuryCategory, s.filters.injurySearch);
      assert.deepEqual(norm(visible), norm(s.injuryTypeVisible), "toolbar-filtered types");
      assert.deepEqual(norm(model.injuryTypeDisplay(visible, s.filters.showAll)), norm(s.injuryTypeDisplay), "top-N display");
      assert.deepEqual(norm(model.chart1Data(filtered)), norm(s.chart1Data), "games missed by position");
      assert.deepEqual(norm(model.chart2Data(filtered)), norm(s.chart2Data), "injuries by ADP tier");
      assert.deepEqual(norm(model.avgGamesMissedData(analysis, f, filtered)), norm(s.avgGamesMissedData), "avg games missed per drafted player");
      assert.deepEqual(norm(model.injuryRateData(analysis, f, filtered)), norm(s.injuryRateData), "injury rate by position");
      assert.equal(model.chart4Data(filtered).length, s.chart4Count, "scatter points");
    });
  }

  test("the season-independent studies", () => {
    const st = fixture.static;
    assert.deepEqual(model.seasonOptions(analysis), st.seasonOptions);
    assert.deepEqual(norm(model.injuryPredictability(analysis)), norm(st.injuryPredictability), "predictability");
    assert.deepEqual(norm(model.agingWorkload(panel)), norm(st.agingWorkload), "age and workload");
    assert.deepEqual(norm(model.injuryTiming(analysis)), norm(st.injuryTiming), "timing");
    assert.deepEqual(norm(model.injuryTypeRisk(analysis, postReturn)), norm(st.injuryTypeRisk), "type classes");
    assert.deepEqual(norm(model.workloadRates(analysis, exposure)), norm(st.workloadRates), "workload rates");
  });

  test("labels and helpers are the app's", () => {
    assert.equal(model.cleanInjuryLabel("Quadricep"), "Quad");
    assert.equal(model.cleanInjuryLabel("Knee (ACL)"), "Knee");
    assert.equal(model.cleanInjuryLabel("Undisclosed"), "Unknown / Undisclosed");
    assert.equal(model.categorizeInjury("Concussion"), "Head/Neck");
    assert.equal(model.categorizeInjury("Ribs"), "Core");
    assert.equal(model.bodyRegion("Achilles"), "Lower Leg");
    assert.equal(model.bodyRegion("Illness"), "Other/Unknown");
    assert.equal(model.bodyRegion("Non Football Injury"), "Ankle/Foot", "the app keys on substrings, so this one lands in Ankle/Foot");
    assert.equal(model.nextSort({ key: null, dir: "desc" }, "count").dir, "desc", "first click sorts descending");
    assert.equal(model.nextSort({ key: "count", dir: "desc" }, "count").dir, "asc");
    assert.ok(Math.abs(model.normalCdf(1.96) - 0.975) < 0.001);
    assert.equal(model.tabForAnchor("q-tag"), "q-matter");
    assert.equal(model.tabForAnchor("nope"), null);
    assert.deepEqual(model.parseFilters({ season: "2023", adpLo: "60", adpHi: "10", minGames: "99" }), { season: "2023", adp: [10, 60], minGames: 16 });
    assert.deepEqual(model.parseFilters({}), model.DEFAULT_FILTERS);
  });

  test("the executive summary reads the trend the way the app did", () => {
    const trends = model.seasonTrends(analysis, exposure, [1, 180]);
    const aw = model.agingWorkload(panel);
    const ex = model.execSummary(trends, aw, postReturn, regression);
    assert.equal(ex.trendRising, trends.fit.p < 0.05 && trends.fit.annualPct > 0);
    assert.equal(ex.trendSignificant, trends.fit.p < 0.05 && trends.fit.annualPct < 0);
    assert.equal(ex.regressionAgrees, regression.season_trend.p < 0.05);
    assert.equal(ex.retAll, postReturn.overall.median_return_ratio);
    assert.equal(ex.workloadSig, aw.workloadSignal.significant);
  });
});

/**
 * The durability model (lib/injury-impact/durability.ts) is held to the
 * Gridiron Medical + page's own hydrate(): tests/fixtures/
 * injury-durability-source-2026-10-20.json is what that function, cut
 * verbatim out of public/gridiron-medical.html by
 * scripts/injury-impact/genDurabilityFixture.mjs, computed over the same
 * gridiron.json.
 */
describe("the durability model reproduces the Gridiron page", () => {
  const d = durability.hydrate(gridiron);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  test("every player's score, tier, availability, penalties and simulator history", () => {
    assert.equal(d.players.length, gmFixture.players.length);
    for (let i = 0; i < d.players.length; i += 1) {
      const got = d.players[i];
      const want = gmFixture.players[i];
      assert.equal(got.n, want.n);
      const have = {
        n: got.n,
        id: got.id ?? null,
        pos: got.pos,
        score: got.score,
        tier: got.tier.key,
        availPct: r6(got.availPct),
        availRatio: r6(got.availRatio),
        gpTot: got.gpTot,
        gmTot: got.gmTot,
        perYearRate: r6(got.perYearRate),
        major: got.major,
        soft: got.soft,
        reinj: got.reinj,
        nEff: r6(got.nEff),
        penalty: r6(got.penalty),
        shrunk: r6(got.shrunk),
        pointsLostCareer: r6(got.pointsLostCareer),
        missHistory: got.missHistory,
        missWeights: got.missWeights.map(r6),
        injuries: got.inj.length,
        seasons: got.seasonYears,
      };
      assert.deepEqual(have, want, `${want.n}`);
    }
  });

  test("the totals, the tiers and the event rows", () => {
    assert.deepEqual({ players: d.players.length, rows: d.rows.length, totalGamesMissed: d.totalGamesMissed, totalPointsLost: r6(d.totalPointsLost), riskyCount: d.riskyCount }, gmFixture.totals);
    assert.deepEqual(gmFixture.tiers.map(([s]) => [s, durability.tierOf(s).key]), gmFixture.tiers);
    assert.deepEqual(d.years, gmFixture.years);
  });

  test("the overview's lists and the current players' order are the page's", () => {
    const ov = durability.overviewView(d);
    assert.deepEqual(ov.topDurable.map((p) => p.n), gmFixture.topDurable);
    assert.deepEqual(ov.topLost.map((p) => p.n), gmFixture.topLost);
    const rows = durability.rankRows(d, durability.defaultRankState());
    assert.equal(rows.length, gmFixture.rankingCount);
    assert.deepEqual(rows.slice(0, 25).map((r) => r.n), gmFixture.rankingTop25);
    assert.deepEqual(rows.slice(0, 5).map((r) => r.rank), [1, 2, 3, 4, 5], "the rank is the durability order");
    // Sorting by another column keeps the durability rank on each row.
    const byAdp = durability.rankRows(d, { ...durability.defaultRankState(), sort: { key: "adp", dir: 1 } });
    assert.ok(byAdp[0].adp <= byAdp[1].adp, "ADP ascending");
    assert.ok(byAdp.every((r) => r.rank >= 1), "every row keeps its rank");
    assert.ok(byAdp.every((r, i) => i === 0 || byAdp[i - 1].adp != null || r.adp == null), "no ADP sorts last");
  });

  test("the event database filters and sorts like the page", () => {
    const all = durability.eventRows(d, durability.defaultEventState());
    assert.equal(all.length, d.rows.length);
    assert.ok(all.every((r, i) => i === 0 || all[i - 1].year >= r.year), "newest first by default");
    const knee = durability.eventRows(d, { ...durability.defaultEventState(), filters: { search: "", pos: "RB", season: "", bodyPart: "Knee", sev: "3" } });
    assert.ok(knee.length > 0 && knee.every((r) => r.pos === "RB" && r.bodyPart === "Knee" && r.sev === 3));
    const named = durability.eventRows(d, { ...durability.defaultEventState(), filters: { search: "mccaffrey", pos: "", season: "", bodyPart: "", sev: "" } });
    assert.ok(named.length > 0 && named.every((r) => r.player.toLowerCase().includes("mccaffrey")));
    // The Injury history table's other filters: team, impact, season-ending only.
    const base = durability.defaultEventState();
    const phi = durability.eventRows(d, { ...base, filters: { ...base.filters, team: "PHI" } });
    assert.ok(phi.length > 0 && phi.every((r) => r.tm === "PHI"), "team");
    const ending = durability.eventRows(d, { ...base, filters: { ...base.filters, seasonEndingOnly: true } });
    assert.ok(ending.length > 0 && ending.length < d.rows.length && ending.every((r) => r.timing.seasonEnding), "season-ending only");
    const withStudy = durability.hydrate({ ...gridiron, study: injuryData.studyIndex(analysis, read("current.json")) });
    const severe = durability.eventRows(withStudy, { ...base, filters: { ...base.filters, impact: "Severe" } });
    assert.ok(severe.length > 0 && severe.every((r) => r.impact === "Severe"), "impact");
    const options = durability.eventOptions(withStudy);
    assert.deepEqual(options.impacts, ["Severe", "Major", "Moderate", "Minor", "In progress", "No ADP Impact"], "impact options by weight");
    assert.ok(options.teams.includes("PHI") && options.teams.length >= 32, "team options");
    assert.ok(named.length > 0 && named.every((r) => r.player.toLowerCase().includes("mccaffrey")));
    assert.deepEqual([durability.eventSortStart("player"), durability.eventSortStart("gm")], [1, -1]);
  });

  test("an event's week, weeks out and return week come from its label and the week string", () => {
    const t = (label, gm, year, w, current = null) => durability.injuryTiming(label, gm, year, w, current);
    const pick = ({ week, weeksOut, returnWeek, ongoing, seasonEnding, returnedInPlayoffs }) => ({ week, weeksOut, returnWeek, ongoing, seasonEnding, returnedInPlayoffs });
    // A.J. Brown 2024: three games from week 2 with the bye inside the run, back in week 6.
    assert.deepEqual(pick(t("Hamstring — out 3 games from week 2", 3, 2024, "PXXXBPPPPPPPPPPPPX|PPPP")), { week: 2, weeksOut: 4, returnWeek: 6, ongoing: false, seasonEnding: false, returnedInPlayoffs: false });
    // Week 18 knee, back for the playoffs.
    assert.deepEqual(pick(t("Knee — out week 18", 1, 2024, "PXXXBPPPPPPPPPPPPX|PPPP")), { week: 18, weeksOut: 1, returnWeek: null, ongoing: false, seasonEnding: false, returnedInPlayoffs: true });
    // Season-ending: weeks to the end of the regular season (17 weeks in 2016).
    assert.deepEqual(pick(t("Right shoulder — out 6 games from week 12 (season-ending)", 6, 2016, "PPPPPPPPPBPXXXXXX")), { week: 12, weeksOut: 6, returnWeek: null, ongoing: false, seasonEnding: true, returnedInPlayoffs: false });
    // A playoff-only event has no week.
    assert.deepEqual(pick(t("Knee — out 1 playoff game", 1, 2023, "PPPPPPPPPBPPPPPPPP|X")), { week: null, weeksOut: null, returnWeek: null, ongoing: false, seasonEnding: false, returnedInPlayoffs: false });
    // The season in progress (stats through week 6): still out, weeks counted to the last week with stats.
    const live = { season: 2026, week: 7, statsWeek: 6, skill: 0, scored: 0 };
    assert.deepEqual(pick(t("Left heel — out 4 games from week 3 (on IR, ongoing)", 4, 2026, "PPXXXX", live)), { week: 3, weeksOut: 4, returnWeek: null, ongoing: true, seasonEnding: false, returnedInPlayoffs: false });
    assert.deepEqual(pick(t("Right ankle — out 1 game from week 6", 1, 2026, "PPPPPX", live)), { week: 6, weeksOut: 1, returnWeek: null, ongoing: true, seasonEnding: false, returnedInPlayoffs: false });
    assert.deepEqual(pick(t("Undisclosed — out 4 games from week 2", 4, 2026, "PXXXXP", live)), { week: 2, weeksOut: 4, returnWeek: 6, ongoing: false, seasonEnding: false, returnedInPlayoffs: false });
    // Off the roster after the absence: no return that season, but not flagged season-ending.
    assert.deepEqual(pick(t("Undisclosed — out week 1", 1, 2016, "X----------------")), { week: 1, weeksOut: 1, returnWeek: null, ongoing: false, seasonEnding: false, returnedInPlayoffs: false });
    // The week string has no record of the absence: the label's games stand in.
    assert.deepEqual(pick(t("Rib — out 2 games from week 6", 2, 2015, "")), { week: 6, weeksOut: 2, returnWeek: 8, ongoing: false, seasonEnding: false, returnedInPlayoffs: false });
  });

  test("local corrections fix a body part the imported data got wrong, in every dataset that carries the event", () => {
    const corrections = JSON.parse(readFileSync(path.join(DATA, "corrections.json"), "utf8")).entries;
    assert.ok(corrections.some((c) => c.gsisId === "00-0035676" && c.season === 2026 && c.bodyPart === "Ankle"), "A.J. Brown's 2026 ankle is on file");
    const raw = structuredClone(gridiron);
    const cur = structuredClone(read("current.json"));
    const an = { player_injury_impacts: [{ gsis_id: "00-0035676", season: 2026, week_of_injury: 2, injury: "Undisclosed" }, { gsis_id: "00-0035676", season: 2024, week_of_injury: 2, injury: "Hamstring" }] };
    injuryData.applyCorrections(corrections, raw, cur, an);
    const brown = raw.players.find((p) => p.id === "00-0035676");
    const ev = brown.inj.find((t) => t[0] === 2026);
    assert.deepEqual(ev.slice(1, 3), ["Ankle — out 4 games from week 2", "Ankle"], "the label and body part");
    assert.equal(ev[5], "structural", "the type");
    assert.deepEqual(brown.inj.filter((t) => t[0] === 2024).map((t) => t[2]), ["Hamstring", "Knee"], "other seasons untouched");
    assert.equal(cur.rows.find((r) => r.gsis_id === "00-0035676").injury, "Ankle", "the season in progress");
    assert.deepEqual(an.player_injury_impacts.map((r) => r.injury), ["Ankle", "Hamstring"], "the impact seasons, by season");
    const hydrated = durability.hydrate(raw);
    assert.equal(hydrated.rows.find((r) => r.gsisId === "00-0035676" && r.year === 2026).bodyPart, "Ankle", "and the event rows");
  });

  test("the event CSV carries the table's columns and the detail behind them, filtered and ordered as shown", () => {
    const rows = durability.eventRows(d, { ...durability.defaultEventState(), filters: { search: "a.j. brown", pos: "", season: "2026", bodyPart: "", sev: "" } });
    const csv = durability.eventCsv(rows);
    const lines = csv.split("\n");
    assert.equal(lines[0], durability.EVENT_CSV_HEADER.join(","));
    assert.equal(lines.length, rows.length + 1);
    // `d` is the file as imported, before corrections.json (applied by the server's reader, tested above).
    // `d` has no study attached: this season's ADP comes from the board in the file and reads In progress; the study join is tested below.
    assert.match(lines[1], /^A\.J\. Brown,WR,NE,2026,19,2,"Undisclosed, out 4 games from week 2",Undisclosed,,other,moderate,4,4,,,6,In progress,$/);
    assert.doesNotMatch(csv, /—|<|>/, "plain text, no em dashes, no markup");
    const still = d.rows.find((r) => r.timing.ongoing);
    assert.match(durability.eventCsv([still]), /,yes,,Proj\. \d+,/, "a still-out player's projection (Still out, then Season ending blank, then the return)");
    const pl = d.rows.find((r) => r.timing.week == null);
    assert.match(durability.eventCsv([pl]), /,Playoffs,/, "a playoff-only event");
  });

  test("the event rows carry the study's ADP and impact: the rule reproduces every study label, exact events take the study's own", () => {
    const current = read("current.json");
    for (const r of analysis.player_injury_impacts) {
      assert.equal(durability.impactLabel(r.overall_adp, r.reg_games_missed ?? r.games_missed), r.impact_label, `${r.player} ${r.season}`);
    }
    const study = injuryData.studyIndex(analysis, current);
    const withStudy = durability.hydrate({ ...gridiron, study });
    assert.equal(withStudy.rows.length, d.rows.length, "the same rows");
    // A completed season the study priced, same week: its ADP and its label.
    const priced = withStudy.rows.find((r) => r.gsisId && r.year < 2026 && study[`${r.gsisId}|${r.year}`]?.l[String(r.timing.week)]);
    const studyRow = analysis.player_injury_impacts.find((x) => x.gsis_id === priced.gsisId && x.season === priced.year && x.week_of_injury === priced.timing.week);
    assert.equal(priced.adp, studyRow.overall_adp);
    assert.equal(priced.impact, studyRow.impact_label);
    // The season in progress: the audited row's ADP, labelled In progress like the Injury history table.
    const ajb = withStudy.rows.find((r) => r.gsisId === "00-0035676" && r.year === 2026);
    assert.equal(ajb.adp, current.rows.find((c) => c.gsis_id === "00-0035676").overall_adp);
    assert.equal(ajb.impact, durability.EVENT_IN_PROGRESS);
    // A season before the study: neither.
    const early = withStudy.rows.find((r) => r.year < 2016);
    assert.deepEqual([early.adp, early.impact], [null, null]);
    // The columns sort: impact by weight with unpriced rows last, ADP ascending from its first click.
    const byImpact = durability.eventRows(withStudy, { ...durability.defaultEventState(), sort: { key: "impact", dir: -1 } });
    assert.equal(byImpact[0].impact, "Severe");
    assert.equal(byImpact[byImpact.length - 1].impact, null);
    assert.equal(durability.eventSortStart("adp"), 1);
    const csv = durability.eventCsv([ajb]);
    assert.match(csv.split("\n")[1], new RegExp(`^A\\.J\\. Brown,WR,NE,2026,${ajb.adp},2,.*,,6,In progress,$`));
    const every = withStudy.rows.filter((r) => r.year >= 2016 && r.year < 2026 && r.adp != null);
    assert.ok(every.length > 2000 && every.every((r) => r.impact != null), "every priced event has a label");
  });

  test("the current players CSV carries the table's columns in the table's order", () => {
    const rows = durability.rankRows(d, durability.defaultRankState());
    const csv = durability.rankCsv(rows);
    const lines = csv.split("\n");
    assert.equal(lines[0], durability.RANK_CSV_HEADER.join(","));
    assert.equal(lines.length, rows.length + 1);
    const first = rows[0];
    assert.match(lines[1], new RegExp(`^1,${first.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},${first.pos},${first.tm},(ACT|IR|RES),${first.score},[A-Za-z ]+,`), "rank, player, position, team, status, score, tier");
    assert.doesNotMatch(csv, /—|<|>/, "plain text, no em dashes, no markup");
    const sorted = durability.rankRows(d, { ...durability.defaultRankState(), sort: { key: "adp", dir: 1 } });
    assert.equal(durability.rankCsv(sorted).split("\n")[1].split(",")[0], String(sorted[0].rank), "the rank column keeps the durability rank when sorted by another column");
  });

  test("players still out this season get a projected return: a base rate past the games missed, IR minimum, bye skipped", () => {
    const live = d.current;
    const ongoing = d.rows.filter((r) => r.timing.ongoing);
    assert.ok(ongoing.length > 0 && ongoing.every((r) => r.year === live.season), "only the season in progress is ongoing");
    for (const r of ongoing) {
      const t = r.timing;
      assert.ok(t.projectedReturn == null || t.projectedReturn > live.statsWeek, `${r.player}: the projection is a week not yet played`);
      assert.ok(t.projectedReturn == null || t.projectedReturn !== gridiron.byes?.[r.tm], `${r.player}: never the bye week`);
      const p = d.byKey[r.key];
      if (p.cur?.st === "IR" && t.projectedReturn != null) {
        const bye = gridiron.byes?.[r.tm];
        const games = Array.from({ length: t.projectedReturn - t.week }, (_, i) => t.week + i).filter((w) => w !== bye).length;
        assert.ok(games >= durability.IR_MIN_GAMES, `${r.player}: at least four games on injured reserve`);
      }
    }
    assert.ok(d.rows.every((r) => !r.timing.ongoing || r.timing.returnWeek == null), "a still-out player has no return week");
    for (const key of ["week", "weeksOut", "returnWeek", "type"]) {
      const sorted = durability.eventRows(d, { ...durability.defaultEventState(), sort: { key, dir: -1 } });
      assert.equal(sorted.length, d.rows.length, `sort by ${key}`);
    }
    const byReturn = durability.eventRows(d, { ...durability.defaultEventState(), sort: { key: "returnWeek", dir: -1 } });
    assert.ok(durability.eventSortValue(byReturn[0], "returnWeek") != null && durability.eventSortValue(byReturn[byReturn.length - 1], "returnWeek") == null, "rows without a return sort last");
  });

  test("players are found by GSIS id, exact name and loose name", () => {
    const p = d.players.find((x) => x.id && /\./.test(x.n));
    assert.ok(p, "a player with an initialled name");
    assert.equal(durability.findPlayer(d, p.id), p);
    assert.equal(durability.findPlayer(d, p.n), p);
    assert.equal(durability.findPlayer(d, p.n.replace(/\./g, "")), p);
    assert.equal(durability.findPlayer(d, "nobody at all"), null);
  });

  test("the simulator is the page's arithmetic, and repeatable with a seeded source", () => {
    const safe = durability.presetSafe(d);
    const upside = durability.presetUpside(d);
    assert.equal(safe.length, 7);
    assert.equal(upside.length, 7);
    assert.ok(safe.every((k) => d.byKey[k]), "preset keys resolve");
    const roster = safe.map((k) => d.byKey[k]);
    const a = durability.runSim(roster, durability.seededRng(7));
    const b = durability.runSim(roster, durability.seededRng(7));
    assert.deepEqual(a, b, "same seed, same result");
    assert.equal(a.n, 2000);
    assert.equal(a.bins.length, 28);
    assert.equal(a.bins.reduce((s, x) => s + x.count, 0), 2000);
    assert.ok(a.min <= a.p10 && a.p10 <= a.p50 && a.p50 <= a.p90 && a.p90 <= a.max);
    assert.ok(a.mean < a.ceiling, "injury luck costs points");
    assert.equal(durability.runSim(roster.slice(0, 1)), null, "two players at least");
  });
});

describe("the player panel", () => {
  const shard = read("history/28.json");
  const expand = (keys, rows) => rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
  const entry = shard.players["00-0030228"];
  const rows = expand(shard.keys.h, entry.h);
  const inGame = expand(shard.keys.g, entry.g);

  test("classifies report phrases into body regions, compound phrases into several", () => {
    assert.deepEqual(player.classify("Ankle / Knee"), ["knee", "ankle"]);
    assert.deepEqual(player.classify("Illness"), []);
    assert.deepEqual(player.classify("Hamstring"), ["thigh"]);
    assert.equal(player.injuryLabel({ reportPrimaryInjury: "Knee", reportSecondaryInjury: "knee", practicePrimaryInjury: null, practiceSecondaryInjury: null }), "Knee");
    assert.equal(player.injuryLabel({ reportPrimaryInjury: null, reportSecondaryInjury: null, practicePrimaryInjury: "Toe", practiceSecondaryInjury: "Hip" }), "Toe · Hip");
  });

  test("shades a region by games missed, not report frequency", () => {
    assert.deepEqual(player.severityColor(0, false), { fill: "#fde9c8", stroke: "#f2c99a" });
    assert.deepEqual(player.severityColor(3, false), { fill: "#fb923c", stroke: "#ea580c" });
    assert.deepEqual(player.severityColor(0, true), { fill: "#ef4444", stroke: "#b91c1c" });
  });

  test("builds the risk profile from the weekly rows and the impact seasons", () => {
    const m = player.riskModel(rows, [{ season: 2021, team: "CAR", injury: "Foot", week_of_injury: 15, games_missed: 3, season_ending: true }]);
    assert.equal(m.gamesMissed, 3);
    assert.equal(m.seasonEnding, 1);
    assert.ok(m.perRegion.has("foot"));
    assert.equal(m.perRegion.get("foot").severe, true);
    assert.ok(m.lastInjury);
    assert.equal(m.lastInjury.season, 2021);
    assert.ok(m.regionsAffected >= 1);
  });

  test("lays out a season timeline over the team's schedule, byes as gaps", () => {
    const schedule = read("schedule.json");
    const seasons = player.timelineModel(rows, [], { 2021: { CAR: schedule["2021"].CAR } });
    const s2021 = seasons.find((s) => s.season === 2021);
    assert.ok(s2021);
    assert.equal(s2021.team, "CAR");
    assert.equal(s2021.cells.filter((c) => c.bye).length, 1, "one bye in an 18-week season");
    assert.ok(s2021.cells.some((c) => c.missed), "the Out weeks are shaded");
    assert.equal(player.gameContext(inGame[0]).includes("Week 8"), true);
    assert.equal(player.quarterLabel(5), "OT");
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

  test("the analysis page renders every question, one H1, and stays out of the index", async () => {
    const res = await fetch(`${server.origin}/injury-impact`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, indexifembedded");
    const html = await res.text();
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /<title>Fantasy Football Injury Risk Analysis - StatChasers<\/title>/);
    assert.match(html, /<link rel="canonical" href="[^"]*\/injury-impact" \/>/);
    for (const label of ["Is the NFL becoming safer?", "Can we predict who will get injured?", "Which injuries are most likely to recur?", "Which injuries hurt fantasy teams most?", "What happens after a player returns?", "How should injury risk affect draft decisions?"]) {
      assert.ok(html.includes(label), label);
    }
    assert.match(html, /data-scin-tab="q-safer"/);
    assert.match(html, /data-scin-data="\/embed\/injury-impact\/data"/);
    // The six tabs, Overview open, the rest rendered but hidden; the player page's host after them.
    assert.match(html, /data-scin-active="overview"/);
    assert.doesNotMatch(html, /data-tool-tab="history"|Injury history</, "the Injury history tab is retired");
    assert.match(html, /<div class="scin-player-wrap" data-scin-player-wrap><div class="scin-player-host" data-scin-player hidden><\/div><\/div>/, "the player page's host");
    for (const tab of ["overview", "database", "players", "simulator", "methodology", "impact"]) {
      assert.match(html, new RegExp(`data-tool-tab="${tab}"`), `tab ${tab}`);
      assert.match(html, new RegExp(`data-scin-panel="${tab}" role="tabpanel"${tab === "overview" ? ">" : "[^>]* hidden>"}`), `panel ${tab}`);
    }
    for (const label of ["Injury database", "Current players by durability", "Draft simulator", "Methodology", "Most durable players", "Most fantasy points lost", "Durability score (0-100)", "Risk tiers"]) {
      assert.ok(html.includes(label), label);
    }
    assert.ok((html.match(/class="scin-ev-row"/g) ?? []).length === 50, "the first page of injury events");
    for (const col of ["Player", "Season", "ADP", "Week of injury", "Body part", "Type", "Severity", "Games missed", "Weeks out", "Return week", "Season ending", "Impact"]) {
      assert.match(html, new RegExp(`<th scope="col"[^>]*><button[^>]*>${col}<svg`), `event column ${col}`);
    }
    assert.match(html, /class="scin-gm-proj"[^>]*>Proj\. \d+</, "a still-out player's projected return");
    assert.match(html, /<button type="button" class="scin-btn" data-ev-csv title="[^"]*">Download CSV<\/button>/, "the event database's download button");
    assert.match(html, /<button type="button" class="scin-btn" data-rk-csv title="[^"]*">Download CSV<\/button>/, "the current players table's download button");
    assert.match(html, /<td class="is-num">\d{1,2}<\/td><td title=/, "the week of injury is a bare number");
    const evTable = html.slice(html.indexOf("<div data-ev-table>"), html.indexOf("</table>", html.indexOf("<div data-ev-table>")));
    assert.doesNotMatch(evTable, /\bWk \d/, "weeks in the event table are bare numbers");
    assert.ok((html.match(/class="scin-rk-row/g) ?? []).length === 50, "the first page of current players");
    assert.equal((html.match(/data-sim-rm=/g) ?? []).length, 7, "the safe preset roster");
    assert.ok(/class="scin-score is-(iron|moderate|elevated|high)"/.test(html), "scores carry their tier");
    assert.match(html, /What This Means for Fantasy Managers/);
    assert.match(html, /Methodology &amp; Definitions/);
    assert.match(html, /What does an injury-report tag cost that week\?/);
    assert.ok((html.match(/<svg class="scin-svg"/g) ?? []).length >= 8, "the charts are drawn server-side");
    assert.doesNotMatch(html, /—/, "no em dashes");
    assert.doesNotMatch(html, /sleepercdn|espncdn|nflverse/i, "no outside hosts or source names");
    assert.doesNotMatch(html, /scin-page-data/, "the island is for the embed only");
  });

  test("the database page opens the same tool on the Injury database tab", async () => {
    const res = await fetch(`${server.origin}/injury-database`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /<title>NFL Injury Database - StatChasers<\/title>/);
    assert.ok((html.match(/class="scin-ev-row"/g) ?? []).length === 50, "the first page of injury events");
    assert.match(html, /injury events shown/);
    assert.doesNotMatch(html, /scin-db-row|data-tool-tab="history"/, "the retired records table is gone");
    assert.match(html, /data-scin-page="database"/);
    assert.match(html, /data-scin-active="database"/);
    assert.match(html, /data-scin-panel="database" role="tabpanel">/);
    assert.match(html, /data-scin-panel="overview" role="tabpanel" hidden>/);
  });

  test("the fragments have no H1, carry the page words and point at the data", async () => {
    for (const [p, h1] of [
      ["/embed/injury-impact", "Fantasy Football Injury Risk Analysis"],
      ["/embed/injury-database", "NFL Injury Database"],
    ]) {
      const res = await fetch(`${server.origin}${p}`);
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.doesNotMatch(html, /<h1\b/);
      assert.match(html, /class="scin is-embed"/);
      const island = html.match(/<script type="application\/json" class="scin-page-data">(.*?)<\/script>/);
      assert.ok(island, "page-data island");
      const copy = JSON.parse(island[1]);
      assert.equal(copy.h1, h1);
      assert.ok(copy.title && copy.description);
      assert.match(html, /data-scin-data="http:\/\/127\.0\.0\.1:\d+\/embed\/injury-impact\/data"/);
    }
  });

  test("the data slices are the committed files", async () => {
    const a = await fetch(`${server.origin}/embed/injury-impact/data/analysis`);
    assert.equal(a.status, 200);
    assert.match(a.headers.get("content-type") ?? "", /application\/json/);
    const body = await a.json();
    assert.equal(body.analysis.player_injury_impacts.length, analysis.player_injury_impacts.length);
    assert.ok(Array.isArray(body.panel), "the panel rides along, unpacked");
    assert.ok(body.current && Array.isArray(body.current.rows), "and the season in progress");
    const g = await fetch(`${server.origin}/embed/injury-impact/data/gridiron`);
    assert.equal(g.status, 200);
    const gm = await g.json();
    assert.equal(gm.players.length, gridiron.players.length, "the durability dataset, as the file holds it");
    assert.ok(Array.isArray(gm.years) && gm.current && gm.current.season, "with its years and the season in progress");
    const s = await fetch(`${server.origin}/embed/injury-impact/data/search`);
    assert.equal(s.status, 200);
    const idx = await s.json();
    assert.ok(idx.length > 6000);
    const p = await fetch(`${server.origin}/embed/injury-impact/data/player/00-0030228`);
    assert.equal(p.status, 200);
    const slice = await p.json();
    assert.equal(slice.name, "A.J. Bouye");
    assert.ok(slice.rows.length > 0 && slice.inGame.length > 0);
    assert.ok(slice.schedule["2021"]?.CAR, "the schedule for the seasons the player appears in");
    assert.equal((await fetch(`${server.origin}/embed/injury-impact/data/player/nope`)).status, 404);
    assert.equal((await fetch(`${server.origin}/embed/injury-impact/data/player/00-0000000`)).status, 404);
    assert.equal((await fetch(`${server.origin}/embed/injury-impact/data/analysis/x`)).status, 404);
  });

  test("the stylesheet and bundle are served", async () => {
    for (const p of ["/injury-impact.css", "/dist/statchasers-injury-impact.js"]) {
      assert.equal((await fetch(`${server.origin}${p}`)).status, 200, p);
    }
  });
});
