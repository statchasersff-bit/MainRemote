/**
 * The News tab (lib/player/news-tab.ts, news-tab-data.ts), to mak's News spec
 * of 2026-09-30: week assignment (4.8), generated game recaps and their impact
 * rules (4.5, 4.6), lead selection (4.1), the rule-based takes, sentence case,
 * edge states (4.9) and the filters through the real client bundle (4.2).
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { APP_DIR } from "./helpers/server.mjs";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const d = await importModule("lib/player/news-tab-data");
const tab = await importModule("lib/player/news-tab");

after(cleanupBundles);

const ET = (iso) => Date.parse(iso);
const opp = (code, city, nickname) => ({ code, city, nickname, slug: nickname.toLowerCase() });
// Brissett's 2026: Week 1 at LAC (Sun Sep 13), Week 2 vs SEA (Sun Sep 20),
// Week 3 at SF (Sun Sep 27), a Week 4 bye, Week 5 vs NYG (Sun Oct 11).
const GAMES = [
  { week: 1, kickoffMs: ET("2026-09-13T20:05:00Z"), homeAway: "away", opponent: opp("LAC", "Los Angeles", "Chargers"), opponentName: "Chargers", status: "final", result: { outcome: "W", teamScore: 26, opponentScore: 14 } },
  { week: 2, kickoffMs: ET("2026-09-20T20:05:00Z"), homeAway: "home", opponent: opp("SEA", "Seattle", "Seahawks"), opponentName: "Seahawks", status: "final", result: { outcome: "L", teamScore: 7, opponentScore: 31 } },
  { week: 3, kickoffMs: ET("2026-09-27T20:25:00Z"), homeAway: "away", opponent: opp("SF", "San Francisco", "49ers"), opponentName: "49ers", status: "final", result: { outcome: "L", teamScore: 30, opponentScore: 36 } },
  { week: 5, kickoffMs: ET("2026-10-11T17:00:00Z"), homeAway: "home", opponent: opp("NYG", "New York", "Giants"), opponentName: "Giants", status: "scheduled", result: null },
];

const qb = (week, cmp, att, yd, td, int, pts, rank, rush = {}) => ({
  week,
  opp: "X",
  game_status: "active",
  pos_rank: rank,
  stats: { pts_ppr: pts, pass_cmp: cmp, pass_att: att, pass_yd: yd, pass_td: td, pass_int: int, rush_att: rush.att ?? 0, rush_yd: rush.yd ?? 0, rush_td: rush.td ?? 0 },
});
const LOG = [
  qb(1, 27, 37, 277, 1, 0, 16.5, 15, { att: 6, yd: 14 }),
  qb(2, 17, 28, 95, 1, 1, 7.5, 28, { att: 1, yd: 7 }),
  qb(3, 38, 52, 280, 2, 0, 25.6, 4, { att: 4, yd: 4, td: 1 }),
];

function ctx(overrides = {}) {
  return {
    name: "Jacoby Brissett",
    last: "Brissett",
    pos: "QB",
    season: 2026,
    scoring: "PPR",
    games: GAMES,
    log: LOG,
    points: (e) => e.stats.pts_ppr,
    topTargets: { 1: { name: "Trey McBride", targets: 13 }, 2: { name: "Trey McBride", targets: 10 }, 3: { name: "Michael Wilson", targets: 17 } },
    designation: null,
    practice: null,
    gameLogHref: "/player/jacoby-brissett/game-log/",
    now: ET("2026-09-30T12:00:00Z"),
    ...overrides,
  };
}

const news = (id, iso, title, category, extra = {}) => ({
  id,
  title,
  pubDate: iso,
  pubDateMs: ET(iso),
  playerName: "Jacoby Brissett",
  source: "Dynasty Command",
  link: `https://example.com/${id}`,
  category,
  ...extra,
});

describe("week assignment (spec 4.8)", () => {
  test("from the day after game N through game N+1's day is Week N+1", () => {
    assert.equal(d.groupFor(ET("2026-09-14T15:00:00Z"), GAMES, 2026).label, "Week 2"); // Monday after Week 1
    assert.equal(d.groupFor(ET("2026-09-17T15:00:00Z"), GAMES, 2026).label, "Week 2"); // Thursday practice
    assert.equal(d.groupFor(ET("2026-09-20T23:00:00Z"), GAMES, 2026).label, "Week 2"); // game night
    assert.equal(d.groupFor(ET("2026-09-13T15:00:00Z"), GAMES, 2026).label, "Week 1"); // game-day morning
  });

  test("the seven days after the last game before a bye are the bye week", () => {
    const g = d.groupFor(ET("2026-09-30T15:00:00Z"), GAMES, 2026);
    assert.equal(g.label, "Week 4 (bye)");
    assert.equal(g.result, null);
    assert.equal(d.groupFor(ET("2026-10-06T15:00:00Z"), GAMES, 2026).label, "Week 5");
  });

  test("camp to the day before Week 1 is the preseason; before camp, the offseason", () => {
    assert.equal(d.groupFor(ET("2026-08-20T21:00:00Z"), GAMES, 2026).label, "Preseason");
    assert.equal(d.groupFor(ET("2026-08-20T21:00:00Z"), GAMES, 2026).date, "August");
    assert.equal(d.groupFor(ET("2026-07-08T23:00:00Z"), GAMES, 2026).label, "Offseason");
    assert.equal(d.groupFor(ET("2026-04-25T23:00:00Z"), GAMES, 2026).label, "Offseason");
  });

  test("a final game's chip carries the score and home or away", () => {
    assert.equal(d.groupFor(ET("2026-09-27T12:00:00Z"), GAMES, 2026).result, "L 30–36 @ SF");
    assert.equal(d.groupFor(ET("2026-09-18T12:00:00Z"), GAMES, 2026).result, "L 7–31 vs SEA");
  });
});

describe("game recaps (spec 4.5, 4.6)", () => {
  const { items } = d.buildFeed(ctx(), []);
  const byWeek = (w) => items.find((i) => i.type === "game" && i.group.week === w);

  test("one recap per game he was active in, in its game's week", () => {
    assert.deepEqual(items.filter((i) => i.type === "game").map((i) => i.group.label), ["Week 3", "Week 2", "Week 1"]);
  });

  test("headline templates follow the finish", () => {
    assert.equal(byWeek(3).headline, "Brissett posts season high in loss at San Francisco");
    // Specific headlines (mak, 2026-11-28): the points, or the rank spelled out.
    assert.equal(byWeek(2).headline, "Brissett held to 7.5 fantasy points vs. Seattle");
    assert.match(byWeek(1).headline, /^Brissett scores \d+\.\d fantasy points in win at Los Angeles$/);
    assert.deepEqual(byWeek(3).keyStats, ["280 pass yds", "2 pass TD", "1 rush TD"]);
  });

  test("the summary is the stat line, the score and one usage fact", () => {
    assert.equal(
      byWeek(3).summary,
      "Brissett completed 38 of 52 passes for 280 yards with two touchdowns, and added a rushing score in the 36–30 loss at San Francisco. Michael Wilson led the team with 17 targets.",
    );
  });

  test("impact: top line up, a bust week down, otherwise neutral", () => {
    assert.equal(byWeek(3).impact, "up");
    assert.equal(byWeek(2).impact, "down");
    assert.equal(byWeek(1).impact, "flat");
    assert.equal(d.recapImpact("WR", 30, 10, 10), "flat", "WR30 is inside the 36 line");
    assert.equal(d.recapImpact("RB", 40, 5, 10), "down");
    assert.equal(d.recapImpact("TE", 18, 13, 10), "up", "25% over his average");
  });

  test("outcome tags and the SC takeaway follow the week (2026-10-05)", () => {
    assert.deepEqual(byWeek(3).outcome, { tag: "Ceiling", label: "Ceiling game" });
    assert.deepEqual(byWeek(2).outcome, { tag: "Floor", label: "Floor game" });
    assert.deepEqual(byWeek(1).outcome, { tag: "Solid", label: "Solid starter result" });
    assert.equal(byWeek(3).takeaway, "Volume drove the ceiling: 52 attempts produced his first 25+ point game of 2026.");
    assert.equal(byWeek(2).takeaway, "The Seahawks limited Brissett to 3.4 yards per attempt.");
    assert.equal(byWeek(2).avgDelta.toFixed(1), "-9.0");
  });

  test("the take names points, finish and the season average", () => {
    assert.equal(byWeek(2).take, "7.5 PPR points, a QB28 finish, 9.0 below his season average of 16.5.");
    // Compact rows (mak's News redesign, 2026-10-05).
    assert.deepEqual(byWeek(3).panel.lines, ["38/52 · 280 YDS · 2 TD · 0 INT", "4 CAR · 4 YDS · 1 TD"]);
    assert.equal(byWeek(3).pointsLine, "25.6 fantasy points · QB4");
    assert.equal(byWeek(2).avgNote, "9.0 below his 16.5 average");
    assert.equal(byWeek(3).hasTime, false, "the day is known, the time is not");
  });

  test("a wire recap of the same game merges into it as also reported", () => {
    const wire = news("w3", "2026-09-28T13:15:00Z", "Jacoby Brissett: Season-best game in loss", "recap");
    const feed = d.buildFeed(ctx(), [wire]).items;
    assert.equal(feed.filter((i) => i.group.week === 3).length, 1);
    assert.deepEqual(feed.find((i) => i.group.week === 3).also, [{ name: "Dynasty Command", url: "https://example.com/w3" }]);
  });

  test("a final game with no log line yet leaves a recap-pending week", () => {
    const { pending } = d.buildFeed(ctx({ log: LOG.slice(0, 2) }), []);
    assert.deepEqual(pending.map((g) => g.label), ["Week 3"]);
  });
});

describe("wire items and the lead", () => {
  test("types come from the archive's category; contract words make a contract", () => {
    assert.equal(d.typeOf({ category: "injury", title: "x" }), "status");
    assert.equal(d.typeOf({ category: "performance", title: "x" }), "game");
    assert.equal(d.typeOf({ category: "transaction", title: "Signs two-year extension" }), "contract");
    assert.equal(d.typeOf({ category: "transaction", title: "Released by club" }), "transaction");
    assert.equal(d.typeOf({ category: "depth-chart", title: "x" }), "depth");
    assert.equal(d.typeOf({ category: "rumor", title: "x" }), "analysis");
  });

  test("a status item in a played week says what happened; an upcoming one reads the designation", () => {
    const hip = news("s3", "2026-09-23T21:00:00Z", "Jacoby Brissett: Practices in full despite hip injury", "injury");
    const item = d.buildFeed(ctx(), [hip]).items.find((i) => i.id === "s3");
    assert.equal(item.headline, "Brissett practices in full despite hip injury", "his surname leads the wire's verb (2026-11-28)");
    assert.equal(item.take, "He played in Week 3: 25.6 PPR points, a QB4 finish.");
    const up = news("s5", "2026-10-08T21:00:00Z", "Limited in practice", "practice");
    const late = d.buildFeed(ctx({ designation: "Questionable" }), [news("s5b", "2026-10-08T21:00:00Z", "Listed on report", "injury"), up]).items;
    assert.equal(late.find((i) => i.id === "s5b").take, "He is listed as questionable for Week 5; check his status before kickoff.");
    assert.equal(late.find((i) => i.id === "s5b").impact, "down");
  });

  test("the latest recap leads over newer practice notes until the next week's status item", () => {
    const prac = news("p", "2026-09-29T21:00:00Z", "Takes part in walkthrough", "practice");
    let { items } = d.buildFeed(ctx(), [prac]);
    assert.equal(d.pickLead(items).type, "game");
    const status = news("s", "2026-10-07T21:00:00Z", "Full practice Wednesday", "injury");
    ({ items } = d.buildFeed(ctx(), [prac, status]));
    assert.equal(d.pickLead(items).id, "s");
  });

  test("items before the season's free agency are not this season's", () => {
    const old = news("o", "2026-01-20T21:00:00Z", "Old news", "other");
    assert.equal(d.buildFeed(ctx(), [old]).items.some((i) => i.id === "o"), false);
  });
});

describe("sentence case", () => {
  const players = [
    { name: "Jeremiyah Love", team: "ARI" },
    { name: "Trey McBride", team: "ARI" },
    { name: "Ja'Marr Chase", team: "CIN" },
  ];
  const proper = d.properNouns(players, "ARI");

  test("title case comes down; names, clubs and acronyms stay", () => {
    assert.equal(d.sentenceCase("'Getting Back To My Old Self': Jeremiyah Love Finds His Groove", proper), "'Getting back to my old self': Jeremiyah Love finds his groove");
    assert.equal(d.sentenceCase("Cardinals Can't Chase Down 49ers On The Road", proper), "Cardinals can't chase down 49ers on the road");
    assert.equal(d.sentenceCase("Trey McBride Nasty Stiff-Arm Gains Him Another Nod", proper), "Trey McBride nasty stiff-arm gains him another nod");
    assert.equal(d.sentenceCase("Love Leads NFL Rookies In Yards", proper), "Love leads NFL rookies in yards");
  });

  test("a headline already in sentence case is left alone", () => {
    assert.equal(d.sentenceCase("So many snaps for so many Cardinals on offense", proper), "So many snaps for so many Cardinals on offense");
  });
});

describe("rendered", () => {
  function state(overrides = {}) {
    return {
      player: { name: "Jacoby Brissett", slug: "jacoby-brissett", position: "QB" },
      team: { code: "ARI", slug: "arizona-cardinals", nickname: "Cardinals", fullName: "Arizona Cardinals", city: "Arizona", primaryColor: "#97233F" },
      format: "ppr",
      season: 2026,
      leagueSeason: 2026,
      schedule: GAMES,
      gameLog: LOG,
      weekTopTargets: ctx().topTargets,
      upcoming: [{ week: 5 }],
      designation: null,
      news: [],
      teamNews: [],
      mateNews: [],
      newsMates: [],
      ...overrides,
    };
  }
  const render = (s, o = {}) => new JSDOM(`<body><div data-scp-root>${tab.renderNewsTab(s, { now: ET("2026-09-30T12:00:00Z"), ...o })}</div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });

  // The featured report and the dated list (mak, 2026-11-27).
  test("the newest report is featured with a headshot, the rest form a dated list", () => {
    const doc = render(state()).window.document;
    assert.equal(doc.querySelector(".scp-nwp-card"), null, "no story cards");
    assert.equal(doc.querySelector(".scp-nwp-well"), null, "no image slot anywhere");
    const lead0 = doc.querySelector(".scp-nwp-lead");
    assert.ok(lead0.querySelector(".scp-nwp-lead-face"), "a headshot beside the text");
    assert.equal(lead0.querySelector("h3").textContent, "Brissett posts season high in loss at San Francisco");
    assert.equal(lead0.hasAttribute("data-scp-news-item"), false, "the featured report is not a list row");
    // One stat line, the headline linked to the box score, no impact badge
    // and no takeaway sentence (mak, 2026-11-28).
    assert.equal(lead0.querySelector(".scp-nwp-item-meta.is-stats").textContent.replace(/\s+/g, " "), "25.6 FPTS · Finish: QB4 · 280 pass yds · 2 pass TD · 1 rush TD");
    assert.equal(lead0.querySelector("h3 a").getAttribute("href"), "/nfl/arizona-cardinals-vs-san-francisco-49ers/2026-week-3/");
    assert.equal(lead0.querySelector(".scp-nw-read, .scp-nwp-box, .scp-nwp-item-sum"), null);
    const rows = [...doc.querySelectorAll(".scp-nwp-item")];
    assert.equal(rows.length, 2, "the featured report left out");
    assert.equal(rows[0].querySelector("h4").textContent, "Brissett held to 7.5 fantasy points vs. Seattle", "newest first");
    assert.match(rows[1].querySelector("h4").textContent, /^Brissett scores \d+\.\d fantasy points in win at Los Angeles$/);
    assert.ok(rows.every((r) => r.querySelector(".scp-nwp-item-date time")), "every row carries its day");
    assert.ok(rows.every((r) => r.classList.contains("is-first")), "one row a day here: each prints its day");
    assert.equal(doc.querySelector(".scp-nwp-date, .scp-nwp-day"), null, "no day headings with rules");
    const w2 = rows[0];
    assert.equal(w2.dataset.type, "game");
    assert.equal(w2.dataset.impact, "down");
    // The headline says the points, so the line leads with the rank.
    assert.equal(w2.querySelector(".scp-nwp-item-meta.is-stats").textContent.replace(/\s+/g, " "), "Sep 20 · Finish: QB28 · 95 pass yds · 1 pass TD · 1 INT");
    assert.equal(w2.querySelector(".scp-nwp-item-sum"), null);
    // Three stories: nothing to filter.
    assert.equal(doc.querySelector("[data-scp-news-filter]"), null);
    const signed = news("t", "2026-08-10T21:00:00Z", "Restructures deal", "transaction", { summary: "Brissett reworked his deal. The move clears cap room for the club." });
    const extra = [signed, news("p", "2026-07-08T23:00:00Z", "Expected to start", "status")];
    const moved = render(state({ news: extra })).window.document;
    assert.deepEqual([...moved.querySelectorAll(".scp-nwp-filters button")].map((b) => b.textContent), ["All", "Games", "Status", "Moves"]);
    // The filters sit in the feed's head row (mak, 2026-11-28).
    assert.ok(moved.querySelector(".scp-nwp-feed > .scp-nwp-head > .scp-nwp-filters"));
    const withNews = render(state({ news: [...extra, news("n", "2026-09-01T21:00:00Z", "A feature", "analysis")] })).window.document;
    assert.deepEqual([...withNews.querySelectorAll(".scp-nwp-filters button")].map((b) => b.textContent), ["All", "Games", "Status", "News", "Moves"]);
    const move = moved.querySelector('.scp-nwp-item[data-group="moves"]');
    assert.equal(move.dataset.type, "contract", "a restructure is a contract item");
    assert.equal(move.querySelector(".scp-nwp-item-cat").textContent, "Contract");
    assert.equal(move.querySelector(".scp-nwp-item-sum").textContent, "Brissett reworked his deal. The move clears cap room for the club.", "the first sentence alone adds nothing, two do");
    // Headline first, then "source · time · type".
    assert.ok(move.querySelector(".scp-nwp-item-h + .scp-nwp-item-meta"));
    assert.ok(move.querySelector(".scp-nwp-item-src a"), "a report names its source");
    assert.ok(move.querySelector(".scp-nwp-item-meta time"), "and its time");
    const noMoves = render(state({ news: [news("p", "2026-07-08T23:00:00Z", "Works with teammates", "status"), news("s", "2026-07-09T23:00:00Z", "Expected to start", "status")] })).window.document;
    assert.equal(noMoves.querySelector('[data-f="moves"]'), null);
    // The newest report is featured, whatever its kind.
    const traded = news("t2", "2026-09-29T21:00:00Z", "Traded to the Giants", "transaction");
    const lead = render(state({ news: [traded] })).window.document;
    assert.equal(lead.querySelector(".scp-nwp-lead h3").textContent, "Traded to the Giants (opens in new tab)");
  });

  test("same-day updates both stay, under one day heading, told apart by time", () => {
    const a = news("a", "2026-09-24T16:00:00Z", "Not present Thursday", "status", { summary: "He was not spotted during the open portion of Thursday's practice." });
    const b = news("b", "2026-09-24T21:30:00Z", "Stays DNP on Thursday", "status", { summary: "He was listed as a non-participant on Thursday's injury report with a hamstring issue." });
    const late = news("c", "2026-09-29T21:00:00Z", "Newest", "status");
    const doc = render(state({ news: [a, b, late] })).window.document;
    const rows = [...doc.querySelectorAll('.scp-nwp-item[data-day="Sep 24"]')];
    assert.deepEqual(rows.map((r) => r.querySelector("h4").textContent.replace(" (opens in new tab)", "")), ["Stays DNP on Thursday", "Not present Thursday"]);
    // The day prints beside the first of them only (mak, 2026-11-28).
    assert.deepEqual(rows.map((r) => r.classList.contains("is-first")), [true, false]);
    assert.notEqual(rows[0].querySelector(".scp-nwp-item-meta time").textContent, rows[1].querySelector(".scp-nwp-item-meta time").textContent);
    // A summary only with a material fact: the hamstring, not "not spotted".
    assert.ok(rows[0].querySelector(".scp-nwp-item-sum"));
    assert.equal(rows[1].querySelector(".scp-nwp-item-sum"), null);
  });

  test("a summary that only repeats the headline is dropped", () => {
    assert.equal(tab.addsDetail("Not present Thursday", "Not present at Thursday's practice."), false);
    assert.equal(tab.addsDetail("Not present Thursday", "He was not spotted during the open portion of practice."), true);
  });

  test("no pending or bye rows: the list holds stories only", () => {
    const doc = render(state({ gameLog: LOG.slice(0, 2) })).window.document;
    assert.equal(doc.querySelector(".scp-nw-pending"), null);
    for (const row of doc.querySelectorAll(".scp-nwp-item")) assert.ok(row.querySelector("h4").textContent.trim());
  });

  test("no news at all this season: the newest older item is featured, marked with its season", () => {
    const old = news("o", "2025-12-20T21:00:00Z", "Named starter for finale", "depth-chart");
    const doc = render(state({ gameLog: [], schedule: [], news: [old] })).window.document;
    const card = doc.querySelector(".scp-nwp-lead.is-old");
    assert.match(card.querySelector(".scp-nwp-lead-day").textContent, /^From 2025$/);
    assert.equal(doc.querySelector(".scp-nwp-list"), null, "no list under it");
  });

  test("filters, clicked, through the real client bundle", async () => {
    const bundle = path.join(APP_DIR, "public", "dist", "statchasers-player.js");
    assert.ok(fs.existsSync(bundle), "pnpm test builds the bundle first");
    const extra = [
      news("p", "2026-07-08T23:00:00Z", "Expected to start", "status"),
      news("t", "2026-08-10T21:00:00Z", "Restructures deal", "transaction"),
    ];
    const dom = render(state({ news: extra }));
    dom.window.eval(fs.readFileSync(bundle, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    const shown = () => [...doc.querySelectorAll("[data-scp-news-item]")].filter((i) => !i.hidden).map((i) => i.dataset.type);
    const featured = () => doc.querySelector(".scp-nwp-lead h3").textContent.replace(" (opens in new tab)", "");
    assert.equal(featured(), "Brissett posts season high in loss at San Francisco");
    doc.querySelector('[data-f="status"]').click();
    // The only status report is promoted to the featured slot and leaves the list.
    assert.equal(featured(), "Expected to start");
    assert.deepEqual(shown(), []);
    // No "No updates of this type" note (WEB-044, 2026-11-26): the filters
    // list only kinds the feed has, so it could never show.
    assert.equal(doc.querySelector("#scp-nw-empty"), null);
    doc.querySelector('[data-f="moves"]').click();
    assert.equal(featured(), "Restructures deal");
    assert.deepEqual(shown(), []);
    doc.querySelector('[data-f="game"]').click();
    assert.equal(featured(), "Brissett posts season high in loss at San Francisco", "the server's lead comes back");
    assert.deepEqual(shown(), ["game", "game"]);
    doc.querySelector('[data-f="all"]').click();
    assert.equal([...doc.querySelectorAll("[data-scp-news-item]")].filter((i) => i.hidden).length, 0);
    dom.window.close();
  });
});
