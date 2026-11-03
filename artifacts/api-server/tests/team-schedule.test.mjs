/**
 * The normalized team schedule, and the Schedule page built on it.
 *
 * Mak's schedule brief (2026-11-03): the Colts page printed nflverse's
 * placeholder "Sunday 1:00 PM" for Week 16 and Week 18 games the NFL lists
 * as TBD, and counted the London game as a road game. These tests pin the
 * model that fixes both, for every team, and the page that reads it.
 *
 * Two layers. The model tests import lib/team/schedule.ts directly, pointed
 * at the 2026-10-20 slate fixture and the replayed ESPN scoreboard
 * (helpers/upstream-replay.mjs with `scoreboard: true`), and walk all 32
 * clubs. The page tests fetch the served HTML from a server on the same
 * replay and assert on it without running any JavaScript.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

/** The clock the model tests read against: a Tuesday in the fixture's Week 8. */
const NOW = Date.parse("2026-10-20T16:00:00Z");

let replay;
let server;
let schedule; // lib/team/schedule
let teams; // lib/team/teams
let slateCsv;

before(async () => {
  replay = await startUpstreamReplay({ scoreboard: true });
  server = await startServer(replay.env);

  // The model, imported in this process against the same replay. The env is
  // read at module load, so it is set before the bundle is imported.
  slateCsv = path.join(os.tmpdir(), `sc-games-${process.pid}.csv`);
  fs.writeFileSync(
    slateCsv,
    zlib.gunzipSync(fs.readFileSync(path.join(APP_DIR, "tests", "fixtures", "games-2026-10-20.csv.gz"))),
  );
  Object.assign(process.env, replay.env, { SC_SCHEDULE_CSV_FILE: slateCsv });
  teams = await importModule("lib/team/teams");
  schedule = await importModule("lib/team/schedule");
});

after(async () => {
  await server?.stop();
  await replay?.stop();
  await cleanupBundles();
  fs.rmSync(slateCsv, { force: true });
});

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function dom(pathname) {
  const page = await get(pathname);
  assert.equal(page.status, 200, pathname);
  const virtualConsole = new VirtualConsole();
  const { window } = new JSDOM(page.body, { virtualConsole });
  return { doc: window.document, body: page.body };
}

/** An element's words, with a space wherever a tag was, so "Results<span>Weeks" reads "Results Weeks". */
const text = (el) =>
  el
    ? el.innerHTML
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&rarr;/g, "→")
        .replace(/\s+/g, " ")
        .trim()
    : "";

/* ------------------------------------------------------------------ model */

