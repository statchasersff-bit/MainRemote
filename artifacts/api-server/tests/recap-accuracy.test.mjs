/**
 * WEB-037 (2026-11-24): completed-game pages told one play several ways. The
 * Packers-Lions Week 7 page called Trey Smack's blocked 35-yarder "missed",
 * printed Jake Bates' winning kick at 0:00 in the scoring summary and the FAQ
 * but 0:01 in the play-by-play and the win-probability list, said the kick
 * "gave them a lead they never gave up", and listed Jordan Love's failed
 * fourth-and-4 at the Detroit 7 as "Love finds Golden for 0 yards". The
 * play-by-play (lib/matchup/play-facts.ts) is now the record each section
 * reads. These checks hold the shared helpers to small fixtures (blocked vs
 * missed, failed vs converted vs penalty-erased fourth downs, walk-off vs
 * go-ahead) and to the stored Packers-Lions game.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const facts = await importModule("lib/matchup/play-facts");
const overview = await importModule("lib/matchup/recap-overview");
const body = await importModule("lib/matchup/recap-body");
const boxscore = await importModule("lib/matchup/boxscore");
const gamePlayers = await importModule("lib/matchup/game-players");
after(() => cleanupBundles());

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "data", "matchup");
const read = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p), "utf8"));

/* ------------------------------------------------------------ fixtures */

const play = (o) => ({ d: 1, q: 4, c: "05:00", t: "AAA", x: "", k: "pass", away: 0, home: 0, ...o });
const drive = (o) => ({ n: 1, team: "AAA", result: "punt", qtr: 4, clock: "08:00", start: "AAA 25", plays: 5, yards: 20, top: "3:00", away: 0, home: 0, ...o });

describe("blocked vs missed field goals", () => {
  const pbp = {
    season: 2026, week: 1, seasonType: "regular", home: "BBB", away: "AAA",
    drives: [drive({ n: 1, result: "missed_fg" }), drive({ n: 2, team: "BBB", result: "missed_fg" })],
    plays: [
      play({ d: 1, k: "field_goal", x: "A.Kicker 44 yard field goal is No Good, Wide Right, Center-X, Holder-Y." }),
      play({ d: 2, t: "BBB", k: "field_goal", x: "B.Kicker 35 yard field goal is BLOCKED (D.Lineman), Center-X, Holder-Y." }),
    ],
  };

  test("the play text decides: a block is blocked_fg, a miss stays missed_fg", () => {
    assert.equal(facts.isBlockedFieldGoal(pbp.plays[0].x), false);
    assert.equal(facts.isBlockedFieldGoal(pbp.plays[1].x), true);
    const refined = facts.refineDrives(pbp);
    assert.deepEqual(refined.drives.map((d) => d.result), ["missed_fg", "blocked_fg"]);
    // A copy: the cached document is not changed.
    assert.deepEqual(pbp.drives.map((d) => d.result), ["missed_fg", "missed_fg"]);
  });

  test("ESPN's drive chart (which files blocks as Missed FG) follows the play-by-play twin", () => {
    const espn = [
      { team: "AAA", quarter: 4, startClock: "8:00", result: "missed_fg" },
      { team: "BBB", quarter: 4, startClock: "8:00", result: "missed_fg" },
    ];
    assert.deepEqual(facts.refineEspnDrives(espn, facts.refineDrives(pbp)).map((d) => d.result), ["missed_fg", "blocked_fg"]);
    assert.equal(boxscore.driveResult("Blocked FG").result, "blocked_fg");
    assert.equal(boxscore.driveResult("Missed FG").result, "missed_fg");
  });
});

