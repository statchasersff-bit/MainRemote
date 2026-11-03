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
  code, slug, nickname, fullName: nickname, primaryColor: "#97233F", secondaryColor: "#FFB612", logo: "",
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
  result: { outcome, teamScore: 24, opponentScore: 17 },
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
const cells = (doc) => [...doc.querySelectorAll(".scp-ox-strip > li")];

describe("overview sections", () => {
  test("the sections in the spec's order, each with an H2 and aria-labelledby", () => {
    const doc = render(state());
    const heads = [...doc.querySelectorAll("section.scp-ox-sec")].map((sec) => {
      const h2 = sec.querySelector("h2");
      assert.equal(sec.getAttribute("aria-labelledby"), h2.id);
      return text(h2);
    });
    // The order of mak's entity brief (2026-11-03): the player's season, the
    // news (here the recaps the log and schedule make), his numbers, then
    // the fantasy read and the rest. The About block needs facts this state
    // does not carry, so it does not render.
    assert.deepEqual(heads, [
      "Jacoby Brissett's 2026 Season, Week by Week",
      "Jacoby Brissett Latest News",
      "Jacoby Brissett 2026 Season Stats",
      "Should You Start or Roster Jacoby Brissett?",
      "Jacoby Brissett Recent Games",
      "Rest-of-Season Outlook and Availability",
      "Jacoby Brissett Career Stats",
      "Jacoby Brissett Fantasy Football FAQ",
    ]);
  });

  test("the season table sums the log the same way the hero does, and links to Stats", () => {
    const doc = render(state(), { playerPathPrefix: "/nfl/players/" });
    const sec = doc.querySelector("#scp-ox-season-h").closest("section");
    assert.equal(text(sec.querySelector(".scp-ox-lede")), "Through Week 3");
    const heads = [...sec.querySelectorAll("thead th")].map(text);
    assert.deepEqual(heads, ["GP", "CMP", "ATT", "PASS YDS", "PASS TD", "INT", "RUSH YDS", "RUSH TD", "PPR PTS", "PPG"]);
    const row = [...sec.querySelectorAll("tbody td")].map(text);
    assert.equal(row[0], "3", "three games played");
    assert.equal(row[8], "49.6", "the fantasy total of the three weeks");
    assert.equal(row[9], "16.5");
    assert.equal(sec.querySelector(".scp-ox-more").getAttribute("href"), "/nfl/players/jacoby-brissett/stats/");
    assert.match(text(sec.querySelector(".scp-ox-more")), /^Complete Jacoby Brissett stats/);
    // Every percentage-free cell is a number or a dash, never NaN.
    for (const cell of row) assert.doesNotMatch(cell, /NaN|undefined/);
    // Not for a season he has not played in.
    assert.equal(render(state({ leagueWeek: 0, gameLog: [], schedule: [] })).querySelector("#scp-ox-season-h"), null);
  });

  test("the news digest is the newest items of the feed, linked to the News tab", () => {
    const doc = render(state(), { playerPathPrefix: "/nfl/players/" });
    const sec = doc.querySelector("#scp-ox-news-h").closest("section");
    const items = [...sec.querySelectorAll(".scp-nw-dg-item")];
    assert.ok(items.length >= 1 && items.length <= 4, `${items.length} items`);
    for (const item of items) {
      assert.ok(item.querySelector("h3 a"), "a headline link");
      assert.ok(item.querySelector(".scp-nw-meta"), "a category and date line");
    }
    assert.equal(sec.querySelector(".scp-ox-more").getAttribute("href"), "/nfl/players/jacoby-brissett/news/");
  });

  test("About: the facts the page can state, nothing fantasy, linked to the Bio tab", () => {
    const doc = render(
      state({
        player: { ...state().player, number: 7 },
        bioPage: {
          quick: [
            { label: "Born", value: "Dec 11, 1992" },
            { label: "Age", value: "33" },
            { label: "Height", value: "6'4\"" },
            { label: "College", value: "NC State" },
            { label: "Jersey No.", value: "7" },
            { label: "Drafted", value: "2016, Rd 3, #91 (NE)" },
          ],
        },
      }),
      { playerPathPrefix: "/nfl/players/", teamPathPrefix: "/nfl/teams/" },
    );
    const sec = doc.querySelector("#scp-ox-about-h").closest("section");
    assert.equal(text(sec.querySelector("h2")), "About Jacoby Brissett");
    const rows = [...sec.querySelectorAll(".scp-ox-about > div")].map((d) => [text(d.querySelector("dt")), text(d.querySelector("dd"))]);
    assert.deepEqual(rows.slice(0, 2), [["Team", ARI.fullName], ["Position", "Quarterback (QB)"]]);
    assert.ok(rows.some(([k, v]) => k === "College" && v === "NC State"));
    assert.equal(rows.filter(([k]) => /jersey|number/i.test(k)).length, 1, "the number once");
    assert.equal(sec.querySelector(".scp-ox-about a").getAttribute("href"), "/nfl/teams/arizona-cardinals/");
    assert.equal(sec.querySelector(".scp-ox-more").getAttribute("href"), "/nfl/players/jacoby-brissett/bio/");
    assert.doesNotMatch(text(sec), /fantasy|PPR|start/i);
    // Without facts the block is left out rather than printed with two rows.
    assert.equal(render(state()).querySelector("#scp-ox-about-h"), null);
  });

  test("the strip: seven cells, three played then upcoming, home and away from the schedule", () => {
    const doc = render(state());
    const all = cells(doc);
    assert.equal(all.length, 7);
    assert.equal(all.filter((c) => c.classList.contains("is-future")).length, 4);
    // Three lines a card (mak, 2026-10-23): week and opponent, points and
    // finish, the result.
    assert.equal(spoken(all[0]), "Week 1, at LAC, 16.5, QB15, Win");
    assert.equal(text(all[1].querySelector(".scp-ox-wk-opp")), "vs SEA");
    assert.ok(all[2].querySelector(".scp-ox-wk-pts.is-best"), "the best week's points are gold");
    assert.equal(all[0].querySelector(".scp-ox-wk-res").className, "scp-ox-wk-res is-w");
    assert.equal(all[1].querySelector(".scp-ox-wk-fin").className, "scp-ox-wk-fin is-bad");
    assert.equal(all[0].querySelector(".scp-ox-wk-bar"), null, "no bar");
    assert.ok(all[3].classList.contains("is-next"));
    assert.equal(text(all[3].querySelector(".scp-ox-chip")), "Favorable");
    // The matchup rank reads "8th vs QB" on the number line; no date, no link.
    assert.equal(spoken(all[3]), "Up next. Week 4, vs NYG, 8th vs QB, Favorable");
    assert.equal(all[3].querySelector(".scp-ox-wk-link"), null, "no opponent link under the card");
    assert.equal(
      text(doc.querySelector(".scp-ox-lede")),
      "3 games played: one top-5 week, one mid-range start and one bust. The next four matchups include two of the league's softest pass defenses.",
    );
  });

  test("the strip never guesses home or away without a schedule", () => {
    const doc = render(state({ schedule: [] }));
    assert.equal(text(cells(doc)[0].querySelector(".scp-ox-wk-opp")), "LAC");
  });

  test("a bye takes a cell", () => {
    const strip = [4, 6, 7].map((w) => upcoming(w, 10));
    const doc = render(state({ byeWeek: 5, upcomingStrip: strip, upcoming: strip }));
    const bye = cells(doc).find((c) => c.classList.contains("is-bye"));
    assert.ok(bye);
    assert.equal(spoken(bye), "Week 5, Bye, No game");
  });

  test("preseason: seven upcoming, no meters, no game log, the outlook is the read", () => {
    const doc = render(state({ leagueWeek: 0, season: 2025, gameLog: [], schedule: [] }));
    assert.equal(cells(doc).length, 7);
    assert.equal(cells(doc).filter((c) => c.querySelector(".scp-ox-wk-pts")).length, 0, "nothing played");
    assert.equal(doc.querySelector(".scp-ox-meters"), null);
    assert.equal(doc.querySelector("#scp-ox-log-h"), null);
    assert.ok(text(doc.querySelector(".scp-ox-prose")).includes("Arizona hands him the keys"), "the outlook is the read");
  });

  test("season over: the final seven played weeks", () => {
    const log = Array.from({ length: 17 }, (_, i) => entry(i + 1, 10 + i, 10));
    const doc = render(state({
      leagueWeek: 18, gameLog: log, schedule: log.map((e) => final(e.week)),
      upcoming: [], upcomingStrip: [], byeWeek: null,
    }));
    const weeks = cells(doc).map((c) => spoken(c.querySelector(".scp-ox-wk-w")));
    assert.deepEqual(weeks, ["Week 11", "Week 12", "Week 13", "Week 14", "Week 15", "Week 16", "Week 17"]);
  });

  test("an injured player: the injury card leads, the next cell says Out, the FAQ says so", () => {
    const doc = render(state({ designation: { injuryStatus: "IR" } }));
    const cards = [...doc.querySelectorAll(".scp-ox-card h3")].map(text);
    assert.deepEqual(cards, ["Injury status", "Outlook"]);
    assert.equal(text(doc.querySelector(".scp-ox-status")), "Injured reserve");
    assert.ok(doc.querySelector(".scp-ox-status").classList.contains("is-bad"));
    const next = doc.querySelector(".scp-ox-wk.is-next");
    assert.ok([...next.querySelectorAll(".scp-ox-chip")].some((c) => text(c) === "Out"));
    assert.match(text(doc.querySelector(".scp-ox-faq details p")), /^No: Jacoby Brissett is on injured reserve for Week 4 .+, so he should sit\./);
    // Injury questions are the Injury tab's (faq-engine.ts): none here.
    assert.ok(![...doc.querySelectorAll(".scp-ox-faq summary")].some((q) => /injured/i.test(text(q))));
  });

  test("below the percentile threshold: no meters and no efficiency clause", () => {
    const doc = render(state({ meters: { ...state().meters, meters: null } }));
    assert.equal(doc.querySelector(".scp-ox-meters"), null);
    assert.doesNotMatch(text(doc.querySelector(".scp-ox-prose")), /percentile/);
  });

  test("the read is one paragraph with the meters under it (mak, 2026-10-23)", () => {
    const doc = render(state());
    const paras = [...doc.querySelectorAll(".scp-ox-prose p")].map(text);
    assert.equal(paras.length, 1);
    assert.match(paras[0], /^Brissett is a QB2\/streaming option\. He is QB17 at 16\.5 PPR PPG, supported by an 81st-percentile completion rate but limited by 6th-percentile yards per attempt\. His best upcoming spot is the \w+ in Week 5, while the \w+ in Week 7 is a tougher matchup\.$/);
    // The four meter cards sit under the paragraph, with no section of their own.
    const meters = doc.querySelectorAll(".scp-ox-read .scp-ox-meters .scp-ox-meter");
    assert.equal(meters.length, 4);
    assert.equal(doc.querySelector("#scp-ox-meters-h"), null);
    assert.equal(doc.querySelector(".scp-ox-kicker"), null, "the rates line is gone");
    // One sidebar card: the profile rows, then the button. No dynasty line.
    const panels = [...doc.querySelectorAll(".scp-ox-aside .scp-ox-panel")];
    assert.equal(panels.length, 1);
    assert.equal(text(panels[0].querySelector("h3")), "Fantasy profile");
    const rows = [...panels[0].querySelectorAll("dt")].map(text);
    assert.deepEqual(rows, ["Role", "Typical week", "Floor", "Ceiling", "Top-12 weeks", "TD scoring"]);
    assert.equal(text(panels[0].querySelector(".scp-ox-btn")), "Open in Redraft Command");
    assert.equal(doc.querySelector(".scp-ox-trade"), null, "the dynasty value line is gone");
    assert.equal(doc.querySelector("[data-cta^='dynasty']"), null);
  });

  test("weekly points agree across the strip, the game log total and the career row", () => {
    const doc = render(state());
    const strip = cells(doc)
      .map((c) => c.querySelector(".scp-ox-wk-pts"))
      .filter(Boolean)
      .reduce((sum, el) => sum + Number(el.textContent), 0);
    // The Game Log tab's table classes since 2026-09-30; totals in a <tfoot>.
    const log = doc.querySelector("table.scp-table--filled.scp-ox-log");
    const careerTable = doc.querySelector("table.scp-table--filled.scp-ox-career");
    assert.equal(log.querySelector("caption"), null, "no scoring caption");
    const logTotal = Number(text(log.querySelector("tfoot tr.scp-total td:nth-child(4)")));
    const season = Number(text(careerTable.querySelector("tr.is-cur td:nth-child(8)")));
    assert.equal(logTotal.toFixed(1), strip.toFixed(1));
    assert.equal(season.toFixed(1), logTotal.toFixed(1), "the career table's current row is the log's sum");
    assert.equal(text(log.querySelector("tfoot tr.scp-total td:nth-child(3)")), "1–2");
    // Weekly finishes are the Game Log's tier pills.
    assert.ok(log.querySelector("tbody td.scp-col-fin .scp-tier[data-tier]"));
  });

  test("career totals are summed from the season rows", () => {
    const doc = render(state());
    const career = doc.querySelector(".scp-ox-career tfoot tr.scp-total");
    const tds = [...career.querySelectorAll("td")].map(text);
    // GP, pass yds, TD, INT, rush yds, pts, PPG
    assert.equal(tds[1], String(3 + 14 + 8));
    assert.equal(tds[2], (660 + 3366 + 826).toLocaleString("en-US"));
    assert.equal(tds[6], ((49.6 + 235.4 + 46.2)).toFixed(1));
    assert.equal(tds[7], ((49.6 + 235.4 + 46.2) / 25).toFixed(1));
  });

  test("a traded player's season row names both clubs", () => {
    const doc = render(state({ seasonClubs: { 2026: ["ARI", "NYJ"], 2025: ["ARI"], 2024: ["NE"] } }));
    assert.equal(text(doc.querySelector(".scp-ox-career tr.is-cur td")), "ARI/NYJ");
  });

  test("the Redraft Command links carry the player and their tags", () => {
    const doc = render(state());
    const tags = [...doc.querySelectorAll("[data-cta^='redraft-command']")].map((el) => [
      el.getAttribute("data-cta"),
      el.getAttribute("href"),
    ]);
    // The prose link went with the four paragraphs (mak, 2026-10-23).
    assert.deepEqual(tags.map(([t]) => t), ["redraft-command-sidebar"]);
    for (const [, href] of tags) assert.match(href, /\?player=jacoby-brissett/);
    assert.equal(doc.querySelector(".scp-ox-peers"), null, "the spec's peers section is gone");
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
    assert.equal(doc.querySelector(".scp-ox-byline"), null);
    assert.equal(doc.querySelector("footer"), null);
    const rail = doc.querySelector("body > .scp-peers");
    assert.ok(rail, "the rail stands between the Overview's sections and its FAQ");
    assert.ok(rail.previousElementSibling.matches(".scp-ox"));
    assert.equal(
      rail.nextElementSibling.firstElementChild.getAttribute("aria-labelledby"),
      "scp-faq-overview-h",
      "directly above the FAQ",
    );
  });
});
