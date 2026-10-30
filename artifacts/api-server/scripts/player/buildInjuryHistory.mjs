#!/usr/bin/env node
/**
 * The injury history for the player pages, from the Injury tool's store.
 *
 *   node scripts/player/buildInjuryHistory.mjs [--season 2026 | --all | --from 2019] [--dry-run]
 *
 * `data/player/player_injuries.json` is the per-player record the Injury tab
 * reads (timeline, body map, counts, games missed). It was first built from an
 * outside scrape in September 2026; since 2026-10-30 (mak) every season the
 * store covers, 2009 on, is rewritten from what the app already stores for the
 * Injury tool (`data/injury-impact/`, nflverse weekly reports, in-game injury
 * events and the durability set's week grid, kept current by
 * scripts/injury-impact/refresh.mjs), so the tab's history and its Durability
 * Profile card tell one story and nothing is fetched here. Entries from before
 * 2009 and the college list are the scrape's and are left alone.
 *
 * The weekly run is `--season 2026` (the default: the year in progress); `--all`
 * is the full rewrite, for after a new durability pack or a rule change.
 *
 * One entry per injury, not per report row: a player listed with an ankle in
 * Weeks 5 and 6 has one ankle injury that started in Week 5. Consecutive
 * weekly rows for the same body part are one entry (a one-week gap is
 * allowed, for the bye). When the play-by-play log has him injured during
 * the game the week before the first report, the entry starts there, since
 * that is when he was hurt.
 *
 * Games missed are counted from the game log against the schedule: a week
 * his team played and he has no line for, from the injury's first week until
 * he plays again (or the last completed week, if he has not). A player listed
 * Questionable who played counts no missed game, whatever the report said.
 * Rest days, personal matters and the like are not injuries and are skipped.
 *
 * A player on injured reserve drops off the weekly report, so his weeks on a
 * reserve list (data/injury-impact/roster-status.json, from the nflverse
 * weekly roster) are read too: they extend the injury he was last listed
 * with, and when nothing was listed first - hurt in a game and placed on
 * reserve before the next report - they are an entry of their own, with no
 * body part, since no file here names one.
 *
 * Each entry also carries what the store knows week by week (mak,
 * 2026-10-22): the play he was hurt on (quarter, clock, the play as called)
 * and the weekly report rows for the injury (practice level, game status,
 * the reserve list), which the timeline prints under the description.
 *
 * A past season defers to the durability set's week grid (gridiron.json, the
 * same weekly rosters the Durability Profile reads): a week counts as missed
 * to injury only when the grid marks it so, which is what tells a player
 * activated from injured reserve late in the year apart from one still on it,
 * since the weekly report says nothing about either. A stint the grid marks
 * that no report row explains (hurt in a game and placed on reserve before
 * the next report) is an entry of its own, with the grid's body part.
 *
 * What it owns: every entry in the seasons it runs for, rewritten every run.
 * Entries from other seasons are left alone. The durability grade and score
 * are the earlier record's; a player new to the file gets none (the tab omits
 * the tile), which is honest rather than a number nobody computed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PLAYER_DIR = path.join(ROOT, "data", "player");
const IMPACT_DIR = path.join(ROOT, "data", "injury-impact");
const INJURIES_FILE = path.join(PLAYER_DIR, "player_injuries.json");

const SKILL = new Set(["QB", "RB", "WR", "TE"]);

/** The first season the Injury tool's store (and the durability grid) covers. */
const FIRST_SEASON = 2009;

/** Report terms that are not injuries. */
const NOT_INJURY = /not injury related|resting|personal|illness|cramps|teeth|load management|coach|covid/i;

/**
 * The body-part noun the record files an entry under, from nflverse's term.
 * The tab categorizes by the type first and the body part second, so the type
 * keeps nflverse's word and this only has to be a sensible lowercase noun.
 */
