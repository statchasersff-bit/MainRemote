/**
 * The completed-game SEO strings (src/lib/matchup/game-seo.ts), tested as
 * pure functions: the title ladder, the H1, the context line, the intro and
 * the meta description, over the shapes a real game can take - away/home
 * order, ties, a missing score, the postseason, the longest nicknames and a
 * game with no week or no date.
 *
 * Bundled from source the way fpa-step.test.mjs does it, because dist/ is one
 * server bundle and these functions are not reachable from it.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dir = await mkdtemp(path.join(APP_DIR, ".test-bundle-"));
const entry = path.join(dir, "entry.ts");
const outfile = path.join(dir, "module.mjs");
await writeFile(
  entry,
  `export * from "../src/lib/matchup/game-seo";
   export { fitTitle, TITLE_MAX } from "../src/lib/title-fit";`,
  "utf8",
);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
});
const seo = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));

const TITANS = { name: "Tennessee Titans", short: "Titans" };
const COLTS = { name: "Indianapolis Colts", short: "Colts" };
const BUCS = { name: "Tampa Bay Buccaneers", short: "Buccaneers" };
const COMMANDERS = { name: "Washington Commanders", short: "Commanders" };
const JETS = { name: "New York Jets", short: "Jets" };
const GIANTS = { name: "New York Giants", short: "Giants" };

/** The Week 6 game that exposed the gap: Titans (away) 26, Colts (home) 20. */
const WEEK_6 = {
  away: TITANS,
  home: COLTS,
  round: "Week 6",
  postseason: false,
  season: 2026,
  date: "October 18, 2026",
  score: { away: 26, home: 20 },
  overtime: false,
};

const title = (facts) => seo.fitTitle(seo.completedGameTitleCandidates(facts), seo.TITLE_MAX);

