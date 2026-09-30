/**
 * The recap sections added under the scoreboard: scoring rules, the
 * score-only win probability, possessions, betting and the season facts.
 *
 * Driven by the 2021 Wild Card (Cardinals at Rams, 11–34) in plain objects, so
 * the reference values in the build spec are checked without ESPN.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const points = await importModule("lib/matchup/fantasy-points");
const wp = await importModule("lib/matchup/win-probability");
const poss = await importModule("lib/matchup/possessions");
const extras = await importModule("lib/matchup/recap-extras");
const box = await importModule("lib/matchup/boxscore");
after(() => cleanupBundles());

const team = (abbr, name, short, quarters) => ({ abbr, name, short, quarters, ot: null });
const GAME = {
  status: "final",
  seasonLabel: "2021",
  gameType: "playoff",
  roundLabel: "NFC Wild Card",
  kickoff: "2022-01-18T01:15:00.000Z",
  venue: { name: "SoFi Stadium", city: "Inglewood", state: "CA", neutral: false },
  away: team("ARI", "Arizona Cardinals", "Cardinals", [0, 0, 8, 3]),
  home: team("LAR", "Los Angeles Rams", "Rams", [7, 14, 7, 6]),
};

const kick = (player) => ({ type: "kick", result: "good", player });
const PLAYS = [
  { quarter: 1, clock: "3:50", team: "LAR", type: "pass_td", yards: 4, scorer: "Odell Beckham Jr.", passer: "Matthew Stafford", pat: kick("Matt Gay") },
  { quarter: 2, clock: "11:58", team: "LAR", type: "rush_td", yards: 1, scorer: "Matthew Stafford", pat: kick("Matt Gay") },
  { quarter: 2, clock: "7:59", team: "LAR", type: "int_return_td", yards: 3, scorer: "David Long Jr.", pat: kick("Matt Gay") },
  { quarter: 3, clock: "10:36", team: "LAR", type: "pass_td", yards: 7, scorer: "Cooper Kupp", passer: "Matthew Stafford", pat: kick("Matt Gay") },
  { quarter: 3, clock: "4:11", team: "ARI", type: "rush_td", yards: 2, scorer: "James Conner", pat: { type: "two_point_pass", result: "good", player: "Antoine Wesley", passer: "Kyler Murray" } },
  { quarter: 4, clock: "14:55", team: "LAR", type: "field_goal", yards: 37, scorer: "Matt Gay" },
  { quarter: 4, clock: "10:13", team: "ARI", type: "field_goal", yards: 55, scorer: "Matt Prater" },
  { quarter: 4, clock: "4:21", team: "LAR", type: "field_goal", yards: 46, scorer: "Matt Gay" },
];
const ODDS = { favorite: "LAR", line: 3.5, total: 49.5 };

describe("scoring rules", () => {
  test("kicker tiers: Matt Gay's 37 and 46 plus four extra points is 11.0", () => {
    assert.equal(points.kickerPoints({ fgMade: [37, 46], fgAtt: 2, xpMade: 4, xpAtt: 4 }), 11);
    assert.equal(points.kickerPoints({ fgMade: [50], fgAtt: 2, xpMade: 1, xpAtt: 2 }), 4);
  });

  test("Rams D/ST is 16.0", () => {
    assert.equal(
      points.defensePoints({ sacks: 2, ints: 2, fumRec: 0, safeties: 0, defTd: 1, retTd: 0, pointsAllowed: 11 }),
      16,
    );
  });

  test("points-allowed tiers", () => {
    assert.deepEqual([0, 6, 13, 20, 27, 34, 35].map(points.pointsAllowedTier), [10, 7, 4, 1, 0, -1, -4]);
  });

  test("IDP: David Long Jr.'s pick-six line", () => {
    assert.equal(points.idpPoints({ solo: 1, pd: 1, int: 1, td: 1 }), 11);
  });

  test("Beckham's 40-yard pass counts, and the formats split on receptions", () => {
    const line = { passYds: 40, rec: 4, recYds: 54, recTd: 1 };
    assert.equal(points.fantasyPoints(line, "ppr"), 17);
    assert.equal(points.fantasyPoints(line, "standard"), 13);
  });

  test("Murray's two-point pass", () => {
    const line = { passYds: 137, passInt: 2, rushYds: 6, twoPtPassed: 1 };
    assert.equal(points.fantasyPoints(line, "ppr"), 6.1);
  });
});

describe("win probability, score-only", () => {
  const model = wp.winProbabilityModel({ game: GAME, plays: PLAYS, odds: ODDS });

  test("kickoff is about 60% Rams", () => {
    assert.equal(Math.round(model.kickoff * 100), 60);
  });

  test("the kickoff sentence gives each side its own chance", () => {
    const at = (line, favorite) => wp.wpSubtitle(GAME, wp.winProbabilityModel({ game: GAME, plays: PLAYS, odds: { favorite, line, total: 49.5 } }));
    assert.match(at(3.5, "LAR"), /was a 60% favorite at kickoff/);
    // The regression: the home underdog was printed with the favourite's 60%.
    assert.match(at(3.5, "ARI"), /had a 40% chance at kickoff/);
    assert.match(at(13, "LAR"), /was an 83% favorite at kickoff/);
  });

  test("exactly three plays swing it by a point or more, all Rams scores", () => {
    const big = model.swings.filter((s) => Math.abs(s.after - s.before) >= 0.01);
    assert.deepEqual(
      big.map((s) => [s.play.scorer, s.points, Math.round(s.before * 100), Math.round(s.after * 100)]),
      [
        ["Odell Beckham Jr.", 20, 59, 79],
        ["Matthew Stafford", 13, 80, 93],
        ["David Long Jr.", 5, 93, 98],
      ],
    );
  });

  test("the section lists them, and never doubles the stop after Jr.", () => {
    const html = wp.renderWinProbability({ game: GAME, plays: PLAYS, odds: ODDS, playerUrl: () => null });
    assert.equal((html.match(/class="sct-wp-play"/g) ?? []).length, 3);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ""), /Jr\.\./);
    assert.match(html, /After halftime no score moved the Rams(&#39;|') chances by even one point/);
    assert.match(html, /role="img"/);
  });

  test("the ends never print 100%", () => {
    assert.equal(wp.formatWp(0.999), ">99%");
    assert.equal(wp.formatWp(0.001), "<1%");
  });

  test("no line: an even start", () => {
    const even = wp.winProbabilityModel({ game: GAME, plays: PLAYS, odds: null });
    assert.equal(Math.round(even.kickoff * 100), 50);
  });

  test("overtime draws past regulation", () => {
    const tied = {
      ...GAME,
      gameType: "regular",
      away: { ...GAME.away, quarters: [0, 7, 0, 7], ot: 0 },
      home: { ...GAME.home, quarters: [7, 0, 7, 0], ot: 3 },
    };
    const plays = [
      { quarter: 1, clock: "5:00", team: "LAR", type: "field_goal", yards: 30, scorer: "K" },
    ];
    const ot = wp.winProbabilityModel({
      game: tied,
      plays: [...plays, { quarter: 5, clock: "4:00", team: "LAR", type: "field_goal", yards: 30, scorer: "K" }],
      odds: null,
    });
    assert.ok(ot.end > 3600);
  });
});

describe("possessions", () => {
  const drive = (team, quarter, startClock, plays, result, extra = {}) => ({
    team, quarter, startClock, plays, yards: 10, durationSeconds: 120, result, defensiveScore: false, ...extra,
  });
  const DRIVES = [
    drive("ARI", 1, "15:00", 3, "punt"),
    drive("LAR", 1, "13:44", 4, "punt"),
    drive("ARI", 1, "10:54", 3, "punt"),
    drive("LAR", 1, "9:55", 10, "td"),
    drive("ARI", 1, "3:50", 3, "punt"),
    drive("LAR", 1, "2:15", 9, "td"),
    drive("ARI", 2, "11:58", 3, "punt"),
    drive("ARI", 2, "8:45", 3, "int", { defensiveScore: true }),
  ];
  const input = {
    game: GAME,
    stats: {
      away: { plays: 54, totalYards: 183, yardsPerPlay: 3.4, passYards: 122, rushYards: 61, turnovers: 2, firstDowns: 14, thirdDown: { made: 0, attempts: 9, percent: 0 }, redZone: null, penalties: null, possessionSeconds: 1454, passAttempts: 34, sacked: 2, rushAttempts: 18 },
      home: { plays: 57, totalYards: 375, yardsPerPlay: 6.6, passYards: 235, rushYards: 140, turnovers: 0, firstDowns: 16, thirdDown: { made: 6, attempts: 13, percent: 46 }, redZone: null, penalties: null, possessionSeconds: 2146, passAttempts: 18, sacked: 1, rushAttempts: 38 },
    },
    drives: DRIVES,
    players: {},
    places: { ARI: "Arizona", LAR: "Los Angeles" },
  };

  test("dropbacks and the subtitle", () => {
    assert.equal(poss.playCalling(input.stats.away).dropbacks, 36);
    assert.equal(poss.playCalling(input.stats.home).dropbacks, 19);
    assert.equal(
      poss.callingSubtitle(input),
      "With a 21–0 halftime lead, the Rams ran the ball on two-thirds of their plays. Arizona had to throw on two-thirds of its own.",
    );
  });

  test("the Rams scored on their second possession, and the pick-six is an Arizona interception", () => {
    const notes = poss.possessionNotes(input);
    assert.match(notes[0], /^The Rams opened the scoring on their second possession/);
    const html = poss.renderPossessions(input);
    assert.match(html, /counted as a Cardinals interception, not as a Rams possession/);
  });

  test("ESPN's drive results map onto the table's rows", () => {
    assert.deepEqual(box.driveResult("INT TD"), { result: "int", defensiveScore: true });
    assert.deepEqual(box.driveResult("DOWNS"), { result: "downs", defensiveScore: false });
    assert.equal(box.driveResult("MISSED FG").result, "missed_fg");
    assert.equal(box.driveResult("END OF HALF").result, "end_half");
  });
});

describe("betting, video and the jump links", () => {
  test("Rams covered by 19.5, under", () => {
    const html = extras.renderBetting(GAME, ODDS);
    assert.match(html, /LAR −3\.5/);
    assert.match(html, /Rams covered by 19\.5/);
    assert.match(html, /Under: 45 points scored/);
    assert.match(html, /1-800-GAMBLER/);
  });

  test("the spec's reference lines: tiles, implied team totals, no moneyline or props", () => {
    const html = extras.renderBetting(GAME, ODDS);
    assert.match(html, /<h2 class="sct-rb-h2" id="betting">Cardinals vs Rams odds and results<\/h2>/);
    assert.match(html, /Under: 45 points scored \(by 4\.5\)/);
    const rows = [...html.matchAll(/<tr><th scope="row"[^>]*>(\w+)<\/th><td>([\d.]+)<\/td><td>(\d+)<\/td><td[^>]*>([^<]+)<\/td><\/tr>/g)].map((m) => m.slice(1));
    assert.deepEqual(rows, [
      ["Rams", "26.5", "34", "+7.5"],
      ["Cardinals", "23.0", "11", "−12.0"],
    ]);
    assert.doesNotMatch(html, /Moneyline|First half|Player props/);
  });

  test("no closing total, no tab", () => {
    assert.equal(extras.renderBetting(GAME, { favorite: "LAR", line: 3.5, total: null }), "");
  });

  test("no odds, no section; switched off, no section", () => {
    assert.equal(extras.renderBetting(GAME, null), "");
    process.env.SC_BETTING_RESULTS = "off";
    try {
      assert.equal(extras.renderBetting(GAME, ODDS), "");
    } finally {
      delete process.env.SC_BETTING_RESULTS;
    }
  });

  test("the video is a click-to-load button, and is absent without an upload", () => {
    const html = extras.renderHighlights(GAME, { youtubeId: "VfMqgtKsoag", title: "Highlights", uploadDate: "2022-01-18", publisher: "NFL" });
    assert.match(html, /<button type="button" class="sct-hl-play" data-hl-embed="https:\/\/www\.youtube-nocookie\.com\/embed\/VfMqgtKsoag\?autoplay=1&amp;rel=0"/);
    assert.match(html, /<noscript><a class="sct-hl-noscript" href="https:\/\/www\.youtube\.com\/watch\?v=VfMqgtKsoag"/);
    assert.match(html, /Not playing\? <a href="https:\/\/www\.youtube\.com\/watch\?v=VfMqgtKsoag" target="_blank" rel="noopener">Watch on YouTube<\/a>/);
    assert.doesNotMatch(html, /<iframe/);
    assert.equal(extras.renderHighlights(GAME, null), "");
  });

  test("jump links list only what rendered", () => {
    const nav = extras.renderJumpNav(`<h2 id="sct-rb-why"></h2><h2 id="h2h"></h2>`);
    assert.match(nav, /href="#sct-rb-why"/);
    assert.match(nav, /href="#h2h"/);
    assert.doesNotMatch(nav, /#wp/);
  });
});

describe("what it meant", () => {
  const opp = (nickname, code) => ({ nickname, code, abbreviation: code.toLowerCase() });
  const g = (seasonType, week, weekLabel, o, outcome, ts, os, homeAway, kickoffMs = null) => ({
    seasonType, week, weekLabel, opponent: opp(o, o.slice(0, 3).toUpperCase()), opponentName: o, homeAway,
    neutralSite: false, kickoffMs, status: "final", result: { outcome, teamScore: ts, opponentScore: os },
  });

  test("an eliminated side's season, with its opening streak", () => {
    const games = [
      ...Array.from({ length: 7 }, (_, i) => g("regular", i + 1, `Week ${i + 1}`, "Xxx", "W", 20, 10, "home")),
      ...Array.from({ length: 4 }, (_, i) => g("regular", i + 8, `Week ${i + 8}`, "Yyy", "L", 10, 20, "home")),
      ...Array.from({ length: 6 }, (_, i) => g("regular", i + 12, `Week ${i + 12}`, "Zzz", i < 4 ? "W" : "L", 10, 20, "away")),
      { ...g("post", 1, "Wild Card", "Rams", "L", 11, 34, "away", Date.parse(GAME.kickoff)), opponent: { nickname: "Rams", code: "LAR" } },
    ];
    const text = extras.meantSentence({ abbr: "ARI", name: "Arizona Cardinals", short: "Cardinals", games }, GAME);
    assert.equal(text, "The Cardinals' season ended at 11-7 after a 7–0 start.");
  });
});
