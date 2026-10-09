/**
 * Fantasy strength of schedule.
 *
 * Two halves, like fpa.test.mjs. The model (lib/sos/sos-model.ts) is pure, so
 * it is loaded on its own and handed a made-up FPA table and schedule whose
 * answers can be worked out by hand - that is where the source app's rules
 * (rank 1 = toughest defense, rank 1 = easiest schedule, weeks 1-17, the
 * PO2/PO3 spans, dense player ranks) are pinned. The routes are then checked
 * over HTTP against whatever the database holds, and skip their data
 * assertions when no FPA has been ingested.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";
import { importModule } from "./helpers/bundle.mjs";

const model = await importModule("lib/sos/sos-model");
const { TEAMS } = await importModule("lib/team/teams");
const render = await importModule("lib/sos-render");
const faq = await importModule("lib/sos-faq");

/* ------------------------------------------------------------- fixtures */

// RB aFPA rises with the team's index: TEAMS[0] is the stingiest defense.
const adj = (i) => 15 + i * 0.3;

function fpaTable() {
  return {
    rows: TEAMS.map((team, i) => ({
      team,
      abbr: team.code,
      name: team.fullName,
      gamesPlayed: 3,
      byPos: {
        QB: { fpa: 18, rank: 1 },
        RB: { fpa: adj(i), rank: 32 - i },
        WR: { fpa: 30 - i * 0.2, rank: i + 1 },
        TE: { fpa: 9, rank: 1 },
      },
      offFpa: 70,
      offRank: 1,
    })),
    season: 2026,
    format: "ppr",
    view: "adjusted",
    weekNumber: 3,
    isPreseason: false,
    dataMode: "Week 3",
    methodology: "40% 2025 baseline and 60% 2026 data.",
    version: "fixture-1",
  };
}

/** 17 weeks of a circle-method round robin; week 6 gives TEAMS[0] and its opponent a bye. */
function schedule() {
  const n = TEAMS.length;
  const idx = [...Array(n).keys()];
  const games = [];
  for (let week = 1; week <= 17; week += 1) {
    for (let k = 0; k < n / 2; k += 1) {
      const a = idx[k];
      const b = idx[n - 1 - k];
      if (week === 6 && (a === 0 || b === 0)) continue;
      const [home, away] = week % 2 ? [a, b] : [b, a];
      games.push({
        week,
        home: TEAMS[home],
        away: TEAMS[away],
        // Weeks 1-3 are done, and one week-4 game is too: ROS starts at 4.
        status: week < 4 || (week === 4 && k === 0) ? "final" : "scheduled",
      });
    }
    idx.splice(1, 0, idx.pop());
  }
  return { season: 2026, games, liveNow: false, fetchedAt: 0, version: "sched-1" };
}

const POOL = {
  builtAt: "2026-09-30T00:00:00Z",
  players: [
    { id: "1", name: "Alpha Back", slug: "alpha-back", team: TEAMS[5].code, position: "RB", maxProj: { ppr: 20, half: 18, std: 16 } },
    { id: "2", name: "Beta Back", slug: "beta-back", team: TEAMS[5].code, position: "RB", maxProj: { ppr: 25, half: 22, std: 19 } },
    { id: "3", name: "Gamma Back", slug: null, team: TEAMS[9].code, position: "RB", maxProj: { ppr: 12, half: 11, std: 10 } },
    { id: "4", name: "Delta Receiver", slug: "delta-receiver", team: TEAMS[5].code, position: "WR", maxProj: { ppr: 19, half: 16, std: 13 } },
    { id: "5", name: "Nobody Anywhere", slug: null, team: "XXX", position: "RB", maxProj: { ppr: 30, half: 30, std: 30 } },
  ],
};

const board = model.buildSosBoard(fpaTable(), schedule(), POOL, "RB", "ppr");
const rowOf = (abbr) => board.teams.find((r) => r.team.abbreviation === abbr);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ---------------------------------------------------------------- model */

