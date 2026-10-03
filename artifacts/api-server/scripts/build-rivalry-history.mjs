// Build data/rivalry/all-time.json: every NFL game ever played, by franchise,
// for the matchup pages' all-time series tiles.
//
//   node scripts/build-rivalry-history.mjs [--through 2025] [--download]
//
// Built from the copies of both sources stored in data/rivalry/source/, so the
// checked file can be rebuilt exactly as it was checked even if an upstream
// moves or goes away (FiveThirtyEight's archive is no longer maintained).
// `--download` refreshes those copies first; the yearly rollover needs it for
// nflverse's newly finished season.
//
// Two public sources, split at 1999 and never overlapping:
//
// - FiveThirtyEight's NFL Elo games (1920–2020), which codes each franchise
//   the same through every move - the Chicago/St. Louis/Phoenix Cardinals are
//   all ARI, the Cleveland/St. Louis Rams all LAR. Used for seasons before 1999.
// - nflverse's games.csv (1999 on), whose codes follow the city (STL, SD, OAK),
//   mapped here to the franchise.
//
// Only complete seasons are written (`--through`, default the season before
// the current one). The page adds the season in progress from its own
// schedule data, so this needs running once a year - see docs/SEASON-ROLLOVER.md.
//
// Dropped on purpose: the AAFC seasons (1946–49) of the Browns and 49ers,
// which the NFL does not count in head-to-head records.
//
// Counted twice on purpose: the 1943 Phil-Pitt "Steagles", whose games the
// records credit to both parent franchises, so a Steagles game against
// Washington is in PHI–WAS and in PIT–WAS (Eagles–Commanders 90–88–6 and
// Eagles–Giants 94–88–2 only add up with them). The 1944 Card-Pitt stays out:
// Cardinals–Rams is 53–41–2 without its two games, which is the published figure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELO_URL =
  "https://raw.githubusercontent.com/fivethirtyeight/nfl-elo-game/master/data/nfl_games.csv";
const NFLVERSE_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const SPLIT = 1999;

/** Franchise codes as the site prints them (team.code, upper case). */
const FROM_ELO = { OAK: "LV", WSH: "WAS" };
const MERGED = { STG: ["PHI", "PIT"] };
const FROM_NFLVERSE = { LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV" };
const SITE_CODES = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
  "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Plain CSV: neither file quotes a field that contains a comma. */
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""]));
  });
}

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "rivalry", "source");
const SOURCES = {
  [ELO_URL]: path.join(SOURCE_DIR, "fivethirtyeight-nfl_games.csv"),
  [NFLVERSE_URL]: path.join(SOURCE_DIR, "nflverse-games.csv"),
};

/** The stored copy of a source, downloaded over it first with `--download`. */
async function fetchText(url) {
  const file = SOURCES[url];
  if (process.argv.includes("--download")) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, "utf8");
}

const now = new Date();
const currentSeason = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const through = Number(arg("--through") ?? currentSeason - 1);
if (!Number.isInteger(through) || through < SPLIT) {
  console.error(`--through must be a season from ${SPLIT} on`);
  process.exit(1);
}

const games = [];

for (const r of parseCsv(await fetchText(ELO_URL))) {
  const season = Number(r.season);
  if (season >= SPLIT) continue;
  // team1 is the home side in this file; neutral sites keep that order.
  const homes = MERGED[r.team1] ?? [FROM_ELO[r.team1] ?? r.team1];
  const aways = MERGED[r.team2] ?? [FROM_ELO[r.team2] ?? r.team2];
  for (const home of homes) {
    for (const away of aways) {
      if (!SITE_CODES.has(home) || !SITE_CODES.has(away)) continue;
      if (season < 1950 && (home === "CLE" || home === "SF" || away === "CLE" || away === "SF")) continue;
      games.push([season, r.date, away, home, Number(r.score2), Number(r.score1), r.playoff === "0" ? 0 : 1]);
    }
  }
}

for (const r of parseCsv(await fetchText(NFLVERSE_URL))) {
  const season = Number(r.season);
  if (season < SPLIT || season > through) continue;
  if (r.home_score === "" || r.away_score === "") continue;
  const home = FROM_NFLVERSE[r.home_team] ?? r.home_team;
  const away = FROM_NFLVERSE[r.away_team] ?? r.away_team;
  if (!SITE_CODES.has(home) || !SITE_CODES.has(away)) {
    throw new Error(`unmapped nflverse team in ${r.game_id}: ${r.away_team} at ${r.home_team}`);
  }
  games.push([season, r.gameday, away, home, Number(r.away_score), Number(r.home_score), r.game_type === "REG" ? 0 : 1]);
}

games.sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]));

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "data", "rivalry", "all-time.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify({
    source: "FiveThirtyEight NFL Elo games (before 1999), nflverse games.csv (1999 on)",
    builtAt: now.toISOString(),
    throughSeason: through,
    columns: ["season", "date", "away", "home", "awayScore", "homeScore", "playoff"],
    games,
  }) + "\n",
);
console.log(`${games.length} games through ${through} -> ${path.relative(process.cwd(), out)}`);
