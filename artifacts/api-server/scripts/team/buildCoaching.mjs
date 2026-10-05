/**
 * Build the Coaching Profile & Tendencies entries for every club from
 * nflverse, per the sourced-data spec (2026-10-01).
 *
 *   node scripts/team/buildCoaching.mjs 2026 [--cache <dir>] [--force <abbr,abbr|all>]
 *
 * Two layers, deliberately separate:
 *
 *   - data/team/coaching_staff_<season>.json - the researched, hand-editable
 *     layer: who the play-caller is, his career calling stops, the staff
 *     names, the scheme notes. Titles are not play-callers, so this file is
 *     curated from reporting and reviewed by hand; the builder never invents
 *     a name or a stop.
 *   - everything numeric - computed here from nflverse play-by-play, FTN
 *     charting, player weekly stats and the games file. No tendency number
 *     on the tab is typed in by hand, so the coaching page and the usage
 *     page can never disagree about the same stat.
 *
 * Every sentence of prose is templated from the computed numbers (the
 * usage-copy.ts approach, applied at build time because this file carries
 * prose). Entries are written with verified:false for mak's sign-off pass.
 *
 * An entry already in coaching_<season>.json is preserved, not regenerated
 * (the Bills' hand-written reference entry stays byte-for-byte); pass
 * --force to rebuild named clubs anyway.
 *
 * NOT built, on purpose: personnel groupings (SumerSports holds 2026
 * personnel data but the fields sit behind SumerPass; nflverse participation
 * arrives only after the season) and the win-probability "analytics
 * alignment" row (needs a decision model we have not built). Both render
 * only for clubs whose entry carries them.
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
const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/** nflverse club codes to the hub's (Sleeper's, lowercased). */
const TEAM_FIX = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const club = (t) => (t ? (TEAM_FIX[t] ?? t).toLowerCase() : null);

const NICKNAMES = {
  ari: "Cardinals", atl: "Falcons", bal: "Ravens", buf: "Bills", car: "Panthers",
  chi: "Bears", cin: "Bengals", cle: "Browns", dal: "Cowboys", den: "Broncos",
  det: "Lions", gb: "Packers", hou: "Texans", ind: "Colts", jax: "Jaguars",
  kc: "Chiefs", lac: "Chargers", lar: "Rams", lv: "Raiders", mia: "Dolphins",
  min: "Vikings", ne: "Patriots", no: "Saints", nyg: "Giants", nyj: "Jets",
  phi: "Eagles", pit: "Steelers", sea: "Seahawks", sf: "49ers", tb: "Buccaneers",
  ten: "Titans", was: "Commanders",
};
const CLUBS = Object.keys(NICKNAMES);

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

