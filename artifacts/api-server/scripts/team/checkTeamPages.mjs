/**
 * After the daily refresh: is what the team hubs now say still true?
 *
 *   node scripts/team/checkTeamPages.mjs 2026 [--offline]
 *
 * The builders make the numbers; this checks the result against sources the
 * builders did not use, and against the mistakes an audit has already caught
 * once (2026-10-03). It runs as the last team step of the daily chain in
 * live-refresh.ts, so a FAIL shows on /api/status under daily.steps.
 *
 *   FAIL - a page is saying something wrong, or a staff change needs research.
 *          Exits 1, with a one-line-per-problem summary at the end of stderr.
 *   WARN - worth a look (stale data, an upstream we could not reach). Exits 0;
 *          printed for a run by hand, see docs/WEEKLY-TEAM-CHECKLIST.md.
 *
 * --offline skips the three network checks (games file, ESPN standings, ESPN
 * head coaches) and checks the data files alone.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const DATA = path.join(ROOT, "data");
const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const ESPN_SITE = process.env.SC_ESPN_SITE_BASE ?? "https://site.api.espn.com";
const ESPN_CORE = process.env.SC_ESPN_CORE_BASE ?? "https://sports.core.api.espn.com";
const UA = "StatChasersTeamPages/1.0 (+statchasers.com)";

const season = Number(process.argv[2]);
const offline = process.argv.includes("--offline");
if (!season) {
  console.error("usage: node scripts/team/checkTeamPages.mjs <season> [--offline]");
  process.exit(2);
}

const fails = [];
const warns = [];
const fail = (team, msg) => fails.push(`${team}: ${msg}`);
const warn = (team, msg) => warns.push(`${team}: ${msg}`);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8"));
const coaching = readJson(`team/coaching_${season}.json`);
const staffDoc = readJson(`team/coaching_staff_${season}.json`);
let usage = null;
try {
  usage = readJson(`team/usage_${season}.json`);
} catch {
  fail("all", `data/team/usage_${season}.json is missing or unreadable`);
}

// The hub's 32 clubs and their ESPN ids, from the one list the app uses.
const teamsTs = fs.readFileSync(path.join(ROOT, "src", "lib", "team", "teams.ts"), "utf8");
const CLUBS = [...teamsTs.matchAll(/abbreviation: "([a-z]+)",[^}]*?espnId: "(\d+)"/g)].map((m) => ({
  abbr: m[1],
  espnId: m[2],
}));
if (CLUBS.length !== 32) fail("all", `expected 32 clubs in teams.ts, found ${CLUBS.length}`);

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/* --------------------------------------------------- 1. games played (truth) */

// Weeks each club has finished, from the nflverse games file: a source the
// coaching builder reads only for points, never for which week it is.
const completed = new Map(); // abbr -> [{week, gameday}]
const FIX = { LA: "lar", JAC: "jax", WSH: "was", OAK: "lv", SD: "lac", STL: "lar" };
const clubOf = (t) => FIX[t] ?? t.toLowerCase();
if (!offline) {
  try {
    const lines = (await fetchText(GAMES_URL)).trim().split("\n");
    const head = lines[0].split(",");
    const col = (name) => head.indexOf(name);
    const [iSeason, iType, iWeek, iDay, iAway, iHome, iAwayScore] = [
      "season", "game_type", "week", "gameday", "away_team", "home_team", "away_score",
    ].map(col);
    for (const line of lines.slice(1)) {
      const f = line.split(",");
      if (Number(f[iSeason]) !== season || f[iType] !== "REG" || f[iAwayScore] === "" || f[iAwayScore] === "NA") continue;
      for (const t of [f[iAway], f[iHome]]) {
        const c = clubOf(t);
        if (!completed.has(c)) completed.set(c, []);
        completed.get(c).push({ week: Number(f[iWeek]), gameday: f[iDay] });
      }
    }
  } catch (err) {
    warn("all", `games file unreachable, week checks skipped (${err.message})`);
  }
}

/* ------------------------------------------------- 2. the coaching entries */

