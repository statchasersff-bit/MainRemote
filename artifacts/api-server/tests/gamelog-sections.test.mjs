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
  lastName: "Brissett",
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

  test("no dot collisions; the average's label dodges the QB15 dot", () => {
    // Ranks 4, 15 and 28 average 15.67 -> QB16, which pins 3.2 units from the
    // QB15 dot, so the average's label takes the second row and the dots keep
    // the first (critique, 2026-10-29).
    assert.equal(doc.querySelector(".scp-gl-pin.is-below"), null);
    assert.equal(doc.querySelector(".is-nolabel"), null);
    const avg = doc.querySelector(".scp-gl-avg");
    assert.equal(avg.style.left, "48.4%");
    assert.ok(avg.classList.contains("is-below"));
    assert.equal(avg.querySelector("strong").textContent, "QB16");
    assert.ok(avg.textContent.includes("Season avg"));
    assert.ok(doc.querySelector(".scp-gl-track").classList.contains("has-below"));
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
    // The one colored dot is labeled for what it is.
    assert.equal(best.querySelector("em").textContent, "Best week");
    assert.equal(doc.querySelectorAll(".scp-gl-pin em").length, 1);
  });

  test("the counts sit beside the heading; the lede paragraph is gone (mak, 2026-10-22)", () => {
    assert.equal(doc.querySelector(".scp-ox-lede"), null);
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-gl-headrow > .scp-gl-sum span")].map((s) => s.textContent),
      ["1 QB1", "1 QB2", "1 bust"],
    );
    assert.equal(doc.querySelector(".scp-gl-sum .scp-gl-avgsum").textContent, "Avg QB16");
    assert.ok(doc.querySelector(".scp-gl-headrow > h2#gl-finishes-h"));
  });

  test("the track reads its weeks best to worst", () => {
    assert.equal(
      doc.querySelector(".scp-gl-track").getAttribute("aria-label"),
      "Weekly finishes on a scale from QB1 to QB32: Week 3 QB4, Week 1 QB15, Week 2 QB28. Season average QB16.",
    );
  });

  test("tier labels sit over their segments and markers cut the band at the cutoffs", () => {
    const tiers = [...doc.querySelectorAll(".scp-gl-tiers span")];
    assert.deepEqual(
      tiers.map((s) => s.textContent),
      ["QB1 range", "QB2 range", "Bust range"],
    );
    // The cutoff ranks sit at the seams and the axis ends are stated.
    const cuts = [...doc.querySelectorAll(".scp-gl-tiers .scp-gl-cut")];
    assert.deepEqual(
      cuts.map((c) => [c.textContent, c.style.left]),
      [["QB1", "0px"], ["QB12", "37.1%"], ["QB24", "75.8%"], ["QB32", "100%"]],
    );
    assert.equal(tiers[0].style.width, "37.1%");
    assert.equal(tiers[1].style.left, "37.1%");
    assert.equal(tiers[2].style.left, "75.8%");
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-gl-mark")].map((m) => m.style.left),
      ["37.1%", "75.8%"],
    );
    // The swatch key and the rank axis are gone.
    assert.equal(doc.querySelector(".scp-gl-key"), null);
    assert.equal(doc.querySelector(".scp-gl-axis"), null);
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
      // No receiver-target attribution (the box score's targets are the
      // club's, not this passer's) and no "came underneath" filler
      // (2026-11-04); his TD passes are his, the scoring play names him.
      "A 52-attempt game while chasing points produced three total touchdowns. " +
        "His TD passes went to Michael Wilson and Jeremiyah Love.",
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
      // The fact without the forecast, the turnover without the "landed well
      // below his season average" tail every card wore (2026-11-04).
      "Just 3.4 yards per attempt. The touchdown kept it from being a total loss. One interception.",
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
      // The "clean, mistake-free start" sentence is gone (2026-11-04).
      "His most efficient game of the season at 7.5 yards per attempt.",
    );
    assert.equal(c.querySelector(".scp-gl-fp b").textContent, "16.5");
    assert.ok(c.querySelector(".scp-gl-fbadge").classList.contains("is-t24"));
  });
});

