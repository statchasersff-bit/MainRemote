#!/usr/bin/env node
/**
 * Bring the injury history up to the week: the season in progress's weekly
 * injury reports and in-game injury events, from nflverse, merged into the
 * packed data the Injury history tab and the player panel read.
 *
 *   node scripts/injury-impact/refresh.mjs [--season 2026] [--reports-only | --plays-only]
 *                                          [--from <dir>] [--own-from <week>] [--dry-run]
 *
 * buildData.mjs packs the research repo's whole pipeline output, which only
 * moves when that repo's refresh is run and re-packed. This fills the gap in
 * between from the same public files that pipeline reads:
 *
 *   injuries_<season>.csv        the weekly reports (practice level, game status)
 *   play_by_play_<season>.csv.gz "X was injured during the play" with quarter and clock
 *   roster_<season>.csv          jersey + name -> GSIS id for those plays, Sleeper ids
 *   roster_weekly_<season>.csv   the player's team in that week (mid-season trades)
 *
 * What it owns. The pack's rows for weeks already published are left alone:
 * the repo's curated database replaced nflverse's rows there for QB/RB/WR/TE
 * and this script has no copy of it. Weeks after the pack's last week are the
 * refresh's, dropped and rewritten from nflverse on every run so a Wednesday
 * "Limited" becomes Friday's "Questionable". The boundary is remembered in
 * data/injury-impact/history-refresh.json the first time it runs after a pack
 * (buildData.mjs deletes that file). In-game events have no curated layer, so
 * the whole season is recomputed each run. Every roster player without a
 * report gets a search-index row (0 reports) so the search finds him and the
 * panel can say "No injury reports on file", and roster Sleeper ids fill in
 * missing headshots.
 *
 * Untouched: current.json (the audited episodes: Notable Injuries, games
 * missed so far, the Current players tab), gridiron.json and analysis.json.
 * Those come from the repo's participation audit and need its refresh.
 *
 * --from <dir> reads the four files from a directory instead of fetching
 * (file names as above). Run weekly after Monday night, or daily in season
 * for the practice designations; commit the result.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  HISTORY_KEYS,
  INGAME_KEYS,
  addRosterToIndex,
  buildRosterMaps,
  eventsFromPlay,
  fillSleeperIds,
  latestFacts,
  maxStoredWeek,
  mergeEvents,
  mergeReports,
  parseCsvLine,
  reportRowsFromCsv,
  rosterPlayers,
  updateSearchIndex,
} from "./refresh-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "..", "data", "injury-impact");
const HISTORY = path.join(OUT, "history");
const SIDECAR = path.join(OUT, "history-refresh.json");
const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";
const UA = "StatChasers-Injury-Refresh/1.0";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dryRun = flag("--dry-run");
const doReports = !flag("--plays-only");
const doPlays = !flag("--reports-only");
const fromDir = value("--from");

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

function defaultSeason() {
  const current = readJson(path.join(OUT, "gridiron.json"))?.current?.season;
  if (Number.isInteger(current)) return current;
  const now = new Date();
  return now.getUTCMonth() + 1 >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
const season = Number(value("--season") ?? defaultSeason());
if (!Number.isInteger(season)) {
  console.error("usage: refresh.mjs [--season YYYY] [--reports-only | --plays-only] [--from <dir>] [--own-from <week>] [--dry-run]");
  process.exit(1);
}

/* -------------------------------------------------------------------- fetch */

