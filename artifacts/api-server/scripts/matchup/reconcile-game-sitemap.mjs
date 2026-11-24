// WEB-001 reconciliation: the completed games of a season, computed from the
// nflverse slate on its own, against every game URL the site's sitemaps list.
//
//   node scripts/matchup/reconcile-game-sitemap.mjs <origin> [season] [--csv FILE] [--check] [--sleep S]
//
//   origin   http://127.0.0.1:5415 (a local WordPress) or https://statchasers.com
//   season   default 2026
//   --csv    the slate to read; default data/schedule/games.csv (the stored
//            snapshot the refresh writes). The site itself reads nflverse live.
//   --check  also request every listed URL of the season: status, canonical
//            count and target, robots (slow on the live site: --sleep 1.6)
//   --sleep  seconds between requests (default 0; the live site 429s above
//            about 1 request per 1.5 s)
//
// Deliberately independent of the API's code: its own team table, its own
// pair ordering (the two slugs alphabetically) and its own segment spelling,
// so a bug in the shared URL builder cannot hide here. Expected = every game
// of the season with both scores in the slate (a tie included). Reported:
// expected, unique listed, missing, unexpected, duplicates, and the lastmod
// count. Exit 1 on any mismatch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--csv", "--sleep"].includes(args[i - 1]));
const origin = (positional[0] ?? "http://127.0.0.1:5415").replace(/\/$/, "");
const season = Number(positional[1] ?? 2026);
const csvFile = opt("--csv", path.resolve(HERE, "..", "..", "data", "schedule", "games.csv"));
const sleepMs = Number(opt("--sleep", "0")) * 1000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// nflverse abbreviations, every one since 1999 that can appear in the window.
const SLUG = {
  ARI: "arizona-cardinals", ATL: "atlanta-falcons", BAL: "baltimore-ravens", BUF: "buffalo-bills",
  CAR: "carolina-panthers", CHI: "chicago-bears", CIN: "cincinnati-bengals", CLE: "cleveland-browns",
  DAL: "dallas-cowboys", DEN: "denver-broncos", DET: "detroit-lions", GB: "green-bay-packers",
  HOU: "houston-texans", IND: "indianapolis-colts", JAX: "jacksonville-jaguars", KC: "kansas-city-chiefs",
  LA: "los-angeles-rams", LAC: "los-angeles-chargers", LV: "las-vegas-raiders", MIA: "miami-dolphins",
  MIN: "minnesota-vikings", NE: "new-england-patriots", NO: "new-orleans-saints", NYG: "new-york-giants",
  NYJ: "new-york-jets", PHI: "philadelphia-eagles", PIT: "pittsburgh-steelers", SEA: "seattle-seahawks",
  SF: "san-francisco-49ers", TB: "tampa-bay-buccaneers", TEN: "tennessee-titans", WAS: "washington-commanders",
};
const ROUND = { WC: "wild-card", DIV: "divisional", CON: "conference-championship", SB: "super-bowl" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  if (sleepMs) await sleep(sleepMs);
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}

// 1. Expected, from the slate.
const [head, ...rows] = fs.readFileSync(csvFile, "utf8").trim().split("\n");
const col = Object.fromEntries(head.split(",").map((c, i) => [c, i]));
const expected = new Map();
for (const line of rows) {
  const c = line.split(",");
  if (Number(c[col.season]) !== season) continue;
  if (c[col.away_score] === "" || c[col.home_score] === "") continue;
  const a = SLUG[c[col.away_team]];
  const b = SLUG[c[col.home_team]];
  if (!a || !b) throw new Error(`unknown team in ${c[col.game_id]}`);
  const pair = [a, b].sort().join("-vs-");
  const type = c[col.game_type];
  const segment = type === "REG" ? `${season}-week-${Number(c[col.week])}` : `${season}-${ROUND[type]}`;
  expected.set(`/nfl/${pair}/${segment}/`, {
    id: c[col.game_id],
    score: `${c[col.away_team]} ${c[col.away_score]} @ ${c[col.home_team]} ${c[col.home_score]}`,
  });
}

// 2. Listed, across every game sitemap the index names.
const index = await get(`${origin}/sitemap_index.xml`);
if (index.status !== 200) throw new Error(`sitemap_index.xml ${index.status}`);
const parts = [...index.text.matchAll(/<loc>([^<]*game-sitemap\d*\.xml)<\/loc>/g)].map((m) => m[1]);
const listedAll = [];
let lastmods = 0;
const partInfo = [];
for (const part of parts) {
  const url = part.replace(/^https?:\/\/[^/]+/, origin);
  const res = await get(url);
  const locs = [...res.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ""));
  const mods = (res.text.match(/<lastmod>/g) ?? []).length;
  lastmods += mods;
  partInfo.push(`${part.replace(/^https?:\/\/[^/]+/, "")} ${res.status} urls=${locs.length} lastmod=${mods}`);
  listedAll.push(...locs);
}
const ofSeason = listedAll.filter((u) => u.includes(`/${season}-`));
const counts = new Map();
for (const u of ofSeason) counts.set(u, (counts.get(u) ?? 0) + 1);
const duplicates = [...counts].filter(([, n]) => n > 1).map(([u, n]) => `${u} x${n}`);
const missing = [...expected.keys()].filter((u) => !counts.has(u));
const unexpected = [...counts.keys()].filter((u) => !expected.has(u));
const allDup = listedAll.length - new Set(listedAll).size;

console.log(`origin ${origin}  season ${season}  slate ${csvFile}`);
console.log(`index game sitemap parts: ${parts.length}`);
for (const p of partInfo) console.log(`  ${p}`);
console.log(`all seasons: listed ${listedAll.length}, duplicates ${allDup}, url lastmods ${lastmods}`);
console.log(`by season: ${Object.entries(listedAll.reduce((m, u) => ((m[u.match(/\/(\d{4})-/)?.[1] ?? "?"] = (m[u.match(/\/(\d{4})-/)?.[1] ?? "?"] ?? 0) + 1), m), {})).map(([s, n]) => `${s}:${n}`).join(" ")}`);
console.log(`${season}: expected completed ${expected.size}, unique listed ${counts.size}, missing ${missing.length}, unexpected ${unexpected.length}, duplicates ${duplicates.length}`);
for (const u of missing) console.log(`  MISSING ${u} (${expected.get(u).id} ${expected.get(u).score})`);
for (const u of unexpected) console.log(`  UNEXPECTED ${u}`);
for (const d of duplicates) console.log(`  DUPLICATE ${d}`);

// 3. Optionally, every listed URL of the season answers as its own page.
let bad = 0;
if (flag("--check")) {
  let ok = 0;
  for (const u of counts.keys()) {
    const res = await get(`${origin}${u}`);
    const canon = [...res.text.matchAll(/<link rel=["']canonical["'] href=["']([^"']+)["']/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ""));
    const robots = res.text.match(/<meta name=["']robots["'] content=["']([^"']*)["']/)?.[1] ?? "";
    const good = res.status === 200 && canon.length === 1 && canon[0] === u && !/noindex/.test(robots);
    if (good) ok++;
    else {
      bad++;
      console.log(`  BAD ${res.status} ${u} canon=[${canon.join(" ")}] robots=${robots}${res.location ? ` -> ${res.location}` : ""}`);
    }
  }
  console.log(`${season} listed URLs checked: ${ok} good, ${bad} bad (200, one self canonical, indexable)`);
}

process.exit(missing.length || unexpected.length || duplicates.length || allDup || bad ? 1 : 0);