describe("failed vs converted fourth downs", () => {
  const pbp = {
    season: 2026, week: 1, seasonType: "regular", home: "BBB", away: "AAA",
    drives: [drive({ n: 1, result: "downs" }), drive({ n: 2, result: "td" }), drive({ n: 3, result: "downs" }), drive({ n: 4, result: "punt" })],
    plays: [
      // 0: a completion short of the line on the drive's last snap.
      play({ d: 1, dn: 3, togo: 4, at: "BBB 7", y: 0, x: "pass incomplete" }),
      play({ d: 1, dn: 4, togo: 4, at: "BBB 7", y: 0, x: "J.Love pass short right to M.Golden to BBB 7 for no gain." }),
      // 2: converted on the play itself.
      play({ d: 2, dn: 4, togo: 5, at: "BBB 33", y: 27, fd: 1, x: "J.Love pass deep right to S.Williams for 27 yards." }),
      // 3-4: erased by a penalty, then the real fourth down fails.
      play({ d: 3, k: "no_play", dn: 4, togo: 1, at: "AAA 40", y: 0, pen: 1, x: "PENALTY on AAA, False Start, 5 yards - No Play." }),
      play({ d: 3, k: "run", dn: 4, togo: 6, at: "AAA 35", y: 2, x: "J.Back up the middle for 2 yards." }),
      // 5: an incomplete fourth down that a defensive penalty kept alive is no turnover.
      play({ d: 4, dn: 4, togo: 8, at: "AAA 30", y: 0, fd: 1, pen: 1, x: "pass incomplete. PENALTY on BBB, Defensive Holding, 5 yards, enforced. AUTOMATIC FIRST DOWN" }),
    ],
  };

  test("the fourth-and-4 short of the line is a turnover on downs", () => {
    const f = facts.downFacts(pbp, 1);
    assert.equal(f.turnoverOnDowns, true);
    assert.equal(f.converted, false);
    assert.equal(facts.downText(f, "AAA"), "fourth-and-4");
  });

  test("a conversion is a conversion, never a turnover", () => {
    const f = facts.downFacts(pbp, 2);
    assert.equal(f.converted, true);
    assert.equal(f.turnoverOnDowns, false);
  });

  test("a snap erased by penalty has no down of its own; the replayed fourth down still counts", () => {
    assert.equal(facts.downFacts(pbp, 3), null);
    assert.equal(facts.downFacts(pbp, 4).turnoverOnDowns, true);
  });

  test("a fourth down kept alive by a defensive penalty is neither converted nor turned over", () => {
    const f = facts.downFacts(pbp, 5);
    assert.equal(f.turnoverOnDowns, false);
    assert.equal(f.converted, false);
  });

  test("the spot names the city; nflverse's LA is the Rams", () => {
    const city = (c) => ({ DET: "Detroit", LAR: "Los Angeles" })[c] ?? null;
    assert.equal(facts.spotText("DET 7", city), "the Detroit 7");
    assert.equal(facts.spotText("LA 25", city), "the Los Angeles 25");
    assert.equal(facts.spotText("MID 50", city), "midfield");
  });
});