function ensure(map, key, make) {
  let v = map.get(key);
  if (!v) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** 1-based rank of `value` among `values` (desc unless asc), ties share the better rank. */
function rankOf(values, value, asc = false) {
  if (value == null) return null;
  return 1 + values.filter((v) => v != null && (asc ? v < value : v > value)).length;
}

const ordinal = (n) => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};
const ORDINAL_WORDS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ORDINAL_COUNT_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five" };
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const ordWord = (n) => ORDINAL_WORDS[n] ?? ordinal(n);
const signed = (v, places = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(places).replace(/\.0$/, "")}`;
const SUFFIXES = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]);
const lastName = (name) => {
  const parts = name.split(" ").filter((p) => !SUFFIXES.has(p));
  return parts[parts.length - 1] ?? name;
};

/* --------------------------------------------------- tendencies, from PBP */

const RB_POS = new Set(["RB", "FB"]);

/**
 * One season's team tendency table from play-by-play + FTN charting.
 * Rate denominators follow the usage builder: regular season, two-point
 * tries dropped everywhere, kneels/spikes dropped from play counts.
 */
async function seasonTendencies(season) {
  const ftn = new Map(); // game:play -> {pa, motion, noHuddle}
  let ftnRows = 0;
  try {
    for await (const r of rows(`${NFLVERSE}/ftn_charting/ftn_charting_${season}.csv`)) {
      ftnRows += 1;
      ftn.set(`${r.nflverse_game_id}:${r.nflverse_play_id}`, {
        pa: r.is_play_action === "TRUE" || r.is_play_action === "1",
        motion: r.is_motion === "TRUE" || r.is_motion === "1",
      });
    }
  } catch (err) {
    console.warn(`  FTN ${season} unavailable (${err.message}); no play-action/motion rows`);
  }

  const teams = new Map();
  const acc = (c) =>
    ensure(teams, c, () => ({
      games: new Set(),
      lastWeek: 0,
      plays: 0,
      passPlays: 0,
      earlyPlays: 0,
      earlyPass: 0,
      proeSum: 0,
      proeN: 0,
      paceSum: 0,
      paceN: 0,
      noHuddle: 0,
      shotgun: 0,
      dropbacks: 0,
      paDropbacks: 0,
      ftnPlays: 0,
      motionPlays: 0,
      rzPass: 0,
      rzRush: 0,
      fourthShortGo: 0,
      fourthShortAll: 0,
      states: { lead: [0, 0], close: [0, 0], trail: [0, 0] }, // [pass, plays]
      defEpaSum: 0,
      defPlays: 0,
    }));

  const regular = (r) => (r.season_type ?? r.game_type) === "REG";
  let last = null;
  for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
    if (!regular(r)) continue;
    const playType = r.play_type;

    // Defensive EPA/play, for the DC card: pass+run snaps against.
    if ((playType === "pass" || playType === "run") && r.two_point_attempt !== "1") {
      const d = club(r.defteam);
      const epa = num(r.epa);
      if (d && epa != null) {
        const td = acc(d);
        td.defEpaSum += epa;
        td.defPlays += 1;
      }
    }

    const c = club(r.posteam);
    if (!c) continue;
    const t = acc(c);
    t.games.add(r.game_id);
    const wk = num(r.week);
    if (wk != null && wk > t.lastWeek) t.lastWeek = wk;
    const yl = num(r.yardline_100);
    const down = num(r.down);
    const togo = num(r.ydstogo);

    // 4th-and-short aggressiveness, opponent territory: the denominator is
    // every 4th-down snap there - punts and kicks included, or a team that
    // never goes would rate 100%.
    if (down === 4 && togo != null && togo <= 2 && yl != null && yl <= 50) {
      if (playType === "pass" || playType === "run" || playType === "punt" || playType === "field_goal") {
        if (r.two_point_attempt !== "1") {
          t.fourthShortAll += 1;
          if (playType === "pass" || playType === "run") t.fourthShortGo += 1;
        }
      }
    }

    if (r.two_point_attempt === "1") continue;
    if (playType !== "pass" && playType !== "run") {
      last = null;
      continue;
    }

    const wp = num(r.wp);
    const halfSecs = num(r.half_seconds_remaining);
    const gameSecs = num(r.game_seconds_remaining);
    const diff = num(r.score_differential);

    // Pace: seconds between consecutive snaps of one drive, neutral game
    // state - the usage builder's definition, verbatim.
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

    if (r.qb_kneel === "1" || r.qb_spike === "1") continue;

    const isPass = r.pass === "1";
    t.plays += 1;
    if (isPass) t.passPlays += 1;
    if (down === 1 || down === 2) {
      t.earlyPlays += 1;
      if (isPass) t.earlyPass += 1;
    }
    if (yl != null && yl <= 20) isPass ? (t.rzPass += 1) : (t.rzRush += 1);
    if (r.no_huddle === "1") t.noHuddle += 1;
    if (r.shotgun === "1") t.shotgun += 1;
    if (r.qb_dropback === "1") t.dropbacks += 1;

    const oe = num(r.pass_oe);
    if (oe != null) {
      t.proeSum += oe;
      t.proeN += 1;
    }

    if (diff != null) {
      const state = diff >= 7 ? "lead" : diff <= -7 ? "trail" : "close";
      t.states[state][1] += 1;
      if (isPass) t.states[state][0] += 1;
    }

    const charted = ftn.get(`${r.game_id}:${r.play_id}`);
    if (charted) {
      t.ftnPlays += 1;
      if (charted.motion) t.motionPlays += 1;
      if (charted.pa && r.qb_dropback === "1") t.paDropbacks += 1;
    }
  }

  // Collapse to rates. League average is play-weighted (sum over sums).
  const out = {};
  const tot = {
    plays: 0, passPlays: 0, earlyPlays: 0, earlyPass: 0, proeSum: 0, proeN: 0,
    paceSum: 0, paceN: 0, noHuddle: 0, shotgun: 0, dropbacks: 0, paDropbacks: 0,
    ftnPlays: 0, motionPlays: 0, rzPass: 0, rzRush: 0, fourthShortGo: 0, fourthShortAll: 0,
  };
  for (const [c, t] of teams) {
    for (const k of Object.keys(tot)) tot[k] += t[k];
    out[c] = {
      games: t.games.size,
      lastWeek: t.lastWeek || null,
      playsPerGame: round(t.plays / Math.max(1, t.games.size), 1),
      passRate: round(pct(t.passPlays, t.plays), 1),
      earlyDownPassRate: round(pct(t.earlyPass, t.earlyPlays), 1),
      proe: round(t.proeN ? t.proeSum / t.proeN : null, 1),
      pace: round(t.paceN ? t.paceSum / t.paceN : null, 1),
      noHuddleRate: round(pct(t.noHuddle, t.plays), 1),
      shotgunRate: round(pct(t.shotgun, t.plays), 1),
      paRate: t.ftnPlays ? round(pct(t.paDropbacks, Math.min(t.dropbacks, t.ftnPlays)), 1) : null,
      motionRate: t.ftnPlays ? round(pct(t.motionPlays, t.ftnPlays), 1) : null,
      rzPassRate: round(pct(t.rzPass, t.rzPass + t.rzRush), 0),
      rzPlays: t.rzPass + t.rzRush,
      fourthGoRate: t.fourthShortAll >= 3 ? round(pct(t.fourthShortGo, t.fourthShortAll), 0) : null,
      fourthShortAll: t.fourthShortAll,
      states: {
        lead: { passRate: round(pct(t.states.lead[0], t.states.lead[1]), 0), plays: t.states.lead[1] },
        close: { passRate: round(pct(t.states.close[0], t.states.close[1]), 0), plays: t.states.close[1] },
        trail: { passRate: round(pct(t.states.trail[0], t.states.trail[1]), 0), plays: t.states.trail[1] },
      },
      defEpaPlay: round(t.defPlays ? t.defEpaSum / t.defPlays : null, 2),
      defEpaRaw: t.defPlays ? t.defEpaSum / t.defPlays : null,
    };
  }
  const league = {
    passRate: round(pct(tot.passPlays, tot.plays), 0),
    earlyDownPassRate: round(pct(tot.earlyPass, tot.earlyPlays), 0),
    proe: 0,
    pace: round(tot.paceN ? tot.paceSum / tot.paceN : null, 1),
    noHuddleRate: round(pct(tot.noHuddle, tot.plays), 0),
    shotgunRate: round(pct(tot.shotgun, tot.plays), 0),
    paRate: tot.ftnPlays ? round(pct(tot.paDropbacks, Math.min(tot.dropbacks, tot.ftnPlays)), 0) : null,
    motionRate: tot.ftnPlays ? round(pct(tot.motionPlays, tot.ftnPlays), 0) : null,
    rzPassRate: round(pct(tot.rzPass, tot.rzPass + tot.rzRush), 0),
    fourthGoRate: round(pct(tot.fourthShortGo, tot.fourthShortAll), 0),
  };
  return { teams: out, league, ftnRows };
}

/* ------------------------------------- player-stat layers, by season */

/**
 * One season's per-club player layer from stats_player_week: the positional
 * target split, the lead back's share of backfield weighted opportunities
 * (carries + 2×targets, the house weighting), and each position's top PPR
 * scorer with his league-wide positional finish.
 *
 * With a `window` ({from, to} weeks, inclusive), everything - including the
 * league-wide positional ranks - is computed over that span only, so a
 * partial calling stop compares its weeks against the same weeks league-wide.
 */
async function seasonPlayers(season, window = null) {
  const clubs = new Map(); // club -> {posTargets, rbs: Map, topByPos: Map(pos -> {name, pts})}
  const leaguePts = new Map(); // `${pos}` -> Map(player_id -> pts)
  const regular = (r) => (r.season_type ?? r.game_type) === "REG";
  for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`)) {
    if (!regular(r) || !r.player_id) continue;
    if (window) {
      const wk = num(r.week);
      if (wk == null || wk < window.from || wk > window.to) continue;
    }
    const c = club(r.team);
    if (!c) continue;
    const pos = r.position;
    const entry = ensure(clubs, c, () => ({
      posTargets: { WR: 0, TE: 0, RB: 0 },
      rbs: new Map(),
      clubPts: new Map(), // `${pos}|${id}` -> {name, pts}
    }));
    const targets = num(r.targets) ?? 0;
    const carries = num(r.carries) ?? 0;
    const bucket = RB_POS.has(pos) ? "RB" : pos === "WR" ? "WR" : pos === "TE" ? "TE" : null;
    if (bucket) entry.posTargets[bucket] += targets;
    if (RB_POS.has(pos) && carries + targets > 0) {
      const rb = ensure(entry.rbs, r.player_id, () => ({ wopp: 0 }));
      rb.wopp += carries + 2 * targets;
    }
    if (["QB", "RB", "WR", "TE"].includes(pos)) {
      const ppr = num(r.fantasy_points_ppr) ?? 0;
      const lp = ensure(leaguePts, pos, () => new Map());
      lp.set(r.player_id, (lp.get(r.player_id) ?? 0) + ppr);
      const key = `${pos}|${r.player_id}`;
      const cp = ensure(entry.clubPts, key, () => ({
        name: r.player_display_name || r.player_name,
        pos,
        pts: 0,
      }));
      cp.pts += ppr;
    }
  }

  const ranked = {}; // pos -> sorted [id, pts]
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    ranked[pos] = [...(leaguePts.get(pos) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
  }
  const posRank = (pos, id) => {
    const i = ranked[pos].findIndex(([pid]) => pid === id);
    return i < 0 ? null : i + 1;
  };

  const out = {};
  for (const [c, entry] of clubs) {
    const total = entry.posTargets.WR + entry.posTargets.TE + entry.posTargets.RB;
    const wopps = [...entry.rbs.values()].map((r) => r.wopp);
    const woppSum = wopps.reduce((a, b) => a + b, 0);
    const top = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      let best = null;
      for (const [key, p] of entry.clubPts) {
        if (p.pos !== pos) continue;
        if (!best || p.pts > best.pts) best = { ...p, id: key.split("|")[1] };
      }
      top[pos] = best ? { name: best.name, rank: posRank(pos, best.id) } : null;
    }
    out[c] = {
      targetShare: {
        WR: round(pct(entry.posTargets.WR, total), 0),
        TE: round(pct(entry.posTargets.TE, total), 0),
        RB: round(pct(entry.posTargets.RB, total), 0),
      },
      leadBackShare: woppSum > 0 ? round(pct(Math.max(...wopps), woppSum), 0) : null,
      top,
    };
  }

  // League-average positional target split, same normalization.
  let W = 0, T = 0, R = 0;
  for (const entry of clubs.values()) {
    W += entry.posTargets.WR;
    T += entry.posTargets.TE;
    R += entry.posTargets.RB;
  }
  const leagueShare = {
    WR: round(pct(W, W + T + R), 0),
    TE: round(pct(T, W + T + R), 0),
    RB: round(pct(R, W + T + R), 0),
  };
  return { teams: out, leagueShare };
}

/* ------------------------------------------------ points per game, games */

/** club-season -> {ppg, rank, games}, every season, from the games file.
 *  The returned Map also carries `.window(club, season, from, to)` for a
 *  partial calling stop: ppg and rank over those weeks, ranked against every
 *  club's ppg over the same weeks. */
