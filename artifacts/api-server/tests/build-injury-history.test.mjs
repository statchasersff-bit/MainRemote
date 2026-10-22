/**
 * scripts/player/buildInjuryHistory.mjs: the rules that turn a season of
 * weekly report rows into the player pages' injury entries.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildEntries } from "../scripts/player/buildInjuryHistory.mjs";

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
    assert.match(entries[0].description, /; missed Weeks 2, 3, 4 and 5\.$/);
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
