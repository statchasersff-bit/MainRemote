/**
 * Build a season's advanced stats tables from scratch — the season in progress.
 *
 *   node scripts/player-stats/buildSeason.mjs <season> [--dir <data dir>] [--cache <dir>] [--check]
 *
 * 2023-2025 are cut from the snapshot the standalone app shipped (see
 * buildWeeks.mjs). There is no snapshot for a season after those, so this
 * builds one from nflverse's weekly data alone, through the same definitions
 * buildWeeks.mjs matched against that snapshot. It is re-run weekly: every
 * finished week nflverse has is in, up to week 17.
 *
 * The columns and their order, labels and default-visible flags come from the
 * newest snapshot season's served table, so the table reads the same as the
 * seasons before it. A column with no definition is left blank (printed "-"):
 *
 *   - the snapshot vendor's own charting — on-target %, pocket time, time to
 *     throw, batted passes (QB), contested-catch rate and yards after contact
 *     per reception (WR/TE, blank in the snapshot too);
 *   - routes, and everything divided by them (route %, TPRR, YPRR), until
 *     nflverse publishes the season's participation file. Then a re-run fills
 *     them in with no change here.
 *
 * Rows, as the snapshot has them: every QB with a pass attempt, every RB with
 * a carry or a target, every WR/TE with a target. Rank is by passing yards
 * (QB), scrimmage yards (RB) or receiving yards (WR/TE), and age is at
 * September 1 of the season — both checked against the 2025 snapshot.
 *
 * `--check` builds the newest snapshot season the same way and reports how its
 * rows and figures compare with the served table, instead of writing anything.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect, definitions, LAST_WEEK, placesOf, useCache } from "./buildWeeks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "..");

const POSITIONS = ["qb", "rb", "wr", "te"];
const ROUTE_KEYS = ["routes", "routePct", "targetsPerRouteRun", "yardsPerRouteRun"];

const include = {
  qb: (r) => (r.attempts ?? 0) > 0,
  rb: (r) => (r.rushAttempts ?? 0) > 0 || (r.targets ?? 0) > 0,
  wr: (r) => (r.targets ?? 0) > 0,
  te: (r) => (r.targets ?? 0) > 0,
};
const rankBy = {
  qb: (r) => r.passingYards ?? 0,
  rb: (r) => (r.rushYards ?? 0) + (r.receivingYards ?? 0),
  wr: (r) => r.receivingYards ?? 0,
  te: (r) => r.receivingYards ?? 0,
};

function ageOn(birthdate, season) {
  if (!birthdate || birthdate === "NA") return null;
  const [y, m, d] = birthdate.split("-").map(Number);
  if (!y) return null;
  return season - y - (m > 9 || (m === 9 && d > 1) ? 1 : 0);
}

function buildTable(position, season, template, collected) {
  const { tally, names, positions, people, noRoutes } = collected;
  const defs = definitions(position, tally);
  const at = typeof defs === "function" ? defs(LAST_WEEK) : defs;
  const players = tally.players[String(season)][LAST_WEEK];

  const keys = template.columns.map((c) => c.key);
  const counts = new Set(template.columns.filter((c) => c.type === "number").map((c) => c.key));
  const places = Object.fromEntries(keys.map((k) => [k, placesOf(template.rows.map((r) => r[k]))]));
  const blank = new Set(noRoutes.has(season) ? ROUTE_KEYS : []);

  let lastWeek = 0;
  const out = [];
  for (const [id, p] of players) {
    // nflverse's position, which keeps fullbacks out as the snapshot does; the
    // crosswalk's fantasy position for a player nflverse lists elsewhere
    // (Travis Hunter, a CB there and a WR here).
    const person = people.get(id);
    const listed = (positions.get(id) ?? "").toLowerCase();
    const pos = [...POSITIONS, "fb"].includes(listed) ? listed : person?.position;
    if ((pos ?? "").toLowerCase() !== position) continue;
    const last = p.last[season];
    const row = {
      rank: 0,
      playerId: person?.sleeper_id && person.sleeper_id !== "NA" ? person.sleeper_id : null,
      playerName: names.get(id) ?? person?.name ?? id,
      position: position.toUpperCase(),
      team: last?.[1] ?? null,
      age: ageOn(person?.birthdate, season),
      season,
    };
    for (const key of keys) {
      if (key in row) continue;
      const fn = at[key];
      let value = fn && !blank.has(key) ? fn(p) : null;
      if (value != null && Number.isFinite(value)) {
        const f = 10 ** places[key];
        value = counts.has(key) ? Math.round(value) : Math.round(value * f) / f;
      } else value = null;
      row[key] = value;
    }
    if (!include[position](row)) continue;
    for (const wk of p.weeks) lastWeek = Math.max(lastWeek, Number(wk.split(":")[1]));
    out.push(row);
  }

  out.sort((a, b) => rankBy[position](b) - rankBy[position](a) || a.playerName.localeCompare(b.playerName));
  out.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    updated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    season,
    week: lastWeek,
    table: template.table,
    weeks: `1-${lastWeek}`,
    // The server shrinks the qualifiers to the weeks played, and keeps this
    // season out of the multi-season table's label.
    inProgress: lastWeek < LAST_WEEK,
    // Nothing here is on weeks 1-18; the blank columns are simply blank.
    fullSeason: [],
    // Blank for every player — no source yet — so the grades leave them out.
    unavailable: keys.filter(
      (k) => !["rank", "playerId", "playerName", "position", "team", "age", "season"].includes(k) && out.every((r) => r[k] == null),
    ),
    columns: template.columns,
    rows: out,
  };
}

/** --check: our rebuild of a snapshot season against the served table. */
function compare(position, built, served) {
  const byId = new Map(served.rows.map((r) => [String(r.playerId), r]));
  const ours = new Map(built.rows.map((r) => [String(r.playerId), r]));
  const both = [...ours.keys()].filter((id) => byId.has(id));
  const onlyOurs = built.rows.filter((r) => !byId.has(String(r.playerId))).map((r) => r.playerName);
  const onlyServed = served.rows.filter((r) => !ours.has(String(r.playerId))).map((r) => r.playerName);
  const cols = [];
  for (const col of served.columns) {
    const key = col.key;
    if (["rank", "playerId", "playerName", "position", "season"].includes(key)) continue;
    if ((served.fullSeason ?? []).includes(key)) continue;
    const compared = both.filter((id) => byId.get(id)[key] != null);
    if (compared.length === 0) continue;
    const same = compared.filter((id) => {
      const a = byId.get(id)[key];
      const b = ours.get(id)[key];
      if (typeof a !== "number") return a === b;
      return b != null && Math.abs(a - b) <= Math.max(Number.isInteger(a) ? 0.5 : 0.051, 0.03 * Math.abs(a));
    }).length;
    cols.push([key, same / compared.length]);
  }
  const weak = cols.filter(([, share]) => share < 0.9).map(([k, s]) => `${k} ${(s * 100).toFixed(0)}%`);
  console.log(
    `${position}: ${built.rows.length} rows built, ${served.rows.length} served, ${both.length} in both; ` +
      `only ours ${onlyOurs.length}, only served ${onlyServed.length}\n` +
      `  columns under 90% agreement: ${weak.join(", ") || "none"}`,
  );
  if (onlyServed.length) console.log(`  only served: ${onlyServed.slice(0, 12).join(", ")}`);
  if (onlyOurs.length) console.log(`  only ours: ${onlyOurs.slice(0, 12).join(", ")}`);
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) throw new Error("usage: buildSeason.mjs <season> [--dir <data dir>] [--cache <dir>] [--check]");
  const at = process.argv.indexOf("--cache");
  if (at > 0) useCache(path.resolve(process.argv[at + 1]));
  const dirAt = process.argv.indexOf("--dir");
  const DATA = path.resolve(APP, dirAt > 0 ? process.argv[dirAt + 1] : path.join("data", "player-stats"));
  const check = process.argv.includes("--check");

  // The template: the newest season the snapshot has.
  const snapshotSeasons = fs
    .readdirSync(path.join(DATA, "source"))
    .map((f) => /^qb_(\d{4})\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort();
  const templateSeason = snapshotSeasons.at(-1);
  if (!check && snapshotSeasons.includes(season)) {
    throw new Error(`${season} is a snapshot season; buildWeeks.mjs cuts those`);
  }

  console.log(`collecting nflverse weeks for ${season}`);
  const collected = await collect([season]);

  for (const position of POSITIONS) {
    const template = JSON.parse(fs.readFileSync(path.join(DATA, `${position}_${templateSeason}.json`), "utf8"));
    const table = buildTable(position, season, template, collected);
    if (check) {
      compare(position, table, template);
      continue;
    }
    const file = path.join(DATA, `${position}_${season}.json`);
    // Never fewer weeks than the file already has. nflverse only ever adds a
    // week, so a shorter table is a failed or partial download, and this now
    // runs unattended every day (src/lib/player/live-refresh.ts).
    const lastWeek = (weeks) => Number(String(weeks ?? "").split("-").pop()) || 0;
    if (fs.existsSync(file)) {
      const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
      if (lastWeek(table.weeks) < lastWeek(onDisk.weeks)) {
        console.log(`${path.basename(file)}: kept (disk has weeks ${onDisk.weeks}, built ${table.weeks})`);
        continue;
      }
    }
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(table, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    console.log(`${path.basename(file)}: ${table.rows.length} rows, weeks ${table.weeks}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
