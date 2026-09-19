import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * The position this player occupies in a fantasy lineup.
 *
 * Sleeper's `position` is the primary football position, which for a two-way
 * player is not necessarily the fantasy one: Travis Hunter is carried as a DB
 * with `fantasy_positions: ['DB','WR']`, and filtering on `position` alone
 * dropped him out of the index entirely — no player page, no link from any
 * ranking or outlook that names him. `fantasy_positions` is the field that
 * answers the question this index is actually asking, so it is the fallback
 * whenever the primary position is not one we carry.
 */
function fantasyPosition(p) {
  if (VALID_POSITIONS.includes(p.position)) return p.position;
  const alt = (p.fantasy_positions || []).find((pos) => VALID_POSITIONS.includes(pos));
  return alt || null;
}

const TEAM_ALIAS_MAP = {
  JAC: 'JAX',
  WSH: 'WAS',
  OAK: 'LV',
  STL: 'LAR',
  SD: 'LAC',
  LA: 'LAR',
};

const CANONICAL_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE',
  'DAL','DEN','DET','GB','HOU','IND','JAX','KC',
  'LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
  'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS',
];

const TEAM_FULL_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
  NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

function normalizeTeam(abbr) {
  if (!abbr) return 'FA';
  const upper = abbr.toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || upper;
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .trim();
}

function buildSlug(fullName) {
  if (!fullName) return '';
  return fullName
    .toLowerCase()
    .replace(/[''`´\u2018\u2019\u201A\u201B]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  console.log('Fetching NFL players from Sleeper API...');
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status}`);

  const playersMap = await res.json();
  console.log(`Received ${Object.keys(playersMap).length} players from API`);

  const players = [];
  const slugSet = new Set();
  const teamsWithDef = new Set();

  for (const [playerId, p] of Object.entries(playersMap)) {
    if (!p.full_name && p.position !== 'DEF') continue;
    const position = fantasyPosition(p);
    if (!position) continue;

    const rawName = position === 'DEF' ? (p.full_name || `${p.first_name} ${p.last_name}`) : p.full_name;
    const name = normalizeName(rawName);
    let slug = buildSlug(name);
    if (!slug) continue;

    if (slugSet.has(slug)) {
      slug = `${slug}-${playerId}`;
    }
    slugSet.add(slug);

    const team = normalizeTeam(p.team);

    if (position === 'DEF' && team !== 'FA') {
      teamsWithDef.add(team);
    }

    players.push({
      id: playerId,
      name,
      slug,
      position,
      team,
      status: p.status || null,
      injury_status: p.injury_status || null,
      age: p.age || null,
      height: p.height || null,
      weight: p.weight || null,
      number: p.number ?? null,
      depth_chart_order: p.depth_chart_order ?? null,
      years_exp: p.years_exp ?? null,
    });
  }

  for (const team of CANONICAL_TEAMS) {
    if (!teamsWithDef.has(team)) {
      const fullName = TEAM_FULL_NAMES[team] || team;
      const slug = buildSlug(fullName);
      if (!slugSet.has(slug)) {
        slugSet.add(slug);
        players.push({
          id: `DEF-${team}`,
          name: fullName,
          slug,
          position: 'DEF',
          team,
          status: 'Active',
          injury_status: null,
          age: null,
          height: null,
          weight: null,
          number: null,
          depth_chart_order: 1,
          years_exp: null,
        });
        console.log(`  Generated missing DEF entry: ${fullName} (${team})`);
      }
    }
  }

  players.sort((a, b) => {
    const posOrder = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
    const pa = posOrder[a.position] ?? 99;
    const pb = posOrder[b.position] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  const outDir = SC_DATA_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'players.json');
  fs.writeFileSync(outPath, JSON.stringify(players, null, 2));
  console.log(`Wrote ${players.length} players to ${outPath}`);
  console.log(`  Teams with DEF: ${teamsWithDef.size}/32`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
