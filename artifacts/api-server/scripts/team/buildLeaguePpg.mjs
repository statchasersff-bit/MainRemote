/**
 * League-average points per team-game by season, for the Coaching tab's
 * career scoring chart (the dim reference line under a play-caller's stops).
 *
 *   node scripts/team/buildLeaguePpg.mjs
 *
 * Reads data/schedule/games.csv (the stored nflverse slate), regular-season
 * games with a final score only, and writes data/team/league_ppg.json:
 *
 *   seasons  { "2005": 20.6, ... }  points per team per game, one decimal
 *   games    { "2005": 256, ... }   the games behind each average
 *
 * The in-progress season is the average to date, so re-run it with the
 * weekly builders. The file is small and stored on purpose: the page never
 * reads the CSV (see data/team/README or the "store verified data" rule).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const src = path.join(root, "data", "schedule", "games.csv");
const out = path.join(root, "data", "team", "league_ppg.json");

const lines = fs.readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean);
const head = lines[0].split(",");
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`games.csv has no ${name} column`);
  return i;
};
const SEASON = col("season");
const TYPE = col("game_type");
const TOTAL = col("total");

const points = new Map();
const games = new Map();
for (const line of lines.slice(1)) {
  // The columns we read come before any quoted field (stadium names sit at
  // the end), so a plain split is safe here.
  const cells = line.split(",");
  if (cells[TYPE] !== "REG" || cells[TOTAL] === "") continue;
  const season = cells[SEASON];
  points.set(season, (points.get(season) ?? 0) + Number(cells[TOTAL]));
  games.set(season, (games.get(season) ?? 0) + 1);
}

const seasons = {};
const counts = {};
for (const season of [...points.keys()].sort()) {
  // Two teams score in every game, so a team-game average halves the total.
  seasons[season] = Math.round((points.get(season) / (2 * games.get(season))) * 10) / 10;
  counts[season] = games.get(season);
}

fs.writeFileSync(
  out,
  JSON.stringify({ builtAt: new Date().toISOString(), source: "data/schedule/games.csv (regular season, final scores)", seasons, games: counts }, null, 2) + "\n",
);
console.log(`wrote ${path.relative(root, out)}: ${Object.keys(seasons).length} seasons, ${Object.keys(seasons)[0]}-${Object.keys(seasons).at(-1)}`);
