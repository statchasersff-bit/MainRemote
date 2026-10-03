/**
 * The Game Log tab's generated sections - "Where His Weeks Finished" and the
 * "Game-by-Game Breakdown" - against the spec's own test cases.
 *
 * Part 6 of mak's 2026-10-01 spec is Jacoby Brissett's 2026 through Week 3
 * with the expected output written out word for word, and these tests assert
 * exactly that: the pin positions, the lede, the aria-label, each card's
 * headline, stat line and note. Then the spec's "extra tests to write", one
 * by one: label collisions, the 10-game legend, the single game, the RB
 * scale, the best-week tie, the clamped rank.
 *
 * Driven through the pure section renderers with plain input objects, so
 * nothing here depends on what is in the stores the day the suite runs. The
 * one knowing deviation from Part 6: the QB1 band is asserted at 37.1%, not
 * the spec's worked 35.5% - 35.5 is 11/31, the pin position of rank 12,
 * where the spec's own formula and its half-rank rationale (and its QB2
 * worked example, 23.5/31 = 75.8%) put the band edge at 11.5/31. See
 * bandEdges() in src/lib/player/gamelog-sections.ts.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const mod = await importModule("lib/player/gamelog-sections");
after(() => cleanupBundles());

/* ---------------------------------------------------------------- fixtures */

const TEAMS = {
  LAC: { city: "Los Angeles", nickname: "Chargers", abbr: "LAC", useNickname: true },
  SEA: { city: "Seattle", nickname: "Seahawks", abbr: "SEA", useNickname: false },
  SF: { city: "San Francisco", nickname: "49ers", abbr: "SF", useNickname: false },
  DEN: { city: "Denver", nickname: "Broncos", abbr: "DEN", useNickname: false },
};

const qbStats = (o) => ({
  cmp: 0, att: 0, passYds: 0, passTd: 0, passInt: 0,
  car: 0, rushYds: 0, rushTd: 0,
  tgt: 0, rec: 0, recYds: 0, recTd: 0,
  fgm: 0, fga: 0, fgLong: 0, xpm: 0, xpa: 0,
  fumLost: 0,
  ...o,
});

const game = (o) => ({
  week: 1,
  dateMs: Date.UTC(2026, 8, 13, 20, 25),
  opp: TEAMS.DEN,
  homeAway: "home",
  result: { wlt: "W", teamScore: 20, oppScore: 10 },
  stats: qbStats({}),
  pts: 10,
  rank: 20,
  wasUnderdog: false,
  trailing2hBy10: false,
  started: true,
  usage: null,
  override: null,
  ...o,
});

/** The spec's Part 6 input: Brissett, 2026 through Week 3. */
const BRISSETT = [
  game({
    week: 1,
    dateMs: Date.parse("2026-09-13T20:25Z"),
    opp: TEAMS.LAC,
    homeAway: "away",
    result: { wlt: "W", teamScore: 26, oppScore: 14 },
    stats: qbStats({ cmp: 27, att: 37, passYds: 277, passTd: 1, car: 6, rushYds: 14 }),
    pts: 16.48,
    rank: 15,
    wasUnderdog: true,
  }),
  game({
    week: 2,
    dateMs: Date.parse("2026-09-20T17:05Z"),
    opp: TEAMS.SEA,
    homeAway: "home",
    result: { wlt: "L", teamScore: 7, oppScore: 31 },
    stats: qbStats({ cmp: 17, att: 28, passYds: 95, passTd: 1, passInt: 1, car: 1, rushYds: 7 }),
    pts: 7.5,
    rank: 28,
  }),
  game({
    week: 3,
    dateMs: Date.parse("2026-09-27T20:05Z"),
    opp: TEAMS.SF,
    homeAway: "away",
    result: { wlt: "L", teamScore: 30, oppScore: 36 },
    stats: qbStats({ cmp: 38, att: 52, passYds: 280, passTd: 2, car: 4, rushYds: 4, rushTd: 1 }),
    pts: 25.6,
    rank: 4,
    trailing2hBy10: true,
    usage: {
      targets: [
        { name: "Michael Wilson", targets: 17 },
        { name: "Trey McBride", targets: 11 },
      ],
      tdReceivers: ["Michael Wilson", "Jeremiyah Love"],
    },
  }),
];

const SEASON = {
  pos: "QB",
  ppg: (16.48 + 7.5 + 25.6) / 3, // 16.53 as the spec rounds it
  seasonRank: 17,
  avgAtt: 39.0,
  seasonEff: 652 / 117, // 5.6 to one decimal
  pastTense: false,
  updatedWeek: 3,
  updatedDateMs: Date.parse("2026-09-27T20:05Z"),
  hasOverrides: false,
  idSuffix: "",
};

