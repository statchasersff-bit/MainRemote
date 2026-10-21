#!/usr/bin/env node
/**
 * Pack the standalone injury app's pipeline output for this server.
 *
 *   node scripts/injury-impact/buildData.mjs <app public/data dir> [--no-fetch]
 *
 * The app (statchasersff-bit/RESEARCH-Injury-Impact-Analysis,
 * artifacts/injury-impact/public/data) ships 65 MB of JSON and 6,752 local
 * headshots to the browser. This trims it to what the dashboard, the database
 * and the per-player panel read, and lays it out for a server that answers
 * slices:
 *
 *   data/injury-impact/
 *     analysis.json      meta + player_injury_impacts + drafted_pool (the
 *                        dashboard reads nothing else of the 2.3 MB file)
 *     current.json       the season in progress (injury_current.json, as is)
 *     exposure.json      player_exposure.json, as is
 *     regression.json    injury_regression.json, as is
 *     panel.json         predictability_panel.json, rows packed as arrays
 *     post-return.json   post_return.json, as is
 *     tag-impact.json    injury_tag_impact.json, as is
 *     draft-sim.json     draft_strategy_simulation.json, as is
 *     gridiron.json      gridiron_dataset.json, as is: the durability dataset
 *                        behind the Overview, Injury database, Current players
 *                        and Draft simulator tabs (the Gridiron Medical + page)
 *     search-index.json  one packed row per player, for the search box
 *     schedule.json      team_schedule.json, as is (server-side only: the
 *                        player slice carries the seasons it needs)
 *     history/<xx>.json  the weekly injury reports and the in-game events,
 *                        sharded by the last two digits of the GSIS id
 *                        (refresh.mjs brings the season in progress up to the
 *                        week between packs)
 *     sleeper-ids.json   GSIS id -> Sleeper id, so the headshots come from
 *                        this server's own image pipeline instead of the
 *                        app's bundled files (no outside image hosts)
 *
 * The Sleeper ids come from two places: this app's own player index
 * (data/player/bio_sources.json, 2,826 current players) and the DynastyProcess
 * crosswalk the bio builder already reads, fetched unless --no-fetch. The
 * mapping is committed, so a build without network keeps the last one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");
const OUT = path.join(APP, "data", "injury-impact");
const CROSSWALK_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

const argv = process.argv.slice(2);
const noFetch = argv.includes("--no-fetch");
const src = argv.find((a) => !a.startsWith("--"));
if (!src) {
  console.error("usage: buildData.mjs <app public/data dir> [--no-fetch]");
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (rel, value) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${rel.padEnd(22)} ${String(kb).padStart(6)} KB`);
};
const from = (name) => readJson(path.join(src, name));

fs.mkdirSync(OUT, { recursive: true });
console.log(`injury-impact: packing ${src} -> ${OUT}`);

/* ---------------------------------------------------------------- analysis */

const analysis = from("injury_impact_analysis.json");
writeJson("analysis.json", {
  meta: analysis.meta,
  player_injury_impacts: analysis.player_injury_impacts,
  drafted_pool: analysis.drafted_pool,
});

for (const [name, out] of [
  ["injury_current.json", "current.json"],
  ["player_exposure.json", "exposure.json"],
  ["injury_regression.json", "regression.json"],
  ["post_return.json", "post-return.json"],
  ["injury_tag_impact.json", "tag-impact.json"],
  ["draft_strategy_simulation.json", "draft-sim.json"],
  ["gridiron_dataset.json", "gridiron.json"],
  ["team_schedule.json", "schedule.json"],
]) {
  const file = path.join(src, name);
  if (!fs.existsSync(file)) {
    console.log(`  ${out.padEnd(22)} (missing in the app; skipped)`);
    continue;
  }
  writeJson(out, readJson(file));
}

/* -------------------------------------------------------------------- panel */

const PANEL_KEYS = ["season", "position", "age", "snaps", "touches", "prev_snaps", "prev_touches", "prior_inj", "rookie_year", "episodes", "first_week", "games_missed", "severe"];
const panel = from("predictability_panel.json");
writeJson("panel.json", { keys: PANEL_KEYS, rows: panel.map((r) => PANEL_KEYS.map((k) => r[k])) });

