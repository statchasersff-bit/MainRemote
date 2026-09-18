// Builds a static production snapshot for the WordPress plugin by querying a
// running dev server (reuses the exact Express logic, no duplication):
//
//   data/player_production.json  { [sleeperId]: seasons[] }
//
// Each season object already carries std/half/ppr finish data, so a single
// snapshot per player serves every scoring format the UI toggles between.
//
// Usage (dev server must be running):
//   PORT=5050 NODE_ENV=development npx tsx server/index.ts &
//   SC_API=http://localhost:5050 node scripts/buildProductionSnapshot.mjs

import fs from "fs";
import path from "path";

const API = process.env.SC_API || "http://localhost:5050";
const CONCURRENCY = Number(process.env.SC_CONCURRENCY || 6);
const REQ_TIMEOUT = Number(process.env.SC_TIMEOUT || 25000);
const ROOT = process.cwd();

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
  await Promise.all(workers);
  return results;
}

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
  const byTeam = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "indexed_players_by_team.json"), "utf-8"));
  const seen = new Set();
  const players = [];
  for (const positions of Object.values(byTeam)) {
    for (const arr of Object.values(positions)) {
      for (const p of arr) {
        if (!p || !p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        players.push({ id: String(p.id), name: p.name });
      }
    }
  }
  return players;
}

async function main() {
  const players = loadIndexedPlayers();
  console.log(`[production] ${players.length} unique indexed players via ${API}`);

  const out = {};
  let done = 0, withData = 0;
  const results = await pool(players, CONCURRENCY, async (p) => {
    try {
      const data = await getJson(`${API}/api/players/${encodeURIComponent(p.id)}/production?scoring=ppr`);
      return { id: p.id, seasons: Array.isArray(data?.seasons) ? data.seasons : [] };
    } finally {
      if (++done % 50 === 0) console.log(`[production] progress ${done}/${players.length}`);
    }
  });
  for (const r of results) {
    if (r && !r.__error && r.seasons && r.seasons.length) { out[r.id] = r.seasons; withData++; }
  }
  fs.writeFileSync(path.join(ROOT, "data", "player_production.json"), JSON.stringify(out));
  console.log(`[production] wrote player_production.json (${withData} players with seasons)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
