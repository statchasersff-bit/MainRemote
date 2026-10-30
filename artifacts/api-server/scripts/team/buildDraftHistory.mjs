/**
 * Build the team hubs' Draft History from the nflverse draft register.
 *
 *   node scripts/team/buildDraftHistory.mjs <season> [--cache <dir>]
 *
 * Writes data/team/draft_history.json: for every club, every pick it made in
 * the last ten drafts up to and including <season> (the draft held in April of
 * that year), oldest to newest, with the player's position, college and the
 * career counters the register carries (games, seasons started, Pro Bowls,
 * All-Pro teams, last season played).
 *
 * The register keys clubs by Pro Football Reference's codes (GNB, KAN, NWE)
 * and a few retired ones (OAK, SDG, STL); both are folded to the site's own
 * lowercase abbreviations so the page reads one file by one key.
 *
 * Positions are kept as the register lists them, with its spelling variants
 * folded to one (T and OT are both OT; SAF, FS and S are all S). The
 * tendencies the page draws use the register's broader `category` (OL, DL,
 * DB, LB and the skill spots), so an offensive lineman listed as G in one year
 * and OL in another counts the same way in both.
 *
 * Each pick also carries the player's Sleeper id (`sleeperId`), so the hub
 * can draw the headshot through the image route: from the player id
 * crosswalk, with the site's own bio id store first and the ids already in
 * the file on disk kept when the crosswalk cannot be fetched.
 *
 * Refuses to write fewer seasons than the file on disk already has: a partial
 * release of the register must not roll a hub back.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv";
/** Drafts kept per club. The page shows the last five; the rest is headroom. */
const KEEP = 10;
/** GSIS id -> Sleeper id, for the headshots. */
const CROSSWALK = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

let cacheDir = null;

/** PFR's club codes to the site's, including the codes of relocated clubs. */
const TEAM_CODES = {
  ARI: "ari", CRD: "ari", PHO: "ari",
  ATL: "atl",
  BAL: "bal", RAV: "bal",
  BUF: "buf",
  CAR: "car",
  CHI: "chi",
  CIN: "cin",
  CLE: "cle",
  DAL: "dal",
  DEN: "den",
  DET: "det",
  GB: "gb", GNB: "gb",
  HOU: "hou", HTX: "hou",
  IND: "ind", CLT: "ind",
  JAX: "jax", JAC: "jax",
  KC: "kc", KAN: "kc",
  LAC: "lac", SD: "lac", SDG: "lac",
  LAR: "lar", LA: "lar", RAM: "lar", STL: "lar",
  LV: "lv", LVR: "lv", OAK: "lv", RAI: "lv",
  MIA: "mia",
  MIN: "min",
  NE: "ne", NWE: "ne",
  NO: "no", NOR: "no",
  NYG: "nyg",
  NYJ: "nyj",
  PHI: "phi",
  PIT: "pit",
  SEA: "sea",
  SF: "sf", SFO: "sf",
  TB: "tb", TAM: "tb",
  TEN: "ten", OTI: "ten",
  WAS: "was", WSH: "was",
};

/** The register's position spellings, folded. */
const POSITION_FOLD = {
  T: "OT", OT: "OT",
  OG: "G", G: "G",
  C: "C",
  OL: "OL",
  SAF: "S", FS: "S", SS: "S", S: "S",
  DB: "DB", CB: "CB",
  ILB: "LB", OLB: "OLB", LB: "LB",
  DE: "DE", DT: "DT", NT: "DT", DL: "DL",
};

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

/** Stream a CSV, one object per row. `--cache` reads a local copy by basename. */
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

