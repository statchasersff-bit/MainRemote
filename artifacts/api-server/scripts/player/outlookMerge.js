/**
 * outlookMerge.js — fold per-player agent outputs into the canonical outlook file.
 *
 * Reads every data/.outlook_parts/<slug>.out.json produced by synthesis agents
 * and merges them into data/player/fantasy_outlook_2026.json (keyed by player
 * id), preserving any record marked edited:true.
 *
 * Idempotent: safe to run repeatedly as more .out.json files appear.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = SC_DATA_DIR;
const PARTS = path.resolve(DATA, '.outlook_parts');
const OUT_FILE = path.resolve(DATA, 'fantasy_outlook_2026.json');
// The mirror into the old plugin's bundled data dir is gone. That plugin
// shipped 12MB of JSON inside the zip and read it from wp-uploads; the
// shortcode reads a server-rendered fragment instead, so the API's own copy of
// this file is the only one there is. See wordpress-plugin/README.md.

const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) : {};

let merged = 0, preserved = 0, bad = 0;
for (const f of fs.readdirSync(PARTS)) {
  if (!f.endsWith('.out.json')) continue;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.resolve(PARTS, f), 'utf-8')); }
  catch { bad++; continue; }
  if (!rec || !rec.id || !rec.body || !rec.headline) { bad++; continue; }
  const prior = existing[rec.id];
  if (prior && prior.edited) { preserved++; continue; } // never clobber a manual edit
  existing[rec.id] = rec;
  merged++;
}

// Sort keys numerically for a stable, diff-friendly file (matches id ordering).
const sorted = {};
for (const k of Object.keys(existing).sort((a, b) => Number(a) - Number(b))) sorted[k] = existing[k];

fs.writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 0));
console.log(`Merged ${merged} new/updated, preserved ${preserved} edited, skipped ${bad} bad.`);
console.log(`Total records: ${Object.keys(sorted).length}`);
console.log(`Wrote ${OUT_FILE}.`);