async function loadScoring() {
  const bySeason = new Map(); // season -> Map(club -> {pts, games})
  const byGame = new Map(); // season -> Map(club -> [{week, pts}])
  for await (const r of rows(GAMES_URL)) {
    if (r.game_type !== "REG") continue;
    const season = num(r.season);
    const hs = num(r.home_score);
    const as = num(r.away_score);
    if (season == null || hs == null || as == null) continue;
    const seasonMap = ensure(bySeason, season, () => new Map());
    const gameMap = ensure(byGame, season, () => new Map());
    const week = num(r.week);
    for (const [code, pts] of [
      [r.home_team, hs],
      [r.away_team, as],
    ]) {
      const c = club(code);
      if (!c) continue;
      const e = ensure(seasonMap, c, () => ({ pts: 0, games: 0 }));
      e.pts += pts;
      e.games += 1;
      if (week != null) ensure(gameMap, c, () => []).push({ week, pts });
    }
  }
  const out = new Map(); // `${club}|${season}` -> {ppg, rank, games}
  for (const [season, seasonMap] of bySeason) {
    const ppgs = [...seasonMap.values()].map((e) => (e.games ? e.pts / e.games : null));
    for (const [c, e] of seasonMap) {
      const ppg = e.games ? e.pts / e.games : null;
      out.set(`${c}|${season}`, { ppg: round(ppg, 1), rank: rankOf(ppgs, ppg), games: e.games, pts: e.pts });
    }
  }
  const windowCache = new Map(); // `${season}|${from}-${to}` -> Map(club -> entry)
  out.window = (c, season, from, to) => {
    const key = `${season}|${from}-${to}`;
    let seasonOut = windowCache.get(key);
    if (!seasonOut) {
      seasonOut = new Map();
      const raw = new Map();
      const ppgs = [];
      for (const [cl, games] of byGame.get(season) ?? new Map()) {
        const inWin = games.filter((g) => g.week >= from && g.week <= to);
        const ppg = inWin.length ? inWin.reduce((a, g) => a + g.pts, 0) / inWin.length : null;
        raw.set(cl, { ppg, games: inWin.length });
        if (ppg != null) ppgs.push(ppg);
      }
      for (const [cl, e] of raw) {
        seasonOut.set(cl, {
          ppg: e.ppg != null ? round(e.ppg, 1) : null,
          rank: e.ppg != null ? rankOf(ppgs, e.ppg) : null,
          games: e.games,
        });
      }
      windowCache.set(key, seasonOut);
    }
    return seasonOut.get(c) ?? null;
  };
  return out;
}

/* ----------------------------------------------------------- composition */

// `def` is the row's methodology note, opened from the table. It has to say
// what the code above counts, denominators included, because a rate that is
// right can still look wrong next to a site that counts differently.
const METRics_SPEC = [
  { key: "passRate", label: "Pass rate (all downs)", unit: "%", feed: "passRate", places: 1,
    def: "Share of offensive snaps that were dropbacks. Sacks and QB scrambles count as passes, since both began as pass plays. Kneels, spikes, two-point tries and snaps wiped out by penalty are removed. Regular season only, as is every row here." },
  { key: "proe", label: "Pass rate over expected", sub: "situation-adjusted", unit: "%", feed: "proe", signed: true, places: 1,
    def: "The average of nflverse's pass-over-expected value across the same snaps as the pass rate: whether each snap was a pass, minus the chance an average team passes in that down, distance, field position, score and time remaining. Positive means this staff passes more than the situation predicts." },
  { key: "pace", label: "Neutral pace", sub: "sec/play, neutral game state", unit: "s", feed: "pace", invert: true, places: 1,
    def: "Average seconds between back-to-back snaps on the same drive, counted only while the game is neutral: win probability between 20% and 80%, with more than two minutes left in the half. Gaps over 60 seconds (timeouts, reviews, quarter breaks) are dropped. Lower is faster." },
  { key: "earlyDownPassRate", label: "Early-down pass rate", sub: "1st & 2nd down", unit: "%", places: 1,
    def: "Pass share on every 1st- and 2nd-down snap, whatever the score - not only neutral situations. Same pass definition as the pass rate, so sacks and scrambles count as passes." },
  { key: "noHuddleRate", label: "No-huddle rate", sub: "share of offensive snaps", unit: "%", places: 1,
    def: "Share of offensive snaps the play-by-play marks as no-huddle, over the same snaps as the pass rate." },
  { key: "paRate", label: "Play-action rate", sub: "share of dropbacks, FTN charting", unit: "%", places: 1,
    def: "Share of dropbacks that FTN charting marks as play-action. The denominator is dropbacks, not pass attempts, so sacks and scrambles are in it." },
  { key: "motionRate", label: "Pre-snap motion", sub: "before or at the snap, FTN charting", unit: "%", places: 1,
    def: "Share of FTN-charted snaps with motion before or at the snap, as FTN defines it. That includes a player who motions and resets before the ball is snapped, not only one still moving when it is." },
  { key: "shotgunRate", label: "Shotgun rate", sub: "share of offensive snaps", unit: "%", places: 1,
    def: "Share of offensive snaps the play-by-play logs as shotgun, over the same snaps as the pass rate. Pistol is not tracked separately: a pistol snap counts only if the play-by-play logs it as shotgun." },
  { key: "rzPassRate", label: "Red-zone pass rate", sub: "inside the opponent's 20", feed: "rzPassRate", unit: "%", places: 0,
    def: "Pass share on snaps at the opponent's 20-yard line or closer. Sacks and scrambles count as passes; kneels, spikes, two-point tries and snaps wiped out by penalty are removed. It counts plays, not trips, so a few long red-zone drives can move it a lot early in a season." },
  { key: "fourthGoRate", label: "4th-down go rate", sub: "opponent territory, 2 yds or less", unit: "%", places: 0,
    def: "Share of 4th-and-2-or-less snaps in opponent territory (midfield included) where the offense ran a play instead of punting or attempting a field goal. Snaps wiped out by penalty are removed. Shown as - until a team has had three such snaps." },
];

const fmt = (spec, v) => {
  if (v == null) return "-";
  const n = spec.places === 0 ? Math.round(v) : round(v, spec.places ?? 1);
  if (spec.unit === "s") return `${n}s`;
  return spec.signed ? `${signed(n, 1)}%` : `${n}%`;
};

/** The fantasy read for each tendency, by direction - the shift-card library. */
// Each signal card shows its own "54% -> 80% YoY" line, so the body skips the
// numbers and carries only what the move means (mak, 2026-10-05: ~25% less
// copy per card, the bold heading does the work).
const SHIFT_COPY = {
  passRate: {
    up: ["More dropbacks.", () => `More target volume for the pass-catchers.`],
    down: ["The run game grew.", () => `The backfield's floor rises while pass-catcher ceilings compress.`],
  },
  proe: {
    up: ["A pass lean has emerged.", () => `Adjusted for situation, so the pass lean reads as intent, not game script.`],
    down: ["A run lean has emerged.", () => `Adjusted for situation, so the run lean reads as intent, not game script.`],
  },
  pace: {
    up: ["The offense sped up.", () => `Extra plays per game for every skill player.`],
    down: ["The offense slowed down.", () => `Fewer snaps trims everyone's raw opportunity.`],
  },
  earlyDownPassRate: {
    up: ["Passing on the downs that are a choice.", () => `A real lean toward the pass when the staff has the choice.`],
    down: ["Running on the downs that are a choice.", () => `The staff is choosing the ground game when it has the choice.`],
  },
  noHuddleRate: {
    up: ["Tempo is now a weapon.", () => `Tempo adds snaps across the board.`],
    down: ["The huddle is back.", () => `A more deliberate operation, usually fewer total snaps.`],
  },
  paRate: {
    up: ["More play-action.", () => `A boost to downfield receiver efficiency.`],
    down: ["Less play-action.", () => `Fewer of the scheme's easiest explosive throws.`],
  },
  motionRate: {
    up: ["More pre-snap motion.", (a, b, x) => `A more motion-heavy look than in ${x.priorSeason}.`],
    down: ["Less pre-snap motion.", (a, b, x) => `A less motion-heavy look than in ${x.priorSeason}.`],
  },
  shotgunRate: {
    up: ["More shotgun.", () => `A more spread, dropback-first identity.`],
    down: ["More under center.", () => `Under-center snaps travel with the run game and play-action.`],
  },
  rzPassRate: {
    // A play-selection rate, not a touchdown forecast: the card's note carries
    // the sample, so the body says which way it points.
    up: ["Pass-heavy in the red zone.", () => `More receiving TD opportunity, less goal-line rushing volume.`],
    down: ["Run-heavy in the red zone.", () => `More rushing TD opportunity, less for the pass-catchers.`],
  },
  fourthGoRate: {
    up: ["Going for it more.", () => `More drives continue past field-goal range.`],
    down: ["Kicking more.", () => `More of those drives end in a punt or field-goal try.`],
  },
};