const num = (v) => {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

async function build(season) {
  const first = season - KEEP + 1;
  const teams = {};
  let kept = 0;
  const seasons = new Set();
  const unknownCodes = new Set();

  for await (const row of rows(SOURCE)) {
    const year = num(row.season);
    if (year === null || year < first || year > season) continue;
    const code = TEAM_CODES[row.team];
    if (!code) {
      unknownCodes.add(row.team);
      continue;
    }
    const position = POSITION_FOLD[row.position] ?? row.position ?? "";
    const pick = {
      season: year,
      round: num(row.round),
      pick: num(row.pick),
      name: row.pfr_player_name ?? "",
      position,
      category: row.category || position,
      side: row.side === "O" || row.side === "D" || row.side === "S" ? row.side : null,
      college: row.college ?? "",
      gsisId: row.gsis_id || null,
      sleeperId: null,
      age: num(row.age),
      lastSeason: num(row.to),
      games: num(row.games) ?? 0,
      seasonsStarted: num(row.seasons_started) ?? 0,
      proBowls: num(row.probowls) ?? 0,
      allPro: num(row.allpro) ?? 0,
    };
    if (pick.round === null || pick.pick === null || !pick.name) continue;
    (teams[code] ??= []).push(pick);
    seasons.add(year);
    kept += 1;
  }

  if (unknownCodes.size) console.warn(`  unmapped club codes skipped: ${[...unknownCodes].join(", ")}`);
  for (const list of Object.values(teams)) {
    list.sort((a, b) => a.season - b.season || a.pick - b.pick);
  }

  return {
    builtAt: new Date().toISOString(),
    latestSeason: Math.max(...seasons),
    seasons: [...seasons].sort((a, b) => a - b),
    teams: Object.fromEntries(Object.keys(teams).sort().map((k) => [k, teams[k]])),
    picks: kept,
  };
}

/**
 * Sleeper ids for the picks: the bio store's pairs first (checked by hand),
 * then the crosswalk, then whatever the file on disk already had, so a
 * player keeps a photo across a run that could not reach the crosswalk.
 */
async function attachSleeperIds(doc, previous) {
  const ids = {};
  for (const list of Object.values(previous?.teams ?? {})) {
    for (const p of list) if (p.gsisId && p.sleeperId) ids[p.gsisId] = p.sleeperId;
  }
  try {
    for await (const row of rows(CROSSWALK)) {
      if (row.gsis_id && /^\d+$/.test(row.sleeper_id ?? "")) ids[row.gsis_id] = row.sleeper_id;
    }
  } catch (err) {
    console.warn(`  crosswalk not read (${err.message}); keeping the ids on disk`);
  }
  try {
    const bio = JSON.parse(fs.readFileSync(path.join(DATA, "player", "bio_sources.json"), "utf8"));
    for (const p of Object.values(bio.players ?? {})) {
      if (p.ids?.gsis && p.ids?.sleeper) ids[p.ids.gsis] = String(p.ids.sleeper);
    }
  } catch {
    /* no bio store here */
  }
  let found = 0;
  let total = 0;
  for (const list of Object.values(doc.teams)) {
    for (const p of list) {
      total += 1;
      p.sleeperId = (p.gsisId && ids[p.gsisId]) || null;
      if (p.sleeperId) found += 1;
    }
  }
  console.log(`  sleeper ids: ${found} of ${total} picks`);
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2000) {
    console.error("usage: node scripts/team/buildDraftHistory.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);

  const doc = await build(season);
  const file = path.join(DATA, "team", "draft_history.json");
  let onDisk = 0;
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
    onDisk = previous.latestSeason ?? 0;
  } catch {
    /* no file yet */
  }
  await attachSleeperIds(doc, previous);
  if (doc.latestSeason < onDisk) {
    console.error(`  refusing to write: register ends at ${doc.latestSeason}, disk has ${onDisk}`);
    process.exit(1);
  }
  if (Object.keys(doc.teams).length !== 32) {
    console.error(`  refusing to write: ${Object.keys(doc.teams).length} clubs, expected 32`);
    process.exit(1);
  }
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `  draft history: ${doc.picks} picks, ${doc.seasons[0]}-${doc.latestSeason} -> ${path.relative(process.cwd(), file)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
