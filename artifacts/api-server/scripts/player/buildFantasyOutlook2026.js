/**
 * buildFantasyOutlook2026.js
 *
 * Generates the "2026 Fantasy Outlook" narrative for players and saves it to
 * data/fantasy_outlook_2026.json so the Express API + WordPress plugin can read
 * stored text instead of generating it at render time.
 *
 * For each player it blends THREE sources into one original (non-plagiarized)
 * outlook:
 *   1. FantasyPros "Expert Note"  -> https://www.fantasypros.com/nfl/players/<slug>.php
 *   2. CBS Sports 2026 outlook    -> https://www.cbssports.com/fantasy/football/news/2026-outlook-<slug>/
 *   3. Our own advanced stats      -> data/advanced_stats/<pos>_<season>.json
 * The external sources are reduced to FACTS; our advanced stats are the spine.
 * A Claude synthesis step rewrites everything in an original voice.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/buildFantasyOutlook2026.js                 # all indexed players
 *   ANTHROPIC_API_KEY=sk-... node scripts/buildFantasyOutlook2026.js dak-prescott    # one player (merges + prints)
 *   ANTHROPIC_API_KEY=sk-... node scripts/buildFantasyOutlook2026.js --all --force   # regenerate everyone
 *
 * Flags:  --all  --force  --limit <n>  --print  --dry  --concurrency <n>
 * Env:    ANTHROPIC_API_KEY (required)  OUTLOOK_MODEL (default claude-opus-4-8)  OUTLOOK_SEASON (default 2026)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = SC_DATA_DIR;

// Minimal .env loader (no dependency): populate process.env from a .env file at
// the repo root if present, without overriding already-set vars. Lets the key
// "just work" whether it's a Replit Secret or dropped into .env.
(function loadDotenv() {
  const envPath = path.resolve(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

// No plugin mirror. The old self-contained plugin bundled this file and read it
// from wp-uploads; [statchasers_player] reads a server-rendered fragment, so the
// API's own copy below is the only one there is.
const PLUGIN_DATA_DIRS = [];
const PLAYERS_FILE = path.resolve(DATA_DIR, 'players.json');
const INDEXED_FILE = path.resolve(DATA_DIR, 'indexed_players.json');
const ADV_DIR = path.resolve(DATA_DIR, 'advanced_stats');
const OUT_FILE = path.resolve(DATA_DIR, 'fantasy_outlook_2026.json');

const SEASON = Number(process.env.OUTLOOK_SEASON || 2026);
const ADV_SEASONS = [SEASON - 1, SEASON - 2, SEASON - 3]; // 2025, 2024, 2023
const MODEL = process.env.OUTLOOK_MODEL || 'claude-opus-4-8';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const FETCH_DELAY_MS = 800;     // politeness between scrape requests
const MAX_SOURCE_CHARS = 6000;  // cap text handed to the model per source
const UA = 'Mozilla/5.0 (compatible; StatchasersOutlookBot/1.0; +https://statchasers.com)';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { slugs: [], all: false, force: false, print: false, dry: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--print') opts.print = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]) || 0;
    else if (a.startsWith('--')) console.warn(`Unknown flag: ${a}`);
    else opts.slugs.push(a);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, html: await res.text() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Pull the longest meaningful text from a set of candidate selectors, else fall back to <p> text. */
function extractText($, selectors) {
  let best = '';
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > best.length) best = t;
    });
    if (best.length > 400) break; // good enough
  }
  if (best.length < 200) {
    // fall back to concatenating reasonably long paragraphs
    const paras = [];
    $('p').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 60) paras.push(t);
    });
    best = paras.join('\n');
  }
  return best.slice(0, MAX_SOURCE_CHARS).trim();
}

async function scrapeFantasyPros(slug) {
  const url = `https://www.fantasypros.com/nfl/players/${slug}.php`;
  const r = await fetchHtml(url);
  if (!r.ok) return { url, ok: false, reason: r.status || r.error, text: '' };
  const $ = cheerio.load(r.html);
  $('script, style, noscript').remove();
  const text = extractText($, [
    '.player-news-item__body',
    '#main-container .content',
    '.player-page-content',
    '.single-player-bio',
    'article',
  ]);
  return { url, ok: text.length > 0, text };
}