describe("the game-log audit (2026-11-04)", () => {
  test("a relief appearance is named as one and never called a start", () => {
    const relief = game({
      week: 8, opp: TEAMS.DEN, homeAway: "home",
      result: { wlt: "W", teamScore: 33, oppScore: 30 },
      stats: qbStats({ cmp: 17, att: 23, passYds: 188, passTd: 3 }),
      pts: 19.5, rank: 10, started: false, relief: true,
      usage: { targets: [{ name: "Michael Wilson", targets: 15 }, { name: "Trey McBride", targets: 8 }], tdReceivers: [] },
    });
    const doc = dom(mod.renderBreakdownSection([relief], { ...SEASON, avgAtt: 23, seasonEff: 188 / 23, ppg: 19.5 }));
    const c = doc.querySelector(".scp-gl-game");
    assert.equal(c.querySelector(".scp-gl-head").textContent, "QB1 week in relief vs. Denver");
    assert.equal(c.querySelector(".scp-gl-note").textContent, "Came on in relief; not a start.");
    assert.ok(!doc.body.textContent.includes("throws went to"), "no target attribution");
    assert.ok(!doc.body.textContent.includes("most efficient game"), "one game is nobody's season high");
    assert.ok(!doc.body.textContent.includes("Season high"), "nor its season high");
  });

  test("ordinary games carry their finish, not 'Steady in a loss'", () => {
    const doc = dom(mod.renderBreakdownSection(BRISSETT, SEASON));
    const heads = [...doc.querySelectorAll(".scp-gl-head")].map((h) => h.textContent);
    assert.ok(heads.every((h) => !/^(Steady|Quiet) /.test(h)), heads.join(" | "));
    assert.ok(!doc.body.textContent.includes("season average"), "no 'well above his season average' tail");
  });

  test("a finished season leads with three notable games and folds the rest", () => {
    const games = Array.from({ length: 8 }, (_, i) =>
      game({ week: i + 1, stats: qbStats({ cmp: 20, att: 30, passYds: 200, passTd: 1 }), pts: 12 + (i % 3), rank: 18 }),
    );
    games[2] = game({ week: 3, stats: qbStats({ cmp: 30, att: 40, passYds: 350, passTd: 4 }), pts: 32, rank: 1 });
    games[5] = game({ week: 6, stats: qbStats({ cmp: 10, att: 25, passYds: 90, passInt: 2 }), pts: 1.6, rank: 31 });
    const doc = dom(mod.renderBreakdownSection(games, { ...SEASON, pastTense: true, ppg: 12 }));
    const lead = [...doc.querySelectorAll(".scp-gl-sec > .scp-gl-games .scp-gl-game .scp-gl-when")].map((w) => w.textContent);
    assert.equal(lead.length, 3, "three lead cards");
    assert.ok(lead.includes("Week 3, Sep 13") && lead.includes("Week 6, Sep 13"), lead.join(" | "));
    const more = doc.querySelector("details.scp-gl-more");
    assert.equal(more.querySelector("summary").textContent, "Show all 8 games");
    assert.equal(more.querySelectorAll(".scp-gl-game").length, 5);
    assert.match(doc.querySelector(".scp-gl-lede").textContent, /^The 3 games that stood out/);
    // The season in progress shows every card as before.
    const live = dom(mod.renderBreakdownSection(games, { ...SEASON, ppg: 12 }));
    assert.equal(live.querySelector("details.scp-gl-more"), null);
    assert.equal(live.querySelectorAll(".scp-gl-game").length, 8);
  });

  test("the finishes block: tier tiles with shares, the best week and the average, the ladder behind a control", () => {
    const doc = dom(mod.renderLadderSection(BRISSETT, SEASON));
    const tiles = [...doc.querySelectorAll(".scp-gl-tile")].map((t) => [...t.children].map((c) => c.textContent));
    assert.deepEqual(tiles, [["1", "QB1 weeks", "33% of weeks"], ["1", "QB2 weeks", "33% of weeks"], ["1", "QB25+ weeks", "33% of weeks"]]);
    // No best-week / average line (mak, 2026-11-04): the ladder marks the
    // best week and the headrow carries the average. The ladder stays in
    // view, straight under the tiles.
    assert.equal(doc.querySelector(".scp-gl-bestline"), null);
    assert.equal(doc.querySelector("details.scp-gl-chart"), null);
    assert.ok(doc.querySelector(".scp-gl-tiles + figure.scp-gl-ladder"), "the ladder follows the tiles");
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
    // Both dots keep a label. The average (14.5 -> QB15) lands on the second
    // dot with both rows taken, so ITS label is the one that yields; the
    // headrow still prints "Avg QB15".
    assert.equal(doc.querySelector(".scp-gl-pin.is-nolabel"), null);
    assert.ok(doc.querySelector(".scp-gl-avg").classList.contains("is-nolabel"));
    assert.equal(doc.querySelector(".scp-gl-avgsum").textContent, "Avg QB15");
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
    const labeled = [...doc.querySelectorAll(".scp-gl-pin:not(.is-nolabel)")];
    assert.equal(labeled.length, 2);
    const texts = labeled.map((p) => p.querySelector("strong").textContent).sort();
    assert.deepEqual(texts, ["QB12", "QB3"]);
  });

  test("the compact legend lists every week in order", () => {
    const legend = doc.querySelector(".scp-gl-legend").textContent;
    assert.ok(legend.startsWith("Wk 1 QB3 · Wk 2 QB4"));
    assert.ok(legend.endsWith("Wk 10 QB12"));
  });
});

