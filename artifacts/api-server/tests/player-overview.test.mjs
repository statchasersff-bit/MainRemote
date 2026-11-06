/**
 * The Overview tab's lower sections, rendered against hand-built states.
 *
 * Like tests/player-header.test.mjs: the states the spec lists - preseason, a
 * bye, an injured player, a traded one, one below the percentile threshold -
 * are not reliably on the roster on any given day, so they are built here.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const ov = await importModule("lib/player/overview");

after(cleanupBundles);

const team = (code, slug, nickname) => ({
  code, slug, nickname, fullName: nickname, primaryColor: "#97233F", secondaryColor: "#FFB612", logo: `/team-logos/${code.toLowerCase()}.svg`,
});
const ARI = team("ARI", "arizona-cardinals", "Cardinals");
const LAC = team("LAC", "los-angeles-chargers", "Chargers");
const SEA = team("SEA", "seattle-seahawks", "Seahawks");
const SF = team("SF", "san-francisco-49ers", "49ers");
const NYG = team("NYG", "new-york-giants", "Giants");
const OPPS = [LAC, SEA, SF, NYG, LAC, SEA, SF, NYG, LAC, SEA, SF, NYG, LAC, SEA, SF, NYG, LAC];

const entry = (week, pts, rank) => ({
  week, opp: OPPS[week - 1].code, team: "ARI", game_status: "active", pos_rank: rank,
  stats: { pts_ppr: pts, pass_att: 30, pass_cmp: 20, pass_yd: 220, pass_td: 2, pass_int: 1, rush_att: 3, rush_yd: 10 },
});

const final = (week, outcome = "W") => ({
  week, seasonType: "regular", status: "final", homeAway: week % 2 ? "away" : "home",
  opponent: OPPS[week - 1], opponentName: OPPS[week - 1].fullName,
  result: { outcome, teamScore: 24, opponentScore: 17 }, kickoffMs: Date.UTC(2026, 8, 6 + (week - 1) * 7, 17),
});

const upcoming = (week, rank) => ({
  week, homeAway: week % 2 ? "away" : "home", opponent: OPPS[week - 1], opponentCode: OPPS[week - 1].code,
  opponentName: OPPS[week - 1].fullName, kickoffMs: Date.UTC(2026, 9, week, 17), timeConfirmed: true,
  matchup: rank ? { rank, fpa: 20, position: "QB" } : null,
});

function state(overrides = {}) {
  const log = [entry(1, 16.5, 15), entry(2, 7.5, 28), entry(3, 25.6, 4)];
  return {
    player: { id: "1", slug: "jacoby-brissett", name: "Jacoby Brissett", position: "QB", injury_status: null },
    team: ARI,
    format: "ppr",
    season: 2026,
    leagueSeason: 2026,
    leagueWeek: 3,
    byeWeek: 8,
    gameLog: log,
    schedule: [final(1), final(2, "L"), final(3, "L")],
    upcoming: [upcoming(4, 8), upcoming(5, 1), upcoming(6, 20), upcoming(7, 22)],
    upcomingStrip: [4, 5, 6, 7, 9, 10, 11].map((w, i) => upcoming(w, [8, 1, 20, 22, 30, 5, 12][i])),
    upcomingMatchupMode: "Week 3",
    production: [
      { season: 2026, posFinishPpg: 17, gamesPlayed: 3, total: 49.6, ppg: 16.5 },
      { season: 2025, posFinishTotal: 16, gamesPlayed: 14, total: 235.4, ppg: 16.8 },
    ],
    seasonRank: 17,
    statsProfile: {
      career: [
        { season: 2026, gamesPlayed: 3, points: 49.0, ppg: 16.3, finish: 17, totals: { passYd: 660, passTd: 6, passInt: 3, rushYd: 30 } },
        { season: 2025, gamesPlayed: 14, points: 235.4, ppg: 16.8, finish: 16, totals: { passYd: 3366, passTd: 23, passInt: 8, rushYd: 168 } },
        { season: 2024, gamesPlayed: 8, points: 46.2, ppg: 5.8, finish: 46, totals: { passYd: 826, passTd: 2, passInt: 1, rushYd: 62 } },
      ],
    },
    seasonClubs: { 2026: ["ARI"], 2025: ["ARI"], 2024: ["NE"] },
    meters: {
      position: "QB", season: 2026, threshold: 45, unit: "pass attempts", qualified: 30,
      meters: [
        { key: "cmp", label: "Completion rate", value: "70.1%", percentile: 81 },
        { key: "ypa", label: "Yards per attempt", value: "5.6", percentile: 6 },
        { key: "tdr", label: "TD rate", value: "3.4%", percentile: 25 },
        { key: "ppp", label: "Fantasy points per play", value: "0.39", percentile: 45 },
      ],
    },
    teammates: [{ name: "Trey McBride", slug: "trey-mcbride", position: "TE" }],
    depth: { position: "QB", order: 1, next: { name: "Gardner Minshew II", slug: "gardner-minshew" } },
    fantasyOutlook2026: { body: "Last year.\n\nArizona hands him the keys again. He has one job." },
    injury: {
      seasonMissed: 0,
      summary: { totalMissed: 11 },
      history: { nfl: [{ season: 2024, type: "Injury", bodyPart: "Shoulder", side: "Right", gamesMissed: 0 }] },
    },
    designation: null,
    peers: {
      position: "QB", season: 2026, format: "ppr", measure: "total",
      rows: [14, 15, 16, 17, 18, 19, 20].map((rank) => ({
        slug: rank === 17 ? "jacoby-brissett" : `qb-${rank}`, name: `QB ${rank}`, team: ARI, rank,
        value: 60 - rank, isCurrent: rank === 17,
      })),
    },
    tdDependency: { pct: 44 },
    rosterFetchedAt: Date.UTC(2026, 8, 29, 11),
    ...overrides,
  };
}

function render(data, options = {}, extras = {}) {
  const html = ov.renderOverviewSections(data, options, extras);
  return new JSDOM(`<body>${html}</body>`).window.document;
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** What a screen reader hears: the text with aria-hidden parts removed. */
function spoken(el) {
  const copy = el.cloneNode(true);
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return text(copy);
}
const cols = (doc) => [...doc.querySelectorAll(".scp-ow-cols > li")];
const games = (doc) => [...doc.querySelectorAll(".scp-ow-games > li")];

