#!/usr/bin/env node
/**
 * The game story store: what happened in each played game, from nflverse's
 * play-by-play, for the recap's Overview tab (mak, 2026-11-07: "What
 * happened, why the winning team won, who made the difference, and how the
 * game changed").
 *
 * One file per season, data/matchup/game_story_<season>.json, keyed by the
 * nflverse game id ("2026_01_NE_SEA"). Per game:
 *
 *   wp     the home side's win probability before every snap, [elapsed
 *          seconds, permille], closing on the final (1000, 0 or 500);
 *   plays  the plays a recap can name: interceptions, lost fumbles,
 *          touchdowns, field goals, explosive gains (20+ passing, 15+
 *          rushing) and anything that moved the win probability 5+ points,
 *          each with its quarter, clock, both teams, the players as
 *          nflverse spells them ("D.Lock"), the home WP before and after,
 *          and the score after;
 *   injuries  "X was injured during the play" and the returns, with the
 *          quarter and clock;
 *   adv    each club's advanced offense for the Box Score tab (2026-11-08),
 *          on the team Stats tab's definitions (scripts/team/buildEfficiency.mjs):
 *          pass and run plays with an EPA, two-point tries left out;
 *          dropback = qb_dropback; explosive = 15+ on a dropback, 10+ on a
 *          run. Sums and counts, so the page divides: plays, epa, success,
 *          explosive, dropbacks, dbEpa, rushes, rushEpa, early (1st and 2nd
 *          down plays), earlyPass, airYards (completed and not), and
 *          neutral / neutralPass (win probability 20-80%, first three
 *          quarters, outside the last two minutes of the half), and hit:
 *          dropbacks on which this club's passer was sacked or hit
 *          (qb_hit or sack), the pass rush the other club generated;
 *   ff     forced fumbles, which the box score does not carry:
 *          [{ team, player }] with the player as nflverse spells him;
 *   ids    (2026-11-17) every player the game's rows name, by club, as
 *          nflverse spells him -> ESPN athlete id, from the *_player_id
 *          columns and nflverse's players.csv (gsis_id -> espn_id). The
 *          recap resolves names by this id first and falls back to name
 *          and club only when a player is missing from it.
 *
 * Plays and injuries carry nflverse's play_id (`playId`), so the recap can
 * tell when an injury came on a play it names. A shared clock is not
 * evidence of a shared play; only the id is. Plays also name the sacker
 * (`sacker`, nflverse spelling) on a sack.
 *
 * Beside it, one file per game for the Play-by-Play tab (2026-11-08):
 * data/matchup/pbp/<season>/<game id>.json, so a page loads only its own
 * game. Every official play in order (the "GAME", "END QUARTER" and "END
 * GAME" markers left out), grouped into nflverse's own drives
 * (fixed_drive), never re-derived from changes of possession. See
 * playByPlay() for the fields.
 *
 * Nothing here is written as prose: recap-overview.ts words it, and the
 * names are matched to the box score's full names at render time.
 *
 * Hand-run (no scheduler), like the other matchup builders:
 *   node scripts/matchup/buildGameStory.mjs [season ...] [--cache DIR]
 * --cache reads play_by_play_<season>.csv.gz from DIR instead of GitHub.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "..", "data", "matchup");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download/pbp";

/** nflverse club codes to the site's. */
const TEAM_FIX = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const club = (t) => (t && t !== "NA" ? (TEAM_FIX[t] ?? t) : null);

const args = process.argv.slice(2);
let cacheDir = null;
const seasons = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--cache") cacheDir = args[(i += 1)];
  else if (/^\d{4}$/.test(args[i])) seasons.push(Number(args[i]));
}
if (!seasons.length) seasons.push(new Date().getUTCMonth() < 2 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear());

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

