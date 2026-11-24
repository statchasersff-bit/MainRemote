/**
 * Team Pages Phase 7 (2026-11-20): rematch links and dated previews, and the
 * team News tab's conditional 45-day rule.
 *
 * An upcoming meeting the pair's page is not previewing yet - a divisional
 * rematch more than six days out - opens its own dated preview, noindex and
 * with no canonical, until the pair's page takes the game over; then the
 * existing canonical-up rule applies. Pair URLs, earlier meetings and the
 * game sitemap are unchanged. docs/MATCHUP-REMATCH-OPTIONS-A-VS-D.md.
 */
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { importModule } from "./helpers/bundle.mjs";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const DAY = 24 * 60 * 60 * 1000;
const SEASON = 2026;

let pair;
let link;
before(async () => {
  pair = await importModule("lib/matchup/pair");
  link = await importModule("lib/matchup/game-link");
});

/** A meeting as the link rule reads it. */
const m = (week, kickoffMs, isFinal, extra = {}) => ({
  season: SEASON,
  week,
  seasonType: "regular",
  kickoffMs,
  isFinal,
  ...extra,
});
const opts = (now) => ({ prefix: "/nfl/", query: "", currentSeason: SEASON, now });
const href = (meeting, meetings, now) =>
  link.gameLink("SEA", "SF", meeting, meetings, opts(now));
const PAIR = "/nfl/san-francisco-49ers-vs-seattle-seahawks/";

describe("the shared game-link rule", () => {
  const now = Date.UTC(2026, 10, 20, 12);

  test("an upcoming rematch more than six days out opens its own preview", () => {
    const g1 = m(5, now - 40 * DAY, true);
    const g2 = m(12, now + 10 * DAY, false);
    assert.equal(href(g2, [g1, g2], now), `${PAIR}2026-week-12/`);
  });

  test("the earlier meeting links its own dated page while the pair page leads with it (WEB-001)", () => {
    const g1 = m(5, now - 40 * DAY, true);
    const g2 = m(12, now + 10 * DAY, false);
    assert.equal(href(g1, [g1, g2], now), `${PAIR}2026-week-5/`);
  });

  test("the transition: inside six days the pair page previews the rematch; the rematch link stays its own page (WEB-040)", () => {
    const g1 = m(5, now - 40 * DAY, true);
    const g2 = m(12, now + 5 * DAY, false);
    // One stable URL per game (WEB-040, 2026-11-24): the dated address serves
    // the preview, the live score and the box score, so links never move.
    assert.equal(href(g2, [g1, g2], now), `${PAIR}2026-week-12/`, "the rematch link is its own dated page");
    assert.equal(href(g1, [g1, g2], now), `${PAIR}2026-week-5/`, "the earlier recap has its own address, as before");
  });

  test("once the rematch is played both games link their own addresses (WEB-001)", () => {
    const g1 = m(5, now - 60 * DAY, true);
    const g2 = m(12, now - 2 * DAY, true);
    assert.equal(href(g2, [g1, g2], now), `${PAIR}2026-week-12/`);
    assert.equal(href(g1, [g1, g2], now), `${PAIR}2026-week-5/`);
  });

  test("a matchup with only one scheduled meeting links its dated page before and after (WEB-040)", () => {
    const upcoming = m(14, now + 20 * DAY, false);
    assert.equal(href(upcoming, [upcoming], now), `${PAIR}2026-week-14/`, "upcoming: its own dated page, the one URL for the game");
    const played = m(3, now - 50 * DAY, true);
    assert.equal(href(played, [played], now), `${PAIR}2026-week-3/`, "played: its own dated page (WEB-001)");
  });

  test("an unknown kickoff (TBD) rematch opens its own preview", () => {
    const g1 = m(3, now - 60 * DAY, true);
    const g2 = m(18, null, false);
    assert.equal(href(g2, [g1, g2], now), `${PAIR}2026-week-18/`);
    assert.equal(href(g1, [g1, g2], now), `${PAIR}2026-week-3/`, "the played game is at its own address (WEB-001)");
  });

  test("two undated fixtures are told apart by identity, not by their (equal) kickoffs", () => {
    const a = m(16, null, false);
    const b = m(18, null, false);
    assert.equal(href(a, [a, b], now), `${PAIR}2026-week-16/`, "each its own week, never confused");
    assert.equal(href(b, [a, b], now), `${PAIR}2026-week-18/`);
  });

  test("a postponed game is still a game: it follows the same rule on its new date", () => {
    const g1 = m(5, now - 40 * DAY, true);
    const moved = m(12, now + 9 * DAY, false); // postponed to a later date
    assert.equal(href(moved, [g1, moved], now), `${PAIR}2026-week-12/`, "more than six days out: its preview");
    const soon = m(12, now + 2 * DAY, false);
    assert.equal(href(soon, [g1, soon], now), `${PAIR}2026-week-12/`, "rescheduled into the window: still its own page (WEB-040)");
  });

  test("a canceled game, or an unplayed game of another season, links the pair page", () => {
    const g1 = m(5, now - 40 * DAY, true);
    const off = m(12, now + 10 * DAY, false, { canceled: true });
    assert.equal(href(off, [g1, off], now), PAIR);
    const other = { ...m(12, now + 10 * DAY, false), season: 2025 };
    assert.equal(href(other, [g1, other], now), PAIR);
  });

  test("teamMeetings and meetingForWeek read a club schedule the way the team pages do", () => {
    const sf = { abbreviation: "sf" };
    const schedule = {
      season: SEASON,
      games: [
        { week: 5, seasonType: "regular", opponent: sf, kickoffMs: now - 40 * DAY, status: "final", result: "W" },
        { week: 9, seasonType: "regular", opponent: { abbreviation: "lar" }, kickoffMs: now - 10 * DAY, status: "final", result: "L" },
        { week: 12, seasonType: "regular", opponent: sf, kickoffMs: now + 10 * DAY, status: "scheduled", result: null },
      ],
    };
    const meetings = link.teamMeetings(schedule, sf);
    assert.deepEqual(meetings.map((x) => x.week), [5, 12]);
    assert.equal(link.meetingForWeek(meetings, 12, "regular").isFinal, false);
    assert.equal(link.meetingForWeek(meetings, 9, "regular"), null);
  });
});

