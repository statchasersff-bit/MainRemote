/**
 * The recap facts packet's scoring list used to carry only touchdowns and made
 * field goals, so a safety's two points went unexplained and a kick return
 * touchdown read just "touchdown" (2026-11-23: BAL @ CAR, IND @ HOU and
 * NO @ CHI in week 11). The story store now marks safeties and keeps each
 * kick or punt return touchdown's returner; these checks hold it to the
 * stored ESPN box scores.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "data", "matchup");
const SEASON = 2026;
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const story = read(`game_story_${SEASON}.json`).games;
const box = read(`boxscores/${SEASON}.json`).games;
// ESPN spellings that differ from nflverse's.
const NFLVERSE = { WSH: "WAS", LAR: "LA" };
const club = (a) => NFLVERSE[a] ?? a;

test("every ESPN safety is a stored safety for the same club and quarter", () => {
  let seen = 0;
  for (const g of Object.values(box)) {
    if (g.seasonType !== 2 && g.seasonType !== "regular") continue;
    const m = /^([A-Z]+) @ ([A-Z]+)$/.exec(g.name ?? "");
    if (!m) continue;
    const id = `${SEASON}_${String(g.week).padStart(2, "0")}_${club(m[1])}_${club(m[2])}`;
    for (const sp of g.summary?.scoringPlays ?? []) {
      if (sp.type?.abbreviation !== "SF") continue;
      seen += 1;
      const s = story[id];
      assert.ok(s, `${id}: no story`);
      const hit = s.plays.find((p) => p.safety && p.qtr === sp.period.number && p.def === club(sp.team.abbreviation));
      assert.ok(hit, `${id}: ESPN safety Q${sp.period.number} ${sp.clock.displayValue} by ${sp.team.abbreviation} is not in the story store`);
    }
  }
  assert.ok(seen >= 3, `expected the week-11 safeties at least, saw ${seen}`);
});

test("kick and punt return touchdowns keep a returner unless the kick was muffed or blocked", () => {
  for (const [id, s] of Object.entries(story)) {
    for (const p of s.plays) {
      if (!p.td || (p.type !== "kickoff" && p.type !== "punt")) continue;
      assert.ok("returner" in p, `${id} Q${p.qtr} ${p.clock}: return touchdown stored without a returner field`);
    }
  }
  const walker = story[`${SEASON}_11_BAL_CAR`].plays.find((p) => p.td && p.type === "kickoff");
  assert.equal(walker?.returner, "D.Walker");
  assert.equal(walker?.returnYds, 86);
});

// A touchdown's try, when it was not a made extra point, as ESPN's scoring
// play prints it: "Javonte Williams 1 Yd Rush (Two-Point Pass Conversion
// Failed)". The story store hangs nflverse's result on the touchdown.
const espnTry = (text) => {
  const x = /\(([^)]*)\)\s*\.?\s*$/.exec(text ?? "")?.[1] ?? "";
  if (/Two-Point/i.test(x)) return /Failed/i.test(x) ? "2pt_failure" : "2pt_success";
  if (/block/i.test(x)) return "xp_blocked";
  if (/fail|miss|no good/i.test(x)) return "xp_failed";
  return null;
};

test("every stored try matches ESPN's scoring plays, game by game", () => {
  let tries = 0;
  for (const g of Object.values(box)) {
    const m = /^([A-Z]+) @ ([A-Z]+)$/.exec(g.name ?? "");
    if (!m) continue;
    const id = `${SEASON}_${String(g.week).padStart(2, "0")}_${club(m[1])}_${club(m[2])}`;
    const s = story[id];
    if (!s) continue;
    const espn = (g.summary?.scoringPlays ?? [])
      .filter((sp) => sp.type?.abbreviation === "TD")
      .map((sp) => espnTry(sp.text))
      .filter(Boolean)
      .sort();
    const ours = s.plays.filter((p) => p.td && p.tryResult).map((p) => p.tryResult).sort();
    tries += ours.length;
    assert.deepEqual(ours, espn, `${id}: stored tries differ from ESPN's`);
  }
  assert.ok(tries > 50, `expected the season's missed and two-point tries, saw ${tries}`);
  const opener = story[`${SEASON}_11_TEN_DAL`].plays.find((p) => p.td);
  assert.equal(opener?.tryResult, "2pt_failure");
});
