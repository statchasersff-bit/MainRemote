/**
 * College stats: matching CollegeFootballData.com rows to our players, and
 * ranking the final season. Pure functions over recorded-shape rows, so it runs
 * without a key or the network. Also checks the hand-edited stats_copy.json.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collapseRows,
  matchPlayer,
  nameKey,
  qualifiedPool,
  rankFinal,
  schoolKey,
} from "../scripts/player/collegeMatch.mjs";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "player");

/** CFBD `/stats/player/season` rows for one player-season. */
function rows(season, playerId, player, position, team, stats) {
  return Object.entries(stats).flatMap(([category, types]) =>
    Object.entries(types).map(([statType, stat]) => ({
      season, playerId, player, position, team, conference: "X", category, statType, stat: String(stat),
    })),
  );
}

const qbLine = (att, yds, td) => ({ passing: { COMPLETIONS: Math.round(att * 0.65), ATT: att, YDS: yds, TD: td, INT: 5 } });

describe("college matching", () => {
  test("names and schools compare the way CFBD spells them", () => {
    assert.equal(nameKey("Ja'Marr Chase Jr."), "jamarr chase");
    assert.equal(nameKey("José Núñez III"), "jose nunez");
    assert.equal(schoolKey("North Carolina State"), schoolKey("NC State"));
    assert.equal(schoolKey("Mississippi"), schoolKey("Ole Miss"));
    assert.equal(schoolKey("San Jose State"), schoolKey("San José State"));
  });

  test("a final season at his school, and a transfer year only when the name is unique", () => {
    const all = collapseRows([
      ...rows(2025, "1", "Sam Passer", "QB", "NC State", qbLine(400, 3500, 30)),
      ...rows(2024, "1", "Sam Passer", "QB", "Tulane", qbLine(300, 2500, 20)),
      ...rows(2023, "1", "Sam Passer", "QB", "Tulane", qbLine(100, 800, 5)),
      // Another QB with his name in 2023 makes that year ambiguous; it is left out.
      ...rows(2023, "9", "Sam Passer", "QB", "Rice", qbLine(50, 300, 1)),
      // A receiver with his name never matches a QB.
      ...rows(2025, "7", "Sam Passer", "WR", "NC State", { receiving: { REC: 10, YDS: 100, TD: 1 } }),
    ]);
    const seasons = matchPlayer({ name: "Sam Passer", position: "QB", school: "North Carolina State", finalSeason: 2025 }, all);
    assert.deepEqual(seasons.map((s) => [s.season, s.school]), [[2024, "Tulane"], [2025, "NC State"]]);
    assert.equal(seasons[1].pass.yds, 3500);
  });

  test("no final season at his school: no match, rather than a guess", () => {
    const all = collapseRows(rows(2025, "1", "Sam Passer", "QB", "Rice", qbLine(400, 3500, 30)));
    assert.equal(matchPlayer({ name: "Sam Passer", position: "QB", school: "NC State", finalSeason: 2025 }, all), null);
  });

  test("final-season ranks among qualified players; interceptions rank lower-is-better", () => {
    const all = collapseRows([
      ...rows(2025, "1", "A", "QB", "X", { passing: { COMPLETIONS: 260, ATT: 400, YDS: 3600, TD: 30, INT: 4 } }),
      ...rows(2025, "2", "B", "QB", "Y", { passing: { COMPLETIONS: 200, ATT: 350, YDS: 2600, TD: 18, INT: 12 } }),
      ...rows(2025, "3", "C", "QB", "Z", { passing: { COMPLETIONS: 20, ATT: 40, YDS: 300, TD: 2, INT: 0 } }),
    ]);
    const pool = qualifiedPool(all, 2025, "QB");
    assert.equal(pool.length, 2, "40 attempts does not qualify");
    const a = rankFinal(all[0], pool, "QB");
    assert.deepEqual([a.ptd.rank, a.ptd.of, a.int.rank], [1, 2, 1]);
    assert.equal(a.ptd.pct, 100, "top of the pool is the 100th percentile, not measured against himself");
    const alone = rankFinal(all[0], [all[0]], "QB");
    assert.deepEqual([alone.ptd.rank, alone.ptd.of, alone.ptd.pct], [1, 1, 100]);
    const c = rankFinal(all[2], pool, "QB");
    assert.equal(c.ptd.rank, undefined, "an unqualified player carries values, no ranks");
    assert.equal(c.ptd.value, 2);
  });
});

describe("hand-edited data files", () => {
  test("stats_copy.json is valid, keyed by real slugs, with known string fields", () => {
    const copy = JSON.parse(fs.readFileSync(path.join(DATA, "stats_copy.json"), "utf8"));
    const dictionary = JSON.parse(fs.readFileSync(path.join(DATA, "players.json"), "utf8"));
    const slugs = new Set((Array.isArray(dictionary) ? dictionary : Object.values(dictionary)).map((p) => p.slug));
    const fields = new Set(["prod_lede", "adv_lede", "adv_fantasy_note", "career_paragraphs", "updated_date", "author"]);
    for (const [slug, entry] of Object.entries(copy)) {
      assert.ok(slugs.has(slug), `${slug} is not a player slug`);
      for (const [key, value] of Object.entries(entry)) {
        assert.ok(fields.has(key), `${slug}: unknown field ${key}`);
        if (key === "career_paragraphs") {
          assert.ok(Array.isArray(value) && value.length <= 3 && value.every((p) => typeof p === "string"), `${slug}: career_paragraphs`);
        } else {
          assert.equal(typeof value, "string", `${slug}: ${key}`);
        }
        if (key === "updated_date") assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${slug}: updated_date`);
      }
    }
  });

  test("college_stats.json parses and has a players map", () => {
    const college = JSON.parse(fs.readFileSync(path.join(DATA, "college_stats.json"), "utf8"));
    assert.equal(typeof college.players, "object");
  });
});
