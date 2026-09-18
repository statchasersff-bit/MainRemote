import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";
import { seasonsFromArgs } from "./season.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = SC_DATA_DIR;

// Derived, not typed: a hardcoded list is wrong every September and fails
// silently — the build succeeds and every page shows last season. Name seasons
// on the command line to rebuild one year: `node buildGameLogs.js 2026`.
const SEASONS = seasonsFromArgs();
const REGULAR_WEEKS = 18;
const DELAY_MS = 400;

const TEAM_ALIAS_MAP = {
  WSH: 'WAS', JAC: 'JAX', OAK: 'LV', STL: 'LAR', SD: 'LAC', LA: 'LAR',
};

function normalizeTeam(abbr) {
  if (!abbr) return null;
  const upper = abbr.toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || upper;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Week 1's Thursday. The scoreboard is queried by date range, so this is the
// anchor every week is counted from and a season missing from here cannot be
// built — see the throw below, which is deliberate: a wrong anchor silently
// fetches the wrong week's games and writes them under the right week's key.
const SEASON_STARTS = {
  2023: '2023-09-07',
  2024: '2024-09-05',
  2025: '2025-09-04',
  2026: '2026-09-09',
};

function getWeekDateRange(season, week) {
  const startStr = SEASON_STARTS[season];
  if (!startStr) {
    throw new Error(
      `No week-1 date for ${season}. Add it to SEASON_STARTS — it is the ` +
      `Thursday of week 1, and Sleeper reports it as season_start_date at ` +
      `https://api.sleeper.app/v1/state/nfl`,
    );
  }
  const start = new Date(startStr + 'T12:00:00Z');
  const tuesdayBefore = new Date(start);
  tuesdayBefore.setDate(start.getDate() + (week - 1) * 7 - 2);
  const tuesdayAfter = new Date(tuesdayBefore);
  tuesdayAfter.setDate(tuesdayBefore.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${fmt(tuesdayBefore)}-${fmt(tuesdayAfter)}`;
}

async function fetchWeekScores(season, week) {
  const dateRange = getWeekDateRange(season, week);
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateRange}&limit=50`;
  try {
    // A named user-agent, matching TEAM_USER_AGENT in src/lib/team/cache.ts.
    // ESPN answers the server's team-hub calls and refused this script's with a
    // 403 for every week; the header is the difference.
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'StatChasersTeamPages/1.0 (+statchasers.com)',
      },
    });
    if (!res.ok) {
      console.warn(`  Failed ${url}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.warn(`  Error:`, err.message);
    return [];
  }
}

async function main() {
  // Read the existing file and write back into it, rather than starting empty.
  // These scores are committed data covering every season the app carries, and
  // this script can now be pointed at ONE of them — a fresh object would mean
  // `node buildGameScores.js 2026` silently deleted three finished seasons.
  const outFile = path.resolve(DATA_DIR, 'game_scores.json');
  const allScores = fs.existsSync(outFile)
    ? JSON.parse(fs.readFileSync(outFile, 'utf-8'))
    : {};

  for (const season of SEASONS) {
    console.log(`\n=== Season ${season} ===`);
    const seasonScores = {};

    for (let week = 1; week <= REGULAR_WEEKS; week++) {
      process.stdout.write(`  Week ${week}... `);
      const events = await fetchWeekScores(season, week);

      let gameCount = 0;
      for (const event of events) {
        const eventWeek = event.week?.number;
        if (eventWeek && eventWeek !== week) continue;

        const comp = event.competitions?.[0];
        if (!comp) continue;

        const teams = comp.competitors || [];
        if (teams.length !== 2) continue;

        const home = teams.find(t => t.homeAway === 'home');
        const away = teams.find(t => t.homeAway === 'away');
        if (!home || !away) continue;

        const homeTeam = normalizeTeam(home.team?.abbreviation);
        const awayTeam = normalizeTeam(away.team?.abbreviation);
        const homeScore = parseInt(home.score, 10) || 0;
        const awayScore = parseInt(away.score, 10) || 0;

        if (homeTeam) {
          const key = `${homeTeam}_${week}`;
          seasonScores[key] = {
            tm: homeScore,
            opp: awayScore,
            r: homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'T',
          };
        }

        if (awayTeam) {
          const key = `${awayTeam}_${week}`;
          seasonScores[key] = {
            tm: awayScore,
            opp: homeScore,
            r: awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'T',
          };
        }

        gameCount++;
      }

      console.log(`${gameCount} games`);
      await sleep(DELAY_MS);
    }

    // An empty fetch does not overwrite a season already on disk. ESPN rate
    // limits and blocks, and a 403 for all 18 weeks must not turn a good season
    // into an empty one.
    if (Object.keys(seasonScores).length > 0) {
      allScores[season] = seasonScores;
    } else if (allScores[season]) {
      console.warn(`  No games fetched for ${season}; keeping the ${Object.keys(allScores[season]).length} already on disk.`);
    } else {
      // Not written at all. An empty season key is indistinguishable from a
      // season with no games and makes the file look built when it is not;
      // getGameScore() returns null for a missing key either way.
      console.warn(`  No games fetched for ${season}; nothing written.`);
    }
    const entryCount = Object.keys(seasonScores).length;
    console.log(`  Season ${season}: ${entryCount} team-week entries`);
  }

  // Season keys in order, so a rebuilt file diffs against the old one.
  const sorted = {};
  for (const key of Object.keys(allScores).sort()) sorted[key] = allScores[key];
  fs.writeFileSync(outFile, JSON.stringify(sorted, null, 0));
  console.log(`\nWrote ${outFile}`);

  for (const season of SEASONS) {
    const entries = Object.keys(allScores[season] || {}).length;
    console.log(`  ${season}: ${entries} entries`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