describe("edges", () => {
  test("a single game gets the one-game lede and one labeled pin", () => {
    const doc = dom(
      mod.renderLadderSection([game({ week: 1, rank: 4, pts: 25 })], SEASON),
    );
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-gl-sum span")].map((s) => s.textContent),
      ["1 game", "QB4"],
    );
    assert.equal(doc.querySelectorAll(".scp-gl-pin").length, 1);
    assert.equal(doc.querySelector(".is-nolabel"), null);
    // One game is its own average: no marker, no "Avg" in the counts.
    assert.equal(doc.querySelector(".scp-gl-avg"), null);
    assert.equal(doc.querySelector(".scp-gl-avgsum"), null);
  });

  test("weeks that finished at the same rank share one dot (critique, 2026-10-29)", () => {
    const doc = dom(
      mod.renderLadderSection(
        [
          game({ week: 1, rank: 15, pts: 16.5, homeAway: "away" }),
          game({ week: 7, rank: 15, pts: 16.5 }),
          game({ week: 3, rank: 4, pts: 25.6 }),
        ],
        SEASON,
      ),
    );
    const pins = [...doc.querySelectorAll(".scp-gl-pin")];
    assert.equal(pins.length, 2);
    const shared = pins.find((p) => p.classList.contains("is-multi"));
    assert.equal(shared.querySelector("strong").textContent, "QB15 ×2");
    assert.deepEqual(
      [...shared.querySelectorAll(".scp-gl-wk")].map((w) => w.textContent.replace(/\s+/g, " ").trim()),
      ["Wk 1 @ DEN", "Wk 7 vs DEN"],
    );
    // The track still names every week.
    assert.ok(doc.querySelector(".scp-gl-track").getAttribute("aria-label").includes("Week 1 QB15, Week 7 QB15"));
  });

  test("an RB ladders to 60 with bands at 24 and 36", () => {
    const doc = dom(
      mod.renderLadderSection(
        [game({ week: 1, rank: 24, pts: 15 })],
        { ...SEASON, pos: "RB", seasonRank: 20 },
      ),
    );
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-gl-tiers span")].map((s) => s.textContent),
      ["RB1 range", "RB2 range", "Bust range"],
    );
    // Bands end at 24.5/59 and 36.5/59.
    assert.deepEqual(
      [...doc.querySelectorAll(".scp-gl-mark")].map((m) => m.style.left),
      ["39.8%", "60.2%"],
    );
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
    const cards = dom(mod.renderBreakdownSection(BRISSETT, past));
    assert.ok(cards.querySelector(".scp-gl-byline").textContent.startsWith("Season summary, updated"));
  });
});

/* ----------------------------------------------- second-half deficit math */

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