describe("the model", () => {
  test("buckets by defense rank, 1 = toughest (the source's thresholds)", () => {
    const b = model.bucketFromRank;
    assert.deepEqual([1, 5, 6, 10, 11, 22, 23, 27, 28, 32].map(b), [
      "avoid", "avoid", "tough", "tough", "neutral", "neutral", "favorable", "favorable", "smash", "smash",
    ]);
    // A schedule rank runs the other way: 1 is the easiest.
    assert.equal(model.bucketFromScheduleRank(1), "smash");
    assert.equal(model.bucketFromScheduleRank(32), "avoid");
  });

  test("a view has one spelling per value, and anything else is the default", () => {
    assert.deepEqual(model.parseSosState({}), { tab: "team", position: "RB", scoring: "ppr" });
    assert.deepEqual(model.parseSosState({ tab: "player", pos: "wr", scoring: "half-ppr" }), {
      tab: "player", position: "WR", scoring: "half-ppr",
    });
    assert.deepEqual(model.parseSosState({ tab: "fpa", pos: "k", scoring: "half" }), {
      tab: "team", position: "RB", scoring: "ppr",
    });
  });

  test("each cell is the opponent's position aFPA and rank, 1 = the stingiest", () => {
    const stingy = TEAMS[0];
    const game = schedule().games.find((g) => g.week === 1 && (g.home === stingy || g.away === stingy));
    const opp = game.home === stingy ? game.away : game.home;
    const oppRow = rowOf(opp.abbreviation);
    const cell = oppRow.weeks[0];
    assert.equal(cell.opponent.abbreviation, stingy.abbreviation);
    assert.equal(cell.afpa, adj(0));
    assert.equal(cell.rank, 1);
    assert.equal(cell.bucket, "avoid");
    assert.equal(cell.isHome, game.home === opp);
  });

  test("seventeen weeks, and a bye is a bye", () => {
    const row = rowOf(TEAMS[0].abbreviation);
    assert.equal(row.weeks.length, 17);
    const bye = row.weeks[5];
    assert.equal(bye.week, 6);
    assert.equal(bye.isBye, true);
    assert.equal(bye.afpa, null);
  });

  test("ROS starts at the first week with a game not yet final", () => {
    assert.equal(board.rosFrom, 4);
    const row = board.teams[0];
    const expected = mean(row.weeks.filter((c) => c.week >= 4 && c.afpa !== null).map((c) => c.afpa));
    assert.ok(Math.abs(row.ros.afpa - expected) < 1e-9);
  });

  test("schedule ranks are dense, 1 = the easiest (highest average aFPA)", () => {
    const ranks = board.teams.map((r) => r.overallRank);
    assert.equal(ranks[0], 1);
    assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, "rows arrive in OVR order");
    const unique = [...new Set(ranks)];
    assert.deepEqual(unique, unique.map((_, i) => i + 1), "no gaps");
    const best = board.teams.reduce((a, b) => (b.fullAfpa > a.fullAfpa ? b : a));
    assert.equal(best.overallRank, 1);
  });

  test("PO3 is weeks 15-17, PO2 weeks 16-17, each ranked 1 = toughest", () => {
    for (const row of board.teams) {
      const avg = (weeks) => mean(row.weeks.filter((c) => weeks.includes(c.week) && c.afpa !== null).map((c) => c.afpa));
      assert.ok(Math.abs(row.po3.afpa - avg([15, 16, 17])) < 1e-9);
      assert.ok(Math.abs(row.po2.afpa - avg([16, 17])) < 1e-9);
    }
    const toughest = board.teams.reduce((a, b) => (b.po3.afpa < a.po3.afpa ? b : a));
    assert.equal(toughest.po3.rank, 1);
    assert.equal(toughest.po3.bucket, "avoid");
  });

  test("the four cards: easiest and toughest, full season and playoffs, against the mean", () => {
    assert.deepEqual(board.teamCards.map((c) => c.id), [
      "easiest-full", "toughest-full", "easiest-playoff", "toughest-playoff",
    ]);
    const full = board.teams.map((r) => r.fullAfpa);
    const [easy, hard] = board.teamCards;
    assert.equal(easy.afpa, Math.max(...full));
    assert.equal(hard.afpa, Math.min(...full));
    assert.ok(Math.abs(easy.delta - (easy.afpa - mean(full))) < 1e-9);
    assert.equal(easy.note, "Best RB schedule by opponent aFPA.");
    assert.equal(easy.sortKey, "ovr");
    assert.equal(hard.dir, "desc");
    assert.equal(board.playerCards[0].note, "Best RB slate by opponent aFPA.");
  });

  test("players take their team's schedule and share its rank, deepest projection first", () => {
    assert.deepEqual(board.players.map((p) => p.name).sort(), ["Alpha Back", "Beta Back", "Gamma Back"]);
    const [a, b] = ["Alpha Back", "Beta Back"].map((n) => board.players.find((p) => p.name === n));
    assert.equal(a.overallRank, b.overallRank);
    assert.ok(board.players.indexOf(b) < board.players.indexOf(a), "25 projected before 20");
    assert.deepEqual(a.weeks, rowOf(TEAMS[5].abbreviation).weeks);
    const ranks = [...new Set(board.players.map((p) => p.overallRank))].sort((x, y) => x - y);
    assert.deepEqual(ranks, [1, 2], "dense among the players listed");
  });

  test("the version moves with the FPA table", () => {
    const moved = model.buildSosBoard({ ...fpaTable(), version: "fixture-2" }, schedule(), POOL, "RB", "ppr");
    assert.notEqual(moved.version, board.version);
  });
});