describe("the normalized team schedule (all 32 clubs, 2026 slate + ESPN replay)", () => {
  let all;

  before(async () => {
    all = new Map();
    for (const team of teams.TEAMS) {
      all.set(team.abbreviation, await schedule.getTeamSchedule(team, 2026));
    }
  });

  test("every club has 17 regular-season games in 17 distinct weeks, and the bye is the one gap", () => {
    for (const [code, s] of all) {
      assert.ok(s, `${code}: a schedule`);
      assert.equal(s.games.length, 17, `${code}: 17 games`);
      const weeks = s.games.map((g) => g.week);
      assert.equal(new Set(weeks).size, 17, `${code}: one game per week`);
      assert.ok(weeks.every((w) => w >= 1 && w <= 18), `${code}: weeks 1-18`);
      assert.ok(s.byeWeek >= 1 && s.byeWeek <= 18, `${code}: a bye week`);
      assert.ok(!weeks.includes(s.byeWeek), `${code}: the bye is not a game`);
    }
  });

  test("home + away + neutral = 17, and a neutral-site game is never a road game", () => {
    let neutralSeen = 0;
    for (const [code, s] of all) {
      const sites = schedule.siteCounts(s.games);
      assert.equal(sites.home + sites.away + sites.neutral, 17, `${code}: the sites add up`);
      for (const g of s.games) {
        assert.equal(g.site, g.neutralSite ? "neutral" : g.homeAway, `${code} W${g.week}: site follows the flag`);
        if (g.neutralSite) neutralSeen += 1;
      }
    }
    // Nine international games in 2026, two clubs each.
    assert.equal(neutralSeen, 18, "every neutral-site game is neutral for both clubs");
    const ind = all.get("ind");
    assert.deepEqual(
      (({ home, away, neutral }) => ({ home, away, neutral }))(schedule.siteCounts(ind.games)),
      { home: 8, away: 8, neutral: 1 },
      "the Colts: 8 home, 8 away, 1 neutral (London)",
    );
    const london = ind.games.find((g) => g.week === 4);
    assert.equal(london.site, "neutral");
    assert.equal(london.homeAway, "away", "Washington was the designated host");
    assert.equal(london.venue, "Tottenham Hotspur");
    assert.equal(london.venueCity, "London, UK");
    assert.equal(london.international, true);
  });

  test("a completed game carries a valid result and a future game carries none", () => {
    for (const [code, s] of all) {
      for (const g of s.games) {
        if (g.status === "final") {
          assert.ok(g.result, `${code} W${g.week}: a final has a result`);
          assert.ok(Number.isInteger(g.result.teamScore) && Number.isInteger(g.result.opponentScore));
          const expected =
            g.result.teamScore > g.result.opponentScore ? "W" : g.result.teamScore < g.result.opponentScore ? "L" : "T";
          assert.equal(g.result.outcome, expected, `${code} W${g.week}: outcome matches the score`);
          assert.ok(g.kickoffMs !== null && g.timeConfirmed, `${code} W${g.week}: a played game has a kickoff`);
        } else {
          assert.equal(g.result, null, `${code} W${g.week}: no result before the final`);
        }
      }
    }
    // Weeks 1-6 are final in the fixture; the overtime and the tie are scored
    // like any other game.
    const kc = all.get("ind").games.find((g) => g.week === 2);
    assert.deepEqual(kc.result, { outcome: "L", teamScore: 30, opponentScore: 33 }, "the OT loss at Kansas City");
    const tie = all.get("was").games.find((g) => g.week === 5);
    assert.deepEqual(tie.result, { outcome: "T", teamScore: 27, opponentScore: 27 }, "the Week 5 tie");
    assert.equal(schedule.recordThrough(all.get("was").games).text, "1-4-1");
  });

  test("a game the NFL has not scheduled is TBD: no date, no time, no placeholder", () => {
    for (const [code, s] of all) {
      const w18 = s.games.find((g) => g.week === 18);
      assert.equal(w18.kickoffMs, null, `${code} W18: no kickoff`);
      assert.equal(w18.timeConfirmed, false, `${code} W18: time not confirmed`);
      assert.equal(w18.dateConfirmed, false, `${code} W18: date not confirmed`);
      assert.equal(w18.kickoffSource, "none");
    }
    // The Week 16 Saturday pool: ESPN says timeValid=false for four games.
    const ind16 = all.get("ind").games.find((g) => g.week === 16);
    assert.equal(ind16.kickoffMs, null, "IND-CIN Week 16 is TBD, not Dec 27 1:00 PM");
    assert.equal(ind16.network, null);
    const cle16 = all.get("cle").games.find((g) => g.week === 16);
    assert.ok(cle16.kickoffMs !== null && cle16.timeConfirmed, "BAL-CLE Week 16 has its window (Sun 1:00 ET, CBS)");
    assert.equal(cle16.network, "CBS");
    // A confirmed future game keeps ESPN's instant and the slate's agree.
    const ind9 = all.get("ind").games.find((g) => g.week === 9);
    assert.equal(ind9.kickoffMs, Date.parse("2026-11-08T18:00:00Z"));
    assert.equal(ind9.kickoffSource, "live");
  });

  test("networks are one spelling each", () => {
    const seen = new Set();
    for (const [, s] of all) for (const g of s.games) if (g.network) seen.add(g.network);
    assert.ok(seen.has("FOX") && !seen.has("Fox"), [...seen].join(", "));
    assert.ok(seen.has("NFL Network") && !seen.has("NFL Net"));
    assert.ok(seen.has("Prime Video"));
    assert.ok(seen.has("ESPN / ABC"), "the Monday night simulcast keeps both halves");
    const ind = all.get("ind").games;
    assert.equal(ind.find((g) => g.week === 2).network, "NBC", "Sunday night at Kansas City");
    assert.equal(ind.find((g) => g.week === 11).network, "Prime Video", "Thursday night at Houston");
    assert.equal(all.get("min").games.find((g) => g.week === 9).network, "ESPN / ABC", "Monday night vs Buffalo");
  });

  test("next is the earliest game not yet final, last is the latest final, and the two never overlap", () => {
    for (const [code, s] of all) {
      const next = schedule.nextGame(s, NOW);
      const last = schedule.lastResult(s);
      assert.ok(next, `${code}: a next game in October`);
      assert.notEqual(next.status, "final");
      assert.ok(s.games.filter((g) => g.week < next.week).every((g) => g.status === "final" || g.kickoffMs + schedule.RECENTLY_ENDED_MS <= NOW), `${code}: nothing unplayed before the next game`);
      assert.ok(last && last.status === "final" && last.result, `${code}: a last result`);
      assert.ok(s.games.filter((g) => g.week > last.week).every((g) => g.status !== "final"), `${code}: nothing final after the last result`);
      const { results, remaining } = schedule.splitSchedule(s);
      assert.equal(results.length + remaining.length, 17, `${code}: one list, two halves`);
      assert.ok(results.every((g) => g.result) && remaining.every((g) => !g.result));
      assert.equal(schedule.recordThrough(s.games).played, results.length, `${code}: the record counts the results`);
    }
    // A final is never "next", however recent: Week 6 was played on Oct 18,
    // and at NOW (Oct 20) the next game is Week 7.
    const ind = all.get("ind");
    assert.equal(schedule.nextGame(ind, NOW).week, 7);
    assert.equal(schedule.lastResult(ind).week, 6);
    // Once Week 7's kickoff is four hours behind and no final has landed it
    // falls out of "next" too, which is what keeps a stale game off the card.
    const w7 = ind.games.find((g) => g.week === 7);
    assert.equal(schedule.nextGame(ind, w7.kickoffMs + schedule.RECENTLY_ENDED_MS + 1).week, 8);
    // The bye-week team: the bye is no game, so nothing is ever "next" in it.
    const kc = all.get("kc");
    assert.equal(kc.byeWeek, 5);
    assert.ok(!kc.games.some((g) => g.week === 5));
    assert.equal(schedule.nextGame(kc, NOW).week, 7, "Weeks 1-6 are final in the fixture");
  });

  test("the opponent and the venue on each row are the slate's", () => {
    const ind = all.get("ind");
    const expect = {
      1: ["Baltimore Ravens", "home", "Lucas Oil Stadium"],
      2: ["Kansas City Chiefs", "away", "GEHA Field at Arrowhead Stadium"],
      11: ["Houston Texans", "away", "Reliant Stadium"],
      18: ["Jacksonville Jaguars", "home", "Lucas Oil Stadium"],
    };
    for (const [week, [name, site, venue]] of Object.entries(expect)) {
      const g = ind.games.find((x) => x.week === Number(week));
      assert.equal(g.opponent.fullName, name, `W${week} opponent`);
      assert.equal(g.site, site, `W${week} site`);
      assert.equal(g.venue, venue, `W${week} venue`);
    }
    // Early and late byes, from the rows alone.
    assert.equal(all.get("car").byeWeek, 5);
    assert.equal(all.get("dal").byeWeek, 14);
    assert.equal(all.get("ari").byeWeek, 14);
  });

  test("the version fingerprint changes with a result, and the updated stamp is a refresh time", () => {
    const ind = all.get("ind");
    assert.match(ind.version, /^2026-272-/);
    assert.ok(ind.updatedAtMs > 0 && ind.updatedAtMs <= Date.now(), "a real timestamp, not the future");
  });

  test("the season rolls forward: the slate asked for is the one returned, never a guess", async () => {
    // An exact read: a season the file does not hold is null, not last year.
    const none = await schedule.getTeamSchedule(teams.TEAMS[0], 2031);
    assert.equal(none, null);
  });
});

