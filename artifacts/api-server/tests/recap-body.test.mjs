/**
 * The recap body: everything under the scoreboard hero on a recap page.
 *
 * Driven with plain input objects, so the cases the spec names — an away win,
 * a tie, no games left, two nicknames with one initial — do not depend on
 * what ESPN is serving the day the suite runs. The Cardinals–Rams series is
 * the real one (2021 to 2025), in the shape the page builds it.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const body = await importModule("lib/matchup/recap-body");
after(() => cleanupBundles());

const DASH = "–";

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

const TEAMS = {
  ARI: { abbr: "ARI", name: "Arizona Cardinals", short: "Cardinals", singular: "Cardinal", city: "Arizona", hub: "/nfl/teams/arizona-cardinals/", matchups: "/nfl/teams/arizona-cardinals/matchups/" },
  LAR: { abbr: "LAR", name: "Los Angeles Rams", short: "Rams", singular: "Ram", city: "Los Angeles", hub: "/nfl/teams/los-angeles-rams/", matchups: "/nfl/teams/los-angeles-rams/matchups/" },
};

const g = (season, weekLabel, kickoff, away, home, awayScore, homeScore, extra = {}) => ({
  season,
  weekLabel,
  playoff: !/^Week/.test(weekLabel),
  kickoff,
  away,
  home,
  awayScore,
  homeScore,
  neutral: false,
  url: `/nfl/arizona-cardinals-vs-los-angeles-rams/${season}-${weekLabel.toLowerCase().replace(/ /g, "-")}/`,
  current: false,
  ...extra,
});

const SERIES = [
  g(2025, "Week 18", "2026-01-04T21:25:00Z", "ARI", "LAR", 20, 37),
  g(2025, "Week 14", "2025-12-07T21:05:00Z", "LAR", "ARI", 45, 17),
  g(2024, "Week 17", "2024-12-29T01:00:00Z", "ARI", "LAR", 9, 13),
  g(2024, "Week 2", "2024-09-15T20:05:00Z", "LAR", "ARI", 10, 41),
  g(2023, "Week 12", "2023-11-26T21:05:00Z", "LAR", "ARI", 37, 14),
  g(2023, "Week 6", "2023-10-15T20:05:00Z", "ARI", "LAR", 9, 26),
  g(2022, "Week 10", "2022-11-13T21:25:00Z", "ARI", "LAR", 27, 17),
  g(2022, "Week 3", "2022-09-25T20:25:00Z", "LAR", "ARI", 20, 12),
  g(2021, "Wild Card", "2022-01-18T01:15:00Z", "ARI", "LAR", 11, 34, { url: null, current: true }),
  g(2021, "Week 14", "2021-12-14T01:15:00Z", "LAR", "ARI", 30, 23),
  g(2021, "Week 4", "2021-10-03T20:05:00Z", "ARI", "LAR", 37, 20),
];

const UPCOMING = [
  { season: 2026, weekLabel: "Week 6", kickoff: "2026-10-18T20:05:00Z", timeConfirmed: true, away: "ARI", home: "LAR", neutral: false, venueCity: "Inglewood" },
  { season: 2026, weekLabel: "Week 10", kickoff: "2026-11-15T21:05:00Z", timeConfirmed: true, away: "LAR", home: "ARI", neutral: false, venueCity: "Glendale" },
];

const WILD_CARD = {
  game: {
    status: "final",
    seasonLabel: "2021",
    gameType: "playoff",
    roundLabel: "NFC Wild Card",
    kickoff: "2022-01-18T01:15:00.000Z",
    venue: { name: "SoFi Stadium", city: "Inglewood", state: "CA", neutral: false },
    away: { abbr: "ARI", name: "Arizona Cardinals", short: "Cardinals", quarters: [0, 0, 8, 3], ot: null },
    home: { abbr: "LAR", name: "Los Angeles Rams", short: "Rams", quarters: [7, 14, 7, 6], ot: null },
  },
  teams: TEAMS,
  stats: {
    away: stats({ totalYards: 183, yardsPerPlay: 3.4, plays: 54, turnovers: 2, thirdDown: { made: 0, attempts: 9, percent: 0 }, possessionSeconds: 1454 }),
    home: stats({ totalYards: 375, yardsPerPlay: 6.6, plays: 57, turnovers: 0, thirdDown: { made: 6, attempts: 13, percent: 46 }, possessionSeconds: 2146 }),
  },
  series: { sinceSeason: 2021, games: SERIES, upcoming: UPCOMING },
  links: {
    redraftCommand: "https://statchasers.com/redraft-command/",
    startSit: "https://statchasers.com/redraft-command/launch/who-should-i-start/",
    pointsAllowed: "https://statchasers.com/nfl/fantasy-points-allowed-by-position/",
    strengthOfSchedule: "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/",
  },
};

const render = (input) => new JSDOM(`<!doctype html><body>${body.renderRecapBody(input)}</body>`).window.document;
const text = (n) => n?.textContent.replace(/\s+/g, " ").trim() ?? null;

describe("the Cardinals–Rams Wild Card (Rams win, series 8–3)", () => {
  const doc = render(WILD_CARD);

  test("no H1 anywhere; every section heading is an H2", () => {
    assert.equal(doc.querySelectorAll("h1").length, 0);
    assert.deepEqual(
      [...doc.querySelectorAll(".sct-rb-main h2")].map(text),
      [
        "Why the Rams won",
        "Cardinals vs Rams head-to-head",
        "Cardinals vs Rams fantasy outlook for 2026",
        "Cardinals vs Rams FAQ",
        "More Cardinals and Rams",
      ],
    );
  });

  test("why won: the battles, in order, with the city", () => {
    assert.equal(
      text(doc.querySelector("#sct-rb-why ~ .sct-rb-sub")),
      "Los Angeles won the efficiency, turnover, third-down, and time of possession battles.",
    );
  });

  test("why won: a real table, away | stat | home, better side marked", () => {
    const table = doc.querySelector("table.sct-rb-table");
    assert.equal(text(table.querySelector("caption")), "Team stats comparison, Cardinals vs Rams");
    assert.deepEqual([...table.querySelectorAll("thead th")].map(text), ["Cardinals", "Stat", "Rams"]);
    const rows = [...table.querySelectorAll("tr.sct-rb-stat")].map((r) => [...r.children].map(text));
    assert.deepEqual(rows, [
      ["183", "Total yards", "375"],
      ["3.4", "Yards per play", "6.6"],
      ["54", "Plays", "57"],
      ["2", "Turnovers", "0"],
      ["0%", "Third-down conversion", "46%"],
      ["24:14", "Time of possession", "35:46"],
    ]);
    const plays = [...table.querySelectorAll("tr.sct-rb-stat")][2];
    assert.equal(plays.querySelectorAll(".is-better").length, 0, "plays has no better side");
    for (const bar of table.querySelectorAll("tr.sct-rb-barrow")) {
      assert.equal(bar.getAttribute("aria-hidden"), "true");
    }
  });

  test("the turnovers bar favours the side with fewer turnovers", () => {
    const bars = [...doc.querySelectorAll("tr.sct-rb-barrow")];
    const turnovers = bars[3].querySelector(".sct-rb-bar-away").getAttribute("style");
    assert.equal(turnovers, "width:0%", "Arizona's two turnovers get none of the bar");
    assert.equal(body.awayShare({ away: 1, home: 3, better: "lower" }), 75);
    assert.equal(body.awayShare({ away: 0, home: 0, better: "lower" }), 50);
    assert.equal(body.awayShare({ away: 54, home: 57, better: "neither" }), 48.6);
  });

  test("takeaways from the winner's side", () => {
    assert.deepEqual(
      [...doc.querySelectorAll(".sct-rb-takeaways li")].map((li) => [
        text(li.querySelector(".sct-rb-take-value")),
        text(li.querySelector(".sct-rb-take-label")),
      ]),
      [
        ["+192", "Yard advantage for the Rams"],
        ["+2", "Turnover margin, no Rams giveaways"],
        ["+11:32", "More time with the ball"],
      ],
    );
  });

  test("head-to-head: record counted from the scores, tiles oldest first", () => {
    assert.equal(text(doc.querySelector(".sct-rb-h2h-figure")), `8${DASH}3`);
    assert.equal(text(doc.querySelector(".sct-rb-h2h-lead")), "Rams lead");
    assert.equal(
      text(doc.querySelector(".sct-rb-h2h-note")),
      "11 meetings since the 2021 season, regular season and playoffs.",
    );
    const tiles = [...doc.querySelectorAll("ol.sct-rb-tiles li")];
    assert.equal(tiles.map(text).join(""), "CRRRCRRCRRR");
    assert.equal(tiles[0].getAttribute("aria-label"), `2021 Wk 4: Cardinals 37${DASH}20`);
    assert.equal(tiles[0].getAttribute("title"), tiles[0].getAttribute("aria-label"));
    assert.equal(tiles.filter((t) => t.classList.contains("is-current")).length, 1);
    assert.equal(tiles[2].getAttribute("aria-label"), `2021 Wild Card: Rams 34${DASH}11`);
    assert.equal(
      text(doc.querySelector(".sct-rb-legend")),
      "Oldest to newest. R = Rams win, C = Cardinals win, outlined = this game.",
    );
  });

  test("recent meetings: newest first, winner first, this game unlinked", () => {
    const lists = doc.querySelectorAll("ul.sct-rb-meetings");
    assert.equal(lists.length, 2);
    const upcoming = [...lists[0].querySelectorAll("li")];
    assert.equal(upcoming.length, 2);
    assert.match(text(upcoming[0]), /^Week 6 Cardinals at Rams Sun, Oct 18, 2026 Upcoming$/);
    const rows = [...lists[1].querySelectorAll("li")];
    assert.equal(rows.length, 11);
    assert.equal(text(rows[0].querySelector(".sct-rb-mt-label")), "2025 Wk 18");
    assert.equal(text(rows[0].querySelector("time")), "Sun, Jan 4, 2026", "a 2025 game played in January");
    assert.equal(text(rows[0].querySelector(".sct-rb-mt-score")), "LAR 37 ARI 20");
    assert.equal(text(rows[0].querySelector(".sct-rb-chip")), "LAR W");
    const current = rows.find((r) => r.classList.contains("is-current"));
    assert.equal(text(current.querySelector(".sct-rb-mt-label")), "2021 Wild Card");
    assert.equal(current.querySelector("a"), null, "this game is not a link");
    assert.equal(doc.querySelectorAll(".sct-rb-mt-link").length, 10);
    assert.doesNotMatch(doc.body.textContent, /Recap →/);
  });

  test("fantasy outlook: two games left, three tool cards with placements", () => {
    assert.equal(
      text(doc.querySelector("#sct-rb-outlook ~ .sct-rb-sub")),
      "Two meetings are left on the 2026 schedule: Week 6 in Los Angeles and Week 10 in Arizona. " +
        "Here's how to decide who to play in your league.",
    );
    const cards = [...doc.querySelectorAll("a.sct-rb-tool")];
    assert.deepEqual(cards.map((a) => a.getAttribute("data-cta")), [
      "fantasy-outlook-startsit",
      "fantasy-outlook-fpa",
      "fantasy-outlook-sos",
    ]);
    assert.match(text(cards[0]), /start in Week 6\?/);
  });

  test("FAQ: native details, generated answers, link inside the last", () => {
    const items = [...doc.querySelectorAll("details.sct-rb-qa")];
    assert.deepEqual(items.map((d) => text(d.querySelector("summary"))), [
      "Who won the 2021 Cardinals vs Rams Wild Card game?",
      "What is the Cardinals vs Rams record since 2021?",
      "When do the Cardinals and Rams play next?",
      "Should I start Cardinals or Rams players in fantasy when they play each other?",
    ]);
    assert.equal(text(items[0].querySelector("p")), `The Los Angeles Rams won 34${DASH}11 at SoFi Stadium on January 17, 2022.`);
    assert.equal(text(items[1].querySelector("p")), `The Rams lead 8${DASH}3 across 11 meetings, including this Wild Card game.`);
    assert.equal(
      text(items[2].querySelector("p")),
      "Sunday, October 18, 2026: the Cardinals visit the Rams. Sunday, November 15, 2026: the Rams visit the Cardinals.",
    );
    const link = items[3].querySelector("a");
    assert.equal(text(link), "Redraft Command's Start/Sit Tool");
    assert.equal(link.getAttribute("data-cta"), "faq-startsit");
  });

  test("the FAQ JSON-LD says exactly what the page says", () => {
    const items = body.recapFaq(WILD_CARD);
    const ld = JSON.parse(/<script[^>]*>(.*)<\/script>/s.exec(body.recapFaqSchema(items, false))[1]);
    const shown = [...doc.querySelectorAll("details.sct-rb-qa")].map((d) => ({
      q: d.querySelector("summary").textContent,
      a: d.querySelector("p").textContent,
    }));
    assert.deepEqual(
      ld.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text })),
      shown,
    );
  });

  test("sidebar: Redraft Command with singulars, then the game's facts", () => {
    assert.equal(text(doc.querySelector(".sct-rb-redraft h3")), "Got a Cardinal or Ram on your team?");
    assert.match(text(doc.querySelector(".sct-rb-redraft-text")), /before Week 6\.$/);
    assert.equal(doc.querySelector(".sct-rb-button").getAttribute("data-cta"), "recap-sidebar");
    const dl = [...doc.querySelectorAll(".sct-rb-dl dt")].map((dt) => [text(dt), text(dt.nextElementSibling)]);
    assert.deepEqual(dl, [
      ["Round", "NFC Wild Card"],
      ["Date", "Jan 17, 2022"],
      ["Kickoff", "8:15 PM ET"],
      ["Venue", "SoFi Stadium, Inglewood, CA"],
      ["Winner", "Los Angeles Rams"],
      ["Margin", "23 points"],
    ]);
  });

  test("related pages: a labelled nav with four descriptive pills", () => {
    const nav = doc.querySelector('nav[aria-label="Related pages"]');
    assert.deepEqual([...nav.querySelectorAll("a")].map(text), [
      "Arizona Cardinals hub",
      "All Cardinals matchups",
      "Los Angeles Rams hub",
      "All Rams matchups",
    ]);
  });

  test("every <time> carries a datetime", () => {
    for (const t of doc.querySelectorAll("time")) assert.match(t.getAttribute("datetime"), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("changing one score moves everything with it", () => {
  // 2021 Week 14 flipped: Arizona 31, Rams 30.
  const flipped = {
    ...WILD_CARD,
    series: {
      ...WILD_CARD.series,
      games: SERIES.map((s) => (s.weekLabel === "Week 14" && s.season === 2021 ? { ...s, awayScore: 30, homeScore: 31 } : s)),
    },
  };
  const doc = render(flipped);

  test("record, tiles, list, FAQ and JSON-LD", () => {
    assert.equal(text(doc.querySelector(".sct-rb-h2h-figure")), `7${DASH}4`);
    const tile = [...doc.querySelectorAll("ol.sct-rb-tiles li")][1];
    assert.equal(text(tile), "C");
    assert.equal(tile.getAttribute("aria-label"), `2021 Wk 14: Cardinals 31${DASH}30`);
    const row = [...doc.querySelectorAll("ul.sct-rb-meetings")[1].querySelectorAll("li")][9];
    assert.equal(text(row.querySelector(".sct-rb-mt-score")), "ARI 31 LAR 30");
    assert.equal(text(row.querySelector(".sct-rb-chip")), "ARI W");
    const faq = body.recapFaq(flipped)[1].answer;
    assert.equal(faq, `The Rams lead 7${DASH}4 across 11 meetings, including this Wild Card game.`);
    assert.match(body.recapFaqSchema(body.recapFaq(flipped), false), new RegExp(`7${DASH}4`));
  });
});

describe("a game the away team won", () => {
  const input = {
    ...WILD_CARD,
    game: {
      ...WILD_CARD.game,
      gameType: "regular",
      roundLabel: "Week 4",
      away: { ...WILD_CARD.game.away, quarters: [7, 17, 10, 3] },
      home: { ...WILD_CARD.game.home, quarters: [10, 3, 0, 7] },
    },
    stats: {
      away: stats({ totalYards: 465, yardsPerPlay: 6.2, plays: 75, turnovers: 0, thirdDown: { made: 7, attempts: 13, percent: 54 }, possessionSeconds: 2110 }),
      home: stats({ totalYards: 401, yardsPerPlay: 6.3, plays: 64, turnovers: 2, thirdDown: { made: 6, attempts: 11, percent: 55 }, possessionSeconds: 1490 }),
    },
  };
  const doc = render(input);

  test("is headed for the away side and credits Arizona", () => {
    assert.equal(text(doc.querySelector("#sct-rb-why")), "Why the Cardinals won");
    assert.equal(
      text(doc.querySelector("#sct-rb-why ~ .sct-rb-sub")),
      "Arizona won the turnover and time of possession battles.",
    );
    assert.equal(text(doc.querySelectorAll(".sct-rb-take-value")[0]), "+64");
    assert.equal(text(doc.querySelector(".sct-rb-dl dd:nth-of-type(5)")), "Arizona Cardinals");
  });

  test("a figure the winner lost on is swapped, never shown negative", () => {
    const weaker = {
      ...input,
      stats: { ...input.stats, away: { ...input.stats.away, totalYards: 380, yardsPerPlay: 6.8 } },
    };
    const values = [...render(weaker).querySelectorAll(".sct-rb-take-value")].map(text);
    assert.deepEqual(values, ["+0.5", "+2", "+10:20"]);
    assert.ok(values.every((v) => !v.startsWith("-")));
  });
});

describe("a tie", () => {
  const input = {
    ...WILD_CARD,
    game: {
      ...WILD_CARD.game,
      gameType: "regular",
      roundLabel: "Week 3",
      away: { ...WILD_CARD.game.away, quarters: [7, 3, 7, 3], ot: 0 },
      home: { ...WILD_CARD.game.home, quarters: [0, 10, 3, 7], ot: 0 },
    },
    series: {
      ...WILD_CARD.series,
      games: [g(2022, "Week 3", "2022-09-25T20:25:00Z", "ARI", "LAR", 20, 20, { url: null, current: true }), SERIES[6]],
    },
  };
  const doc = render(input);

  test("by the numbers, no takeaways, tie in the series and the facts", () => {
    assert.equal(text(doc.querySelector("#sct-rb-why")), "Cardinals vs Rams by the numbers");
    assert.equal(doc.querySelector(".sct-rb-takeaways"), null);
    const tie = [...doc.querySelectorAll("ol.sct-rb-tiles li")].find((t) => t.classList.contains("is-tie"));
    assert.equal(text(tie), "T");
    assert.equal(tie.getAttribute("aria-label"), `2022 Wk 3: Tie 20${DASH}20`);
    assert.match(text(doc.querySelector(".sct-rb-legend")), /T = tie/);
    assert.equal(text(doc.querySelector(".sct-rb-meetings .is-current .sct-rb-chip")), "T");
    assert.equal(text(doc.querySelector(".sct-rb-h2h-figure")), `1${DASH}0${DASH}1`);
    assert.match(body.recapFaq(input)[0].answer, /^The Arizona Cardinals and Los Angeles Rams tied 20–20/);
    const dl = [...doc.querySelectorAll(".sct-rb-dl dt")].map(text);
    assert.ok(!dl.includes("Margin"));
    assert.equal(text([...doc.querySelectorAll(".sct-rb-dl dd")][4]), "Tie");
  });

  test("an even series says so", () => {
    const even = { ...input, series: { ...input.series, games: [SERIES[0], SERIES[6]] } };
    assert.equal(text(render(even).querySelector(".sct-rb-h2h-lead")), "Series tied");
    assert.match(body.recapFaq(even)[1].answer, /^The series is tied 1–1 across 2 meetings\.$/);
  });
});

describe("no meetings left on the schedule", () => {
  const input = { ...WILD_CARD, series: { ...WILD_CARD.series, upcoming: [] } };
  const doc = render(input);

  test("the fantasy tools stay, without the meetings sentence", () => {
    const outlook = doc.querySelector("#sct-rb-outlook").closest("section");
    assert.equal(text(outlook.querySelector("h2")), "Cardinals and Rams in fantasy");
    assert.equal(
      text(outlook.querySelector(".sct-rb-sub")),
      "The two teams don't meet again this season. If you roster a Cardinal or a Ram, " +
        "these answer the week-to-week question.",
    );
    assert.equal(outlook.querySelectorAll("a.sct-rb-tool").length, 3);
    assert.match(text(outlook), /start this week\?/);
    assert.doesNotMatch(text(outlook), /Week \d/);
  });

  test("no when-next question and no upcoming list; the start/sit question stays", () => {
    const questions = body.recapFaq(input).map((q) => q.question);
    assert.equal(questions.length, 3);
    assert.ok(!questions.some((q) => /play next/.test(q)));
    assert.match(questions[2], /^Should I start/);
    assert.equal(doc.querySelectorAll("details.sct-rb-qa").length, 3);
    assert.equal(doc.querySelectorAll("ul.sct-rb-meetings").length, 1);
  });

  test("the sidebar copy adapts", () => {
    assert.match(text(doc.querySelector(".sct-rb-redraft-text")), /before your next matchup\.$/);
  });
});

describe("two nicknames with one initial", () => {
  const input = {
    ...WILD_CARD,
    game: {
      ...WILD_CARD.game,
      away: { abbr: "KC", name: "Kansas City Chiefs", short: "Chiefs", quarters: [7, 7, 7, 7], ot: null },
      home: { abbr: "LAC", name: "Los Angeles Chargers", short: "Chargers", quarters: [3, 3, 3, 3], ot: null },
    },
    teams: {
      KC: { abbr: "KC", name: "Kansas City Chiefs", short: "Chiefs", singular: "Chief", city: "Kansas City", hub: null, matchups: null },
      LAC: { abbr: "LAC", name: "Los Angeles Chargers", short: "Chargers", singular: "Charger", city: "Los Angeles", hub: null, matchups: null },
    },
    series: {
      sinceSeason: 2021,
      games: [
        g(2024, "Week 4", "2024-09-29T20:25:00Z", "KC", "LAC", 17, 10),
        g(2024, "Week 14", "2024-12-09T01:20:00Z", "LAC", "KC", 17, 19),
        g(2025, "Week 1", "2025-09-06T00:00:00Z", "LAC", "KC", 27, 21),
      ],
      upcoming: [],
    },
  };
  const doc = render(input);

  test("tiles use the abbreviations, widened", () => {
    assert.ok(doc.querySelector("ol.sct-rb-tiles").classList.contains("is-wide"));
    assert.deepEqual([...doc.querySelectorAll("ol.sct-rb-tiles li")].map(text), ["KC", "KC", "LAC"]);
    assert.equal(text(doc.querySelector(".sct-rb-legend")), "Oldest to newest. KC = Chiefs win, LAC = Chargers win.");
    assert.equal(text(doc.querySelector(".sct-rb-redraft h3")), "Got a Chief or Charger on your team?");
  });

  test("no related nav when neither club has an address", () => {
    assert.equal(doc.querySelector('nav[aria-label="Related pages"]'), null);
  });
});
