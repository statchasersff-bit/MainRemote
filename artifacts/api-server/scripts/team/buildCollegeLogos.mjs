/**
 * Pair the draft register's college names with ESPN's NCAA team ids, so the
 * team hubs' Draft tab can draw each school's crest through the image route
 * (/news-image/college/<id>/...), the way headshots come through it.
 *
 *   node scripts/team/buildCollegeLogos.mjs [--from <teams.json>] [--no-fetch]
 *
 * Reads every college named in data/team/draft_history.json, fetches ESPN's
 * college football team list (762 schools, FBS down to Division II) and
 * matches each name to a school by its location ("Ohio State", "Miami (OH)")
 * after the register's abbreviations are written out the way the page writes
 * them. The names the two sides spell differently are paired by hand in
 * OVERRIDES; a school ESPN does not list stays out and the page prints the
 * name alone.
 *
 * Writes data/team/college_logos.json ({ "<register name>": { id, name } })
 * and keeps a trimmed copy of the team list at
 * data/team/source/ncaa_teams.json, so the pairing can be rebuilt offline.
 *
 * Re-run after buildDraftHistory.mjs when the register brings new schools;
 * the script prints the names it could not place.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000";
const SNAPSHOT = path.join(DATA, "team", "source", "ncaa_teams.json");
const OUT = path.join(DATA, "team", "college_logos.json");

/** Register names ESPN spells another way, to ESPN's location. */
const OVERRIDES = {
  "Ala-Birmingham": "UAB",
  "Albany State (GA)": "Albany State",
  "Appalachian St.": "App State",
  "Central Florida": "UCF",
  "Central Missouri St.": "Central Missouri",
  Charlotte: "Charlotte 49ers",
  "Concordia-St.Paul (MN)": "Concordia St. Paul",
  Connecticut: "UConn",
  "East Central (OK)": "East Central",
  "Fort Hays St.": "Fort Hays",
  "Grambling St.": "Grambling",
  "Kutztown (PA)": "Kutztown",
  "La-Monroe": "UL Monroe",
  "Lenoir-Rhyne": "Lenoir Rhyne",
  "Miami (FL)": "Miami Hurricanes",
  "Middle Tenn. St.": "Middle Tennessee",
  Mississippi: "Ole Miss",
  "North Carolina St.": "NC State",
  "Sam Houston St.": "Sam Houston",
  "San Jose St.": "San José State",
  "Southeastern Louisiana": "SE Louisiana",
  "Texas-El Paso": "UTEP",
  "Texas-San Antonio": "UTSA",
  Troy: "Troy Trojans",
  "Wisconsin–Whitewater": "Wisconsin Whitewater",
};

/** The same writing-out the page does (draft-render.ts collegeName). */
function written(college) {
  return college
    .trim()
    .replace(/\bSt\.$/, "State")
    .replace(/\bCol\.$/, "College")
    .replace(/\bTenn\. /, "Tennessee ")
    .replace(/^NW /, "Northwest ")
    .replace(/^SE /, "Southeast ")
    .replace(/^S\.F\. Austin$/, "Stephen F. Austin");
}

function norm(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadTeams(from, noFetch) {
  if (from) return JSON.parse(fs.readFileSync(from, "utf8"));
  if (!noFetch) {
    const res = await fetch(TEAMS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`team list answered ${res.status}`);
    return res.json();
  }
  if (fs.existsSync(SNAPSHOT)) return JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  throw new Error("no team list: fetch is off and no snapshot is stored");
}

/** The list as the page needs it, from ESPN's envelope or from the snapshot. */
function trim(doc) {
  if (Array.isArray(doc.teams)) return doc.teams;
  const teams = doc.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map(({ team }) => ({
      id: String(team.id),
      location: team.location ?? "",
      name: team.displayName ?? "",
      abbreviation: team.abbreviation ?? "",
    }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--from");
  const from = at >= 0 ? path.resolve(argv[at + 1]) : null;
  const noFetch = argv.includes("--no-fetch");

  const history = JSON.parse(fs.readFileSync(path.join(DATA, "team", "draft_history.json"), "utf8"));
  const colleges = new Map();
  for (const picks of Object.values(history.teams)) {
    for (const p of picks) {
      if (p.college) colleges.set(p.college, (colleges.get(p.college) ?? 0) + 1);
    }
  }

  const teams = trim(await loadTeams(from, noFetch));
  if (teams.length < 500) throw new Error(`team list looks short (${teams.length})`);
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: TEAMS_URL, teams }, null, 1)}\n`);

  const byLocation = new Map();
  const byName = new Map();
  for (const t of teams) {
    const k = norm(t.location);
    byLocation.set(k, [...(byLocation.get(k) ?? []), t]);
    byName.set(norm(t.name), t);
  }

  const out = {};
  const missed = [];
  for (const college of [...colleges.keys()].sort()) {
    const wanted = OVERRIDES[college] ?? written(college);
    const hits = byLocation.get(norm(wanted)) ?? [];
    const hit = hits.length === 1 ? hits[0] : (byName.get(norm(wanted)) ?? null);
    if (!hit) {
      missed.push(`${college} (${colleges.get(college)})${hits.length > 1 ? " ambiguous" : ""}`);
      continue;
    }
    out[college] = { id: hit.id, name: hit.location || hit.name };
  }

  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ builtAt: new Date().toISOString(), colleges: Object.keys(colleges).length, matched: Object.keys(out).length, logos: out }, null, 2)}\n`,
  );
  console.log(`  college logos: ${Object.keys(out).length} of ${colleges.size} schools paired -> ${path.relative(process.cwd(), OUT)}`);
  if (missed.length) console.log(`  not placed: ${missed.join("; ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