async function* rows(url) {
  const cached = cacheDir ? path.join(cacheDir, path.basename(url)) : null;
  let stream;
  if (cached && fs.existsSync(cached)) stream = fs.createReadStream(cached);
  else {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    stream = Readable.fromWeb(res.body);
  }
  stream = stream.pipe(zlib.createGunzip());
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
const str = (v) => (v && v !== "NA" ? v : null);
const pm = (p) => (p === null ? null : Math.round(p * 1000));

const INJURED = /\b([A-Z]{2,3})-\d+-([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+)?) was injured during the play/g;
const RETURNED = /Injury Update: ([A-Z]{2,3})-\d+-([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+)?) has returned to the game/g;

const EXPLOSIVE_PASS = 15;
const EXPLOSIVE_RUSH = 10;
const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

/** "(14:56) (Shotgun) 7-J.Brissett pass ..." as "(Shotgun) J.Brissett pass ...": no clock, no jersey numbers. */
function cleanDesc(desc) {
  return desc
    .replace(/^\(\d{1,2}:\d{2}\)\s*/, "")
    .replace(/(^|[\s(,;-])\d{1,2}-(?=[A-Z][a-zA-Z'.-]*\.[A-Z])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A drive's ending, from nflverse's fixed_drive_result and the plays in it. */
function driveResult(raw, plays, lastQtr) {
  const int = plays.some((p) => p.int);
  const fum = plays.some((p) => p.fum);
  switch (raw) {
    case "Touchdown": return "td";
    case "Field goal": return "fg";
    case "Punt": return "punt";
    case "Turnover": return int ? "int" : fum ? "fumble" : "turnover";
    case "Opp touchdown": return int ? "int" : fum ? "fumble" : "turnover";
    case "Turnover on downs": return "downs";
    case "Missed field goal": return "missed_fg";
    case "Safety": return "safety";
    case "End of half": return lastQtr >= 4 ? "end_game" : "end_half";
    default: return "other";
  }
}

const SKIP_DESC = /^(GAME|END QUARTER \d+|END GAME|END OF (HALF|GAME|QUARTER)\b.*)$/i;

/**
 * The game's play-by-play: { drives, plays }.
 *   drive  { n, team, result, qtr, clock (start), start ("NE 25"), plays,
 *            yards (net), top ("3:12"), away, home (score at its end), defScore }
 *   play   { d (drive n), q, c (clock), t (team with the ball), dn, togo,
 *            at ("SEA 35"), y (yards), x (text), k (kind: pass, run, punt,
 *            field_goal, kickoff, extra_point, no_play, timeout, other),
 *            flags td, int, fum, sack, pen, fd (first down), big (20+ yards),
 *            score (a scoring play), away, home (the score after it) }
 * Flags are present only when true, to keep the file small.
 */
function playByPlay(rs, g) {
  const plays = [];
  const drives = new Map();
  const ints = (v) => v === "1";
  for (const r of rs) {
    const desc = (r.desc ?? "").trim();
    if (!desc || SKIP_DESC.test(desc)) continue;
    const d = num(r.fixed_drive);
    const type = str(r.play_type);
    const yds = num(r.yards_gained);
    const away = num(r.total_away_score);
    const home = num(r.total_home_score);
    const prev = plays.length ? plays[plays.length - 1] : null;
    const p = {
      d,
      q: num(r.qtr),
      c: str(r.time),
      t: club(r.posteam),
      dn: num(r.down),
      togo: num(r.ydstogo),
      at: str(r.yrdln),
      y: yds,
      x: cleanDesc(desc),
      k: /timeout/i.test(desc) && !type ? "timeout" : (type ?? "other"),
      away,
      home,
    };
    if (ints(r.touchdown)) p.td = 1;
    if (ints(r.interception)) p.int = 1;
    if (ints(r.fumble_lost)) p.fum = 1;
    if (ints(r.sack)) p.sack = 1;
    if (ints(r.penalty)) p.pen = 1;
    if (ints(r.first_down)) p.fd = 1;
    if (yds !== null && yds >= 20 && (type === "pass" || type === "run")) p.big = 1;
    if (prev && away !== null && home !== null && (away !== prev.away || home !== prev.home)) p.score = 1;
    else if (!prev && ((away ?? 0) > 0 || (home ?? 0) > 0)) p.score = 1;
    for (const k of ["dn", "togo", "at", "y", "t"]) if (p[k] === null) delete p[k];
    plays.push(p);
    if (d === null) continue;
    let drive = drives.get(d);
    if (!drive) {
      drive = {
        n: d,
        team: club(r.posteam),
        rawResult: str(r.fixed_drive_result),
        qtr: num(r.drive_quarter_start) ?? num(r.qtr),
        clock: str(r.drive_game_clock_start) ?? str(r.time),
        start: str(r.drive_start_yard_line),
        plays: num(r.drive_play_count),
        yards: num(r.ydsnet),
        top: str(r.drive_time_of_possession),
        list: [],
      };
      drives.set(d, drive);
    }
    if (!drive.team) drive.team = club(r.posteam);
    drive.list.push(p);
  }
  const out = [...drives.values()]
    .filter((dr) => dr.team)
    .map((dr) => {
      const last = dr.list[dr.list.length - 1];
      const lastQtr = Math.max(...dr.list.map((p) => p.q ?? 0));
      const result = driveResult(dr.rawResult, dr.list, lastQtr);
      const o = {
        n: dr.n,
        team: dr.team,
        result,
        qtr: dr.qtr,
        clock: dr.clock,
        start: dr.start,
        plays: dr.plays,
        yards: dr.yards,
        top: dr.top,
        away: last.away,
        home: last.home,
      };
      if (dr.rawResult === "Opp touchdown") o.defScore = 1;
      return o;
    });
  return { season: g.season, week: g.week, seasonType: g.seasonType, home: g.home, away: g.away, drives: out, plays };
}

/** Forced fumbles in one game, every play (returns and two-point tries included). */
function forcedFumbles(rs) {
  const out = [];
  for (const r of rs) {
    for (const n of [1, 2]) {
      const player = str(r[`forced_fumble_player_${n}_player_name`]);
      const team = club(r[`forced_fumble_player_${n}_team`]);
      if (player && team) out.push({ team, player });
    }
  }
  return out;
}

/** Each club's advanced offense in one game: sums and counts (see the header). */
function advanced(rs) {
  const out = {};
  for (const r of rs) {
    if (r.two_point_attempt === "1") continue;
    if (r.play_type !== "pass" && r.play_type !== "run") continue;
    const epa = num(r.epa);
    const o = club(r.posteam);
    if (epa === null || !o) continue;
    const s = (out[o] ??= {
      plays: 0, epa: 0, success: 0, explosive: 0, dropbacks: 0, dbEpa: 0, rushes: 0, rushEpa: 0,
      early: 0, earlyPass: 0, airYards: 0, neutral: 0, neutralPass: 0, hit: 0,
    });
    const dropback = r.qb_dropback === "1";
    const yards = num(r.yards_gained) ?? 0;
    s.plays += 1;
    s.epa += epa;
    if (r.success === "1" || epa > 0) s.success += 1;
    if (dropback) {
      s.dropbacks += 1;
      s.dbEpa += epa;
      if (yards >= EXPLOSIVE_PASS) s.explosive += 1;
      s.airYards += num(r.air_yards) ?? 0;
      if (r.qb_hit === "1" || r.sack === "1") s.hit += 1;
    } else {
      s.rushes += 1;
      s.rushEpa += epa;
      if (yards >= EXPLOSIVE_RUSH) s.explosive += 1;
    }
    const down = num(r.down);
    if (down === 1 || down === 2) {
      s.early += 1;
      if (dropback) s.earlyPass += 1;
    }
    const wp = num(r.wp);
    const qtr = num(r.qtr);
    const half = num(r.half_seconds_remaining);
    if (wp !== null && wp >= 0.2 && wp <= 0.8 && qtr !== null && qtr <= 3 && (half === null || half > 120)) {
      s.neutral += 1;
      if (dropback) s.neutralPass += 1;
    }
  }
  for (const s of Object.values(out)) {
    s.epa = round(s.epa, 2);
    s.dbEpa = round(s.dbEpa, 2);
    s.rushEpa = round(s.rushEpa, 2);
  }
  return out;
}

/** gsis_id -> ESPN athlete id, from nflverse's players.csv (plain CSV). */
async function espnIds() {
  const url = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
  const cached = cacheDir ? path.join(cacheDir, "players.csv") : null;
  let text;
  if (cached && fs.existsSync(cached)) text = fs.readFileSync(cached, "utf8");
  else {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    text = await res.text();
  }
  const lines = text.split(/\r?\n/);
  const header = splitCsv(lines[0]);
  const gi = header.indexOf("gsis_id");
  const ei = header.indexOf("espn_id");
  const out = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = splitCsv(line);
    const g = str(f[gi]);
    const e = str(f[ei]);
    if (g && e) out.set(g, e.replace(/\.0$/, ""));
  }
  return out;
}

/** The player columns a row can name, as [name column, id column]. */
const PLAYER_COLS = [
  "passer", "receiver", "rusher", "interception", "kicker", "sack", "half_sack_1", "half_sack_2",
  "solo_tackle_1", "solo_tackle_2", "assist_tackle_1", "assist_tackle_2", "tackle_for_loss_1",
  "qb_hit_1", "qb_hit_2", "forced_fumble_player_1", "fumbled_1", "fumble_recovery_1",
  "pass_defense_1", "pass_defense_2", "punter", "kickoff_returner", "punt_returner", "lateral_receiver",
].map((c) => [`${c}_player_name`, `${c}_player_id`]);

/** Which club a named player was on, for a row: the offense or the defense. */
const OFFENSE_COLS = new Set(["passer", "receiver", "rusher", "kicker", "punter", "fumbled_1", "lateral_receiver", "kickoff_returner"]);

function gameIds(rs, espn) {
  const out = {};
  for (const r of rs) {
    for (const [nameCol, idCol] of PLAYER_COLS) {
      const nm = str(r[nameCol]);
      const gsis = str(r[idCol]);
      if (!nm || !gsis) continue;
      const base = nameCol.replace(/_player_name$/, "");
      const espnId = espn.get(gsis);
      if (!espnId) continue;
      // Returners and recoverers can be on either side; the column with a
      // _team twin says which, else offense/defense by the column.
      const teamCol = { fumbled_1: "fumbled_1_team", fumble_recovery_1: "fumble_recovery_1_team", forced_fumble_player_1: "forced_fumble_player_1_team", solo_tackle_1: "solo_tackle_1_team", solo_tackle_2: "solo_tackle_2_team", assist_tackle_1: "assist_tackle_1_team", assist_tackle_2: "assist_tackle_2_team" }[base];
      let team = teamCol ? club(r[teamCol]) : null;
      // Kickoffs list the receiving club as posteam; punts the punting club.
      if (!team) team = OFFENSE_COLS.has(base) ? club(r.posteam) : club(r.defteam);
      if (!team) continue;
      (out[team] ??= {})[nm] = espnId;
    }
  }
  return out;
}

async function buildSeason(season) {
  const espn = await espnIds();
  const games = new Map();
  for await (const r of rows(`${NFLVERSE}/play_by_play_${season}.csv.gz`)) {
    const id = r.game_id;
    if (!id) continue;
    let g = games.get(id);
    if (!g) {
      g = {
        season,
        week: num(r.week),
        seasonType: r.season_type === "POST" ? "post" : "regular",
        home: club(r.home_team),
        away: club(r.away_team),
        rows: [],
      };
      games.set(id, g);
    }
    g.rows.push(r);
  }

  const out = {};
  for (const [id, g] of games) {
    const rs = g.rows;
    // Only finished games: the last row is END GAME with a final score.
    const last = rs[rs.length - 1];
    if (!last || !/END GAME/i.test(last.desc ?? "")) continue;
    const homeFinal = num(last.total_home_score);
    const awayFinal = num(last.total_away_score);
    if (homeFinal === null || awayFinal === null) continue;

    const snaps = rs.filter((r) => num(r.home_wp) !== null && num(r.game_seconds_remaining) !== null);
    const wp = [];
    for (const r of snaps) {
      const elapsed = Math.max(0, 3600 - num(r.game_seconds_remaining));
      const point = [Math.round(elapsed), pm(num(r.home_wp))];
      if (wp.length && wp[wp.length - 1][0] === point[0]) wp[wp.length - 1] = point;
      else wp.push(point);
    }
    const finalWp = homeFinal > awayFinal ? 1000 : homeFinal < awayFinal ? 0 : 500;
    wp.push([Math.max(3600, wp.length ? wp[wp.length - 1][0] : 3600), finalWp]);

    const plays = [];
    const injuries = [];
    // Each club's possessions so far, so an injury can say "on the opening drive".
    const drivesOf = new Map();
    for (let i = 0; i < rs.length; i += 1) {
      const r = rs[i];
      const desc = r.desc ?? "";
      const qtr = num(r.qtr);
      const clock = str(r.time);
      const pos = club(r.posteam);
      const drive = num(r.drive);
      if (pos && drive !== null) {
        const seen = drivesOf.get(pos) ?? new Set();
        seen.add(drive);
        drivesOf.set(pos, seen);
      }
      for (const m of desc.matchAll(INJURED)) {
        const team = club(m[1]);
        // The injured player's club's possession number, when it had the ball.
        const teamDrive = team === pos ? (drivesOf.get(pos)?.size ?? null) : null;
        injuries.push({ team, player: m[2], qtr, clock, teamDrive, playId: num(r.play_id), returned: false });
      }
      for (const m of desc.matchAll(RETURNED)) {
        const hit = injuries.find((x) => x.team === club(m[1]) && x.player === m[2]);
        if (hit) hit.returned = true;
      }
      // The try after a touchdown (2026-11-23): nflverse logs it on its own
      // row, which the play filter below drops, so a missed extra point or a
      // two-point try reached the recap only as odd arithmetic (TEN @ DAL
      // read 6-0 after a touchdown). Hung on the touchdown it follows; a made
      // extra point, the usual case, writes nothing. A retry after a penalty
      // overwrites the first result.
      const xp = str(r.extra_point_result);
      const two = str(r.two_point_conv_result);
      if (xp || two) {
        const last = plays[plays.length - 1];
        if (last?.td) {
          if (xp === "good") delete last.tryResult;
          else last.tryResult = xp ? `xp_${xp}` : `2pt_${two}`;
        }
      }
      const hwp = num(r.home_wp);
      if (hwp === null) continue;
      // The WP after the play: the next snap's, or the final.
      let after = null;
      for (let j = i + 1; j < rs.length; j += 1) {
        const n = num(rs[j].home_wp);
        if (n !== null) {
          after = n;
          break;
        }
      }
      if (after === null) after = finalWp / 1000;

      const type = r.play_type;
      const yds = num(r.yards_gained);
      const int = r.interception === "1";
      const fumble = r.fumble_lost === "1";
      const td = r.touchdown === "1";
      const fg = type === "field_goal" ? str(r.field_goal_result) : null;
      const safety = r.safety === "1";
      const explosive = (type === "pass" && yds !== null && yds >= 20) || (type === "run" && yds !== null && yds >= 15);
      const swing = Math.abs(after - hwp) >= 0.05;
      if (!(int || fumble || td || fg || safety || explosive || swing)) continue;
      if (/No Play/.test(desc) && !int && !fumble && !td && !safety) continue;
      plays.push({
        playId: num(r.play_id),
        qtr,
        clock,
        elapsed: Math.round(3600 - (num(r.game_seconds_remaining) ?? 0)),
        pos: club(r.posteam),
        def: club(r.defteam),
        type: str(type),
        yds,
        int,
        fumble,
        td,
        tdTeam: club(r.td_team),
        fg,
        kickDistance: fg ? num(r.kick_distance) : null,
        sack: r.sack === "1",
        // An interception in or behind the defense's own goal line: nflverse
        // prints "at SEA -3" or "in end zone", and a touchback follows.
        endZone: int && (/ at [A-Z]{2,3} -\d/.test(desc) || /in end zone/i.test(desc) || /Touchback/.test(desc)),
        passer: str(r.passer_player_name),
        receiver: str(r.receiver_player_name),
        rusher: str(r.rusher_player_name),
        interceptor: str(r.interception_player_name),
        kicker: str(r.kicker_player_name),
        sacker: r.sack === "1" ? str(r.sack_player_name) ?? str(r.half_sack_1_player_name) : null,
        // Who lost the ball on a lost fumble: on punts and kickoffs nflverse's
        // posteam is the kicking club, while the fumble is usually the returner's.
        fumbleTeam: fumble ? club(r.fumbled_1_team) : null,
        // The recap's scoring list (2026-11-23): a safety is two points nobody
        // else lists, and a kick or punt return touchdown needs its returner.
        // Written only when set, so every other play keeps its old shape.
        ...(safety ? { safety: true } : {}),
        ...(td && (type === "kickoff" || type === "punt")
          ? { returner: str(r.kickoff_returner_player_name) ?? str(r.punt_returner_player_name), returnYds: num(r.return_yards) }
          : {}),
        wpBefore: pm(hwp),
        wpAfter: pm(after),
        homeScore: num(r.total_home_score),
        awayScore: num(r.total_away_score),
      });
    }
    const pbpDir = path.join(OUT_DIR, "pbp", String(season));
    fs.mkdirSync(pbpDir, { recursive: true });
    fs.writeFileSync(path.join(pbpDir, `${id}.json`), JSON.stringify(playByPlay(rs, g)) + "\n");
    out[id] = { season: g.season, week: g.week, seasonType: g.seasonType, home: g.home, away: g.away, homeFinal, awayFinal, wp, plays, injuries, adv: advanced(rs), ff: forcedFumbles(rs), ids: gameIds(rs, espn) };
  }
  const file = path.join(OUT_DIR, `game_story_${season}.json`);
  fs.writeFileSync(file, JSON.stringify({ season, source: "nflverse play_by_play", builtAt: new Date().toISOString(), games: out }) + "\n");
  console.log(`${file}: ${Object.keys(out).length} games`);
}

for (const season of seasons) await buildSeason(season);
