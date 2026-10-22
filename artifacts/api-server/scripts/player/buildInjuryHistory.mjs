#!/usr/bin/env node
/**
 * The season in progress's injury history for the player pages, from the
 * Injury tool's store.
 *
 *   node scripts/player/buildInjuryHistory.mjs [--season 2026] [--dry-run]
 *
 * `data/player/player_injuries.json` is the per-player record the Injury tab
 * reads (timeline, body map, counts, games missed). It was last built from an
 * outside scrape in September 2026 and stops at the 2025 season. This fills
 * the current season from what the app already stores for the Injury tool
 * (`data/injury-impact/`, nflverse weekly reports and in-game injury events,
 * kept current by scripts/injury-impact/refresh.mjs), so the two tools read
 * one source and nothing is fetched here.
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
 * What it owns: this season's entries from Week 1 on, rewritten every run.
 * Entries from other seasons, and this season's offseason entries (week 0)
 * from the earlier record, are left alone. The durability grade and score are
 * the earlier record's; a player new to the file gets none (the tab omits the
 * tile), which is honest rather than a number nobody computed.
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

/** Report terms that are not injuries. */
const NOT_INJURY = /not injury related|resting|personal|illness|cramps|teeth|load management/i;

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

function typeOf(term) {
  const t = String(term).trim();
  return TYPE[t] ?? cap(t);
}

function bodyPartOf(term) {
  const t = norm(term);
  return BODY_PART[t] ?? t;
}

function listWeeks(weeks) {
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  if (weeks.length === 2) return `Weeks ${weeks[0]} and ${weeks[1]}`;
  return `Weeks ${weeks.slice(0, -1).join(", ")} and ${weeks[weeks.length - 1]}`;
}

/**
 * The injuries in one player's season, from his weekly report rows.
 *
 * @param rows   { week, team, term, status, primary } for the season, any order
 * @param events in-game injury weeks: [{ week, opponent }]
 * @param ctx    { played: Set<week>, playing: (week, team) => boolean,
 *                 completedWeek, team, onReserve, reserve: { week: code } }
 */
