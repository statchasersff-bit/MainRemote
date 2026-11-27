/**
 * WEB-034 re-check (2026-11-27): a newer rest-of-season board reaches the
 * player page through the normal loader and caches, with its own date.
 *
 * Drives the real loader (getRankings, keyed on file mtimes) and the real
 * player lookup (outlook-context rosRank) against data/rankings/ros-2026.*,
 * rewritten in place and restored byte for byte, mtimes included, in
 * `finally`. The rendered stale -> fresh -> missing -> stale -> fresh run on
 * a local server is in docs/INJURY-ROS-PLAYER-2026-11-27.md.
 */

import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(APP, "data", "rankings", "ros-2026.csv");
const META = path.join(APP, "data", "rankings", "ros-2026.meta.json");

const rd = await importModule("lib/rankings/rankings-data");
const oc = await importModule("lib/player/outlook-context");
after(cleanupBundles);

const LAMAR = { slug: "lamar-jackson", name: "Lamar Jackson", position: "QB" };
const NOW = Date.parse("2026-11-27T12:00:00Z");

function withBoard(fn) {
  const saved = [CSV, META].map((f) => ({ f, body: fs.readFileSync(f), st: fs.statSync(f) }));
  let tick = 0;
  // A distinct mtime per write, as a real install has.
  const write = (f, body) => {
    fs.writeFileSync(f, body);
    const t = new Date(Date.now() + 60_000 * ++tick);
    fs.utimesSync(f, t, t);
  };
  try {
    fn({ write, csv: saved[0].body.toString("utf8"), meta: JSON.parse(saved[1].body.toString("utf8")) });
  } finally {
    for (const s of saved) {
      fs.writeFileSync(s.f, s.body);
      fs.utimesSync(s.f, s.st.atime, s.st.mtime);
    }
  }
}

const metaFor = (meta, ymd, extra = {}) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return JSON.stringify({ ...meta, updatedAt: `${months[m - 1]} ${d}, ${y}`, updatedAtIso: `${ymd}T00:00:00-05:00`, ...extra }, null, 2);
};

describe("rest-of-season board: fresh, stale, missing, other season (WEB-034, 2026-11-27)", () => {
  test("stale -> fresh -> date-only correction -> missing -> other season -> stale -> fresh, through the real loader", () => {
    withBoard(({ write, csv, meta }) => {
      const rank = () => oc.rosRank(LAMAR, 2026, { now: NOW, inSeason: true });
      const lamarAt = (n) => csv.replace(/^QB,(\d+),Lamar Jackson$/m, `QB,${n},Lamar Jackson`);

      // Stale: the board as stored, dated October 22.
      write(META, metaFor(meta, "2026-10-22"));
      write(CSV, lamarAt(4));
      let r = rank();
      assert.equal(r.stale, true);
      assert.equal(r.updatedAt, "October 22, 2026");

      // A newer board installed: value and date move, no restart.
      write(CSV, lamarAt(9));
      write(META, metaFor(meta, "2026-11-26"));
      r = rank();
      assert.deepEqual([r.rank, r.updatedAt, r.stale], [9, "November 26, 2026", false]);

      // The meta alone corrected: the date moves (the cache key was the CSV's mtime only).
      write(META, metaFor(meta, "2026-11-25"));
      assert.equal(rank().updatedAt, "November 25, 2026");

      // Missing: no rank at all.
      const body = fs.readFileSync(CSV);
      fs.rmSync(CSV);
      assert.equal(rank(), null);
      write(CSV, body);

      // A board for another season in this season's file: no rank, not a stale one.
      write(META, metaFor(meta, "2026-11-25", { season: 2025 }));
      assert.equal(rank(), null);

      // Back to stale, then fresh again: current advice resumes with the new rank and date.
      write(META, metaFor(meta, "2026-10-22"));
      write(CSV, lamarAt(4));
      assert.deepEqual([rank().rank, rank().stale], [4, true]);
      write(CSV, lamarAt(7));
      write(META, metaFor(meta, "2026-11-26"));
      r = rank();
      assert.deepEqual([r.rank, r.updatedAt, r.stale], [7, "November 26, 2026", false]);
      // Eight days on, the same board is stale by the clock alone.
      assert.equal(oc.rosRank(LAMAR, 2026, { now: Date.parse("2026-12-04T12:00:00Z"), inSeason: true }).stale, true);
    });
  });

  test("the player page's render-cache key carries the rank, its date and its freshness", () => {
    // dataStamp() is computed once per process, so without these the fragment
    // rendered from the old board was served after a new one was installed,
    // and a fragment rendered fresh outlived the seven-day cutoff.
    const src = fs.readFileSync(path.join(APP, "src", "lib", "player", "player-data.ts"), "utf8");
    const key = src.slice(src.indexOf("export function playerDataVersion("), src.indexOf("].join(\"-\");", src.indexOf("export function playerDataVersion(")));
    assert.match(key, /data\.rosRank \? `\$\{data\.rosRank\.rank\}\.\$\{data\.rosRank\.updatedAtIso \?\? ""\}\.\$\{data\.rosRank\.stale \? "s" : "f"\}`/);
    assert.ok(rd.getRankings(2026, "ros"), "the committed board still loads after the test");
  });
});
