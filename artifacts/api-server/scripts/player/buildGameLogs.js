import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";
import { seasonsFromArgs } from "./season.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = SC_DATA_DIR;
const GAME_LOGS_DIR = path.resolve(DATA_DIR, 'game_logs');
const PLAYERS_FILE = path.resolve(DATA_DIR, 'players.json');

// Derived, not typed: a hardcoded list is wrong every September and fails
// silently - the build succeeds and every page shows last season. Name seasons
// on the command line to rebuild one year: `node buildGameLogs.js 2026`.
const SEASONS = seasonsFromArgs();
const REGULAR_WEEKS = 18;
// Overridable for the builder's tests, which serve a stub.
const STATS_BASE = process.env.SC_SLEEPER_STATS_BASE?.trim() || 'https://api.sleeper.com/stats/nfl';
const DELAY_MS = 250;

const TEAM_ALIAS_MAP = {
  JAC: 'JAX', WSH: 'WAS', OAK: 'LV', STL: 'LAR', SD: 'LAC', LA: 'LAR',
};

function normalizeTeam(abbr) {
  if (!abbr) return null;
  const upper = abbr.toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || upper;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWeekStats(season, week) {
  const url = `${STATS_BASE}/${season}/${week}?season_type=regular`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.warn(`  Failed to fetch ${url}: ${res.status}`);
    return null;
  }
  return res.json();
}

function computePprPoints(s) {
  let pts = 0;
  pts += (s.pass_yd || 0) * 0.04;
  pts += (s.pass_td || 0) * 4;
  pts += (s.pass_int || 0) * -1;
  pts += (s.rush_yd || 0) * 0.1;
  pts += (s.rush_td || 0) * 6;
  pts += (s.rec || 0) * 1;
  pts += (s.rec_yd || 0) * 0.1;
  pts += (s.rec_td || 0) * 6;
  pts += (s.fum_lost || 0) * -2;
  pts += (s.pass_2pt || 0) * 2;
  pts += (s.rush_2pt || 0) * 2;
  pts += (s.rec_2pt || 0) * 2;
  return Math.round(pts * 100) / 100;
}

function extractPlayerStats(statsObj, position) {
  const s = statsObj || {};
  const base = {
    pts_ppr: s.pts_ppr ?? computePprPoints(s),
    pts_half_ppr: s.pts_half_ppr ?? null,
    off_snp: s.off_snp || 0,
    tm_off_snp: s.tm_off_snp || 0,
  };

  if (position === 'QB') {
    return {
      ...base,
      pass_att: s.pass_att || 0,
      pass_cmp: s.pass_cmp || 0,
      pass_yd: s.pass_yd || 0,
      pass_td: s.pass_td || 0,
      pass_int: s.pass_int || 0,
      rush_att: s.rush_att || 0,
      rush_yd: s.rush_yd || 0,
      rush_td: s.rush_td || 0,
    };
  }

  if (position === 'RB') {
    return {
      ...base,
      rush_att: s.rush_att || 0,
      rush_yd: s.rush_yd || 0,
      rush_td: s.rush_td || 0,
      rec_tgt: s.rec_tgt || 0,
      rec: s.rec || 0,
      rec_yd: s.rec_yd || 0,
      rec_td: s.rec_td || 0,
    };
  }

  if (position === 'WR' || position === 'TE') {
    return {
      ...base,
      rec_tgt: s.rec_tgt || 0,
      rec: s.rec || 0,
      rec_yd: s.rec_yd || 0,
      rec_td: s.rec_td || 0,
      rush_att: s.rush_att || 0,
      rush_yd: s.rush_yd || 0,
      rush_td: s.rush_td || 0,
    };
  }

  if (position === 'K') {
    return {
      ...base,
      fgm: s.fgm || 0,
      fga: s.fga || 0,
      fgm_lng: s.fgm_lng || 0,
      xpm: s.xpm || 0,
      xpa: s.xpa || 0,
    };
  }

  return base;
}

async function main() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error('players.json not found. Run buildPlayersIndex.js first.');
    process.exit(1);
  }

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
  const playerMap = new Map();
  for (const p of players) {
    playerMap.set(String(p.id), p);
  }
  console.log(`Loaded ${playerMap.size} players from players.json`);

  if (!fs.existsSync(GAME_LOGS_DIR)) {
    fs.mkdirSync(GAME_LOGS_DIR, { recursive: true });
  }

  for (const season of SEASONS) {
    console.log(`\n=== Season ${season} ===`);
    const seasonData = {};
    const outFile = path.resolve(GAME_LOGS_DIR, `${season}.json`);
    // What is on disk now. A week Sleeper fails to return keeps these rows
    // rather than vanishing: this rebuilds the whole season from scratch, and
    // it now runs unattended after every game window (src/lib/player/
    // live-refresh.ts), so one failed request must not erase a week of stats.
    const previous = fs.existsSync(outFile)
      ? JSON.parse(fs.readFileSync(outFile, 'utf-8'))
      : {};
    let failedWeeks = 0;

    for (let week = 1; week <= REGULAR_WEEKS; week++) {
      process.stdout.write(`  Week ${week}... `);
      const weekData = await fetchWeekStats(season, week).catch(() => null);
      if (!weekData) {
        failedWeeks++;
        let kept = 0;
        for (const [playerId, rows] of Object.entries(previous)) {
          for (const row of rows) {
            if (row.week !== week) continue;
            (seasonData[playerId] ??= []).push(row);
            kept++;
          }
        }
        console.log(`failed; kept ${kept} entries from disk`);
        continue;
      }

      let playerCount = 0;
      for (const [, entry] of Object.entries(weekData)) {
        const playerId = String(entry.player_id);
        const player = playerMap.get(playerId);
        if (!player) continue;

        const stats = entry.stats || {};
        if (!stats.gp && stats.gp !== 0) continue;

        const position = player.position;
        if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(position)) continue;

        const opp = normalizeTeam(entry.opponent);
        const team = normalizeTeam(entry.team);
        const extracted = extractPlayerStats(stats, position);

        if (!seasonData[playerId]) {
          seasonData[playerId] = [];
        }
        seasonData[playerId].push({
          week,
          opp: opp || '-',
          team: team || null,
          stats: extracted,
        });
        playerCount++;
      }
      console.log(`${playerCount} player entries`);
      await sleep(DELAY_MS);
    }

    if (failedWeeks === REGULAR_WEEKS) {
      console.warn(`  Every week failed for ${season}; leaving the file on disk alone.`);
      continue;
    }
    // A season with no games yet - every March to September, when the
    // unattended refresh asks for the new league year - or a response that
    // came back empty. Writing it would publish an empty season file (and
    // could replace a full one with nothing).
    if (Object.keys(seasonData).length === 0) {
      console.warn(`  No games in ${season} yet; nothing written.`);
      continue;
    }
    for (const rows of Object.values(seasonData)) rows.sort((a, b) => a.week - b.week);
    // Written beside the target and renamed over it, so the server never reads
    // a half-written file.
    fs.writeFileSync(`${outFile}.tmp`, JSON.stringify(seasonData, null, 0));
    fs.renameSync(`${outFile}.tmp`, outFile);
    const playerIds = Object.keys(seasonData).length;
    const totalEntries = Object.values(seasonData).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`Wrote ${outFile}: ${playerIds} players, ${totalEntries} week entries`);
  }

  console.log('\nDone! Game logs saved to data/game_logs/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
