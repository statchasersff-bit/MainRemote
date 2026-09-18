import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = SC_DATA_DIR;
const GAME_LOGS_DIR = path.resolve(DATA_DIR, 'game_logs');

const SEASONS = [2023, 2024, 2025];
const REGULAR_WEEKS = 18;
const STATS_BASE = 'https://api.sleeper.com/stats/nfl';
const DELAY_MS = 200;

const TEAM_ALIAS_MAP = {
  JAC: 'JAX', WSH: 'WAS', OAK: 'LV', STL: 'LAR', SD: 'LAC', LA: 'LAR',
};
function normalizeTeam(abbr) {
  if (!abbr) return null;
  const upper = String(abbr).toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || upper;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWeekStats(season, week) {
  const url = `${STATS_BASE}/${season}/${week}?season_type=regular`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Failed to fetch ${url}: ${res.status}`);
    return null;
  }
  return res.json();
}

async function main() {
  for (const season of SEASONS) {
    const logFile = path.resolve(GAME_LOGS_DIR, `${season}.json`);
    if (!fs.existsSync(logFile)) {
      console.log(`Skipping ${season} (no log file)`);
      continue;
    }
    console.log(`\n=== Backfilling team for ${season} ===`);
    const logs = JSON.parse(fs.readFileSync(logFile, 'utf-8'));

    // weekTeamByPlayer[week][playerId] = team
    const weekTeamByPlayer = {};
    for (let week = 1; week <= REGULAR_WEEKS; week++) {
      process.stdout.write(`  Week ${week}... `);
      const weekData = await fetchWeekStats(season, week);
      if (!weekData) { console.log('skipped'); continue; }
      const map = {};
      for (const [, entry] of Object.entries(weekData)) {
        const pid = String(entry.player_id);
        const t = normalizeTeam(entry.team);
        if (pid && t) map[pid] = t;
      }
      weekTeamByPlayer[week] = map;
      console.log(`${Object.keys(map).length} entries`);
      await sleep(DELAY_MS);
    }

    let touched = 0;
    for (const [pid, entries] of Object.entries(logs)) {
      for (const e of entries) {
        const t = weekTeamByPlayer[e.week] && weekTeamByPlayer[e.week][pid];
        if (t && e.team !== t) {
          e.team = t;
          touched++;
        } else if (t && !('team' in e)) {
          e.team = t;
          touched++;
        }
      }
    }
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 0));
    console.log(`Wrote ${logFile} (${touched} entries updated)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