const BODY_PART = {
  rib: "chest",
  ribs: "chest",
  pectoral: "chest",
  chest: "chest",
  lung: "chest",
  quadricep: "quad",
  quadriceps: "quad",
  thigh: "quad",
  thumb: "hand",
  finger: "hand",
  hand: "hand",
  concussion: "head",
  "concussion evaluation": "head",
  head: "head",
  eye: "head",
  nose: "head",
  jaw: "head",
  stinger: "neck",
  neck: "neck",
  fibula: "shin",
  tibia: "shin",
  shin: "shin",
  biceps: "arm",
  triceps: "arm",
  forearm: "arm",
  glute: "hip",
  groin: "groin",
  oblique: "abdomen",
  abdomen: "abdomen",
  core: "abdomen",
  kidney: "abdomen",
  hernia: "groin",
  collarbone: "shoulder",
  tooth: "head",
  face: "head",
  "facial laceration": "head",
  headache: "head",
  throat: "neck",
  feet: "foot",
  ankles: "ankle",
  hips: "hip",
  "lower leg": "shin",
  "upper arm": "arm",
  arm: "arm",
  "arm (laceration)": "arm",
};

/** "Quadricep" -> "Quad", "Rib" -> "Ribs": the type as the timeline prints it. */
const TYPE = { Quadricep: "Quad", Quadriceps: "Quad", Rib: "Ribs", "concussion evaluation": "Concussion evaluation" };

const TEAM_NAMES = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals",
  CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts",
  JAX: "Jaguars", KC: "Chiefs", LA: "Rams", LAR: "Rams", LAC: "Chargers", LV: "Raiders", MIA: "Dolphins",
  MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers",
  SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WAS: "Commanders",
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** A quoted-field-free CSV reader is enough for games.csv's columns used here. */
function readGames(season) {
  const file = path.join(ROOT, "data", "schedule", "games.csv");
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",");
  const col = (name) => head.indexOf(name);
  const c = { season: col("season"), type: col("game_type"), week: col("week"), away: col("away_team"), home: col("home_team") };
  const games = [];
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    if (Number(f[c.season]) !== season || f[c.type] !== "REG") continue;
    games.push({ week: Number(f[c.week]), away: code(f[c.away]), home: code(f[c.home]) });
  }
  return games;
}

/** nflverse writes the Rams as LA; the player files write LAR. */
function code(team) {
  return team === "LA" ? "LAR" : team;
}

const norm = (s) => String(s ?? "").trim().toLowerCase();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A concussion listed with any qualifier ("concussion protocol", a sentence) is a concussion. */
const concussion = (term) => /concussion/i.test(String(term));

function typeOf(term) {
  const t = String(term).trim();
  if (concussion(t)) return "Concussion";
  return TYPE[t] ?? cap(t);
}

function bodyPartOf(term) {
  if (concussion(term)) return "head";
  const t = norm(term);
  return BODY_PART[t] ?? t;
}

/**
 * "Week 5", "Weeks 5 and 6", "Weeks 5, 6 and 8"; four or more games with no
 * game played between them read "Weeks 5 through 15 (10 games)".
 *
 * @param isGame (week) => whether his team played that week, for the range test
 */
function listWeeks(weeks, isGame = null) {
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  if (weeks.length === 2) return `Weeks ${weeks[0]} and ${weeks[1]}`;
  if (weeks.length >= 4 && isGame) {
    const set = new Set(weeks);
    let unbroken = true;
    for (let w = weeks[0]; w <= weeks[weeks.length - 1] && unbroken; w += 1) if (isGame(w) && !set.has(w)) unbroken = false;
    if (unbroken) return `Weeks ${weeks[0]} through ${weeks[weeks.length - 1]} (${weeks.length} games)`;
  }
  return `Weeks ${weeks.slice(0, -1).join(", ")} and ${weeks[weeks.length - 1]}`;
}

/** "right Thumb" -> { term: "Thumb", side: "right" }; "Knee" -> { term: "Knee", side: "unknown" }. */
export function splitSide(term) {
  const m = /^\s*(left|right)\s+(.+)$/i.exec(String(term ?? ""));
  return m ? { term: m[2].trim(), side: m[1].toLowerCase() } : { term: String(term ?? "").trim(), side: "unknown" };
}

