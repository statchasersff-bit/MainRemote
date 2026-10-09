/**
 * Build the rookie hit rate dataset the tool reads.
 *
 *   node scripts/rookie-hit-rates/buildData.mjs
 *
 * Reads the standalone app's committed inputs, copied unchanged into
 * `data/rookie-hit-rates/source/` from statchasersff-bit/Rookie-Hit-Rate
 * (client/public/data/*.csv and client/src/lib/player-headshots.json; copied
 * at 696e330 on 2026-10-05 and byte-identical at 9c69b00, 2026-10-08), and
 * writes `data/rookie-hit-rates/hit-rates.json`: the same rows, packed.
 *
 * Nothing is recomputed here. The positional ranks in season_finishes.csv were
 * ranked by the source's own pipeline against every player who played that
 * season (nflverse for 2017-2024, Sleeper for 2025), drafted rookie or not, so
 * they are kept exactly as the source shipped them. What changes is only the
 * packing:
 *
 * - Players are listed once, not once per format: the four ADP boards (1QB/SF x
 *   PPR/Half) repeat the same 694 players. A board row is then
 *   [player, posRank, round, pick] in the CSV's own order.
 * - Seasons are kept only for players on a board. Every lookup in the tool is
 *   by a drafted player's id, so the other ~3,000 rows could never be read.
 *   (The two duplicate player/season rows in the CSV, Chris Thompson and Ryan
 *   Griffin, are both undrafted veterans and fall out with them.)
 * - The points columns are dropped: the tool reads only games and ranks.
 * - Jacksonville is JAX, the code the rest of this app uses; the CSV says JAC.
 *
 * One input disagreement is settled here: Jaylin Lane has an age on three of
 * his four board rows and none on the fourth. The age that exists is used.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "..", "data", "rookie-hit-rates");
const SOURCE = path.join(DATA, "source");
const OUT = path.join(DATA, "hit-rates.json");

/** The source's own parser: a plain split, which its CSVs are written for. */
function readCsv(file) {
  const lines = fs.readFileSync(path.join(SOURCE, file), "utf8").trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

const intOrNull = (v) => (v === "" || v === undefined ? null : parseInt(v, 10));
const team = (code) => (code === "JAC" ? "JAX" : code || "FA");

const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const BOARDS = ["sf-ppr", "sf-hppr", "1qb-ppr", "1qb-hppr"];

const drafts = readCsv("rookie_drafts.csv").filter((r) => POSITIONS.has(r.pos));
const finishes = readCsv("season_finishes.csv");
const headshots = JSON.parse(fs.readFileSync(path.join(SOURCE, "player-headshots.json"), "utf8"));

const index = new Map();
const players = [];
for (const r of drafts) {
  const known = index.get(r.player_id);
  if (known !== undefined) {
    const p = players[known];
    if (p[1] !== r.player_name || p[2] !== r.pos || p[3] !== parseInt(r.rookie_year, 10)) {
      throw new Error(`${r.player_id}: board rows disagree on name, position or class`);
    }
    if (p[5] === null) p[5] = intOrNull(r.current_age);
    continue;
  }
  index.set(r.player_id, players.length);
  players.push([
    r.player_id,
    r.player_name,
    r.pos,
    parseInt(r.rookie_year, 10),
    team(r.current_nfl_team),
    intOrNull(r.current_age),
    r.height || "",
    intOrNull(r.weight),
    headshots[r.player_id] ?? null,
  ]);
}

const boards = Object.fromEntries(BOARDS.map((b) => [b, []]));
for (const r of drafts) {
  const key = `${r.adp_format}-${r.scoring_format}`;
  if (!boards[key]) throw new Error(`unexpected board ${key}`);
  boards[key].push([
    index.get(r.player_id),
    parseInt(r.pos_rank, 10) || 0,
    parseInt(r.rookie_round, 10),
    parseInt(r.rookie_pick, 10),
  ]);
}

const seasons = players.map(() => []);
for (const r of finishes) {
  const i = index.get(r.player_id);
  if (i === undefined) continue;
  seasons[i].push([
    parseInt(r.season, 10),
    r.pos,
    parseInt(r.games, 10),
    parseInt(r.rank_ppr, 10),
    parseInt(r.rank_hppr, 10),
    parseInt(r.rank_std, 10),
  ]);
}

const years = drafts.map((r) => parseInt(r.rookie_year, 10));
const seasonYears = finishes.map((r) => parseInt(r.season, 10));

const out = {
  source: "statchasersff-bit/Rookie-Hit-Rate, client/public/data (2026-07-13 data, pulled 2026-10-05)",
  firstClass: Math.min(...years),
  lastClass: Math.max(...years),
  // The source's LATEST_SEASON_WITH_DATA: the last season with a full year of
  // finishes. A class after it is "too early".
  latestSeason: Math.max(...seasonYears),
  players,
  boards,
  seasons,
};

fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
const rows = Object.values(boards).reduce((n, b) => n + b.length, 0);
const kept = seasons.reduce((n, s) => n + s.length, 0);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}: ${players.length} players, ${rows} board rows, ` +
    `${kept} seasons (${out.firstClass}-${out.lastClass} classes, finishes through ${out.latestSeason})`,
);