describe("a completed regular-season game", () => {
  test("the title leads with the match player stats, away then home", () => {
    const candidates = seo.completedGameTitleCandidates(WEEK_6);
    assert.equal(candidates[0], "Titans vs Colts Match Player Stats & Box Score (Week 6, 2026)");
    // 61 characters: one over the sixty budget, so the year goes first.
    assert.equal(candidates[0].length, 61);
    assert.equal(title(WEEK_6), "Titans vs Colts Match Player Stats & Box Score (Week 6)");
    assert.ok(!/Fantasy/.test(candidates[0]), "fantasy no longer leads the title");
  });

  test("a short pair carries the spec string whole", () => {
    assert.equal(
      title({ ...WEEK_6, away: JETS, home: { name: "Los Angeles Rams", short: "Rams" } }),
      "Jets vs Rams Match Player Stats & Box Score (Week 6, 2026)",
    );
  });

  test("the H1 is the full names, away then home, with the round only when asked", () => {
    assert.equal(seo.completedGameHeading(WEEK_6), "Tennessee Titans vs Indianapolis Colts Match Player Stats");
    assert.equal(
      seo.completedGameHeading(WEEK_6, { round: true }),
      "Tennessee Titans vs Indianapolis Colts Match Player Stats: Week 6, 2026",
    );
  });

  test("the context line is week, date and final, winner first", () => {
    assert.equal(seo.completedGameContext(WEEK_6), "Week 6 · October 18, 2026 · Titans 26, Colts 20");
  });

  test("the intro is two sentences in plain English", () => {
    assert.equal(
      seo.completedGameIntro(WEEK_6),
      "Tennessee Titans vs Indianapolis Colts match player stats from Week 6 of the 2026 NFL season. " +
        "The Titans defeated the Colts 26–20 on October 18, 2026.",
    );
  });

  test("the description names both teams, the week, the contents and the final, within 165", () => {
    const description = seo.completedGameDescription(WEEK_6);
    assert.equal(
      description,
      "Titans vs Colts match player stats from Week 6, 2026: passing, rushing and receiving, box score, " +
        "fantasy points, snaps, targets and usage from the Titans' 26–20 win.",
    );
    assert.ok(description.length >= 140 && description.length <= 165, String(description.length));
    assert.match(description, /match player stats/);
    assert.match(description, /26–20/);
  });

  test("the home side winning reverses the result, not the pair", () => {
    const homeWin = { ...WEEK_6, score: { away: 20, home: 26 } };
    assert.equal(seo.completedGameContext(homeWin), "Week 6 · October 18, 2026 · Colts 26, Titans 20");
    assert.match(seo.completedGameIntro(homeWin), /^Tennessee Titans vs Indianapolis Colts match player stats .* The Colts defeated the Titans 26–20/);
    assert.match(seo.completedGameDescription(homeWin), /^Titans vs Colts match player stats .* from the Colts' 26–20 win\.$/);
    assert.equal(title(homeWin), title(WEEK_6), "the title does not depend on who won");
  });
});

describe("the ladders hold for every pair", () => {
  test("the longest nicknames with the longest round still fit sixty", () => {
    const facts = {
      ...WEEK_6,
      away: BUCS,
      home: COMMANDERS,
      round: "Conference Championship",
      postseason: true,
      season: 2025,
    };
    const fitted = title(facts);
    assert.ok(fitted.length <= 60, fitted);
    assert.equal(fitted, "Buccaneers vs Commanders Stats, Conference Championship");
    // And a long regular-season pair keeps "Match Player Stats" and the year.
    assert.equal(
      title({ ...WEEK_6, away: BUCS, home: COMMANDERS, round: "Week 18" }),
      "Buccaneers vs Commanders Match Player Stats (Week 18, 2026)",
    );
  });

  test("the last title rung fits with no round and no year at all", () => {
    const bare = { ...WEEK_6, away: BUCS, home: COMMANDERS, round: null, season: null };
    const candidates = seo.completedGameTitleCandidates(bare);
    assert.equal(candidates[candidates.length - 1], "Buccaneers vs Commanders Match Player Stats");
    assert.equal(new Set(candidates).size, candidates.length, "no duplicate rungs");
  });

  test("the description falls back to nicknames and a shorter list, never past 165", () => {
    const long = { ...WEEK_6, away: BUCS, home: COMMANDERS, round: "Conference Championship", postseason: true, season: 2025 };
    const description = seo.completedGameDescription(long);
    assert.ok(description.length <= seo.DESCRIPTION_MAX, `${description.length}: ${description}`);
    assert.equal(
      description,
      "Buccaneers vs Commanders match player stats from Conference Championship, 2025: " +
        "passing, rushing, receiving and fantasy points from the Buccaneers' 26–20 win.",
      "the list shrinks before the final is given up",
    );
    // Only a game without a score loses the result clause, and with the room
    // that frees it keeps the fuller list.
    const unscored = seo.completedGameDescription({ ...long, score: null });
    assert.match(unscored, /: passing, rushing and receiving, box score, fantasy points, snaps, targets and usage\.$/);
    assert.ok(unscored.length <= seo.DESCRIPTION_MAX);
  });

  test("full names are used when they fit", () => {
    const short = { ...WEEK_6, away: JETS, home: { name: "Buffalo Bills", short: "Bills" }, score: null };
    assert.match(seo.completedGameDescription(short), /^New York Jets vs Buffalo Bills match player stats from Week 6, 2026: /);
  });
});

describe("unusual results", () => {
  test("a tie reads as a tie everywhere", () => {
    const tie = { ...WEEK_6, score: { away: 20, home: 20 } };
    assert.equal(seo.completedGameContext(tie), "Week 6 · October 18, 2026 · Titans 20, Colts 20 (tie)");
    assert.match(seo.completedGameIntro(tie), /The Titans and the Colts tied 20–20 on October 18, 2026\.$/);
    assert.match(seo.completedGameDescription(tie), / from the 20–20 tie\.$/);
    assert.ok(!/defeated|win/.test(seo.completedGameIntro(tie) + seo.completedGameDescription(tie)));
  });

  test("overtime is said", () => {
    const ot = { ...WEEK_6, score: { away: 26, home: 20 }, overtime: true };
    assert.equal(seo.completedGameContext(ot), "Week 6 · October 18, 2026 · Titans 26, Colts 20 (OT)");
    assert.match(seo.completedGameIntro(ot), /defeated the Colts 26–20 in overtime on October 18, 2026\.$/);
    assert.match(seo.completedGameDescription(ot), /26–20 overtime win\.$/);
  });

  test("a missing score claims no result", () => {
    const unscored = { ...WEEK_6, score: null };
    assert.equal(seo.completedGameContext(unscored), "Week 6 · October 18, 2026");
    assert.equal(
      seo.completedGameIntro(unscored),
      "Tennessee Titans vs Indianapolis Colts match player stats from Week 6 of the 2026 NFL season.",
    );
    assert.match(seo.completedGameDescription(unscored), /usage\.$/);
    assert.ok(!/win|tie|defeated/.test(seo.completedGameDescription(unscored)));
    assert.equal(seo.completedGameScoreText(unscored), null);
  });

  test("two clubs from one city are told apart by nickname", () => {
    const subway = { ...WEEK_6, away: GIANTS, home: JETS, score: { away: 17, home: 21 } };
    assert.match(seo.completedGameIntro(subway), /The Jets defeated the Giants 21–17/);
  });
});

describe("the postseason", () => {
  const WILD_CARD = {
    away: { name: "Arizona Cardinals", short: "Cardinals" },
    home: { name: "Los Angeles Rams", short: "Rams" },
    round: "Wild Card",
    postseason: true,
    season: 2021,
    date: "January 17, 2022",
    score: { away: 11, home: 34 },
    overtime: false,
  };

  test("the round stands where the week would, with its season", () => {
    assert.equal(title(WILD_CARD), "Cardinals vs Rams Match Player Stats & Box Score (Wild Card)");
    assert.equal(seo.completedGameHeading(WILD_CARD, { round: true }), "Arizona Cardinals vs Los Angeles Rams Match Player Stats: Wild Card, 2021");
    assert.equal(seo.completedGameContext(WILD_CARD), "2021 Wild Card · January 17, 2022 · Rams 34, Cardinals 11");
    assert.match(seo.completedGameIntro(WILD_CARD), /^Arizona Cardinals vs Los Angeles Rams match player stats from the Wild Card round of the 2021 NFL playoffs\. /);
  });

  test("a round that already says round, championship or bowl is not doubled", () => {
    for (const round of ["Divisional Round", "Conference Championship", "Super Bowl"]) {
      const intro = seo.completedGameIntro({ ...WILD_CARD, round });
      assert.match(intro, new RegExp(`from the ${round} of the 2021 NFL playoffs\\. `));
      assert.ok(!/round round/i.test(intro), intro);
    }
  });
});

describe("missing schedule data", () => {
  test("no week: the season stands in", () => {
    const facts = { ...WEEK_6, round: null };
    assert.equal(title(facts), "Titans vs Colts Match Player Stats & Box Score (2026)");
    assert.equal(seo.completedGameContext(facts), "2026 season · October 18, 2026 · Titans 26, Colts 20");
    assert.match(seo.completedGameIntro(facts), /match player stats from the 2026 NFL season\. /);
    assert.match(seo.completedGameDescription(facts), /match player stats from the 2026 season: /);
  });

  test("no date: the sentence simply ends", () => {
    const facts = { ...WEEK_6, date: null };
    assert.equal(seo.completedGameContext(facts), "Week 6 · Titans 26, Colts 20");
    assert.match(seo.completedGameIntro(facts), /The Titans defeated the Colts 26–20\.$/);
  });

  test("no week, no year, no date, no score: still a sentence and a title", () => {
    const facts = { ...WEEK_6, round: null, season: null, date: null, score: null };
    assert.equal(title(facts), "Titans vs Colts Match Player Stats & Box Score");
    assert.equal(seo.completedGameHeading(facts, { round: true }), "Tennessee Titans vs Indianapolis Colts Match Player Stats");
    assert.equal(seo.completedGameContext(facts), "");
    assert.equal(seo.completedGameIntro(facts), "Tennessee Titans vs Indianapolis Colts match player stats.");
    assert.equal(
      seo.completedGameDescription(facts),
      "Tennessee Titans vs Indianapolis Colts match player stats: passing, rushing and receiving stats, box score, fantasy points, snaps, targets and usage.",
    );
  });
});