describe("walk-off vs go-ahead scores", () => {
  const walkOff = [
    play({ d: 9, t: "BBB", k: "qb_kneel", c: "00:27", dn: 1, togo: 3 }),
    play({ d: 9, k: "no_play", c: "00:01", t: undefined, x: "Timeout #1 by BBB at 00:01." }),
    play({ d: 9, t: "BBB", k: "field_goal", c: "00:01", dn: 2, togo: 4, x: "J.Bates 22 yard field goal is GOOD.", score: 1, away: 17, home: 20 }),
  ];
  const goAhead = [
    play({ d: 8, t: "BBB", k: "field_goal", c: "00:40", x: "J.Bates 50 yard field goal is GOOD.", score: 1, away: 17, home: 20 }),
    play({ d: 9, t: "BBB", k: "kickoff", c: "00:35", x: "kicks 65 yards" , away: 17, home: 20 }),
    play({ d: 9, t: "AAA", k: "pass", c: "00:35", dn: 1, togo: 10, x: "pass incomplete", away: 17, home: 20 }),
  ];
  const tdThenTry = [
    play({ d: 9, q: 5, t: "AAA", k: "run", c: "06:12", dn: 1, togo: 10, td: 1, score: 1, away: 26, home: 20 }),
    play({ d: 9, q: 5, t: "AAA", k: "extra_point", c: "06:12", score: 1, away: 27, home: 20 }),
  ];

  test("a kick snapped at 0:01 with nothing after it ended the game", () => {
    assert.equal(facts.endsGameAt(walkOff, 2), true);
  });

  test("a lead taken with a kickoff and a snap still to come did not", () => {
    assert.equal(facts.endsGameAt(goAhead, 0), false);
  });

  test("the try after an overtime touchdown is not a possession", () => {
    assert.equal(facts.endsGameAt(tdThenTry, 0), true);
  });

  test("scoring plays take the snap's clock and the ending; an unmatched one keeps the feed's", () => {
    const pbp = { drives: [], plays: walkOff };
    const espn = [
      { quarter: 4, clock: "0:00", team: "BBB", type: "field_goal", yards: 22, scorer: "Jake Bates" },
    ];
    // A Q1 field goal the play-by-play holds no row for.
    const lead = [
      { quarter: 1, clock: "1:00", team: "AAA", type: "field_goal", yards: 30 },
    ];
    // Matched by the score it made: 0-3 for the only scoring play.
    const [matched] = facts.pbpScoringPlays(espn, { drives: [], plays: walkOff.map((p) => ({ ...p, away: 0, home: p.score ? 3 : 0 })) }, "AAA", "BBB");
    assert.equal(matched.clock, "0:01");
    assert.equal(matched.endsGame, true);
    const [kept] = facts.pbpScoringPlays(lead, pbp, "AAA", "BBB");
    assert.equal(kept.clock, "1:00");
    assert.equal(kept.endsGame, undefined);
  });

  const TEAMS = {
    GB: { abbr: "GB", name: "Green Bay Packers", short: "Packers", singular: "Packer", city: "Green Bay", hub: "/g/", matchups: "/g/m/" },
    DET: { abbr: "DET", name: "Detroit Lions", short: "Lions", singular: "Lion", city: "Detroit", hub: "/d/", matchups: "/d/m/" },
  };
  const input = (winningPlay) => ({
    game: {
      status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 7",
      kickoff: "2026-10-25T20:25:00.000Z",
      venue: { name: "Ford Field", city: "Detroit", state: "MI", neutral: false },
      away: { abbr: "GB", name: "Green Bay Packers", short: "Packers", quarters: [7, 0, 7, 3], ot: null },
      home: { abbr: "DET", name: "Detroit Lions", short: "Lions", quarters: [7, 3, 7, 3], ot: null },
    },
    teams: TEAMS,
    stats: { away: null, home: null },
    series: { sinceSeason: 2021, games: [], upcoming: [] },
    links: {},
    faqFacts: { winningPlay },
  });
  const answer = (items) => items.find((q) => /game-winning score/.test(q.question))?.answer;

  test("FAQ: the walk-off is the game-winning score, with no lead left to keep", () => {
    const a = answer(body.recapFaq(input({ text: "Jake Bates' 22-yard field goal", team: "DET", quarter: 4, clock: "0:01", away: 17, home: 20, endsGame: true })));
    assert.equal(a, "Jake Bates' 22-yard field goal on the final play, with 0:01 left in the fourth quarter, was the game-winning score: the Lions won 20–17.");
    assert.doesNotMatch(a, /never gave up|for good/);
  });

  test("FAQ: a go-ahead score with time left keeps the go-ahead wording", () => {
    const a = answer(body.recapFaq(input({ text: "Jake Bates' 50-yard field goal", team: "DET", quarter: 4, clock: "0:40", away: 17, home: 20 })));
    assert.match(a, /with 0:40 left in the fourth quarter gave the Lions a 20–17 lead they never gave up\./);
  });
});

/* ------------------------------------------ the stored Packers-Lions game */

