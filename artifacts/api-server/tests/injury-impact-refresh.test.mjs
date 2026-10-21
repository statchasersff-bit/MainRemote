/**
 * The in-season injury refresh (scripts/injury-impact/refresh-lib.mjs): the
 * nflverse weekly reports and play-by-play injury events merged into the
 * packed history, under the rules the research repo's builders use. Small
 * synthetic inputs; the command itself is exercised by hand against nflverse.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_KEYS,
  INGAME_KEYS,
  addRosterToIndex,
  buildRosterMaps,
  eventsFromPlay,
  extractStatus,
  fillSleeperIds,
  latestFacts,
  maxStoredWeek,
  mergeEvents,
  mergeReports,
  parseCsvLine,
  reportRowsFromCsv,
  resolveGsis,
  rosterPlayers,
  updateSearchIndex,
} from "../scripts/injury-impact/refresh-lib.mjs";
import { importModule } from "./helpers/bundle.mjs";

const player = await importModule("lib/injury-impact/player");

const INJURIES_HEADER = "season,season_type,game_type,team,week,gsis_id,position,full_name,first_name,last_name,report_primary_injury,report_secondary_injury,report_status,practice_primary_injury,practice_secondary_injury,practice_status";
const injuriesCsv = (rows) => [INJURIES_HEADER, ...rows].join("\n");

const ROSTER_HEADER = "season,team,position,depth_chart_position,jersey_number,status,full_name,first_name,last_name,gsis_id,sleeper_id,week";
const rosterCsv = (rows) => [ROSTER_HEADER, ...rows].join("\n");

/** A shard map with one player holding the pack's 2026 weeks 5 and 6 and a 2024 event. */
function shards() {
  const m = new Map();
  m.set("76", {
    keys: { h: HISTORY_KEYS, g: INGAME_KEYS },
    players: {
      "00-0035676": {
        h: [
          [2026, 6, "NE", "Ankle", null, "Ankle", null, "Questionable", "Limited Participation in Practice", null],
          [2026, 5, "NE", null, null, "Ankle", null, null, "Full Participation in Practice", null],
          [2025, 17, "PHI", null, null, "Teeth", null, null, "Full Participation in Practice", null],
        ],
        g: [[2024, 1, "REG", "2024_01_GB_PHI", "2024-09-06", "PHI", "GB", 4, "07:52", null, "PHI-11-A.Brown was injured during the play."]],
      },
    },
  });
  return m;
}

describe("csv", () => {
  test("quoted fields keep their commas and quotes", () => {
    assert.deepEqual(parseCsvLine('a,"b, c","d ""e""",'), ["a", "b, c", 'd "e"', ""]);
  });

  test("report rows are packed in the shard's key order; blanks and NA are null; no date column means null", () => {
    const rows = reportRowsFromCsv(injuriesCsv(["2026,REG,REG,NE,7,00-0035676,WR,A.J. Brown,Arthur,Brown,,NA,,Ankle,,Limited Participation in Practice"]));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].row, [2026, 7, "NE", null, null, "Ankle", null, null, "Limited Participation in Practice", null]);
    assert.equal(rows[0].fullName, "A.J. Brown");
    assert.equal(rows[0].position, "WR");
  });

  test("a row without a GSIS id is skipped", () => {
    assert.equal(reportRowsFromCsv(injuriesCsv(["2026,REG,REG,NE,7,,WR,Nobody,No,Body,,,,Knee,,Full Participation in Practice"])).length, 0);
  });
});

