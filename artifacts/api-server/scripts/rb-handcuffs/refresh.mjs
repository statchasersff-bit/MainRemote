/**
 * Refresh the RB handcuff board's current-situation inputs.
 *
 *   node scripts/rb-handcuffs/refresh.mjs
 *
 * Writes `data/rb-handcuffs/depth.json`: every team's RB1/RB2/RB3 from
 * Ourlads, and for every running back on those charts his Sleeper id, current
 * age and current injury status. The server scores the board from that file
 * plus the committed 2025 stats and injury history, so running this and
 * committing the result is the whole refresh. Run it weekly in season, after
 * Tuesday's transactions, and again whenever a starter goes down.
 *
 * Separate from scripts/player/buildDepthCharts.js on purpose. That builder
 * feeds the player pages' index and slugs, so re-running it moves pages; this
 * one reads the same Ourlads RB page and touches nothing but its own file.
 *
 * The Ourlads parser is the standalone app's (server/depth-chart-resolver.ts),
 * unchanged: Ourlads was that app's depth-chart source too.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "..", "data", "rb-handcuffs", "depth.json");

const OURLADS_URL = "https://www.ourlads.com/nfldepthcharts/depthchartpos/RB";
const SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Ourlads' codes to the ones the 2025 stats file uses. */
const TEAM_FIX = { ARZ: "ARI", WSH: "WAS", JAC: "JAX", LA: "LAR", RAM: "LAR" };

const ROMAN_SUFFIXES = new Set(["II", "III", "IV", "V"]);

/**
 * Ourlads prints some names in capitals; recase them, keeping initials and
 * suffixes. Each half of a hyphenated name on its own — the app's version
 * left "CROSKEY-MERRITT" in capitals.
 */
function recaseToken(token) {
  if (token.includes("-")) return token.split("-").map(recaseToken).join("-");
  if (!/^[A-Z.]+$/.test(token)) return token;
  const letters = token.replace(/\./g, "");
  if (ROMAN_SUFFIXES.has(letters) || letters.length <= 2) return token;
  let base = token[0] + token.slice(1).toLowerCase();
  if (base.startsWith("Mc") && base.length > 2) base = "Mc" + base[2].toUpperCase() + base.slice(3);
  return base;
}

/** "Cook III, James 22/2" → "James Cook III". */
function parseOurladsName(raw) {
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
  const comma = decoded.indexOf(",");
  if (comma < 0) return decoded;
  const last = decoded.slice(0, comma).trim();
  const first = decoded
    .slice(comma + 1)
    .trim()
    .split(/\s+/)
    .filter((w) => w && !w.includes("/") && !/\d/.test(w));
  return `${first.join(" ")} ${last}`.trim().split(/\s+/).map(recaseToken).join(" ");
}

/** One back known by two names. The engine's NAME_ALIASES, keyed normalised. */
const NAME_ALIASES = { "bam knight": "zonovan knight" };

/** The same normalisation the engine matches names with. */
export function normalizeName(name) {
  const key = String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[key] ?? key;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/** Every team's top three RBs, in Ourlads' order. First row per team wins. */
export function parseOurlads(html) {
  const rowRe = /<tr class='(?:row-dc-wht|row-dc-grey)'>([\s\S]*?)<\/tr>/g;
  const nameRe = /nfldepthcharts\/player\/\d+\/'[^>]*>([^<]+)<\/a>/g;
  const teams = {};
  let row;
  while ((row = rowRe.exec(html))) {
    const cell = row[1];
    const logo = cell.match(/logo_thumb_([A-Z]+)\.gif/);
    if (!logo) continue;
    const team = TEAM_FIX[logo[1]] ?? logo[1];
    if (teams[team]) continue;
    const names = [];
    nameRe.lastIndex = 0;
    let n;
    while (names.length < 3 && (n = nameRe.exec(cell))) names.push(parseOurladsName(n[1]));
    teams[team] = { rb1: names[0] ?? null, rb2: names[1] ?? null, rb3: names[2] ?? null };
  }
  return teams;
}

async function main() {
  const teams = parseOurlads(await fetchText(OURLADS_URL));
  const count = Object.keys(teams).length;
  if (count < 30) {
    throw new Error(`Ourlads gave ${count} teams; the page may have changed. Nothing written.`);
  }

  // Sleeper, for the id, the current age and the current injury status of each
  // back on those charts. Matched by name within the team, then by name alone
  // for a back Sleeper has not moved yet.
  const sleeper = JSON.parse(await fetchText(SLEEPER_URL));
  const byTeamName = new Map();
  const byName = new Map();
  for (const p of Object.values(sleeper)) {
    if (!p || p.position !== "RB") continue;
    const name = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    const key = normalizeName(name);
    const team = TEAM_FIX[p.team] ?? p.team;
    if (team) byTeamName.set(`${key}|${team}`, p);
    byName.set(key, byName.has(key) ? null : p);
  }

  const players = {};
  let unmatched = [];
  for (const [team, chart] of Object.entries(teams)) {
    for (const name of [chart.rb1, chart.rb2, chart.rb3]) {
      if (!name) continue;
      const key = normalizeName(name);
      const p = byTeamName.get(`${key}|${team}`) ?? byName.get(key) ?? null;
      if (!p) {
        unmatched.push(`${name} (${team})`);
        continue;
      }
      players[key] = {
        name,
        team,
        sleeperId: String(p.player_id),
        age: Number.isFinite(p.age) ? p.age : null,
        injuryStatus: p.injury_status ?? null,
        status: p.status ?? null,
      };
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    source: { depth: OURLADS_URL, players: SLEEPER_URL },
    teams: Object.fromEntries(Object.entries(teams).sort(([a], [b]) => a.localeCompare(b))),
    players: Object.fromEntries(Object.entries(players).sort(([a], [b]) => a.localeCompare(b))),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  const injured = Object.values(players).filter((p) => p.injuryStatus);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${count} teams, ${Object.keys(players).length} backs`);
  if (injured.length) {
    console.log(`  on the injury report: ${injured.map((p) => `${p.name} (${p.team}) ${p.injuryStatus}`).join(", ")}`);
  }
  if (unmatched.length) console.log(`  not in Sleeper (no age or status): ${unmatched.join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
