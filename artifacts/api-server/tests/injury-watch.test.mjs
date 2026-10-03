/**
 * Which injury designations reach Injury Watch.
 *
 * The bug this pins down: Sleeper demotes an injured player on the depth chart,
 * so a genuine WR1 who lands on IR is listed sixth at his position - and a
 * panel gated on depth alone then hides the one injury a fantasy manager came
 * to the page for, while still printing the WR4 who is questionable. The gate
 * has to use a relevance signal the injury does not move.
 *
 * Pure index-and-assert, no server: injuryWatch() is a filter over a sorted
 * list, and reaching it through HTTP would put a database and 32 outbound
 * requests between the assertion and the ten lines under test.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { indexRoster, restoreRosterIndex, getTeamRoster, injuryWatch } =
  await importModule("lib/team/roster");

after(cleanupBundles);

/** Sleeper's shape, with only the fields this module reads. */
function player(overrides) {
  return {
    player_id: overrides.player_id,
    full_name: overrides.full_name,
    search_full_name: overrides.full_name.toLowerCase().replace(/[^a-z]/g, ""),
    position: overrides.position,
    team: overrides.team,
    ...overrides,
  };
}

const NE = [
  // The case from the field: a top-20 receiver, on IR with an ankle, and
  // therefore listed SIXTH among his team's WRs. Sleeper's own snapshot.
  player({
    player_id: "5859",
    full_name: "A.J. Brown",
    position: "WR",
    team: "NE",
    depth_chart_order: 6,
    search_rank: 17,
    status: "Inactive",
    injury_status: "IR",
    injury_body_part: "Ankle",
  }),
  // Healthy, and now the WR1 because of the line above.
  player({
    player_id: "100",
    full_name: "Healthy Starter",
    position: "WR",
    team: "NE",
    depth_chart_order: 1,
    search_rank: 40,
  }),
  // A designation that the old depth gate did let through. It still belongs on
  // the page - just not above the IR.
  player({
    player_id: "101",
    full_name: "Fourth Receiver",
    position: "WR",
    team: "NE",
    depth_chart_order: 4,
    search_rank: 480,
    injury_status: "Questionable",
    injury_body_part: "Hamstring",
  }),
  // A camp body: on IR, deep, and unranked by Sleeper. Listing him is what
  // turns the panel into a transactions log.
  player({
    player_id: "102",
    full_name: "Camp Body",
    position: "WR",
    team: "NE",
    depth_chart_order: 9,
    search_rank: null,
    injury_status: "IR",
  }),
  // Off the depth chart entirely AND unranked - the same verdict, by the other
  // half of the gate.
  player({
    player_id: "103",
    full_name: "Practice Squad",
    position: "TE",
    team: "NE",
    depth_chart_order: null,
    search_rank: null,
    injury_status: "IR",
  }),
];

describe("injuryWatch", () => {
  indexRoster(Object.fromEntries(NE.map((p) => [p.player_id, p])), 1_700_000_000_000);
  const rows = injuryWatch(getTeamRoster("ne"));
  const names = rows.map((row) => row.name);

  test("reports a fantasy-relevant player whose injury demoted him", () => {
    assert.ok(
      names.includes("A.J. Brown"),
      `an IR'd WR1 at depth 6 must be reported, got ${JSON.stringify(names)}`,
    );
    const brown = rows.find((row) => row.name === "A.J. Brown");
    assert.equal(brown.injuryStatus, "IR");
    assert.equal(brown.injuryBodyPart, "Ankle");
    // The slot still states Sleeper's order rather than a rank of our own.
    assert.equal(brown.slot, "WR6");
  });

  test("leads with the biggest name, not the highest depth slot", () => {
    assert.equal(names[0], "A.J. Brown");
  });

  test("still reports a designation near the top of the depth chart", () => {
    assert.ok(names.includes("Fourth Receiver"));
  });

  test("leaves out unranked players buried on or off the depth chart", () => {
    assert.ok(!names.includes("Camp Body"));
    assert.ok(!names.includes("Practice Squad"));
  });

  test("says nothing about players carrying no designation", () => {
    assert.ok(!names.includes("Healthy Starter"));
  });
});

describe("injuryWatch with a pre-searchRank roster cache", () => {
  // A cache file written before searchRank existed restores players without the
  // field. Sorting must not divide by NaN and drop the list into input order.
  test("falls back to the depth gate rather than breaking", () => {
    const legacy = {
      team: "buf",
      depthChart: { QB: [], RB: [], WR: [], TE: [] },
      players: [],
      injuries: [
        {
          id: "1",
          name: "Deep IR",
          position: "WR",
          team: "buf",
          depthOrder: 7,
          injuryStatus: "IR",
        },
        {
          id: "2",
          name: "Starter Questionable",
          position: "WR",
          team: "buf",
          depthOrder: 2,
          injuryStatus: "Questionable",
        },
      ],
      fetchedAt: 1,
    };
    restoreRosterIndex({ buf: legacy }, {}, 1);
    const names = injuryWatch(getTeamRoster("buf")).map((row) => row.name);
    assert.deepEqual(names, ["Starter Questionable"]);
  });
});