/* ------------------------------------------------------------ search index */

const index = from("injury_search_index.json");
writeJson(
  "search-index.json",
  index.map((p) => [p.gsisId, p.fullName, p.position, p.team, p.seasons[0] ?? null, p.seasons[p.seasons.length - 1] ?? null, p.reportCount]),
);

/* ------------------------------------------------------------------ history */

const HISTORY_KEYS = ["season", "week", "team", "reportPrimaryInjury", "reportSecondaryInjury", "practicePrimaryInjury", "practiceSecondaryInjury", "reportStatus", "practiceStatus", "dateModified"];
const INGAME_KEYS = ["season", "week", "seasonType", "gameId", "date", "team", "opponent", "qtr", "clock", "status", "desc"];

const history = from("injury_history.json");
const ingame = from("injury_ingame_events.json");
const shards = new Map();
const shardOf = (id) => id.slice(-2);
for (const [id, rows] of Object.entries(history)) {
  const shard = shards.get(shardOf(id)) ?? {};
  shard[id] = { h: rows.map((r) => HISTORY_KEYS.map((k) => r[k] ?? null)), g: [] };
  shards.set(shardOf(id), shard);
}
for (const [id, events] of Object.entries(ingame)) {
  const shard = shards.get(shardOf(id)) ?? {};
  const entry = shard[id] ?? (shard[id] = { h: [], g: [] });
  entry.g = events.map((e) => INGAME_KEYS.map((k) => e[k] ?? null));
  shards.set(shardOf(id), shard);
}
fs.rmSync(path.join(OUT, "history"), { recursive: true, force: true });
// A new pack is a new baseline: refresh.mjs re-finds its ownership boundary.
fs.rmSync(path.join(OUT, "history-refresh.json"), { force: true });
let shardBytes = 0;
for (const [key, shard] of shards) {
  const file = path.join(OUT, "history", `${key}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ keys: { h: HISTORY_KEYS, g: INGAME_KEYS }, players: shard }));
  shardBytes += fs.statSync(file).size;
}
console.log(`  history/*.json         ${String(Math.round(shardBytes / 1024)).padStart(6)} KB in ${shards.size} shards, ${Object.keys(history).length} players`);

/* -------------------------------------------------------------- sleeper ids */

const idsFile = path.join(OUT, "sleeper-ids.json");
const ids = fs.existsSync(idsFile) ? readJson(idsFile) : {};
const before = Object.keys(ids).length;

const bio = path.join(APP, "data", "player", "bio_sources.json");
if (fs.existsSync(bio)) {
  for (const p of Object.values(readJson(bio).players ?? {})) {
    if (p.ids?.gsis && p.ids?.sleeper) ids[p.ids.gsis] = String(p.ids.sleeper);
  }
}

if (!noFetch) {
  try {
    const res = await fetch(CROSSWALK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const [head, ...lines] = text.split(/\r?\n/);
    const cols = head.split(",");
    const gi = cols.indexOf("gsis_id");
    const si = cols.indexOf("sleeper_id");
    let added = 0;
    for (const line of lines) {
      if (!line) continue;
      const cells = parseCsvLine(line);
      const gsis = cells[gi];
      const sleeper = cells[si];
      if (gsis && sleeper && /^\d+$/.test(sleeper) && !ids[gsis]) {
        ids[gsis] = sleeper;
        added += 1;
      }
    }
    console.log(`  crosswalk: ${added} Sleeper ids added from DynastyProcess`);
  } catch (err) {
    console.log(`  crosswalk: not fetched (${err.message}); keeping ${before} stored ids`);
  }
}

const gridironFile = path.join(src, "gridiron_dataset.json");
const gridironIds = fs.existsSync(gridironFile) ? readJson(gridironFile).players.map((p) => p.id).filter(Boolean) : [];
const wanted = new Set([...Object.keys(history), ...analysis.player_injury_impacts.map((p) => p.gsis_id).filter(Boolean), ...gridironIds]);
const kept = Object.fromEntries(Object.entries(ids).filter(([g]) => wanted.has(g)).sort());
writeJson("sleeper-ids.json", kept);
console.log(`  sleeper ids: ${Object.keys(kept).length} of ${wanted.size} players in the injury data have one`);

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

console.log("done");
