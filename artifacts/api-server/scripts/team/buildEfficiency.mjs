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
 * The four yardage rows under the EPA rows and the sack counts on the Pass
 * Protection / Pass Rush ladders come from the same play-by-play (2026-10-26:
 * they used to be read live from the stats provider, which runs a week ahead
 * of this file after every Sunday, so one ladder printed two weeks under one
 * "through Week N" caption). They use the box-score definitions, so they still
 * agree with the official totals a reader checks them against:
 *
 *   - Yds/Play       net yards (passing net of sack yardage, plus rushing)
 *                    over pass attempts + sacks + rushing attempts. Kneels are
 *                    rushing attempts and spikes are pass attempts here, as in
 *                    every box score, and a scramble is a rushing attempt.
 *   - Yds/Pass Att   passing yards over pass attempts (sacks excluded).
 *   - Yds/Carry      rushing yards over rushing attempts.
 *   - Passer Rtg     the NFL passer rating formula over the same attempts.
 *   - Sacks          count: the offense's taken, the defense's made.
 *
 * Since 2026-10-26 (mak: "yes do it") the file also carries the box-score
 * sheet the rest of the Stats tab used to read live from the stats provider,
 * under `box.own` / `box.opponent` per club, so the whole tab is one file and
 * one week: points (final scores), net yards, first downs (penalty first
 * downs included, from every row with the ball), third and fourth downs
 * (the converted/failed columns), pass and rush touchdowns, sacks, takeaways
 * and giveaways (interceptions plus fumbles lost, charged to the club that
 * lost the ball whichever unit was on the field), penalty yards (charged to
 * the flagged club) and the pace counts. `opponent` is what opponents did
 * against the club. Checked against the provider's document for all 32
 * clubs on the day it was built: every row agrees to the printed digit.
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
/** The yardage rows' snaps: what a box score counts as a play from scrimmage. */
const BOX_PLAY_TYPES = new Set(["pass", "run", "qb_kneel", "qb_spike"]);

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
    // Box-score population (kneels and spikes included): the yardage rows.
    attempts: 0, completions: 0, passYards: 0, passTd: 0, interceptions: 0,
    sacks: 0, sackYards: 0, carries: 0, rushYards: 0,
    // Every row with this side's club in possession, no-play penalties
    // included: the Production, Turnovers and Snaps ladders.
    rushTd: 0, firstDowns: 0,
    thirdConv: 0, thirdFail: 0, fourthConv: 0, fourthFail: 0,
  };
}

/**
 * Fold one row with the ball into a side's drive tallies. Runs on every
 * regular-season row with a team in possession, not only on plays from
 * scrimmage: a first down by penalty is a `no_play` row, and the third-down
 * columns are set on the penalty that converted or failed one.
 */
function tallyDrive(s, r) {
  // The three components, not `first_down`: a play that earns one by the
  // catch AND by a penalty is two first downs in the book and one flag in
  // that column.
  if (r.first_down_pass === "1") s.firstDowns += 1;
  if (r.first_down_rush === "1") s.firstDowns += 1;
  if (r.first_down_penalty === "1") s.firstDowns += 1;
  if (r.rush_touchdown === "1") s.rushTd += 1;
  if (r.third_down_converted === "1") s.thirdConv += 1;
  if (r.third_down_failed === "1") s.thirdFail += 1;
  if (r.fourth_down_converted === "1") s.fourthConv += 1;
  if (r.fourth_down_failed === "1") s.fourthFail += 1;
}

/** Per club, not per side: penalties and turnovers are charged to a team whichever unit was on the field. */
function clubBox() {
  return { points: 0, pointsAllowed: 0, penaltyYards: 0, oppPenaltyYards: 0, giveaways: 0, takeaways: 0 };
}

/**
 * One split of the Stats tab's box-score sheet, in the shape the loader's
 * `Side` had when it read the stats provider, so the tab's definitions, ranks
 * and formats are untouched. `own` is built from the offense tallies and the
 * club's own figures; `opponent` from the defense tallies (what opponents did
 * against this club) and the mirror of the club's figures.
 */
