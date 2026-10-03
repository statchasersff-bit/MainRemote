/**
 * The all-time series tiles, intro and FAQ answer (rivalry.ts), driven with
 * plain game lists so every edge the spec names is pinned: a series with no
 * playoff meetings, a tied series, a side that has never won, two clubs from
 * different divisions, and the precomputed-summary path.
 *
 * The Cardinals–Rams case runs on the shipped history file itself, so a
 * rebuild that changes the real numbers shows up here.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const r = await importModule("lib/matchup/rivalry");
after(() => cleanupBundles());

const ARI = { abbr: "ARI", short: "Cardinals", ink: "#97233F" };
const LAR = { abbr: "LAR", short: "Rams", ink: "#003594" };

const game = (season, away, home, awayScore, homeScore, playoff = false, url = null) => ({
  season, date: `${season}-10-01`, away, home, awayScore, homeScore, playoff, url,
});

const tiles = (summary, away = ARI, home = LAR) => {
  const doc = new JSDOM(r.renderAllTimeTiles(summary, away, home)).window.document;
  return [...doc.querySelectorAll(".sct-rb-at")].map((t) => ({
    label: t.querySelector("dt").textContent,
    number: t.querySelector(".sct-rb-at-num").textContent,
    caption: t.querySelector(".sct-rb-at-cap").textContent,
    link: t.querySelector("a")?.getAttribute("href") ?? null,
    none: t.querySelector(".sct-rb-at-num").hasAttribute("data-none"),
  }));
};

describe("Cardinals–Rams, from the shipped history", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../data/rivalry/all-time.json", import.meta.url)));
  const allGames = file.games
    .filter((g) => (g[2] === "ARI" && g[3] === "LAR") || (g[2] === "LAR" && g[3] === "ARI"))
    .filter((g) => g[0] <= 2025)
    .map(([season, date, away, home, awayScore, homeScore, playoff]) => ({
      season, date, away, home, awayScore, homeScore, playoff: playoff === 1, url: null,
    }));
  const input = { intro: null, divisionName: "NFC West", divisionRivalsSince: 2002, allGames };
  const s = r.allTimeSummary(input, "ARI", "LAR");

  test("the tiles read as the spec's example", () => {
    assert.deepEqual(
      tiles(s).map(({ label, number, caption }) => [label, number, caption]),
      [
        ["All-time series", "53–41–2", "Rams lead, 96 meetings since 1937"],
        ["Postseason", "2–0", "Rams won in 1975 and 2021"],
        ["Largest Cardinals win", "44–6", "2016"],
        ["Largest Rams win", "34–0", "2018"],
      ],
    );
  });

  test("the FAQ answer", () => {
    assert.equal(
      r.allTimeAnswer(s, ARI, LAR),
      "The Rams lead the all-time series 53–41–2 across 96 meetings since 1937, including a 2–0 record in the postseason.",
    );
  });

  test("the division streak starts in 2002", () => {
    assert.equal(r.divisionRivalsSince(allGames, "ARI", "LAR", 2025), 2002);
  });

  test("the generated intro, when there is no written one", () => {
    assert.equal(
      r.rivalryIntro(input, s, ARI, LAR),
      "The Cardinals and Rams first met in 1937 and have played 96 times since. They have been NFC West rivals since 2002.",
    );
    assert.equal(r.rivalryIntro({ ...input, intro: "Written." }, s, ARI, LAR), "Written.");
  });

  test("it agrees with a recent series drawn from it, and says when it does not", () => {
    assert.deepEqual(r.validateAllTime(s, { wins: { ARI: 3, LAR: 8 }, ties: 0, games: 11 }), []);
    const wrong = r.validateAllTime(s, { wins: { ARI: 50, LAR: 8 }, ties: 0, games: 58 });
    assert.match(wrong.join("; "), /ARI has 41 all-time wins, fewer than 50 recent ones/);
    const broken = r.validateAllTime({ ...s, meetings: 97 }, { wins: {}, ties: 0, games: 0 });
    assert.match(broken[0], /add up to 96, the meeting count is 97/);
  });
});

describe("edge cases", () => {
  const input = (allGames, extra = {}) => ({ intro: null, divisionName: null, divisionRivalsSince: null, allGames, ...extra });

  test("no playoff meetings", () => {
    const s = r.allTimeSummary(input([game(2001, "ARI", "LAR", 10, 20), game(2002, "LAR", "ARI", 7, 14)]), "ARI", "LAR");
    const t = tiles(s);
    assert.deepEqual([t[1].number, t[1].caption], ["0", "No playoff meetings"]);
    assert.equal(r.allTimeAnswer(s, ARI, LAR), "The all-time series is tied 1–1 across 2 meetings since 2001.");
  });

  test("a tied series, with a tie game", () => {
    const s = r.allTimeSummary(
      input([game(2001, "ARI", "LAR", 10, 20), game(2002, "LAR", "ARI", 7, 14), game(2003, "ARI", "LAR", 3, 3)]),
      "ARI",
      "LAR",
    );
    assert.deepEqual([tiles(s)[0].number, tiles(s)[0].caption], ["1–1–1", "Series tied, 3 meetings since 2001"]);
  });

  test("a side that has never won", () => {
    const s = r.allTimeSummary(input([game(2010, "ARI", "LAR", 10, 20, false, "/nfl/x/2010-week-1/")]), "ARI", "LAR");
    const t = tiles(s);
    assert.deepEqual(t[2], { label: "Largest Cardinals win", number: "-", caption: "No wins yet", link: null, none: true });
    assert.equal(t[3].link, "/nfl/x/2010-week-1/", "a win with a recap page links to it");
  });

  test("two clubs from different divisions get no division clause", () => {
    const s = r.allTimeSummary(input([game(1977, "ARI", "LAR", 31, 0)]), "ARI", "LAR");
    assert.equal(r.rivalryIntro(input([]), s, ARI, LAR), "The Cardinals and Rams first met in 1977 and have played 1 time since.");
  });

  test("the largest win is the biggest margin, the most recent on a tie", () => {
    const s = r.allTimeSummary(input([game(1990, "ARI", "LAR", 30, 10), game(2000, "ARI", "LAR", 21, 1), game(1995, "ARI", "LAR", 40, 30)]), "ARI", "LAR");
    assert.deepEqual([tiles(s)[2].number, tiles(s)[2].caption], ["21–1", "2000"]);
  });

  test("postseason captions: all won, four or more, and a split", () => {
    const po = (season, awayWins) => game(season, "ARI", "LAR", awayWins ? 20 : 10, awayWins ? 10 : 20, true);
    const three = r.allTimeSummary(input([po(1980, true), po(1990, true), po(2000, true)]), "ARI", "LAR");
    assert.equal(tiles(three)[1].caption, "Cardinals won in 1980, 1990, and 2000");
    const four = r.allTimeSummary(input([po(1980, true), po(1990, true), po(2000, true), po(2010, true)]), "ARI", "LAR");
    assert.deepEqual([tiles(four)[1].number, tiles(four)[1].caption], ["4–0", "Cardinals won all 4, most recently in 2010"]);
    const split = r.allTimeSummary(input([po(1980, true), po(1990, false), po(2000, true), po(2010, false), po(2015, false)]), "ARI", "LAR");
    assert.deepEqual([tiles(split)[1].number, tiles(split)[1].caption], ["3–2", "Split 3–2"]);
    const both = r.allTimeSummary(input([po(1980, true), po(1990, false)]), "ARI", "LAR");
    assert.equal(tiles(both)[1].caption, "Cardinals won in 1980; Rams won in 1990");
  });

  test("a precomputed summary is used as given, never mixed with games", () => {
    const summary = {
      meetings: 10, firstMeetingSeason: 1950, wins: { ARI: 4, LAR: 6 }, ties: 0,
      postseasonWins: { ARI: [], LAR: [] }, largestWin: { ARI: null, LAR: null },
    };
    assert.equal(r.allTimeSummary({ intro: null, divisionName: null, divisionRivalsSince: null, allTimeSummary: summary }, "ARI", "LAR"), summary);
  });

  test("the tiles are a real <dl>, one label and value per tile", () => {
    const s = r.allTimeSummary(input([game(2001, "ARI", "LAR", 10, 20)]), "ARI", "LAR");
    const doc = new JSDOM(r.renderAllTimeTiles(s, ARI, LAR)).window.document;
    const dl = doc.querySelector("dl");
    assert.equal(dl.children.length, 4);
    for (const div of dl.children) {
      assert.equal(div.tagName, "DIV");
      assert.deepEqual([...div.children].map((c) => c.tagName), ["DT", "DD"]);
    }
  });
});