describe("the postseason, from a slate that has one (2025)", () => {
  let post;
  let regular;
  before(async () => {
    // A second bundle, against the 2025 file with its playoff rows and no live
    // layer: the model reads the season it is asked for.
    process.env.SC_SCHEDULE_CSV_FILE = path.join(APP_DIR, "tests", "fixtures", "schedule-2025-with-postseason.csv");
    process.env.SC_SCHEDULE_ESPN = "0";
    post = await importModule("lib/team/schedule");
    regular = await importModule("lib/team/teams");
  });

  test("a club that played in January has rounds; one that did not has none", async () => {
    const sea = regular.TEAMS.find((t) => t.abbreviation === "sea");
    const ne = regular.TEAMS.find((t) => t.abbreviation === "ne");
    const seaPost = await post.getTeamPostseason(sea, 2025);
    assert.ok(seaPost.games.length >= 1, "Seattle's postseason");
    const sb = seaPost.games.find((g) => g.weekLabel === "Super Bowl");
    assert.ok(sb, "the Super Bowl is a round");
    assert.equal(sb.seasonType, "post");
    assert.equal(sb.site, "neutral", "the Super Bowl is a neutral-site game");
    assert.equal(sb.opponent.abbreviation, "ne");
    assert.deepEqual(sb.result, { outcome: "W", teamScore: 29, opponentScore: 13 });
    assert.ok(sb.kickoffMs !== null && sb.timeConfirmed, "a played round has its kickoff");
    const nePost = await post.getTeamPostseason(ne, 2025);
    assert.ok(nePost.games.some((g) => g.weekLabel === "Super Bowl" && g.result.outcome === "L"));
    // A club that missed the playoffs: an empty postseason, not a failure.
    const missed = [];
    for (const t of regular.TEAMS) {
      const p = await post.getTeamPostseason(t, 2025);
      if (p.games.length === 0) missed.push(t.abbreviation);
    }
    assert.equal(missed.length, 18, "fourteen clubs make the playoffs");
    // And the regular season of that year is final throughout.
    const seaReg = await post.getTeamSchedule(sea, 2025);
    assert.ok(seaReg.games.every((g) => g.status === "final" && g.result));
    assert.equal(post.nextGame(seaReg, Date.now()), null, "no next game once the season is played out");
  });
});