const dom = (html) => new JSDOM(`<div class="scp">${html}</div>`).window.document;

/* ----------------------------------------------------------------- ladder */

describe("where his weeks finished (Brissett, Part 6)", () => {
  const doc = dom(mod.renderLadderSection(BRISSETT, SEASON));

  test("pins sit where the formula puts them, best in team color", () => {
    const pins = [...doc.querySelectorAll(".scp-gl-pin")];
    assert.equal(pins.length, 3);
    const byWeek = Object.fromEntries(
      pins.map((p) => [p.textContent.match(/Wk (\d)/)[1], p]),
    );
    assert.equal(byWeek["3"].style.left, "9.7%");
    assert.equal(byWeek["1"].style.left, "45.2%");
    assert.equal(byWeek["2"].style.left, "87.1%");
    assert.ok(byWeek["3"].classList.contains("is-best"));
    assert.ok(!byWeek["1"].classList.contains("is-best"));
    assert.ok(!byWeek["2"].classList.contains("is-best"));
  });

  test("no collisions: every label above, no below margin", () => {
    assert.equal(doc.querySelector(".is-below"), null);
    assert.equal(doc.querySelector(".is-nolabel"), null);
    assert.ok(!doc.querySelector(".scp-gl-track").classList.contains("has-below"));
  });

  test("bands end at the half-ranks (12.5 and 24.5 on a 32 axis)", () => {
    const [b1, b2] = doc.querySelectorAll(".scp-gl-band");
    assert.equal(b1.style.width, "37.1%");
    assert.equal(b2.style.left, "37.1%");
    assert.equal(b2.style.width, "38.7%");
  });

  test("pin labels carry the finish and the opponent", () => {
    const best = doc.querySelector(".scp-gl-pin.is-best span");
    assert.equal(best.querySelector("strong").textContent, "QB4");
    assert.ok(best.textContent.includes("Wk 3 @ SF"));
  });

  test("the lede is the spec's, word for word", () => {
    assert.equal(
      doc.querySelector(".scp-ox-lede").textContent,
      "One QB1 week, one QB2 week and one bust. For a quarterback ranked QB17 " +
        "overall, the spread matters more than the average: you get a top-5 " +
        "ceiling and a waiver-wire floor.",
    );
  });

  test("the track reads its weeks best to worst", () => {
    assert.equal(
      doc.querySelector(".scp-gl-track").getAttribute("aria-label"),
      "Weekly finishes on a scale from QB1 to QB32: Week 3 QB4, Week 1 QB15, Week 2 QB28.",
    );
  });

  test("axis and key follow the QB scale", () => {
    assert.equal(
      [...doc.querySelectorAll(".scp-gl-axis span")].map((s) => s.textContent).join(" "),
      "QB1 QB12 QB24 QB32",
    );
    const key = doc.querySelector(".scp-gl-key").textContent;
    assert.ok(key.includes("QB1 range (top 12)"));
    assert.ok(key.includes("QB2 range (13–24)"));
    assert.ok(key.includes("Bench range (25+)"));
  });
});

/* ------------------------------------------------------------------ cards */

