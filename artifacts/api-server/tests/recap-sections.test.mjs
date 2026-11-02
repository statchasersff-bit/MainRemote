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

  test("the story sentence opens at the home side's own chance", () => {
    const at = (line, favorite) => wp.wpSubtitle(GAME, wp.winProbabilityModel({ game: GAME, plays: PLAYS, odds: { favorite, line, total: 49.5 } }));
    assert.match(at(3.5, "LAR"), /^Los Angeles opened at 60% win probability/);
    // The regression: the home underdog was printed with the favorite's 60%.
    assert.match(at(3.5, "ARI"), /^Los Angeles opened at 40% win probability/);
    assert.match(at(13, "LAR"), /^Los Angeles opened at 83% win probability/);
    // One sentence, ending on how it finished (mak, 2026-09-30).
    assert.match(at(3.5, "LAR"), /win\.$/);
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

  test("the takeaway compares the winner's plays and efficiency, from the printed figures", () => {
    // 57 plays to 54; 235 yards on 19 dropbacks (12.4) against 122 on 36 (3.4).
    assert.equal(poss.callingTakeaway(input), "Los Angeles ran 3 more plays and gained 9.0 more yards per dropback.");
    const html = poss.renderPossessions(input);
    assert.match(html, /class="sct-pc-compare"/);
    // Turnovers get the marked row when the two sides differ.
    assert.match(html, /<tr class="is-key"><th scope="row">Turnovers<\/th>/);
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
  test("the result grid: both clubs side by side, no final score, each side of the spread with its verdict", () => {
    const html = extras.renderBetting(GAME, ODDS);
    // The header carries the score, so the panel does not (mak, 2026-11-02).
    assert.doesNotMatch(html, /sct-bet-final/);
    // Away left, home right, the label between.
    assert.match(html, /<div class="sct-bet-row sct-bet-head"><span class="sct-bet-cell is-away sct-bet-team"[^>]*>ARI<\/span><span class="sct-bet-k" aria-hidden="true"><\/span><span class="sct-bet-cell is-home sct-bet-team"[^>]*>LAR<\/span><\/div>/);
    assert.match(html, /<span class="sct-bet-cell is-away"[^>]*><b class="sct-bet-line-v">\+3\.5<\/b> <span class="sct-bet-verdict is-no"><span aria-hidden="true">✗<\/span> Failed by 19\.5<\/span><\/span><span class="sct-bet-k">Spread<\/span><span class="sct-bet-cell is-home"[^>]*><b class="sct-bet-line-v">−3\.5<\/b> <span class="sct-bet-verdict is-yes"><span aria-hidden="true">✓<\/span> Covered by 19\.5<\/span>/);
    assert.match(html, /<p class="sct-bet-total"><span class="sct-bet-k">Total<\/span> <b class="sct-bet-line-v">49\.5<\/b> <span class="sct-bet-verdict is-yes"><span aria-hidden="true">✓<\/span> Under by 4\.5 \(45 pts\)<\/span><\/p>/);
    assert.match(html, /1-800-GAMBLER/);
    // A failed cover is marked as one on the favorite's side, and as a cover on the underdog's.
    const fail = extras.renderBetting(GAME, { favorite: "LAR", line: 24.5, total: 49.5 });
    assert.match(fail, /is-home"[^>]*><b class="sct-bet-line-v">−24\.5<\/b> <span class="sct-bet-verdict is-no"><span aria-hidden="true">✗<\/span> Failed by 1\.5<\/span>/);
    assert.match(fail, /is-away"[^>]*><b class="sct-bet-line-v">\+24\.5<\/b> <span class="sct-bet-verdict is-yes"><span aria-hidden="true">✓<\/span> Covered by 1\.5<\/span>/);
  });

  test("implied and scored per side, bars on one scale, the difference from the rounded implied figure", () => {
    const html = extras.renderBetting(GAME, ODDS);
    assert.match(html, /<h2 class="sct-rb-h2" id="betting">Cardinals vs Rams odds and results<\/h2>/);
    const implied = [...html.matchAll(/<span class="sct-bet-imp-implied">([\d.]+)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(implied, ["23.0", "26.5"], "away then home");
    const scored = [...html.matchAll(/<span class="sct-bet-imp-actual">(\d+)<\/span> <b class="sct-fp-diff[^"]*">([^<]+)<\/b>/g)].map((m) => m.slice(1));
    assert.deepEqual(scored, [["11", "−12.0"], ["34", "+7.5"]]);
    const bars = [...html.matchAll(/<span class="sct-bet-imp-track is-(\w+)"[^>]*><span class="sct-bet-imp-fill" style="width:([\d.]+%)"><\/span><span class="sct-bet-imp-tick" style="(right|left):([\d.]+%)">/g)].map((m) => m.slice(1));
    assert.deepEqual(bars.map((b) => [b[0], b[2]]), [["away", "right"], ["home", "left"]], "the bars grow out from the middle");
    const [ari, lar] = bars;
    assert.ok(parseFloat(lar[1]) > parseFloat(lar[3]), "the Rams' bar passes their tick");
    assert.ok(parseFloat(ari[1]) < parseFloat(ari[3]), "the Cardinals' bar stops short of theirs");
    assert.equal(Math.round(parseFloat(lar[1]) / 34 * 100), Math.round(parseFloat(ari[3]) / 23 * 100), "one scale for both bars");
    // A rounding seam: 35 against an implied 24.75 reads +10.2 (from the printed 24.8), not +10.3.
    const seam = extras.renderBetting(
      { ...GAME, away: { ...GAME.away, quarters: [0, 6, 0, 0] }, home: { ...GAME.home, quarters: [14, 7, 7, 7] } },
      { favorite: "LAR", line: 3, total: 46.5 },
    );
    assert.match(seam, /<span class="sct-bet-imp-implied">24\.8<\/span>.*?<span class="sct-bet-imp-actual">35<\/span> <b class="sct-fp-diff is-pos">\+10\.2<\/b>/);
    assert.doesNotMatch(html, /Moneyline|First half|Player props/);
  });

  test("the trends: one bold story, one shared table, captions", () => {
    const t = (a, b, push = 0) => ({ a, b, push });
    const extrasIn = {
      meetings: [],
      seasons: {
        ARI: { ats: t(1, 1, 1), ou: t(0, 3), atsFavorite: t(1, 0), atsUnderdog: t(0, 1, 1), atsVenue: t(0, 1, 1), venue: "away" },
        LAR: { ats: t(2, 1), ou: t(1, 2), atsFavorite: t(2, 0), atsUnderdog: t(0, 1), atsVenue: t(2, 0), venue: "home" },
      },
    };
    const html = extras.renderBetting(GAME, ODDS, extrasIn);
    assert.match(html, /<p class="sct-bet-story"><b>Every Cardinals game this season has gone under the total \(3 games\)\.<\/b><\/p>/);
    const heads = [...html.matchAll(/<th scope="col"[^>]*>(?:<span class="sct-rb-sr">)?([^<]*)/g)].map((m) => m[1]);
    assert.deepEqual(heads, ["Record", "ARI", "LAR"]);
    const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)(?: <small>(\w+)<\/small>)?<\/td><td>([^<]+)(?: <small>(\w+)<\/small>)?<\/td><\/tr>/g)].map((m) => m.slice(1));
    assert.deepEqual(rows, [
      ["ATS", "1–1–1", undefined, "2–1", undefined],
      ["O/U (overs first)", "0–3", undefined, "1–2", undefined],
      ["ATS as favorite", "1–0", undefined, "2–0", undefined],
      ["ATS as underdog", "0–1–1", undefined, "0–1", undefined],
      ["ATS at this game's venue", "0–1–1", "road", "2–0", "home"],
    ]);
    assert.match(html, /<p class="sct-bet-cap">Each team&#39;s 2021 season through this game, including it\.<\/p>/);
    assert.doesNotMatch(html, /sct-bet-card/);
    // Two panels side by side (mak, 2026-11-02): no "Betting trends" heading,
    // the story line heads the trends panel.
    assert.doesNotMatch(html, /Betting trends/);
    assert.match(html, /<div class="sct-bet-grid has-trends"><div class="sct-bet-panel sct-bet-result"><p class="sct-bet-panel-k">Result<\/p>/);
    assert.match(html, /<div class="sct-bet-panel sct-bet-trends-panel"><p class="sct-bet-panel-k">Season trends<\/p><p class="sct-bet-story">/);
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

  test("the video is a link out to YouTube in a new tab, and is absent without an upload", () => {
    const html = extras.renderHighlights(GAME, { youtubeId: "VfMqgtKsoag", title: "Highlights", uploadDate: "2022-01-18", publisher: "NFL" });
    assert.match(html, /<a class="sct-hl-play" href="https:\/\/www\.youtube\.com\/watch\?v=VfMqgtKsoag" target="_blank" rel="noopener" aria-label="Watch on YouTube: Highlights">/);
    assert.doesNotMatch(html, /<button|data-hl-embed|youtube-nocookie|<noscript/);
    assert.match(html, /<section class="sct-rb-section sct-hl" id="highlights" aria-label="Game highlights">/);
    assert.doesNotMatch(html, /Game Highlights<\/h2>/);
    assert.match(html, /Official NFL highlights · Opens on <a href="https:\/\/www\.youtube\.com\/watch\?v=VfMqgtKsoag" target="_blank" rel="noopener">YouTube<\/a>/);
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
