import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = SC_DATA_DIR;

const SEASONS = [2023, 2024, 2025];
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

const SEASON_STARTS = {
  2023: '2023-09-07',
  2024: '2024-09-05',
  2025: '2025-09-04',
};

function getWeekDateRange(season, week) {
  const startStr = SEASON_STARTS[season];
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
    const res = await fetch(url, {
      headers: { 'Accept-Encoding': 'identity' },
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
  const allScores = {};

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

    allScores[season] = seasonScores;
    const entryCount = Object.keys(seasonScores).length;
    console.log(`  Season ${season}: ${entryCount} team-week entries`);
  }

  const outFile = path.resolve(DATA_DIR, 'game_scores.json');
  fs.writeFileSync(outFile, JSON.stringify(allScores, null, 0));
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