describe("weekly reports", () => {
  test("the pack's last week is the boundary", () => {
    assert.equal(maxStoredWeek(shards(), 2026), 6);
    assert.equal(maxStoredWeek(shards(), 2027), 0);
  });

  test("owned weeks are rewritten, earlier weeks kept, new players added, newest first", () => {
    const s = shards();
    const reports = reportRowsFromCsv(
      injuriesCsv([
        "2026,REG,REG,NE,7,00-0035676,WR,A.J. Brown,Arthur,Brown,,,,Ankle,,Limited Participation in Practice",
        "2026,REG,REG,NE,6,00-0035676,WR,A.J. Brown,Arthur,Brown,Knee,,Out,Knee,,Did Not Participate In Practice",
        "2026,REG,REG,NE,7,00-0040200,K,Andy Borregales,Andres,Borregales,,,,Not injury related - personal matter,,Full Participation in Practice",
      ]),
    );
    const r = mergeReports(s, 2026, 7, reports);
    const ajb = s.get("76").players["00-0035676"];
    assert.equal(ajb.h.length, 4);
    assert.deepEqual(ajb.h.map((x) => [x[0], x[1]]), [[2026, 7], [2026, 6], [2026, 5], [2025, 17]]);
    // Week 6 is the pack's: the nflverse "Out" row for it was not taken.
    assert.equal(ajb.h[1][7], "Questionable");
    assert.equal(s.get("00").players["00-0040200"].h.length, 1);
    assert.equal(r.added, 2);
    assert.deepEqual(r.weeks, { 7: 2 });
    assert.deepEqual([...r.touched].sort(), ["00-0035676", "00-0040200"]);
  });

  test("a second run replaces the owned rows instead of stacking them", () => {
    const s = shards();
    const wed = reportRowsFromCsv(injuriesCsv(["2026,REG,REG,NE,7,00-0035676,WR,A.J. Brown,Arthur,Brown,,,,Ankle,,Limited Participation in Practice"]));
    const fri = reportRowsFromCsv(injuriesCsv(["2026,REG,REG,NE,7,00-0035676,WR,A.J. Brown,Arthur,Brown,Ankle,,Questionable,Ankle,,Limited Participation in Practice"]));
    mergeReports(s, 2026, 7, wed);
    const r = mergeReports(s, 2026, 7, fri);
    const rows = s.get("76").players["00-0035676"].h.filter((x) => x[0] === 2026 && x[1] === 7);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][7], "Questionable");
    assert.equal(r.dropped, 1);
  });

  test("the search index follows the latest report: count, seasons, team", () => {
    const s = shards();
    const index = [["00-0035676", "A.J. Brown", "WR", "PHI", 2019, 2026, 3]];
    const reports = reportRowsFromCsv(
      injuriesCsv([
        "2026,REG,REG,NE,7,00-0035676,WR,A.J. Brown,Arthur,Brown,,,,Ankle,,Limited Participation in Practice",
        "2026,REG,REG,NE,7,00-0040200,K,Andy Borregales,Andres,Borregales,,,,Not injury related - personal matter,,Full Participation in Practice",
      ]),
    );
    const r = mergeReports(s, 2026, 7, reports);
    const { added } = updateSearchIndex(index, s, r.touched, latestFacts(reports));
    assert.equal(added, 1);
    assert.deepEqual(index[0], ["00-0035676", "A.J. Brown", "WR", "NE", 2025, 2026, 4]);
    assert.deepEqual(index[1], ["00-0040200", "Andy Borregales", "K", "NE", 2026, 2026, 1]);
  });
});

describe("in-game events", () => {
  const weekly = rosterCsv([
    "2026,PHI,WR,WR,11,ACT,A.J. Brown,Arthur,Brown,00-0035676,2019,1",
    "2026,GB,LB,LB,7,ACT,Quay Walker,Quay,Walker,00-0037259,8151,1",
    "2026,PHI,RB,RB,26,CUT,Other Barkley,Other,Barkley,00-0099999,1,1",
    "2026,PHI,RB,RB,26,ACT,Saquon Barkley,Saquon,Barkley,00-0034844,4866,1",
  ]);
  const seasonal = rosterCsv([
    "2026,PHI,WR,WR,11,ACT,A.J. Brown,Arthur,Brown,00-0035676,2019,",
    "2026,GB,LB,LB,7,ACT,Quay Walker,Quay,Walker,00-0037259,8151,",
    "2026,PHI,RB,RB,26,ACT,Saquon Barkley,Saquon,Barkley,00-0034844,4866,",
    "2026,DAL,CB,CB,12,ACT,Sam Smith,Sam,Smith,00-0011111,,",
    "2026,DAL,WR,WR,12,ACT,Sid Smith,Sid,Smith,00-0022222,,",
  ]);
  const maps = buildRosterMaps(weekly, seasonal);

  test("the weekly roster resolves the token first; a cut player with the same number does not collide", () => {
    assert.equal(resolveGsis(maps, "PHI", "26", "S.Barkley", 1), "00-0034844");
    assert.equal(resolveGsis(maps, "PHI", "11", "A.Brown", 1), "00-0035676");
  });

  test("two players with one number and one surname is no answer", () => {
    assert.equal(resolveGsis(maps, "DAL", "12", "S.Smith", 3), null);
  });

  test("the status after the clause is read; the play trims at 220 characters", () => {
    assert.equal(extractStatus(" during the play. His return is Questionable."), "Questionable");
    assert.equal(extractStatus(" during the play. He is OUT."), "Out");
    assert.equal(extractStatus(" during the play."), null);
  });

  test("a play yields one event per injured player, with the opponent from the game", () => {
    const header = ["game_id", "home_team", "away_team", "season_type", "week", "game_date", "qtr", "time", "desc"];
    const col = (n) => header.indexOf(n);
    const desc = "(7:52) (Shotgun) 26-S.Barkley left end to PHI 28 for -2 yards (7-Q.Walker). PHI-11-A.Brown was injured during the play. His return is Questionable. GB-7-Q.Walker was injured during the play.";
    const unmapped = [];
    const events = eventsFromPlay(["2026_01_GB_PHI", "PHI", "GB", "REG", "1", "2026-09-06", "4", "07:52", desc], col, 2026, maps, unmapped);
    assert.deepEqual(unmapped, []);
    assert.equal(events.length, 2);
    assert.equal(events[0].gsisId, "00-0035676");
    assert.deepEqual({ ...events[0].event, desc: undefined }, { season: 2026, week: 1, seasonType: "REG", gameId: "2026_01_GB_PHI", date: "2026-09-06", team: "PHI", opponent: "GB", qtr: 4, clock: "07:52", status: "Questionable", desc: undefined });
    assert.equal(events[1].gsisId, "00-0037259");
    assert.equal(events[1].event.team, "GB");
    assert.equal(events[1].event.opponent, "PHI");
    assert.equal(events[1].event.status, null);
  });

  test("the season's events are replaced whole and other seasons kept, newest first", () => {
    const s = shards();
    const byGsis = new Map([
      [
        "00-0035676",
        [
          { season: 2026, week: 2, seasonType: "REG", gameId: "2026_02_PHI_KC", date: "2026-09-14", team: "PHI", opponent: "KC", qtr: 3, clock: "01:00", status: null, desc: "x" },
          { season: 2026, week: 5, seasonType: "REG", gameId: "2026_05_PHI_NYG", date: "2026-10-05", team: "PHI", opponent: "NYG", qtr: 1, clock: "09:00", status: "Out", desc: "y" },
          { season: 2026, week: 5, seasonType: "REG", gameId: "2026_05_PHI_NYG", date: "2026-10-05", team: "PHI", opponent: "NYG", qtr: 1, clock: "09:00", status: "Out", desc: "y" },
        ],
      ],
    ]);
    const r = mergeEvents(s, 2026, byGsis);
    const g = s.get("76").players["00-0035676"].g;
    assert.deepEqual(g.map((e) => [e[0], e[1]]), [[2026, 5], [2026, 2], [2024, 1]]);
    assert.equal(r.added, 3);
    const again = mergeEvents(s, 2026, byGsis);
    assert.equal(again.dropped, 2);
    assert.equal(s.get("76").players["00-0035676"].g.length, 3);
  });
});

