/**
 * Build the team hubs' Efficiency ladders from nflverse play-by-play.
 *
 *   node scripts/team/buildEfficiency.mjs <season> [--cache <dir>]
 *
 * Writes data/team/efficiency_<season>.json: for every club, five per-play
 * rates for the offense (what it did) and the defense (what it allowed), each
 * with its rank among the 32 and the percentile that rank implies.
 *
 * Definitions, so the page and this file can never disagree:
 *
 *   - A play is a regular-season pass or run (`play_type`), not a two-point
 *     try, with an EPA value. Kneels, spikes, penalties with no play, kicks
 *     and punts are not plays.
 *   - EPA/Play       mean EPA over every play.
 *   - EPA/DB         mean EPA over dropbacks (`qb_dropback` = 1: throws, sacks
 *                    and scrambles).
 *   - EPA/Rush       mean EPA over designed runs (a run that is not a dropback).
 *   - Success Rate   share of plays with positive EPA (`success`).
 *   - Explosive %    share of plays that gained 15+ yards on a dropback or 10+
 *                    on a designed run.
 *
 * No garbage-time filter: every snap of the regular season counts, the same
 * population the Offense and Defense ladders above these are built on.
 *
 * The Pass Protection and Pass Rush ladders (added the same day) join two
 * more feeds onto the same plays:
 *
 *   - FTN charting (`n_pass_rushers` per play, keyed by game and play id).
 *     Blitz % is the share of charted dropbacks that saw 5+ rushers; the
 *     4-man rush is exactly four. EPA vs blitz / vs 4-man rush is the mean
 *     EPA of those dropbacks. The offense's rows count what it faced, the
 *     defense's what it sent.
 *   - Next Gen Stats passing (one row per passer per week, with average time
 *     to throw and attempts). The offense's Time to Throw is its passers'
 *     weeks weighted by attempts. The defense's Time to Throw Forced is the
 *     opposing passers' weeks against it, found by the week's matchup in the
 *     play-by-play, weighted the same way. Next Gen lists a passer only past
 *     an attempts floor, so a week with only mop-up throws is absent on both
 *     sides; the weights make that harmless.
 *
 * Blitz rate and time to throw have no better end, so they rank most to
 * least on both sides and the page leaves them untinted. The EPA rows rank
 * like the rest: offense descending, defense ascending.
 *
 * Ranks: the offense ranks descending on all five (more is better); the
 * defense ranks ascending (less allowed is better), so 1st is best on both
 * ladders, matching the Stats tab's rule. Ties share a rank and are marked.
 * The percentile is read off the rank - (32 - rank) / 31 - so 1st is the
 * 100th and 32nd the 0th.
 *
 * Refuses to write fewer weeks than the file on disk already has, like the
 * usage builder: a partial nflverse post must not roll a hub back.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";

/** nflverse club codes to the hub's (Sleeper's, lowercased). */
const TEAM_FIX = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const club = (t) => (t ? (TEAM_FIX[t] ?? t).toLowerCase() : null);
const CLUBS = [
  "ari", "atl", "bal", "buf", "car", "chi", "cin", "cle", "dal", "den", "det",
  "gb", "hou", "ind", "jax", "kc", "lac", "lar", "lv", "mia", "min", "ne", "no",
  "nyg", "nyj", "phi", "pit", "sea", "sf", "tb", "ten", "was",
];

const EXPLOSIVE_PASS = 15;
const EXPLOSIVE_RUSH = 10;
const BLITZ_RUSHERS = 5;

/* -------------------------------------------------------------------- CSV */

let cacheDir = null;

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

/** Stream a (possibly gzipped) CSV, one object per row. `--cache` reads local copies by basename. */
async function* rows(url) {
  const cached = cacheDir ? path.join(cacheDir, path.basename(url)) : null;
  let stream;
  if (cached && fs.existsSync(cached)) stream = fs.createReadStream(cached);
  else {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    stream = Readable.fromWeb(res.body);
  }
  if (url.endsWith(".gz")) stream = stream.pipe(zlib.createGunzip());
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
const round = (v, places) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** places) / 10 ** places;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

/* ------------------------------------------------------------- counting */

function side() {
  return {
    plays: 0, epa: 0, success: 0, explosive: 0,
    dropbacks: 0, dbEpa: 0,
    rushes: 0, rushEpa: 0,
    // FTN-charted dropbacks only.
    charted: 0, blitz: 0, blitzEpa: 0, four: 0, fourEpa: 0,
    // Next Gen passer-weeks: time to throw weighted by attempts.
    tttSum: 0, tttAtt: 0,
  };
}