describe("the dated preview around the six-day switch (real data, real HTTP)", () => {
  // SF-SEA Week 12, stored as 2026-11-29 16:25 ET (data/schedule/games.csv).
  // Each server starts on its own clock (tests/helpers/fake-clock.mjs).
  const KICKOFF = Date.UTC(2026, 10, 29, 21, 25);
  const PAIR_SLUG = "san-francisco-49ers-vs-seattle-seahawks";
  const DATED = `/nfl/${PAIR_SLUG}/2026-week-12/`;
  const clock = (ms) => ({
    SC_FAKE_NOW: String(ms),
    NODE_OPTIONS: `--import ${path.join(APP_DIR, "tests", "helpers", "fake-clock.mjs")}`,
  });
  const get = async (server, p, headers = {}) => {
    const r = await fetch(server.origin + p, { headers: { connection: "close", ...headers } });
    return { status: r.status, headers: r.headers, body: await r.text() };
  };
  const canonicalOf = (b) => b.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.replace(/^https?:\/\/[^/]+/, "") ?? null;
  const robotsOf = (b) => b.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? null;
  const titleOf = (b) => (b.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/&amp;/g, "&");

  let early;
  let late;
  let etagEarly;
  before(async () => {
    early = await startServer(clock(KICKOFF - 9 * DAY));
    late = await startServer(clock(KICKOFF - 3 * DAY));
  });
  after(async () => {
    await early?.stop();
    await late?.stop();
  });

  test("before the switch: the dated preview has no canonical and no SportsEvent", async () => {
    const page = await get(early, DATED);
    assert.equal(page.status, 200);
    // This origin's own page is always noindex (matchup.html); the indexed
    // WordPress page gets noindex, follow from the plugin (smoke.php).
    assert.equal(robotsOf(page.body), "noindex, indexifembedded");
    assert.equal(canonicalOf(page.body), null);
    assert.doesNotMatch(page.body, /"@type":"SportsEvent"/);
    assert.match(titleOf(page.body), /Preview.*Week 12, 2026/);
  });

  test("before the switch: the plugin is told 'preview', and an older plugin still gets the 404", async () => {
    const withHeader = await get(early, `/embed/matchup/${PAIR_SLUG}?game=2026-week-12`, { "x-sc-matchup-preview": "1" });
    assert.equal(withHeader.status, 200);
    assert.equal(withHeader.headers.get("x-matchup-game"), "preview");
    assert.equal(withHeader.headers.get("x-matchup-state"), "upcoming");
    assert.doesNotMatch(withHeader.body, /sct-matchup-event-data/);
    etagEarly = withHeader.headers.get("etag");
    const without = await get(early, `/embed/matchup/${PAIR_SLUG}?game=2026-week-12`);
    assert.equal(without.status, 404);
  });

  test("before the switch: the pair page is the series page, the earlier meeting its own (WEB-001)", async () => {
    const pairPage = await get(early, `/nfl/${PAIR_SLUG}/`);
    assert.equal(canonicalOf(pairPage.body), `/nfl/${PAIR_SLUG}/`);
    assert.match(titleOf(pairPage.body), /Box Score/);
    assert.ok(pairPage.body.includes(`/nfl/${PAIR_SLUG}/2026-week-5/`), "the pair page links the Week 5 box score");
    const prior = await get(early, `/embed/matchup/${PAIR_SLUG}?game=2026-week-5`, { "x-sc-matchup-preview": "1" });
    assert.equal(prior.headers.get("x-matchup-game"), "archived", "the Week 5 recap is canonical at its own address");
    const page = await get(early, `/nfl/${PAIR_SLUG}/2026-week-5/`);
    assert.equal(canonicalOf(page.body), `/nfl/${PAIR_SLUG}/2026-week-5/`);
    assert.match(page.body, /"@type":"SportsEvent"/);
  });

  test("before the switch: Seattle's Schedule, Matchups and Overview open the Week 12 preview", async () => {
    for (const tab of ["schedule/", "matchups/", ""]) {
      const page = await get(early, `/team/seattle-seahawks/${tab}`);
      assert.ok(page.body.includes(`${PAIR_SLUG}/2026-week-12/`), `${tab || "hub"} links the dated preview`);
    }
  });

  test("an unknown kickoff (Week 18, TBD) is a preview with no canonical too", async () => {
    const page = await get(early, "/nfl/arizona-cardinals-vs-san-francisco-49ers/2026-week-18/");
    assert.equal(page.status, 200);
    assert.equal(canonicalOf(page.body), null);
    assert.match(titleOf(page.body), /Week 18, 2026/);
  });

  test("a week the two do not play is still a 404", async () => {
    const page = await get(early, `/nfl/${PAIR_SLUG}/2026-week-2/`);
    assert.equal(page.status, 404);
  });

  test("after the switch: the existing canonical-up rule, and the pair page previews Week 12", async () => {
    const page = await get(late, DATED);
    assert.equal(page.status, 200);
    assert.equal(canonicalOf(page.body), `/nfl/${PAIR_SLUG}/`);
    const embed = await get(late, `/embed/matchup/${PAIR_SLUG}?game=2026-week-12`, { "x-sc-matchup-preview": "1" });
    assert.equal(embed.headers.get("x-matchup-game"), "current");
    const pairPage = await get(late, `/nfl/${PAIR_SLUG}/`);
    assert.match(titleOf(pairPage.body), /Preview.*Week 12, 2026/);
    const team = await get(late, "/team/seattle-seahawks/schedule/");
    assert.ok(team.body.includes(`${PAIR_SLUG}/2026-week-12/`), "the rematch row keeps linking its own dated page (WEB-040: one URL per game)");
    assert.ok(team.body.includes(`${PAIR_SLUG}/2026-week-5/`), "and the Week 5 row its own recap, as before");
  });

  test("a copy cached before the switch is not revalidated after it", async () => {
    assert.ok(etagEarly, "an ETag was served before the switch");
    const page = await get(late, `/embed/matchup/${PAIR_SLUG}?game=2026-week-12`, {
      "x-sc-matchup-preview": "1",
      "if-none-match": etagEarly,
    });
    assert.equal(page.status, 200, "not a 304: the cache must take the new canonical");
    assert.notEqual(page.headers.get("etag"), etagEarly);
    assert.equal(page.headers.get("x-matchup-game"), "current");
  });
});

