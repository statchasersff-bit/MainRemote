/**
 * The game recap: prose written from the box score.
 *
 * The Wild Card is asserted word for word, because it is the reference the
 * section was written against and every figure in it is the real box score
 * (ESPN event 401326625). The rest are shape fixtures for the branches: a
 * comeback, overtime, a run that ended in a loss, a Super Bowl, a tie.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { buildRecap, renderRecap, superBowlNumeral, START_SIT_URL } = await importModule(
  "lib/matchup/recap",
);
after(() => cleanupBundles());

const stats = (o) => ({
  plays: null,
  totalYards: null,
  yardsPerPlay: null,
  passYards: null,
  rushYards: null,
  turnovers: null,
  firstDowns: null,
  thirdDown: null,
  redZone: null,
  penalties: null,
  possessionSeconds: null,
  ...o,
});

const team = (abbr, name, short, quarters, ot = null) => ({ abbr, name, short, quarters, ot });

const WILD_CARD = {
  game: {
    status: "final",
    seasonLabel: "2021",
    gameType: "playoff",
    roundLabel: "NFC Wild Card",
    kickoff: "2022-01-18T01:15:00.000Z",
    venue: { name: "SoFi Stadium", city: "Inglewood", state: "CA", neutral: false },
    away: team("ARI", "Arizona Cardinals", "Cardinals", [0, 0, 8, 3]),
    home: team("LAR", "Los Angeles Rams", "Rams", [7, 14, 7, 6]),
  },
  awayCity: "Arizona",
  homeCity: "Los Angeles",
  awayStats: stats({
    totalYards: 183,
    yardsPerPlay: 3.4,
    plays: 54,
    turnovers: 2,
    thirdDown: { made: 0, attempts: 9, percent: 0 },
    possessionSeconds: 24 * 60 + 14,
  }),
  homeStats: stats({
    totalYards: 375,
    yardsPerPlay: 6.6,
    plays: 57,
    turnovers: 0,
    thirdDown: { made: 6, attempts: 13, percent: 46 },
    possessionSeconds: 35 * 60 + 46,
  }),
  winnerPostseason: [
    { round: "Wild Card", week: 1, outcome: "W", teamScore: 34, opponentScore: 11, opponent: "Cardinals" },
    { round: "Divisional Round", week: 2, outcome: "W", teamScore: 30, opponentScore: 27, opponent: "Buccaneers" },
    { round: "Conference Championship", week: 3, outcome: "W", teamScore: 20, opponentScore: 17, opponent: "49ers" },
    { round: "Super Bowl", week: 5, outcome: "W", teamScore: 23, opponentScore: 20, opponent: "Bengals" },
  ],
  next: { label: "Week 6", season: "2026" },
  notes: ["The win was Matthew Stafford's first career playoff victory."],
};

describe("the Cardinals–Rams Wild Card", () => {
  const recap = buildRecap(WILD_CARD);

  test("reads as written, every figure from the box score", () => {
    assert.equal(
      recap.headline,
      "Rams 34, Cardinals 11: Los Angeles controls the 2021 Wild Card from start to finish",
    );
    assert.equal(
      recap.dek,
      "The Rams led 21–0 at halftime and finished with 375 yards to 183.",
    );
    assert.deepEqual(recap.paragraphs, [
      "Los Angeles led 21–0 at halftime after scoring 14 points in the second quarter. " +
        "Arizona didn't get on the board until the third quarter. " +
        "The Rams added 13 more after the break.",
      "The gap showed up everywhere. The Rams gained 375 yards to Arizona's 183 and averaged " +
        "6.6 yards per play against 3.4. The Cardinals went 0-for-9 on third down and committed " +
        "two turnovers, while the Rams kept the ball for 35:46 and finished without a giveaway.",
      "The win was Matthew Stafford's first career playoff victory. " +
        "It started the run that ended with the Rams winning Super Bowl LVI.",
      "The two teams meet again in Week 6 of 2026. If you roster anyone from either side, run " +
        "the start/sit call in Redraft Command and it will weigh your lineup, your opponent and " +
        "your league scoring, not only the player rankings.",
    ]);
  });

  test("renders an H2 headline, never an H1, with the start/sit link", () => {
    const doc = new JSDOM(renderRecap(recap)).window.document;
    assert.equal(doc.querySelectorAll("h1").length, 0);
    assert.equal(doc.querySelector("h2").textContent, recap.headline);
    assert.equal(doc.querySelector("section").id, "recap");
    assert.match(doc.querySelector(".sct-mu-story-dek").textContent, /^The Rams led 21–0/);
    const link = doc.querySelector("a");
    assert.equal(link.textContent, "run the start/sit call in Redraft Command");
    assert.equal(link.getAttribute("href"), START_SIT_URL);
    assert.equal(link.getAttribute("data-cta"), "recap-startsit");
  });

  test("links the first mention of each player, and only the first", () => {
    const urls = { "Matthew Stafford": "/nfl/players/matthew-stafford/" };
    const html = renderRecap(
      { ...recap, paragraphs: [...recap.paragraphs.slice(0, 3), "Matthew Stafford again.", recap.paragraphs[3]] },
      { playerNames: ["Matthew Stafford", "Cooper Kupp"], playerUrl: (n) => urls[n] ?? null },
    );
    const doc = new JSDOM(html).window.document;
    const players = [...doc.querySelectorAll("a.sct-player-link")];
    assert.equal(players.length, 1, "one link: Stafford's first mention; Kupp has no page");
    assert.equal(players[0].textContent, "Matthew Stafford");
    assert.equal(players[0].getAttribute("href"), urls["Matthew Stafford"]);
    assert.match(players[0].closest("p").textContent, /first career playoff victory/);
  });

  test("without notes, the run sentence carries its own subject", () => {
    const plain = buildRecap({ ...WILD_CARD, notes: [] });
    assert.equal(
      plain.paragraphs[2],
      "The win started the run that ended with the Rams winning Super Bowl LVI.",
    );
  });

  test("without a next meeting, the closing start/sit paragraph goes", () => {
    const quiet = buildRecap({ ...WILD_CARD, next: null });
    assert.equal(quiet.startSit, false);
    assert.doesNotMatch(quiet.paragraphs.join(" "), /meet again|start\/sit/);
    assert.equal(new JSDOM(renderRecap(quiet)).window.document.querySelector("[data-cta]"), null);
  });

  test("with no box score, the prose is the quarters alone and claims nothing else", () => {
    const bare = buildRecap({ ...WILD_CARD, awayStats: null, homeStats: null, notes: [], winnerPostseason: null, next: null });
    assert.equal(bare.dek, "The Rams led 21–0 at halftime.");
    assert.equal(bare.paragraphs.length, 1, "the quarters alone");
    assert.doesNotMatch(bare.paragraphs[0], /yards|third down|turnover/);
  });
});

describe("the other shapes", () => {
  test("a run that ended in a loss says where and to whom", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      notes: [],
      winnerPostseason: [
        WILD_CARD.winnerPostseason[0],
        { round: "Divisional Round", week: 2, outcome: "L", teamScore: 27, opponentScore: 30, opponent: "Buccaneers" },
      ],
    });
    assert.equal(recap.paragraphs[2], "The Rams' run ended in the Divisional Round, a 30–27 loss to the Buccaneers.");
  });

  test("a comeback leads with the rally", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      game: {
        ...WILD_CARD.game,
        gameType: "regular",
        roundLabel: "Week 14",
        away: team("ARI", "Arizona Cardinals", "Cardinals", [7, 10, 0, 3]),
        home: team("LAR", "Los Angeles Rams", "Rams", [0, 3, 14, 10]),
      },
      winnerPostseason: null,
      notes: [],
    });
    assert.equal(recap.headline, "Rams 27, Cardinals 20: Los Angeles rallies from 14 down at halftime");
    assert.match(recap.dek, /^The Rams trailed 17–3 at halftime/);
    assert.match(recap.paragraphs[0], /The Rams outscored Arizona 24–3 after the break\.$/);
  });

  test("overtime is in the headline and the flow", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      game: {
        ...WILD_CARD.game,
        roundLabel: "AFC Divisional Round",
        away: team("BUF", "Buffalo Bills", "Bills", [0, 7, 3, 26], 0),
        home: team("KC", "Kansas City Chiefs", "Chiefs", [3, 14, 0, 19], 6),
      },
      awayCity: "Buffalo",
      homeCity: "Kansas City",
      winnerPostseason: null,
      notes: [],
    });
    assert.equal(recap.headline, "Chiefs 42, Bills 36: Kansas City wins the 2021 Divisional Round in overtime");
    assert.match(recap.dek, /^The Chiefs led 17–7 at halftime and finished with \d+ yards to \d+\.$/);
    assert.match(recap.paragraphs[0], /Kansas City won it with six points in overtime\.$/);
  });

  test("a Super Bowl ends at the title", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      game: {
        ...WILD_CARD.game,
        seasonLabel: "2024",
        roundLabel: "Super Bowl",
        away: team("KC", "Kansas City Chiefs", "Chiefs", [0, 0, 6, 16]),
        home: team("PHI", "Philadelphia Eagles", "Eagles", [7, 17, 10, 6]),
      },
      awayCity: "Kansas City",
      homeCity: "Philadelphia",
      notes: [],
    });
    assert.match(recap.dek, /^The Eagles led 24–0 at halftime/);
    assert.doesNotMatch(recap.paragraphs.join(" "), /went on to|the run that|run ended/);
  });

  test("a tie gets the score and the halftime, and claims no winner", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      game: {
        ...WILD_CARD.game,
        away: team("IND", "Indianapolis Colts", "Colts", [0, 3, 0, 17], 0),
        home: team("HOU", "Houston Texans", "Texans", [7, 6, 7, 0], 0),
      },
    });
    assert.match(recap.headline, /^Colts 20, Texans 20: .* tie in 2021 Wild Card$/);
    assert.match(recap.dek, /^The Texans led 13–3 at halftime/);
    assert.doesNotMatch(`${recap.headline} ${recap.dek} ${recap.paragraphs.join(" ")}`, /\bwon\b|\bwins\b|\bbeat\b/);
  });

  test("two clubs from one city are told apart by nickname", () => {
    const recap = buildRecap({
      ...WILD_CARD,
      game: {
        ...WILD_CARD.game,
        gameType: "regular",
        roundLabel: "Week 3",
        away: team("LAC", "Los Angeles Chargers", "Chargers", [0, 3, 7, 7]),
        home: team("LAR", "Los Angeles Rams", "Rams", [7, 14, 7, 6]),
      },
      awayCity: "Los Angeles",
      homeCity: "Los Angeles",
      winnerPostseason: null,
      notes: [],
    });
    assert.equal(recap.headline, "Rams 34, Chargers 17: The Rams lead from start to finish");
    assert.match(recap.paragraphs[0], /^The Rams led 21\u20133 at halftime/);
    assert.doesNotMatch(recap.paragraphs.join(" "), /Los Angeles/);
  });

  test("Super Bowl numerals", () => {
    assert.equal(superBowlNumeral(2021), "LVI");
    assert.equal(superBowlNumeral(2024), "LIX");
    assert.equal(superBowlNumeral(2015), "L");
  });
});
