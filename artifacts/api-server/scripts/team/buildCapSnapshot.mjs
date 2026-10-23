/**
 * Snapshot each club's salary-cap page: cap space, the top-51 total, dead
 * money by player, roster status, and the published dead-money and
 * cap-savings figures for a cut or trade before and after June 1.
 *
 *   node scripts/team/buildCapSnapshot.mjs <season> [--from <dir>] [--only <slug,...>]
 *
 * Writes data/team/cap_snapshot_<season>.json. This is the half of the
 * Contracts tab the nflverse register cannot supply: the register has every
 * contract's structure, but team cap space needs the dead money already on
 * the books, and the exact release math needs to know which options have
 * been exercised. Both are on the club's cap page, so this reads the 32
 * pages once, politely (one request at a time, two seconds apart, an honest
 * browser user agent, no retries past a refusal) and stores what the tab
 * shows. Players are keyed by the page's own player id, which the register
 * carries too, so the two files join without name matching.
 *
 * `--from <dir>` reads saved pages named <slug>.html from a directory instead
 * of fetching, so a run can be reproduced. `--only` limits a live run to a
 * few clubs while testing; the file is only written when all 32 are present.
 *
 * Re-run after signings, releases and restructures, and commit. Figures are
 * stored in millions, like the register file.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const ORIGIN = "https://overthecap.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const GAP_MS = 2000;

/** The site's abbreviations and the slugs both sites use. */
const TEAMS = {
  ari: "arizona-cardinals", atl: "atlanta-falcons", bal: "baltimore-ravens", buf: "buffalo-bills",
  car: "carolina-panthers", chi: "chicago-bears", cin: "cincinnati-bengals", cle: "cleveland-browns",
  dal: "dallas-cowboys", den: "denver-broncos", det: "detroit-lions", gb: "green-bay-packers",
  hou: "houston-texans", ind: "indianapolis-colts", jax: "jacksonville-jaguars", kc: "kansas-city-chiefs",
  lac: "los-angeles-chargers", lar: "los-angeles-rams", lv: "las-vegas-raiders", mia: "miami-dolphins",
  min: "minnesota-vikings", ne: "new-england-patriots", no: "new-orleans-saints", nyg: "new-york-giants",
  nyj: "new-york-jets", phi: "philadelphia-eagles", pit: "pittsburgh-steelers", sea: "seattle-seahawks",
  sf: "san-francisco-49ers", tb: "tampa-bay-buccaneers", ten: "tennessee-titans", was: "washington-commanders",
};