// Sentences the 2026-10-03 audit took out, by the template that wrote them.
// Each comes back only if a template regresses.
const OVERCLAIMS = [
  [/one of the more projectable offenses/i, "a league-wide claim nothing on the page measures"],
  [/top-ten unit|bottom-ten/i, "a tier label on a rank that moves with ties and filters"],
  [/will arrive through the air|TD equity up/i, "a touchdown forecast from a play-selection rate"],
  [/on purpose|scheme, not script/i, "PROE read as certainty"],
  [/one-on-one/i, "motion rate read as coverage"],
  [/backfield eats|targets spike/i, "a small score-state gap read as a rule"],
  [/tilts game script toward leads|desperation targets/i, "defense alone credited with game script"],
  [/Every number on this page|All numbers are derived from/i, "a source claim wider than the data"],
  [/motion at (the )?snap/i, "FTN's motion flag is before or at the snap"],
  [/Position splits this stable are scheme/i, "roster read as scheme"],
  [/\u2014/, "an em dash (house rule)"],
];

// "through Week 5 of 2024" in a career note is history, not this season.
const SEASON_RE = /[Tt]hrough Week (\d+)(?! of)/g;
const defRanks = new Map(); // rank -> [abbr]

for (const { abbr } of CLUBS) {
  const entry = coaching.teams?.[abbr];
  const staff = staffDoc.teams?.[abbr];
  if (!entry) {
    fail(abbr, "no coaching entry - the Coaching tab will not render");
    continue;
  }
  if (!staff) fail(abbr, "no research entry in coaching_staff file");
  if (entry.verified !== true) warn(abbr, "coaching entry is not signed off (verified:false)");

  const text = JSON.stringify(entry);
  for (const [re, why] of OVERCLAIMS) {
    const hit = text.match(re);
    if (hit) fail(abbr, `coaching copy "${hit[0]}" - ${why}`);
  }

  // No week the club has not played; and not stuck behind one it has.
  const weeks = [...new Set([...text.matchAll(SEASON_RE)].map((m) => Number(m[1])))];
  const played = completed.get(abbr);
  if (played?.length) {
    const last = Math.max(...played.map((g) => g.week));
    for (const w of weeks) {
      if (w > last) fail(abbr, `coaching says "through Week ${w}" but the club's last finished game is Week ${last}`);
    }
    const newest = Math.max(...weeks, 0);
    const missed = played.filter((g) => g.week > newest);
    const overdue = missed.filter((g) => Date.now() - Date.parse(g.gameday) > 3 * 86_400_000);
    if (overdue.length) {
      warn(abbr, `coaching is through Week ${newest}, but Week ${overdue.map((g) => g.week).join(", ")} finished 3+ days ago - did nflverse post it, and did "team coaching" run?`);
    }
  }
  if (weeks.length > 1) fail(abbr, `coaching mixes weeks: ${weeks.join(", ")}`);

  // The current dossier row is one period: this season, "through Week N".
  const current = (entry.dossier ?? []).find((d) => d.current);
  if (current && !/through Week \d+/.test(current.scoringContext ?? "")) {
    fail(abbr, `current dossier row is not a this-season figure ("${current.scoringContext}")`);
  }
  if (current && /-\d\d/.test(current.years) && !current.scoringContext?.startsWith(String(season))) {
    fail(abbr, `current dossier row spans ${current.years} but does not say the figure is ${season}-only`);
  }

  // A caller who left and came back must not read as an unbroken run.
  if (staff) {
    const here = [...new Set(
      (staff.callingStops ?? []).filter((s) => !s.college && s.team?.toLowerCase() === abbr).flatMap((s) => s.seasons ?? []),
    )].sort((a, b) => a - b);
    const stints = here.filter((y, i) => i === 0 || y !== here[i - 1] + 1).length;
    if (stints > 1) {
      const hit = text.match(/straight season|same system|on its call sheet|season calling (this|the \w+) offense/i);
      if (hit) fail(abbr, `"${hit[0]}" on a play-caller with ${stints} stints here`);
    }
    if (!staff.priorSeasonsNote && (staff.priorSeasonsAsCaller ?? 0) > 0 && here.length && here.at(-1) === season && here.length - 1 !== staff.priorSeasonsAsCaller) {
      warn(abbr, `priorSeasonsAsCaller is ${staff.priorSeasonsAsCaller} but the club's calling stops list ${here.length - 1} prior seasons`);
    }
  }

  const rank = entry.staff?.dc?.body?.match(/\((\d+)(?:st|nd|rd|th) of 32/)?.[1];
  if (rank) defRanks.set(rank, [...(defRanks.get(rank) ?? []), abbr]);
}
for (const [rank, clubs] of defRanks) {
  if (clubs.length > 1) warn(clubs.join("+"), `share defensive EPA rank ${rank} - an exact tie, or a rounding regression`);
}

/* ---------------------------------------------------------- 3. usage file */

if (usage) {
  const age = Date.now() - Date.parse(usage.builtAt);
  if (Number.isFinite(age) && age > 2 * 86_400_000) warn("all", `usage_${season}.json was built ${Math.round(age / 86_400_000)} days ago`);
  for (const { abbr } of CLUBS) {
    const u = usage.teams?.[abbr];
    if (!u) {
      fail(abbr, "no usage entry - the Usage tab will not render");
      continue;
    }
    const played = completed.get(abbr);
    if (played?.length && Array.isArray(u.games)) {
      const last = Math.max(...played.map((g) => g.week));
      const extra = u.games.filter((w) => w > last);
      if (extra.length) fail(abbr, `usage counts Week ${extra.join(", ")}, which the club has not finished`);
    }
  }
}

/* ------------------------------------------------ 4. standings (live feed) */

// The hero's "3rd in AFC East" is placed live from this table; its order is
// only right while every team carries a seed.
if (!offline) {
  try {
    const doc = JSON.parse(await fetchText(`${ESPN_SITE}/apis/v2/sports/football/nfl/standings?level=3&season=${season}`));
    let teamsSeen = 0;
    for (const conf of doc.children ?? []) {
      const seeds = [];
      for (const div of conf.children ?? []) {
        const entries = div.standings?.entries ?? [];
        teamsSeen += entries.length;
        if (entries.length !== 4) fail("standings", `${div.name} has ${entries.length} teams`);
        for (const e of entries) {
          const seed = e.stats?.find((s) => s.name === "playoffSeed")?.value;
          if (typeof seed !== "number") fail("standings", `${e.team?.abbreviation} in ${div.name} has no playoffSeed - places would fall back to feed order`);
          else seeds.push(seed);
        }
      }
      if (new Set(seeds).size !== seeds.length) fail("standings", `${conf.abbreviation} seeds repeat - ties are not broken`);
    }
    if (teamsSeen !== 32) fail("standings", `table lists ${teamsSeen} teams`);
  } catch (err) {
    warn("standings", `ESPN standings unreachable (${err.message}) - the hero hides the Standing chip while this lasts`);
  }
}

/* ----------------------------------------------- 5. head coaches vs research */

// The one staff change a feed can see. A fired head coach means the research
// file (and possibly the play-caller) is out of date: that is a FAIL, so it
// reaches /api/status. Coordinator changes have no feed - see the checklist.
if (!offline) {
  const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const lastOf = (s) => norm((s ?? "").trim().split(/\s+/).filter((p) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(p)).at(-1));
  let unreachable = 0;
  let checked = 0;
  for (const { abbr, espnId } of CLUBS) {
    const staff = staffDoc.teams?.[abbr];
    if (!staff?.hc) continue;
    try {
      const list = JSON.parse(await fetchText(`${ESPN_CORE}/v2/sports/football/leagues/nfl/seasons/${season}/teams/${espnId}/coaches?lang=en&region=us`));
      const ref = list.items?.[0]?.$ref;
      if (!ref) continue;
      const coach = JSON.parse(await fetchText(ref.replace(/^https?:\/\/sports\.core\.api\.espn\.com/, ESPN_CORE)));
      const name = `${coach.firstName ?? ""} ${coach.lastName ?? ""}`.trim() || coach.displayName;
      checked += 1;
      if (name && lastOf(name) !== lastOf(staff.hc)) {
        fail(abbr, `ESPN lists head coach ${name}, research file says ${staff.hc} - a staff change; follow the checklist`);
      }
    } catch {
      unreachable += 1;
    }
  }
  console.log(`head coaches checked against ESPN: ${checked} of 32`);
  if (unreachable) warn("coaches", `${unreachable} of 32 ESPN coach lookups failed - head-coach changes unchecked for those clubs`);
}

/* ------------------------------------------------------------------ report */

for (const w of warns) console.log(`WARN ${w}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(`team page check ${season}: ${fails.length} fail, ${warns.length} warn${offline ? " (offline)" : ""}`);
if (fails.length) {
  // runBuilder keeps the last 500 characters of stderr for /api/status.
  console.error(`${fails.length} FAIL: ${fails.join(" | ")}`.slice(0, 480));
  process.exit(1);
}
