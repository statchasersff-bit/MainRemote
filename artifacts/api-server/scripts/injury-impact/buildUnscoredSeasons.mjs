#!/usr/bin/env node
/**
 * The seasons the durability dataset leaves out of a player's profile.
 *
 *   node scripts/injury-impact/buildUnscoredSeasons.mjs [--from <dir>] [--dry-run]
 *
 * gridiron.json (packed from the research repo by buildData.mjs) carries a
 * player's season only for the years he was on a fantasy draft board: the
 * durability score is a read on drafted seasons, and the repo's pipeline
 * builds nothing else. So Jacoby Brissett's profile began in 2019, and the
 * 2016 thumb that put him on injured reserve as a rookie was in the weekly
 * reports on his page but nowhere in his availability grid, timeline or
 * games missed (mak, 2026-10-22).
 *
 * This fills the gap from the same public nflverse files the repo's audit
 * reads, for every season from 2009 to the one before the season in
 * progress, and stores them UNDER A SEPARATE KEY (`x`) so the score does not
 * move: hydrate() reads `s`, `w`, `ps`, `u` and `inj` for the score and
 * `x` only for the profile. A season is added when the player was on a
 * roster that year and either played a game or missed one to injury.
 *
 *   stats_player_week_<season>.csv  the weeks he played (a stat line, REG)
 *   roster_weekly_<season>.csv      his team each week, and the reserve
 *                                   lists (injured reserve, PUP, NFI)
 *   injuries_<season>.csv           the weekly report (game status, body part)
 *
 * The week alphabet is the dataset's: P played, X missed to injury, - other
 * absence, B bye between two team games; a trailing bye is dropped. A missed
 * week is injury time when he was on a reserve list that is not a retired /
 * suspended / exempt list (the repo's NON_INJURY_CODES; before 2017 the
 * weekly roster names no list at all, and the repo counts a bare RES as
 * injured reserve), when the report listed him Out or Doubtful, or when a
 * report within the previous three weeks listed him with an injury and he has
 * not played since - the repo's three-week window, closed by a game played so
 * a healthy backup's idle Sundays are not an injury. Rest, illness, personal
 * and "not injury related" listings are not injuries.
 *
 * Injury stints are consecutive missed weeks (a bye between them allowed),
 * labelled the way the dataset labels its own: "Thumb — out 10 games from
 * week 5"; severity 1 under 2 games, 2 for 2-5, 3 for 6 or more or a stint
 * that runs to the season's end; the type from the body part. The games
 * missed in these seasons are what the reports and rosters show: a player
 * who went on reserve after Week 5 of 2016 is out through Week 15, whatever
 * the club later said about a return.
 *
 * What it owns: every player's `x`, rewritten each run (a player with no
 * unscored season has no `x`). Run after buildData.mjs packs a new dataset,
 * since the pack rewrites gridiron.json; commit the result. --from <dir>
 * reads the three files per season from a directory (file names as above)
 * instead of the cache under the system temp directory, which is filled
 * from nflverse on first use.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanString, parseCsv, toNumber, normTeam } from "./refresh-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "data", "injury-impact");
const GRIDIRON = path.join(OUT, "gridiron.json");
const SCHEDULE = path.join(OUT, "schedule.json");
const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";
const FIRST_SEASON = 2009;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const fromIdx = argv.indexOf("--from");
const cacheDir = fromIdx >= 0 ? path.resolve(argv[fromIdx + 1] ?? "") : path.join(os.tmpdir(), "sc-nflverse");
if (fromIdx >= 0 && !argv[fromIdx + 1]) {
  console.error("usage: buildUnscoredSeasons.mjs [--from <dir>] [--dry-run]");
  process.exit(1);
}

/** The repo's reserve-list codes that are not injuries (retired, suspended, exempt, ...). */
const NON_INJURY_CODES = new Set(["R59", "R62", "R27", "R40", "R30", "R33", "R06", "R23", "R49", "W03"]);
/** Roster statuses that mean unavailable for a non-injury reason. */
const NON_INJURY_STATUS = new Set(["SUS", "EXE", "DEV", "CUT", "RET", "UFA", "TRC", "TRD", "TRT", "NWT", "RSN", "E14", "RFA"]);
const RESERVE_STATUS = new Set(["RES", "PUP"]);
const NOT_AN_INJURY = /\b(rest|resting|illness|ill|personal|not injury|non[- ]?injury|coach|veteran|covid|suspension|load management)\b/i;
const LOOK_BACK_WEEKS = 3;

const regularWeeks = (season) => (season >= 2021 ? 18 : 17);

function injuryType(part) {
  const p = part.toLowerCase();
  if (/concussion|head/.test(p)) return "head";
  if (/hamstring|calf|groin|quad|thigh|achilles|oblique|abdom|core|pectoral|hip flexor|bicep|tricep|muscle|strain/.test(p)) return "soft";
  if (!p || /undisclosed|unknown|illness|rest|not injury|non football|personal/.test(p)) return "other";
  return "structural";
}