/** "vs league" library for the bottom line: the two most extreme ranks. */
function leagueLean(cur, league) {
  const leans = [];
  for (const spec of METRics_SPEC) {
    const v = cur[spec.key];
    const avg = league[spec.key];
    if (v == null || avg == null) continue;
    const delta = spec.invert ? avg - v : v - avg;
    leans.push({ spec, v, avg, delta });
  }
  leans.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return leans;
}

function describeLean({ spec, v, avg, delta }) {
  const dir = delta > 0 ? "above" : "below";
  if (spec.key === "pace") {
    return `a ${delta > 0 ? "faster" : "slower"}-than-average pace (${v}s vs ${avg}s)`;
  }
  return `${spec.label.toLowerCase().replace(/ \(all downs\)/, "")} ${dir} league average (${fmt(spec, v)} vs ${fmt(spec, avg)})`;
}

function finishTone(pos, rank) {
  if (rank == null) return "plain";
  if (rank <= 10) return "good";
  if (rank >= 25) return "bad";
  return "plain";
}

/** Build one generated club entry. Numbers in, prose out - no free facts. */
function composeEntry({
  abbr, staff, cur, prior, league, priorLeague, players, scoring, season, throughWeek, playersBySeason, playersPartial,
}) {
  const nickname = NICKNAMES[abbr];
  const pc = staff.playCaller;
  const caller = pc.name;
  const callerLast = lastName(caller);
  const isHC = /head coach/i.test(pc.title);
  const priorSeasons = staff.priorSeasonsAsCaller ?? 0;
  const newCaller = priorSeasons === 0;
  const seasonsWord = `${ordWord(priorSeasons + 1)} season`;
  // A caller who left this club and came back (McDaniels: 2005-08, 2012-21,
  // 2025-) has a count but not a run. "16th season calling this offense" reads
  // as 16 unbroken years, so a broken tenure counts seasons "with play-calling
  // responsibility" instead and never says "straight" or "same system".
  const seasonsHere = [...new Set(
    (staff.callingStops ?? [])
      .filter((s) => !s.college && club(s.team) === abbr)
      .flatMap((s) => s.seasons ?? []),
  )].sort((a, b) => a - b);
  const stints = seasonsHere.filter((y, i) => i === 0 || y !== seasonsHere[i - 1] + 1).length;
  const brokenTenure = !newCaller && stints > 1;
  // Seasons in the run that ends now: 2 for McDaniels (2025-26).
  let currentRun = 0;
  for (let y = season; seasonsHere.includes(y); y--) currentRun++;
  const tenureWord = `${ordWord(priorSeasons + 1)} ${nickname} season with play-calling responsibility`;
  const stintsWord = `${ORDINAL_COUNT_WORDS[stints] ?? stints} stints`;

  /* -- tendencies table -------------------------------------------------- */
  const rows = [];
  for (const spec of METRics_SPEC) {
    const curV = cur[spec.key];
    const priorV = prior?.[spec.key];
    if (curV == null && priorV == null) continue;
    const avg = league[spec.key];
    let dir = "flat";
    let text = curV == null || priorV == null ? "-" : "steady";
    if (curV != null && priorV != null) {
      const delta = curV - priorV;
      const flat = spec.key === "pace" ? Math.abs(delta) < 0.3 : Math.abs(delta) < 0.5;
      if (spec.invert) {
        dir = flat ? "flat" : delta < 0 ? "up" : "down";
        text = flat ? "steady" : dir === "up" ? "faster" : "slower";
      } else {
        dir = flat ? "flat" : delta > 0 ? "up" : "down";
        const rank = cur.ranks?.[spec.key];
        const tail = !flat && rank != null && rank <= 8 ? ` - ${ordinal(rank)} in NFL` : "";
        text = flat ? "steady" : `${signed(delta, Number.isInteger(round(delta, 1)) ? 0 : 1)}${tail}`;
      }
    }
    const row = {
      key: spec.key,
      label: spec.label,
      ...(spec.sub ? { sub: spec.sub } : {}),
      ...(spec.def ? { def: spec.def } : {}),
      prior: fmt(spec, priorV),
      current: fmt(spec, curV),
      change: { dir, text },
      nflAvg: avg == null ? "-" : spec.signed ? "0%" : fmt({ ...spec, places: 0 }, avg),
    };
    if (spec.feed && priorV != null) {
      row.priorNum = priorV;
      row.feed = spec.feed;
      if (spec.invert) row.invert = true;
    }
    rows.push(row);
  }

  /* -- shifts: the three biggest prior→current moves --------------------- */
  const moves = [];
  for (const spec of METRics_SPEC) {
    const curV = cur[spec.key];
    const priorV = prior?.[spec.key];
    if (curV == null || priorV == null) continue;
    const delta = curV - priorV;
    const salience = spec.key === "pace" ? Math.abs(delta) * 2 : Math.abs(delta);
    const threshold = spec.key === "pace" ? 1 : 2;
    if (Math.abs(delta) < threshold) continue;
    moves.push({ spec, curV, priorV, delta, salience });
  }
  moves.sort((a, b) => b.salience - a.salience);
  const SHIFT_UNITS = {
    passRate: "pass %",
    proe: "PROE",
    pace: "sec/play",
    earlyDownPassRate: "early-down pass %",
    noHuddleRate: "no-huddle",
    paRate: "play-action",
    motionRate: "motion",
    shotgunRate: "shotgun",
    rzPassRate: "red-zone pass %",
    fourthGoRate: "4th-down go",
  };
  const rzPlays = cur.rzPlays ?? 0;
  const shiftContext = {
    team: nickname,
    span: `through ${cur.games} game${cur.games === 1 ? "" : "s"}`,
    priorSeason: season - 1,
    games: cur.games,
    early: cur.games <= 6,
    fourthSample: (cur.fourthShortAll ?? 0) < 15
      ? ` The sample is still small: ${cur.fourthShortAll} such snap${cur.fourthShortAll === 1 ? "" : "s"}.`
      : "",
    smallSample: rzPlays < 40 ? ` The sample is still small: ${rzPlays} red-zone play${rzPlays === 1 ? "" : "s"}.` : "",
    rzPlays,
    fourthShort: cur.fourthShortAll ?? 0,
  };
  // The caveat line under a signal card, kept out of the body: the sample
  // while it is early or thin. A quiet footer, not a reading instruction.
  const shiftNote = (key, x) => {
    const parts = [];
    if (x.early) parts.push(`${x.games}-game sample`);
    if (key === "rzPassRate" && x.rzPlays < 40) parts.push(`${x.rzPlays} red-zone play${x.rzPlays === 1 ? "" : "s"}`);
    if (key === "fourthGoRate" && x.fourthShort < 15) parts.push(`${x.fourthShort} such snap${x.fourthShort === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" · ") : null;
  };
  let shifts = moves.slice(0, 3).map(({ spec, curV, priorV, delta }) => {
    const dirKey = spec.invert ? (delta < 0 ? "up" : "down") : delta > 0 ? "up" : "down";
    const [heading, body] = SHIFT_COPY[spec.key][dirKey];
    return {
      key: spec.key,
      stat: fmt(spec, curV).replace("%", ""),
      unit: SHIFT_UNITS[spec.key],
      heading,
      body: body(fmt(spec, priorV), fmt(spec, curV), shiftContext),
      note: shiftNote(spec.key, shiftContext),
    };
  });
  if (shifts.length === 0) {
    // A steady profile is itself the story.
    const leans = leagueLean(cur, league).slice(0, 2);
    shifts = [
      {
        stat: fmt({ unit: "%", places: 1 }, cur.passRate).replace("%", ""),
        unit: "pass %",
        heading: "The profile is holding steady.",
        body: `No tendency has moved more than two points from last season - through Week ${throughWeek} this offense is running the same shape it ran a year ago${leans.length ? `, still defined by ${describeLean(leans[0])}` : ""}.`,
      },
    ];
  }

  /* -- staff cards -------------------------------------------------------- */
  const defRank = cur.ranks?.defEpaPlay;
  // The scheme note is the card's sub line; the body picks up after it.
  const dcBody =
    `Through Week ${throughWeek} the defense allows ${cur.defEpaPlay} EPA per play` +
    `${defRank ? ` (${ordinal(defRank)} of 32, ranked on pass and run snaps in nflverse play-by-play)` : ""}. ` +
    // What a defense does to game script is a tendency, not a result: the
    // offense still has to score for a lead to happen.
    (defRank != null && defRank >= 23
      ? `Weaker defensive efficiency can push more games into trailing scripts, which would generally support passing volume. The ${nickname} offense still determines whether those scripts materialize.`
      : defRank != null && defRank <= 10
        ? `Stronger defensive efficiency can help create more neutral or positive game scripts, which would generally support rushing volume. The ${nickname} offense still determines whether those scripts materialize.`
        : `A middle-of-the-pack unit so far - game script here is week-to-week, so check the spread before leaning on it.`);

  const ocCard = staff.ocIsCaller
    ? {
        name: staff.oc ?? caller,
        sub: "Primary play-caller",
        isCaller: true,
        hasCalledPlays: true,
        body: `Runs the offense from the call sheet${isHC ? "" : `; ${lastName(staff.hc)} retains game-management oversight`}.`,
      }
    : {
        name: staff.oc ?? "-",
        sub: staff.ocNote ?? "Does not call plays",
        hasCalledPlays: Boolean(staff.ocHasCalledPlaysBefore),
        body: staff.ocHasCalledPlaysBefore
          ? `A coordinator who has run his own offense before - which makes him the delegation scenario: if ${callerLast} ever hands off play-calling mid-season, the predictive baseline on this page changes with it. Watch the ledger above.`
          : `Has not been a primary NFL play-caller, so there is no competing track record to muddy the read: the tendencies on this page are ${callerLast}'s.`,
      };

  const continuity = {
    stat: newCaller ? "New install" : brokenTenure ? `Year ${currentRun}` : `Year ${priorSeasons + 1}`,
    sub: newCaller
      ? `${callerLast}'s first season calling the ${nickname} offense`
      : brokenTenure
        ? `${cap(ordWord(currentRun))} year of the current ${callerLast} installation; ${ordWord(priorSeasons + 1)} ${nickname} play-calling season overall`
        : `${callerLast}'s ${ordWord(priorSeasons + 1)} season calling the ${nickname} offense`,
    body: newCaller
      ? `First-year installs carry the highest tendency risk in football: terminology, staff and quarterback relationships are all new at once. Weight what this staff is doing now over anything carried forward from ${season - 1}.`
      : brokenTenure
        ? `A returning install: the same caller as ${season - 1}, back for a ${ordWord(stints)} stint here. That makes the ${season - 1} column of the table above a legitimate baseline rather than another team's data.`
        : `A continuing install: same caller, same system, ${ordWord(priorSeasons + 1)} year. That makes the ${season - 1} column of the table above a legitimate baseline rather than another team's data.`,
  };

  /* -- reliability -------------------------------------------------------- */
  const sameFamily = Boolean(staff.sameSchemeFamily);
  const explanation = newCaller
    ? sameFamily
      ? `New play-caller, but from the same scheme family as ${staff.prev2025Caller ?? "the previous staff"} - some carryover is real, but treat ${season - 1} numbers as context, not baseline.`
      : `New play-caller${staff.prev2025Caller ? ` (${staff.prev2025Caller} called plays here in ${season - 1})` : ""}. Last season's tendencies describe a different coach's offense - project from this season's sample, small as it is.`
    : brokenTenure
      ? `Same play-caller as last season: ${callerLast} returns for Year ${currentRun} of his current ${nickname} stint, his ${tenureWord}. The ${season - 1} offense is a strong stylistic baseline for ${season}.`
      : `Same play-caller as last season - his ${seasonsWord} calling this offense. Last year's tendencies are a valid baseline for projecting it.`;
  const gamesPlayed = scoring.get(`${abbr}|${season}`)?.games ?? cur.games;
  // priorSeasonsNote overrides the generic fragment when the count needs
  // qualifying (e.g. "2 full prior seasons as caller here + partial 2023").
  const ledger = staff.inSeasonChange2026
    ? staff.inSeasonChange2026
    : `${callerLast} - ${gamesPlayed} of ${gamesPlayed} games in ${season} · ${
        staff.priorSeasonsNote ??
        (priorSeasons > 0 ? `${priorSeasons} prior season${priorSeasons === 1 ? "" : "s"} as caller here` : "first season")
      }`;

  // The same ledger as data, for the card's chips. Null after an in-season
  // change of caller, where the ledger is a sentence that has to stay one.
  const ledgerStats = staff.inSeasonChange2026
    ? null
    : {
        called: gamesPlayed,
        games: gamesPlayed,
        priorSeasons,
        firstSeason: seasonsHere[0] ?? season,
        note: staff.priorSeasonsNote ?? null,
      };

  const introAnswer = newCaller
    ? `For the ${nickname} the answer is: new fingerprints. ${caller} is calling this offense for the first time in ${season}${sameFamily ? ", though from the same scheme family as his predecessor" : ""} - so the ${season} sample, not last year's, is the signal.`
    : brokenTenure
      ? `For the ${nickname} the answer is stable: ${caller} called this offense last season too - his ${tenureWord}, across ${stintsWord} - so last year's tendencies still mean something.`
      : `For the ${nickname} the answer is stable: ${caller} called this offense last season too - his ${ordWord(priorSeasons + 1)} year on its call sheet - so last year's tendencies still mean something.`;

  /* -- career path / dossier / finishes ----------------------------------- */
  const stops = (staff.callingStops ?? []).filter((s) => !s.college);
  const stopName = (s) => {
    const c = club(s.team);
    return c && NICKNAMES[c] ? NICKNAMES[c] : s.team;
  };

  // A partial calling stop (mid-season takeover or handoff) carries
  // fromWeek/toWeek and must name exactly one past season; its stats are then
  // computed over that week window only, league ranks included.
  const stopWindow = (stop) => {
    if (stop.fromWeek == null && stop.toWeek == null) return null;
    if ((stop.seasons ?? []).length !== 1 || stop.seasons[0] >= season) return null;
    return { from: stop.fromWeek ?? 1, to: stop.toWeek ?? 30 };
  };
  const windowLabel = (w) => (w.to >= 30 ? `Wks ${w.from}+` : `Wks ${w.from}-${w.to}`);
  const layerFor = (stop, yr) => {
    const w = stopWindow(stop);
    if (w && yr === stop.seasons[0]) return playersPartial.get(`${yr}|${w.from}-${w.to}`) ?? null;
    return playersBySeason.get(yr) ?? null;
  };

  const dossier = [];
  for (const stop of stops) {
    const c = club(stop.team) ?? stop.team.toLowerCase();
    const isCurrent = stop.seasons.includes(season);
    const seasonsHere = stop.seasons.filter((yr) => yr <= season);
    const win = stopWindow(stop);
    const ppgs = win
      ? [scoring.window(c, stop.seasons[0], win.from, win.to)].filter((p) => p?.ppg != null)
      : seasonsHere.map((yr) => scoring.get(`${c}|${yr}`)).filter(Boolean);
    // Pooled, not a mean of season means: total points over total games, so a
    // 3-game current season doesn't weigh the same as a full 17-game one.
    const totalGames = ppgs.reduce((a, b) => a + (b.games ?? 0), 0);
    const totalPts = ppgs.reduce((a, b) => a + (b.pts ?? (b.ppg ?? 0) * (b.games ?? 0)), 0);
    const ppg = totalGames ? round(totalPts / totalGames, 1) : null;
    // The current stop's figure is this season alone, so it sits on the same
    // line as this season's rank: a 2025-26 pool beside a 2026-only rank is two
    // periods on one line, and every other current number reads "through Week N".
    const now = isCurrent ? scoring.get(`${c}|${season}`) : null;
    const multiSeason = seasonsHere.length > 1;
    const bestRank = ppgs.length ? Math.min(...ppgs.map((p) => p.rank ?? 32)) : null;
    // Fingerprint prose from whatever layers exist for those seasons.
    const splitYears = seasonsHere.filter((yr) => layerFor(stop, yr));
    let fingerprint;
    if (splitYears.length) {
      const latest = Math.max(...splitYears);
      const layer = layerFor(stop, latest);
      const p = layer?.teams[c];
      const lg = layer?.leagueShare;
      const yearLabel = win && latest === stop.seasons[0] ? `${latest} (${windowLabel(win)})` : `${latest}`;
      if (p) {
        const parts = [];
        const leanPos = ["WR", "TE", "RB"]
          .map((pos) => ({ pos, d: (p.targetShare[pos] ?? 0) - (lg?.[pos] ?? 0) }))
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
        if (leanPos && Math.abs(leanPos.d) >= 3) {
          parts.push(
            `${leanPos.pos}s took ${p.targetShare[leanPos.pos]}% of targets (league ${lg[leanPos.pos]}%) in ${yearLabel}`,
          );
        } else if (p.targetShare.WR != null) {
          parts.push(`a league-typical WR/TE/RB target split in ${yearLabel}`);
        }
        if (p.leadBackShare != null) parts.push(`the lead back handled ${p.leadBackShare}% of backfield weighted opportunities`);
        fingerprint = `${parts.join("; ")}.`;
      }
    }
    fingerprint ??= `scoring data only for this stop - it predates our target-tracking window (2016).`;
    dossier.push({
      stop: `${stopName(stop)} · ${stop.role}`,
      years: stop.years,
      scoring: isCurrent
        ? now?.ppg != null ? `${now.ppg.toFixed(1)} ppg` : "-"
        : ppg != null ? `${ppg} ppg` : "-",
      scoringContext: isCurrent
        ? `${multiSeason ? `${season} ` : ""}through Week ${throughWeek}${now?.rank ? `, ${ordinal(now.rank)} in NFL` : ""}`
        : bestRank != null
          ? win
            ? `${ordinal(bestRank)} in NFL over ${windowLabel(win)}`
            : `best finish ${ordinal(bestRank)} in NFL`
          : "",
      ...(isCurrent ? { current: true } : {}),
      // A part-season window (e.g. three late-season games) is a stint, not "years".
      thesis: isCurrent ? "The current stop:" : `The ${stopName(stop)} ${win ? "stint" : "years"}:`,
      fingerprint,
    });
  }

  // Finishes: the last four stop-seasons with player data, plus the current pace.
  const finishSeasons = [];
  for (const stop of stops) {
    for (const yr of stop.seasons) {
      if (yr >= 2016 && yr < season && layerFor(stop, yr)) {
        finishSeasons.push({ stop, yr });
      }
    }
  }
  finishSeasons.sort((a, b) => a.yr - b.yr);
  const finishRows = finishSeasons.slice(-4).map(({ stop, yr }) => {
    const c = club(stop.team) ?? stop.team.toLowerCase();
    const p = layerFor(stop, yr)?.teams[c];
    const w = stopWindow(stop);
    const cells = ["QB", "RB", "WR", "TE"].map((pos) => {
      const t = p?.top?.[pos];
      if (!t || t.rank == null) return { text: "-", tone: "plain" };
      return {
        text: `${pos}${t.rank} · ${lastName(t.name)}`,
        tone: finishTone(pos, t.rank),
      };
    });
    return { stop: `${stopName(stop)} ${yr}`, context: w ? `${stop.role} · ${windowLabel(w)}` : stop.role, cells };
  });
  {
    const p = players.teams[abbr];
    finishRows.push({
      stop: `${NICKNAMES[abbr]} · ${season}`,
      context: `pace through Week ${throughWeek}`,
      current: true,
      cells: ["QB", "RB", "WR", "TE"].map((pos) => {
        const t = p?.top?.[pos];
        if (!t || t.rank == null) return { text: "-", tone: "plain" };
        return {
          text: `${pos}${t.rank} · ${lastName(t.name)}`,
          tone: finishTone(pos, t.rank),
        };
      }),
    });
  }
  const goodCount = finishRows.flatMap((r) => r.cells).filter((cl) => cl.tone === "good").length;
  const windowNote = finishSeasons.slice(-4).some(({ stop }) => stopWindow(stop))
    ? " A row with a week range covers only the games he called that season, ranked against the league over the same weeks."
    : "";
  const finishesNote = newCaller
    ? `${callerLast} has ${finishRows.length - 1 ? `${finishRows.length - 1} prior play-calling season${finishRows.length - 1 === 1 ? "" : "s"} in this table` : "no prior NFL play-calling seasons"}, so read the history as background and the ${season} pace row as the live read. Positional finishes are season-long PPR ranks from nflverse scoring data.${windowNote}`
    : `Positional finishes are season-long PPR ranks from nflverse scoring data.${windowNote} ${goodCount >= 4 ? `${callerLast}'s offenses have put up repeated top-ten positional seasons - the system has paid fantasy investors before.` : `Top-ten positional seasons have been scarce under ${callerLast} - price this offense on volume and matchup, not system history.`}`;

  /* -- distribution ------------------------------------------------------- */
  const distSeasons = finishSeasons.map((f) => ({ yr: f.yr, c: club(f.stop.team) ?? f.stop.team.toLowerCase(), stop: f.stop }));
  distSeasons.push({ yr: season, c: abbr, stop: null });
  const agg = { WR: 0, TE: 0, RB: 0, n: 0 };
  const lgAgg = { WR: 0, TE: 0, RB: 0, n: 0 };
  for (const { yr, c, stop } of distSeasons) {
    const data = stop ? layerFor(stop, yr) : (playersBySeason.get(yr) ?? (yr === season ? players : null));
    const p = data?.teams[c];
    const lg = data?.leagueShare;
    if (!p || p.targetShare.WR == null) continue;
    for (const pos of ["WR", "TE", "RB"]) {
      agg[pos] += p.targetShare[pos];
      lgAgg[pos] += lg[pos];
    }
    agg.n += 1;
    lgAgg.n += 1;
  }
  const distRows = ["WR", "TE", "RB"].map((pos) => {
    const label = pos === "WR" ? "Wide receivers" : pos === "TE" ? "Tight ends" : "Running backs";
    const v = agg.n ? Math.round(agg[pos] / agg.n) : null;
    const nfl = lgAgg.n ? Math.round(lgAgg[pos] / lgAgg.n) : null;
    return { label, pct: v ?? 0, nfl: nfl ?? 0, ...(v != null && nfl != null && v - nfl >= 4 ? { gold: true } : {}) };
  });
  const distLean = distRows
    .map((r) => ({ ...r, d: r.pct - r.nfl }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  const distSub =
    agg.n > 1
      ? `Target split by position across ${callerLast}'s play-calling seasons since 2016, vs. league average.`
      : `Target split by position this season - ${callerLast} has no earlier NFL play-calling seasons to average in.`;
  const distNote =
    distLean && Math.abs(distLean.d) >= 3
      // A split is scheme and roster together, so it is a tendency to watch,
      // not proof of what the scheme will do with this roster.
      ? `${agg.n > 1 ? `Across his play-calling seasons since 2016, ${callerLast}'s offenses have` : `This season ${callerLast}'s offense has`} directed a ${distLean.d > 0 ? "larger" : "smaller"} share of targets to ${distLean.label.toLowerCase()} than the league baseline (${distLean.pct}% vs ${distLean.nfl}%). That ${agg.n > 1 ? "historical " : ""}tendency is worth monitoring alongside the current roster and weekly usage.`
      : `No position runs more than a few points from league average under ${callerLast} - the target tree follows the talent here, so depth-chart changes move this split more than scheme does.`;

  /* -- backfield ---------------------------------------------------------- */
  const bfSeasons = finishSeasons.slice(-5).map((f) => ({
    yr: f.yr,
    c: club(f.stop.team) ?? f.stop.team.toLowerCase(),
    label: `'${String(f.yr).slice(2)} ${(club(f.stop.team) ?? f.stop.team).toUpperCase()}`,
    prevStaff: false,
    stop: f.stop,
  }));
  if (bfSeasons.length < 2) {
    // Not enough calling history: pad with this club's recent seasons,
    // starred because a different staff called them.
    for (let yr = season - (2 - bfSeasons.length) - (bfSeasons.length ? 0 : 1); yr < season; yr += 1) {
      if (playersBySeason.has(yr)) {
        bfSeasons.push({ yr, c: abbr, label: `'${String(yr).slice(2)}*`, prevStaff: true });
      }
    }
    bfSeasons.sort((a, b) => a.yr - b.yr);
  }
  const bfBars = [];
  for (const s of bfSeasons) {
    const layer = s.stop ? layerFor(s.stop, s.yr) : playersBySeason.get(s.yr);
    const share = layer?.teams[s.c]?.leadBackShare;
    if (share != null) bfBars.push({ label: s.label, value: share });
  }
  const curShare = players.teams[abbr]?.leadBackShare;
  bfBars.push({
    label: `'${String(season).slice(2)} ${abbr.toUpperCase()}`,
    value: curShare ?? 0,
    current: true,
    feed: true,
  });
  const hadStar = bfSeasons.some((s) => s.prevStaff);
  const bfTrend =
    bfBars.length >= 3 && bfBars.every((b, i) => i === 0 || b.value >= bfBars[i - 1].value - 2)
      ? "concentrating"
      : bfBars.length >= 3 && bfBars.every((b, i) => i === 0 || b.value <= bfBars[i - 1].value + 2)
        ? "spreading"
        : "mixed";
  const bfNote =
    `${hadStar ? "Starred seasons were a previous staff's - context, not this caller's record. " : ""}` +
    (bfTrend === "concentrating"
      ? `The trend is concentration: the lead back's share of backfield weighted opportunities (carries + 2×targets) has held or grown season over season. A clear RB1 role is the safest volume in fantasy - this backfield has one.`
      : bfTrend === "spreading"
        ? `The trend is a spread: the lead back's share of backfield weighted opportunities (carries + 2×targets) has drifted down. Committee risk is real here - price the backs on efficiency, not assumed volume.`
        : `No clean trend: the lead back's share of backfield weighted opportunities (carries + 2×targets) has moved around season to season. Treat the current split as the read and revisit it weekly.`);

  /* -- score state -------------------------------------------------------- */
  const st = cur.states;
  const scoreRows = [
    { label: "Leading by 7+", share: st.lead.passRate ?? 0, result: `${st.lead.passRate ?? "-"}% pass · ${st.lead.plays} plays` },
    { label: "Within 7", share: st.close.passRate ?? 0, result: `${st.close.passRate ?? "-"}% pass · ${st.close.plays} plays` },
    { label: "Trailing by 7+", share: st.trail.passRate ?? 0, result: `${st.trail.passRate ?? "-"}% pass · ${st.trail.plays} plays` },
  ];
  const swing =
    st.trail.passRate != null && st.lead.passRate != null ? Math.round(st.trail.passRate - st.lead.passRate) : null;
  const thinState = Math.min(st.lead.plays, st.trail.plays) < 25;
  // Graded by the size of the gap, and it says what the rates are rather than
  // what a fantasy roster should do about them.
  const swingSize = swing == null ? null : Math.abs(swing) < 3 ? "flat" : Math.abs(swing) < 10 ? "A modest" : "A clear";
  const smallBuckets = thinState || cur.games <= 6;
  const scoreNote =
    swing == null
      ? `Play counts are shown so you can weigh each bucket's sample.`
      : swingSize === "flat"
        ? `Little change by score: the ${nickname} have passed on ${st.trail.passRate}% of plays while trailing by 7+ and ${st.lead.passRate}% while leading by 7+.` +
          `${smallBuckets ? ` Each bucket remains a small early-season sample.` : ` Play counts are shown so you can weigh each bucket's sample.`}`
        : `${swingSize} pass-rate ${swing > 0 ? "increase" : "drop"} when trailing. The ${nickname} have passed on ${st.trail.passRate}% of plays while trailing by 7+, compared with ${st.lead.passRate}% while leading by 7+.` +
          ` The ${Math.abs(swing)}-point difference is worth monitoring${smallBuckets ? `, but each bucket remains a small early-season sample.` : `; play counts are shown so you can weigh each bucket's sample.`}`;

  /* -- bottom line + FAQ --------------------------------------------------- */
  const leans = leagueLean(cur, league).slice(0, 2);
  // What this page can support: whose tendencies these are, what has moved
  // since last season, the caller's history, and how big the sample is. No
  // league-wide claim (e.g. "one of the more projectable offenses") that
  // nothing on the page measures.
  const MOVE_WORDS = {
    passRate: ["pass-heavier", "run-heavier"],
    proe: ["more pass-leaning by PROE", "more run-leaning by PROE"],
    pace: ["faster-paced", "slower-paced"],
    earlyDownPassRate: ["pass-heavier on early downs", "run-heavier on early downs"],
    noHuddleRate: ["more up-tempo", "less up-tempo"],
    paRate: ["heavier on play-action", "lighter on play-action"],
    motionRate: ["more motion-heavy", "less motion-heavy"],
    shotgunRate: ["more shotgun-based", "more under-center"],
    rzPassRate: ["more pass-heavy in the red zone", "more run-heavy in the red zone"],
    fourthGoRate: ["more aggressive on short 4th downs", "less aggressive on short 4th downs"],
  };
  const moveWords = moves
    .slice(0, 3)
    .map(({ spec, delta }) => MOVE_WORDS[spec.key][(spec.invert ? delta < 0 : delta > 0) ? 0 : 1]);
  const listed =
    moveWords.length <= 1 ? moveWords.join("") : `${moveWords.slice(0, -1).join(", ")} and ${moveWords.at(-1)}`;
  const span = `${cur.games} game${cur.games === 1 ? "" : "s"}`;
  const early = cur.games <= 6;
  const bottomLine =
    `The fantasy bottom line: ${
      newCaller
        ? `${caller} is new to the ${nickname} call sheet in ${season}, so ${season - 1} tendencies describe a different coach's offense.`
        : brokenTenure
          ? `${callerLast} is in his ${ordWord(currentRun)} consecutive season of his current ${nickname} stint, giving ${season - 1} tendencies more predictive value than they would have after a play-caller change.`
          : `${callerLast} called this offense in ${season - 1} too, giving those tendencies more predictive value than they would have after a play-caller change.`
    }` +
    (moveWords.length
      ? ` Through ${span}, the ${nickname} have been ${listed} than ${newCaller ? `under the ${season - 1} staff` : `in ${season - 1}`}.`
      : ` Through ${span}, no tendency has moved more than two points from ${season - 1}.`) +
    (distLean && Math.abs(distLean.d) >= 3
      ? agg.n > 1
        ? ` Historically, ${callerLast}'s offenses have also directed ${distLean.d > 0 ? "an above" : "a below"}-average share of targets to ${distLean.label.toLowerCase()}.`
        : ` This season the offense has directed ${distLean.d > 0 ? "an above" : "a below"}-average share of targets to ${distLean.label.toLowerCase()}.`
      : "") +
    (early
      ? ` Those are useful early signals, but the ${season} sample remains only ${span}; current personnel usage should carry more weight than assuming every early tendency is permanent.`
      : ` Current personnel usage should still carry weight alongside these tendencies.`);

  const faqQuestion = `How does ${caller}'s play-calling affect ${nickname} fantasy players?`;
  const faqAnswer =
    `${
      newCaller
        ? `${caller} is a first-year play-caller for the ${nickname}, so last season's tendencies carry little predictive weight.`
        : brokenTenure
          ? `${caller} called the ${nickname} offense last season too, and ${season} is his ${tenureWord}, so last year's tendencies remain predictive.`
          : `${caller} is calling the ${nickname} offense for the ${ordWord(priorSeasons + 1)} straight season, so last year's tendencies remain predictive.`
    } Through Week ${throughWeek} ${season}, the offense shows ${leans.map(describeLean).join(" and ")}. ` +
    `The lead back handles ${curShare ?? "-"}% of backfield weighted opportunities${
      distLean && Math.abs(distLean.d) >= 3
        ? `, and the target split leans toward ${distLean.label.toLowerCase()} (${distLean.pct}% vs a ${distLean.nfl}% league average)`
        : ""
    }. The play-calling and tendency metrics on this page are computed from nflverse play-by-play and FTN charting data. Coaching roles, history and staff information are sourced separately from team and league reporting.`;

  return {
    // Sign-off lives in the staff research file: set "verified": true on a
    // team there once its checklist row in docs/COACHING-VERIFICATION.md is
    // done, and the flag survives every rebuild.
    verified: staff.verified === true,
    playCaller: {
      name: caller,
      kicker: brokenTenure
        ? [pc.title, staff.titleSeasonsNote, tenureWord[0].toUpperCase() + tenureWord.slice(1)].filter(Boolean).join(" · ")
        : `${pc.title} · ${newCaller ? "First" : ordWord(priorSeasons + 1)[0].toUpperCase() + ordWord(priorSeasons + 1).slice(1)} season as caller here · Primary play-caller`,
      tree: staff.tree ?? null,
      subline: pc.note ?? (isHC ? "The head coach keeps the call sheet." : "Play-calling runs through the coordinator."),
      careerPath: staff.careerPath ?? [],
    },
    reliability: {
      priorSeasonsAsCaller: priorSeasons,
      sameSchemeFamily: sameFamily,
      explanation,
      ledger,
      ledgerStats,
    },
    introAnswer,
    tendencies: {
      priorLabel: `${season - 1}${newCaller ? " (prev. staff)" : ` (${callerLast})`}`,
      currentLabel: `${season} (${callerLast})`,
      rows,
    },
    shifts,
    staff: {
      oc: ocCard,
      dc: {
        name: staff.dc ?? "-",
        sub: staff.dcSchemeNote ?? "-",
        body: dcBody,
      },
      continuity,
    },
    dossier: dossier.length
      ? dossier
      : [
          {
            stop: `${NICKNAMES[abbr]} · ${pc.title}`,
            years: String(season),
            scoring: scoring.get(`${abbr}|${season}`)?.ppg != null ? `${scoring.get(`${abbr}|${season}`).ppg} ppg` : "-",
            scoringContext: `through Week ${throughWeek}`,
            current: true,
            thesis: "The first stop:",
            fingerprint: `${caller}'s first NFL play-calling job - there is no earlier stop to compare against, which is exactly why the reliability meter above reads the way it does.`,
          },
        ],
    finishes: {
      heading: `Positional fantasy finishes under ${callerLast}`,
      rows: finishRows,
      note: finishesNote,
    },
    distribution: { sub: distSub, rows: distRows, note: distNote },
    backfield: {
      sub: `Lead back's share of backfield weighted opportunities, by season${hadStar ? " (* = previous staff)" : " called"}.`,
      bars: bfBars,
      note: bfNote,
    },
    scoreState: {
      sub: `Pass rate when leading, close, and trailing, ${season} through Week ${throughWeek}.`,
      rows: scoreRows,
      note: scoreNote,
    },
    bottomLine,
    faq: { question: faqQuestion, answer: faqAnswer },
  };
}