function boxSide(s, games, points, penaltyYards, takeaways, giveaways) {
  const per = (sum, n) => (n > 0 ? sum / n : null);
  const pct = (a, b) => (a + b > 0 ? (100 * a) / (a + b) : null);
  const passPlays = s.attempts + s.sacks;
  const plays = passPlays + s.carries;
  const net = s.passYards + s.sackYards + s.rushYards;
  return {
    gamesPlayed: games,
    plays,
    playsPerGame: per(plays, games),
    passPlays,
    passRate: plays > 0 ? (100 * passPlays) / plays : null,
    pointsPerGame: per(points, games),
    yardsPerGame: per(net, games),
    yardsPerPlay: per(net, plays),
    passYardsPerGame: per(s.passYards + s.sackYards, games),
    rushYardsPerGame: per(s.rushYards, games),
    yardsPerPassAttempt: per(s.passYards, s.attempts),
    yardsPerRushAttempt: per(s.rushYards, s.carries),
    passerRating: passerRating(s),
    thirdDownPct: pct(s.thirdConv, s.thirdFail),
    fourthDownPct: pct(s.fourthConv, s.fourthFail),
    firstDownsPerGame: per(s.firstDowns, games),
    passAttemptsPerGame: per(s.attempts, games),
    rushAttemptsPerGame: per(s.carries, games),
    passingTouchdowns: s.passTd,
    rushingTouchdowns: s.rushTd,
    sacks: s.sacks,
    takeaways,
    giveaways,
    turnoverMargin: takeaways - giveaways,
    penaltyYardsPerGame: per(penaltyYards, games),
  };
}

/**
 * Fold one snap into a side's box-score tallies. Every play the yardage rows
 * count passes through here, including the kneels and spikes the EPA rows
 * leave out.
 */
function tallyBox(s, r) {
  if (r.sack === "1") {
    s.sacks += 1;
    s.sackYards += num(r.yards_gained) ?? 0;
  } else if (r.pass_attempt === "1") {
    s.attempts += 1;
    if (r.complete_pass === "1") {
      s.completions += 1;
      s.passYards += num(r.passing_yards) ?? 0;
    }
    if (r.pass_touchdown === "1") s.passTd += 1;
    if (r.interception === "1") s.interceptions += 1;
  }
  if (r.rush_attempt === "1") {
    s.carries += 1;
    s.rushYards += num(r.rushing_yards) ?? 0;
  }
}

/** The NFL passer rating over a side's attempts; null with none. */
function passerRating(s) {
  if (s.attempts === 0) return null;
  const clamp = (v) => Math.max(0, Math.min(2.375, v));
  const a = clamp((s.completions / s.attempts - 0.3) * 5);
  const b = clamp((s.passYards / s.attempts - 3) * 0.25);
  const c = clamp((s.passTd / s.attempts) * 20);
  const d = clamp(2.375 - (s.interceptions / s.attempts) * 25);
  return ((a + b + c + d) / 6) * 100;
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
    yardsPerPlay: per(
      s.passYards + s.sackYards + s.rushYards,
      s.attempts + s.sacks + s.carries,
      2,
    ),
    yardsPerPassAttempt: per(s.passYards, s.attempts, 2),
    yardsPerCarry: per(s.rushYards, s.carries, 2),
    passerRating: round(passerRating(s), 1),
    sacks: s.attempts + s.sacks + s.carries > 0 ? s.sacks : null,
  };
}

/**
 * The Efficiency ladder's rows: [key, offense ascending, defense ascending].
 * More is better for the offense and less allowed is better for the defense
 * on every one of these, so the offense ranks descending and the defense
 * ascending, and 1st is best on both ladders.
 */
const METRICS = [
  ["epaPlay", false, true],
  ["epaDropback", false, true],
  ["epaRush", false, true],
  ["successRate", false, true],
  ["explosiveRate", false, true],
  ["yardsPerPlay", false, true],
  ["yardsPerPassAttempt", false, true],
  ["yardsPerCarry", false, true],
  ["passerRating", false, true],
];
/**
 * The Pass Protection / Pass Rush rows, the same shape. Blitz rate and time
 * to throw rank most to least on both sides. Sacks run the other way from
 * everything else: the offense wants few (ascending) and the defense many
 * (descending).
 */
