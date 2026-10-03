/**
 * Build the team hubs' Usage & Opportunity Report from nflverse.
 *
 *   node scripts/team/buildUsage.mjs 2026 [--cache <dir>]
 *
 * Writes `data/team/usage_<season>.json`: for every club, the numbers the Usage
 * tab draws (team environment, target tree, backfield split, run direction,
 * pass-location map, the player table and each player's advanced profile).
 * Numbers only - every sentence on the tab is written at render time from
 * these, by src/lib/team/usage-copy.ts, so nothing here is prose.
 *
 * Sources, all free, all regular season:
 *   - nflverse play-by-play - targets, carries, air yards, red/green zone,
 *     situations, run gap, pass location, pass rate over expected, pace;
 *   - nflverse snap_counts (PFR) - weekly offensive snap share;
 *   - nflverse ftn_charting (FTN Data, CC-BY-SA 4.0) - `read_thrown`, which is
 *     where first-read share comes from;
 *   - ffverse ffopportunity ep_weekly - expected fantasy points (xFP) and the
 *     actual points they are compared with (FPOE), PPR;
 *   - nflverse pfr_advstats (rushing) - yards after contact;
 *   - nflverse stats_player - positions, and last season's line for the
 *     year-over-year chip;
 *   - dynastyprocess ids - gsis ↔ sleeper ↔ pfr.
 *
 * Team environment definitions (each card's NFL rank is over these exact
 * numbers, so they are the audit trail). Every one is regular season,
 * offense only, from nflverse play-by-play. Plays with play_type "no_play"
 * (wiped out by penalty), two-point tries, kneels (play_type "qb_kneel") and
 * spikes (qb_spike) are dropped first:
 *   - qualifying plays / game = (dropbacks + runs) / games. A dropback is
 *     nflverse `pass` == 1: completions, incompletions, interceptions, sacks
 *     and scrambles. A run is `rush` == 1 (designed runs). This is why it can
 *     sit under a box-score count: PFR's offensive plays include kneels and
 *     spikes (NE 2026 wk 1-3: 178 here, 180 at PFR, the gap is 2 kneels).
 *   - red-zone pass rate = dropbacks / (dropbacks + designed runs), snaps
 *     starting at the opponent's 20 or closer (yardline_100 <= 20). Sacks and
 *     scrambles count as passes, since the play was called as one (NE wk 1-3:
 *     9 passes + 2 sacks + 1 scramble vs 3 runs = 80%). Inside-the-10 rate is
 *     the same over yardline_100 <= 10.
 *   - pass rate = dropbacks / (dropbacks + designed runs), all snaps.
 *   - PROE = mean of nflverse `pass_oe` over the same snaps.
 *   - neutral pace = mean seconds between consecutive snaps of one drive,
 *     both snaps with win probability 0.2-0.8 and more than 2:00 left in the
 *     half; gaps over 60s are dropped (timeouts, reviews, quarter breaks).
 *     Pace is the one number taken before the spike filter, so a spike counts
 *     as a snap there.
 *   - team xFP / game = sum of every player's ffopportunity xFP (PPR) for the
 *     club / games. A completion credits both passer and receiver, so this is
 *     combined opportunity value, not a fixed pool the players split.
 *
 * Player per-game numbers (weighted opps, xFP, FPOE) divide by the games the
 * player was active (a snap or a touch that week), not the team's games, so a
 * back who missed time is not penalised. The page labels them "per active
 * game" and the RB ranks compare like with like. Weighted opportunities =
 * carries + 2 x targets; backfield shares use season totals.
 *
 * Pass map ("Where <QB> Attacks") = the primary passer's own attempts only
 * (most dropbacks), binned by pass_location and deep = 20+ air yards; a
 * backup's throws are left out. Attempts with no location or air yards
 * (spikes are already gone, some throwaways) are not mapped.
 * deepTargets = a player's targets 20+ air yards, from any passer.
 * rushYards = box-score rushing yards: carries, scrambles AND kneels.
 * rzTouches = red-zone opportunities: carries + targets inside the 20.
 *
 * NOT built, on purpose (the spec: omit rather than estimate): route share,
 * TPRR, YPRR, slot rate and personnel groupings. nflverse publishes
 * participation - where routes and personnel come from - only after the
 * season. A situational SNAP split for the backfield needs the same file, so
 * the backfield grid is a share of the running backs' carries + targets in
 * each situation instead, and says so on the page.
 *
 * Refuses to write fewer weeks than the file on disk already has, like the
 * other nflverse builders: a feed that lags must not roll the page back.
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
const FFOPP = "https://github.com/ffverse/ffopportunity/releases/download/latest-data";
const IDS_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

/** nflverse club codes to the hub's (Sleeper's, lowercased). */
const TEAM_FIX = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const club = (t) => (t ? (TEAM_FIX[t] ?? t).toLowerCase() : null);

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
const round = (v, places = 1) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** places) / 10 ** places;
const pct = (a, b) => (b > 0 ? (100 * a) / b : null);

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

