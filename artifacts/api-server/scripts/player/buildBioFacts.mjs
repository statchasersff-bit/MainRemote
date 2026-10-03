/**
 * The biographical facts behind the Bio tab.
 *
 * Bio answers one question - "who is he?" - and the facts that answer it are
 * scattered across two Sleeper endpoints that no other builder here reads:
 *
 *   1. /v1/players/nfl carries birth date, college and high school. The player
 *      index is built from the same document and deliberately does not carry
 *      them: it is loaded on every request for every player, and four fields
 *      nothing but one tab reads do not belong in it.
 *
 *   2. /stats/nfl/<season>?grouping=season carries the TEAM each player was on
 *      that season, one request per season for the whole league. That is the
 *      career timeline, and it is not derivable from anything already on disk -
 *      the game logs start at 2023 and the production snapshot has no team on
 *      its rows, so a veteran's first decade is simply absent.
 *
 * Hometown is NOT here, and not by omission: Sleeper's birth_city and
 * birth_state are null for every active player at every position. The Bio tab
 * renders what this file holds and nothing else, so a hometown row will appear
 * the day a source for it does and not before.
 *
 * Written to data/player/bio_facts.json, keyed by the slug players.json already
 * uses - read from that file rather than recomputed, so a slug can never drift
 * between the index and this.
 *
 *   node scripts/player/buildBioFacts.mjs            # 2005 to the current season
 *   node scripts/player/buildBioFacts.mjs 2019 2020  # just those two, merged in
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { currentSeason } from "./season.mjs";

const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const OUT_FILE = path.join(DATA_DIR, "bio_facts.json");

const PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const STATS_BASE = "https://api.sleeper.com/stats/nfl";

/**
 * How far back the career timeline reaches.
 *
 * 2005 covers every active player's rookie season with room to spare - the
 * longest careers in the league run about twenty years - and a season Sleeper
 * has nothing for costs one request and writes nothing.
 */
const FIRST_CAREER_SEASON = 2005;

/** Between season requests. The same courtesy the other builders extend. */
const DELAY_MS = 250;

const TEAM_ALIAS_MAP = {
  JAC: "JAX",
  WSH: "WAS",
  OAK: "LV",
  STL: "LAR",
  SD: "LAC",
  LA: "LAR",
};

function normalizeTeam(abbr) {
  if (!abbr) return null;
  const upper = String(abbr).toUpperCase().trim();
  if (upper === "" || upper === "FA") return null;
  return TEAM_ALIAS_MAP[upper] || upper;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seasonsFromArgs(argv = process.argv.slice(2)) {
  const named = argv
    .map((arg) => Number(arg))
    .filter((n) => Number.isInteger(n) && n >= 1950 && n <= 2100);
  if (named.length) return named.sort((a, b) => a - b);

  const last = currentSeason();
  const out = [];
  for (let season = FIRST_CAREER_SEASON; season <= last; season += 1) out.push(season);
  return out;
}

/** "1992-12-11" or null. Anything else Sleeper hands over is not a date. */
function birthDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function text(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

async function main() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    throw new Error(
      `${PLAYERS_FILE} does not exist - run buildPlayersIndex.js first, because the slugs come from it.`,
    );
  }

  // id -> slug, straight from the index the server reads. Recomputing slugs
  // here would be a second implementation of buildSlug() that agrees with the
  // first until the day one of them is changed.
  const index = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));
  const slugById = new Map();
  for (const row of index) {
    if (row && row.id && row.slug) slugById.set(String(row.id), row.slug);
  }
  console.log(`Read ${slugById.size} slugs from players.json`);

  // Anything already on disk is kept: naming two seasons on the command line
  // must not drop the other eighteen.
  const out = fs.existsSync(OUT_FILE)
    ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8"))
    : {};

  const record = (slug) => {
    if (!out[slug]) {
      out[slug] = { birthDate: null, college: null, highSchool: null, teams: [] };
    }
    if (!Array.isArray(out[slug].teams)) out[slug].teams = [];
    return out[slug];
  };

  /* ---- the personal facts ---- */

  console.log("Fetching player bios from Sleeper...");
  const res = await fetch(PLAYERS_URL);
  if (!res.ok) throw new Error(`Sleeper players API error: ${res.status}`);
  const players = await res.json();

  let withBirth = 0;
  let withCollege = 0;
  for (const [id, player] of Object.entries(players)) {
    const slug = slugById.get(String(id));
    if (!slug) continue;

    const row = record(slug);
    row.birthDate = birthDate(player.birth_date);
    row.college = text(player.college);
    row.highSchool = text(player.high_school);
    if (row.birthDate) withBirth += 1;
    if (row.college) withCollege += 1;
  }
  console.log(`  birth dates: ${withBirth}, colleges: ${withCollege}`);

  /* ---- the career timeline ---- */

  const seasons = seasonsFromArgs();
  console.log(`Fetching season teams for ${seasons[0]}-${seasons[seasons.length - 1]}...`);

  for (const season of seasons) {
    const url = `${STATS_BASE}/${season}?season_type=regular&grouping=season`;
    let rows = null;
    try {
      const response = await fetch(url);
      if (response.ok) rows = await response.json();
      else console.warn(`  ${season}: ${response.status}`);
    } catch (err) {
      console.warn(`  ${season}: ${err.message}`);
    }
    await sleep(DELAY_MS);

    if (!Array.isArray(rows)) {
      console.warn(`  ${season}: no rows; leaving whatever is on disk alone`);
      continue;
    }

    // A fetched season is authoritative for that season: every existing row
    // for it is dropped before the new ones go in, so re-running one year
    // CORRECTS it. Filtering only the players who matched would leave a stale
    // row behind for everyone who no longer does, which is the subtler half of
    // the same bug.
    for (const slug of Object.keys(out)) {
      if (Array.isArray(out[slug].teams)) {
        out[slug].teams = out[slug].teams.filter((t) => t.season !== season);
      }
    }

    let matched = 0;
    let skipped = 0;
    for (const row of rows) {
      const slug = slugById.get(String(row?.player_id ?? ""));
      const team = normalizeTeam(row?.team);
      if (!slug || !team) continue;

      // The guard that makes this file trustworthy.
      //
      // Sleeper answers for EVERY player in every season it is asked about,
      // and for a season a player was not in the league it returns his CURRENT
      // team with an empty stats object. Taken at face value that puts Jacoby
      // Brissett on Arizona in 2005, thirteen years before Arizona signed him
      // and eleven before anyone drafted him - a timeline that is confidently
      // wrong rather than merely short. A season he was actually on a roster
      // for carries a real stat line; one he was not carries {}.
      const stats = row?.stats;
      if (!stats || typeof stats !== "object" || Object.keys(stats).length === 0) {
        skipped += 1;
        continue;
      }

      record(slug).teams.push({ season, team });
      matched += 1;
    }
    console.log(`  ${season}: ${matched} player-seasons (${skipped} not in the league)`);
  }

  /* ---- write ---- */

  const sorted = {};
  for (const slug of Object.keys(out).sort()) {
    const row = out[slug];
    row.teams.sort((a, b) => a.season - b.season);
    // A row with nothing in it is not written: an empty record is
    // indistinguishable from a built one and makes the file look complete.
    if (!row.birthDate && !row.college && !row.highSchool && row.teams.length === 0) {
      continue;
    }
    sorted[slug] = row;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 0));
  console.log(`\nWrote ${Object.keys(sorted).length} players to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
