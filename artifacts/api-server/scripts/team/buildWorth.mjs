/**
 * Build the Contracts tab's Worth column: what the league pays a player who
 * produces like this one, and the Overpaid / Underpaid tags that fall out of
 * comparing it to the deal.
 *
 *   node scripts/team/buildWorth.mjs <season> [--cache <dir>]
 *
 * Writes data/team/worth_<season>.json, keyed by the register's player id.
 *
 * The model (proposed 2026-10-23, so the page can say exactly what it does):
 *
 *   1. Production, per game played this season, at least three games.
 *      Quarterbacks, backs, receivers and tight ends: PPR fantasy points.
 *      Defenders: a tackle-and-havoc score - solo tackle 1, assist 0.5,
 *      tackle for loss 1, QB hit 1, sack 3, pass defended 1.5, forced
 *      fumble 3, recovery 3, interception 4, touchdown 6. Offensive linemen
 *      have no free production measure and are not priced; nor are kickers,
 *      punters and long snappers.
 *   2. Rank it within the position group among every player in the league
 *      who has a contract on the books this season and clears the floor.
 *      Groups: QB, RB (with FB), WR, TE, ED, IDL, LB, CB, S.
 *   3. Market curve. Sort the same group's contracts by average per year.
 *      Worth is the average per year at the player's production rank on that
 *      list (3rd in production reads the 3rd-highest average), smoothed over
 *      the three deals either side: what the league is paying the players
 *      ranked where this one's production ranks.
 *   4. Tags. OVERPAID when the deal's average is at least half again Worth;
 *      UNDERPAID when Worth is at least half again the average. Both need
 *      the larger figure to reach $5M, so minimum-salary deals and the
 *      bottom of the curve are left alone, and a rookie contract is never
 *      Overpaid: the player did not set that number.
 *
 * Reads data/team/contracts_<season>.json (built first) and the nflverse
 * weekly player stats, joined by the league id the register carries. Run
 * after the contracts builder, weekly in season, and commit.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";

let cacheDir = null;

const GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  ED: "ED", IDL: "IDL", LB: "LB", CB: "CB", S: "S",
};
const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const MIN_GAMES = 3;
const RATIO = 1.5;
const FLOOR = 5;

/** The defender's game score, from the weekly stat row. */
function havoc(r) {
  return (
    N(r.def_tackles_solo) +
    0.5 * N(r.def_tackle_assists) +
    N(r.def_tackles_for_loss) +
    N(r.def_qb_hits) +
    3 * N(r.def_sacks) +
    1.5 * N(r.def_pass_defended) +
    3 * N(r.def_fumbles_forced) +
    3 * (N(r.fumble_recovery_opp) + N(r.fumble_recovery_own)) +
    4 * N(r.def_interceptions) +
    6 * N(r.def_tds)
  );
}

function splitCsv(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

async function* rows(url) {
  const cached = cacheDir ? path.join(cacheDir, path.basename(url)) : null;
  let stream;
  if (cached && fs.existsSync(cached)) stream = fs.createReadStream(cached);
  else {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    stream = Readable.fromWeb(res.body);
  }
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let pending = "";
  for await (const raw of lines) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if ((line.match(/"/g) ?? []).length % 2 === 1) {
      pending = line;
      continue;
    }
    pending = "";
    const fields = splitCsv(line);
    if (!header) {
      header = fields;
      continue;
    }
    const row = {};
    header.forEach((h, i) => {
      row[h] = fields[i];
    });
    yield row;
  }
}

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const m3 = (v) => Math.round(v * 1000) / 1000;
const key = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2015) {
    console.error("usage: node scripts/team/buildWorth.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);

  const contracts = JSON.parse(fs.readFileSync(path.join(DATA, "team", `contracts_${season}.json`), "utf8"));

  // Every contract on the books, with its group and the join keys.
  const players = [];
  for (const [abbr, team] of Object.entries(contracts.teams)) {
    for (const p of team.players) {
      const group = GROUP[p.position];
      if (!group) continue;
      players.push({ ...p, abbr, group, nameKey: key(p.name) });
    }
  }

  // Production: one weekly row per player per game, keyed by league id.
  const weekly = new Map(); // gsis -> { ppr, havoc, games }
  let throughWeek = 0;
  for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`)) {
    if (r.season_type !== "REG") continue;
    const id = r.player_id;
    if (!id) continue;
    const hit = weekly.get(id) ?? { ppr: 0, havoc: 0, games: 0 };
    hit.ppr += N(r.fantasy_points_ppr);
    hit.havoc += havoc(r);
    hit.games += 1;
    weekly.set(id, hit);
    throughWeek = Math.max(throughWeek, N(r.week));
  }

  for (const p of players) {
    const hit = p.gsisId ? weekly.get(p.gsisId) : null;
    if (!hit || hit.games < MIN_GAMES) continue;
    if (SKILL.has(p.group)) {
      p.production = m3(hit.ppr / hit.games);
      p.productionLabel = `${p.production.toFixed(1)} PPR/G`;
    } else {
      p.production = m3(hit.havoc / hit.games);
      p.productionLabel = `${p.production.toFixed(1)} havoc/G`;
    }
  }

  // Rank and price, group by group.
  const out = {};
  const groups = {};
  for (const group of new Set(players.map((p) => p.group))) {
    const members = players.filter((p) => p.group === group);
    const curve = members
      .map((p) => p.apy)
      .filter((apy) => apy > 0)
      .sort((a, b) => b - a);
    const ranked = members
      .filter((p) => p.production !== undefined)
      .sort((a, b) => b.production - a.production || b.apy - a.apy);
    groups[group] = { contracts: members.length, scored: ranked.length };
    ranked.forEach((p, i) => {
      const rank = i + 1;
      const idx = Math.min(i, curve.length - 1);
      const window = curve.slice(Math.max(0, idx - 3), Math.min(curve.length, idx + 4));
      const worth = m3(window.reduce((n, v) => n + v, 0) / window.length);
      const rookie = p.contractType === "Drafted";
      let tag = null;
      if (!rookie && p.apy >= FLOOR && p.apy >= worth * RATIO) tag = "over";
      else if (worth >= FLOOR && worth >= p.apy * RATIO) tag = "under";
      out[p.otcId] = {
        worth,
        tag,
        production: p.production,
        productionLabel: p.productionLabel,
        rank,
        of: ranked.length,
        group,
      };
    });
  }

  const doc = {
    season,
    builtAt: new Date().toISOString(),
    throughWeek,
    minGames: MIN_GAMES,
    ratio: RATIO,
    floor: FLOOR,
    groups,
    players: out,
  };
  const file = path.join(DATA, "team", `worth_${season}.json`);
  writeAtomic(file, `${JSON.stringify(doc)}\n`);
  const tags = Object.values(out).reduce((n, p) => n + (p.tag ? 1 : 0), 0);
  console.log(
    `  worth ${season}: ${Object.keys(out).length} players priced through week ${throughWeek}, ${tags} tagged -> ${path.relative(process.cwd(), file)}`,
  );
  for (const [g, c] of Object.entries(groups)) console.log(`    ${g}: ${c.scored}/${c.contracts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