describe("Packers at Lions, 2026 Week 7 (stored data)", () => {
  const ID = "2026_07_GB_DET";
  const pbp = facts.refineDrives(read("pbp", "2026", `${ID}.json`));
  const story = read("game_story_2026.json").games[ID];
  const stored = Object.entries(read("boxscores", "2026.json").games).find(([, g]) => g.week === 7 && g.name === "GB @ DET");
  const box = boxscore.parseEspnSummary(stored[0], stored[1].summary);

  test("Smack's 35-yarder is blocked; his first-quarter 26-yarder stays missed", () => {
    const smack = pbp.drives.filter((d) => d.team === "GB" && /fg$/.test(d.result)).map((d) => [d.qtr, d.clock, d.result]);
    assert.deepEqual(smack, [[1, "15:00", "missed_fg"], [4, "13:44", "fg"], [4, "04:50", "blocked_fg"]]);
  });

  test("every scoring play carries the play-by-play's clock; Bates' kick is 0:01 and ended the game", () => {
    const plays = facts.pbpScoringPlays(box.scoringPlays, pbp, "GB", "DET");
    assert.deepEqual(plays.map((p) => `Q${p.quarter} ${p.clock}`), ["Q1 7:08", "Q1 1:04", "Q2 12:40", "Q3 12:22", "Q3 6:40", "Q4 7:14", "Q4 0:01"]);
    assert.deepEqual(plays.map((p) => Boolean(p.endsGame)), [false, false, false, false, false, false, true]);
  });

  test("How the Game Swung: the turnover on downs, the game-winning kick, the final score", () => {
    const players = gamePlayers.buildGamePlayers(box.players, null, box.scoringPlays);
    const game = {
      status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 7", kickoff: "2026-10-25T20:25:00.000Z",
      venue: null,
      away: { abbr: "GB", name: "Green Bay Packers", short: "Packers", quarters: [7, 0, 7, 3], ot: null, score: 17 },
      home: { abbr: "DET", name: "Detroit Lions", short: "Lions", quarters: [7, 3, 7, 3], ot: null, score: 20 },
    };
    const { main } = overview.renderRecapOverviewParts({
      game, story, stats: { away: null, home: null }, players, leaders: [],
      city: { away: "Green Bay", home: "Detroit" }, playerUrl: () => null, photo: () => "", highlights: "",
      inks: { away: "#203731", home: "#0076b6" }, drives: pbp.drives, pbp,
    });
    const moments = [...main.matchAll(/<b>([^<]+)<\/b><small>([^<]+)<\/small>/g)].map((m) => `${m[1]} | ${m[2]}`);
    assert.ok(
      moments.includes("Love&#39;s pass to Golden comes up short on fourth-and-4 at the Detroit 7, a turnover on downs. | Q2 4:20 · DET win probability 58% → 71%"),
      moments.join("\n"),
    );
    assert.ok(moments.includes("Bates makes the game-winning field goal. | Q4 0:01 · DET win probability 87% → 100%"), moments.join("\n"));
    assert.doesNotMatch(main, /Golden for 0 yards|go-ahead field goal|never gave up/);
  });
});

/* ------------------------------------------------------------------ ties */

