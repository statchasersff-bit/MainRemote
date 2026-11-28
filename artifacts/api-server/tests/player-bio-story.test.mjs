/**
 * The Bio & Career story (mak's brief, 2026-11-28): bioStory() in
 * bio-tab-data.ts. A headline when the facts support one, then the route
 * into the league and what he has done since, in order, with every figure's
 * time frame named and no reasons guessed.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const d = await importModule("lib/player/bio-tab-data");
after(cleanupBundles);

const wk = (week, team, stats) => ({ week, opp: "KC", team, stats });
const stop = (code, name, from, to, over = {}) => ({ code, name, from, to, current: false, games: 0, starts: null, ...over });
const base = (over = {}) => ({
  name: "Jonah Coleman",
  last: "Coleman",
  pos: "RB",
  posWord: "running back",
  status: "active",
  team: { code: "DEN" },
  colleges: ["Arizona", "Washington"],
  draft: { year: 2026, round: 4, pick: 108, team: "DEN" },
  undrafted: null,
  stops: [stop("DEN", "Denver Broncos", 2026, 2026, { current: true })],
  trades: [],
  wikiTx: [],
  proBowls: null,
  allPro: null,
  rings: [],
  logCareer: [
    {
      season: 2026,
      weeks: [
        wk(1, "DEN", { rush_att: 0 }),
        wk(2, "DEN", { rush_att: 10, rush_yd: 40, rush_td: 1, rec: 3, rec_yd: 20 }),
        wk(3, "DEN", { rush_att: 9, rush_yd: 30, rec: 2, rec_yd: 10 }),
        wk(4, "DEN", { rush_att: 11, rush_yd: 50, rush_td: 1, rec: 4, rec_yd: 30 }),
        wk(5, "DEN", { rush_att: 17, rush_yd: 71, rush_td: 1, rec: 4, rec_yd: 68 }),
        wk(6, "DEN", { rush_att: 24, rush_yd: 111, rush_td: 3, rec: 4, rec_yd: 18 }),
      ],
    },
  ],
  currentSeason: 2026,
  fullCareer: true,
  ...over,
});

describe("bioStory", () => {
  test("a rookie: college path, natural draft language, his first games with the club", () => {
    const st = d.bioStory(base());
    assert.equal(st.headline, "From Arizona to Washington and on to Denver");
    assert.deepEqual(st.paragraphs, [
      "Coleman began his college career at Arizona before transferring to Washington. Denver selected the running back in the fourth round of the 2026 NFL Draft with the 108th overall pick.",
      "In his first six regular-season games with the Broncos, Coleman rushed for 302 yards and six touchdowns. He also caught 17 passes for 146 yards, bringing his total to 448 yards from scrimmage.",
    ]);
    assert.doesNotMatch(st.paragraphs.join(" "), /born|high school|No\. \d|fantasy|PPR/i, "Profile facts and fantasy stay out");
  });

  test("a drafted rookie who has yet to play: one paragraph and the fact", () => {
    const st = d.bioStory(base({ logCareer: [] }));
    assert.equal(st.paragraphs.length, 2);
    assert.equal(st.paragraphs[1], "He has yet to appear in a regular-season game.");
  });

  test("an undrafted rookie: the documented signing, its own headline", () => {
    const st = d.bioStory(
      base({
        draft: null,
        undrafted: { year: 2026 },
        colleges: ["Georgia"],
        wikiTx: [{ type: "Signed", date: "2026-05-02", precision: "day", team: "ATL", quote: "", url: "" }],
        stops: [],
        logCareer: [],
      }),
    );
    assert.equal(st.headline, "An undrafted signing with the Falcons");
    assert.match(st.paragraphs[0], /^Coleman played college football at Georgia\. He went undrafted in 2026 and signed with the Atlanta Falcons\.$/);
  });

  test("a draft-day pick trade into his first club is not his trade; a later one is, with its own destination", () => {
    const stops = [
      stop("SF", "San Francisco 49ers", 2019, 2024),
      stop("WAS", "Washington Commanders", 2025, 2025),
      stop("SF", "San Francisco 49ers", 2026, 2026, { current: true }),
    ];
    const weeks = (season, team, n) => ({ season, weeks: Array.from({ length: n }, (_, i) => wk(i + 1, team, { rec: 4, rec_yd: 50 })) });
    const st = d.bioStory(
      base({
        name: "Deebo Samuel", last: "Samuel", pos: "WR", posWord: "wide receiver", colleges: ["South Carolina"],
        draft: { year: 2019, round: 2, pick: 36, team: "SF" },
        stops,
        trades: [
          { date: "2019-04-25", from: "IND", to: "SF", return: [] },
          { date: "2025-03-05", from: "SF", to: "WAS", return: [] },
        ],
        logCareer: [weeks(2019, "SF", 15), weeks(2020, "SF", 7), weeks(2025, "WAS", 16), weeks(2026, "SF", 9)],
      }),
    );
    assert.equal(st.headline, "Back with the 49ers in 2026");
    assert.match(st.paragraphs[1], /^Samuel played for the San Francisco 49ers \(2019 to 2024\), was traded to the Washington Commanders in 2025 and returned to the San Francisco 49ers in 2026\./);
    assert.doesNotMatch(st.paragraphs[1], /traded to the San Francisco 49ers/);
  });

  test("a career that began before the logs: no first-club start year, the span is named", () => {
    const weeks = (season, team, n, yd) => ({ season, weeks: Array.from({ length: n }, (_, i) => wk(i + 1, team, { pass_att: 30, pass_cmp: 20, pass_yd: yd })) });
    const st = d.bioStory(
      base({
        name: "Aaron Rodgers", last: "Rodgers", pos: "QB", posWord: "quarterback", colleges: ["Butte College", "California"],
        draft: { year: 2005, round: 1, pick: 24, team: "GB" },
        stops: [stop("GB", "Green Bay Packers", 2009, 2022), stop("PIT", "Pittsburgh Steelers", 2025, 2026, { current: true })],
        logCareer: [weeks(2011, "GB", 15, 300), weeks(2012, "GB", 16, 250), weeks(2025, "PIT", 10, 200)],
        fullCareer: false,
        proBowls: 10,
      }),
    );
    assert.equal(st.headline, "A ten-time Pro Bowl quarterback");
    assert.match(st.paragraphs[1], /^Rodgers played for the Green Bay Packers through 2022 and joined the Pittsburgh Steelers in 2025\. He has appeared in 41 regular-season games from 2011 through 2025\. His most productive season in that span came in 2011/);
    assert.doesNotMatch(st.paragraphs.join(" "), /first \w+ regular-season|since 2011/);
  });

  test("three schools are listed without an order; an abbreviation ends its sentence once", () => {
    const st = d.bioStory(base({ colleges: ["Oklahoma State", "Garden City CC", "Virginia Commonwealth Univ."] }));
    assert.match(st.paragraphs[0], /^Coleman played college football at Oklahoma State, Garden City CC and Virginia Commonwealth Univ\. Denver/);
    assert.doesNotMatch(st.paragraphs.join(" "), /\.\./);
  });

  test("a former player reads in the past tense", () => {
    const weeks = (season, n) => ({ season, weeks: Array.from({ length: n }, (_, i) => wk(i + 1, "DEN", { rush_att: 10, rush_yd: 40 })) });
    const st = d.bioStory(
      base({
        status: "former", team: null,
        stops: [stop("DEN", "Denver Broncos", 2018, 2023)],
        draft: { year: 2018, round: 2, pick: 40, team: "DEN" },
        logCareer: [2018, 2019, 2020, 2021, 2022, 2023].map((y) => weeks(y, 16)),
      }),
    );
    assert.equal(st.headline, "Six seasons, all with the Broncos");
    assert.match(st.paragraphs[1], /^Coleman spent all six of his NFL seasons with the Broncos, appearing in 96 regular-season games\./);
  });
});