describe("game-by-game breakdown (Brissett, Part 6)", () => {
  const doc = dom(mod.renderBreakdownSection(BRISSETT, SEASON));
  const cards = [...doc.querySelectorAll(".scp-gl-game")];

  test("one card per game, most recent first", () => {
    assert.deepEqual(
      cards.map((c) => c.querySelector(".scp-gl-when").textContent),
      ["Week 3, Sep 27", "Week 2, Sep 20", "Week 1, Sep 13"],
    );
  });

  test("no byline on generated copy (mak, 2026-10-02)", () => {
    assert.equal(doc.querySelector(".scp-gl-byline"), null);
  });

  test("week 3: season high in a shootout", () => {
    const c = cards[0];
    assert.ok(c.classList.contains("is-t12"));
    assert.equal(c.querySelector(".scp-gl-opp").textContent, "@ 49ers");
    assert.equal(c.querySelector(".scp-gl-score").textContent, "L 30–36");
    assert.ok(c.querySelector(".scp-gl-score").classList.contains("is-l"));
    assert.equal(c.querySelector(".scp-gl-head").textContent, "Season high in a shootout");
    assert.equal(
      c.querySelector(".scp-gl-line").textContent,
      "38/52, 280 yds, 2 TD, 0 INT. 4 carries, 4 yds, 1 TD.",
    );
    assert.equal(
      c.querySelector(".scp-gl-note").textContent,
      "A 52-attempt game while chasing points produced three total touchdowns. " +
        "28 of those throws went to Michael Wilson (17 targets) and Trey McBride (11), " +
        "and his TD passes went to Wilson and Jeremiyah Love. " +
        "At 5.4 yards per attempt, most of it came underneath.",
    );
    assert.equal(c.querySelector(".scp-gl-fp b").textContent, "25.6");
    const badge = c.querySelector(".scp-gl-fbadge");
    assert.equal(badge.textContent, "QB4");
    assert.ok(badge.classList.contains("is-t12"));
  });

  test("week 2: shut down by Seattle", () => {
    const c = cards[1];
    assert.ok(c.classList.contains("is-low"));
    assert.equal(c.querySelector(".scp-gl-opp").textContent, "vs Seahawks");
    assert.equal(c.querySelector(".scp-gl-head").textContent, "Shut down by Seattle");
    assert.equal(
      c.querySelector(".scp-gl-line").textContent,
      "17/28, 95 yds, 1 TD, 1 INT. 1 carry, 7 yds.",
    );
    assert.equal(
      c.querySelector(".scp-gl-note").textContent,
      "Just 3.4 yards per attempt. The touchdown kept it from being a total loss, " +
        "but this is his floor when the offense can't sustain drives. " +
        "One interception in a game that landed well below his season average.",
    );
    assert.equal(c.querySelector(".scp-gl-fp b").textContent, "7.5");
    assert.ok(c.querySelector(".scp-gl-fbadge").classList.contains("is-low"));
  });

  test("week 1: efficient in a road upset", () => {
    const c = cards[2];
    assert.ok(!c.classList.contains("is-t12") && !c.classList.contains("is-low"));
    assert.equal(c.querySelector(".scp-gl-opp").textContent, "@ Chargers");
    assert.equal(c.querySelector(".scp-gl-score").textContent, "W 26–14");
    assert.ok(c.querySelector(".scp-gl-score").classList.contains("is-w"));
    assert.equal(c.querySelector(".scp-gl-head").textContent, "Efficient in a road upset");
    assert.equal(
      c.querySelector(".scp-gl-line").textContent,
      "27/37, 277 yds, 1 TD, 0 INT. 6 carries, 14 yds.",
    );
    assert.equal(
      c.querySelector(".scp-gl-note").textContent,
      "His most efficient game of the season at 7.5 yards per attempt. " +
        "A clean, mistake-free start that landed right at his current season average.",
    );
    assert.equal(c.querySelector(".scp-gl-fp b").textContent, "16.5");
    assert.ok(c.querySelector(".scp-gl-fbadge").classList.contains("is-t24"));
  });
});

/* ------------------------------------------------------------ extra tests */

describe("label collisions", () => {
  test("two pins within 12 units: the second drops below the track", () => {
    const doc = dom(
      mod.renderLadderSection(
        [game({ week: 1, rank: 14, pts: 12 }), game({ week: 2, rank: 15, pts: 11 })],
        { ...SEASON, seasonRank: 14 },
      ),
    );
    const below = doc.querySelectorAll(".scp-gl-pin.is-below");
    assert.equal(below.length, 1);
    assert.ok(doc.querySelector(".scp-gl-track").classList.contains("has-below"));
    assert.equal(doc.querySelector(".is-nolabel"), null);
  });

  test("three pins within 12 units: the third is hidden and named in the caption", () => {
    const doc = dom(
      mod.renderLadderSection(
        [
          game({ week: 1, rank: 14, pts: 12 }),
          game({ week: 2, rank: 15, pts: 11 }),
          game({ week: 5, rank: 16, pts: 10 }),
        ],
        { ...SEASON, seasonRank: 14 },
      ),
    );
    const hidden = doc.querySelectorAll(".scp-gl-pin.is-nolabel");
    assert.equal(hidden.length, 1);
    // The hidden label stays in the DOM for screen readers.
    assert.ok(hidden[0].querySelector("span strong").textContent.startsWith("QB"));
    assert.equal(doc.querySelector(".scp-gl-also").textContent, "Also: Wk 5 (QB16)");
  });
});

describe("ten or more games", () => {
  const games = Array.from({ length: 10 }, (_, i) =>
    game({ week: i + 1, rank: i + 3, pts: 30 - i }),
  );
  const doc = dom(mod.renderLadderSection(games, { ...SEASON, seasonRank: 8 }));

  test("only the best and worst weeks keep labels", () => {
    const labelled = [...doc.querySelectorAll(".scp-gl-pin:not(.is-nolabel)")];
    assert.equal(labelled.length, 2);
    const texts = labelled.map((p) => p.querySelector("strong").textContent).sort();
    assert.deepEqual(texts, ["QB12", "QB3"]);
  });

  test("the compact legend lists every week in order", () => {
    const legend = doc.querySelector(".scp-gl-legend").textContent;
    assert.ok(legend.startsWith("Wk 1 QB3 · Wk 2 QB4"));
    assert.ok(legend.endsWith("Wk 10 QB12"));
  });
});