async function scrapeCbs(slug) {
  const url = `https://www.cbssports.com/fantasy/football/news/2026-outlook-${slug}/`;
  const r = await fetchHtml(url);
  if (!r.ok) return { url, ok: false, reason: r.status || r.error, text: '' };
  const $ = cheerio.load(r.html);
  $('script, style, noscript, aside, figure').remove();
  const text = extractText($, [
    '.Article-bodyContent',
    '.article-body',
    'section.article-content',
    'article',
  ]);
  return { url, ok: text.length > 0, text };
}

// ---------------------------------------------------------------------------
// Our advanced stats (the proprietary spine)
// ---------------------------------------------------------------------------

const advCache = new Map(); // `${pos}_${season}` -> rows[]

function loadAdv(pos, season) {
  const key = `${pos.toLowerCase()}_${season}`;
  if (advCache.has(key)) return advCache.get(key);
  const file = path.resolve(ADV_DIR, `${key}.json`);
  let rows = [];
  if (fs.existsSync(file)) {
    const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
    rows = Array.isArray(d) ? d : d.rows || [];
  }
  advCache.set(key, rows);
  return rows;
}

/** Collect our advanced stats for a player across the recent seasons. */
function collectAdvancedStats(player) {
  const out = [];
  for (const season of ADV_SEASONS) {
    const rows = loadAdv(player.position, season);
    const row = rows.find(r => String(r.playerId) === String(player.id));
    if (row) out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthesis via Claude (raw HTTPS, no SDK — matches this repo's build scripts)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write original "2026 Fantasy Outlook" blurbs for an NFL fantasy-football site.

You are given, for one player: (a) our proprietary advanced stats, (b) facts scraped from a FantasyPros expert note, and (c) facts scraped from a CBS Sports 2026 outlook.

Rules:
- Our advanced stats are the SPINE of the analysis. Lead with them and let them carry the argument.
- Treat FantasyPros and CBS as FACT inputs only. Extract their substance (role, weapons, regression angles, draft value, injuries) but NEVER reuse their wording.
- ANTI-PLAGIARISM: do not copy any run of ~6 or more consecutive words from the sources. Rephrase every idea in your own voice.
- Be concrete and numeric where our stats allow (EPA, success rate, finish rank, TD rate, games, etc.). Do not invent numbers that are not in the provided data.
- AGE: the PLAYER line gives the player's authoritative age. If you reference the player's age at all, use exactly that number ("now 31", "at 31", "31-year-old"). Never state a different age, and never infer age from the scraped sources — they may be stale.
- Two short paragraphs, ~110-170 words total. Confident analyst tone, no hedging filler, no headers, no bullet points.
- Do not mention "FantasyPros", "CBS", "sources", or that this was generated.

Return ONLY a JSON object, no markdown fence, with keys:
  "headline": a punchy <=12-word summary,
  "body": the two-paragraph outlook as a single string (use \\n\\n between paragraphs).`;

function buildUserPrompt(player, advStats, fp, cbs) {
  const lines = [];
  lines.push(`PLAYER: ${player.name} — ${player.position}, ${player.team || 'FA'} (season ${SEASON})${player.age ? `, age ${player.age} (authoritative — use this exact age if you mention age)` : ''}`);
  lines.push('');
  lines.push('OUR ADVANCED STATS (most recent first; this is the spine):');
  lines.push(advStats.length ? JSON.stringify(advStats) : '(none available)');
  lines.push('');
  lines.push('FANTASYPROS EXPERT NOTE (facts only — do not copy wording):');
  lines.push(fp.ok ? fp.text : '(unavailable)');
  lines.push('');
  lines.push('CBS 2026 OUTLOOK (facts only — do not copy wording):');
  lines.push(cbs.ok ? cbs.text : '(unavailable)');
  return lines.join('\n');
}

async function synthesize(player, advStats, fp, cbs) {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(player, advStats, fp, cbs) }],
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1);
      console.warn(`  API ${res.status}, retrying in ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('model refused to generate outlook');
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return parseModelJson(text);
  }
  throw new Error('exhausted API retries');
}

function parseModelJson(text) {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  const obj = JSON.parse(s);
  if (!obj.body) throw new Error('model output missing "body"');
  return { headline: obj.headline || '', body: obj.body };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY is required.');
    process.exit(1);
  }
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error('players.json not found. Run buildPlayersIndex.js first.');
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
  const bySlug = new Map(players.map(p => [p.slug, p]));

  // Resolve which slugs to process.
  let slugs;
  if (opts.slugs.length) {
    slugs = opts.slugs;
  } else {
    const indexed = JSON.parse(fs.readFileSync(INDEXED_FILE, 'utf-8'));
    slugs = indexed.slugs || [];
  }
  if (opts.limit) slugs = slugs.slice(0, opts.limit);

  // Load existing output; preserve manual edits + skip already-done unless --force.
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) : {};

  let done = 0, skipped = 0, failed = 0;
  for (const slug of slugs) {
    const player = bySlug.get(slug);
    if (!player) { console.warn(`- ${slug}: not in players.json, skipping`); skipped++; continue; }
    if (!POSITIONS.includes(player.position)) { skipped++; continue; }

    const prior = existing[player.id];
    if (prior && prior.edited) { console.log(`- ${slug}: manual edit preserved`); skipped++; continue; }
    if (prior && !opts.force) { skipped++; continue; }

    process.stdout.write(`• ${slug} (${player.position}, ${player.team})... `);
    try {
      const [fp, cbs] = await Promise.all([scrapeFantasyPros(slug), scrapeCbs(slug)]);
      const advStats = collectAdvancedStats(player);
      if (!advStats.length && !fp.ok && !cbs.ok) {
        console.log('no sources, skipped');
        skipped++;
        await sleep(FETCH_DELAY_MS);
        continue;
      }

      const { headline, body } = await synthesize(player, advStats, fp, cbs);
      const record = {
        slug,
        name: player.name,
        position: player.position,
        team: player.team,
        season: SEASON,
        headline,
        body,
        keyStats: advStats[0] || null,
        sources: [
          { name: 'FantasyPros', url: fp.url, used: fp.ok },
          { name: 'CBS Sports', url: cbs.url, used: cbs.ok },
          { name: 'Statchasers advanced stats', used: advStats.length > 0 },
        ],
        generatedAt: new Date().toISOString().slice(0, 10),
        model: MODEL,
        edited: false,
      };
      existing[player.id] = record;
      done++;

      const srcTag = `[FP:${fp.ok ? 'y' : 'n'} CBS:${cbs.ok ? 'y' : 'n'} ADV:${advStats.length}]`;
      console.log(`ok ${srcTag}`);
      if (opts.print) console.log(`\n  ${headline}\n  ${body.replace(/\n/g, '\n  ')}\n`);

      if (!opts.dry) fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 0)); // incremental save
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
    await sleep(FETCH_DELAY_MS);
  }

  // Mirror the generated file into plugin bundled data dir(s) so the plugin sync
  // picks it up — same place bios.json / dynasty_rankings.json are shipped from.
  if (!opts.dry && fs.existsSync(OUT_FILE)) {
    for (const dir of PLUGIN_DATA_DIRS) {
      if (!fs.existsSync(dir)) continue;
      fs.copyFileSync(OUT_FILE, path.resolve(dir, 'fantasy_outlook_2026.json'));
      console.log(`Copied to plugin: ${path.relative(ROOT_DIR, dir)}/fantasy_outlook_2026.json`);
    }
  }

  console.log(`\nDone. generated=${done} skipped=${skipped} failed=${failed}`);
  if (opts.dry) console.log('(dry run — nothing written)');
  else console.log(`Output: ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
