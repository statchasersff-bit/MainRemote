import fs from 'fs';
import path from 'path';
import https from 'https';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const DATA_DIR = SC_DATA_DIR;
const PLAYERS_FILE = path.resolve(DATA_DIR, 'players.json');
const INDEXED_FILE = path.resolve(DATA_DIR, 'indexed_players.json');
const OUTPUT_FILE = path.resolve(DATA_DIR, 'draft.json');

const TEAM_ALIAS_MAP = {
  JAC: 'JAX', WSH: 'WAS', OAK: 'LV', STL: 'LAR', SD: 'LAC', LA: 'LAR',
};
function normalizeTeam(t) { return t ? (TEAM_ALIAS_MAP[t] || t) : t; }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 StatChasers/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseDraftDisplay(displayDraft) {
  if (!displayDraft) return null;
  const m = displayDraft.match(/^(\d{4}):\s*Rd\s*(\d+),\s*Pk\s*(\d+)\s*\(([^)]+)\)/);
  if (!m) return null;
  return {
    year: parseInt(m[1]),
    round: parseInt(m[2]),
    pick: parseInt(m[3]),
    team: normalizeTeam(m[4].trim()),
  };
}

async function fetchDraftFromESPN(espnId) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`;
  const data = await fetchJSON(url);
  const athlete = data.athlete || data;
  const result = { draft: null, college: null };

  if (athlete.displayDraft) {
    result.draft = parseDraftDisplay(athlete.displayDraft);
  }
  if (athlete.college?.name) {
    result.college = athlete.college.name;
  }
  return result;
}

async function searchESPNPlayer(name) {
  const encoded = encodeURIComponent(name);
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${encoded}&limit=5&type=player&sport=football&league=nfl`;
  try {
    const data = await fetchJSON(url);
    if (data.items && data.items.length > 0) {
      const normalName = name.replace(/['']/g, "'").toLowerCase().trim();
      for (const item of data.items) {
        const itemName = (item.displayName || '').replace(/['']/g, "'").toLowerCase().trim();
        if (itemName === normalName) {
          return item.id;
        }
      }
      const first = data.items[0];
      const firstName = (first.displayName || '').replace(/['']/g, "'").toLowerCase().trim();
      if (firstName === normalName) return first.id;
    }
  } catch {}
  return null;
}

async function main() {
  console.log('Building draft dataset...');

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  const indexed = JSON.parse(fs.readFileSync(INDEXED_FILE, 'utf8'));
  const bySlug = {};
  for (const p of Object.values(players)) bySlug[p.slug] = p;

  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  }

  console.log('Fetching full Sleeper player data...');
  const sleeperAll = await fetchJSON('https://api.sleeper.app/v1/players/nfl');

  const directQueue = [];
  const searchQueue = [];
  const draft = { ...existing };

  for (const slug of indexed.slugs) {
    const p = bySlug[slug];
    if (!p || !['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue;

    if (draft[slug] && draft[slug].year) continue;

    const sleeper = sleeperAll[String(p.id)];
    const college = sleeper?.college || null;
    const rookieYear = sleeper?.metadata?.rookie_year ? parseInt(sleeper.metadata.rookie_year) : null;
    const espnId = sleeper?.espn_id || null;

    if (!draft[slug]) {
      draft[slug] = {
        player_id: p.id,
        name: p.name,
        college,
        rookie_year: rookieYear,
        year: null,
        round: null,
        pick: null,
        draft_team: null,
      };
    }

    if (draft[slug].year) continue;

    if (!draft[slug].college && college) draft[slug].college = college;
    if (!draft[slug].rookie_year && rookieYear) draft[slug].rookie_year = rookieYear;

    if (espnId) {
      directQueue.push({ slug, espnId, name: p.name });
    } else {
      searchQueue.push({ slug, name: p.name });
    }
  }

  console.log(`Phase 1: Fetching draft data from ESPN for ${directQueue.length} players with ESPN IDs...`);
  let fetched = 0, found = 0, errors = 0;

  for (const { slug, espnId } of directQueue) {
    try {
      const result = await fetchDraftFromESPN(espnId);
      if (result.draft) {
        Object.assign(draft[slug], { year: result.draft.year, round: result.draft.round, pick: result.draft.pick, draft_team: result.draft.team });
        found++;
      }
      if (!draft[slug].college && result.college) draft[slug].college = result.college;
      fetched++;
      if (fetched % 20 === 0) console.log(`  ${fetched}/${directQueue.length} (${found} found)`);
      await sleep(120);
    } catch (err) {
      errors++;
    }
  }
  console.log(`  Phase 1 complete: ${fetched} fetched, ${found} found, ${errors} errors`);

  console.log(`\nPhase 2: Searching ESPN for ${searchQueue.length} players without ESPN IDs...`);
  let searched = 0, searchFound = 0, searchErrors = 0;

  const BATCH_SIZE = 50;
  for (const { slug, name } of searchQueue) {
    try {
      const espnId = await searchESPNPlayer(name);
      if (espnId) {
        await sleep(50);
        const result = await fetchDraftFromESPN(espnId);
        if (result.draft) {
          Object.assign(draft[slug], { year: result.draft.year, round: result.draft.round, pick: result.draft.pick, draft_team: result.draft.team });
          searchFound++;
        }
        if (!draft[slug].college && result.college) draft[slug].college = result.college;
      }
      searched++;
      if (searched % 30 === 0) console.log(`  ${searched}/${searchQueue.length} (${searchFound} found)`);
      if (searched % BATCH_SIZE === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(draft, null, 2));
      }
      await sleep(50);
    } catch (err) {
      searchErrors++;
    }
  }
  console.log(`  Phase 2 complete: ${searched} searched, ${searchFound} found, ${searchErrors} errors`);

  const total = Object.keys(draft).length;
  const withDraft = Object.values(draft).filter(d => d.year).length;
  const withCollege = Object.values(draft).filter(d => d.college).length;
  const withRookieYear = Object.values(draft).filter(d => d.rookie_year).length;

  console.log(`\nDraft dataset complete:`);
  console.log(`  Total entries: ${total}`);
  console.log(`  With full draft data: ${withDraft}`);
  console.log(`  With college: ${withCollege}`);
  console.log(`  With rookie year: ${withRookieYear}`);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(draft, null, 2));
  console.log(`Saved to ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
