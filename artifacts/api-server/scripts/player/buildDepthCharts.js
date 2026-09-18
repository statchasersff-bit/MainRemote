import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OURLADS_BASE = 'https://www.ourlads.com/nfldepthcharts/depthchartpos';
const POSITIONS_TO_FETCH = ['QB', 'RB', 'WR', 'TE', 'PK'];

const OURLADS_TEAM_MAP = {
  ARZ: 'ARI',
  RAM: 'LAR',
  SD: 'LAC',
};

const NFL_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE',
  'DAL','DEN','DET','GB','HOU','IND','JAX','KC',
  'LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
  'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS',
];

const TEAM_ALIAS_MAP = {
  JAC: 'JAX',
  WSH: 'WAS',
  OAK: 'LV',
  STL: 'LAR',
  SD: 'LAC',
  LA: 'LAR',
};

function normalizeTeamFromOurlads(abbr) {
  if (!abbr) return null;
  const upper = abbr.toUpperCase().trim();
  return OURLADS_TEAM_MAP[upper] || upper;
}

function normalizeTeam(abbr) {
  if (!abbr) return 'FA';
  const upper = abbr.toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || OURLADS_TEAM_MAP[upper] || upper;
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .trim();
}

function smartTitleCase(word) {
  if (!word || word.length === 0) return word;
  const clean = word.replace(/\./g, '').toUpperCase();
  const suffixes = ['JR', 'SR', 'II', 'III', 'IV', 'V'];
  if (suffixes.includes(clean)) return clean + (word.endsWith('.') ? '.' : '');
  if (/^[A-Z]\.?$/i.test(word)) return word.toUpperCase().replace(/([A-Z])$/, '$1.');
  if (/^[A-Z]\.[A-Z]\.?$/i.test(word)) return word.toUpperCase();
  if (/^(De')[A-Z]/i.test(word)) {
    return "De'" + word.substring(3, 4).toUpperCase() + word.substring(4).toLowerCase();
  }
  if (/^(Mc)/i.test(word) && word.length > 2) {
    return 'Mc' + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
  }
  if (/^(O')/i.test(word) && word.length > 2) {
    return "O'" + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseName(str) {
  if (!str) return '';
  return str.split(/(\s+|-)/g).map(part => {
    if (part === ' ' || part === '-' || part === '') return part;
    return smartTitleCase(part);
  }).join('');
}

function parseOurladsName(rawText) {
  if (!rawText) return null;
  let text = rawText.trim();
  text = text.replace(/\s+/g, ' ');

  const suffixMatch = text.match(/^(.+?)\s+(?:\d+\/\d+|[A-Z]{1,2}\d{2}|[A-Z]{1,2}\/[A-Za-z]{1,4})$/);
  let namePart = suffixMatch ? suffixMatch[1].trim() : text;

  const commaIdx = namePart.indexOf(',');
  if (commaIdx === -1) return null;

  let lastName = namePart.substring(0, commaIdx).trim();
  let firstName = namePart.substring(commaIdx + 1).trim();

  lastName = titleCaseName(lastName);
  firstName = titleCaseName(firstName);

  return normalizeName(`${firstName} ${lastName}`);
}

function buildMatchKey(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[''`´\u2018\u2019\u201A\u201B]/g, '')
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?\s*$/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMatchKeyWithSuffix(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[''`´\u2018\u2019\u201A\u201B]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPositionPage(pos) {
  const url = `${OURLADS_BASE}/${pos}`;
  console.log(`  Fetching ${url}...`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; StatChasers/1.0)',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function parseDepthChartPage(html, fantasyPos) {
  const $ = cheerio.load(html);
  const results = [];

  const table = $('table').filter((_, el) => {
    const headerRow = $(el).find('tr').first();
    const cells = headerRow.find('th, td');
    let hasTeamCol = false;
    let hasPosCol = false;
    cells.each((_, cell) => {
      const text = $(cell).text().trim().toLowerCase();
      if (text === 'team') hasTeamCol = true;
      if (text === 'pos') hasPosCol = true;
    });
    return hasTeamCol && hasPosCol;
  }).first();

  if (!table.length) {
    console.warn(`  No depth chart table found for ${fantasyPos}`);
    return results;
  }

  let currentTeam = null;

  table.find('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const teamCell = cells.eq(0);
    const teamImg = teamCell.find('img');
    if (teamImg.length) {
      const imgSrc = teamImg.attr('src') || '';
      const match = imgSrc.match(/logo_thumb_([A-Z0-9]+)\./i);
      if (match) {
        currentTeam = normalizeTeamFromOurlads(match[1]);
      }
    }

    if (!currentTeam) return;
    if (!NFL_TEAMS.includes(currentTeam)) return;

    const posText = cells.eq(1).text().trim();
    if (!posText) return;

    const divisionHeaders = ['AFC East', 'AFC North', 'AFC South', 'AFC West',
      'NFC East', 'NFC North', 'NFC South', 'NFC West'];
    if (divisionHeaders.some(h => cells.eq(0).text().includes(h))) return;

    const headerTexts = ['Team', 'Pos'];
    if (headerTexts.includes(posText)) return;

    const players = [];
    for (let i = 3; i < cells.length; i += 2) {
      const playerCell = cells.eq(i);
      const linkEl = playerCell.find('a');
      let playerName = '';
      if (linkEl.length) {
        playerName = linkEl.text().trim();
      } else {
        playerName = playerCell.text().trim();
      }
      if (playerName) {
        const parsed = parseOurladsName(playerName);
        if (parsed) {
          const jersey = (i > 0) ? cells.eq(i - 1).text().trim() : '';
          players.push({
            name: parsed,
            jersey: jersey || null,
            depth_order: players.length + 1,
          });
        }
      }
    }

    if (players.length > 0) {
      const ourladsPos = fantasyPos === 'PK' ? 'K' : fantasyPos;
      results.push({
        team: currentTeam,
        ourlads_role: posText,
        fantasy_position: ourladsPos === 'K' ? 'K' : (posText === 'LWR' || posText === 'RWR' || posText === 'SWR' ? 'WR' : ourladsPos),
        rank_label: posText === 'PK' ? 'K' : posText,
        players,
      });
    }
  });

  return results;
}

function matchToSleeperPlayers(depthChartEntries, sleeperPlayers) {
  const playersByTeamAndKey = {};
  const playersByTeamAndFullKey = {};
  for (const p of sleeperPlayers) {
    const team = normalizeTeam(p.team);
    if (!team || team === 'FA') continue;
    const key = buildMatchKey(p.name);
    const fullKey = buildMatchKeyWithSuffix(p.name);
    if (!key) continue;
    if (!playersByTeamAndKey[team]) playersByTeamAndKey[team] = {};
    if (!playersByTeamAndKey[team][key]) playersByTeamAndKey[team][key] = [];
    playersByTeamAndKey[team][key].push(p);
    if (!playersByTeamAndFullKey[team]) playersByTeamAndFullKey[team] = {};
    if (!playersByTeamAndFullKey[team][fullKey]) playersByTeamAndFullKey[team][fullKey] = [];
    playersByTeamAndFullKey[team][fullKey].push(p);
  }

  const playersByKey = {};
  for (const p of sleeperPlayers) {
    const key = buildMatchKey(p.name);
    if (!key) continue;
    if (!playersByKey[key]) playersByKey[key] = [];
    playersByKey[key].push(p);
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedNames = [];

  for (const entry of depthChartEntries) {
    for (const player of entry.players) {
      const searchKey = buildMatchKey(player.name);
      const searchFullKey = buildMatchKeyWithSuffix(player.name);
      if (!searchKey) continue;

      let candidates = playersByTeamAndKey[entry.team]?.[searchKey] || [];

      if (candidates.length === 0) {
        candidates = playersByTeamAndFullKey[entry.team]?.[searchFullKey] || [];
      }

      if (candidates.length === 0) {
        const parts = searchKey.split(' ');
        const lastNameKey = parts[parts.length - 1];
        const firstNameKey = parts[0];
        if (playersByTeamAndKey[entry.team]) {
          for (const [key, players] of Object.entries(playersByTeamAndKey[entry.team])) {
            const keyParts = key.split(' ');
            const keyLast = keyParts[keyParts.length - 1];
            const keyFirst = keyParts[0];
            if (keyLast === lastNameKey && keyFirst === firstNameKey) {
              candidates = players;
              break;
            }
          }
        }
      }

      if (candidates.length === 0) {
        const allTeamCandidates = playersByKey[searchKey] || [];
        if (allTeamCandidates.length === 1) {
          candidates = allTeamCandidates;
        }
      }

      if (candidates.length > 0) {
        const posMatch = candidates.find(c => c.position === entry.fantasy_position);
        const best = posMatch || candidates[0];
        player.sleeper_id = best.id;
        player.sleeper_name = best.name;
        player.sleeper_slug = best.slug;
        matched++;
      } else {
        unmatched++;
        unmatchedNames.push(`${player.name} (${entry.team} ${entry.rank_label})`);
      }
    }
  }

  console.log(`  Matched: ${matched}, Unmatched: ${unmatched}`);
  if (unmatchedNames.length > 0 && unmatchedNames.length <= 50) {
    console.log(`  Unmatched players: ${unmatchedNames.join(', ')}`);
  } else if (unmatchedNames.length > 50) {
    console.log(`  Unmatched players (first 50): ${unmatchedNames.slice(0, 50).join(', ')}`);
    console.log(`  ... and ${unmatchedNames.length - 50} more`);
  }

  return depthChartEntries;
}

async function main() {
  const dataDir = SC_DATA_DIR;
  const playersPath = path.join(dataDir, 'players.json');

  if (!fs.existsSync(playersPath)) {
    console.error('data/players.json not found. Run buildPlayersIndex.js first.');
    process.exit(1);
  }

  const sleeperPlayers = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
  console.log(`Loaded ${sleeperPlayers.length} Sleeper players for matching`);

  const allEntries = [];

  for (const pos of POSITIONS_TO_FETCH) {
    console.log(`\nProcessing ${pos} depth charts...`);
    try {
      const html = await fetchPositionPage(pos);
      const entries = parseDepthChartPage(html, pos);
      console.log(`  Found ${entries.length} depth chart rows for ${pos}`);
      allEntries.push(...entries);
    } catch (err) {
      console.error(`  Error fetching ${pos}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nTotal depth chart entries: ${allEntries.length}`);

  const teamsFound = new Set(allEntries.map(e => e.team));
  const missingTeams = NFL_TEAMS.filter(t => !teamsFound.has(t));
  if (missingTeams.length > 0) {
    console.warn(`  WARNING: Missing depth chart data for teams: ${missingTeams.join(', ')}`);
  }
  if (allEntries.length < 100) {
    console.error(`  ERROR: Only ${allEntries.length} entries found (expected ~228). OurLads page structure may have changed.`);
    console.error('  Skipping depth chart output to avoid corrupting data.');
    process.exit(1);
  }
  console.log(`  Sanity check passed: ${teamsFound.size}/32 teams, ${allEntries.length} entries`);

  console.log('\nMatching to Sleeper players...');
  matchToSleeperPlayers(allEntries, sleeperPlayers);

  const byTeam = {};
  for (const entry of allEntries) {
    if (!byTeam[entry.team]) byTeam[entry.team] = [];
    byTeam[entry.team].push({
      role: entry.rank_label,
      fantasy_position: entry.fantasy_position,
      players: entry.players.map(p => ({
        name: p.name,
        depth_order: p.depth_order,
        sleeper_id: p.sleeper_id || null,
        sleeper_name: p.sleeper_name || null,
        sleeper_slug: p.sleeper_slug || null,
      })),
    });
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: 'ourlads.com',
    teams: byTeam,
  };

  const outPath = path.join(dataDir, 'depth_charts.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote depth charts to ${outPath}`);

  let teamCount = 0;
  let roleCount = 0;
  let playerCount = 0;
  for (const [team, roles] of Object.entries(byTeam)) {
    teamCount++;
    for (const role of roles) {
      roleCount++;
      playerCount += role.players.length;
    }
  }
  console.log(`Summary: ${teamCount} teams, ${roleCount} roles, ${playerCount} total players`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
