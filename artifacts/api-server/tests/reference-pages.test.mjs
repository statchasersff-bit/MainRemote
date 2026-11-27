/**
 * Reference pages, 2026-11-20 (follow-up to the 2026-11-18 audit, WEB-031..034).
 *
 * - FPA labels name the last COMPLETE week: on Nov 20 the live page said
 *   "Weeks 1-11" with one Week 11 game (IND at HOU, Thursday) played, and the
 *   player pages' matchup note said "Measured through Week 11".
 * - The NFL Player Stats "Updated" date is the site's Eastern date, not UTC's.
 *
 * Inputs are the stored 2026-11-18 slate fixture and synthetic tables; nothing
 * here reads today's live numbers.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLATE_CSV = fs.readFileSync(path.join(HERE, "fixtures", "audit-2026-11-18", "slate-2026.csv"), "utf8");

let wc, coverageTs, seo, sosRender, statsRender, statsData, ranks, fpaRender;
before(async () => {
  wc = await importModule("lib/fpa/week-coverage");
  coverageTs = await importModule("lib/data-coverage");
  seo = await importModule("lib/fpa-seo");
  sosRender = await importModule("lib/sos-render");
  statsRender = await importModule("lib/player-stats-render");
  statsData = await importModule("lib/player-stats/stats-data");
  ranks = await importModule("lib/player/ranks");
  fpaRender = await importModule("lib/fpa-render");
});
after(cleanupBundles);

const games = () => coverageTs.slateGames(2026, SLATE_CSV);
/** Every scheduled club-week through `week`, as the FPA game rows would hold them. */
function heldThrough(week) {
  const out = new Set();
  for (const g of games()) if (g.week <= week) out.add(`${g.week}:${g.away}`).add(`${g.week}:${g.home}`);
  return out;
}

describe("FPA week coverage: the last complete week, and the partial one named", () => {
  test("Nov 20: Weeks 1-10 complete, Thursday's IND at HOU is a partial Week 11", () => {
    const present = heldThrough(10).add("11:IND").add("11:HOU");
    const c = wc.fpaWeekCoverage(present, games());
    assert.deepEqual({ ...c }, { completeThroughWeek: 10, partialWeek: 11, partialGames: ["IND at HOU"] });
  });

  test("a finished week with nothing after it: complete, no partial week", () => {
    const c = wc.fpaWeekCoverage(heldThrough(10), games());
    assert.deepEqual({ ...c }, { completeThroughWeek: 10, partialWeek: null, partialGames: [] });
  });

  test("Monday night not yet in: Week 10 is partial, Week 9 the last complete", () => {
    const present = heldThrough(10);
    present.delete("10:LAC");
    present.delete("10:BAL");
    const c = wc.fpaWeekCoverage(present, games());
    assert.equal(c.completeThroughWeek, 9);
    assert.equal(c.partialWeek, 10);
    assert.equal(c.partialGames.length, 13);
    assert.ok(!c.partialGames.includes("LAC at BAL"));
  });

  test("bye weeks never hold a week back", () => {
    const week6 = new Set(games().filter((g) => g.week === 6).flatMap((g) => [g.away, g.home]));
    assert.ok(week6.size < 32, "the fixture has byes in Week 6");
    assert.equal(wc.fpaWeekCoverage(heldThrough(6), games()).completeThroughWeek, 6);
  });

  test("early season: Week 1's Thursday game alone completes nothing", () => {
    const opener = games().filter((g) => g.week === 1).sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime))[0];
    const c = wc.fpaWeekCoverage(new Set([`1:${opener.away}`, `1:${opener.home}`]), games());
    assert.equal(c.completeThroughWeek, 0);
    assert.equal(c.partialWeek, 1);
    assert.deepEqual(c.partialGames, [`${opener.away} at ${opener.home}`]);
  });

  test("one defense with rows is not a held game: both sides must count it", () => {
    const c = wc.fpaWeekCoverage(heldThrough(10).add("11:IND"), games());
    assert.equal(c.partialWeek, null);
  });

  test("no rows or no schedule: unknown, not zero", () => {
    assert.equal(wc.fpaWeekCoverage(new Set(), games()), null);
    assert.equal(wc.fpaWeekCoverage(heldThrough(10), []), null);
  });
});

