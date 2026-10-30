/**
 * scripts/player/buildInjuryHistory.mjs: the rules that turn a season of
 * weekly report rows into the player pages' injury entries.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildEntries, gridSeason, splitSide } from "../scripts/player/buildInjuryHistory.mjs";

const row = (week, term, status = null, primary = true, team = "BAL") => ({ week, team, term, status, primary });

/** A team that plays every week but Week 7 (its bye), six weeks complete. */
function ctx(played, extra = {}) {
  return {
    played: new Set(played),
    playing: (week, team) => team === "BAL" && week !== 7,
    completedWeek: 6,
    team: "BAL",
    onReserve: false,
    ...extra,
  };
}

describe("buildEntries", () => {
  test("consecutive weeks with one body part are one injury, dated to the game he was hurt in", () => {
    const rows = [row(4, "Back", null), row(5, "Ankle", "Out"), row(6, "Ankle", "Out")];
    const entries = buildEntries(2026, rows, [{ week: 4, opponent: "TEN" }], ctx([1, 2, 3, 4]));
    assert.equal(entries.length, 2);
    const ankle = entries.find((e) => e.type === "Ankle");
    assert.equal(ankle.week, 4, "starts at the game he was hurt in");
    assert.equal(ankle.gamesMissed, 2);
    assert.equal(ankle.severity, "moderate");
    assert.match(ankle.description, /^Hurt during the Week 4 game against the Titans and listed with an ankle injury from Week 5; out since Week 5 \(2 games missed so far\)\.$/);
    // The back listing he played through takes none of the ankle's games.
    const back = entries.find((e) => e.type === "Back");
    assert.equal(back.gamesMissed, 0);
    assert.equal(back.severity, "minor");
    assert.match(back.description, /played through it without missing time\.$/);
    assert.ok(entries.every((e) => e.report === true && e.side === "unknown" && e.season === 2026));
  });

  test("a listing he played through counts nothing, even past the last completed week", () => {
    const rows = [row(4, "Shoulder"), row(5, "Shoulder"), row(6, "Shoulder"), row(7, "Shoulder")];
    const [e] = buildEntries(2026, rows, [], ctx([1, 2, 3, 4, 5, 6]));
    assert.equal(e.gamesMissed, 0);
    assert.equal(e.week, 4);
  });

  test("out, then back: the games between are the injury's, and the run closes when he plays", () => {
    const rows = [row(1, "Ankle", "Out"), row(2, "Ankle", null)];
    const [e] = buildEntries(2026, rows, [], ctx([2, 3, 4, 5, 6]));
    assert.equal(e.gamesMissed, 1);
    assert.match(e.description, /; missed Week 1\.$/);
    assert.equal(e.severity, "moderate");
  });

  test("a gap of more than a week is a new injury; a bye week is not", () => {
    const rows = [row(1, "Hamstring", "Questionable"), row(5, "Hamstring", "Questionable")];
    assert.equal(buildEntries(2026, rows, [], ctx([1, 2, 3, 4, 5, 6])).length, 2);
    const bye = [row(6, "Hamstring", "Out"), row(8, "Hamstring", "Out")];
    assert.equal(buildEntries(2026, bye, [], ctx([1, 2, 3, 4, 5], { completedWeek: 8 })).length, 1);
  });

  test("two listings in the same missed week: the primary one ruled out takes the game", () => {
    const rows = [row(5, "Thumb", "Out", true), row(5, "Toe", null, false), row(6, "Thumb", "Out", true)];
    const entries = buildEntries(2026, rows, [], ctx([1, 2, 3, 4]));
    const thumb = entries.find((e) => e.type === "Thumb");
    const toe = entries.find((e) => e.type === "Toe");
    assert.equal(thumb.gamesMissed, 2);
    assert.equal(thumb.bodyPart, "hand");
    assert.equal(toe.gamesMissed, 0);
  });

  test("rest days and illness are not injuries; four or more games missed is major", () => {
    const rows = [
      row(1, "Not injury related - resting player"),
      row(2, "Illness", "Questionable"),
      row(2, "Knee", "Out"),
      row(3, "Knee", "Out"),
      row(4, "Knee", "Out"),
      row(5, "Knee", "Out"),
    ];
    const entries = buildEntries(2026, rows, [], ctx([1, 6]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].gamesMissed, 4);
    assert.equal(entries[0].severity, "major");
    assert.match(entries[0].description, /; missed Weeks 2 through 5 \(4 games\)\.$/);
  });

  test("three missed weeks are listed; four with a game played between them are listed too", () => {
    const three = [row(2, "Knee", "Out"), row(3, "Knee", "Out"), row(4, "Knee", "Out")];
    assert.match(buildEntries(2026, three, [], ctx([1, 5, 6]))[0].description, /; missed Weeks 2, 3 and 4\.$/);
  });

  test("a past season: a run left open is closed at the season's end with no 'so far'", () => {
    const rows = [row(4, "Thumb", "Questionable"), row(5, "Thumb", "Out")];
    const [e] = buildEntries(2016, rows, [], ctx([2, 3, 4], { completedWeek: 17, current: false }));
    assert.equal(e.gamesMissed, 12, "Weeks 5-17 less the bye");
    assert.match(e.description, /with a hand injury from Week 4; missed Weeks 5 through 17 \(12 games\)\.$/);
    assert.doesNotMatch(e.description, /so far|out since/);
  });

  test("a past season with the durability grid: only the grid's weeks count as missed", () => {
    const rows = [row(4, "right Thumb", "Questionable"), row(5, "right Thumb", "Out")].map((r) => ({ ...r, ...splitSide(r.term) }));
    const grid = new Set([5, 6, 8, 9, 10, 11, 12, 13, 14, 15]);
    const [e] = buildEntries(2016, rows, [], ctx([2, 3, 4], { completedWeek: 17, current: false, injuredWeeks: grid }));
    assert.equal(e.type, "Thumb");
    assert.equal(e.side, "right");
    assert.equal(e.bodyPart, "hand");
    assert.equal(e.gamesMissed, 10, "Weeks 16 and 17 he was activated and healthy");
    assert.equal(e.severity, "major");
    assert.match(e.description, /; missed Weeks 5 through 15 \(10 games\)\.$/);
  });

  test("a grid stint no report explains is an entry of its own; one a report covers is not", () => {
    // Week 7 is the bye, so the two-game stint is Weeks 6 and 8.
    const stint = { first: 6, last: 8, weeks: [6, 8], part: "Ankle" };
    const alone = buildEntries(2019, [], [{ week: 5, opponent: "JAX" }], ctx([1, 2, 3, 4, 5, 9], { completedWeek: 17, current: false, injuredWeeks: new Set([6, 8]), stints: [stint] }));
    assert.equal(alone.length, 1);
    assert.equal(alone[0].type, "Ankle");
    assert.equal(alone[0].week, 5);
    assert.equal(alone[0].gamesMissed, 2);
    assert.equal(alone[0].description, "Hurt during the Week 5 game against the Jaguars and out of the lineup with an ankle injury from Week 6; missed Weeks 6 and 8. No weekly injury report listed it.");
    const covered = buildEntries(2019, [row(6, "Ankle", "Out")], [], ctx([1, 2, 3, 4, 5, 9], { completedWeek: 17, current: false, injuredWeeks: new Set([6, 8]), stints: [stint] }));
    assert.equal(covered.length, 1);
    assert.equal(covered[0].reports.length, 1, "the report's entry, not the grid's");
    assert.equal(covered[0].gamesMissed, 2, "the stint extends the run past its last report week");
    assert.match(covered[0].description, /; missed Weeks 6 and 8\.$/);
    const undisclosed = buildEntries(2019, [], [], ctx([1, 2, 3], { completedWeek: 17, current: false, injuredWeeks: new Set([4]), stints: [{ first: 4, last: 4, weeks: [4], part: "Undisclosed" }] }));
    assert.equal(undisclosed[0].type, "Undisclosed");
    assert.equal(undisclosed[0].bodyPart, "unknown");
    assert.match(undisclosed[0].description, /^Out of the lineup with an undisclosed injury from Week 4; missed Week 4\./);
  });

  test("a same-part grid stint before the run: hurt, straight to reserve, listed again on his return", () => {
    // Burrow 2025: toe, out Weeks 3-12 (bye 10), on the report only in Weeks 11 and 12.
    const rows = [row(11, "Toe", "Out"), row(12, "Toe", "Out")];
    const toe = { first: 3, last: 12, weeks: [3, 4, 5, 6, 7, 8, 9, 11, 12], part: "Toe" };
    const c = ctx([1, 2, 13, 14, 15, 16, 17, 18], { completedWeek: 18, current: false, playing: (w, t) => t === "BAL" && w !== 10, injuredWeeks: new Set(toe.weeks), stints: [toe] });
    const entries = buildEntries(2025, rows, [{ week: 2, opponent: "JAX" }], c);
    assert.equal(entries.length, 1);
    const [e] = entries;
    assert.equal(e.week, 2);
    assert.equal(e.gamesMissed, 9);
    assert.equal(e.severity, "major");
    assert.equal(e.description, "Hurt during the Week 2 game against the Jaguars and out of the lineup with a toe injury from Week 3, on the injury report from Week 11; missed Weeks 3 through 12 (9 games).");
    assert.deepEqual(e.reports.map((r) => r.week), [11, 12]);
  });

  test("an adjacent grid stint of another body part stays its own entry", () => {
    const rows = [row(4, "Hamstring", "Questionable"), row(5, "Hamstring", null)];
    const knee = { first: 6, last: 9, weeks: [6, 8, 9], part: "Knee" };
    const c = ctx([1, 2, 3, 4, 5, 10], { completedWeek: 17, current: false, injuredWeeks: new Set(knee.weeks), stints: [knee] });
    const entries = buildEntries(2022, rows, [], c);
    assert.equal(entries.length, 2);
    const ham = entries.find((e) => e.type === "Hamstring");
    const kn = entries.find((e) => e.type === "Knee");
    assert.equal(ham.gamesMissed, 0);
    assert.equal(kn.gamesMissed, 3);
    assert.equal(kn.week, 6);
    assert.match(kn.description, /^Out of the lineup with a knee injury from Week 6; missed Weeks 6, 8 and 9\. No weekly injury report listed it\.$/);
  });

  test("no game line all season, but a grid: the grid's weeks are missed games", () => {
    // Watson 2025: on reserve all year, on the report only in a late practice window.
    const rows = [row(14, "Achilles", "Out"), row(15, "Achilles", "Out"), row(16, "Achilles", "Out")];
    const weeks = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const c = ctx([], { completedWeek: 18, current: false, injuredWeeks: new Set(weeks), stints: [{ first: 1, last: 18, weeks, part: "Achilles" }] });
    const [e] = buildEntries(2025, rows, [], c);
    assert.equal(e.gamesMissed, 17);
    assert.match(e.description, /^Out of the lineup with an achilles injury from Week 1, on the injury report from Week 14; missed Weeks 1 through 18 \(17 games\)\.$/);
  });

  test("gridSeason reads a player's stints into weeks around his team's bye", () => {
    const gp = { w: { 2019: "PPPPPPPPPPPPPPPPP" }, t: { 2019: "IND" }, inj: [[2019, "Knee — out week 10", "Knee", 1, 1, "structural", 0]], x: { w: { 2016: "-PPPXXXXBXXXXXX--" }, t: { 2016: "NE" }, inj: [[2016, "Thumb — out 10 games from week 5", "Thumb", 3, 10, "structural", 0]] } };
    const playing = (week, team) => !(team === "NE" && week === 9);
    const g16 = gridSeason(gp, 2016, playing, null);
    assert.equal(g16.team, "NE");
    assert.deepEqual([...g16.injuredWeeks], [5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    assert.equal(g16.stints[0].part, "Thumb");
    assert.deepEqual([...gridSeason(gp, 2019, playing, null).injuredWeeks], [10]);
    assert.equal(gridSeason(gp, 2018, playing, null), null, "no grid for a season he was not on a roster");
  });

  test("on reserve with the run open: major, and the bye is not a game missed", () => {
    const rows = [row(5, "Quadricep", "Out"), row(6, "Quadricep", "Out")];
    const [e] = buildEntries(2026, rows, [], ctx([1, 2, 3, 4], { onReserve: true, completedWeek: 7 }));
    assert.equal(e.type, "Quad");
    assert.equal(e.bodyPart, "quad");
    assert.equal(e.gamesMissed, 2, "Week 7 is the bye");
    assert.equal(e.severity, "major");
  });

  test("reserve weeks after a listing extend that injury and make it major", () => {
    const rows = [row(5, "Knee", "Out")];
    const [e] = buildEntries(2026, rows, [], ctx([1, 2, 3, 4], { reserve: { 6: "R01" }, completedWeek: 6 }));
    assert.equal(e.type, "Knee");
    assert.equal(e.gamesMissed, 2);
    assert.equal(e.severity, "major");
    assert.match(e.description, /from Week 5, then placed on injured reserve; out since Week 5 \(2 games missed so far\)\.$/);
  });

  test("reserve weeks with no listing first are an entry of their own, dated to the game he was hurt in", () => {
    const entries = buildEntries(2026, [], [{ week: 5, opponent: "JAX" }], ctx([1, 2, 3, 4, 5], { reserve: { 6: "R01" }, completedWeek: 6 }));
    assert.equal(entries.length, 1);
    const [e] = entries;
    assert.equal(e.type, "Injured reserve");
    assert.equal(e.bodyPart, "unknown");
    assert.equal(e.week, 5);
    assert.equal(e.gamesMissed, 1);
    assert.equal(e.severity, "major");
    assert.equal(e.description, "Hurt during the Week 5 game against the Jaguars and placed on injured reserve in Week 6; out since Week 6.");
  });

  test("a closed reserve stint: moderate, with the weeks it cost; the PUP list is named", () => {
    const [e] = buildEntries(2026, [], [], ctx([3, 4, 5, 6], { reserve: { 1: "R04", 2: "R04" } }));
    assert.equal(e.type, "Reserve list");
    assert.equal(e.gamesMissed, 2);
    assert.equal(e.severity, "moderate");
    assert.equal(e.description, "Placed on the physically unable to perform list in Week 1; missed Weeks 1 and 2.");
  });

  test("the play he was hurt on and the weekly report rows ride on the entry", () => {
    const rows = [
      { week: 5, team: "BAL", term: "Ankle", status: "Out", practice: "Did Not Participate In Practice", primary: true },
      { week: 4, team: "BAL", term: "Back", status: null, practice: "Full Participation in Practice", primary: true },
    ];
    const events = [{ week: 4, opponent: "TEN", qtr: 2, clock: "00:12", desc: "(:12) (Shotgun) 8-L.Jackson sacked at TEN 46 for -5 yards (11-J.Johnson). BAL-8-L.Jackson was injured during the play." }];
    const entries = buildEntries(2026, rows, events, ctx([1, 2, 3, 4], { reserve: { 6: "R01" }, completedWeek: 6 }));
    const ankle = entries.find((e) => e.type === "Ankle");
    assert.deepEqual(ankle.play, { week: 4, opponent: "TEN", qtr: 2, clock: "00:12", desc: "(Shotgun) 8-L.Jackson sacked at TEN 46 for -5 yards (11-J.Johnson)." });
    assert.deepEqual(ankle.reports, [
      { week: 5, practice: "DNP", status: "Out" },
      { week: 6, reserve: "injured reserve" },
    ]);
    // The back listing the same week as the play does not borrow it.
    const back = entries.find((e) => e.type === "Back");
    assert.equal(back.play, undefined);
    assert.deepEqual(back.reports, [{ week: 4, practice: "Full", status: null }]);
  });
});