/**
 * The injuries in one player's season, from his weekly report rows.
 *
 * @param rows   { week, team, term, side?, status, primary } for the season, any order
 * @param events in-game injury weeks: [{ week, opponent }]
 * @param ctx    { played: Set<week>, playing: (week, team) => boolean,
 *                 completedWeek, team, onReserve, reserve: { week: code },
 *                 current?: boolean (the season in progress; default true),
 *                 injuredWeeks?: Set<week> | null (a past season's grid: the
 *                 weeks missed to injury; when given, no other week counts),
 *                 stints?: [{ first, weeks: number[], part }] (the grid's
 *                 stints, for the ones no report row explains) }
 */
export function buildEntries(season, rows, events, ctx) {
  const current = ctx.current ?? true;
  const grid = ctx.injuredWeeks instanceof Set ? ctx.injuredWeeks : null;
  const isGame = (w) => (ctx.team ? ctx.playing(w, ctx.team) : true);
  const injuries = rows.filter((r) => r.term && !NOT_INJURY.test(r.term));
  const byTerm = new Map();
  for (const row of injuries) {
    const key = norm(row.term);
    if (!byTerm.has(key)) byTerm.set(key, []);
    byTerm.get(key).push(row);
  }
  // The runs: consecutive weeks (a one-week gap allowed, for the bye) listed
  // with the same body part are one injury.
  const runs = [];
  for (const [key, list] of byTerm) {
    list.sort((a, b) => a.week - b.week);
    for (const row of list) {
      const run = runs[runs.length - 1];
      if (run && run.key === key && row.week - run.last <= 2) {
        run.rows.push(row);
        run.last = row.week;
      } else runs.push({ key, term: row.term, rows: [row], first: row.week, last: row.week });
    }
  }
  const ruledOut = (r) => r.status === "Out" || r.status === "Doubtful";
  const reserve = ctx.reserve ?? {};
  const reserveWeeks = Object.keys(reserve).map(Number).sort((a, b) => a - b);
  // Reserve weeks that follow a listing (within a week of its last row)
  // belong to that injury: he was listed, then placed on the list.
  const claimed = new Set();
  for (const w of reserveWeeks) {
    const run = runs
      .filter((r) => r.last <= w && w - r.last <= 2 && (ruledOut(r.rows[r.rows.length - 1]) || !ctx.played.has(r.last)))
      .sort((a, b) => b.last - a.last)[0];
    if (!run) continue;
    run.last = w;
    run.reserved = reserve[w];
    claimed.add(w);
  }
  // A player with no line in the log all season is one the log does not
  // track (a depth player with no stats), so for him only a report that
  // ruled him out is a game missed; absence from the log says nothing.
  // A past season's grid says which weeks he missed to injury, so it tracks
  // him whether or not he has a line.
  const tracked = ctx.played.size > 0 || grid != null;
  // A run is open past its last report week when that week's report ruled
  // him out (or he is on reserve) and he has not played since.
  for (const run of runs) {
    const playedAfter = [...ctx.played].some((w) => w > run.last);
    const lastRow = run.rows[run.rows.length - 1];
    run.open = !playedAfter && (ruledOut(lastRow) || run.reserved || ctx.onReserve || (tracked && !ctx.played.has(run.last)));
    // Never past the last completed week: this week's Wednesday listing is
    // not a game missed yet.
    run.end = Math.min(run.open ? Math.max(run.last, ctx.completedWeek) : run.last, ctx.completedWeek);
    // A past season's grid stint with the same body part within two weeks of
    // the run extends it either way: forward when he went on reserve and off
    // the report, backward when he was placed on reserve as soon as he was
    // hurt and only reappeared on the report when he came back. A stint the
    // grid could not name extends a run it overlaps.
    run.start = run.first;
    for (const st of ctx.stints ?? []) {
      if (st.first > run.end + 2 || st.last < run.start - 2) continue;
      const samePart = st.part && bodyPartOf(st.part) === bodyPartOf(run.term);
      const overlaps = st.weeks.some((w) => w >= run.start && w <= run.end);
      if (!samePart && !(overlaps && (!st.part || /^undisclosed$/i.test(st.part)))) continue;
      st.merged = true;
      run.start = Math.min(run.start, st.first);
      run.end = Math.min(Math.max(run.end, st.last), ctx.completedWeek);
    }
  }
  // Each missed week is one injury's: the one that ruled him out that week
  // (the primary listing first), else the latest one that ruled him out
  // before it, else whichever run spans it.
  const missedBy = new Map();
  const weeks = new Set();
  for (const run of runs) for (let w = run.start; w <= run.end; w += 1) weeks.add(w);
  for (const w of [...weeks].sort((a, b) => a - b)) {
    if (ctx.played.has(w)) continue;
    if (grid && !grid.has(w)) continue;
    const team = injuries.find((r) => r.week === w)?.team ?? ctx.team;
    if (!team || !ctx.playing(w, team)) continue;
    const spanning = runs.filter((run) => run.start <= w && w <= run.end);
    if (spanning.length === 0) continue;
    if (!tracked && !spanning.some((run) => run.rows.some((r) => r.week === w && ruledOut(r)))) continue;
    const pick =
      spanning.find((run) => run.rows.some((r) => r.week === w && ruledOut(r) && r.primary)) ??
      spanning.find((run) => run.rows.some((r) => r.week === w && ruledOut(r))) ??
      spanning
        .filter((run) => run.rows.some((r) => r.week < w && ruledOut(r)))
        .sort((a, b) => Math.max(...b.rows.filter(ruledOut).map((r) => r.week)) - Math.max(...a.rows.filter(ruledOut).map((r) => r.week)))[0] ??
      spanning.find((run) => run.rows.some((r) => r.week === w && r.primary)) ??
      spanning[0];
    if (!missedBy.has(pick)) missedBy.set(pick, []);
    missedBy.get(pick).push(w);
  }

  // Reserve weeks no listing accounts for: an injury of its own. Consecutive
  // weeks are one stint; a stint is dated to the in-game injury the week
  // before it when there is one.
  const stints = [];
  for (const w of reserveWeeks) {
    if (claimed.has(w)) continue;
    const stint = stints[stints.length - 1];
    if (stint && w - stint.last <= 1) stint.last = w;
    else stints.push({ first: w, last: w, code: reserve[w] });
  }
  // The game-before origins first, so a play that starts one injury is not
  // also shown under another listed the same week.
  const origins = new Map();
  for (const run of runs) {
    const origin = events.find((e) => e.week === run.start - 1) ?? null;
    if (origin) origins.set(run, origin);
  }
  const taken = new Set(origins.values());
  const entries = [];
  for (const stint of stints) {
    const end = Math.min(Math.max(stint.last, [...ctx.played].some((w) => w > stint.last) ? stint.last : ctx.completedWeek), ctx.completedWeek);
    const missed = [];
    for (let w = stint.first; w <= end; w += 1) {
      if (!ctx.played.has(w) && ctx.team && ctx.playing(w, ctx.team) && !(grid && !grid.has(w))) missed.push(w);
    }
    const origin = events.find((e) => e.week === stint.first - 1) ?? null;
    const list = RESERVE_LISTS[stint.code] ?? "a reserve list";
    const ongoing = current && ![...ctx.played].some((w) => w > stint.last) && stint.last >= ctx.completedWeek;
    const lead = origin
      ? `Hurt during the Week ${origin.week} game against the ${TEAM_NAMES[origin.opponent] ?? origin.opponent} and placed on ${list} in Week ${stint.first}`
      : `Placed on ${list} in Week ${stint.first}`;
    const tail = missed.length === 0 ? "." : ongoing ? `; out since Week ${missed[0]}${missed.length > 1 ? ` (${missed.length} games missed so far)` : ""}.` : `; missed ${listWeeks(missed, isGame)}.`;
    entries.push({
      season,
      week: origin ? origin.week : stint.first,
      type: /physically|non-football/.test(list) ? "Reserve list" : "Injured reserve",
      bodyPart: "unknown",
      side: "unknown",
      severity: ongoing || missed.length >= 4 ? "major" : missed.length >= 1 ? "moderate" : "minor",
      gamesMissed: missed.length,
      description: `${lead}${tail}`,
      report: true,
      play: playOf(origin),
      reports: Object.keys(reserve)
        .map(Number)
        .filter((w) => w >= stint.first && w <= stint.last)
        .sort((a, b) => a - b)
        .map((w) => ({ week: w, reserve: RESERVE_LISTS[reserve[w]] ?? "reserve list" })),
    });
  }
  for (const run of runs) {
    const missed = missedBy.get(run) ?? [];
    // Hurt in the game the week before he was first listed: that is when
    // the injury happened, and the entry starts there.
    const origin = origins.get(run) ?? null;
    // Else hurt during a game while listed with it: still the play to show.
    const during = origin ?? events.find((e) => !taken.has(e) && e.week >= run.first && e.week <= run.last) ?? null;
    const reports = run.rows.map((r) => ({ week: r.week, practice: PRACTICE[r.practice] ?? r.practice ?? null, status: r.status ?? null }));
    for (const w of reserveWeeks) {
      if (claimed.has(w) && w > run.rows[run.rows.length - 1].week && w <= run.last) reports.push({ week: w, reserve: RESERVE_LISTS[reserve[w]] ?? "reserve list" });
    }
    const ongoing = current && run.open && missed.length > 0 && run.end >= ctx.completedWeek;
    const severity = missed.length >= 4 || (ongoing && (ctx.onReserve || run.reserved)) ? "major" : missed.length >= 1 ? "moderate" : "minor";
    const side = run.rows.map((r) => r.side).find((x) => x && x !== "unknown") ?? "unknown";
    const typeWord = typeOf(run.term);
    const noun = /^concussion/i.test(typeWord) ? "concussion" : `${bodyPartOf(run.term)} injury`;
    const hurt = origin ? `Hurt during the Week ${origin.week} game against the ${TEAM_NAMES[origin.opponent] ?? origin.opponent} and ` : "";
    const lead =
      run.start < run.first
        ? `${hurt ? hurt : ""}${hurt ? "out" : "Out"} of the lineup with ${article(noun)} ${noun} from Week ${run.start}, on the injury report from Week ${run.first}`
        : origin
          ? `${hurt}listed with ${article(noun)} ${noun} from Week ${run.first}`
          : `Listed on the injury report with ${article(noun)} ${noun} from Week ${run.first}`;
    const listed = run.reserved ? `, then placed on ${RESERVE_LISTS[run.reserved] ?? "a reserve list"}` : "";
    let tail;
    if (missed.length === 0) tail = `${listed} and played through it without missing time.`;
    else if (ongoing) tail = `${listed}; out since Week ${missed[0]}${missed.length > 1 ? ` (${missed.length} games missed so far)` : ""}.`;
    else tail = `${listed}; missed ${listWeeks(missed, isGame)}.`;
    entries.push({
      season,
      week: origin ? origin.week : run.start,
      type: typeWord,
      bodyPart: bodyPartOf(run.term),
      side,
      severity,
      gamesMissed: missed.length,
      description: `${lead}${tail}`,
      report: true,
      play: playOf(during),
      reports,
    });
  }
  // The grid's stints no report row or reserve week explains: hurt in a game
  // and placed on reserve before the next report, in a season with no reserve
  // data. The grid's body part is the last one it saw reported, if any.
  const covered = new Set();
  for (const run of runs) for (let w = run.start; w <= run.end; w += 1) covered.add(w);
  for (const stint of stints) for (let w = stint.first; w <= stint.last; w += 1) covered.add(w);
  for (const m of missedBy.values()) for (const w of m) covered.add(w);
  for (const st of ctx.stints ?? []) {
    if (st.merged) continue;
    const missed = st.weeks.filter((w) => !ctx.played.has(w) && (!grid || grid.has(w)) && !covered.has(w));
    if (missed.length === 0) continue;
    const origin = events.find((e) => e.week === missed[0] - 1) ?? null;
    const known = st.part && !/^undisclosed$/i.test(st.part);
    const typeWord = known ? typeOf(st.part) : "Undisclosed";
    const noun = !known ? "an undisclosed injury" : /^concussion/i.test(typeWord) ? "a concussion" : `${article(bodyPartOf(st.part))} ${bodyPartOf(st.part)} injury`;
    const lead = origin
      ? `Hurt during the Week ${origin.week} game against the ${TEAM_NAMES[origin.opponent] ?? origin.opponent} and out of the lineup with ${noun} from Week ${missed[0]}`
      : `Out of the lineup with ${noun} from Week ${missed[0]}`;
    entries.push({
      season,
      week: origin ? origin.week : missed[0],
      type: typeWord,
      bodyPart: known ? bodyPartOf(st.part) : "unknown",
      side: "unknown",
      severity: missed.length >= 4 ? "major" : "moderate",
      gamesMissed: missed.length,
      description: `${lead}; missed ${listWeeks(missed, isGame)}. No weekly injury report listed it.`,
      report: true,
      play: playOf(origin),
      reports: [],
    });
  }
  entries.sort((a, b) => b.week - a.week || a.type.localeCompare(b.type));
  return entries;
}