export function buildEntries(season, rows, events, ctx) {
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
  const tracked = ctx.played.size > 0;
  // A run is open past its last report week when that week's report ruled
  // him out (or he is on reserve) and he has not played since.
  for (const run of runs) {
    const playedAfter = [...ctx.played].some((w) => w > run.last);
    const lastRow = run.rows[run.rows.length - 1];
    run.open = !playedAfter && (ruledOut(lastRow) || run.reserved || ctx.onReserve || (tracked && !ctx.played.has(run.last)));
    // Never past the last completed week: this week's Wednesday listing is
    // not a game missed yet.
    run.end = Math.min(run.open ? Math.max(run.last, ctx.completedWeek) : run.last, ctx.completedWeek);
  }
  // Each missed week is one injury's: the one that ruled him out that week
  // (the primary listing first), else the latest one that ruled him out
  // before it, else whichever run spans it.
  const missedBy = new Map();
  const weeks = new Set();
  for (const run of runs) for (let w = run.first; w <= run.end; w += 1) weeks.add(w);
  for (const w of [...weeks].sort((a, b) => a - b)) {
    if (ctx.played.has(w)) continue;
    const team = injuries.find((r) => r.week === w)?.team ?? ctx.team;
    if (!team || !ctx.playing(w, team)) continue;
    const spanning = runs.filter((run) => run.first <= w && w <= run.end);
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
    const origin = events.find((e) => e.week === run.first - 1) ?? null;
    if (origin) origins.set(run, origin);
  }
  const taken = new Set(origins.values());
  const entries = [];
  for (const stint of stints) {
    const end = Math.min(Math.max(stint.last, [...ctx.played].some((w) => w > stint.last) ? stint.last : ctx.completedWeek), ctx.completedWeek);
    const missed = [];
    for (let w = stint.first; w <= end; w += 1) {
      if (!ctx.played.has(w) && ctx.team && ctx.playing(w, ctx.team)) missed.push(w);
    }
    const origin = events.find((e) => e.week === stint.first - 1) ?? null;
    const list = RESERVE_LISTS[stint.code] ?? "a reserve list";
    const ongoing = ![...ctx.played].some((w) => w > stint.last) && stint.last >= ctx.completedWeek;
    const lead = origin
      ? `Hurt during the Week ${origin.week} game against the ${TEAM_NAMES[origin.opponent] ?? origin.opponent} and placed on ${list} in Week ${stint.first}`
      : `Placed on ${list} in Week ${stint.first}`;
    const tail = missed.length === 0 ? "." : ongoing ? `; out since Week ${missed[0]}${missed.length > 1 ? ` (${missed.length} games missed so far)` : ""}.` : `; missed ${listWeeks(missed)}.`;
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
    const ongoing = run.open && missed.length > 0 && run.end >= ctx.completedWeek;
    const severity = missed.length >= 4 || (ongoing && (ctx.onReserve || run.reserved)) ? "major" : missed.length >= 1 ? "moderate" : "minor";
    const typeWord = typeOf(run.term);
    const noun = /^concussion/i.test(typeWord) ? "concussion" : `${bodyPartOf(run.term)} injury`;
    const lead = origin
      ? `Hurt during the Week ${origin.week} game against the ${TEAM_NAMES[origin.opponent] ?? origin.opponent} and listed with ${article(noun)} ${noun} from Week ${run.first}`
      : `Listed on the injury report with ${article(noun)} ${noun} from Week ${run.first}`;
    const listed = run.reserved ? `, then placed on ${RESERVE_LISTS[run.reserved] ?? "a reserve list"}` : "";
    let tail;
    if (missed.length === 0) tail = `${listed} and played through it without missing time.`;
    else if (ongoing) tail = `${listed}; out since Week ${missed[0]}${missed.length > 1 ? ` (${missed.length} games missed so far)` : ""}.`;
    else tail = `${listed}; missed ${listWeeks(missed)}.`;
    entries.push({
      season,
      week: origin ? origin.week : run.first,
      type: typeWord,
      bodyPart: bodyPartOf(run.term),
      side: "unknown",
      severity,
      gamesMissed: missed.length,
      description: `${lead}${tail}`,
      report: true,
      play: playOf(during),
      reports,
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

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const season = Number(arg("--season", String(new Date().getUTCFullYear())));
  const dryRun = argv.includes("--dry-run");

  const sleeperByGsis = readJson(path.join(IMPACT_DIR, "sleeper-ids.json"), {});
  const players = readJson(path.join(PLAYER_DIR, "players.json"), []);
  const indexed = new Set(readJson(path.join(PLAYER_DIR, "indexed_players.json"), {}).slugs ?? []);
  const logs = readJson(path.join(PLAYER_DIR, "game_logs", `${season}.json`), {});
  const record = readJson(INJURIES_FILE, {});
  const games = readGames(season);
  const rosterStatus = readJson(path.join(IMPACT_DIR, "roster-status.json"), null);
  const reserveByGsis = rosterStatus?.season === season ? rosterStatus.players ?? {} : {};
  if (!rosterStatus) console.log("no roster-status.json: reserve-list weeks unknown (run scripts/injury-impact/refresh.mjs first)");

  const bySleeper = new Map();
  for (const p of players) if (p?.id) bySleeper.set(String(p.id), p);

  // Which teams play each week, and which weeks are complete: a week is done
  // when every team that plays in it has at least one player with a line.
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
  for (const [week, teams] of [...teamsByWeek].sort((a, b) => a[0] - b[0])) {
    const logged = loggedTeams.get(week) ?? new Set();
    if ([...teams].every((t) => logged.has(t))) completedWeek = week;
    else break;
  }
  const playing = (week, team) => teamsByWeek.get(week)?.has(team) ?? false;

  // The Injury tool's store, shard by shard.
  const historyDir = path.join(IMPACT_DIR, "history");
  const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort();
  let playersSeen = 0;
  let playersWritten = 0;
  let entriesWritten = 0;
  let newRecords = 0;
  const unknownTerms = new Map();
  const owned = (e) => e.season === season && (e.report === true || (e.week ?? 0) >= 1);

  const written = new Set();
  for (const file of files) {
    const shard = readJson(path.join(historyDir, file), { players: {} });
    for (const [gsis, v] of Object.entries(shard.players ?? {})) {
      const sleeperId = sleeperByGsis[gsis];
      if (!sleeperId) continue;
      const player = bySleeper.get(String(sleeperId));
      if (!player || !SKILL.has(player.position)) continue;
      if (!indexed.has(player.slug) && !record[sleeperId]) continue;
      const rows = [];
      for (const r of v.h ?? []) {
        if (r[0] !== season) continue;
        const primary = r[3] ?? r[5];
        const secondary = r[4] ?? r[6];
        for (const term of [primary, secondary]) {
          if (!term) continue;
          rows.push({ week: r[1], team: code(r[2]), term, status: r[7], practice: r[8], primary: term === primary });
          const k = norm(term);
          if (!NOT_INJURY.test(term) && !BODY_PART[k] && !["knee", "ankle", "hamstring", "shoulder", "back", "foot", "calf", "hip", "toe", "achilles", "elbow", "wrist", "heel"].includes(k)) {
            unknownTerms.set(k, (unknownTerms.get(k) ?? 0) + 1);
          }
        }
      }
      const reserve = reserveByGsis[gsis] ?? {};
      if (rows.length === 0 && Object.keys(reserve).length === 0) continue;
      playersSeen += 1;
      const events = (v.g ?? [])
        .filter((g) => g[0] === season && g[2] === "REG")
        .map((g) => ({ week: g[1], opponent: code(g[6]), qtr: g[7], clock: g[8], desc: g[10] }));
      const played = new Set((logs[sleeperId] ?? []).map((e) => e.week));
      const onReserve = /^(ir|pup|nfi|injured reserve)/i.test(String(player.injury_status ?? ""));
      const entries = buildEntries(season, rows, events, { played, playing, completedWeek, team: player.team, onReserve, reserve });
      const rec = record[sleeperId] ?? { grade: null, score: null, gradeColor: null, nfl: [], college: [] };
      if (!record[sleeperId]) newRecords += 1;
      const kept = (rec.nfl ?? []).filter((e) => !owned(e));
      rec.nfl = [...entries, ...kept];
      record[sleeperId] = rec;
      written.add(sleeperId);
      playersWritten += 1;
      entriesWritten += entries.length;
    }
  }
  // A player whose only entries this season were owned by an earlier run and
  // who has no rows now (a corrected report) loses them.
  for (const [id, rec] of Object.entries(record)) {
    if (written.has(id)) continue;
    const before = rec.nfl?.length ?? 0;
    rec.nfl = (rec.nfl ?? []).filter((e) => !(e.season === season && e.report === true));
    if ((rec.nfl?.length ?? 0) !== before) playersWritten += 1;
  }

  console.log(
    `${season}: through Week ${completedWeek}; ${playersSeen} players with reports, ${entriesWritten} injuries written for ${playersWritten} players (${newRecords} new to the file)`,
  );
  if (unknownTerms.size) {
    console.log(`terms filed under their own name: ${[...unknownTerms].map(([t, n]) => `${t} (${n})`).join(", ")}`);
  }
  if (dryRun) return;
  // Compact, as the file has always been written.
  fs.writeFileSync(INJURIES_FILE, JSON.stringify(record));
  console.log(`wrote ${path.relative(ROOT, INJURIES_FILE)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
