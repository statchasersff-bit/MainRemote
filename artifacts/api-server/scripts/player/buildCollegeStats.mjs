/**
 * Build data/player/college_stats.json from CollegeFootballData.com.
 *
 *   CFBD_API_KEY=... node scripts/player/buildCollegeStats.mjs [--season 2026] [--cache <dir>] [--slug <slug> ...]
 *
 * For this season's rookies (Sleeper years_exp 0) at QB/RB/WR/TE with a page:
 * every college season we can match, and the final one's metrics ranked among
 * the qualified college players at his position. The Stats tab reads it for a
 * rookie's "College final season" card and, before his first NFL game, for a
 * college career table (src/lib/player/stats-tab.ts).
 *
 * The key is free: register at https://collegefootballdata.com/key.
 * `--cache` keeps each API response on disk, so a rerun costs no calls.
 * CFBD_BASE overrides the API origin (tests point it at a stub).
 *
 * Players not matched are listed at the end: usually a school spelled
 * differently here than on CFBD (add it to SCHOOL_ALIASES in
 * collegeMatch.mjs) or an FCS school CFBD has no stats for.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { currentSeason } from "./season.mjs";
import { collapseRows, matchPlayer, qualifiedPool, rankFinal } from "./collegeMatch.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const season = Number(flag("--season")) || currentSeason();
const cacheDir = flag("--cache");
const onlySlugs = args.flatMap((a, i) => (args[i - 1] === "--slug" ? [a] : []));
const BASE = (process.env.CFBD_BASE || "https://api.collegefootballdata.com").replace(/\/$/, "");
const KEY = process.env.CFBD_API_KEY?.trim();

if (!KEY) {
  console.error("CFBD_API_KEY is not set. Register a free key at https://collegefootballdata.com/key");
  process.exit(1);
}

async function api(pathAndQuery) {
  const cacheFile = cacheDir ? path.join(cacheDir, pathAndQuery.replace(/[^a-z0-9]+/gi, "_") + ".json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`CFBD ${res.status} for ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (cacheFile) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(body));
  }
  return body;
}

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
};

/* ---- who: this season's rookies with a page ---- */

const dictionary = read("players.json", []);
const players = Array.isArray(dictionary) ? dictionary : Object.values(dictionary);
const indexed = new Set(read("indexed_players.json", {}).slugs ?? []);
const bioFacts = read("bio_facts.json", {});
const draft = read("draft.json", {});

const targets = players.filter((p) =>
  ["QB", "RB", "WR", "TE"].includes(p.position) &&
  (onlySlugs.length ? onlySlugs.includes(p.slug) : p.years_exp === 0 && indexed.has(p.slug)),
);
const finalSeason = season - 1;
console.log(`${targets.length} players; final college season ${finalSeason}`);

/* ---- what: every season a rookie might have played, 3 categories each ---- */

const rows = [];
for (let year = finalSeason - 6; year <= finalSeason; year += 1) {
  for (const category of ["passing", "rushing", "receiving"]) {
    rows.push(...(await api(`/stats/player/season?year=${year}&category=${category}`)));
  }
}
const all = collapseRows(rows);

// PPA ("predicted points added", CFBD's EPA) for the final season, joined on id.
const ppaRows = await api(`/ppa/players/season?year=${finalSeason}`);
const ppaById = new Map(
  (ppaRows ?? []).map((r) => [String(r.id), typeof r.averagePPA?.all === "number" ? r.averagePPA.all : null]),
);
for (const p of all) if (p.season === finalSeason) p.ppa = ppaById.get(p.id) ?? null;

/* ---- match and rank ---- */

const out = {};
const missed = [];
for (const p of targets) {
  const school = bioFacts[p.slug]?.college ?? draft[p.slug]?.college ?? null;
  if (!school) {
    missed.push(`${p.name} (${p.position}): no college on file`);
    continue;
  }
  const seasons = matchPlayer({ name: p.name, position: p.position, school, finalSeason }, all);
  if (!seasons) {
    missed.push(`${p.name} (${p.position}, ${school}): no ${finalSeason} match`);
    continue;
  }
  const last = seasons[seasons.length - 1];
  const me = all.find((x) => x.season === finalSeason && x.id === last.cfbdId);
  const pool = qualifiedPool(all, finalSeason, p.position);
  out[p.id] = {
    name: p.name,
    school: last.school,
    finalSeason,
    seasons: seasons.map(({ cfbdId, ...rest }) => rest),
    final: rankFinal(me, pool, p.position),
    poolSize: pool.length,
  };
}

const file = path.join(DATA_DIR, "college_stats.json");
fs.writeFileSync(
  file,
  JSON.stringify({ source: "CollegeFootballData.com", season, builtAt: new Date().toISOString(), players: out }, null, 1) + "\n",
);
console.log(`wrote ${Object.keys(out).length} players to ${path.relative(process.cwd(), file)}`);
if (missed.length) console.log(`not matched (${missed.length}):\n  ${missed.join("\n  ")}`);