const article = (noun) => (/^[aeiou]/i.test(noun) ? "an" : "a");

/** The play he was hurt on, as the entry carries it. */
function playOf(event) {
  if (!event) return undefined;
  // "(:12) (Shotgun) 8-L.Jackson sacked ... BAL-8-L.Jackson was injured during the play." ->
  // the play as called, without the clock prefix and the injury sentence.
  const desc = String(event.desc ?? "")
    .replace(/^\(\d{0,2}:\d{2}\)\s*/, "")
    .replace(/\s*[A-Z]{2,3}-\d{1,2}-\S+ was injured during the play\.?/g, "")
    .trim();
  return {
    week: event.week,
    opponent: event.opponent,
    qtr: Number.isFinite(Number(event.qtr)) && event.qtr !== null ? Number(event.qtr) : null,
    clock: event.clock ?? null,
    desc,
  };
}

const PRACTICE = {
  "Full Participation in Practice": "Full",
  "Limited Participation in Practice": "Limited",
  "Did Not Participate In Practice": "DNP",
};

/** The reserve lists by nflverse code, as roster-status.json names them. */
const RESERVE_LISTS = {
  R01: "injured reserve",
  R48: "injured reserve",
  R04: "the physically unable to perform list",
  R05: "the non-football injury list",
  R06: "the non-football illness list",
};