/* ------------------------------------------------------------------- main */

async function build(season, force) {
  const staffFile = path.join(DATA, "team", `coaching_staff_${season}.json`);
  const staffDoc = JSON.parse(fs.readFileSync(staffFile, "utf8"));

  const outFile = path.join(DATA, "team", `coaching_${season}.json`);
  let existing = { teams: {} };
  try {
    existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
  } catch {
    /* first build */
  }

  console.log(`  tendencies ${season}…`);
  const cur = await seasonTendencies(season);
  console.log(`  tendencies ${season - 1}…`);
  const prior = await seasonTendencies(season - 1);
  console.log("  scoring (games.csv)…");
  const scoring = await loadScoring();

  // Ranks for the current season's metrics (and defensive EPA, ascending).
  const metricKeys = METRics_SPEC.map((s) => s.key);
  for (const c of Object.keys(cur.teams)) {
    const ranks = {};
    for (const key of metricKeys) {
      const spec = METRics_SPEC.find((s) => s.key === key);
      const values = Object.values(cur.teams).map((t) => t[key]);
      ranks[key] = rankOf(values, cur.teams[c][key], Boolean(spec.invert));
    }
    // Ranked on the unrounded value: at two places several defenses share a
    // figure, and a tie takes the better rank.
    ranks.defEpaPlay = rankOf(
      Object.values(cur.teams).map((t) => t.defEpaRaw),
      cur.teams[c].defEpaRaw,
      true,
    );
    cur.teams[c].ranks = ranks;
  }

  // Player layers: the current season, the prior, and every stop season 2016+.
  const needed = new Set([season, season - 1]);
  for (const staff of Object.values(staffDoc.teams)) {
    for (const stop of staff.callingStops ?? []) {
      if (stop.college) continue;
      for (const yr of stop.seasons ?? []) if (yr >= 2016 && yr <= season) needed.add(yr);
    }
  }
  const playersBySeason = new Map();
  for (const yr of [...needed].sort()) {
    console.log(`  player stats ${yr}…`);
    try {
      playersBySeason.set(yr, await seasonPlayers(yr));
    } catch (err) {
      console.warn(`  stats_player ${yr} unavailable (${err.message})`);
    }
  }
  // Partial-stop layers: a stop with fromWeek/toWeek (one past season only)
  // gets its own week-windowed player layer, keyed `${yr}|${from}-${to}`.
  const playersPartial = new Map();
  for (const staff of Object.values(staffDoc.teams)) {
    for (const stop of staff.callingStops ?? []) {
      if (stop.college || (stop.fromWeek == null && stop.toWeek == null)) continue;
      if ((stop.seasons ?? []).length !== 1) {
        console.warn(`  partial stop ${stop.team} ${stop.years}: fromWeek/toWeek needs exactly one season - ignored`);
        continue;
      }
      const yr = stop.seasons[0];
      if (yr < 2016 || yr >= season) continue;
      const w = { from: stop.fromWeek ?? 1, to: stop.toWeek ?? 30 };
      const key = `${yr}|${w.from}-${w.to}`;
      if (playersPartial.has(key)) continue;
      console.log(`  player stats ${yr} (Wks ${w.from}-${w.to})…`);
      try {
        playersPartial.set(key, await seasonPlayers(yr, w));
      } catch (err) {
        console.warn(`  stats_player ${yr} window unavailable (${err.message})`);
      }
    }
  }

  const players = playersBySeason.get(season);
  const throughWeek = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, "team", `usage_${season}.json`), "utf8")).throughWeek;
    } catch {
      return Math.max(...Object.values(cur.teams).map((t) => t.games));
    }
  })();

  const teams = { ...existing.teams };
  let generated = 0;
  for (const abbr of CLUBS) {
    // A hand-written entry (the Bills reference) is never regenerated by
    // --force all - only by naming the club explicitly.
    if (teams[abbr]?.handWritten && !force.has(abbr)) continue;
    if (teams[abbr] && !force.has(abbr) && !force.has("all")) continue;
    const staff = staffDoc.teams[abbr];
    if (!staff) {
      console.warn(`  ${abbr}: no staff research entry - skipped`);
      continue;
    }
    if (!cur.teams[abbr]) {
      console.warn(`  ${abbr}: no ${season} play-by-play - skipped`);
      continue;
    }
    teams[abbr] = composeEntry({
      abbr,
      staff,
      cur: cur.teams[abbr],
      prior: prior.teams[abbr] ?? null,
      league: cur.league,
      priorLeague: prior.league,
      players,
      scoring,
      season,
      // This club's last played week, not the league's: on a Saturday after a
      // Thursday game the league is "through Week 4" while a Sunday team has
      // played three, and its page must not claim a week it has not played.
      throughWeek: cur.teams[abbr].lastWeek ?? throughWeek,
      playersBySeason,
      playersPartial,
    });
    generated += 1;
  }

  const doc = {
    season,
    builtAt: new Date().toISOString().slice(0, 10),
    sources: [
      "nflverse play-by-play (tendencies, score states, 4th downs, defensive EPA)",
      "FTN Data charting via nflverse, CC-BY-SA 4.0 (play action, motion)",
      "nflverse player weekly stats (target splits, backfield shares, PPR finishes)",
      "nflverse games file (points per game)",
      "curated staff research - coaching_staff file (names, play-caller, career stops)",
    ],
    teams,
  };
  writeAtomic(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`  coaching ${season}: ${generated} generated, ${Object.keys(teams).length} total -> ${path.relative(process.cwd(), outFile)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error("usage: node scripts/team/buildCoaching.mjs <season> [--cache <dir>] [--force <abbr,…|all>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);
  const forceAt = process.argv.indexOf("--force");
  const force = new Set(forceAt > 0 ? process.argv[forceAt + 1].split(",") : []);
  await build(season, force);
}
