/**
 * The clubs' official transaction logs (mak, 2026-09-30: "official team
 * transaction logs should generally be considered the strongest source for
 * the official transaction date"), stored so the Bio tab's roster moves can
 * be checked against them in code (scripts/player/bio/verifyAgainstLogs.mjs).
 * Run by hand; not part of the daily refresh.
 *
 *   https://www.<siteDomain>/team/transactions/<year>
 *
 * 31 clubs publish this page (one table per calendar year, 2017 on: date
 * "MM/DD" and the club's own sentence). The Cowboys do not; their moves are
 * checked by search instead. robots.txt on these sites allows the path.
 *
 * One request every 2 seconds (spec Part 7.1, team sites), the StatChasersBot
 * User-Agent, conditional requests; a finished past season is not re-fetched.
 *
 * -> data/player/team_transactions.json (committed):
 *    { retrievedAt, source, teams: { DET: { "2023": [{ date, text }] } } }
 *
 *   node scripts/player/buildTeamTransactions.mjs [--from 2017] [--to 2026]
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { politeClient } from "./bio/polite.mjs";

const OUT_FILE = path.join(DATA_DIR, "team_transactions.json");
const FIRST_YEAR = 2017;

/** StatChasers code -> the club site that carries /team/transactions/. */
export const CLUB_SITES = {
  ARI: "azcardinals.com", ATL: "atlantafalcons.com", BAL: "baltimoreravens.com", BUF: "buffalobills.com",
  CAR: "panthers.com", CHI: "chicagobears.com", CIN: "bengals.com", CLE: "clevelandbrowns.com",
  DEN: "denverbroncos.com", DET: "detroitlions.com", GB: "packers.com", HOU: "houstontexans.com",
  IND: "colts.com", JAX: "jaguars.com", KC: "chiefs.com", LAC: "chargers.com", LAR: "therams.com",
  LV: "raiders.com", MIA: "miamidolphins.com", MIN: "vikings.com", NE: "patriots.com",
  NO: "neworleanssaints.com", NYG: "giants.com", NYJ: "newyorkjets.com", PHI: "philadelphiaeagles.com",
  PIT: "steelers.com", SEA: "seahawks.com", SF: "49ers.com", TB: "buccaneers.com",
  TEN: "tennesseetitans.com", WAS: "commanders.com",
};

const log = (msg) => console.log(`[team-transactions] ${msg}`);
const client = politeClient("team-sites", { minGapMs: 2000, log });

const unescape = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** The page's table rows: [{ date: "2023-12-30", text }]. */
export function parseLog(html, year) {
  const rows = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => unescape(c[1]));
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(cells[0] ?? "");
    if (!m || !cells[1]) continue;
    rows.push({ date: `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, text: cells[1] });
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : d);
  const from = arg("--from", FIRST_YEAR);
  const to = arg("--to", new Date().getUTCFullYear());
  let prev = { teams: {} };
  try {
    prev = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch {}
  const teams = prev.teams ?? {};
  const thisYear = new Date().getUTCFullYear();
  for (const [code, domain] of Object.entries(CLUB_SITES)) {
    teams[code] ??= {};
    for (let y = from; y <= to; y += 1) {
      // A past calendar year is final once stored.
      if (y < thisYear && teams[code][y]?.length) continue;
      const url = `https://www.${domain}/team/transactions/${y}`;
      try {
        const res = await client.fetch(url);
        teams[code][y] = parseLog(res.body, y);
      } catch (err) {
        log(`${code} ${y}: ${err.message}`);
      }
    }
    log(`${code}: ${Object.values(teams[code]).reduce((n, r) => n + r.length, 0)} rows`);
  }
  const doc = {
    version: 1,
    retrievedAt: new Date().toISOString(),
    source: { name: "Official club transaction logs", url: "https://www.<club site>/team/transactions/<year>" },
    teams,
  };
  fs.writeFileSync(`${OUT_FILE}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