/** Parse the durability set's stint label for its first week. */
function stintFirstWeek(label) {
  const m = /from week (\d+)|out week (\d+)/i.exec(String(label ?? ""));
  return m ? Number(m[1] ?? m[2]) : null;
}

/**
 * The durability grid for one player's past season: the weeks it marks as
 * missed to injury and its stints. null when the grid has no such season.
 *
 * @param gp     the gridiron.json player
 * @param playing (week, team) => boolean
 */
export function gridSeason(gp, season, playing, fallbackTeam) {
  const key = String(season);
  const scored = gp.w?.[key] != null;
  const extra = gp.x?.w?.[key] != null;
  if (!scored && !extra) return null;
  const team = code((scored ? gp.t?.[key] : gp.x?.t?.[key]) ?? fallbackTeam ?? null);
  const injuredWeeks = new Set();
  const stints = [];
  for (const st of (scored ? gp.inj : gp.x?.inj) ?? []) {
    if (st[0] !== season) continue;
    const first = stintFirstWeek(st[1]);
    const n = Number(st[4]);
    if (!first || !n) continue;
    const weeks = [];
    for (let w = first; w <= 22 && weeks.length < n; w += 1) {
      if (team && !playing(w, team)) continue;
      weeks.push(w);
      injuredWeeks.add(w);
    }
    stints.push({ first, last: weeks[weeks.length - 1] ?? first, weeks, part: st[2] ? String(st[2]) : null });
  }
  return { injuredWeeks, stints, team };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const thisYear = new Date().getUTCFullYear();
  const dryRun = argv.includes("--dry-run");
  const seasons = [];
  if (argv.includes("--all") || argv.includes("--from")) {
    for (let y = Number(arg("--from", String(FIRST_SEASON))); y <= thisYear; y += 1) seasons.push(y);
  } else seasons.push(Number(arg("--season", String(thisYear))));
  const owned = new Set(seasons);

  const sleeperByGsis = readJson(path.join(IMPACT_DIR, "sleeper-ids.json"), {});
  const players = readJson(path.join(PLAYER_DIR, "players.json"), []);
  const indexed = new Set(readJson(path.join(PLAYER_DIR, "indexed_players.json"), {}).slugs ?? []);
  const record = readJson(INJURIES_FILE, {});
  const rosterStatus = readJson(path.join(IMPACT_DIR, "roster-status.json"), null);
  if (!rosterStatus) console.log("no roster-status.json: reserve-list weeks unknown (run scripts/injury-impact/refresh.mjs first)");
  const gridiron = readJson(path.join(IMPACT_DIR, "gridiron.json"), { players: [] });
  const gridByGsis = new Map();
  for (const gp of gridiron.players ?? []) if (gp?.id) gridByGsis.set(gp.id, gp);
  const currentSeason = Number(gridiron.current?.season ?? thisYear);

  const bySleeper = new Map();
  for (const p of players) if (p?.id) bySleeper.set(String(p.id), p);

  // The Injury tool's store, shard by shard: every player's report rows and
  // in-game injuries, all seasons.
  const historyDir = path.join(IMPACT_DIR, "history");
  const store = new Map(); // gsis -> { h, g }
  for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort()) {
    const shard = readJson(path.join(historyDir, file), { players: {} });
    for (const [gsis, v] of Object.entries(shard.players ?? {})) store.set(gsis, v);
  }

  // Who the record covers: skill players the store or the grid knows, on the
  // index or already in the file.
  const subjects = new Map(); // sleeperId -> { gsis, player }
  for (const gsis of new Set([...store.keys(), ...gridByGsis.keys()])) {
    const sleeperId = sleeperByGsis[gsis];
    if (!sleeperId) continue;
    const player = bySleeper.get(String(sleeperId));
    if (!player || !SKILL.has(player.position)) continue;
    if (!indexed.has(player.slug) && !record[sleeperId]) continue;
    subjects.set(String(sleeperId), { gsis, player });
  }

  const unknownTerms = new Map();
  const built = new Map(); // sleeperId -> entries across the seasons run
  let entriesWritten = 0;
  let gridOnly = 0;

  for (const season of seasons) {
    const logs = readJson(path.join(PLAYER_DIR, "game_logs", `${season}.json`), {});
    const games = readGames(season);
    if (games.length === 0) {
      console.log(`${season}: no games in data/schedule/games.csv, skipped`);
      continue;
    }
    const reserveByGsis = rosterStatus?.season === season ? rosterStatus.players ?? {} : {};
    const current = season >= currentSeason;

    // Which teams play each week, and which weeks are complete: a week is done
    // when every team that plays in it has at least one player with a line.
    // A past season is complete through its last week.
    const teamsByWeek = new Map();
    for (const g of games) {
      if (!teamsByWeek.has(g.week)) teamsByWeek.set(g.week, new Set());
      teamsByWeek.get(g.week).add(g.away).add(g.home);
    }
    const loggedTeams = new Map();
    for (const entries of Object.values(logs)) {
      for (const e of entries) {
        if (!loggedTeams.has(e.week)) loggedTeams.set(e.week, new Set());
        if (e.team) loggedTeams.get(e.week).add(e.team);
      }
    }
    let completedWeek = 0;
    if (current) {
      for (const [week, teams] of [...teamsByWeek].sort((a, b) => a[0] - b[0])) {
        const logged = loggedTeams.get(week) ?? new Set();
        if ([...teams].every((t) => logged.has(t))) completedWeek = week;
        else break;
      }
    } else completedWeek = Math.max(...teamsByWeek.keys());
    const playing = (week, team) => teamsByWeek.get(week)?.has(team) ?? false;

    let playersSeen = 0;
    let seasonEntries = 0;
    for (const [sleeperId, { gsis, player }] of subjects) {
      const v = store.get(gsis) ?? {};
      const rows = [];
      for (const r of v.h ?? []) {
        if (r[0] !== season) continue;
        const primary = r[3] ?? r[5];
        const secondary = r[4] ?? r[6];
        for (const raw of [primary, secondary]) {
          if (!raw) continue;
          const { term, side } = splitSide(raw);
          rows.push({ week: r[1], team: code(r[2]), term, side, status: r[7], practice: r[8], primary: raw === primary });
          const k = norm(term);
          if (!NOT_INJURY.test(term) && !concussion(term) && !BODY_PART[k] && !["knee", "ankle", "hamstring", "shoulder", "back", "foot", "calf", "hip", "toe", "achilles", "elbow", "wrist", "heel"].includes(k)) {
            unknownTerms.set(k, (unknownTerms.get(k) ?? 0) + 1);
          }
        }
      }
      const log = logs[sleeperId] ?? [];
      // His team that season: the one he played for most, else the report's, else now.
      const teamCount = new Map();
      for (const e of log) if (e.team) teamCount.set(e.team, (teamCount.get(e.team) ?? 0) + 1);
      const team = [...teamCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? rows[0]?.team ?? (current ? player.team : null);
      const reserve = reserveByGsis[gsis] ?? {};
      const grid = current ? null : gridByGsis.has(gsis) ? gridSeason(gridByGsis.get(gsis), season, playing, team) : null;
      if (rows.length === 0 && Object.keys(reserve).length === 0 && !(grid && grid.stints.length)) continue;
      playersSeen += 1;
      const events = (v.g ?? [])
        .filter((g) => g[0] === season && g[2] === "REG")
        .map((g) => ({ week: g[1], opponent: code(g[6]), qtr: g[7], clock: g[8], desc: g[10] }));
      const played = new Set(log.map((e) => e.week));
      const onReserve = current && /^(ir|pup|nfi|injured reserve)/i.test(String(player.injury_status ?? ""));
      const entries = buildEntries(season, rows, events, {
        played,
        playing,
        completedWeek,
        team: grid?.team ?? team,
        onReserve,
        reserve,
        current,
        injuredWeeks: grid ? grid.injuredWeeks : null,
        stints: grid ? grid.stints : [],
      });
      gridOnly += entries.filter((e) => e.reports.length === 0 && /No weekly injury report/.test(e.description)).length;
      if (!built.has(sleeperId)) built.set(sleeperId, []);
      built.get(sleeperId).push(...entries);
      seasonEntries += entries.length;
    }
    entriesWritten += seasonEntries;
    console.log(`${season}: through Week ${completedWeek}; ${playersSeen} players with injuries, ${seasonEntries} entries${current ? "" : " (grid-capped)"}`);
  }

  // Write: every subject's record loses the seasons run and gains what was
  // built; a player new to the file starts without a grade.
  let playersWritten = 0;
  let newRecords = 0;
  for (const [sleeperId] of subjects) {
    const entries = built.get(sleeperId) ?? [];
    const rec = record[sleeperId];
    const kept = (rec?.nfl ?? []).filter((e) => !owned.has(e.season));
    if (!rec && entries.length === 0) continue;
    if (!rec) newRecords += 1;
    const next = rec ?? { grade: null, score: null, gradeColor: null, nfl: [], college: [] };
    const before = JSON.stringify(next.nfl ?? []);
    next.nfl = [...entries, ...kept].sort((a, b) => b.season - a.season || (b.week ?? 0) - (a.week ?? 0));
    if (JSON.stringify(next.nfl) !== before) playersWritten += 1;
    record[sleeperId] = next;
  }
  // A record player the store no longer knows (no mapping) keeps what he had.

  console.log(
    `${seasons.length === 1 ? seasons[0] : `${seasons[0]}-${seasons[seasons.length - 1]}`}: ${entriesWritten} injuries built, ${gridOnly} from the grid alone; ${playersWritten} players changed (${newRecords} new to the file)`,
  );
  if (unknownTerms.size) {
    console.log(`terms filed under their own name: ${[...unknownTerms].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(", ")}`);
  }
  if (dryRun) return;
  // Compact, as the file has always been written.
  fs.writeFileSync(INJURIES_FILE, JSON.stringify(record));
  console.log(`wrote ${path.relative(ROOT, INJURIES_FILE)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
