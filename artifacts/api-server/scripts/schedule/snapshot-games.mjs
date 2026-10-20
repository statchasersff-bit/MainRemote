#!/usr/bin/env node
/**
 * Refresh the stored copy of nflverse's games.csv.
 *
 * The NFL schedule tool and every team hub read the season's slate from this
 * file's upstream (lib/schedule/schedule-data.ts); the copy at
 * data/schedule/games.csv is what answers when the upstream cannot be
 * reached, and the test fixture tests/fixtures/games-<date>.csv.gz is a
 * gzipped copy of the same. Run it with the weekly data refresh, after the
 * week's finals have posted (Tuesday), so the stored results are complete.
 *
 *   node scripts/schedule/snapshot-games.mjs            # data/schedule/games.csv
 *   node scripts/schedule/snapshot-games.mjs --fixture  # + a dated test fixture
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const OUT = path.join(ROOT, "data", "schedule", "games.csv");

const response = await fetch(URL, {
  headers: { Accept: "text/csv", "User-Agent": "StatChasersSchedule/1.0 (+statchasers.com)" },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  console.error(`nflverse responded ${response.status}`);
  process.exit(1);
}
const csv = await response.text();
const rows = csv.split("\n").length - 1;
if (!csv.startsWith("game_id,") || rows < 5000) {
  console.error(`games.csv looks wrong (${rows} rows); nothing written`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, csv);
console.log(`wrote ${OUT} (${rows} rows)`);

if (process.argv.includes("--fixture")) {
  const stamp = new Date().toISOString().slice(0, 10);
  const fixture = path.join(ROOT, "tests", "fixtures", `games-${stamp}.csv.gz`);
  fs.writeFileSync(fixture, zlib.gzipSync(csv));
  console.log(`wrote ${fixture}`);
}