/** Fold one charted dropback's rusher count into a side's tallies. */
function tallyRush(s, rushers, epa) {
  s.charted += 1;
  if (rushers >= BLITZ_RUSHERS) {
    s.blitz += 1;
    s.blitzEpa += epa;
  } else if (rushers === 4) {
    s.four += 1;
    s.fourEpa += epa;
  }
}

/** Fold one play into a side's tallies. */
function tally(s, r, epa) {
  const dropback = r.qb_dropback === "1";
  const yards = num(r.yards_gained) ?? 0;
  s.plays += 1;
  s.epa += epa;
  if (r.success === "1" || epa > 0) s.success += 1;
  if (dropback) {
    s.dropbacks += 1;
    s.dbEpa += epa;
    if (yards >= EXPLOSIVE_PASS) s.explosive += 1;
  } else {
    s.rushes += 1;
    s.rushEpa += epa;
    if (yards >= EXPLOSIVE_RUSH) s.explosive += 1;
  }
}

/** The five rates, unranked. Null where a side has nothing to divide by. */
function rates(s) {
  const per = (sum, n, places) => (n > 0 ? round(sum / n, places) : null);
  return {
    epaPlay: per(s.epa, s.plays, 2),
    epaDropback: per(s.dbEpa, s.dropbacks, 2),
    epaRush: per(s.rushEpa, s.rushes, 2),
    successRate: per(100 * s.success, s.plays, 1),
    explosiveRate: per(100 * s.explosive, s.plays, 1),
    blitzRate: per(100 * s.blitz, s.charted, 1),
    epaVsBlitz: per(s.blitzEpa, s.blitz, 2),
    epaVsFourMan: per(s.fourEpa, s.four, 2),
    timeToThrow: per(s.tttSum, s.tttAtt, 2),
  };
}

const METRICS = ["epaPlay", "epaDropback", "epaRush", "successRate", "explosiveRate"];
/** [key, defense sorts ascending] - the offense always sorts descending. */
const RUSH_METRICS = [
  ["blitzRate", false],
  ["epaVsBlitz", true],
  ["epaVsFourMan", true],
  ["timeToThrow", false],
];

/**
 * Rank one metric across the clubs: competition ranking on the rounded value
 * (two teams the page prints as +0.19 share a place), with the percentile the
 * rank implies.
 */
function rank(teams, unit, key, ascending) {
  const entries = CLUBS
    .map((c) => ({ c, v: teams[c][unit].rates[key] }))
    .filter((e) => e.v !== null)
    .sort((a, b) => (ascending ? a.v - b.v : b.v - a.v));
  const counts = new Map();
  for (const e of entries) counts.set(e.v, (counts.get(e.v) ?? 0) + 1);
  const first = new Map();
  entries.forEach((e, i) => {
    if (!first.has(e.v)) first.set(e.v, i);
    const r = first.get(e.v) + 1;
    teams[e.c][unit].ranked[key] = {
      value: e.v,
      rank: r,
      tied: counts.get(e.v) > 1,
      pct: Math.round(((32 - r) / 31) * 100),
    };
  });
}

/* ------------------------------------------------------------------ main */