const STATUS = {
  "Practice Squad": "PS",
  "Injured Reserve": "IR",
  "Physically Unable to Perform": "PUP",
  "Suspended": "SUSP",
  "Non-Football Injury": "NFI",
  "Commissioner Exempt": "EXEMPT",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "$16,156,528" -> 16.157; "($64,444,590)" -> -64.445; "" -> 0. */
function dollars(text) {
  const t = String(text ?? "").replace(/<[^>]+>/g, "").trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round((negative ? -n : n) / 1000) / 1000;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

/** The season's section of the page: between its tab panel and the next. */
function seasonSection(html, season) {
  const start = html.indexOf(`id="y${season}"`);
  if (start < 0) return null;
  const next = html.indexOf(`id="y${season + 1}"`, start);
  return html.slice(start, next > 0 ? next : undefined);
}

function cell(row, cls) {
  const m = row.match(new RegExp(`<td class="${cls}[^"]*">([\\s\\S]*?)</td>`));
  return m ? m[1] : "";
}

/** Every <div class="x">$…</div> in a transactions cell, keyed by x. */
function transactions(cellHtml) {
  const out = {};
  for (const m of cellHtml.matchAll(/<div class="([a-z_1]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    out[m[1]] = dollars(m[2]);
  }
  return out;
}

function parseTeam(html, season) {
  const section = seasonSection(html, season);
  if (!section) throw new Error(`no ${season} section on the page`);

  const total = (label) => {
    const m = section.match(new RegExp(`${label}:\\s*\\$([0-9,]+)`));
    return m ? dollars(m[1]) : null;
  };
  const summary = {
    liabilities: total("Total Cap Liabilities"),
    top51: total("Top 51"),
    capSpace: total("Team Cap Space"),
    offense: total("Offense"),
    defense: total("Defense"),
    special: total("Special"),
  };

  // The active roster: one row per player, keyed by the page's player id.
  const players = {};
  const active = section.match(/<h4>Active Roster[^<]*<\/h4>\s*<table[\s\S]*?<\/table>/);
  if (!active) throw new Error("no active roster table");
  for (const row of active[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const r = row[1];
    const who = r.match(/<a href="\/player\/([a-z0-9-]+)\/(\d+)\/">([^<]+)<\/a>/);
    if (!who) continue;
    const otcId = Number(who[2]);
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    // Column order on the page: player, base, prorated signing, option,
    // roster regular, roster per game, workout, other, spacer, guaranteed,
    // spacer, cap number, spacer, dead money, cap savings.
    const dead = transactions(cell(r, "player-transactions player-dead-money"));
    const save = transactions(cell(r, "player-transactions player-cap-savings"));
    players[otcId] = {
      name: who[3].trim(),
      capNumber: dollars(cells[11]),
      cut: { dead: dead.cut ?? 0, save: save.cut ?? 0 },
      june1Cut: { dead: dead.june_1_cut ?? 0, save: save.june_1_cut ?? 0 },
      trade: { dead: dead.trade ?? 0, save: save.trade ?? 0 },
      june1Trade: { dead: dead.june_1_trade ?? 0, save: save.june_1_trade ?? 0 },
      restructure: save.restructure ?? 0,
    };
  }

  // The non-active tables: dead money by player, and roster status.
  const dead = [];
  const status = {};
  let deadTotal = null;
  for (const t of section.matchAll(/<h5>([^<]+)<\/h5>\s*<table[\s\S]*?<\/table>/g)) {
    const title = t[1].trim();
    for (const row of t[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const r = row[1];
      if (/<strong>TOTAL<\/strong>/.test(r)) {
        if (title === "Dead Money") deadTotal = dollars(r.match(/<strong>\$([0-9,]+)<\/strong>/)?.[1] ?? "");
        continue;
      }
      const who = r.match(/<a href="\/player\/([a-z0-9-]+)\/(\d+)\/">([^<]+)<\/a>/);
      if (!who) continue;
      const otcId = Number(who[2]);
      const amount = dollars([...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].at(-1)?.[1]);
      if (title === "Dead Money") dead.push({ otcId, name: who[3].trim(), amount });
      else if (STATUS[title]) {
        status[otcId] = STATUS[title];
        // A reserve-list player still has a cap number but no row on the
        // active table; keep his figure so the table can show it.
        players[otcId] ??= { name: who[3].trim(), capNumber: amount, cut: null, june1Cut: null, trade: null, june1Trade: null, restructure: 0 };
      }
    }
  }
  dead.sort((a, b) => b.amount - a.amount);
  if (deadTotal === null) deadTotal = Math.round(dead.reduce((n, d) => n + d.amount, 0) * 1000) / 1000;

  if (summary.capSpace === null || summary.top51 === null) throw new Error("summary totals not found");
  return { ...summary, deadTotal, dead, status, players, active: Object.keys(players).length };
}

async function fetchPage(slug) {
  const res = await fetch(`${ORIGIN}/salary-cap/${slug}/`, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${slug}: answered ${res.status}`);
  return res.text();
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2015) {
    console.error("usage: node scripts/team/buildCapSnapshot.mjs <season> [--from <dir>] [--only <slug,...>]");
    process.exit(2);
  }
  const arg = (k) => {
    const at = process.argv.indexOf(`--${k}`);
    return at > 0 ? process.argv[at + 1] : null;
  };
  const from = arg("from") ? path.resolve(arg("from")) : null;
  const only = arg("only") ? new Set(arg("only").split(",")) : null;

  const teams = {};
  for (const [abbr, slug] of Object.entries(TEAMS)) {
    if (only && !only.has(slug) && !only.has(abbr)) continue;
    let html;
    if (from) {
      const file = path.join(from, `${slug}.html`);
      if (!fs.existsSync(file)) {
        console.warn(`  ${slug}: no saved page, skipped`);
        continue;
      }
      html = fs.readFileSync(file, "utf8");
    } else {
      html = await fetchPage(slug);
      await sleep(GAP_MS);
    }
    teams[abbr] = parseTeam(html, season);
    console.log(
      `  ${abbr}: cap space ${teams[abbr].capSpace}M, top-51 ${teams[abbr].top51}M, dead ${teams[abbr].deadTotal}M, ${teams[abbr].active} players`,
    );
  }

  const count = Object.keys(teams).length;
  if (count < 32) {
    console.error(`  not writing: ${count} of 32 clubs parsed`);
    process.exit(1);
  }
  const rank = (key, desc) => {
    const order = Object.entries(teams).sort((a, b) => (desc ? b[1][key] - a[1][key] : a[1][key] - b[1][key]));
    return Object.fromEntries(order.map(([abbr], i) => [abbr, i + 1]));
  };
  const doc = {
    season,
    builtAt: new Date().toISOString(),
    ranks: {
      capSpace: rank("capSpace", true),
      top51: rank("top51", true),
      deadTotal: rank("deadTotal", true),
    },
    teams: Object.fromEntries(Object.keys(teams).sort().map((k) => [k, teams[k]])),
  };
  const file = path.join(DATA, "team", `cap_snapshot_${season}.json`);
  writeAtomic(file, `${JSON.stringify(doc)}\n`);
  console.log(`  cap snapshot ${season}: 32 clubs -> ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
