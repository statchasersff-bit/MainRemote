// Builds static injury snapshots for the WordPress plugin by querying a running
// dev server (so the exact Express scrape logic is reused, no duplication):
//
//   data/player_injuries.json  { [sleeperId]: PlayerInjuryHistory }
//   data/team_injuries.json    { [TEAM]: { source, source_url, report_label,
//                                          report_updated_at, players: { [normName]: <team/injury response> } } }
//
// Usage (dev server must be running and reachable):
//   PORT=5050 NODE_ENV=development npx tsx server/index.ts &   # in one shell
//   SC_API=http://localhost:5050 node scripts/buildInjurySnapshots.mjs
//
// The plugin's PHP serves these files directly; missing files degrade gracefully
// (injuries: null / found: false), so regenerating is always safe.

import fs from "fs";
import path from "path";

const API = process.env.SC_API || "http://localhost:5050";
const CONCURRENCY = Number(process.env.SC_CONCURRENCY || 6);
const ROOT = process.cwd();

// Mirror normName() in server/routes.ts so team lookups match at runtime.
function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Run an async fn over items with a fixed concurrency pool.
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (err) { results[idx] = { __error: String(err?.message || err) }; }
    }
  });
  await workers;
  await Promise.all(workers);
  return results;
}

const REQ_TIMEOUT = Number(process.env.SC_TIMEOUT || 25000);

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function loadIndexedPlayers() {
  const file = path.join(ROOT, "data", "indexed_players_by_team.json");
  const byTeam = JSON.parse(fs.readFileSync(file, "utf-8"));
  const seen = new Set();
  const players = [];
  for (const positions of Object.values(byTeam)) {
    for (const arr of Object.values(positions)) {
      for (const p of arr) {
        if (!p || !p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        players.push({ id: String(p.id), name: p.name, team: p.team, position: p.position });
      }
    }
  }
  return players;
}

async function main() {
  const players = loadIndexedPlayers();
  console.log(`[injuries] ${players.length} unique indexed players via ${API}`);

  // ---- Player injury history ----
  let injCount = 0;
  let injDone = 0;
  const playerInjuries = {};
  const injResults = await pool(players, CONCURRENCY, async (p) => {
    try {
      const data = await getJson(`${API}/api/players/${encodeURIComponent(p.id)}/injuries?name=${encodeURIComponent(p.name)}`);
      return { id: p.id, injuries: data?.injuries ?? null };
    } finally {
      if (++injDone % 50 === 0) console.log(`[injuries] player progress ${injDone}/${players.length}`);
    }
  });
  for (const r of injResults) {
    if (r && !r.__error && r.injuries) { playerInjuries[r.id] = r.injuries; injCount++; }
  }
  fs.writeFileSync(path.join(ROOT, "data", "player_injuries.json"), JSON.stringify(playerInjuries));
  console.log(`[injuries] wrote player_injuries.json (${injCount} players with history)`);

  // ---- Team injury report cards ----
  // Sequential per team (the dev server caches each team's report after the
  // first hit), parallel within a team.
  const byTeam = {};
  for (const p of players) {
    if (!p.team || p.team === "FA") continue;
    (byTeam[p.team] = byTeam[p.team] || []).push(p);
  }
  const teamInjuries = {};
  let foundCount = 0;
  for (const [team, roster] of Object.entries(byTeam)) {
    const rows = await pool(roster, CONCURRENCY, async (p) => {
      try {
        return await getJson(`${API}/api/team/injury?team=${encodeURIComponent(team)}&player_name=${encodeURIComponent(p.name)}`);
      } catch { return null; }
    });
    const entry = { source: null, source_url: null, report_label: "", report_updated_at: null, players: {} };
    for (let k = 0; k < rows.length; k++) {
      const resp = rows[k];
      if (!resp || resp.error) continue;
      // Capture team-level metadata from any response.
      if (resp.source) entry.source = resp.source;
      if (resp.source_url) entry.source_url = resp.source_url;
      if (resp.report_label) entry.report_label = resp.report_label;
      if (resp.report_updated_at) entry.report_updated_at = resp.report_updated_at;
      if (resp.found) {
        entry.players[normName(roster[k].name)] = resp;
        foundCount++;
      }
    }
    teamInjuries[team] = entry;
    console.log(`[injuries] ${team}: ${Object.keys(entry.players).length} on report`);
  }
  fs.writeFileSync(path.join(ROOT, "data", "team_injuries.json"), JSON.stringify(teamInjuries));
  console.log(`[injuries] wrote team_injuries.json (${foundCount} player rows across ${Object.keys(teamInjuries).length} teams)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