describe("Giants at Commanders, a 27-27 tie", () => {
  const TEAMS = {
    NYG: { abbr: "NYG", name: "New York Giants", short: "Giants", singular: "Giant", city: "New York", hub: "/n/", matchups: "/n/m/" },
    WAS: { abbr: "WAS", name: "Washington Commanders", short: "Commanders", singular: "Commander", city: "Washington", hub: "/w/", matchups: "/w/m/" },
  };
  const game = (o = {}) => ({ season: 2026, weekLabel: "Week 5", playoff: false, kickoff: "2026-10-11T17:00:00Z", away: "NYG", home: "WAS", awayScore: 27, homeScore: 27, neutral: false, url: null, current: true, ...o });
  const input = (games) => ({
    game: {
      status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 5", kickoff: "2026-10-11T17:00:00.000Z",
      venue: { name: "Northwest Stadium", city: "Washington", state: "DC", neutral: false },
      away: { abbr: "NYG", name: "New York Giants", short: "Giants", quarters: [3, 0, 10, 14], ot: 0 },
      home: { abbr: "WAS", name: "Washington Commanders", short: "Commanders", quarters: [6, 6, 7, 8], ot: 0 },
    },
    teams: TEAMS,
    stats: { away: null, home: null },
    series: { sinceSeason: 2021, games, upcoming: [] },
    links: {},
    faqFacts: { turnovers: { away: 2, home: 0 } },
  });

  test("the turnover answer names no winner", () => {
    const a = body.recapFaq(input([game()])).find((q) => /turnover battle/.test(q.question)).answer;
    assert.match(a, /The game ended in a tie\.$/);
    assert.doesNotMatch(a, /won the game/);
  });

  // The Game info card itself went with WEB-041 (its rows repeat the score
  // header); what WEB-037 asked of it, no winner named for a tie, still holds
  // for the whole body.
  test("a tie names no winner: no Game info card, no Winner row", () => {
    assert.equal(body.renderGameInfo, undefined);
    const html = body.renderRecapBody(input([game()]));
    assert.doesNotMatch(html, /sct-rb-info"/);
    assert.doesNotMatch(html, />Winner</);
  });

  test("a rematch already played later that season is not 'don't meet again'", () => {
    const later = game({ weekLabel: "Week 10", kickoff: "2026-11-15T18:00:00Z", away: "WAS", home: "NYG", awayScore: 24, homeScore: 21, url: "/x/", current: false });
    const html = body.renderFantasyOutlook(input([game(), later]));
    assert.match(html, /met again later in the 2026 season, in Week 10/);
    assert.doesNotMatch(html, /don&#39;t meet again|don't meet again/);
    assert.match(body.renderFantasyOutlook(input([game()])), /don(&#39;|')t meet again this season/);
  });
});

test("the win-probability chart's summary ends a tie at 50%, not 100%", async () => {
  const wp = await importModule("lib/matchup/win-probability");
  const game = {
    status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 5", kickoff: "2026-10-11T17:00:00.000Z", venue: null,
    away: { abbr: "NYG", name: "New York Giants", short: "Giants", quarters: [3, 0, 0, 0], ot: 0 },
    home: { abbr: "WAS", name: "Washington Commanders", short: "Commanders", quarters: [3, 0, 0, 0], ot: 0 },
  };
  const plays = [
    { quarter: 1, clock: "10:00", team: "WAS", type: "field_goal", yards: 30 },
    { quarter: 1, clock: "2:00", team: "NYG", type: "field_goal", yards: 40 },
  ];
  const html = wp.renderWinProbability({ game, plays, odds: null, playerUrl: () => null });
  assert.match(html, /finished at 50% in a tie/);
  assert.doesNotMatch(html, /finished at 100%/);
});

/* ---------------------- a play-by-play that stops short of the box score */

describe("a play-by-play that ends at the go-ahead score while the box score has a later score", () => {
  // The stored play-by-play stops at the home side's go-ahead field goal
  // (17-20); the final box score has the visitors scoring afterward.
  const truncated = {
    season: 2026, week: 1, seasonType: "regular", home: "BBB", away: "AAA",
    drives: [drive({ n: 9, team: "BBB", result: "fg" })],
    plays: [play({ d: 9, t: "BBB", k: "field_goal", c: "00:40", x: "J.Bates 50 yard field goal is GOOD.", score: 1, away: 17, home: 20 })],
  };

  test("the play-by-play alone would call it the end; the scoring list does not", () => {
    assert.equal(facts.endsGameAt(truncated.plays, 0), true);
    const espn = [
      { quarter: 1, clock: "9:00", team: "AAA", type: "pass_td", yards: 10, pat: { type: "kick", result: "good" } },
      { quarter: 2, clock: "9:00", team: "AAA", type: "pass_td", yards: 10, pat: { type: "kick", result: "good" } },
      { quarter: 3, clock: "9:00", team: "AAA", type: "field_goal", yards: 30 },
      { quarter: 1, clock: "5:00", team: "BBB", type: "pass_td", yards: 10, pat: { type: "kick", result: "good" } },
      { quarter: 2, clock: "5:00", team: "BBB", type: "pass_td", yards: 10, pat: { type: "kick", result: "good" } },
      { quarter: 3, clock: "5:00", team: "BBB", type: "field_goal", yards: 30 },
      { quarter: 4, clock: "0:36", team: "BBB", type: "field_goal", yards: 50 },
      // The visitors' answer, which the play-by-play never got.
      { quarter: 4, clock: "0:05", team: "AAA", type: "field_goal", yards: 55 },
    ].sort((a, b) => a.quarter - b.quarter || b.clock.localeCompare(a.clock));
    const out = facts.pbpScoringPlays(espn, truncated, "AAA", "BBB");
    const kick = out.find((p) => p.team === "BBB" && p.yards === 50);
    assert.equal(kick.clock, "0:40", "still re-clocked from its matched row");
    assert.equal(kick.endsGame, undefined, "a later score in the box score means it did not end the game");
    assert.equal(out.some((p) => p.endsGame), false);
  });

  test("a score is the game's last only when the final adds nothing but its try", () => {
    assert.equal(facts.isFinalScore({ awayScore: 17, homeScore: 20 }, { away: 17, home: 20 }, "home", false), true);
    assert.equal(facts.isFinalScore({ awayScore: 20, homeScore: 26 }, { away: 20, home: 27 }, "home", true), true, "a touchdown before its extra point");
    assert.equal(facts.isFinalScore({ awayScore: 20, homeScore: 26 }, { away: 20, home: 27 }, "home", false), false, "a field goal has no try");
    assert.equal(facts.isFinalScore({ awayScore: 17, homeScore: 20 }, { away: 19, home: 20 }, "home", false), false, "a visitors' safety afterward");
    assert.equal(facts.isFinalScore({ awayScore: 17, homeScore: 20 }, { away: 20, home: 20 }, "home", false), false, "the visitors scored afterward");
    assert.equal(facts.isFinalScore({ awayScore: 17, homeScore: 20 }, { away: 17, home: 23 }, "home", false), false, "the home side scored again");
  });

  test("How the Game Swung keeps go-ahead wording when the final shows a later score", () => {
    // Packers-Lions with the Lions' winning kick, but a final that says the
    // Packers scored afterward (a 20-20 tie would have no winner, so: 19-20).
    const ID = "2026_07_GB_DET";
    const pbp = facts.refineDrives(read("pbp", "2026", `${ID}.json`));
    const story = read("game_story_2026.json").games[ID];
    const stored = Object.entries(read("boxscores", "2026.json").games).find(([, g]) => g.week === 7 && g.name === "GB @ DET");
    const box = boxscore.parseEspnSummary(stored[0], stored[1].summary);
    const players = gamePlayers.buildGamePlayers(box.players, null, box.scoringPlays);
    const game = {
      status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 7", kickoff: "2026-10-25T20:25:00.000Z", venue: null,
      away: { abbr: "GB", name: "Green Bay Packers", short: "Packers", quarters: [7, 0, 7, 5], ot: null, score: 19 },
      home: { abbr: "DET", name: "Detroit Lions", short: "Lions", quarters: [7, 3, 7, 3], ot: null, score: 20 },
    };
    const { main } = overview.renderRecapOverviewParts({
      game, story, stats: { away: null, home: null }, players, leaders: [],
      city: { away: "Green Bay", home: "Detroit" }, playerUrl: () => null, photo: () => "", highlights: "",
      inks: { away: "#203731", home: "#0076b6" }, drives: pbp.drives, pbp,
    });
    assert.match(main, /Bates makes the go-ahead field goal\./);
    assert.doesNotMatch(main, /game-winning|on the final play/);
  });
});

/* ------------- the stored game cut short after a go-ahead touchdown */

test("a play-by-play and story cut after Detroit's Q3 go-ahead touchdown never read it as a walk-off", async () => {
  const scoring = await importModule("lib/matchup/scoring-summary");
  const ID = "2026_07_GB_DET";
  const full = facts.refineDrives(read("pbp", "2026", `${ID}.json`));
  const fullStory = read("game_story_2026.json").games[ID];
  // Cut both stores right after the try that followed Goff's 10-yard touchdown (Q3 6:40, DET 17-14).
  const cut = full.plays.findIndex((p) => p.q === 3 && p.k === "extra_point" && p.away === 14 && p.home === 17);
  assert.ok(cut > 0);
  const pbp = { ...full, plays: full.plays.slice(0, cut + 1), drives: full.drives.filter((d) => d.n <= full.plays[cut].d) };
  const story = { ...fullStory, plays: fullStory.plays.filter((p) => p.qtr < 3 || (p.qtr === 3 && p.elapsed <= 2300)) };
  assert.ok(story.plays.at(-1).td && story.plays.at(-1).homeScore === 16, "the story ends on the go-ahead touchdown");

  const stored = Object.entries(read("boxscores", "2026.json").games).find(([, g]) => g.week === 7 && g.name === "GB @ DET");
  const box = boxscore.parseEspnSummary(stored[0], stored[1].summary);
  const game = {
    status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 7", kickoff: "2026-10-25T20:25:00.000Z", venue: null,
    away: { abbr: "GB", name: "Green Bay Packers", short: "Packers", quarters: [7, 0, 7, 3], ot: null },
    home: { abbr: "DET", name: "Detroit Lions", short: "Lions", quarters: [7, 3, 7, 3], ot: null },
  };

  // Scoring summary / FAQ path: the box score still has the two fourth-quarter field goals.
  const plays = facts.pbpScoringPlays(box.scoringPlays, pbp, "GB", "DET");
  assert.equal(plays.some((p) => p.endsGame), false);
  const td = plays.find((p) => p.quarter === 3 && p.team === "DET");
  assert.equal(td.clock, "6:40", "still re-clocked from the rows it has");
  const winner = scoring.runningScore(game, plays).find((s) => s.tag === "winner");
  const faqInput = {
    game, teams: {}, stats: { away: null, home: null }, series: { sinceSeason: 2021, games: [], upcoming: [] }, links: {},
    faqFacts: { winningPlay: { text: "Jake Bates' 22-yard field goal", team: "DET", quarter: winner.play.quarter, clock: winner.play.clock, away: winner.away, home: winner.home, ...(winner.play.endsGame ? { endsGame: true } : {}) } },
  };
  const faq = body.recapFaq(faqInput).map((q) => q.answer).join(" ");
  assert.doesNotMatch(faq, /on the final play/);

  // Overview and recap engine: the story's last score is the go-ahead touchdown, the final is 17-20.
  const players = gamePlayers.buildGamePlayers(box.players, null, box.scoringPlays);
  const { main } = overview.renderRecapOverviewParts({
    game, story, stats: { away: null, home: null }, players, leaders: [],
    city: { away: "Green Bay", home: "Detroit" }, playerUrl: () => null, photo: () => "", highlights: "",
    inks: { away: "#203731", home: "#0076b6" }, drives: pbp.drives, pbp, gameId: ID,
    // The complete box-score sequence: Green Bay ties it 17-17 in the fourth.
    scoring: plays,
  });
  const text = main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#39;/g, "'");
  assert.doesNotMatch(text, /game-winning|on the final play|final play of the game/);
  // The lead did not hold: no "rest of the way", no "for good", only the lead taken.
  assert.doesNotMatch(text, /led the rest of the way|ahead [0-9–]* ?for good|never gave up the lead/);
  assert.match(text, /Detroit took the lead\./);
});

describe("'led the rest of the way' only when the box score's scoring sequence confirms it", () => {
  const sp = (quarter, team, type) => ({ quarter, clock: "5:00", team, type, yards: 10, ...(type === "pass_td" ? { pat: { type: "kick", result: "good" } } : {}) });
  // 7-0 GB, 7-7, then Detroit's Q2 field goal takes a 10-7 lead (the score before it: 7-7).
  const opening = [sp(1, "GB", "pass_td"), sp(1, "DET", "pass_td"), sp(2, "DET", "field_goal")];
  const from = { quarter: 2, side: "home", before: { away: 7, home: 7 } };
  // 7-13, then 10-13: Detroit never trails or is tied again.
  const held = [...opening, sp(3, "DET", "field_goal"), sp(4, "GB", "field_goal")];

  test("an uninterrupted lead through the final is confirmed", () => {
    assert.equal(facts.leadHeldToFinal(held, "GB", "DET", { away: 10, home: 13 }, from), true);
  });

  test("a later tie is not 'the rest of the way'", () => {
    // Green Bay ties it 10-10 in Q3 before Detroit wins it 13-10.
    const tied = [...opening, sp(3, "GB", "field_goal"), sp(4, "DET", "field_goal")];
    assert.equal(facts.leadHeldToFinal(tied, "GB", "DET", { away: 10, home: 13 }, from), false);
  });

  test("a later lead change is not 'the rest of the way'", () => {
    // Green Bay goes ahead 14-10 in Q3; Detroit wins it 17-14.
    const changed = [...opening, sp(3, "GB", "pass_td"), sp(4, "DET", "pass_td")];
    assert.equal(facts.leadHeldToFinal(changed, "GB", "DET", { away: 14, home: 17 }, from), false);
  });

  test("a sequence that does not add up to the final confirms nothing", () => {
    assert.equal(facts.leadHeldToFinal(held.slice(0, 4), "GB", "DET", { away: 10, home: 13 }, from), false, "a dropped score");
    assert.equal(facts.leadHeldToFinal(null, "GB", "DET", { away: 10, home: 13 }, from), false);
  });

  test("a halftime lead the second half erased is not 'never gave up the lead'", () => {
    const erased = [sp(1, "DET", "pass_td"), sp(3, "GB", "pass_td"), sp(4, "DET", "field_goal")];
    assert.equal(facts.halftimeLeadHeld(erased, "GB", "DET", { away: 7, home: 10 }, "home"), false);
    const kept = [sp(1, "DET", "pass_td"), sp(3, "GB", "field_goal"), sp(4, "DET", "field_goal")];
    assert.equal(facts.halftimeLeadHeld(kept, "GB", "DET", { away: 3, home: 10 }, "home"), true);
  });

  test("Broncos at 49ers, Week 4 (stored): San Francisco's lead held, so the recap says so", async () => {
    const ID = "2026_04_DEN_SF";
    const pbp = facts.refineDrives(read("pbp", "2026", `${ID}.json`));
    const story = read("game_story_2026.json").games[ID];
    const stored = Object.entries(read("boxscores", "2026.json").games).find(([, g]) => g.week === 4 && g.name === "DEN @ SF");
    const box = boxscore.parseEspnSummary(stored[0], stored[1].summary);
    const scoring = facts.pbpScoringPlays(box.scoringPlays, pbp, "DEN", "SF");
    const total = (abbr) => scoring.filter((p) => p.team === abbr).reduce((n, p) => n + (p.type === "field_goal" ? 3 : p.type === "safety" ? 2 : 6 + (p.pat?.result === "good" ? (p.pat.type === "kick" ? 1 : 2) : 0)), 0);
    assert.equal(total("SF"), 24);
    assert.equal(total("DEN"), 14);
    const game = {
      status: "final", seasonLabel: "2026", gameType: "regular", roundLabel: "Week 4", kickoff: "2026-10-04T20:25:00.000Z", venue: null,
      away: { abbr: "DEN", name: "Denver Broncos", short: "Broncos", quarters: null, ot: null, score: 14 },
      home: { abbr: "SF", name: "San Francisco 49ers", short: "49ers", quarters: null, ot: null, score: 24 },
    };
    const players = gamePlayers.buildGamePlayers(box.players, null, box.scoringPlays);
    const render = (seq) =>
      overview.renderRecapOverviewParts({
        game, story, stats: { away: null, home: null }, players, leaders: [],
        city: { away: "Denver", home: "San Francisco" }, playerUrl: () => null, photo: () => "", highlights: "",
        inks: { away: "#fb4f14", home: "#aa0000" }, drives: pbp.drives, pbp, scoring: seq,
      }).main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(render(scoring), /San Francisco led the rest of the way\./);
    // Without the box score's sequence the claim cannot be checked, so it is not made.
    const unchecked = render(null);
    assert.doesNotMatch(unchecked, /led the rest of the way/);
    assert.match(unchecked, /San Francisco took the lead\./);
  });
});