/** "right Thumb" -> "Thumb"; the side is not a body part. */
function cleanPart(raw) {
  const s = (raw ?? "").replace(/\b(left|right)\b/gi, "").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

async function fetchCsv(file, url) {
  const dest = path.join(cacheDir, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest, "utf8");
  fs.mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(dest, text);
  return text;
}

/** One season's facts, keyed by GSIS id. */
async function loadSeason(season) {
  const [stats, roster, injuries] = await Promise.all([
    fetchCsv(`stats_player_week_${season}.csv`, `${RELEASES}/stats_player/stats_player_week_${season}.csv`),
    fetchCsv(`roster_weekly_${season}.csv`, `${RELEASES}/weekly_rosters/roster_weekly_${season}.csv`),
    fetchCsv(`injuries_${season}.csv`, `${RELEASES}/injuries/injuries_${season}.csv`),
  ]);

  // Played weeks and the team he played for, from the stat lines.
  const played = new Map(); // id -> Map(week -> team)
  {
    const { header, rows } = parseCsv(stats);
    const ci = (n) => header[n];
    for (const r of rows) {
      if (cleanString(r[ci("season_type")]) !== "REG") continue;
      const id = cleanString(r[ci("player_id")]);
      const week = toNumber(r[ci("week")]);
      if (!id || week == null) continue;
      const team = normTeam(cleanString(r[ci("team")] ?? r[ci("recent_team")]));
      (played.get(id) ?? played.set(id, new Map()).get(id)).set(week, team);
    }
  }

  // Each week's team and roster status.
  const roster_ = new Map(); // id -> Map(week -> { team, status, code })
  {
    const { header, rows } = parseCsv(roster);
    const ci = (n) => header[n];
    for (const r of rows) {
      const gameType = ci("game_type") != null ? cleanString(r[ci("game_type")]) : "REG";
      if (gameType && gameType !== "REG") continue;
      const id = cleanString(r[ci("gsis_id")]);
      const week = toNumber(r[ci("week")]);
      if (!id || week == null) continue;
      (roster_.get(id) ?? roster_.set(id, new Map()).get(id)).set(week, {
        team: normTeam(cleanString(r[ci("team")])),
        status: cleanString(r[ci("status")]),
        code: ci("status_description_abbr") != null ? cleanString(r[ci("status_description_abbr")]) : null,
      });
    }
  }

  // The weekly report: game status and the body part.
  const report = new Map(); // id -> Map(week -> { status, part })
  {
    const { header, rows } = parseCsv(injuries);
    const ci = (n) => header[n];
    for (const r of rows) {
      if (cleanString(r[ci("game_type")]) !== "REG") continue;
      const id = cleanString(r[ci("gsis_id")]);
      const week = toNumber(r[ci("week")]);
      if (!id || week == null) continue;
      const raw = cleanString(r[ci("report_primary_injury")]) ?? cleanString(r[ci("practice_primary_injury")]) ?? "";
      if (!raw || NOT_AN_INJURY.test(raw)) continue;
      const status = cleanString(r[ci("report_status")]);
      const prev = report.get(id)?.get(week);
      // Two rows for one week: the one with a game designation wins.
      if (prev && prev.status && !status) continue;
      (report.get(id) ?? report.set(id, new Map()).get(id)).set(week, { status, part: cleanPart(raw) });
    }
  }

  return { played, roster: roster_, report };
}

/**
 * One player's unscored season, or null when he was not on a roster, or was
 * and neither played nor missed a game to injury.
 */
function seasonFor(season, id, facts, teamWeeks) {
  const played = facts.played.get(id);
  const roster = facts.roster.get(id);
  const report = facts.report.get(id);
  if (!roster && !played) return null;

  const weeks = regularWeeks(season);
  let str = "";
  let gp = 0;
  let gm = 0;
  let team = null;
  let lastTeam = null;
  const missed = []; // [week, part]

  for (let w = 1; w <= weeks; w += 1) {
    const ro = roster?.get(w);
    const tm = played?.get(w) ?? ro?.team ?? lastTeam;
    if (!tm) continue; // not on a team yet
    lastTeam = tm;
    if (!teamWeeks.get(tm)?.has(w)) {
      if (str) str += "B";
      continue;
    }
    if (played?.has(w)) {
      gp += 1;
      str += "P";
      team = tm;
      continue;
    }
    if (ro && NON_INJURY_STATUS.has(ro.status ?? "")) {
      str += "-";
      continue;
    }
    const rep = report?.get(w);
    const onReserve = ro != null && RESERVE_STATUS.has(ro.status ?? "") && !NON_INJURY_CODES.has(ro.code ?? "");
    let part = rep?.part ?? null;
    let injured = onReserve || (rep != null && (rep.status === "Out" || rep.status === "Doubtful"));
    if (!injured) {
      // The three-week window, closed by a game played.
      for (let back = 1; back <= LOOK_BACK_WEEKS && !injured; back += 1) {
        const pw = w - back;
        if (pw < 1 || played?.has(pw)) break;
        const prev = report?.get(pw);
        if (prev && prev.status && ["Out", "Doubtful", "Questionable"].includes(prev.status)) {
          injured = true;
          part = part ?? prev.part;
        }
      }
    }
    if (injured && !part) {
      // On reserve with no report naming the part: the last part reported.
      for (let pw = w - 1; pw >= 1 && !part; pw -= 1) part = report?.get(pw)?.part ?? null;
    }
    if (injured) {
      gm += 1;
      str += "X";
      missed.push([w, part ?? "Undisclosed"]);
    } else {
      str += "-";
    }
  }
  if (gp === 0 && gm === 0) return null;
  str = str.replace(/B+$/, "");
  if (!team) team = lastTeam;

  // Stints: consecutive missed weeks, a bye between them allowed.
  const inj = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    const counts = new Map();
    for (const p of run.parts) counts.set(p, (counts.get(p) ?? 0) + 1);
    const part = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const n = run.parts.length;
    const toEnd = run.last >= weeks;
    const sev = n >= 6 || toEnd ? 3 : n >= 2 ? 2 : 1;
    const label = `${part} — out ${n === 1 ? `week ${run.first}` : `${n} games from week ${run.first}`}${toEnd ? " (season-ending)" : ""}`;
    inj.push([season, label, part, sev, n, injuryType(part), 0]);
    run = null;
  };
  for (const [w, part] of missed) {
    if (run && w - run.last <= 2 && !hasGameBetween(run.last, w, played)) {
      run.last = w;
      run.parts.push(part);
    } else {
      flush();
      run = { first: w, last: w, parts: [part] };
    }
  }
  flush();

  return { gp, gm, w: str, team, inj };
}