describe("team News: the conditional 45-day rule", () => {
  let data;
  before(async () => {
    data = await importModule("lib/team/news-window");
  });
  const now = Date.UTC(2026, 10, 20, 12);
  const item = (days, id) => ({ id: String(id), pubDateMs: now - days * DAY });

  test("20 or more recent stories: only the recent ones, in their order", () => {
    const items = [...Array.from({ length: 41 }, (_, i) => item(i, i)), ...Array.from({ length: 12 }, (_, i) => item(60 + i * 8, 100 + i))];
    const out = data.recentTeamNews(items, now);
    assert.equal(out.length, 41, "Washington-shaped: 53 down to 41");
    assert.deepEqual(out.map((x) => x.id), items.slice(0, 41).map((x) => x.id));
  });

  test("fewer than 20 recent stories (the offseason): the list is unchanged", () => {
    const items = [...Array.from({ length: 5 }, (_, i) => item(i * 5, i)), ...Array.from({ length: 30 }, (_, i) => item(50 + i * 3, 100 + i))];
    assert.deepEqual(data.recentTeamNews(items, now), items);
    assert.deepEqual(data.recentTeamNews([], now), []);
  });

  test("the boundary: exactly 20 recent applies the rule, 19 does not", () => {
    const old = [item(100, "old")];
    assert.equal(data.recentTeamNews([...Array.from({ length: 20 }, (_, i) => item(1, i)), ...old], now).length, 20);
    assert.equal(data.recentTeamNews([...Array.from({ length: 19 }, (_, i) => item(1, i)), ...old], now).length, 20);
  });

  test("a story without a date never counts as recent", () => {
    const items = [...Array.from({ length: 19 }, (_, i) => item(1, i)), { id: "undated", pubDateMs: null }];
    assert.equal(data.recentTeamNews(items, now).length, 20, "19 dated recent: rule not applied, list unchanged");
  });

  test("the constants are the approved 45 days and 20 stories", () => {
    assert.equal(data.RECENT_NEWS_DAYS, 45);
    assert.equal(data.RECENT_NEWS_MIN, 20);
  });
});
