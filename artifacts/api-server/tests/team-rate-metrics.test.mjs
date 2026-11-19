/**
 * The shared team play-calling rates (scripts/team/team-rate-metrics.mjs,
 * Team Pages Phase 2B, 2026-11-19) and the cross-tab guarantee they exist
 * for: a metric the Usage file and the Coaching file both report has one
 * value, one rank and one snapshot.
 *
 * Unit part: the snap classification, the red-zone boundary, the rank rule
 * (published values, ties share the better rank, pace inverted) and the
 * completed-week cutoff. Data part: the committed usage and coaching files
 * agree club by club and carry the same snapshot.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_DIR } from "./helpers/server.mjs";

const m = await import(pathToFileURL(path.join(APP_DIR, "scripts", "team", "team-rate-metrics.mjs")).href);

const row = (o) => ({
  play_type: "pass", pass: "1", rush: "0", two_point_attempt: "0", qb_kneel: "0", qb_spike: "0",
  yardline_100: "40", pass_oe: "0", wp: "0.5", half_seconds_remaining: "900", game_seconds_remaining: "1800",
  game_id: "g1", fixed_drive: "1", ...o,
});

describe("the shared snap definition", () => {
  test("counts flagged passes and designed runs; drops kneels, spikes, two-point tries, no-plays and unflagged snaps", () => {
    const a = m.newRateAcc();
    m.addSnap(a, row({}));
    m.addSnap(a, row({ play_type: "run", pass: "0", rush: "1" }));
    m.addSnap(a, row({ play_type: "pass", pass: "1", sack: "1" })); // a sack is a dropback
    m.addSnap(a, row({ play_type: "run", pass: "1", rush: "0", qb_scramble: "1" })); // a scramble is a dropback
    m.addSnap(a, row({ play_type: "run", qb_kneel: "1", pass: "0", rush: "1" }));
    m.addSnap(a, row({ play_type: "pass", qb_spike: "1" }));
    m.addSnap(a, row({ two_point_attempt: "1" }));
    m.addSnap(a, row({ play_type: "no_play" }));
    m.addSnap(a, row({ play_type: "run", pass: "0", rush: "0" })); // illegal forward pass / aborted snap
    assert.equal(a.snaps, 4);
    assert.equal(a.pass, 3);
    assert.equal(m.publishRates(a).passRate, 75);
  });

  test("the red zone is the opponent's 20 or closer, inclusive", () => {
    const a = m.newRateAcc();
    m.addSnap(a, row({ yardline_100: "20" }));
    m.addSnap(a, row({ yardline_100: "21" }));
    m.addSnap(a, row({ yardline_100: "10", play_type: "run", pass: "0", rush: "1" }));
    assert.equal(a.rzSnaps, 2);
    assert.equal(a.in10Snaps, 1);
    assert.equal(m.publishRates(a).rzPassRate, 50);
  });

  test("ranks are taken over published values: ties share the better rank, pace counts fastest first", () => {
    assert.deepEqual(m.rankPublished([64.9, 64.9, 66.0, 50], 64.9, "rzPassRate"), { rank: 2, tied: true, of: 4 });
    assert.deepEqual(m.rankPublished([32.8, 31.0, 34.0], 32.8, "pace"), { rank: 2, tied: false, of: 3 });
    assert.equal(m.publish(64.86), 64.9);
  });

  test("a week counts only when every scheduled game is in the play-by-play", () => {
    const sched = new Map([[1, new Set(["a", "b"])], [2, new Set(["c", "d"])], [3, new Set(["e"])]]);
    assert.equal(m.completedThroughWeek(sched, new Set(["a", "b", "c"])), 1, "Week 2's Thursday game alone does not complete it");
    assert.equal(m.completedThroughWeek(sched, new Set(["a", "b", "c", "d", "e"])), 3);
    assert.equal(m.completedThroughWeek(sched, new Set()), 0);
  });
});

describe("the coordinated refresh publishes both files or neither", () => {
  test("snapshots from different games, weeks or definitions are refused", async () => {
    const { snapshotMismatch } = await import(pathToFileURL(path.join(APP_DIR, "scripts", "team", "refreshTeamMetrics.mjs")).href);
    const a = { season: 2026, throughWeek: 10, fingerprint: "18376:11093", definitions: "team-rate-metrics/1" };
    assert.equal(snapshotMismatch(a, { ...a }), null);
    assert.equal(snapshotMismatch(a, { ...a, throughWeek: 11 }), "throughWeek");
    assert.equal(snapshotMismatch(a, { ...a, fingerprint: "18400:11100" }), "fingerprint", "a Thursday game in one file only");
    assert.equal(snapshotMismatch(a, null), "missing snapshot", "a failed builder");
  });
});

describe("Usage and Coaching agree (cross-tab)", () => {
  const usageFile = path.join(APP_DIR, "data", "team", "usage_2026.json");
  const coachingFile = path.join(APP_DIR, "data", "team", "coaching_2026.json");
  const usage = JSON.parse(fs.readFileSync(usageFile, "utf8"));
  const coaching = JSON.parse(fs.readFileSync(coachingFile, "utf8"));
  const num = (x) => Number(String(x).replace(/−/g, "-").match(/-?\d+(\.\d+)?/)[0]);

  test("both files carry the same snapshot: season, completed-through week, data fingerprint, definitions", () => {
    assert.ok(usage.snapshot && coaching.snapshot, "both files carry a snapshot");
    assert.deepEqual(usage.snapshot, coaching.snapshot);
    assert.equal(usage.throughWeek, usage.snapshot.throughWeek);
  });

  test("the Stats tab's efficiency file carries the same snapshot (Team Pages Phase 3)", () => {
    const eff = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "efficiency_2026.json"), "utf8"));
    assert.deepEqual(eff.snapshot, usage.snapshot, "Stats, Usage and Coaching count the same games");
    for (const [abbr, t] of Object.entries(eff.teams)) {
      for (const unit of ["offense", "defense"]) {
        const z = t.redZone?.[unit];
        assert.ok(z && z.td <= z.trips, `${abbr} ${unit} red zone`);
        if (z.trips) assert.equal(z.rate, Math.round((z.td / z.trips) * 1000) / 10, `${abbr} ${unit} red-zone rate`);
      }
    }
  });

  test("every club's pass rate, red-zone pass rate, PROE and pace are the same number in both files", () => {
    const off = [];
    for (const [club, u] of Object.entries(usage.teams)) {
      const rows = Object.fromEntries((coaching.teams[club]?.tendencies.rows ?? []).map((r) => [r.key, r]));
      for (const key of ["passRate", "rzPassRate", "proe", "pace"]) {
        if (!rows[key]) continue;
        if (u.env[key].value !== num(rows[key].current)) off.push(`${club} ${key}: usage ${u.env[key].value} vs coaching ${rows[key].current}`);
      }
    }
    assert.deepEqual(off, []);
  });

  test("…and the same league rank, over the same 32 published values", () => {
    const off = [];
    for (const key of ["passRate", "rzPassRate", "proe", "pace"]) {
      const values = Object.values(coaching.teams).map((t) => num(t.tendencies.rows.find((r) => r.key === key).current));
      for (const [club, u] of Object.entries(usage.teams)) {
        const mine = num(coaching.teams[club].tendencies.rows.find((r) => r.key === key).current);
        const { rank } = m.rankPublished(values, mine, key);
        if (u.env[key].rank !== rank) off.push(`${club} ${key}: usage ${u.env[key].rank} vs coaching ${rank}`);
      }
    }
    assert.deepEqual(off, []);
  });
});