function hasGameBetween(a, b, played) {
  for (let w = a + 1; w < b; w += 1) if (played?.has(w)) return true;
  return false;
}

async function main() {
  const gridiron = readJson(GRIDIRON);
  const schedule = readJson(SCHEDULE);
  const current = Number(gridiron.current?.season ?? new Date().getFullYear());
  const seasons = [];
  for (let s = FIRST_SEASON; s < current; s += 1) seasons.push(s);

  const players = gridiron.players ?? [];
  const ids = new Set(players.map((p) => p.id).filter(Boolean));
  console.log(`unscored seasons: ${players.length} players, ${seasons[0]}-${seasons[seasons.length - 1]}, cache ${cacheDir}`);

  const found = new Map(); // id -> { s, w, t, inj }
  let seasonCount = 0;
  for (const season of seasons) {
    const facts = await loadSeason(season);
    const teamWeeks = new Map();
    for (const [team, games] of Object.entries(schedule[String(season)] ?? {})) {
      teamWeeks.set(normTeam(team), new Set(games.filter((g) => g.t === "REG").map((g) => g.w)));
    }
    let added = 0;
    for (const p of players) {
      if (!p.id || !ids.has(p.id)) continue;
      if (p.s && p.s[String(season)]) continue; // a scored season
      const got = seasonFor(season, p.id, facts, teamWeeks);
      if (!got) continue;
      const x = found.get(p.id) ?? found.set(p.id, { s: {}, w: {}, t: {}, inj: [] }).get(p.id);
      x.s[String(season)] = [got.gp, got.gm];
      x.w[String(season)] = got.w;
      if (got.team) x.t[String(season)] = got.team;
      x.inj.push(...got.inj);
      added += 1;
    }
    seasonCount += added;
    console.log(`  ${season}: ${added} unscored player-seasons`);
  }

  let withX = 0;
  let stints = 0;
  for (const p of players) {
    const x = found.get(p.id);
    if (x) {
      x.inj.sort((a, b) => b[0] - a[0]);
      p.x = x;
      withX += 1;
      stints += x.inj.length;
    } else {
      delete p.x;
    }
  }
  console.log(`${seasonCount} player-seasons on ${withX} players, ${stints} injury stints`);

  const sample = players.find((p) => p.n === "Jacoby Brissett");
  if (sample?.x) console.log("  Brissett:", JSON.stringify(sample.x));

  if (dryRun) {
    console.log("dry run: gridiron.json not written");
    return;
  }
  fs.writeFileSync(GRIDIRON, JSON.stringify(gridiron));
  console.log(`wrote ${path.relative(ROOT, GRIDIRON)} (${Math.round(fs.statSync(GRIDIRON).size / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
