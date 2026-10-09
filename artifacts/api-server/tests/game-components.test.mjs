/**
 * The recap page's game components: fantasy points, the leaders strip and the
 * scoring summary, plus the ESPN reading that feeds them.
 *
 * Driven with plain objects in the shape the page builds, so nothing here
 * depends on what ESPN serves the day the suite runs. The main case is the
 * 2021 NFC Wild Card, Cardinals at Rams, 11–34: the stat lines are the
 * players' real ones; the scoring plays' clocks are illustrative.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { fantasyPoints } = await importModule("lib/matchup/fantasy-points");
const { parseEspnScoringPlay } = await importModule("lib/matchup/scoring-plays");
const players_ = await importModule("lib/matchup/game-players");
const strip = await importModule("lib/matchup/leaders-strip");
const summary = await importModule("lib/matchup/scoring-summary");
const box = await importModule("lib/matchup/boxscore");
after(() => cleanupBundles());

const team = (abbr, name, short, quarters, ot = null) => ({ abbr, name, short, quarters, ot });

const WILD_CARD = {
  status: "final",
  seasonLabel: "2021",
  gameType: "playoff",
  roundLabel: "NFC Wild Card",
  kickoff: "2022-01-18T01:15:00Z",
  venue: null,
  away: team("ARI", "Arizona Cardinals", "Cardinals", [0, 0, 8, 3]),
  home: team("LAR", "Los Angeles Rams", "Rams", [7, 14, 10, 3]),
};

const raw = (period, clock, abbr, text, typeText = "") => ({
  period: { number: period },
  clock: { displayValue: clock },
  team: { abbreviation: abbr },
  text,
  type: { text: typeText },
});

const RAW_PLAYS = [
  raw(1, "3:50", "LAR", "Odell Beckham Jr. 4 Yd pass from Matthew Stafford (Matt Gay Kick)", "Passing Touchdown"),
  raw(2, "13:18", "LAR", "Matthew Stafford 1 Yd Run (Matt Gay Kick)", "Rushing Touchdown"),
  raw(2, "7:59", "LAR", "David Long Jr. 3 Yd Interception Return (Matt Gay Kick)", "Interception Return Touchdown"),
  raw(3, "11:04", "LAR", "Cooper Kupp 7 Yd pass from Matthew Stafford (Matt Gay Kick)", "Passing Touchdown"),
  raw(3, "4:11", "ARI", "James Conner 2 Yd Run (Kyler Murray Pass to Antoine Wesley for Two-Point Conversion)", "Rushing Touchdown"),
  raw(3, "0:25", "LAR", "Matt Gay 36 Yd Field Goal", "Field Goal Good"),
  raw(4, "10:13", "ARI", "Matt Prater 55 Yd Field Goal", "Field Goal Good"),
  raw(4, "5:03", "LAR", "Matt Gay 23 Yd Field Goal", "Field Goal Good"),
];
const PLAYS = RAW_PLAYS.map(parseEspnScoringPlay);

const BOX = [
  { espnId: "1", name: "Matthew Stafford", team: "LAR", pos: "QB", stats: { passCmp: 13, passAtt: 17, passYds: 202, passTd: 2, passInt: 0, rushAtt: 6, rushYds: 22, rushTd: 1, fumblesLost: 0 } },
  { espnId: "2", name: "Cooper Kupp", team: "LAR", pos: "WR", stats: { rec: 5, recTgt: 5, recYds: 61, recTd: 1 } },
  { espnId: "3", name: "Odell Beckham Jr.", team: "LAR", pos: "WR", stats: { rec: 4, recTgt: 5, recYds: 54, recTd: 1, passCmp: 1, passAtt: 1, passYds: 40 } },
  { espnId: "4", name: "Cam Akers", team: "LAR", pos: "RB", stats: { rushAtt: 17, rushYds: 61, rec: 2, recYds: 11 } },
  { espnId: "5", name: "Matt Gay", team: "LAR", pos: null, stats: { fgm: 2, fga: 2, xpm: 4 } },
  { espnId: "6", name: "David Long Jr.", team: "LAR", pos: "CB", stats: { soloTkl: 1, astTkl: 0, sacks: 0, defInt: 1, defTd: 0, passDef: 1 } },
  { espnId: "7", name: "Aaron Donald", team: "LAR", pos: "DT", stats: { soloTkl: 3, astTkl: 1, sacks: 1 } },
  { espnId: "8", name: "Kyler Murray", team: "ARI", pos: "QB", stats: { passCmp: 19, passAtt: 34, passYds: 137, passTd: 0, passInt: 2, rushAtt: 6, rushYds: 6 } },
  { espnId: "9", name: "Christian Kirk", team: "ARI", pos: "WR", stats: { rec: 6, recTgt: 9, recYds: 51 } },
  { espnId: "10", name: "James Conner", team: "ARI", pos: "RB", stats: { rushAtt: 12, rushYds: 15, rushTd: 1, rec: 1, recYds: 9 } },
  { espnId: "11", name: "Antoine Wesley", team: "ARI", pos: "WR", stats: { rec: 2, recYds: 18 } },
  { espnId: "12", name: "Matt Prater", team: "ARI", pos: "K", stats: { fgm: 1, fga: 1 } },
  { espnId: "13", name: "Budda Baker", team: "ARI", pos: "S", stats: { soloTkl: 9, astTkl: 2 } },
];
const PLAYERS = players_.buildGamePlayers(BOX, null, PLAYS);
const byName = (name) => Object.values(PLAYERS).find((p) => p.name === name);

const URLS = {
  "Matthew Stafford": "/nfl/players/matthew-stafford/",
  "Cooper Kupp": "/nfl/players/cooper-kupp/",
  "Odell Beckham Jr.": "/nfl/players/odell-beckham/",
  "James Conner": "/nfl/players/james-conner/",
};
const playerUrl = (name) => URLS[name] ?? null;

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document;

describe("fantasy points", () => {
  const cases = [
    ["Matthew Stafford", 24.3, 24.3],
    ["Cooper Kupp", 12.1, 17.1],
    ["Odell Beckham Jr.", 13.0, 17.0],
    ["Christian Kirk", 5.1, 11.1],
    ["James Conner", 8.4, 9.4],
  ];
  for (const [name, standard, ppr] of cases) {
    test(`${name}: ${standard} standard, ${ppr} PPR`, () => {
      const p = byName(name);
      assert.equal(fantasyPoints(p.stats, "standard"), standard);
      assert.equal(fantasyPoints(p.stats, "ppr"), ppr);
    });
  }

  test("half PPR sits between, and the scoring rules each count", () => {
    assert.equal(fantasyPoints(byName("Cooper Kupp").stats, "half"), 14.6);
    assert.equal(fantasyPoints({ passInt: 1 }, "ppr"), -1);
    assert.equal(fantasyPoints({ fumblesLost: 1 }, "ppr"), -2);
    assert.equal(fantasyPoints({ twoPtScored: 1, twoPtPassed: 1 }, "ppr"), 4);
  });

  test("two-point conversions are credited from the scoring plays", () => {
    assert.equal(byName("Kyler Murray").stats.twoPtPassed, 1);
    assert.equal(byName("Antoine Wesley").stats.twoPtScored, 1);
    // 137 × 0.04 − 2 × 1 + 0.6 + 2 = 6.08 (−1 per interception, not the spec's −2)
    assert.equal(fantasyPoints(byName("Kyler Murray").stats, "ppr"), 6.1);
  });

  test("a return touchdown the defensive line missed is counted from the plays", () => {
    assert.equal(byName("David Long Jr.").stats.defTd, 1);
  });
});

describe("leaders strip", () => {
  const html = strip.renderLeadersStrip({ game: WILD_CARD, players: PLAYERS, playerUrl });
  const doc = dom(html);
  const cards = [...doc.querySelectorAll(".sct-ls-card")];

  test("picks Stafford, Kupp, Kirk and Long Jr., in that order", () => {
    assert.deepEqual(
      cards.map((c) => c.querySelector(".sct-ls-name").textContent),
      ["Matthew Stafford", "Cooper Kupp", "Christian Kirk", "David Long Jr."],
    );
    assert.deepEqual(
      cards.map((c) => c.querySelector(".sct-ls-label").textContent),
      ["Passing leader", "Top fantasy scorer", "Cardinals leader", "Defensive playmaker"],
    );
  });

  test("shows 24.3, 17.1 and 11.1 PPR, and no points on the defensive card", () => {
    const points = cards.map((c) => c.querySelector(".sct-ls-num")?.textContent ?? null);
    assert.deepEqual(points, ["24.3", "17.1", "11.1", null]);
    const kupp = cards[1].querySelector(".sct-ls-num");
    assert.equal(kupp.getAttribute("data-ppr"), "17.1");
    assert.equal(kupp.getAttribute("data-half"), "14.6");
    assert.equal(kupp.getAttribute("data-std"), "12.1");
    assert.equal(cards[0].querySelector(".sct-ls-unit").textContent, "PPR pts");
  });

  test("writes the stat line by position", () => {
    assert.deepEqual(
      cards.map((c) => c.querySelector(".sct-ls-line").textContent),
      ["13/17, 202 YDS, 2 TD, 1 RUSH TD", "5 REC, 61 YDS, 1 TD", "6 REC, 51 YDS", "1 INT, 1 TD, 1 TKL"],
    );
    assert.equal(strip.statLine(byName("James Conner")), "12 ATT, 15 YDS, 1 TD, 1 REC, 9 REC YDS");
    assert.equal(strip.statLine(byName("Kyler Murray")), "19/34, 137 YDS, 2 INT");
  });

  test("is a labeled section with no heading, names linked where a page exists", () => {
    const section = doc.querySelector("section");
    assert.equal(section.getAttribute("aria-label"), "Game leaders");
    assert.equal(doc.querySelectorAll("h1, h2, h3").length, 0);
    assert.equal(cards[0].querySelector("a").getAttribute("href"), URLS["Matthew Stafford"]);
    assert.equal(cards[2].querySelector("a"), null, "Kirk has no page here, so no link");
    assert.equal(cards[0].querySelector(".sct-ls-meta").textContent, "LAR · QB");
  });

  test("kickers are never picked, and nobody twice", () => {
    const kickersOnly = players_.buildGamePlayers(
      [
        { espnId: "k", name: "Big Leg", team: "ARI", pos: "K", stats: { fgm: 5, fga: 5 } },
        { espnId: "q", name: "Only Passer", team: "ARI", pos: "QB", stats: { passCmp: 20, passAtt: 30, passYds: 300, passTd: 3 } },
      ],
      null,
      [],
    );
    const picks = strip.pickLeaders({ game: WILD_CARD, players: kickersOnly });
    assert.deepEqual(picks.map((p) => p.player.name), ["Only Passer"]);
  });

  test("on a tie, the third card is the away side's", () => {
    const tie = { ...WILD_CARD, away: { ...WILD_CARD.away, quarters: [0, 0, 8, 26] } };
    const picks = strip.pickLeaders({ game: tie, players: PLAYERS });
    assert.equal(picks[2].label, "Cardinals leader");
  });
});

describe("scoring plays from the feed", () => {
  test("reads each play type and its try", () => {
    assert.deepEqual(
      PLAYS.map((p) => p.type),
      ["pass_td", "rush_td", "int_return_td", "pass_td", "rush_td", "field_goal", "field_goal", "field_goal"],
    );
    assert.deepEqual(PLAYS[0], {
      quarter: 1, clock: "3:50", team: "LAR", type: "pass_td", yards: 4,
      scorer: "Odell Beckham Jr.", passer: "Matthew Stafford",
      pat: { type: "kick", result: "good", player: "Matt Gay" },
    });
    assert.deepEqual(PLAYS[4].pat, {
      type: "two_point_pass", result: "good", passer: "Kyler Murray", player: "Antoine Wesley",
    });
  });

  test("reads failed tries, run tries and safeties", () => {
    const p = (text, typeText = "") => parseEspnScoringPlay(raw(2, "1:00", "LAR", text, typeText));
    assert.deepEqual(p("Sony Michel 5 Yd Run (Two-Point Pass Conversion Failed)").pat, { type: "two_point_pass", result: "failed" });
    assert.deepEqual(p("Sony Michel 5 Yd Run (Two-Point Run Conversion Failed)").pat, { type: "two_point_run", result: "failed" });
    assert.deepEqual(p("Sony Michel 5 Yd Run (Sony Michel Run for Two-Point Conversion)").pat, { type: "two_point_run", result: "good", player: "Sony Michel" });
    assert.deepEqual(p("Sony Michel 5 Yd Run (Matt Gay PAT failed)").pat, { type: "kick", result: "failed", player: "Matt Gay" });
    const safety = p("Kyler Murray sacked in end zone by Aaron Donald for a SAFETY", "Safety");
    assert.equal(safety.type, "safety");
    assert.equal(safety.tackled, "Kyler Murray");
    assert.equal(p("Team Safety", "Safety").tackled, undefined);
    assert.equal(p("Jalen Ramsey 45 Yd Fumble Return (Matt Gay Kick)").type, "fumble_return_td");
    assert.equal(p("Brandon Powell 76 Yd Punt Return (Matt Gay Kick)").type, "punt_return_td");
    assert.equal(p("something unreadable", "Touchdown").type, "other_td");
    const stop = p("Denzel Boston 46 Yd pass from Deshaun Watson (Andre Szmyt Kick).");
    assert.equal(stop.type, "pass_td");
    assert.equal(stop.passer, "Deshaun Watson");
    assert.deepEqual(stop.pat, { type: "kick", result: "good", player: "Andre Szmyt" });
  });
});

describe("scoring summary", () => {
  const html = summary.renderScoringSummary({ game: WILD_CARD, plays: PLAYS, playerUrl });
  const doc = dom(html);
  const rows = [...doc.querySelectorAll("tr.sct-ss-play")];

  test("the plays add up to the hero's final and quarters", () => {
    assert.deepEqual(summary.validateScoringPlays(WILD_CARD, PLAYS), []);
    const dropped = summary.validateScoringPlays(WILD_CARD, PLAYS.slice(0, -1));
    assert.equal(dropped.length, 2, dropped.join("; "));
    assert.match(dropped[0], /LAR scoring plays add up to 31, the final says 34/);
  });

  test("8 plays, ending at 11–34", () => {
    assert.equal(rows.length, 8);
    const last = [...rows[7].querySelectorAll(".sct-ss-score")].map((c) => c.textContent);
    assert.deepEqual(last, ["11", "34"]);
  });

  test("'Takes lead' on the first touchdown, then only 'Extends lead'", () => {
    const pills = [...doc.querySelectorAll(".sct-ss-pill")];
    assert.equal(pills[0].textContent, "Takes lead");
    assert.equal(pills[0].closest("tr"), rows[0]);
    // A lead taken in the first quarter and never lost is no "Game winner".
    assert.ok(pills.slice(1).every((p) => p.textContent === "Extends lead"));
    // Every Rams score after the first extends the lead; the Cardinals' only cut into it.
    for (const row of rows.slice(1)) {
      const lar = row.querySelector(".sct-ss-chip").textContent === "LAR";
      assert.equal(Boolean(row.querySelector(".sct-ss-pill.is-extends")), lar, row.textContent);
    }
  });

  test("writes its own scorebook lines, the try under the play, and 'Jr..' never appears", () => {
    assert.doesNotMatch(doc.body.textContent, /Jr\.\./);
    const lines = rows.map((r) => {
      const line = r.querySelector(".sct-ss-line").textContent;
      const pill = r.querySelector(".sct-ss-pill")?.textContent ?? "";
      return [line.replace(pill, "").trim(), r.querySelector(".sct-ss-detail")?.textContent ?? null];
    });
    assert.deepEqual(lines[0], ["Matthew Stafford → Odell Beckham Jr., 4-yard TD", "Matt Gay XP"]);
    assert.deepEqual(lines[1], ["Matthew Stafford 1-yard TD run", "Matt Gay XP"]);
    assert.deepEqual(lines[2], ["David Long Jr. 3-yard interception return TD", "Matt Gay XP"]);
    assert.deepEqual(lines[4], ["James Conner 2-yard TD run", "Kyler Murray → Antoine Wesley, 2-pt conversion"]);
    assert.deepEqual(lines[6], ["Matt Prater 55-yard FG", null]);
  });

  test("the subtitle counts each side's scores, winner first", () => {
    assert.equal(
      doc.querySelector(".sct-rb-sub").textContent,
      "The Rams scored four touchdowns and two field goals; the Cardinals scored one touchdown and one field goal.",
    );
  });

  test("groups by quarter under full-width headers, with an H2 and a hidden caption", () => {
    const periods = [...doc.querySelectorAll("tr.sct-ss-period th")];
    assert.deepEqual(periods.map((th) => th.textContent), ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]);
    assert.ok(periods.every((th) => th.getAttribute("colspan") === "5" && th.getAttribute("scope") === "colgroup"));
    assert.equal(doc.querySelector("h2").textContent, "Scoring summary");
    assert.equal(doc.querySelectorAll("h1").length, 0);
    assert.equal(doc.querySelector("caption").textContent, "Scoring plays, Cardinals vs Rams");
    const heads = [...doc.querySelectorAll("thead th")].map((th) => th.textContent);
    assert.deepEqual(heads, ["Time", "Team", "Play", "ARI", "LAR"]);
  });

  test("links every name the site has a page for, to the same URL as the strip", () => {
    const links = [...doc.querySelectorAll("a.sct-player-link")];
    assert.ok(links.length >= 4);
    for (const a of links) assert.equal(a.getAttribute("href"), URLS[a.textContent]);
  });

  test("the leading score is marked, both when level", () => {
    const first = [...rows[0].querySelectorAll(".sct-ss-score")];
    assert.deepEqual(first.map((c) => c.classList.contains("is-ahead")), [false, true]);
  });

  test("an overtime game adds an Overtime group", () => {
    const game = {
      ...WILD_CARD,
      away: team("ARI", "Arizona Cardinals", "Cardinals", [7, 0, 0, 0], 0),
      home: team("LAR", "Los Angeles Rams", "Rams", [0, 0, 0, 7], 6),
    };
    const plays = [
      raw(1, "9:00", "ARI", "James Conner 3 Yd Run (Matt Prater Kick)"),
      raw(4, "0:40", "LAR", "Cooper Kupp 12 Yd pass from Matthew Stafford (Matt Gay Kick)"),
      raw(5, "6:12", "LAR", "Cam Akers 8 Yd Run"),
    ].map(parseEspnScoringPlay);
    assert.deepEqual(summary.validateScoringPlays(game, plays), []);
    const d = dom(summary.renderScoringSummary({ game, plays, playerUrl }));
    const periods = [...d.querySelectorAll("tr.sct-ss-period th")].map((th) => th.textContent);
    assert.deepEqual(periods, ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter", "Overtime"]);
    assert.equal(d.querySelectorAll("tr.sct-ss-none").length, 2, "Q2 and Q3 had no scoring");
    const pills = [...d.querySelectorAll(".sct-ss-pill")].map((p) => p.textContent);
    // The overtime score took the lead for good: the game winner.
    assert.deepEqual(pills, ["Takes lead", "Ties game", "Game winner"]);
    assert.equal(
      d.querySelector(".sct-rb-sub").textContent,
      "The Rams scored two touchdowns; the Cardinals scored one touchdown.",
    );
  });

  test("a tie lists the away side first and scores level in ink", () => {
    const game = {
      ...WILD_CARD,
      away: team("ARI", "Arizona Cardinals", "Cardinals", [3, 0, 0, 0], 0),
      home: team("LAR", "Los Angeles Rams", "Rams", [0, 3, 0, 0], 0),
    };
    const plays = [
      raw(1, "2:00", "ARI", "Matt Prater 40 Yd Field Goal"),
      raw(2, "2:00", "LAR", "Matt Gay 41 Yd Field Goal"),
    ].map(parseEspnScoringPlay);
    const d = dom(summary.renderScoringSummary({ game, plays, playerUrl }));
    assert.equal(
      d.querySelector(".sct-rb-sub").textContent,
      "The Cardinals scored one field goal; the Rams scored one field goal.",
    );
    const last = [...d.querySelectorAll("tr.sct-ss-play")].at(-1);
    assert.ok([...last.querySelectorAll(".sct-ss-score")].every((c) => c.classList.contains("is-ahead")));
    assert.equal(last.querySelector(".sct-ss-pill").textContent, "Ties game");
    assert.match(d.body.textContent, /Overtime\s*No scoring/);
  });

  test("a safety and a failed two-point try", () => {
    const game = {
      ...WILD_CARD,
      away: team("ARI", "Arizona Cardinals", "Cardinals", [0, 6, 0, 0]),
      home: team("LAR", "Los Angeles Rams", "Rams", [2, 2, 0, 0]),
    };
    const plays = [
      raw(1, "5:00", "LAR", "Kyler Murray sacked in end zone by Aaron Donald for a SAFETY", "Safety"),
      raw(2, "9:00", "ARI", "James Conner 1 Yd Run (Two-Point Pass Conversion Failed)"),
      raw(2, "1:00", "LAR", "Team Safety", "Safety"),
    ].map(parseEspnScoringPlay);
    assert.deepEqual(summary.validateScoringPlays(game, plays), []);
    const d = dom(summary.renderScoringSummary({ game, plays, playerUrl }));
    const text = [...d.querySelectorAll(".sct-ss-desc")].map((c) => [
      c.querySelector(".sct-ss-line").textContent,
      c.querySelector(".sct-ss-detail")?.textContent ?? null,
    ]);
    assert.deepEqual(text, [
      ["Safety Takes lead", "Kyler Murray tackled in the end zone"],
      ["James Conner 1-yard TD run Takes lead", "2-pt try failed"],
      ["Safety", null],
    ]);
    assert.equal(
      d.querySelector(".sct-rb-sub").textContent,
      "The Cardinals scored one touchdown; the Rams scored two safeties.",
    );
  });

  test("renders nothing without plays", () => {
    assert.equal(summary.renderScoringSummary({ game: WILD_CARD, plays: [], playerUrl }), "");
  });
});

describe("ESPN summary document", () => {
  const cat = (name, keys, athletes) => ({ name, keys, athletes });
  const who = (id, displayName, stats) => ({ athlete: { id, displayName }, stats });
  const payload = {
    header: {
      competitions: [{
        status: { type: { completed: true } },
        competitors: [
          { homeAway: "away", score: "11", team: { abbreviation: "ARI" }, linescores: [0, 0, 8, 3].map((value) => ({ value })) },
          { homeAway: "home", score: "34", team: { abbreviation: "LAR" }, linescores: [7, 14, 10, 3].map((value) => ({ value })) },
        ],
      }],
    },
    boxscore: {
      teams: [],
      players: [{
        team: { abbreviation: "LAR" },
        statistics: [
          cat("passing", ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions"], [who("1", "Matthew Stafford", ["13/17", "202", "11.9", "2", "0"])]),
          cat("rushing", ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns"], [who("1", "Matthew Stafford", ["6", "22", "3.7", "1"])]),
          cat("defensive", ["totalTackles", "soloTackles", "sacks", "tacklesForLoss", "passesDefended", "QBHits", "defensiveTouchdowns"], [who("6", "David Long Jr.", ["3", "1", "0", "0", "1", "0", "0"])]),
          cat("interceptions", ["interceptions", "interceptionYards", "interceptionTouchdowns"], [who("6", "David Long Jr.", ["1", "3", "1"])]),
        ],
      }],
    },
    scoringPlays: RAW_PLAYS,
  };
  const parsed = box.parseEspnSummary("401326626", payload);

  test("reads each player's line across categories", () => {
    const stafford = parsed.players.find((p) => p.name === "Matthew Stafford");
    assert.deepEqual(stafford.stats, { passCmp: 13, passAtt: 17, passYds: 202, passTd: 2, passInt: 0, rushAtt: 6, rushYds: 22, rushTd: 1 });
    const long = parsed.players.find((p) => p.name === "David Long Jr.");
    assert.equal(long.stats.passInt, undefined, "an interception made is not one thrown");
    assert.equal(long.stats.defInt, 1);
    assert.equal(long.stats.soloTkl, 1);
    assert.equal(long.stats.astTkl, 2);
    assert.equal(long.team, "LAR");
  });

  test("reads the scoring plays", () => {
    assert.equal(parsed.scoringPlays.length, 8);
    assert.equal(parsed.scoringPlays[4].team, "ARI");
  });
});