describe("FPA page words follow the complete week", () => {
  const live = (over = {}) => ({
    rows: [], kind: "live", season: 2026, baselineSeason: 2025, isPreseason: false, archiveSeasons: [2025],
    updatedAtMs: Date.parse("2026-11-20T15:28:55Z"), weekNumber: 10, partialWeek: 11, partialGames: ["IND at HOU"], ...over,
  });

  test("title, H1 and description: the spec's last completed week, unchanged wording", () => {
    const copy = seo.fpaPageCopy(live());
    assert.equal(copy.title, "Fantasy Points Allowed by Position 2026 (Weeks 1–10)");
    assert.equal(copy.h1, "Fantasy Points Allowed by Position: Weeks 1–10, 2026");
    assert.match(copy.description, /through Week 10 of 2026, raw and schedule-adjusted\. Updated Nov 20\.$/);
  });

  test("the Updated line and the table's scope name the partial week's games", () => {
    const copy = seo.fpaPageCopy(live());
    assert.equal(copy.updatedLine, "Updated Nov 20, through Week 10 and 1 Week 11 game (IND at HOU)");
    assert.equal(seo.fpaScopeLabel(live()), "Fantasy points allowed per game, Weeks 1–10 and 1 Week 11 game (IND at HOU)");
  });

  test("more than three partial games are counted, not listed", () => {
    const d = live({ partialWeek: 10, weekNumber: 9, partialGames: ["A at B", "C at D", "E at F", "G at H"] });
    assert.equal(seo.fpaScopeRange(d), "Weeks 1–9 and 4 Week 10 games");
  });

  test("a complete week reads exactly as before", () => {
    const d = live({ partialWeek: null, partialGames: [] });
    assert.equal(seo.fpaPageCopy(d).updatedLine, "Updated Nov 20, through Week 10");
    assert.equal(seo.fpaScopeRange(d), "Weeks 1–10");
    // Tables built before the fields existed have neither.
    assert.equal(seo.fpaScopeRange({ ...d, partialWeek: undefined, partialGames: undefined }), "Weeks 1–10");
  });
});

describe("SOS baseline badge: phase from the blend, words from the complete week", () => {
  const board = (over) => ({ season: 2026, isPreseason: false, methodology: "A rolling ten-week window of 2026 data only.", ...over });

  test("Thursday of Week 12: the rolling window is on, the label says through Week 11", () => {
    const info = sosRender.baselineInfo(board({ weekNumber: 11, ingestedWeek: 12 }));
    assert.equal(info.phase, 3);
    assert.match(info.lead, /^Through Week 11: /);
  });

  test("a board without ingestedWeek keeps the old reading", () => {
    assert.equal(sosRender.baselineInfo(board({ weekNumber: 12 })).phase, 3);
    assert.equal(sosRender.baselineInfo(board({ weekNumber: 11 })).phase, 2);
  });
});

describe("matchup ranks: missing data shows no rank", () => {
  test("an opponent the FPA table has no cell for gets no rank, not a guessed one", () => {
    const map = ranks.fpaOppRanks([{ team: { code: "NO" }, abbr: "NO", byPos: { RB: { rank: 2 } } }]);
    const log = ranks.attachOppRanks([{ week: 1, opp: "NO", stats: {} }, { week: 2, opp: "BUF", stats: {} }], "RB", map, "fpa-current");
    assert.deepEqual(log.map((e) => e.opp_rank_vs_pos), [2, null]);
  });
});

describe("NFL Player Stats: the Updated date is the Eastern date", () => {
  test("a build at 02:00 UTC on Nov 19 was the evening of Nov 18", () => {
    const base = statsData.getStatsTable("QB", 2026);
    assert.ok(base, "the 2026 QB table loads");
    const html = statsRender.renderStatsPage({ ...base, updatedAt: "2026-11-19T02:00:46Z" }, {});
    assert.match(html, /Updated <time datetime="2026-11-19T02:00:46Z">November 18, 2026<\/time>/);
  });

  test("midday UTC is the same day in Eastern", () => {
    const base = statsData.getStatsTable("QB", 2026);
    const html = statsRender.renderStatsPage({ ...base, updatedAt: "2026-11-16T13:45:44Z" }, {});
    assert.match(html, />November 16, 2026<\/time>/);
  });
});

/* ------------------------------------------- the Week 11 -> 12 transition */

