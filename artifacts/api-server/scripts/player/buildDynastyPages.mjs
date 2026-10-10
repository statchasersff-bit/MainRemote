#!/usr/bin/env node
/**
 * Which players have a dynasty value page at statchasers.com/dynasty/players/.
 *
 * The player hub's tab strip and its trade-value block link to
 * /dynasty/players/{slug}/ only when that page exists (the SEO brief of
 * 2026-10-10: "only show Dynasty value when that page exists"). The dynasty
 * pages are the Dynasty Command plugin's, spelled from the player's name its
 * own way ("ja-marr-chase" where this app says "jamarr-chase"), so the list
 * is read off the live index page and matched to this app's players by name.
 * Nothing in the render fetches: the result is stored, like every other
 * checked dataset (mak: store verified data).
 *
 *   node scripts/player/buildDynastyPages.mjs
 *
 * Writes data/player/dynasty_pages.json: { generated_at, source, count,
 * pages: { "<our slug>": "<dynasty slug>" } }. Re-run when the dynasty index
 * changes; the hub drops the link for anyone who left it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "..", "data", "player");
const INDEX_URL = "https://statchasers.com/dynasty/players/";
const OUT = path.join(dataDir, "dynasty_pages.json");

/** "Ja'Marr Chase" -> "jamarrchase": letters and digits only, for matching. */
function nameKey(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const res = await fetch(INDEX_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; StatChasers/1.0)" } });
if (!res.ok) throw new Error(`${INDEX_URL} answered ${res.status}`);
const html = await res.text();

// `<a href="https://statchasers.com/dynasty/players/josh-allen/">Josh Allen …`
const found = new Map();
for (const m of html.matchAll(/<a[^>]+href="[^"]*\/dynasty\/players\/([a-z0-9-]+)\/"[^>]*>([^<]*)/g)) {
  const slug = m[1];
  const name = m[2].replace(/\s+/g, " ").trim();
  // A malformed duplicate ("antonio-williams-") beside the real address.
  if (!name || slug.endsWith("-")) continue;
  found.set(slug, name);
}
if (found.size === 0) throw new Error("no player links on the dynasty index");

const players = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json"), "utf8"));
const byKey = new Map();
for (const p of Object.values(players)) {
  if (!p?.slug || !p?.name) continue;
  const key = nameKey(p.name);
  const list = byKey.get(key) ?? [];
  list.push(p);
  byKey.set(key, list);
}

// Two players of one name: the one the dynasty rankings know is the one with
// a dynasty page, then the active skill player.
const ranked = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, "dynasty_rankings.json"), "utf8"))));

const pages = {};
const unmatched = [];
const ambiguous = [];
for (const [dslug, name] of found) {
  const candidates = byKey.get(nameKey(name)) ?? byKey.get(nameKey(dslug.replace(/-/g, " "))) ?? [];
  if (candidates.length === 1) {
    pages[candidates[0].slug] = dslug;
  } else if (candidates.length > 1) {
    const known = candidates.filter((p) => ranked.has(p.slug));
    const active = candidates.filter((p) => p.status === "Active" && ["QB", "RB", "WR", "TE"].includes(p.position));
    const rostered = active.filter((p) => p.team && p.team !== "FA");
    const pick = known.length === 1 ? known[0] : active.length === 1 ? active[0] : rostered.length === 1 ? rostered[0] : null;
    if (pick) pages[pick.slug] = dslug;
    else ambiguous.push(`${name} (${dslug}): ${candidates.map((p) => p.slug).join(", ")}`);
  } else {
    unmatched.push(`${name} (${dslug})`);
  }
}

const out = {
  generated_at: new Date().toISOString(),
  source: INDEX_URL,
  count: Object.keys(pages).length,
  pages: Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b))),
};
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${found.size} dynasty pages on the index, ${out.count} matched -> ${path.relative(process.cwd(), OUT)}`);
if (ambiguous.length) console.log(`ambiguous (${ambiguous.length}):\n  ${ambiguous.join("\n  ")}`);
if (unmatched.length) console.log(`unmatched (${unmatched.length}):\n  ${unmatched.join("\n  ")}`);