/* --------------------------------------------------------------- render */

describe("the markup", () => {
  const team = { tab: "team", position: "RB", scoring: "ppr" };

  test("embedded: no H1, and the page-data island in the exact form the plugin parses", () => {
    const html = render.renderSosPage(board, team, { embed: true, endpoint: "https://x/embed/sos" });
    assert.match(html, /^<div class="scsos is-embed" data-scsos-root="1"/);
    assert.doesNotMatch(html, /<h1/);
    const island = html.match(/<script type="application\/json" class="scsos-page-data">(.*?)<\/script>/);
    assert.ok(island, "island present");
    assert.deepEqual(JSON.parse(island[1]), {
      title: "Fantasy Football Strength of Schedule | 2026 SOS by Team & Player",
      h1: "Fantasy Football Strength of Schedule",
      description:
        "View 2026 fantasy football strength of schedule by team, player, position, scoring format, rest-of-season, and fantasy playoff weeks.",
      lead: "Fantasy football strength of schedule helps you compare the easiest and toughest matchups by team, player, position, scoring format, rest-of-season, and fantasy playoff weeks. Use the tool below to identify schedule edges using opponent-adjusted fantasy points allowed.",
    });
    assert.match(html, /data-scsos-endpoint="https:\/\/x\/embed\/sos"/);
  });

  test("the FAQ: every question, under the board and outside the swapped view, with the RB/PPR cards quoted", () => {
    const facts = faq.sosFaqFacts(board);
    assert.ok(facts, "the RB/PPR board yields the four team facts");
    assert.equal(faq.sosFaqFacts(null), null);
    assert.equal(faq.sosFaqFacts({ ...board, position: "WR" }), null, "only the RB/PPR board is quoted");

    const html = render.renderSosPage(board, team, { embed: true, faq: facts });
    const faqAt = html.indexOf('<section class="scsos-faq"');
    assert.ok(faqAt > html.indexOf("</table>"), "after the board");
    assert.ok(faqAt > html.lastIndexOf('<div class="scsos-view">'), "outside .scsos-view");
    assert.ok(faqAt < html.indexOf("scsos-page-data"), "before the island");
    assert.match(html, /<h2 id="scsos-faq-title" class="scsos-faq-title">Fantasy Football Strength of Schedule FAQ<\/h2>/);
    assert.equal((html.match(/<details class="scsos-faq-item">/g) ?? []).length, 20, "twenty questions");
    assert.equal(faq.sosFaqEntries(board.season, facts).length, 20);
    assert.doesNotMatch(html, /\u2014/, "no em dashes");

    const easiest = board.teamCards.find((c) => c.id === "easiest-full");
    const toughest = board.teamCards.find((c) => c.id === "toughest-full");
    const po = board.teamCards.find((c) => c.id === "easiest-playoff");
    const poBad = board.teamCards.find((c) => c.id === "toughest-playoff");
    assert.match(
      html,
      new RegExp(`For ${board.season} PPR scoring, the ${easiest.team.fullName} currently rank No\\. 1 in full-season running back strength of schedule\\. Their opponents average ${easiest.afpa.toFixed(1)} adjusted fantasy points allowed to running backs, which is \\d+\\.\\d points (above|below) the league average\\.`),
    );
    assert.match(html, new RegExp(`the ${toughest.team.fullName} currently rank No\\. ${board.teams.find((t) => t.team.abbreviation === toughest.team.abbreviation).overallRank} in full-season`));
    assert.match(html, new RegExp(`${po.team.city} currently has the easiest ${board.season} fantasy playoff schedule for running backs in PPR scoring\\. ${po.team.nickname} running backs face opponents allowing an average of ${po.afpa.toFixed(1)} adjusted fantasy points`));
    assert.match(html, new RegExp(`${poBad.team.city} currently has the toughest ${board.season} fantasy playoff schedule for running backs in PPR scoring\\. The ${poBad.team.nickname}' playoff opponents allow an average of ${poBad.afpa.toFixed(1)} adjusted fantasy points to running backs\\.`));
    assert.match(html, new RegExp(`StatChasers uses a ${board.season - 1}\u2013${board.season} data blend`), "the blend names the seasons");

    const bare = render.renderSosPage(board, team, { embed: true });
    assert.match(bare, /the Easiest Full-Season card above names the team at No\. 1/, "without facts the four answers point at the cards");
    assert.equal((bare.match(/<details class="scsos-faq-item">/g) ?? []).length, 20);
  });

  test("standalone: the H1, and no island", () => {
    const html = render.renderSosPage(board, team, {});
    assert.match(html, /<h1 class="scsos-h1">Fantasy Football Strength of Schedule<\/h1>/);
    assert.doesNotMatch(html, /scsos-page-data/);
  });

  test("the team grid: 32 rows, W1-W17, PO2, PO3 and ROS, and no week 18", () => {
    const html = render.renderSosPage(board, team, { embed: true });
    assert.equal(html.match(/<tr data-row="team-/g).length, 32);
    for (let w = 1; w <= 17; w += 1) assert.match(html, new RegExp(`data-key="w${w}"`));
    assert.doesNotMatch(html, /data-key="w18"/);
    for (const k of ["ovr", "ros", "playoff", "po2", "po3", "rosavg"]) assert.match(html, new RegExp(`data-key="${k}"`));
    assert.equal(html.match(/class="scsos-card /g).length, 4);
    assert.match(html, />BYE</);
  });

  test("the controls: tab and scoring are views of the page, the positions are pages of their own", () => {
    const html = render.renderSosPage(board, team, { embed: true });
    assert.match(html, /class="scsos-tab" href="\?tab=player&amp;scoring=ppr"/, "no pos in a view link");
    assert.match(html, /class="scsos-opt is-active" href="\?tab=team&amp;scoring=ppr" data-tab="team" data-pos="rb" data-scoring="ppr"/);
    assert.doesNotMatch(html, /[?&]pos=/, "nothing writes ?pos= any more");
    // The five sub-pages, as plain links the bundle leaves alone (no data-tab/pos/scoring).
    for (const page of ["qb", "rb", "wr", "te", "playoffs"]) {
      assert.match(html, new RegExp(`<a class="scsos-opt is-page( is-active)?" href="/strength-of-schedule/${page}" data-page="${page}"`));
    }
    assert.match(html, /is-page is-active" href="\/strength-of-schedule\/rb" data-page="rb">RB</, "the overview marks the board it opened on");
    assert.doesNotMatch(html, /data-page="rb" aria-current/, "but is not the RB page");
    assert.match(html, /data-page="all"/);

    // Under the WordPress page, with a non-default view carried across.
    const wp = render.renderSosPage(board, { ...team, tab: "player", scoring: "std" }, {
      embed: true,
      pageBase: "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/",
    });
    assert.match(wp, /href="https:\/\/statchasers\.com\/nfl\/fantasy-football-strength-of-schedule\/wr\/\?tab=player&amp;scoring=std" data-page="wr"/);
    assert.match(wp, /href="https:\/\/statchasers\.com\/nfl\/fantasy-football-strength-of-schedule\/playoffs\/\?scoring=std" data-page="playoffs"/, "the playoffs page has no player half");
    assert.equal(render.sosPagePath("/strength-of-schedule", "all"), "/strength-of-schedule");
    assert.equal(render.sosPagePath("/x/", "te"), "/x/te/");
  });

  test("a position page: mak's copy, the answer above the table, the Updated line, team links and Related, no FAQ", () => {
    const html = render.renderSosPage(board, team, { embed: true, page: "rb", updatedAt: Date.UTC(2026, 9, 9, 16) });
    const island = JSON.parse(html.match(/class="scsos-page-data">(.*?)<\/script>/)[1]);
    assert.equal(island.title, "RB Strength of Schedule 2026: Fantasy Matchups");
    assert.equal(island.h1, "RB Strength of Schedule");
    assert.equal(
      island.description,
      "Fantasy RB strength of schedule for 2026: rest-of-season and playoff matchups for all 32 teams, based on fantasy points allowed to running backs.",
    );
    // The answer: easiest and hardest by ROS rank, with the easiest team's remaining-opponent average.
    const byRos = [...board.teams].sort((a, b) => a.rosRank - b.rosRank);
    const easiest = byRos[0];
    const hardest = byRos[byRos.length - 1];
    assert.equal(
      island.lead,
      `Easiest rest-of-season RB schedule: ${easiest.team.fullName} (${easiest.ros.afpa.toFixed(1)} fantasy points allowed per game to RBs by remaining opponents). Hardest: ${hardest.team.fullName}.`,
    );
    assert.equal(render.sosPositionAnswer(board), island.lead);
    assert.match(html, /data-page="rb"/);
    assert.match(html, /<p class="scsos-updated">Updated <time datetime="2026-10-09">Oct 9<\/time><\/p>/);
    assert.ok(html.indexOf("scsos-updated") < html.indexOf('<div class="scsos-bar">'), "above the bar");
    assert.match(html, /aria-current="page">RB</);
    // Every team links to its schedule page.
    assert.equal(
      (html.match(/<a class="scsos-team" href="https:\/\/statchasers\.com\/nfl\/teams\/[a-z0-9-]+\/schedule\/"/g) ?? []).length,
      32,
    );
    assert.equal(render.teamScheduleHref(TEAMS[0]), `https://statchasers.com/nfl/teams/${TEAMS[0].slug}/schedule/`);
    // The Related block replaces the FAQ, outside the swapped view.
    assert.doesNotMatch(html, /scsos-faq/);
    const related = html.indexOf('<nav class="scsos-related"');
    assert.ok(related > html.lastIndexOf("</table>") && related < html.indexOf("scsos-page-data"));
    assert.deepEqual(
      render.sosRelatedLinks("rb").map((l) => l.href),
      [
        "https://statchasers.com/fantasy-football/rest-of-season-rankings/rb/",
        "https://statchasers.com/redraft-command/fantasy-football-projections/rb",
        "https://statchasers.com/nfl/fantasy-points-allowed-by-position/",
        "https://statchasers.com/redraft-command/who-should-i-start",
      ],
    );
    assert.equal(render.sosRelatedLinks("all").length, 0);
    assert.doesNotMatch(html, /\u2014/, "no em dashes");

    // Standalone, the page prints the answer under its own H1.
    const alone = render.renderSosPage(board, team, { page: "rb" });
    assert.match(alone, /<h1 class="scsos-h1">RB Strength of Schedule<\/h1><p class="scsos-answer">Easiest rest-of-season RB schedule:/);

    // The copy for the other three, as the spec wrote them.
    assert.equal(render.sosPageCopy(2026, "qb").title, "QB Strength of Schedule 2026: Fantasy Matchups");
    assert.match(render.sosPageCopy(2026, "qb").description, /based on fantasy points allowed\. Updated weekly\.$/);
    assert.match(render.sosPageCopy(2026, "wr").description, /to wide receivers\.$/);
    assert.match(render.sosPageCopy(2026, "te").description, /to tight ends\.$/);
    assert.equal(render.sosPageCopy(2026).h1, "Fantasy Football Strength of Schedule", "the overview is unchanged");
  });

  test("the playoffs page: all four positions' Weeks 15-17, no tabs, cards or export", () => {
    const boards = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) boards[pos] = model.buildSosBoard(fpaTable(), schedule(), POOL, pos, "ppr");
    const html = render.renderSosPage(board, team, { embed: true, page: "playoffs", boards });
    const island = JSON.parse(html.match(/class="scsos-page-data">(.*?)<\/script>/)[1]);
    assert.equal(island.title, "Fantasy Playoff Strength of Schedule (Weeks 15\u201317)");
    assert.equal(island.h1, "Fantasy Playoff Strength of Schedule");
    assert.equal(
      island.description,
      "Which teams have the easiest fantasy playoff schedule? Weeks 15\u201317 strength of schedule for QB, RB, WR and TE, for all 32 teams.",
    );
    const rbEasiest = [...boards.RB.teams].sort((a, b) => a.playoffRank - b.playoffRank)[0];
    assert.match(island.lead, /^Easiest fantasy playoff schedule \(Weeks 15-17\): QB [A-Za-z0-9 .]+, RB [A-Za-z0-9 .]+, WR [A-Za-z0-9 .]+, TE [A-Za-z0-9 .]+\. Hardest: QB /);
    assert.ok(island.lead.includes(`RB ${rbEasiest.team.fullName}`));
    assert.match(html, /data-page="playoffs"/);
    assert.match(html, /data-kind="playoffs"/);
    assert.equal(html.match(/<tr data-row="team-/g).length, 32);
    for (const k of ["avg", "w15", "w16", "w17", "po3-qb", "po3-rb", "po3-wr", "po3-te"]) assert.match(html, new RegExp(`data-key="${k}"`));
    assert.doesNotMatch(html, /data-key="w14"/);
    assert.doesNotMatch(html, /scsos-tabs|scsos-export|scsos-card /);
    assert.match(html, /data-page="playoffs" aria-current="page">Playoffs</);
    assert.match(html, /<span class="scsos-po-rank">#\d+<\/span>/);
    assert.match(html, /rest-of-season-rankings\/"/, "Related links the rankings at their base");
  });

  test("the player grid: full and short names, and a link only where there is a page", () => {
    const html = render.renderSosPage(board, { ...team, tab: "player" }, { embed: true });
    assert.match(html, /data-kind="player"/);
    assert.match(html, /<span class="scsos-pname-full">Beta Back<\/span><span class="scsos-pname-short">B\. Back<\/span>/);
    assert.match(html, /<span class="scsos-player"><span class="scsos-pname-full">Gamma Back/);
    assert.equal(render.abbreviateName("Jacory Croskey-Merritt"), "J. Croskey");
  });

  test("the CSV is the grid: a weekly cell is the opponent and that defense's rank", () => {
    const csv = render.renderSosCsv(board, "team").trim().split("\n");
    assert.equal(csv.length, 33);
    assert.equal(
      csv[0],
      "Team,OverallRank,ROSRank,PlayoffRank,ROSSummary,W1,W2,W3,W4,W5,W6,W7,W8,W9,W10,W11,W12,W13,W14,W15,W16,W17,PO2,PO3",
    );
    assert.match(csv.find((l) => l.startsWith(`${TEAMS[0].code},`)), /,BYE,/);
    assert.match(csv[1], /,@?[A-Z]{2,3} \(\d+\),/);
    const players = render.renderSosCsv(board, "player").trim().split("\n");
    assert.equal(players.length, 4);
    assert.match(players[0], /^Player,Team,Position,SOSRank,ROSRank,PlayoffRank,W1,/);
  });
});

/* --------------------------------------------------------------- routes */

describe("the routes", () => {
  let server;
  let hasData = false;

  before(async () => {
    server = await startServer();
    hasData = (await fetch(`${server.origin}/embed/sos`)).status === 200;
  });
  after(async () => {
    await server?.stop();
  });

  const get = (p) => fetch(`${server.origin}${p}`, { redirect: "manual" });

  const canonical = (h) => h.match(/<link rel="canonical" href="([^"]+)"/)[1];

  test("the overview is noindex, and the tab and scoring share its canonical", async (t) => {
    const a = await get("/strength-of-schedule");
    assert.equal(a.status, 200);
    assert.equal(a.headers.get("x-robots-tag"), "noindex, indexifembedded");
    const html = await a.text();
    assert.match(html, /<title>Fantasy Football Strength of Schedule \| \d{4} SOS by Team &amp; Player<\/title>/);
    const b = await (await get("/strength-of-schedule?tab=player&scoring=std")).text();
    assert.equal(canonical(b), canonical(html));
    assert.ok(canonical(html).endsWith("/strength-of-schedule"));
    if (!hasData) t.diagnostic("no FPA ingested: data assertions skipped");
  });

  test("each position is a page of its own, and ?pos= 301s to it", async () => {
    const rb = await get("/strength-of-schedule/rb");
    assert.equal(rb.status, 200);
    assert.equal(rb.headers.get("x-robots-tag"), "noindex, indexifembedded");
    const html = await rb.text();
    assert.match(html, /<title>RB Strength of Schedule \d{4}: Fantasy Matchups<\/title>/);
    assert.ok(canonical(html).endsWith("/strength-of-schedule/rb"));
    assert.match(html, /<h1 class="scsos-h1">RB Strength of Schedule<\/h1>/);
    if (hasData) {
      assert.match(html, /<p class="scsos-answer">Easiest (rest-of-season|full-season) RB schedule: /);
      assert.match(html, /class="scsos-updated">Updated <time datetime="\d{4}-\d{2}-\d{2}">/);
      assert.equal(html.match(/<tr data-row="team-/g).length, 32);
    }
    const po = await get("/strength-of-schedule/playoffs");
    assert.equal(po.status, 200);
    const poHtml = await po.text();
    assert.match(poHtml, /<title>Fantasy Playoff Strength of Schedule \(Weeks 15\u201317\)<\/title>/);
    assert.ok(canonical(poHtml).endsWith("/strength-of-schedule/playoffs"));
    if (hasData) assert.match(poHtml, /data-kind="playoffs"/);

    const redirects = [
      ["/strength-of-schedule?pos=rb", "/strength-of-schedule/rb"],
      ["/strength-of-schedule?tab=team&pos=rb&scoring=ppr", "/strength-of-schedule/rb"],
      ["/strength-of-schedule?tab=player&pos=wr&scoring=std", "/strength-of-schedule/wr?tab=player&scoring=std"],
      ["/strength-of-schedule/rb?pos=te", "/strength-of-schedule/rb"],
      ["/strength-of-schedule/RB", "/strength-of-schedule/rb"],
      ["/strength-of-schedule/Playoffs?scoring=half-ppr", "/strength-of-schedule/playoffs?scoring=half-ppr"],
    ];
    for (const [from, to] of redirects) {
      const r = await get(from);
      assert.equal(r.status, 301, from);
      assert.equal(r.headers.get("location"), to, from);
    }
    assert.equal((await get("/strength-of-schedule/k")).status, 404);
    assert.equal((await get("/strength-of-schedule/all")).status, 404, "the overview has one address");
  });

  test("the fragment serves a page, with the WordPress addresses on its controls", async (t) => {
    if (!hasData) return t.skip("no FPA ingested");
    const html = await (await get("/embed/sos?page=rb&tab=team&scoring=ppr")).text();
    assert.match(html, /data-pos="rb" data-scoring="ppr" data-page="rb"/);
    assert.match(html, /href="https:\/\/statchasers\.com\/nfl\/fantasy-football-strength-of-schedule\/qb\/" data-page="qb"/);
    assert.match(html, /<nav class="scsos-related"/);
    assert.doesNotMatch(html, /scsos-faq/);
    const pinned = await (await get("/embed/sos?page=wr&pos=te")).text();
    assert.match(pinned, /data-pos="wr" data-scoring="ppr" data-page="wr"/, "a page's board is its own, whatever ?pos= says");
    const po = await (await get("/embed/sos?page=playoffs&tab=player")).text();
    assert.match(po, /data-tab="team" data-pos="rb" data-scoring="ppr" data-page="playoffs"/);
    assert.match(po, /data-kind="playoffs"/);
    const overview = await (await get("/embed/sos")).text();
    assert.match(overview, /data-page="all"/);
    assert.match(overview, /scsos-faq/);
  });

  test("the fragment serves each view, and bad values fall back to the default", async (t) => {
    if (!hasData) return t.skip("no FPA ingested");
    const html = await (await get("/embed/sos?tab=player&pos=te&scoring=half-ppr")).text();
    assert.match(html, /data-tab="player" data-pos="te" data-scoring="half-ppr"/);
    const fallback = await (await get("/embed/sos?tab=x&pos=k&scoring=y")).text();
    assert.match(fallback, /data-tab="team" data-pos="rb" data-scoring="ppr"/);
    assert.equal(fallback.match(/<tr data-row="team-/g).length, 32);
    assert.match(fallback, /class="scsos-export" href="http:\/\/[^"]+\/sos\/download\.csv\?tab=team&amp;pos=rb&amp;scoring=ppr"/);
  });

  test("the CSV downloads", async (t) => {
    if (!hasData) return t.skip("no FPA ingested");
    const res = await get("/sos/download.csv?tab=team&pos=qb&scoring=std");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /attachment; filename="statchasers_team_sos_\d{4}_QB_std\.csv"/);
    assert.equal((await res.text()).trim().split("\n").length, 33);
  });
});
