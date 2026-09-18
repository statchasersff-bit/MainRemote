/**
 * outlookPrep.js — build per-player input files for the 2026 outlook workflow.
 *
 * Writes data/.outlook_parts/<slug>.in.json for every eligible QB/RB/WR/TE
 * player that is NOT already present (and not manually edited) in
 * data/fantasy_outlook_2026.json. Each input bundles the player identity plus
 * our advanced stats across recent seasons (most-recent-first) so a synthesis
 * agent never has to load the big advanced_stats files.
 *
 * Usage: node scripts/outlookPrep.js [--force]
 *   --force  also (re)write inputs for players that already have an outlook
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = SC_DATA_DIR;
const ADV = path.resolve(DATA, 'advanced_stats');
const PARTS = path.resolve(DATA, '.outlook_parts');

const SEASON = Number(process.env.OUTLOOK_SEASON || 2026);
const ADV_SEASONS = [SEASON - 1, SEASON - 2, SEASON - 3];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const force = process.argv.includes('--force');

const players = JSON.parse(fs.readFileSync(path.resolve(DATA, 'players.json'), 'utf-8'));
const indexed = JSON.parse(fs.readFileSync(path.resolve(DATA, 'indexed_players.json'), 'utf-8'));
const outFile = path.resolve(DATA, 'fantasy_outlook_2026.json');
const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf-8')) : {};
const bySlug = new Map(players.map(p => [p.slug, p]));

const advCache = new Map();
function loadAdv(pos, season) {
  const key = `${pos.toLowerCase()}_${season}`;
  if (advCache.has(key)) return advCache.get(key);
  const f = path.resolve(ADV, `${key}.json`);
  let rows = [];
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    rows = Array.isArray(d) ? d : d.rows || [];
  }
  advCache.set(key, rows);
  return rows;
}

if (!fs.existsSync(PARTS)) fs.mkdirSync(PARTS, { recursive: true });

let written = 0, skipped = 0;
const worklist = [];
for (const slug of indexed.slugs) {
  const p = bySlug.get(slug);
  if (!p || !POSITIONS.includes(p.position)) { skipped++; continue; }
  const prior = existing[p.id];
  if (prior && (prior.edited || !force)) { skipped++; continue; }

  const advStats = [];
  for (const season of ADV_SEASONS) {
    const row = loadAdv(p.position, season).find(r => String(r.playerId) === String(p.id));
    if (row) advStats.push(row);
  }
  const input = {
    id: p.id, slug, name: p.name, position: p.position, team: p.team || 'FA',
    season: SEASON, advStats,
    fantasyProsUrl: `https://www.fantasypros.com/nfl/players/${slug}.php`,
    cbsUrl: `https://www.cbssports.com/fantasy/football/news/2026-outlook-${slug}/`,
  };
  fs.writeFileSync(path.resolve(PARTS, `${slug}.in.json`), JSON.stringify(input));
  worklist.push({ slug, position: p.position, hasAdv: advStats.length > 0 });
  written++;
}

fs.writeFileSync(path.resolve(PARTS, '_worklist.json'), JSON.stringify(worklist, null, 0));
const byPos = worklist.reduce((a, w) => (a[w.position] = (a[w.position] || 0) + 1, a), {});
console.log(`Wrote ${written} input files, skipped ${skipped}.`);
console.log(`By position: ${JSON.stringify(byPos)}`);
console.log(`No advanced stats: ${worklist.filter(w => !w.hasAdv).length}`);
console.log(`Worklist: data/.outlook_parts/_worklist.json`);
