import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StatChasers/1.0)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function normalizeSlug(name) {
  return name
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  console.log('Fetching KeepTradeCut dynasty rankings...');
  const html = await fetchPage('https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE|K&format=1');

  const match = html.match(/var playersArray = (\[.*?\]);/s);
  if (!match) {
    console.error('Could not find playersArray in KTC HTML');
    process.exit(1);
  }

  const ktcPlayers = JSON.parse(match[1]);
  console.log(`Found ${ktcPlayers.length} KTC players`);

  const indexedData = JSON.parse(fs.readFileSync(path.join(SC_DATA_DIR, 'indexed_players.json'), 'utf8'));
  const playersData = JSON.parse(fs.readFileSync(path.join(SC_DATA_DIR, 'players.json'), 'utf8'));

  const ourSlugToId = {};
  Object.entries(indexedData.slugs).forEach(([id, slug]) => {
    ourSlugToId[slug] = id;
  });

  const idToSlug = {};
  Object.entries(indexedData.slugs).forEach(([id, slug]) => {
    idToSlug[id] = slug;
  });

  const nameToSlug = {};
  Object.values(playersData).forEach(p => {
    if (p.slug) {
      nameToSlug[normalizeSlug(p.full_name || `${p.first_name}-${p.last_name}`)] = p.slug;
    }
  });

  const dynastyData = {};
  let matched = 0;
  let unmatched = 0;

  for (const ktc of ktcPlayers) {
    const ktcSlugBase = ktc.slug.replace(/-\d+$/, '');
    const ktcNameSlug = normalizeSlug(ktc.playerName);

    let ourSlug = null;
    if (ourSlugToId[ktcSlugBase]) {
      ourSlug = ktcSlugBase;
    } else if (ourSlugToId[ktcNameSlug]) {
      ourSlug = ktcNameSlug;
    } else if (nameToSlug[ktcNameSlug]) {
      ourSlug = nameToSlug[ktcNameSlug];
    } else if (nameToSlug[ktcSlugBase]) {
      ourSlug = nameToSlug[ktcSlugBase];
    }

    if (!ourSlug || !ourSlugToId[ourSlug]) continue;

    const v = ktc.oneQBValues;
    const sf = ktc.superflexValues;
    if (!v) continue;

    const ageTier = getAgeCurveTier(ktc.position, ktc.age);

    dynastyData[ourSlug] = {
      rank: v.rank,
      positionalRank: v.positionalRank,
      value: v.value,
      overallTier: v.overallTier,
      positionalTier: v.positionalTier,
      trend30: v.overallTrend || 0,
      trend7: v.overall7DayTrend || 0,
      posTrend30: v.positionalTrend || 0,
      posTrend7: v.positional7DayTrend || 0,
      age: ktc.age,
      position: ktc.position,
      team: ktc.team,
      adp: v.adp || null,
      startupAdp: v.startupAdp || null,
      tradeCount: v.tradeCount || 0,
      ageCurveTier: ageTier,
      ktcSlug: ktc.slug,
      draftRound: ktc.pickRound || null,
      draftPick: ktc.pickNum || null,
      draftYear: ktc.draftYear || null,
      sf: sf ? {
        rank: sf.rank,
        positionalRank: sf.positionalRank,
        value: sf.value,
        overallTier: sf.overallTier,
        positionalTier: sf.positionalTier,
        trend30: sf.overallTrend || 0,
        trend7: sf.overall7DayTrend || 0,
        posTrend30: sf.positionalTrend || 0,
        posTrend7: sf.positional7DayTrend || 0,
        adp: sf.adp || null,
        startupAdp: sf.startupAdp || null,
        tradeCount: sf.tradeCount || 0,
      } : null,
    };
    matched++;
  }

  unmatched = ktcPlayers.length - matched;
  console.log(`Matched ${matched} players, ${unmatched} unmatched`);

  const outPath = path.join(SC_DATA_DIR, 'dynasty_rankings.json');
  fs.writeFileSync(outPath, JSON.stringify(dynastyData, null, 2));
  console.log(`Wrote ${outPath} (${Object.keys(dynastyData).length} entries)`);
}

function getAgeCurveTier(position, age) {
  if (!position || !age) return 'Unknown';
  if (position === 'QB') {
    if (age < 25) return 'Rising';
    if (age <= 32) return 'Prime';
    if (age <= 36) return 'Aging';
    return 'Declining';
  }
  if (position === 'RB') {
    if (age < 23) return 'Rising';
    if (age <= 26) return 'Prime';
    if (age <= 28) return 'Aging';
    return 'Declining';
  }
  if (position === 'WR') {
    if (age < 24) return 'Rising';
    if (age <= 29) return 'Prime';
    if (age <= 31) return 'Aging';
    return 'Declining';
  }
  if (position === 'TE') {
    if (age < 25) return 'Rising';
    if (age <= 30) return 'Prime';
    if (age <= 32) return 'Aging';
    return 'Declining';
  }
  return 'Unknown';
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