describe("overview sections (mak's Overview redesign, 2026-11-05)", () => {
  test("five sections in the brief's order, each with an H2 and aria-labelledby", () => {
    const doc = render(state({
      bioPage: { quick: [{ label: "Birthplace", value: "Miami, FL" }, { label: "High school", value: "Dwyer (FL)" }, { label: "Pro Bowls", value: "1" }], superBowls: [], raw: { draft: { year: 2016, round: 3, pick: 91, team: "NE" }, undrafted: null } },
      news: [{ id: "n1", title: "Jacoby Brissett: Named starter", summary: "The club named him the starter for Week 4.", category: "depth-chart", pubDateMs: Date.UTC(2026, 9, 1, 15), source: "Wire", link: "https://example.com/n1" }],
    }), { now: Date.UTC(2026, 9, 2) });
    const heads = [...doc.querySelectorAll("section.scp-ox-sec")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      return text(h2);
    });
    assert.deepEqual(heads, [
      "Jacoby Brissett 2026 Season Stats",
      "Jacoby Brissett Weekly Performance & Upcoming Schedule",
      "Jacoby Brissett Fantasy Outlook & Efficiency",
      "Jacoby Brissett Latest News",
      "Jacoby Brissett Career & Background",
      "Jacoby Brissett Fantasy Football FAQ",
    ]);
  });

  test("the old duplicate sections do not render", () => {
    const doc = render(state());
    for (const sel of [".scp-ox-strip", ".scp-ox-log", ".scp-ox-career", ".scp-ox-profile", ".scp-ox-meters", ".scp-ox-inj", ".scp-ox-two", "table"]) {
      assert.equal(doc.querySelector(sel), null, `${sel} is gone`);
    }
    assert.doesNotMatch(text(doc.body), /Typical week|Recent Games|Rest-of-Season Outlook and Availability|Active, no designation/);
  });

  test("season stats: the log's totals by position, no PPG, linked to Stats", () => {
    const doc = render(state(), { playerPathPrefix: "/nfl/players/" });
    const sec = doc.querySelector("#scp-ox-season-h").closest("section");
    const labels = [...sec.querySelectorAll(".scp-ox-stat dt")].map(text);
    assert.deepEqual(labels, ["GP", "CMP", "ATT", "PASS YDS", "PASS TD", "INT", "RUSH YDS", "RUSH TD", "FPTS"]);
    const values = [...sec.querySelectorAll(".scp-ox-stat dd")].map(text);
    assert.equal(values[0], "3");
    assert.equal(values[8], "49.6", "the three weeks' fantasy total");
    for (const v of values) assert.doesNotMatch(v, /NaN|undefined/);
    assert.ok(sec.querySelector(".scp-ox-season.is-c5"), "nine stats sit five to a row on phones");
    assert.equal(sec.querySelector(".scp-ox-more").getAttribute("href"), "/nfl/players/jacoby-brissett/stats/");
    // A receiver gets receiving columns, not a quarterback's.
    const wr = render(state({ player: { ...state().player, position: "WR" } }));
    assert.ok([...wr.querySelectorAll(".scp-ox-stat dt")].map(text).includes("TGT"));
    assert.ok(![...wr.querySelectorAll(".scp-ox-stat dt")].map(text).includes("CMP"));
    assert.equal(render(state({ leagueWeek: 0, gameLog: [], schedule: [] })).querySelector("#scp-ox-season-h"), null);
  });

  test("weekly chart: one bar per played week, the bye a gap not a zero, future weeks never bars", () => {
    const doc = render(state({ byeWeek: 2, schedule: [final(1), final(3, "L")], gameLog: [entry(1, 16.5, 15), entry(3, 25.6, 4)], leagueWeek: 3 }));
    const c = cols(doc);
    assert.deepEqual(c.map((li) => text(li.querySelector(".scp-ow-x"))), ["1", "2", "3"]);
    assert.ok(c[1].matches(".is-bye"));
    assert.equal(c[1].querySelector(".scp-ow-bar"), null);
    assert.ok(c[2].matches(".is-hit"), "a QB4 week is a top-12 week");
    assert.ok(!c[0].matches(".is-hit"));
    assert.match(text(c[2].querySelector(".scp-ow-tip")), /Week 3 at 49ers.*25\.6 fantasy points.*QB4 that week.*Lost 24-17/);
    // The average is over games played: (16.5 + 25.6) / 2.
    assert.match(text(doc.querySelector(".scp-ow-avg")), /Avg 21\.1/);
    // A QB's points are "fantasy", never "PPR".
    assert.doesNotMatch(text(doc.querySelector(".scp-ow-chart")), /PPR/);
  });

  test("weekly chart: an absence is marked Out, and a logged game the slate has not finalized is still a bar", () => {
    const log = [entry(1, 16.5, 15), { ...entry(2, 0, null), game_status: "out", stats: {} }, entry(3, 25.6, 4)];
    const doc = render(state({ gameLog: log, schedule: [final(1), final(2)] }));
    const c = cols(doc);
    assert.ok(c[1].matches(".is-dnp"));
    assert.equal(text(c[1].querySelector(".scp-ow-mark")), "Out");
    assert.ok(c[2].matches(".is-played"), "week 3 comes from the log");
  });

  test("upcoming: the next four games with the bye in place, the grade from the shared bands", () => {
    const doc = render(state({ byeWeek: 6, upcoming: [upcoming(4, 8), upcoming(5, 15), upcoming(7, 25), upcoming(9, 3)] }));
    const g = games(doc);
    assert.deepEqual(g.map((li) => spoken(li.querySelector(".scp-ow-gw"))), ["Week 4", "Week 5", "Week 6", "Week 7", "Week 9"]);
    assert.ok(g[0].matches(".is-next"));
    assert.equal(text(g[0].querySelector(".scp-ox-chip")), "Favorable");
    assert.equal(text(g[1].querySelector(".scp-ox-chip")), "Neutral");
    assert.ok(g[2].matches(".is-bye"));
    assert.equal(text(g[3].querySelector(".scp-ox-chip")), "Tough");
    assert.match(spoken(g[3]), /at SF|at NYG|at /, "away games read as 'at'");
    assert.match(text(doc.querySelector(".scp-ow-next .scp-ow-note")), /1st allows the most/);
  });

  test("fantasy outlook: one recommendation from the PPG rank, one paragraph, the efficiency rows", () => {
    const doc = render(state());
    const sec = doc.querySelector("#scp-ox-read-h").closest("section");
    assert.equal(sec.querySelectorAll(".scp-ox-call").length, 1);
    assert.match(text(sec.querySelector(".scp-ox-call")), /^Recommendation: QB2 \/ streaming option QB17 by points per game, 3 games$/);
    assert.equal(sec.querySelectorAll(".scp-ox-prose").length, 1, "one paragraph");
    const para = text(sec.querySelector(".scp-ox-prose"));
    assert.match(para, /QB17 in fantasy points per game \(16\.5\)/);
    assert.match(para, /top-12 QB in one of three games/);
    assert.match(para, /completion rate \(81st percentile\) is a strength; his yards per attempt \(6th percentile\)/);
    const words = para.split(/\s+/).length;
    assert.ok(words >= 30 && words <= 90, `${words} words`);
    assert.equal(sec.querySelectorAll(".scp-ox-eff").length, 4);
    assert.doesNotMatch(text(sec), /Typical week|Floor|Ceiling|TD scoring/);
    assert.equal(sec.querySelector("[data-cta='redraft-command-sidebar']").getAttribute("href"), "https://statchasers.com/redraft-command/?player=jacoby-brissett");
  });

  test("fantasyCall: position-specific labels", () => {
    assert.equal(ov.fantasyCall("QB", 3, 90).label, "Elite starter");
    assert.equal(ov.fantasyCall("QB", 11, 90).label, "Weekly starter");
    assert.equal(ov.fantasyCall("QB", 17, 40).label, "QB2 / streaming option");
    assert.equal(ov.fantasyCall("WR", 30, 60).label, "Flex consideration");
    assert.equal(ov.fantasyCall("TE", 15, 60).label, "Streaming option");
    assert.equal(ov.fantasyCall("RB", 70, 80).label, "Bench depth");
    assert.equal(ov.fantasyCall("RB", 70, 10).label, "Waiver consideration");
    assert.equal(ov.fantasyCall("WR", 70, null).label, "Waiver consideration");
  });

  test("preseason: no stats, no chart, the outlook's take is the read, four games ahead", () => {
    const doc = render(state({ leagueWeek: 0, gameLog: [], schedule: [] }));
    assert.equal(doc.querySelector(".scp-ow-chart"), null);
    assert.equal(doc.querySelector(".scp-ox-call"), null);
    assert.equal(text(doc.querySelector(".scp-ox-prose")), "Last year.");
    assert.equal(games(doc).length, 4);
  });

  test("the injury alert: only with something the header pill does not say", () => {
    assert.equal(render(state()).querySelector(".scp-ox-alert"), null, "healthy: nothing");
    assert.equal(render(state({ designation: { injuryStatus: "Questionable", injuryBodyPart: null, practice: null } })).querySelector(".scp-ox-alert"), null, "the pill alone");
    const doc = render(state({ designation: { injuryStatus: "Questionable", injuryBodyPart: "Hamstring", practice: "Limited Participation in Practice" } }));
    const alert = doc.querySelector(".scp-ox-alert");
    assert.equal(text(alert.querySelector(".scp-ox-alert-h")), "Questionable - Hamstring");
    assert.match(text(alert), /limited participation/);
    assert.ok(alert.querySelector("a[href$='/injury/']"));
    const ir = render(state({ designation: { injuryStatus: "IR", injuryBodyPart: "Calf", practice: null } }));
    assert.equal(text(ir.querySelector(".scp-ox-alert-h")), "Injured reserve - Calf");
    assert.match(text(ir.querySelector(".scp-ox-prose")), /on injured reserve/);
    assert.equal(text(ir.querySelector(".scp-ow-g.is-next .scp-ox-chip")), "Out");
  });

  test("news: recaps and postgame notes are left out, at most three, hidden when none qualify", () => {
    const at = (d) => Date.UTC(2026, 9, d, 15);
    const item = (id, category, d) => ({ id, title: `Item ${id}`, summary: `Summary ${id}.`, category, pubDateMs: at(d), source: "Wire", link: `https://example.com/${id}` });
    const now = { now: Date.UTC(2026, 9, 20) };
    const withNews = (news) => render(state({ news }), now);
    // Only the recaps the log makes: no section.
    assert.equal(withNews([]).querySelector("#scp-ox-news-h"), null);
    const doc = withNews([item("a", "injury", 10), item("b", "practice", 11), item("c", "transaction", 12), item("d", "depth-chart", 13), item("e", "recap", 14)]);
    const rows = [...doc.querySelectorAll("#scp-ox-news-h ~ .scp-nw .scp-nw-dg-item")];
    assert.equal(rows.length, 3);
    for (const r of rows) assert.notEqual(r.getAttribute("data-type"), "game");
    assert.match(text(rows[0]), /Item d/, "newest first");
    // Older than 30 days: out.
    assert.equal(render(state({ news: [item("old", "injury", 1)] }), { now: Date.UTC(2026, 10, 20) }).querySelector("#scp-ox-news-h"), null);
  });

  test("news: an uncategorized wire note inside 48 hours of a game he played is the recap, and is left out", () => {
    const kick = Date.UTC(2026, 8, 20, 17); // week 3's kickoff in the fixture
    const note = (id, ms) => ({ id, title: `Note ${id}`, summary: "", category: "other", pubDateMs: ms, source: "Wire", link: `https://example.com/${id}` });
    const doc = render(state({ news: [note("post", kick + 5 * 3_600_000), note("mid", kick + 4 * 86_400_000)] }), { now: Date.UTC(2026, 9, 2) });
    const rows = [...doc.querySelectorAll(".scp-nw-dg-item")].map(text);
    assert.equal(rows.length, 1);
    assert.match(rows[0], /Note mid/);
  });

  test("career & background: honors, career line, no header facts, links to Stats and Bio", () => {
    const doc = render(
      state({
        bioPage: {
          quick: [
            { label: "Born", value: "Dec 11, 1992" }, { label: "Birthplace", value: "Miami, FL" }, { label: "Age", value: "33" },
            { label: "Height", value: "6'4\"" }, { label: "College", value: "NC State" }, { label: "Jersey", value: "No. 7" },
            { label: "Drafted", value: "2016, Rd 3, #91 (NE)" }, { label: "Pro Bowls", value: "1" }, { label: "All-Pro", value: "2" },
          ],
          superBowls: [{ season: 2016, name: "LI", team: "NE" }],
          raw: { draft: { year: 2024, round: 3, pick: 91, team: "NE" }, undrafted: null },
        },
      }),
      { playerPathPrefix: "/nfl/players/" },
    );
    const sec = doc.querySelector("#scp-ox-about-h").closest("section");
    assert.deepEqual([...sec.querySelectorAll(".scp-ox-honors li")].map(text), ["Super Bowl LI champion", "1 Pro Bowl", "2x All-Pro"]);
    const facts = [...sec.querySelectorAll(".scp-ox-about dt")].map(text);
    assert.deepEqual(facts, ["Born", "Birthplace", "Drafted by"]);
    assert.match(text(sec.querySelector(".scp-ox-career-line")), /25 games, 4,852 passing yards, 31 passing TD \(2024-2026\)/);
    assert.deepEqual([...sec.querySelectorAll(".scp-ox-links a")].map((x) => x.getAttribute("href")), ["/nfl/players/jacoby-brissett/stats/", "/nfl/players/jacoby-brissett/bio/"]);
    assert.doesNotMatch(text(sec), /fantasy|PPR/i);
  });

  test("the career line is left out when the rows do not reach his first season", () => {
    const doc = render(state({ bioPage: { quick: [{ label: "Born", value: "x" }, { label: "Birthplace", value: "y" }], superBowls: [], raw: { draft: { year: 2016, round: 3, pick: 91, team: "NE" }, undrafted: null } } }));
    assert.equal(doc.querySelector(".scp-ox-career-line"), null);
  });

  test("the Redraft Command link carries the player", () => {
    const doc = render(state());
    const tags = [...doc.querySelectorAll("[data-cta^='redraft-command']")].map((el) => el.getAttribute("data-cta"));
    assert.deepEqual(tags, ["redraft-command-sidebar"]);
  });

  test("the FAQ is in the HTML, first one open, and goes to the schema word for word", () => {
    const sink = [];
    const doc = render(state(), { faqSink: sink });
    const details = [...doc.querySelectorAll(".scp-ox-faq details")];
    assert.equal(details.length, 5);
    assert.ok(details[0].open);
    assert.deepEqual(
      details.map((d) => ({ question: text(d.querySelector("summary")), answer: text(d.querySelector("p")) })),
      sink,
    );
    assert.equal(sink[0].question, "Should I start Jacoby Brissett in Week 4?");
  });

  test("no byline and no footer; the peers rail stands above the FAQ", () => {
    const doc = render(state(), {}, { peers: '<section class="scp-peers">rail</section>' });
    assert.equal(doc.querySelector("footer"), null);
    const rail = doc.querySelector("body > .scp-peers");
    assert.ok(rail.previousElementSibling.matches(".scp-ox"));
    assert.equal(rail.nextElementSibling.firstElementChild.getAttribute("aria-labelledby"), "scp-faq-overview-h");
  });
});