async function fetchBytes(name, release) {
  if (fromDir) {
    const file = path.join(fromDir, name);
    if (!fs.existsSync(file)) throw new Error(`${file} not found`);
    return fs.readFileSync(file);
  }
  const url = `${RELEASES}/${release}/${name}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
const fetchText = async (name, release) => (await fetchBytes(name, release)).toString("utf8");

/**
 * Play-by-play is ~70 MB unpacked; stream it and parse only the lines that
 * mention an injury.
 */
async function eventsFromPbp(gz, maps, unmapped) {
  const input = Readable.from([gz]).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let header = null;
  const col = (n) => header[n];
  const byGsis = new Map();
  let mentions = 0;
  let plays = 0;
  for await (const line of lines) {
    if (!header) {
      header = {};
      parseCsvLine(line).forEach((h, i) => (header[h] = i));
      for (const n of ["desc", "game_id", "home_team", "away_team", "week", "season_type", "qtr", "time", "game_date"]) {
        if (col(n) == null) throw new Error(`play-by-play CSV: missing column ${n}`);
      }
      continue;
    }
    if (!line || !line.includes("was injured")) continue;
    plays += 1;
    const cells = parseCsvLine(line);
    for (const { gsisId, event } of eventsFromPlay(cells, col, season, maps, unmapped)) {
      mentions += 1;
      (byGsis.get(gsisId) ?? byGsis.set(gsisId, []).get(gsisId)).push(event);
    }
  }
  return { byGsis, mentions, plays };
}

/* --------------------------------------------------------------------- main */

console.log(`injury-impact refresh: ${season}${fromDir ? ` from ${fromDir}` : " from nflverse"}${dryRun ? " (dry run)" : ""}`);

const shards = new Map();
for (const file of fs.existsSync(HISTORY) ? fs.readdirSync(HISTORY) : []) {
  if (!file.endsWith(".json")) continue;
  shards.set(file.slice(0, -5), readJson(path.join(HISTORY, file), { keys: { h: HISTORY_KEYS, g: INGAME_KEYS }, players: {} }));
}
if (!shards.size) {
  console.error(`no history shards in ${HISTORY}; run buildData.mjs first`);
  process.exit(1);
}
const before = new Map([...shards].map(([k, v]) => [k, JSON.stringify(v)]));
const index = readJson(path.join(OUT, "search-index.json"), []);
const sleeper = readJson(path.join(OUT, "sleeper-ids.json"), {});
const sidecar = readJson(SIDECAR, null);

const touched = new Set();
const summary = { season, generatedAt: new Date().toISOString() };

// The ownership boundary: the pack's last week for this season, found once.
let ownedFrom = sidecar && sidecar.season === season ? sidecar.ownedFrom : maxStoredWeek(shards, season) + 1;
if (value("--own-from")) ownedFrom = Number(value("--own-from"));
summary.ownedFrom = ownedFrom;

const rosterCsv = await fetchText(`roster_${season}.csv`, "rosters");
const roster = rosterPlayers(rosterCsv);
console.log(`  roster: ${roster.length} players`);

if (doReports) {
  const reports = reportRowsFromCsv(await fetchText(`injuries_${season}.csv`, "injuries"));
  const latest = Math.max(0, ...reports.map((r) => r.week ?? 0));
  const merged = mergeReports(shards, season, ownedFrom, reports);
  for (const id of merged.touched) touched.add(id);
  const facts = latestFacts(reports.filter((r) => r.week != null && r.week >= ownedFrom));
  const indexed = updateSearchIndex(index, shards, merged.touched, facts);
  summary.reports = { weeks: merged.weeks, latestWeek: latest, added: merged.added, dropped: merged.dropped, players: merged.touched.size, newPlayers: indexed.added };
  console.log(`  reports: nflverse through week ${latest}; weeks ${ownedFrom}+ rewritten: ${merged.added} rows for ${merged.touched.size} players (${merged.dropped} replaced, ${indexed.added} new to the index)`);
  console.log(`           by week: ${Object.entries(merged.weeks).map(([w, n]) => `${w}:${n}`).join(" ") || "none"}`);
} else if (sidecar?.reports) summary.reports = sidecar.reports;

if (doPlays) {
  const weekly = await fetchText(`roster_weekly_${season}.csv`, "weekly_rosters");
  const maps = buildRosterMaps(weekly, rosterCsv);
  const unmapped = [];
  const gz = await fetchBytes(`play_by_play_${season}.csv.gz`, "pbp");
  const { byGsis, mentions, plays } = await eventsFromPbp(gz, maps, unmapped);
  const merged = mergeEvents(shards, season, byGsis);
  for (const id of merged.touched) touched.add(id);
  // A first-ever in-game injury for a player with no reports still needs an index row.
  const facts = new Map(roster.map((p) => [p.gsisId, { fullName: p.fullName, position: p.position, team: p.team }]));
  const indexed = updateSearchIndex(index, shards, [...byGsis.keys()].filter((id) => !index.some((r) => r[0] === id)), facts);
  summary.plays = { plays, mentions, mapped: mentions, unmapped: unmapped.length, events: merged.added, players: byGsis.size };
  console.log(`  plays: ${plays} injury plays, ${mentions} players resolved, ${unmapped.length} not; ${merged.added} events for ${byGsis.size} players (${merged.dropped} replaced, ${indexed.added} new to the index)`);
  if (unmapped.length) console.log(`         unresolved: ${unmapped.slice(0, 12).join("; ")}${unmapped.length > 12 ? "; ..." : ""}`);
} else if (sidecar?.plays) summary.plays = sidecar.plays;

const rosterIndexed = addRosterToIndex(index, roster);
const sleeperFilled = fillSleeperIds(sleeper, index, roster);
summary.roster = { indexed: rosterIndexed.added, sleeperIds: sleeperFilled.added };
console.log(`  index: ${index.length} players (${rosterIndexed.added} roster players without a report added); ${sleeperFilled.added} Sleeper ids filled`);

if (dryRun) {
  console.log("dry run: nothing written");
  process.exit(0);
}

let written = 0;
for (const [key, shard] of shards) {
  const json = JSON.stringify(shard);
  if (json === before.get(key)) continue;
  fs.writeFileSync(path.join(HISTORY, `${key}.json`), json);
  written += 1;
}
fs.writeFileSync(path.join(OUT, "search-index.json"), JSON.stringify(index));
fs.writeFileSync(path.join(OUT, "sleeper-ids.json"), JSON.stringify(Object.fromEntries(Object.entries(sleeper).sort())));
fs.writeFileSync(SIDECAR, JSON.stringify(summary, null, 2) + "\n");
console.log(`  wrote ${written} of ${shards.size} shards, search-index.json, sleeper-ids.json, history-refresh.json`);
console.log("done");