describe("through the week: data coverage and the start/sit week move independently", () => {
  const week11 = () => games().filter((g) => g.week === 11);
  const lastOf11 = () => [...week11()].sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime)).at(-1);
  const liveTable = (cover, startSit) => {
    const data = {
      rows: [], kind: "live", season: 2026, baselineSeason: 2025, currentSeason: 2026, isPreseason: false, archiveSeasons: [],
      format: "half", view: "raw", updatedAtMs: Date.parse("2026-11-24T12:00:00Z"), dataMode: "Week 10", methodology: "x", version: "t",
      weekNumber: cover.completeThroughWeek, partialWeek: cover.partialWeek, partialGames: cover.partialGames,
    };
    const html = fpaRender.renderFpaPage(data, { embed: true }, { teaser: null, startSitWeek: startSit });
    const note = html.match(/data-scf-startsit>[\s\S]*?class="scf-card-note">([^<]*)</)[1];
    const href = html.match(/data-scf-startsit>[\s\S]*?href="([^"]*)"/)[1];
    return { scope: seo.fpaScopeRange(data), updated: seo.fpaPageCopy(data).updatedLine, note, href };
  };

  test("Monday night has ended but its rows have not arrived: Week 11 stays partial", () => {
    const last = lastOf11();
    assert.equal(`${last.away} at ${last.home}`, "CIN at WAS", "Week 11 closes on Monday night");
    const present = heldThrough(11);
    present.delete(`11:${last.away}`);
    present.delete(`11:${last.home}`);
    const c = wc.fpaWeekCoverage(present, games());
    assert.equal(c.completeThroughWeek, 10);
    assert.equal(c.partialWeek, 11);
    assert.equal(c.partialGames.length, week11().length - 1);
    const page = liveTable(c, 11);
    assert.equal(page.scope, `Weeks 1\u201310 and ${week11().length - 1} Week 11 games`);
    assert.equal(page.note, "Week 11: compare two players head to head.");
  });

  test("every Week 11 game in: Weeks 1-11, no partial note; the card stays on Week 11 until the tool rolls", () => {
    const c = wc.fpaWeekCoverage(heldThrough(11), games());
    assert.deepEqual({ ...c }, { completeThroughWeek: 11, partialWeek: null, partialGames: [] });
    const beforeRoll = liveTable(c, 11);
    assert.equal(beforeRoll.scope, "Weeks 1\u201311");
    assert.equal(beforeRoll.updated, "Updated Nov 24, through Week 11");
    assert.equal(beforeRoll.note, "Week 11: compare two players head to head.", "FPA completing Week 11 does not move the card");
    const afterRoll = liveTable(c, 12);
    assert.equal(afterRoll.note, "Week 12: compare two players head to head.", "the card moves when the tool does");
    assert.equal(afterRoll.href, beforeRoll.href, "one destination: the tool's hub, which names its own week");
    assert.equal(afterRoll.href, "https://statchasers.com/redraft-command/who-should-i-start");
  });

  test("Thursday of Week 11 with the tool on Week 11: the card says Week 11, not the old table-week + 1", () => {
    const c = wc.fpaWeekCoverage(heldThrough(10).add("11:IND").add("11:HOU"), games());
    assert.equal(liveTable(c, 11).note, "Week 11: compare two players head to head.");
  });

  test("the start/sit week is the tool's rule: Sleeper's week in the regular season and playoffs, none otherwise", () => {
    assert.equal(fpaRender.startSitWeek({ seasonType: "regular", week: 11 }), 11);
    assert.equal(fpaRender.startSitWeek({ seasonType: "post", week: 19 }), 19);
    assert.equal(fpaRender.startSitWeek({ seasonType: "pre", week: 3 }), null, "preseason games are not a fantasy week");
    assert.equal(fpaRender.startSitWeek({ seasonType: "off", week: 0 }), null, "the fallback state when Sleeper is unreachable");
    assert.equal(fpaRender.startSitWeek(null), null);
    const c = wc.fpaWeekCoverage(heldThrough(10), games());
    assert.equal(liveTable(c, null).note, "This week: compare two players head to head.");
  });
});

