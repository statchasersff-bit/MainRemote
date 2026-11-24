/**
 * The rest-of-season board check (scripts/rankings/check-ros.mjs, 2026-11-20):
 * one date sets both meta fields, and a bad file is refused before it can
 * replace the board.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { metaFor, easternOffset } from "../scripts/rankings/ros-meta.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = path.join(APP, "data", "rankings", "ros-2026.csv");

describe("one date, both meta fields", () => {
  test("the live board's meta is exactly what --date 2026-10-22 writes", () => {
    const live = JSON.parse(fs.readFileSync(path.join(APP, "data", "rankings", "ros-2026.meta.json"), "utf8"));
    const m = metaFor("2026-10-22", 2026);
    assert.equal(m.updatedAt, live.updatedAt);
    assert.equal(m.updatedAtIso, live.updatedAtIso);
  });

  test("Eastern midnight with the right offset, clock-change days included", () => {
    assert.equal(metaFor("2026-11-24", 2026).updatedAtIso, "2026-11-24T00:00:00-05:00");
    assert.equal(easternOffset("2026-11-01"), "-04:00", "midnight before the 2 a.m. fall-back is still EDT");
    assert.equal(easternOffset("2026-11-02"), "-05:00");
    assert.equal(easternOffset("2026-03-08"), "-05:00", "midnight before the 2 a.m. spring-forward is still EST");
    assert.equal(easternOffset("2026-03-09"), "-04:00");
    assert.equal(metaFor("2026-11-24", 2026).updatedAt, "November 24, 2026");
  });
});

describe("the check refuses a file the page would print wrongly", () => {
  const run = (file, ...extra) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["scripts/rankings/check-ros.mjs", file, ...extra], { cwd: APP, encoding: "utf8" }) };
    } catch (err) {
      return { code: err.status, out: `${err.stdout}` };
    }
  };
  const tmp = (body) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ros-check-")), "ros.csv");
    fs.writeFileSync(f, body);
    return f;
  };

  test("the live board passes, and nothing is written without --install", () => {
    const before = fs.statSync(LIVE).mtimeMs;
    const r = run(LIVE, "--date", "2026-10-22");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 errors/);
    assert.equal(fs.statSync(LIVE).mtimeMs, before);
  });

  test("a repeated rank, a gap, a duplicate player and an unreadable line each fail it", () => {
    const lines = fs.readFileSync(LIVE, "utf8").split("\n")
      .map((l) => (l === "RB,2,Bijan Robinson" ? "RB,1,Bijan Robinson" : l === "TE,2,Trey McBride" ? "TE,two,Trey McBride" : l))
      .filter((l) => !l.startsWith("WR,7,"));
    lines.push("QB,50,Josh Allen");
    const r = run(tmp(lines.join("\n")), "--date", "2026-11-20");
    assert.equal(r.code, 1);
    assert.match(r.out, /ERROR RB: expected rank 2, found 1 \(Bijan Robinson\)/);
    assert.match(r.out, /ERROR WR: expected rank 7, found 8/);
    assert.match(r.out, /ERROR QB: Josh Allen listed twice/);
    assert.match(r.out, /ERROR line \d+ would be dropped: "TE,two,Trey McBride"/);
  });

  test("a wrong header, a short position and a missing date fail it", () => {
    const body = fs.readFileSync(LIVE, "utf8").replace("Position,Final Rank,Player", "Pos,Rank,Name").split("\n").filter((l) => !/^TE,(3[0-9]|[4-9]\d),/.test(l)).join("\n");
    const r = run(tmp(body));
    assert.equal(r.code, 1);
    assert.match(r.out, /ERROR header is "Pos,Rank,Name"/);
    assert.match(r.out, /ERROR TE: 29 rows, the page shows 40/);
    assert.match(r.out, /ERROR --date YYYY-MM-DD is required/);
  });

  test("a misspelled name is a warning: it renders with no team and no link", () => {
    const r = run(tmp(fs.readFileSync(LIVE, "utf8").replace("QB,3,Drake Maye", "QB,3,Drake Mayee")), "--date", "2026-11-20");
    assert.equal(r.code, 0);
    assert.match(r.out, /WARN {2}QB3 Drake Mayee: no player page matches/);
  });
});
