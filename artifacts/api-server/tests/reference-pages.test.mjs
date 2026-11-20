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

let wc, coverageTs, seo, sosRender, statsRender, statsData, ranks;
before(async () => {
  wc = await importModule("lib/fpa/week-coverage");
  coverageTs = await importModule("lib/data-coverage");
  seo = await importModule("lib/fpa-seo");
  sosRender = await importModule("lib/sos-render");
  statsRender = await importModule("lib/player-stats-render");
  statsData = await importModule("lib/player-stats/stats-data");
  ranks = await importModule("lib/player/ranks");
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