describe("roster", () => {
  const roster = rosterPlayers(
    rosterCsv([
      "2026,NE,WR,WR,11,ACT,A.J. Brown,Arthur,Brown,00-0035676,2019,",
      "2026,JAX,WR,WR,12,ACT,Travis Hunter,Travis,Hunter,00-0040001,12345,",
      "2026,JAX,WR,WR,12,ACT,Travis Hunter,Travis,Hunter,00-0040001,12345,",
    ]),
  );

  test("a roster player without a report gets a zero-report index row once", () => {
    const index = [["00-0035676", "A.J. Brown", "WR", "NE", 2019, 2026, 70]];
    assert.equal(addRosterToIndex(index, roster).added, 1);
    assert.deepEqual(index[1], ["00-0040001", "Travis Hunter", "WR", "JAX", null, null, 0]);
    assert.equal(addRosterToIndex(index, roster).added, 0);
  });

  test("Sleeper ids fill only the gaps", () => {
    const ids = { "00-0035676": "2019" };
    const index = [["00-0035676", "A.J. Brown", "WR", "NE", 2019, 2026, 70], ["00-0040001", "Travis Hunter", "WR", "JAX", null, null, 0]];
    assert.equal(fillSleeperIds(ids, index, roster).added, 1);
    assert.equal(ids["00-0040001"], "12345");
  });
});

describe("timeline after the audit", () => {
  const schedule = { 2026: { NE: Array.from({ length: 18 }, (_, i) => i + 1).filter((w) => w !== 11).map((w) => ({ w, o: "X", h: 1, t: "REG" })) } };
  const row = (week, status) => ({ season: 2026, week, team: "NE", reportPrimaryInjury: "Ankle", reportSecondaryInjury: null, practicePrimaryInjury: "Ankle", practiceSecondaryInjury: null, reportStatus: status, practiceStatus: null, dateModified: null });
  const impact = { season: 2026, team: "NE", injury: "Ankle", week_of_injury: 2, games_missed: 1, season_ending: false, return_week: 3 };

  test("an Out week after the audited week is a missed game with its own onset", () => {
    const [s] = player.timelineModel([row(2, "Out"), row(8, "Out")], [impact], schedule, { season: 2026, week: 6 });
    const cell = (w) => s.cells.find((c) => c.week === w);
    assert.equal(cell(2).missed, true);
    assert.equal(cell(8).missed, true);
    assert.equal(cell(8).onset, true);
    assert.match(cell(8).onsetInjury, /listed Out/);
    assert.equal(s.gamesMissed, 2);
  });

  test("without the audited week, the episodes alone decide (the pack's behavior)", () => {
    const [s] = player.timelineModel([row(2, "Out"), row(8, "Out")], [impact], schedule);
    assert.equal(s.cells.find((c) => c.week === 8).missed, false);
  });

  test("a still-out episode runs on without a second onset", () => {
    const ongoing = { ...impact, week_of_injury: 5, games_missed: 2, ongoing: true };
    const [s] = player.timelineModel([row(5, "Out"), row(6, "Out"), row(7, "Out")], [ongoing], schedule, { season: 2026, week: 6 });
    const cell = (w) => s.cells.find((c) => c.week === w);
    assert.equal(cell(7).missed, true);
    assert.equal(cell(7).onset, false);
    assert.equal(s.cells.filter((c) => c.onset).length, 1);
  });
});
