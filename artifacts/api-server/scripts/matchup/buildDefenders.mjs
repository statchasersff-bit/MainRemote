#!/usr/bin/env node
/**
 * Season pass-rush and coverage numbers for every defender, plus each QB's
 * sacks taken, for the matchup page's Player Battles card (mak, 2026-11-06).
 *
 *   node scripts/matchup/buildDefenders.mjs [season]
 *
 * Source: nflverse's weekly player stats (stats_player_week_<season>.csv,
 * the same file scripts/team/buildWorth.mjs reads). Regular-season weeks
 * only; a player's team is the one on his latest row, so a trade moves his
 * season totals with him (the card reads the defense he plays for now).
 *
 * Writes data/matchup/defenders_<season>.json:
 *   { season, builtAt, throughWeek, teams: { GB: { defenders: [...], qbs: [...] } } }
 * Defenders keep only what the card prints (sacks, QB hits, tackles for
 * loss, passes defended, interceptions, games); a defender with none of the
 * five is left out. Stored, not fetched at render time ([[store-verified-data]]).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "../../data/matchup");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
const season = Number(process.argv[2] ?? new Date().getUTCFullYear());

function splitCsv(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const DEF_GROUPS = new Set(["DL", "LB", "DB"]);
// nflverse files a few clubs under older codes; the site uses these.
const TEAM_FIX = { LA: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };

async function main() {
  const url = `${NFLVERSE}/stats_player/stats_player_week_${season}.csv`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const head = splitCsv(lines.shift());
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const need of ["player_id", "player_display_name", "position", "position_group", "week", "season_type", "team", "def_sacks", "def_qb_hits", "sacks_suffered"]) {
    if (!(need in col)) throw new Error(`column ${need} missing from ${url}`);
  }

  const players = new Map();
  let throughWeek = 0;
  for (const line of lines) {
    const r = splitCsv(line);
    if (r[col.season_type] !== "REG") continue;
    const week = N(r[col.week]);
    throughWeek = Math.max(throughWeek, week);
    const id = r[col.player_id];
    const group = r[col.position_group];
    const pos = r[col.position];
    const isDef = DEF_GROUPS.has(group);
    const isQb = pos === "QB";
    if (!isDef && !isQb) continue;
    const team = TEAM_FIX[r[col.team]] ?? r[col.team];
    let p = players.get(id);
    if (!p) {
      p = { id, name: r[col.player_display_name], pos, group, team, lastWeek: 0, games: 0, sacks: 0, qbHits: 0, tfl: 0, pd: 0, int: 0, sacksTaken: 0, attempts: 0 };
      players.set(id, p);
    }
    if (week >= p.lastWeek) {
      p.lastWeek = week;
      p.team = team;
      p.pos = pos;
    }
    p.games += 1;
    p.sacks += N(r[col.def_sacks]);
    p.qbHits += N(r[col.def_qb_hits]);
    p.tfl += N(r[col.def_tackles_for_loss]);
    p.pd += N(r[col.def_pass_defended]);
    p.int += N(r[col.def_interceptions]);
    p.sacksTaken += N(r[col.sacks_suffered]);
    p.attempts += N(r[col.attempts]);
  }

  const teams = {};
  const slot = (t) => (teams[t] ??= { defenders: [], qbs: [] });
  for (const p of players.values()) {
    if (DEF_GROUPS.has(p.group)) {
      if (p.sacks + p.qbHits + p.tfl + p.pd + p.int === 0) continue;
      slot(p.team).defenders.push({ id: p.id, name: p.name, pos: p.pos, games: p.games, sacks: p.sacks, qbHits: p.qbHits, tfl: p.tfl, pd: p.pd, int: p.int });
    } else if (p.pos === "QB" && p.attempts > 0) {
      slot(p.team).qbs.push({ id: p.id, name: p.name, games: p.games, attempts: p.attempts, sacksTaken: p.sacksTaken });
    }
  }
  for (const t of Object.values(teams)) {
    t.defenders.sort((a, b) => b.sacks - a.sacks || b.qbHits - a.qbHits || a.name.localeCompare(b.name));
    t.qbs.sort((a, b) => b.attempts - a.attempts);
  }

  const doc = { season, builtAt: new Date().toISOString(), source: "nflverse stats_player_week", throughWeek, teams };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `defenders_${season}.json`);
  fs.writeFileSync(out, JSON.stringify(doc) + "\n");
  const n = Object.values(teams).reduce((s, t) => s + t.defenders.length, 0);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(teams).length} teams, ${n} defenders, through week ${throughWeek}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