/* ------------------------------------------------------------- helpers */

const RB_POS = new Set(["RB", "FB"]);

function ensure(map, key, make) {
  let v = map.get(key);
  if (!v) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** Percentile (0–100) of `value` within `pool`, mid-rank for ties. */
function percentile(pool, value) {
  if (value == null || pool.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of pool) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return Math.round((100 * (below + equal / 2)) / pool.length);
}

/** 1-based rank of `value` in `values` (desc unless asc), ties share the better rank. */
function rankOf(values, value, asc = false) {
  if (value == null) return null;
  return 1 + values.filter((v) => v != null && (asc ? v < value : v > value)).length;
}

/* ------------------------------------------------------------------ build */

export async function buildUsage(season) {
  const regular = (r) => (r.season_type ?? r.game_type) === "REG";

  // ---- ids
  const sleeperByGsis = new Map();
  const gsisByPfr = new Map();
  for await (const r of rows(IDS_URL)) {
    if (!r.gsis_id || r.gsis_id === "NA") continue;
    if (r.sleeper_id && r.sleeper_id !== "NA") sleeperByGsis.set(r.gsis_id, r.sleeper_id);
    if (r.pfr_id && r.pfr_id !== "NA") gsisByPfr.set(r.pfr_id, r.gsis_id);
  }

  // Sleeper names and site slugs, so a row links to the player's page and
  // spells the name the way the rest of the site does.
  const sleeper = new Map();
  try {
    const players = JSON.parse(fs.readFileSync(path.join(DATA, "player", "players.json"), "utf8"));
    for (const p of players) sleeper.set(String(p.id), p);
  } catch {
    /* names fall back to nflverse's */
  }

  // ---- positions and names (stats_player), current season
  const info = new Map(); // gsis -> {name, position}
  for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`)) {
    if (!regular(r) || !r.player_id) continue;
    if (!info.has(r.player_id)) {
      info.set(r.player_id, { name: r.player_display_name || r.player_name, position: r.position });
    }
  }

  // ---- last season's weighted opportunities per game, for the YoY chip
  const lastSeason = new Map(); // gsis -> {wopp, games}
  try {
    for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season - 1}.csv`)) {
      if (!regular(r) || !RB_POS.has(r.position)) continue;
      const carries = num(r.carries) ?? 0;
      const targets = num(r.targets) ?? 0;
      if (carries + targets === 0) continue;
      const e = ensure(lastSeason, r.player_id, () => ({ wopp: 0, games: 0 }));
      e.wopp += carries + 2 * targets;
      e.games += 1;
    }
  } catch (err) {
    console.warn(`  ${season - 1} stats_player unavailable (${err.message}); no year-over-year chip`);
  }

  // ---- FTN read_thrown, keyed game:play
  const readThrown = new Map();
  try {
    for await (const r of rows(`${NFLVERSE}/ftn_charting/ftn_charting_${season}.csv`)) {
      if (r.read_thrown && r.read_thrown !== "0") {
        readThrown.set(`${r.nflverse_game_id}:${r.nflverse_play_id}`, r.read_thrown);
      }
    }
  } catch (err) {
    console.warn(`  FTN charting unavailable (${err.message}); no first-read share`);
  }
  const firstRead = (v) => v === "1" || v === "DES";

  // ---- play by play
  const teams = new Map(); // club -> team accumulator
  const players = new Map(); // `${club}|${gsis}` -> player accumulator
  const teamWeekTargets = new Map(); // `${club}|${week}` -> targets
  const teamGamesByWeek = new Map(); // club -> Set(week)
  const weeksSeen = new Set();

  const teamAcc = (c) =>
    ensure(teams, c, () => ({
      plays: 0,
      passPlays: 0,
      rushPlays: 0,
      proeSum: 0,
      proeN: 0,
      rzPass: 0,
      rzRush: 0,
      in10Pass: 0,
      in10Rush: 0,
      paceSum: 0,
      paceN: 0,
      passAtt: 0,
      targets: 0,
      airYards: 0,
      firstReadTargets: 0,
      runs: { LE: [0, 0], LT: [0, 0], MID: [0, 0], RT: [0, 0], RE: [0, 0] },
      zones: {}, // passer gsis -> zone -> {att, yds, receivers}
      rbSituation: { early: 0, third: 0, rz: 0, in10: 0, twoMin: 0, trailing: 0 },
      dropbacks: new Map(), // passer gsis -> count
    }));

  const playerAcc = (c, id) =>
    ensure(players, `${c}|${id}`, () => ({
      club: c,
      id,
      targets: 0,
      receptions: 0,
      airYards: 0,
      ezTargets: 0,
      deepTargets: 0,
      firstReadTargets: 0,
      carries: 0,
      gzCarries: 0,
      rzTouches: 0,
      rushYards: 0,
      designedRuns: 0,
      scrambles: 0,
      dropbacks: 0,
      sacks: 0,
      passAttAir: 0,
      passAirYards: 0,
      longestRuns: [], // [yards, gap]
      situation: { early: 0, third: 0, rz: 0, in10: 0, twoMin: 0, trailing: 0 },
      weeks: new Map(), // week -> {targets, rz}
      rzOpps: 0,
    }));

  const weekAcc = (p, week) => ensure(p.weeks, week, () => ({ targets: 0, rz: 0 }));

  let last = null; // previous play, for pace
  for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
    if (!regular(r)) continue;
    const c = club(r.posteam);
    if (!c) continue;
    const week = num(r.week);
    const playType = r.play_type;
    const isPass = r.pass === "1";
    const isRush = r.rush === "1";
    const kneel = r.qb_kneel === "1";
    const spike = r.qb_spike === "1";
    const twoPt = r.two_point_attempt === "1";
    if (twoPt) continue;
    if (playType !== "pass" && playType !== "run") {
      // Kneels count nowhere else, but the box score's rushing yards include
      // them, and the QB copy quotes that number (NE 2026 wk 1-3: Maye 82).
      if (playType === "qb_kneel" && r.rusher_player_id && r.rusher_player_id !== "NA") {
        playerAcc(c, r.rusher_player_id).rushYards += num(r.rushing_yards) ?? 0;
      }
      last = null;
      continue;
    }
    weeksSeen.add(week);
    ensure(teamGamesByWeek, c, () => new Set()).add(week);
    const t = teamAcc(c);
    const yl = num(r.yardline_100);
    const down = num(r.down);
    const wp = num(r.wp);
    const halfSecs = num(r.half_seconds_remaining);
    const gameSecs = num(r.game_seconds_remaining);
    const diff = num(r.score_differential);

    // Pace: seconds between consecutive snaps of one drive, neutral game state.
    const neutral = wp != null && wp >= 0.2 && wp <= 0.8 && halfSecs != null && halfSecs > 120;
    if (
      last &&
      neutral &&
      last.neutral &&
      last.game === r.game_id &&
      last.club === c &&
      last.drive === r.fixed_drive &&
      gameSecs != null
    ) {
      const gap = last.secs - gameSecs;
      if (gap > 0 && gap <= 60) {
        t.paceSum += gap;
        t.paceN += 1;
      }
    }
    last = { game: r.game_id, club: c, drive: r.fixed_drive, secs: gameSecs, neutral };

    if (kneel || spike) continue;
    if (isPass || isRush) {
      t.plays += 1;
      if (isPass) t.passPlays += 1;
      else t.rushPlays += 1;
      if (yl != null && yl <= 20) isPass ? (t.rzPass += 1) : (t.rzRush += 1);
      if (yl != null && yl <= 10) isPass ? (t.in10Pass += 1) : (t.in10Rush += 1);
    }
    const oe = num(r.pass_oe);
    if (oe != null) {
      t.proeSum += oe;
      t.proeN += 1;
    }

    const situations = [];
    if (down === 1 || down === 2) situations.push("early");
    if (down === 3 || down === 4) situations.push("third");
    if (yl != null && yl <= 20) situations.push("rz");
    if (yl != null && yl <= 10) situations.push("in10");
    if (halfSecs != null && halfSecs <= 120) situations.push("twoMin");
    if (diff != null && diff <= -7) situations.push("trailing");

    // Dropbacks, for the QB profile and to pick the club's passer.
    if (r.qb_dropback === "1") {
      const qb = r.passer_player_id && r.passer_player_id !== "NA" ? r.passer_player_id : r.rusher_player_id;
      if (qb && qb !== "NA") {
        t.dropbacks.set(qb, (t.dropbacks.get(qb) ?? 0) + 1);
        const q = playerAcc(c, qb);
        q.dropbacks += 1;
        if (r.sack === "1") q.sacks += 1;
        if (r.qb_scramble === "1") q.scrambles += 1;
      }
    }

    // Targets.
    if (r.pass_attempt === "1" && r.sack !== "1") {
      t.passAtt += 1;
      const air = num(r.air_yards);
      const passer = r.passer_player_id;
      if (passer && passer !== "NA" && air != null) {
        const q = playerAcc(c, passer);
        q.passAttAir += 1;
        q.passAirYards += air;
      }
      if (air != null) t.airYards += air;
      const read = readThrown.get(`${r.game_id}:${r.play_id}`);

      // Pass map, per passer: the chart is titled for the starter, so a
      // backup's throws must not land in his zones (NE 2026: Maye 80 of 86).
      if (air != null && passer && passer !== "NA" && r.pass_location && r.pass_location !== "NA") {
        const zone = `${air >= 20 ? "D" : "S"}${r.pass_location[0].toUpperCase()}`;
        const mine = (t.zones[passer] ??= {});
        const z = (mine[zone] ??= { att: 0, yds: 0, receivers: {} });
        z.att += 1;
        z.yds += num(r.passing_yards) ?? 0;
        const rec = r.receiver_player_id;
        if (rec && rec !== "NA") z.receivers[rec] = (z.receivers[rec] ?? 0) + 1;
      }

      const rec = r.receiver_player_id;
      if (rec && rec !== "NA") {
        t.targets += 1;
        teamWeekTargets.set(`${c}|${week}`, (teamWeekTargets.get(`${c}|${week}`) ?? 0) + 1);
        const p = playerAcc(c, rec);
        p.targets += 1;
        if (r.complete_pass === "1") p.receptions += 1;
        if (air != null) p.airYards += air;
        if (air != null && yl != null && air >= yl) p.ezTargets += 1;
        if (air != null && air >= 20) p.deepTargets += 1;
        if (read && firstRead(read)) {
          p.firstReadTargets += 1;
          t.firstReadTargets += 1;
        }
        const w = weekAcc(p, week);
        w.targets += 1;
        if (yl != null && yl <= 20) {
          p.rzTouches += 1;
          w.rz += 1;
        }
        if (RB_POS.has(info.get(rec)?.position)) {
          for (const s of situations) {
            p.situation[s] += 1;
            t.rbSituation[s] += 1;
          }
        }
      }
    }

    // Carries (scrambles included as carries, as the box score counts them).
    if (isRush || r.qb_scramble === "1") {
      const runner = r.rusher_player_id;
      if (runner && runner !== "NA") {
        const p = playerAcc(c, runner);
        p.carries += 1;
        p.rushYards += num(r.rushing_yards) ?? 0;
        if (yl != null && yl <= 10) p.gzCarries += 1;
        const w = weekAcc(p, week);
        if (yl != null && yl <= 20) {
          p.rzTouches += 1;
          w.rz += 1;
        }
        const designed = playType === "run" && r.qb_scramble !== "1";
        if (designed) p.designedRuns += 1;
        if (RB_POS.has(info.get(runner)?.position)) {
          for (const s of situations) {
            p.situation[s] += 1;
            t.rbSituation[s] += 1;
          }
        }
        // Run direction: designed runs only.
        if (designed) {
          const loc = r.run_location;
          const gap = r.run_gap;
          let bucket = null;
          if (loc === "middle" || gap === "guard") bucket = "MID";
          else if (loc === "left") bucket = gap === "end" ? "LE" : gap === "tackle" ? "LT" : null;
          else if (loc === "right") bucket = gap === "end" ? "RE" : gap === "tackle" ? "RT" : null;
          if (bucket) {
            const yards = num(r.yards_gained) ?? 0;
            t.runs[bucket][0] += 1;
            t.runs[bucket][1] += yards;
            p.longestRuns.push([yards, bucket]);
          }
        }
      }
    }
  }

  const weeks = [...weeksSeen].filter((w) => w != null).sort((a, b) => a - b);
  const throughWeek = weeks[weeks.length - 1] ?? 0;

  // ---- snaps
  const snaps = new Map(); // `${club}|${gsis}` -> Map(week -> pct)
  const snapTotals = new Map(); // `${club}|${gsis}` -> {snaps, teamSnaps}
  const teamSnaps = new Map(); // `${club}|${week}` -> max offense snaps
  const snapRows = [];
  for await (const r of rows(`${NFLVERSE}/snap_counts/snap_counts_${season}.csv`)) {
    if (!regular(r)) continue;
    const gsis = gsisByPfr.get(r.pfr_player_id);
    const c = club(r.team);
    const week = num(r.week);
    const off = num(r.offense_snaps) ?? 0;
    const share = num(r.offense_pct);
    if (!c || week == null) continue;
    const key = `${c}|${week}`;
    teamSnaps.set(key, Math.max(teamSnaps.get(key) ?? 0, off));
    if (gsis && off > 0) snapRows.push({ c, gsis, week, off, share });
  }
  for (const s of snapRows) {
    ensure(snaps, `${s.c}|${s.gsis}`, () => new Map()).set(s.week, s.share);
    const tot = ensure(snapTotals, `${s.c}|${s.gsis}`, () => ({ snaps: 0 }));
    tot.snaps += s.off;
  }

  // ---- expected fantasy points
  const xfp = new Map(); // `${club}|${gsis}` -> {xfp, fp, games}
  const teamXfp = new Map(); // club -> sum
  for await (const r of rows(`${FFOPP}/ep_weekly_${season}.csv`)) {
    const c = club(r.posteam);
    if (!c || !r.player_id) continue;
    const e = ensure(xfp, `${c}|${r.player_id}`, () => ({ xfp: 0, fp: 0, games: 0 }));
    const x = num(r.total_fantasy_points_exp) ?? 0;
    e.xfp += x;
    e.fp += num(r.total_fantasy_points) ?? 0;
    e.games += 1;
    teamXfp.set(c, (teamXfp.get(c) ?? 0) + x);
  }

  // ---- yards after contact
  const yac = new Map(); // gsis -> {carries, yac}
  try {
    for await (const r of rows(`${NFLVERSE}/pfr_advstats/advstats_week_rush_${season}.csv`)) {
      if (!regular(r)) continue;
      const gsis = gsisByPfr.get(r.pfr_player_id);
      if (!gsis) continue;
      const e = ensure(yac, gsis, () => ({ carries: 0, yac: 0 }));
      e.carries += num(r.carries) ?? 0;
      e.yac += num(r.rushing_yards_after_contact) ?? 0;
    }
  } catch (err) {
    console.warn(`  PFR rushing unavailable (${err.message}); no yards after contact`);
  }

  /* ---------------------------------------------------- per-player rows */

  const gamesOf = (c) => [...(teamGamesByWeek.get(c) ?? [])].sort((a, b) => a - b);

  const name = (id) => {
    const s = sleeper.get(sleeperByGsis.get(id) ?? "");
    return s?.name ?? info.get(id)?.name ?? id;
  };
  const slug = (id) => sleeper.get(sleeperByGsis.get(id) ?? "")?.slug ?? null;
  const position = (id) => {
    const p = info.get(id)?.position ?? sleeper.get(sleeperByGsis.get(id) ?? "")?.position ?? null;
    return p === "FB" ? "RB" : p;
  };

  const built = [];
  for (const p of players.values()) {
    const pos = position(p.id);
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    const t = teams.get(p.club);
    const games = gamesOf(p.club);
    const snapWeeks = snaps.get(`${p.club}|${p.id}`) ?? new Map();
    const played = new Set([...p.weeks.keys(), ...snapWeeks.keys()]);
    const gp = played.size || 1;
    const teamSnapTotal = games.reduce((s, w) => s + (snapWeeks.has(w) ? teamSnaps.get(`${p.club}|${w}`) ?? 0 : 0), 0);
    const allTeamSnaps = games.reduce((s, w) => s + (teamSnaps.get(`${p.club}|${w}`) ?? 0), 0);
    const x = xfp.get(`${p.club}|${p.id}`);
    const ya = yac.get(p.id);
    const ts = pct(p.targets, t.targets);
    const ays = pct(p.airYards, t.airYards);
    const rbRoomOpps = t.rbSituation; // totals only used for shares below

    const weekly = games.map((w) => {
      const wk = p.weeks.get(w);
      const tgts = teamWeekTargets.get(`${p.club}|${w}`) ?? 0;
      const snap = snapWeeks.get(w);
      const playedThis = snap != null || wk != null;
      return {
        week: w,
        ts: playedThis ? round(pct(wk?.targets ?? 0, tgts), 1) : null,
        snap: snap != null ? Math.round(snap * 100) : null,
        rz: playedThis ? (wk?.rz ?? 0) : null,
      };
    });

    built.push({
      club: p.club,
      id: p.id,
      name: name(p.id),
      slug: slug(p.id),
      sleeperId: sleeperByGsis.get(p.id) ?? null,
      pos,
      games: gp,
      targets: p.targets,
      receptions: p.receptions,
      carries: p.carries,
      targetShare: round(ts, 1),
      airYardsShare: round(ays, 1),
      wopr: ts != null && ays != null ? round(1.5 * (ts / 100) + 0.7 * (ays / 100), 2) : null,
      adot: p.targets ? round(p.airYards / p.targets, 1) : null,
      ezTargets: p.ezTargets,
      deepTargets: p.deepTargets,
      firstReadShare: readThrown.size && t.firstReadTargets ? round(pct(p.firstReadTargets, t.firstReadTargets), 1) : null,
      snapShare: allTeamSnaps ? round(pct(snaps.has(`${p.club}|${p.id}`) ? snapTotals.get(`${p.club}|${p.id}`).snaps : 0, allTeamSnaps), 0) : null,
      rzTouches: p.rzTouches,
      rushYards: p.rushYards,
      gzCarries: p.gzCarries,
      wopp: p.carries + 2 * p.targets,
      woppPerGame: round((p.carries + 2 * p.targets) / gp, 1),
      hvt: p.gzCarries + p.receptions,
      lastSeasonWoppPerGame: (() => {
        const l = lastSeason.get(p.id);
        return l && l.games ? round(l.wopp / l.games, 1) : null;
      })(),
      situation: p.situation,
      longestRuns: p.longestRuns.sort((a, b) => b[0] - a[0]).slice(0, 3),
      designedRunRate: p.dropbacks ? round(pct(p.designedRuns, p.dropbacks + p.designedRuns), 1) : null,
      scrambleRate: p.dropbacks ? round(pct(p.scrambles, p.dropbacks), 1) : null,
      sackRate: p.dropbacks ? round(pct(p.sacks, p.dropbacks), 1) : null,
      dropbacks: p.dropbacks,
      passAdot: p.passAttAir ? round(p.passAirYards / p.passAttAir, 1) : null,
      xfpPerGame: x && x.games ? round(x.xfp / x.games, 1) : null,
      fpoePerGame: x && x.games ? round((x.fp - x.xfp) / x.games, 1) : null,
      fpPerGame: x && x.games ? round(x.fp / x.games, 1) : null,
      yacPerAtt: ya && ya.carries ? round(ya.yac / ya.carries, 1) : null,
      weekly,
      _rbRoom: rbRoomOpps,
      _teamSnapTotal: teamSnapTotal,
    });
  }

  // RB-room shares (touch share, red-zone share) need the room's totals.
  for (const [c] of teams) {
    const rbs = built.filter((p) => p.club === c && p.pos === "RB");
    const touches = rbs.reduce((s, p) => s + p.carries + p.receptions, 0);
    const wopp = rbs.reduce((s, p) => s + p.wopp, 0);
    const room = teams.get(c).rbSituation;
    for (const p of rbs) {
      p.touchShare = touches ? round(pct(p.carries + p.receptions, touches), 0) : null;
      p.woppShare = wopp ? round(pct(p.wopp, wopp), 0) : null;
      p.rzOppShare = room.rz ? round(pct(p.situation.rz, room.rz), 0) : null;
    }
  }

  /* --------------------------------------------- league ranks and pools */

  const qualifies = (p) => {
    const g = gamesOf(p.club).length || 1;
    if (p.pos === "QB") return p.dropbacks >= 12 * g;
    if (p.pos === "RB") return p.wopp >= 5 * g;
    return p.targets >= 1.5 * g;
  };
  const pools = {};
  for (const p of built) if (qualifies(p)) (pools[p.pos] ??= []).push(p);

  // `better`: which way is good for fantasy. "none" = percentile shown, tone neutral.
  const METRICS = {
    WR: { firstReadShare: "up", airYardsShare: "up", adot: "none", ezTargets: "up", xfpPerGame: "up", fpoePerGame: "up", targetShare: "up", snapShare: "up" },
    TE: { firstReadShare: "up", airYardsShare: "up", adot: "none", ezTargets: "up", xfpPerGame: "up", fpoePerGame: "up", targetShare: "up", snapShare: "up" },
    RB: { touchShare: "up", rzOppShare: "up", gzCarries: "up", targetShare: "up", xfpPerGame: "up", fpoePerGame: "up", yacPerAtt: "up", woppPerGame: "up" },
    QB: { gzCarries: "up", designedRunRate: "up", scrambleRate: "up", passAdot: "none", xfpPerGame: "up", fpoePerGame: "up", sackRate: "down" },
  };
  for (const p of built) {
    const pool = pools[p.pos] ?? [];
    p.pct = {};
    for (const [key, better] of Object.entries(METRICS[p.pos] ?? {})) {
      const values = pool.map((q) => q[key]).filter((v) => v != null);
      const raw = percentile(values, p[key]);
      p.pct[key] = raw == null ? null : better === "down" ? 100 - raw : raw;
    }
    p.qualified = qualifies(p);
    // League rank line.
    if (p.pos === "WR" || p.pos === "TE") {
      p.leagueRank = { metric: "target share", rank: rankOf(pool.map((q) => q.targetShare), p.targetShare) };
    } else if (p.pos === "RB") {
      p.leagueRank = { metric: "weighted opportunities per game", rank: rankOf(pool.map((q) => q.woppPerGame), p.woppPerGame) };
    } else {
      p.leagueRank = { metric: "expected fantasy points per game", rank: rankOf(pool.map((q) => q.xfpPerGame), p.xfpPerGame) };
    }
    p.pool = pool.length;
    if (!p.qualified) p.leagueRank.rank = null;
  }

  // A projected weekly rank for a handcuff's role takes the RB pool's wOpp/g.
  const rbWoppPool = (pools.RB ?? []).map((p) => p.woppPerGame).sort((a, b) => b - a);

  /* ----------------------------------------------------- team documents */

  const envRaw = {};
  for (const [c, t] of teams) {
    const g = gamesOf(c).length || 1;
    envRaw[c] = {
      proe: t.proeN ? t.proeSum / t.proeN : null,
      rzPassRate: pct(t.rzPass, t.rzPass + t.rzRush),
      pace: t.paceN ? t.paceSum / t.paceN : null,
      playsPerGame: t.plays / g,
      xfpPerGame: (teamXfp.get(c) ?? 0) / g,
      in10PassRate: pct(t.in10Pass, t.in10Pass + t.in10Rush),
      passRate: pct(t.passPlays, t.plays),
    };
  }
  const allOf = (k) => Object.values(envRaw).map((e) => e[k]);
  const envEntry = (c, k, places, asc = false) => ({
    value: round(envRaw[c][k], places),
    rank: rankOf(allOf(k), envRaw[c][k], asc),
  });

  const out = {};
  for (const [c, t] of teams) {
    const roster = built.filter((p) => p.club === c);
    const passerId = [...t.dropbacks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const zones = {};
    const passerZones = (passerId && t.zones[passerId]) || {};
    const zoneTotal = Object.values(passerZones).reduce((s, z) => s + z.att, 0);
    for (const [key, z] of Object.entries(passerZones)) {
      const [topId, topN] = Object.entries(z.receivers).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      const zoneTargets = Object.values(z.receivers).reduce((s, n) => s + n, 0);
      zones[key] = {
        att: z.att,
        share: round(pct(z.att, zoneTotal), 0),
        ypa: round(z.yds / z.att, 1),
        top: topId && zoneTargets ? { id: topId, name: name(topId), share: round(pct(topN, zoneTargets), 0), targets: topN } : null,
      };
    }

    const runs = Object.fromEntries(
      Object.entries(t.runs).map(([k, [att, yds]]) => [k, { att, ypc: att ? round(yds / att, 1) : null }]),
    );

    const strip = (p) => {
      const { _rbRoom, _teamSnapTotal, ...rest } = p;
      return rest;
    };

    out[c] = {
      games: gamesOf(c),
      passAttempts: t.passAtt,
      targets: t.targets,
      passerId,
      passerZoneAttempts: zoneTotal,
      env: {
        proe: envEntry(c, "proe", 1),
        rzPassRate: envEntry(c, "rzPassRate", 0),
        pace: envEntry(c, "pace", 1, true),
        playsPerGame: envEntry(c, "playsPerGame", 1),
        xfpPerGame: envEntry(c, "xfpPerGame", 1),
        in10PassRate: envEntry(c, "in10PassRate", 0),
        passRate: envEntry(c, "passRate", 0),
      },
      rbSituationTotals: t.rbSituation,
      runs,
      zones,
      players: roster
        .filter((p) => p.targets + p.carries + p.dropbacks > 0)
        .sort((a, b) => b.wopp - a.wopp)
        .map(strip),
    };
  }

  return {
    season,
    throughWeek,
    weeks,
    builtAt: new Date().toISOString(),
    rbWoppPool,
    sources: [
      "nflverse play-by-play",
      "nflverse snap counts (PFR)",
      ...(readThrown.size ? ["FTN Data charting via nflverse (first-read share)"] : []),
      "ffopportunity expected points (xFP)",
    ],
    teams: out,
  };
}

/* ------------------------------------------------------------------- main */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error("usage: node scripts/team/buildUsage.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);

  const file = path.join(DATA, "team", `usage_${season}.json`);
  const doc = await buildUsage(season);
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
  if (Object.keys(doc.teams).length < 32) {
    console.error(`  refusing to write: only ${Object.keys(doc.teams).length} clubs in the feed`);
    process.exit(1);
  }
  writeAtomic(file, `${JSON.stringify(doc)}\n`);
  console.log(`  usage ${season}: weeks ${doc.weeks.join(",")}, ${Object.keys(doc.teams).length} clubs -> ${path.relative(process.cwd(), file)}`);
}