describe("edges", () => {
  test("a single game gets the one-game lede and one labelled pin", () => {
    const doc = dom(
      mod.renderLadderSection([game({ week: 1, rank: 4, pts: 25 })], SEASON),
    );
    assert.equal(
      doc.querySelector(".scp-ox-lede").textContent,
      "One game in: a QB4 finish. Check back after a few weeks for a real range.",
    );
    assert.equal(doc.querySelectorAll(".scp-gl-pin").length, 1);
    assert.equal(doc.querySelector(".is-nolabel"), null);
  });

  test("an RB ladders to 60 with bands at 24 and 36", () => {
    const doc = dom(
      mod.renderLadderSection(
        [game({ week: 1, rank: 24, pts: 15 })],
        { ...SEASON, pos: "RB", seasonRank: 20 },
      ),
    );
    assert.equal(
      [...doc.querySelectorAll(".scp-gl-axis span")].map((s) => s.textContent).join(" "),
      "RB1 RB24 RB36 RB60",
    );
    const key = doc.querySelector(".scp-gl-key").textContent;
    assert.ok(key.includes("RB1 range (top 24)"));
    assert.ok(key.includes("RB2 range (25–36)"));
    assert.ok(key.includes("Bench range (37+)"));
    // Rank 24 pins at 23/59, inside the band that ends at 24.5.
    assert.equal(doc.querySelector(".scp-gl-pin").style.left, "39%");
  });

  test("a tie for the best week goes to the most recent game", () => {
    const doc = dom(
      mod.renderLadderSection(
        [game({ week: 1, rank: 5, pts: 20 }), game({ week: 4, rank: 6, pts: 20 })],
        SEASON,
      ),
    );
    const best = doc.querySelector(".scp-gl-pin.is-best");
    assert.ok(best.textContent.includes("Wk 4"));
  });

  test("a QB40 clamps to the right edge but keeps its real rank", () => {
    const doc = dom(
      mod.renderLadderSection([game({ week: 1, rank: 40, pts: 2 })], SEASON),
    );
    const pin = doc.querySelector(".scp-gl-pin");
    assert.equal(pin.style.left, "100%");
    assert.equal(pin.querySelector("strong").textContent, "QB40");
  });

  test("no games renders nothing", () => {
    assert.equal(mod.renderLadderSection([], SEASON), "");
    assert.equal(mod.renderBreakdownSection([], SEASON), "");
  });

  test("unknown fumbles silence the clean-game claim instead of guessing", () => {
    // 0 INT but no player block in the box score: sentence 5 must not run.
    const g = game({
      week: 1,
      rank: 15,
      pts: 16,
      stats: qbStats({ cmp: 20, att: 30, passYds: 200, passTd: 1, fumLost: null }),
    });
    const note = mod.noteFor(g, SEASON, { max: 32, t1: 12, t2: 24 }, null);
    assert.ok(!note.includes("mistake-free"));
  });

  test("past-season copy speaks in the past tense", () => {
    const past = { ...SEASON, pastTense: true };
    const doc = dom(mod.renderLadderSection(BRISSETT, past));
    assert.ok(doc.querySelector(".scp-ox-lede").textContent.includes("you got a top-5 ceiling"));
    const cards = dom(mod.renderBreakdownSection(BRISSETT, past));
    assert.ok(cards.querySelector(".scp-gl-byline").textContent.startsWith("Season summary, updated"));
  });
});

/* ----------------------------------------------- second-half deficit maths */

describe("trailing by 10 in the second half", () => {
  const td = (team, quarter) => ({
    quarter,
    clock: "7:00",
    team,
    type: "rush_td",
    yards: 1,
    pat: { type: "kick", result: "good" },
  });

  test("a 14-0 halftime hole counts, even if the second half is even", () => {
    assert.equal(mod.trailedBy10In2h([td("SF", 1), td("SF", 2)], "ARI"), true);
  });

  test("a 7-0 halftime game that stays close does not", () => {
    assert.equal(mod.trailedBy10In2h([td("SF", 1), td("ARI", 3)], "ARI"), false);
  });

  test("a lead lost by 10+ in the fourth counts", () => {
    assert.equal(
      mod.trailedBy10In2h([td("ARI", 1), td("SF", 3), td("SF", 4), td("SF", 4)], "ARI"),
      true,
    );
  });
});