async function build(season) {
  const teams = Object.fromEntries(
    CLUBS.map((c) => [c, {
      games: new Set(),
      offense: { tally: side(), rates: null, ranked: {} },
      defense: { tally: side(), rates: null, ranked: {} },
    }]),
  );
  let throughWeek = 0;
  let plays = 0;

  // FTN charting: rusher count per play. Optional - without it the blitz
  // rows are null and the page leaves them out.
  const rushers = new Map();
  try {
    console.log(`  FTN charting ${season}…`);
    for await (const r of rows(`${NFLVERSE}/ftn_charting/ftn_charting_${season}.csv`)) {
      const n = num(r.n_pass_rushers);
      if (n !== null) rushers.set(`${r.nflverse_game_id}:${r.nflverse_play_id}`, n);
    }
    console.log(`  ${rushers.size} charted plays`);
  } catch (err) {
    console.warn(`  FTN ${season} unavailable (${err.message}); no blitz rows`);
  }

  // Next Gen passing: one row per passer per week. Week 0 is the season line
  // and is skipped; the weighting rebuilds it from the weeks.
  const passerWeeks = [];
  try {
    console.log("  Next Gen passing…");
    for await (const r of rows(`${NFLVERSE}/nextgen_stats/ngs_passing.csv.gz`)) {
      if (num(r.season) !== season || r.season_type !== "REG") continue;
      const week = num(r.week);
      const ttt = num(r.avg_time_to_throw);
      const att = num(r.attempts);
      const c = club(r.team_abbr);
      if (!week || week < 1 || ttt === null || !att || !c || !teams[c]) continue;
      passerWeeks.push({ week, club: c, ttt, att });
    }
    console.log(`  ${passerWeeks.length} passer-weeks`);
  } catch (err) {
    console.warn(`  Next Gen passing unavailable (${err.message}); no time-to-throw rows`);
  }

  // week:offense -> defense, read off the plays, for the defense's side of
  // the Next Gen join.
  const opponent = new Map();

  console.log(`  play-by-play ${season}…`);
  for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
    if ((r.season_type ?? r.game_type) !== "REG") continue;
    if (r.play_type !== "pass" && r.play_type !== "run") continue;
    if (r.two_point_attempt === "1") continue;
    const epa = num(r.epa);
    if (epa === null) continue;
    const o = club(r.posteam);
    const d = club(r.defteam);
    if (!o || !d || !teams[o] || !teams[d]) continue;
    tally(teams[o].offense.tally, r, epa);
    tally(teams[d].defense.tally, r, epa);
    teams[o].games.add(r.game_id);
    teams[d].games.add(r.game_id);
    const wk = num(r.week);
    if (r.qb_dropback === "1") {
      const n = rushers.get(`${r.game_id}:${r.play_id}`);
      if (n !== undefined) {
        tallyRush(teams[o].offense.tally, n, epa);
        tallyRush(teams[d].defense.tally, n, epa);
      }
      if (wk !== null) opponent.set(`${wk}:${o}`, d);
    }
    if (wk !== null && wk > throughWeek) throughWeek = wk;
    plays += 1;
  }
  if (plays === 0) throw new Error(`no ${season} regular-season plays in the feed`);
  console.log(`  ${plays} plays through week ${throughWeek}`);

  let unmatched = 0;
  for (const pw of passerWeeks) {
    const o = teams[pw.club].offense.tally;
    o.tttSum += pw.ttt * pw.att;
    o.tttAtt += pw.att;
    const d = opponent.get(`${pw.week}:${pw.club}`);
    if (!d) {
      unmatched += 1;
      continue;
    }
    const t = teams[d].defense.tally;
    t.tttSum += pw.ttt * pw.att;
    t.tttAtt += pw.att;
  }
  if (unmatched) console.warn(`  ${unmatched} passer-weeks had no matchup in the play-by-play`);

  for (const c of CLUBS) {
    teams[c].offense.rates = rates(teams[c].offense.tally);
    teams[c].defense.rates = rates(teams[c].defense.tally);
  }
  for (const key of METRICS) {
    rank(teams, "offense", key, false);
    rank(teams, "defense", key, true);
  }
  for (const [key, defenseAscending] of RUSH_METRICS) {
    rank(teams, "offense", key, false);
    rank(teams, "defense", key, defenseAscending);
  }

  const out = {};
  for (const c of CLUBS) {
    const t = teams[c];
    const pack = (u) => ({
      plays: u.tally.plays,
      dropbacks: u.tally.dropbacks,
      rushes: u.tally.rushes,
      chartedDropbacks: u.tally.charted,
      ...Object.fromEntries(METRICS.map((k) => [k, u.ranked[k] ?? null])),
      ...Object.fromEntries(RUSH_METRICS.map(([k]) => [k, u.ranked[k] ?? null])),
    });
    out[c] = { games: t.games.size, offense: pack(t.offense), defense: pack(t.defense) };
  }

  const doc = {
    season,
    builtAt: new Date().toISOString().slice(0, 10),
    throughWeek,
    definitions: {
      play: "regular-season pass or run, not a two-point try, with an EPA value",
      epaDropback: "qb_dropback = 1: throws, sacks and scrambles",
      epaRush: "designed runs: a run that is not a dropback",
      successRate: "share of plays with positive EPA",
      explosiveRate: `share of plays gaining ${EXPLOSIVE_PASS}+ yards on a dropback or ${EXPLOSIVE_RUSH}+ on a designed run`,
      blitzRate: `share of FTN-charted dropbacks with ${BLITZ_RUSHERS}+ pass rushers; 4-man rush = exactly four`,
      timeToThrow: "Next Gen passer-weeks weighted by attempts; the defense's is the opposing passers' weeks against it",
      ranks: "offense descending, defense ascending; blitz rate and time to throw most to least on both sides; ties share a rank; percentile = (32 - rank) / 31",
    },
    teams: out,
  };

  const file = path.join(DATA, "team", `efficiency_${season}.json`);
  let onDisk = 0;
  try {
    onDisk = JSON.parse(fs.readFileSync(file, "utf8")).throughWeek ?? 0;
  } catch {
    /* first build */
  }
  if (doc.throughWeek < onDisk) {
    console.error(`  refusing to write: feed ends at week ${doc.throughWeek}, disk has ${onDisk}`);
    process.exit(1);
  }
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`  efficiency ${season}: 32 clubs through week ${throughWeek} -> ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error("usage: node scripts/team/buildEfficiency.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);
  await build(season);
}