/* ------------------------------------------------------------------- page */

describe("the Schedule page", () => {
  const IND = "/team/indianapolis-colts/schedule/";

  test("title, H1 and the context line under it", async () => {
    const { doc, body } = await dom(IND);
    assert.equal(doc.querySelector("title").textContent, "Indianapolis Colts Schedule 2026: Dates, Times, TV & Results");
    assert.match(doc.querySelector('meta[name="description"]').getAttribute("content"), /^Indianapolis Colts schedule for the 2026 NFL season: every game with date, kickoff time, TV network, venue and result/);
    // Standalone, the hero is the H1 and the panel's heading an H2 - the same
    // words the WordPress mount promotes to its H1 (see the embed test).
    const headings = [...doc.querySelectorAll("h1, h2")].map((h) => text(h));
    assert.equal(headings[0], "Indianapolis Colts");
    assert.equal(headings[1], "Indianapolis Colts Schedule");
    const context = text(doc.querySelector(".sct-sched-context"));
    assert.match(context, /^2026 NFL season · \d+-\d+(-\d+)? · AFC South · Bye Week 13 · Updated [A-Z][a-z]{2} \d{1,2}$/, context);
    // The stamp is the data's refresh time, as a machine-readable instant.
    const stamp = doc.querySelector(".sct-sched-updated time");
    assert.ok(stamp && Date.parse(stamp.getAttribute("datetime")) <= Date.now());
    assert.ok(!/Balanced draw|road grind|home edge|road gauntlet/.test(body), "no autogenerated commentary");
  });

  test("the WordPress mount promotes the page's own heading, undated, above the club name", async () => {
    const page = await get("/embed/team/ind?section=schedule&h1=1");
    assert.equal(page.status, 200);
    const h1s = [...page.body.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
    assert.deepEqual(h1s, ["Indianapolis Colts Schedule"]);
    // The club's name in the hero is a <p> in this mode: nothing outranks the H1.
    assert.ok(page.body.indexOf('<p class="sct-title">Indianapolis Colts</p>') < page.body.indexOf("<h1"), "the hero does not carry a heading ahead of the H1");
    assert.ok(!/<h2[^>]*>Indianapolis Colts<\/h2>/.test(page.body));
  });

  test("the next-game module names the fixture, the window, the network and the venue, and the last result", async () => {
    const { doc } = await dom(IND);
    const module = doc.querySelector(".sct-nextgame-module");
    assert.ok(module, "the module rendered");
    const next = module.querySelector('[data-kind="next"]');
    assert.match(text(next.querySelector(".sct-ng-label")), /^(Next Game|Today's Game|Live Now) Week \d+/);
    // Away at home, as a scoreboard reads: the opponent links to its hub.
    const fixture = text(next.querySelector(".sct-ng-fixture"));
    assert.match(fixture, /^(Indianapolis Colts at .+|.+ at Indianapolis Colts|Indianapolis Colts vs .+)$/, fixture);
    assert.ok(next.querySelector("a.sct-ng-team[href^='/team/']"), "the opponent is a link");
    assert.match(text(next.querySelector(".sct-ng-when")), /^(Sun|Mon|Thu|Sat), [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM) ET( ·.*)?$|^Date\/Time TBD/);
    assert.ok(next.querySelector(".sct-ng-tv, .sct-ng-tbd"), "the network, or TV TBD");
    assert.ok(text(next.querySelector(".sct-ng-venue")).length > 0, "a venue");
    assert.match(next.querySelector(".sct-ng-cta a").getAttribute("href"), /^\/nfl\/[a-z-]+-vs-[a-z-]+\//);
    const last = module.querySelector('[data-kind="last"]');
    assert.equal(text(last.querySelector(".sct-ng-label")), "Last Game Week 6");
    assert.match(text(last.querySelector(".sct-result")), /^L 20–26/, "Week 6 vs Tennessee");
    assert.match(text(last.querySelector(".sct-ng-when")), /Record 2-4$/);
    assert.match(text(last.querySelector(".sct-ng-cta a")), /^View recap/);
  });

  test("results and the remaining schedule are two boards from one list, and the rows say what the model says", async () => {
    const { doc } = await dom(IND);
    const results = doc.querySelector('.sct-sboard[data-board="results"]');
    const remaining = doc.querySelector('.sct-sboard[data-board="remaining"]');
    assert.ok(results && remaining, "both boards");
    assert.equal(text(doc.querySelector("#results h2")), "Indianapolis Colts Results Weeks 1–6");
    assert.equal(text(doc.querySelector("#remaining-schedule h2")), "Indianapolis Colts Remaining Schedule Weeks 7–18");

    const played = [...results.querySelectorAll(".sct-srow:not(.is-bye)")];
    const toCome = [...remaining.querySelectorAll(".sct-srow:not(.is-bye)")];
    assert.equal(played.length + toCome.length, 17, "every game once");
    assert.equal(played.length, 6);
    for (const row of played) {
      assert.ok(row.querySelector(".sct-result"), "a played row shows its score");
      assert.match(text(row.querySelector(".sct-srow-record")), /^\d+-\d+(-\d+)?$/, "and the record after it");
      assert.match(text(row.querySelector("a.sct-srow-view")), /^View recap/);
    }
    for (const row of toCome) {
      assert.equal(row.querySelector(".sct-result"), null, "no score before the game");
      assert.match(text(row.querySelector("a.sct-srow-view")), /^View matchup/);
    }
    // The record column adds up in order.
    assert.deepEqual(played.map((r) => text(r.querySelector(".sct-srow-record"))), ["0-1", "0-2", "1-2", "2-2", "2-3", "2-4"]);
    // The bye sits in the board its week falls in.
    const bye = remaining.querySelector(".sct-srow.is-bye");
    assert.equal(text(bye.querySelector(".sct-srow-week")), "W13");
    assert.equal(results.querySelector(".sct-srow.is-bye"), null);
  });

  test("Week 16 and Week 18 are TBD across the page - never Dec 27 or Jan 10 at 1:00 PM", async () => {
    const { doc, body } = await dom(IND);
    for (const week of ["W16", "W18"]) {
      const row = [...doc.querySelectorAll(".sct-srow")].find((r) => text(r.querySelector(".sct-srow-week")) === week);
      assert.ok(row, `${week} row`);
      assert.equal(text(row.querySelector(".sct-srow-when")), "TBD", `${week} date`);
      assert.equal(text(row.querySelector(".sct-sstatus")), "TBD", `${week} time`);
      assert.equal(text(row.querySelector(".sct-srow-tv")), "TBD", `${week} network`);
      assert.ok(row.querySelector(".sct-srow-venue"), `${week} still names its venue`);
    }
    assert.ok(!/Dec 27|Jan 10/.test(body), "the placeholder dates appear nowhere");
    // The FAQ says the same thing in words.
    const faq = [...doc.querySelectorAll('[data-sct-faq-for="schedule"] .sct-faq-item')].map((i) => ({
      q: text(i.querySelector(".sct-faq-q")),
      a: text(i.querySelector(".sct-faq-a")),
    }));
    const jaguars = faq.find((f) => /play the Jaguars/.test(f.q));
    assert.match(jaguars.a, /Week 18 at Lucas Oil Stadium \(date and time TBD\)/);
    const remainingQ = faq.find((f) => /remaining schedule/.test(f.q));
    assert.match(remainingQ.a, /Week 16 vs Bengals \(TBD\)/);
    assert.match(remainingQ.a, /Week 18 vs Jaguars \(TBD\)/);
    assert.match(remainingQ.a, /2 games are marked TBD because the NFL has not set the date and time yet/);
    const tv = faq.find((f) => /What channel/.test(f.q));
    assert.match(tv.a, /2 upcoming games do not have a network assigned yet and show TBD/);
    assert.match(tv.a, /on CBS, FOX, NBC, NFL Network and Prime Video/);
    // Structured data: fifteen games, each with a real instant and a venue;
    // the two TBD games are not events.
    const list = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .map((m) => JSON.parse(m[1]))
      .find((node) => node["@type"] === "ItemList");
    assert.ok(list, "the ItemList is on the standalone page");
    assert.equal(list.numberOfItems, 15);
    for (const entry of list.itemListElement) {
      assert.match(entry.item.startDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "a full instant, never a bare date");
      assert.ok(entry.item.location.name);
    }
    assert.ok(!list.itemListElement.some((e) => /Bengals/.test(e.item.name)), "Week 16 is not an event");
  });

  test("the London game is neutral everywhere it is counted", async () => {
    const { doc } = await dom(IND);
    const row = [...doc.querySelectorAll(".sct-srow")].find((r) => text(r.querySelector(".sct-srow-week")) === "W4");
    assert.equal(row.getAttribute("data-site"), "neutral");
    assert.equal(row.querySelector(".sct-srow-ha").getAttribute("data-kind"), "neutral");
    assert.equal(text(row.querySelector(".sct-srow-ha")), "vs");
    const figures = new Map(
      [...doc.querySelectorAll(".sct-snap-cell")].map((cell) => [text(cell.querySelector(".sct-snap-label")), text(cell.querySelector(".sct-snap-value"))]),
    );
    assert.equal(figures.get("Games"), "17");
    assert.equal(figures.get("Home"), "8");
    assert.equal(figures.get("Away"), "8");
    assert.equal(figures.get("Neutral"), "1");
    assert.equal(figures.get("Division"), "6");
    assert.equal(figures.get("Remaining"), "11");
    assert.equal(figures.get("Bye week"), "W13");
    const kinds = [...doc.querySelectorAll(".sct-path-week")].map((c) => c.getAttribute("data-kind"));
    assert.equal(kinds.filter((k) => k === "neutral").length, 1);
    assert.equal(kinds.filter((k) => k === "home").length, 8);
    assert.equal(kinds.filter((k) => k === "away").length, 8);
    assert.equal(kinds.filter((k) => k === "bye").length, 1);
    const segs = [...doc.querySelectorAll(".sct-seg-detail")].map(text);
    assert.equal(segs[0], "3 home · 2 road · 1 neutral");
    const faq = [...doc.querySelectorAll('[data-sct-faq-for="schedule"] .sct-faq-item')].map((i) => ({ q: text(i.querySelector(".sct-faq-q")), a: text(i.querySelector(".sct-faq-a")) }));
    const home = faq.find((f) => /home games/.test(f.q));
    assert.match(home.a, /^Indianapolis has 8 home games in 2026, all of them at Lucas Oil Stadium\. The other 8 games are on the road, and 1 game is at a neutral site: Week 4 against the Washington Commanders at Tottenham Hotspur in London, UK \(a neutral-site game\)\./);
    const season = faq.find((f) => /schedule for 2026/.test(f.q));
    assert.match(season.a, /8 at home, 8 on the road and 1 neutral-site game/);
    // A club with no neutral game shows no Neutral figure at all.
    const { doc: kc } = await dom("/team/kansas-city-chiefs/schedule/");
    const kcFigures = [...kc.querySelectorAll(".sct-snap-label")].map(text);
    assert.ok(!kcFigures.includes("Neutral"), kcFigures.join(", "));
  });

  test("every opponent links to its hub, every game to its matchup, and the networks are marks", async () => {
    const { doc } = await dom(IND);
    const rows = [...doc.querySelectorAll(".sct-sboard .sct-srow:not(.is-bye)")];
    for (const row of rows) {
      const team = row.querySelector("a.sct-srow-team");
      assert.match(team.getAttribute("href"), /^\/team\/[a-z-]+\/$/, "the opponent's hub");
      assert.match(row.querySelector("a.sct-srow-view").getAttribute("href"), /^\/nfl\/[a-z-]+-vs-[a-z-]+\//);
    }
    // A played row carries its score and record, not a network; the games
    // still to be watched carry theirs as marks.
    const w1 = rows.find((r) => text(r.querySelector(".sct-srow-week")) === "W1");
    assert.equal(w1.querySelector(".sct-srow-tv"), null);
    const w9 = rows.find((r) => text(r.querySelector(".sct-srow-week")) === "W9");
    assert.equal(w9.querySelector(".sct-srow-tv svg").getAttribute("aria-label"), "FOX");
    assert.equal(text(w9.querySelector(".sct-sstatus")), "1:00 PM ET");
    const w11 = rows.find((r) => text(r.querySelector(".sct-srow-week")) === "W11");
    assert.equal(w11.querySelector(".sct-srow-tv svg").getAttribute("aria-label"), "Prime Video", "Thursday night");
    assert.equal(text(w11.querySelector(".sct-sstatus")), "8:15 PM ET");
    // The club's other pages, and the pair index, close the page.
    const more = [...doc.querySelectorAll(".sct-sched-more a")].map((a) => a.getAttribute("href"));
    assert.ok(more.includes("/team/indianapolis-colts/") && more.includes("/team/indianapolis-colts/depth-chart/") && more.includes("/team/indianapolis-colts/stats/"), more.join(" "));
    assert.equal(doc.querySelectorAll(".sct-series a.sct-series-link").length, 31);
  });

  test("other clubs: the tie, the Monday simulcast, the Mexico City game, the early and late byes", async () => {
    const { doc: was } = await dom("/team/washington-commanders/schedule/");
    assert.match(text(was.querySelector(".sct-sched-context")), / · 1-4-1 · NFC East · Bye Week 7 · /);
    const wasRows = [...was.querySelectorAll('[data-board="results"] .sct-srow:not(.is-bye)')];
    assert.equal(text(wasRows[4].querySelector(".sct-result")), "T 27–27 Tied 27 to 27");
    assert.equal(text(wasRows[4].querySelector(".sct-srow-record")), "1-3-1");
    assert.equal(wasRows[3].getAttribute("data-site"), "neutral", "the London game from Washington's side too");

    const { doc: min } = await dom("/team/minnesota-vikings/schedule/");
    const minRows = [...min.querySelectorAll(".sct-sboard .sct-srow:not(.is-bye)")];
    const mnf = minRows.find((r) => text(r.querySelector(".sct-srow-week")) === "W9");
    assert.equal(mnf.querySelector(".sct-srow-tv").getAttribute("title"), "ESPN / ABC");
    const mex = minRows.find((r) => text(r.querySelector(".sct-srow-week")) === "W11");
    assert.equal(mex.getAttribute("data-site"), "neutral");
    assert.match(text(mex.querySelector(".sct-srow-venue")), /Mexico City/);

    const { doc: kc } = await dom("/team/kansas-city-chiefs/schedule/");
    assert.equal(text(kc.querySelector('[data-board="results"] .sct-srow.is-bye .sct-srow-week')), "W5", "an early bye sits among the results");
    const { doc: dal } = await dom("/team/dallas-cowboys/schedule/");
    assert.equal(text(dal.querySelector('[data-board="remaining"] .sct-srow.is-bye .sct-srow-week')), "W14", "a late bye sits in the remaining schedule");
    assert.equal(dal.querySelector("#postseason-schedule"), null, "no postseason section for a club without one");
  });

  test("the page is server-rendered and carries no second copy of the schedule", async () => {
    const page = await get(IND);
    assert.equal((page.body.match(/data-board="results"/g) ?? []).length, 1);
    assert.equal((page.body.match(/data-board="remaining"/g) ?? []).length, 1);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, indexifembedded");
    assert.match(page.body, /<link rel="canonical" href="[^"]+\/team\/indianapolis-colts\/schedule\/"/);
  });
});

describe("the hub's schedule preview", () => {
  test("last game, next game, two more, and the way to the page - nothing else", async () => {
    const { doc, body } = await dom("/team/indianapolis-colts");
    const tab = doc.querySelector('.sct-nav-link[data-sct-panel-id="schedule"]');
    assert.equal(tab.getAttribute("href"), "/team/indianapolis-colts/#schedule", "a hash tab on the hub");
    const panel = doc.getElementById("schedule");
    const cards = [...panel.querySelectorAll(".sct-game")];
    assert.equal(cards.length, 4);
    assert.ok(cards[0].hasAttribute("data-last"));
    assert.match(text(cards[0]), /^Last game Week 6 L 20–26/);
    assert.ok(cards[1].hasAttribute("data-next"));
    assert.match(text(cards[1].querySelector(".sct-game-next")), /^(Next game|Today's game|Live now)$/);
    assert.equal(panel.querySelector(".sct-sboard"), null, "no boards on the hub");
    assert.equal(panel.querySelector(".sct-shape"), null, "no rail on the hub");
    assert.equal(panel.querySelector(".sct-series"), null, "no pair index on the hub");
    assert.equal(doc.querySelector('[data-sct-faq-for="schedule"]'), null, "no schedule questions on the hub");
    const full = [...panel.querySelectorAll("a")].find((a) => /View full Indianapolis Colts schedule/.test(text(a)));
    assert.equal(full.getAttribute("href"), "/team/indianapolis-colts/schedule/");
    assert.ok(!/sct-schedule-data/.test(body), "no game list island on the hub");
  });

  test("a section page's strip links the schedule's real address", async () => {
    const { doc } = await dom("/team/indianapolis-colts/stats/");
    const tab = doc.querySelector('.sct-nav-link[data-sct-panel-id="schedule"]');
    assert.equal(tab.getAttribute("href"), "/team/indianapolis-colts/schedule/");
  });
});