describe("stored rows: a game counts once, and duplicates never hide a missing side", () => {
  const rowsFor = (present, copies = 1) => [...present].flatMap((k) => {
    const [week, team] = k.split(":");
    return Array.from({ length: copies }, (_, i) => ({ week: Number(week), defense: team, pos: ["QB", "RB", "WR", "TE"][i % 4] }));
  });

  test("many rows per club-week (one per player and position) are one club-week", () => {
    const held = wc.heldClubWeeks(rowsFor(heldThrough(10).add("11:IND").add("11:HOU"), 9));
    assert.equal(held.size, heldThrough(10).size + 2);
    assert.deepEqual({ ...wc.fpaWeekCoverage(held, games()) }, { completeThroughWeek: 10, partialWeek: 11, partialGames: ["IND at HOU"] });
  });

  test("Indianapolis's rows repeated cannot stand in for Houston's missing side", () => {
    const rows = [...rowsFor(heldThrough(10), 3), ...Array.from({ length: 50 }, () => ({ week: 11, defense: "IND" }))];
    const c = wc.fpaWeekCoverage(wc.heldClubWeeks(rows), games());
    assert.equal(c.partialWeek, null);
    assert.equal(c.completeThroughWeek, 10);
  });

  test("a Week 10 side missing is not covered by rows from other weeks", () => {
    const present = heldThrough(11);
    present.delete("10:BAL");
    const rows = [...rowsFor(present, 4), { week: 11, defense: "BAL" }, { week: 11, defense: "BAL" }];
    const c = wc.fpaWeekCoverage(wc.heldClubWeeks(rows), games());
    assert.equal(c.completeThroughWeek, 9);
    assert.equal(c.partialWeek, 10);
  });

  test("the Rams' two spellings are one club", () => {
    const held = wc.heldClubWeeks([{ week: 1, defense: "LA" }, { week: 1, defense: "LAR" }, { week: 1, defense: "la" }]);
    assert.equal(held.size, 1);
  });
});

describe("NFL Player Stats: Eastern date around midnight and the clock change", () => {
  const dateFor = (iso) => {
    const base = statsData.getStatsTable("QB", 2026);
    return statsRender.renderStatsPage({ ...base, updatedAt: iso }, {}).match(/class="sca-meta-updated">Updated <time[^>]*>([^<]*)</)[1];
  };
  test("one minute either side of Eastern midnight (EST, UTC-5)", () => {
    assert.equal(dateFor("2026-11-20T04:59:00Z"), "November 19, 2026");
    assert.equal(dateFor("2026-11-20T05:00:00Z"), "November 20, 2026");
  });
  test("summer time (EDT, UTC-4)", () => {
    assert.equal(dateFor("2026-09-15T03:30:00Z"), "September 14, 2026");
    assert.equal(dateFor("2026-09-15T04:00:00Z"), "September 15, 2026");
  });
  test("New Year's Eve evening in Eastern is still the old year", () => {
    assert.equal(dateFor("2027-01-01T02:00:00Z"), "December 31, 2026");
  });
  test("a bare date is printed as written", () => {
    assert.equal(dateFor("2026-11-19"), "November 19, 2026");
  });
});

describe("FPA table counts complete weeks only (mak, 2026-11-27)", () => {
  /** One stored row per defense per scheduled game through `week`, plus extras. */
  function rowsThrough(week, extra = []) {
    const out = [];
    for (const g of games()) {
      if (g.week > week) continue;
      out.push({ week: g.week, defenseTeam: g.away }, { week: g.week, defenseTeam: g.home });
    }
    return out.concat(extra);
  }

  test("a Thursday game of the next week is left out of the table", () => {
    const thu = games().find((g) => g.week === 11);
    const rows = rowsThrough(10, [{ week: 11, defenseTeam: thu.away }, { week: 11, defenseTeam: thu.home }]);
    const kept = wc.completeWeekRows(rows, games());
    assert.equal(Math.max(...kept.map((r) => r.week)), 10);
    assert.equal(kept.length, rows.length - 2);
    // Ten distinct weeks, so the blend stays on its 90% schedule rather than
    // flipping to the rolling window at "12 weeks played".
    assert.equal(new Set(kept.map((r) => r.week)).size, 10);
  });

  test("a complete week counts in full", () => {
    const rows = rowsThrough(11);
    assert.equal(wc.completeWeekRows(rows, games()).length, rows.length);
  });

  test("a missing Monday game holds back that whole week and anything after it", () => {
    const rows = rowsThrough(11).filter((r) => !(r.week === 10 && (r.defenseTeam === "LAC" || r.defenseTeam === "BAL")));
    const kept = wc.completeWeekRows(rows, games());
    assert.equal(Math.max(...kept.map((r) => r.week)), 9);
  });

  test("no schedule to tell by: every row counts, so the table cannot empty", () => {
    const rows = rowsThrough(10, [{ week: 11, defenseTeam: "IND" }]);
    assert.equal(wc.completeWeekRows(rows, []).length, rows.length);
  });
});