const RUSH_METRICS = [
  ["blitzRate", false, false],
  ["epaVsBlitz", false, true],
  ["epaVsFourMan", false, true],
  ["timeToThrow", false, false],
  ["sacks", true, false],
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
      weeks: new Set(),
      box: clubBox(),
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
  // game_id -> final score, for the Points/G rows.
  const scores = new Map();

  console.log(`  play-by-play ${season}…`);
  for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
    if ((r.season_type ?? r.game_type) !== "REG") continue;
    // The final score, from any row of the game: the Points/G rows.
    if (r.game_id && !scores.has(r.game_id)) {
      const home = club(r.home_team);
      const away = club(r.away_team);
      const hs = num(r.home_score);
      const as = num(r.away_score);
      if (home && away && teams[home] && teams[away] && hs !== null && as !== null) {
        scores.set(r.game_id, { home, away, hs, as });
      }
    }
    if (r.two_point_attempt === "1") continue;
    const o = club(r.posteam);
    const d = club(r.defteam);
    if (!o || !d || !teams[o] || !teams[d]) continue;
    const wk = num(r.week);
    // Drive tallies on every row with the ball, and the club-level charges
    // (a penalty on the defense is still the club's penalty; a fumble lost
    // on a punt return is still a giveaway).
    tallyDrive(teams[o].offense.tally, r);
    tallyDrive(teams[d].defense.tally, r);
    if (r.penalty === "1") {
      const flagged = club(r.penalty_team);
      const yards = num(r.penalty_yards) ?? 0;
      if (flagged === o || flagged === d) {
        const other = flagged === o ? d : o;
        teams[flagged].box.penaltyYards += yards;
        teams[other].box.oppPenaltyYards += yards;
      }
    }
    if (r.interception === "1") {
      teams[o].box.giveaways += 1;
      teams[d].box.takeaways += 1;
    }
    if (r.fumble_lost === "1") {
      const lost = club(r.fumbled_1_team);
      const loser = lost === d ? d : o;
      const gainer = loser === o ? d : o;
      teams[loser].box.giveaways += 1;
      teams[gainer].box.takeaways += 1;
    }
    // The box-score population first: kneels and spikes are attempts in the
    // yardage rows (as in every box score), never in the EPA rows.
    if (BOX_PLAY_TYPES.has(r.play_type)) {
      tallyBox(teams[o].offense.tally, r);
      tallyBox(teams[d].defense.tally, r);
      teams[o].games.add(r.game_id);
      teams[d].games.add(r.game_id);
      if (wk !== null) {
        teams[o].weeks.add(wk);
        teams[d].weeks.add(wk);
        if (wk > throughWeek) throughWeek = wk;
      }
    }
    if (r.play_type !== "pass" && r.play_type !== "run") continue;
    const epa = num(r.epa);
    if (epa === null) continue;
    tally(teams[o].offense.tally, r, epa);
    tally(teams[d].defense.tally, r, epa);
    if (r.qb_dropback === "1") {
      const n = rushers.get(`${r.game_id}:${r.play_id}`);
      if (n !== undefined) {
        tallyRush(teams[o].offense.tally, n, epa);
        tallyRush(teams[d].defense.tally, n, epa);
      }
      if (wk !== null) opponent.set(`${wk}:${o}`, d);
    }
    plays += 1;
  }
  if (plays === 0) throw new Error(`no ${season} regular-season plays in the feed`);
  console.log(`  ${plays} plays through week ${throughWeek}`);

  for (const g of scores.values()) {
    teams[g.home].box.points += g.hs;
    teams[g.home].box.pointsAllowed += g.as;
    teams[g.away].box.points += g.as;
    teams[g.away].box.pointsAllowed += g.hs;
  }

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
  for (const [key, offenseAscending, defenseAscending] of [...METRICS, ...RUSH_METRICS]) {
    rank(teams, "offense", key, offenseAscending);
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
      ...Object.fromEntries(METRICS.map(([k]) => [k, u.ranked[k] ?? null])),
      ...Object.fromEntries(RUSH_METRICS.map(([k]) => [k, u.ranked[k] ?? null])),
    });
    out[c] = {
      games: t.games.size,
      // The weeks counted, for checkTeamPages.mjs: a week the club has not
      // finished, or one it has that is missing here, is a page saying the
      // wrong thing.
      weeks: [...t.weeks].sort((a, b) => a - b),
      offense: pack(t.offense),
      defense: pack(t.defense),
      // The Stats tab's Production, Turnovers and Snaps ladders (and the
      // history table): the box-score sheet, own and opponent splits.
      box: {
        own: boxSide(t.offense.tally, t.games.size, t.box.points, t.box.penaltyYards, t.box.takeaways, t.box.giveaways),
        opponent: boxSide(t.defense.tally, t.games.size, t.box.pointsAllowed, t.box.oppPenaltyYards, t.box.giveaways, t.box.takeaways),
      },
    };
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
      yardsPerPlay: "box-score definition: net yards over pass attempts + sacks + rushing attempts; kneels and spikes count, as everywhere else",
      yardsPerPassAttempt: "passing yards over pass attempts, sacks excluded",
      yardsPerCarry: "rushing yards over rushing attempts, scrambles and kneels included",
      passerRating: "the NFL passer rating formula over the same attempts",
      sacks: "count: the offense's taken, the defense's made",
      ranks: "offense descending, defense ascending; blitz rate and time to throw most to least on both sides; sacks the other way round (offense ascending, defense descending); ties share a rank; percentile = (32 - rank) / 31",
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
