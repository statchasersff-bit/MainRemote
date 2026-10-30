/**
 * Where every drafted player in the Draft History register stands today,
 * and how the ones who left their drafting club went: from the nflverse
 * weekly rosters, one file per season.
 *
 *   node scripts/team/buildDraftStatus.mjs <season> [--cache <dir>]
 *
 * Reads data/team/draft_history.json for the picks, then every weekly
 * roster from the oldest draft in it through <season>, keeping the rows of
 * those players. For each pick it writes:
 *
 *   now   the latest roster row this season: active, injured reserve, PUP,
 *         NFI, practice squad, suspended, exempt, released (and unsigned),
 *         retired; or `none` when the player is on no roster this season.
 *         `club` is the roster the row came from.
 *   left  how the player's time with the drafting club ended, when the
 *         rosters show it: `waived` (a waiver cut, W03) or `released`
 *         (any other cut) on the drafting club's last row for them; `traded`
 *         when they moved to another club between consecutive in-season
 *         weeks without a cut row (the only in-season move that is not a
 *         cut); `retired` for a retirement there. Null when the player is
 *         still on the drafting club, or when the move happened between
 *         seasons, where the rosters say nothing about why - an expired
 *         deal, a trade and a release all look the same there, so the page
 *         prints the new club without a reason.
 *
 * Writes data/team/draft_status.json. Re-run weekly in season (the status
 * is as of the latest week in the file) and after the April draft.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters";

let cacheDir = null;

/** nflverse roster club codes to the site's. */
const CLUBS = {
  ARI: "ari", ATL: "atl", BAL: "bal", BUF: "buf", CAR: "car", CHI: "chi", CIN: "cin", CLE: "cle",
  DAL: "dal", DEN: "den", DET: "det", GB: "gb", HOU: "hou", IND: "ind", JAX: "jax", JAC: "jax",
  KC: "kc", LAC: "lac", SD: "lac", LA: "lar", LAR: "lar", STL: "lar", LV: "lv", OAK: "lv",
  MIA: "mia", MIN: "min", NE: "ne", NO: "no", NYG: "nyg", NYJ: "nyj", PHI: "phi", PIT: "pit",
  SEA: "sea", SF: "sf", TB: "tb", TEN: "ten", WAS: "was", WSH: "was",
};

/** The reserve-list codes the roster carries, to the kinds the page names. */
const RESERVE_KINDS = { R01: "ir", R48: "ir", R04: "pup", R05: "nfi", R06: "nfi", R02: "retired" };

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
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
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

/** The kind a roster row reads as. */
function kindOf(row) {
  const status = row.status;
  const abbr = row.abbr;
  if (status === "RET" || abbr === "R02") return "retired";
  if (status === "RES") return RESERVE_KINDS[abbr] ?? "reserve";
  if (status === "DEV") return "ps";
  if (status === "CUT") return "cut";
  if (status === "SUS") return "suspended";
  if (status === "EXE") return "exempt";
  // ACT, INA (on the roster, inactive on game day), TRD/TRT (traded that week).
  return "active";
}

/** How the player's time with `club` ended, from their rows in order, or null. */
function departure(history, club) {
  let onClub = false;
  let last = null;
  for (const r of history) {
    if (r.club === club) {
      onClub = true;
      last = r;
      continue;
    }
    if (!onClub) continue;
    // First row elsewhere after time on the drafting club.
    if (last.status === "CUT") return { kind: last.abbr === "W03" ? "waived" : "released", season: last.season, week: last.week };
    if (last.kind === "retired") return { kind: "retired", season: last.season, week: last.week };
    const inSeason = r.season === last.season && r.week - last.week <= 1;
    if (inSeason || r.status === "TRD" || r.status === "TRT") return { kind: "traded", season: r.season, week: r.week };
    return null;
  }
  if (!last) return null;
  // Never seen elsewhere: the drafting club's last row says how it ended.
  if (last.status === "CUT") return { kind: last.abbr === "W03" ? "waived" : "released", season: last.season, week: last.week };
  if (last.kind === "retired") return { kind: "retired", season: last.season, week: last.week };
  return null;
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2000) {
    console.error("usage: node scripts/team/buildDraftStatus.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);

  const register = JSON.parse(fs.readFileSync(path.join(DATA, "team", "draft_history.json"), "utf8"));
  const picks = [];
  for (const [club, list] of Object.entries(register.teams)) {
    for (const p of list) if (p.gsisId) picks.push({ club, gsisId: p.gsisId, season: p.season });
  }
  const wanted = new Set(picks.map((p) => p.gsisId));
  const first = Math.min(...picks.map((p) => p.season));

  const history = new Map();
  let week = 0;
  for (let y = first; y <= season; y += 1) {
    let kept = 0;
    for await (const row of rows(`${RELEASE}/roster_weekly_${y}.csv`)) {
      if (!wanted.has(row.gsis_id)) continue;
      const club = CLUBS[row.team];
      if (!club) continue;
      const r = { season: y, week: Number(row.week), club, status: row.status, abbr: row.status_description_abbr };
      r.kind = kindOf(r);
      (history.get(row.gsis_id) ?? history.set(row.gsis_id, []).get(row.gsis_id)).push(r);
      if (y === season) week = Math.max(week, r.week);
      kept += 1;
    }
    console.log(`  ${y}: ${kept} roster rows kept`);
  }
  if (week === 0) throw new Error(`no ${season} roster rows: refusing to write`);

  const players = {};
  const tally = {};
  for (const p of picks) {
    const h = (history.get(p.gsisId) ?? []).filter((r) => r.season >= p.season);
    h.sort((a, b) => a.season - b.season || a.week - b.week);
    const latest = h.at(-1) ?? null;
    const now =
      latest && latest.season === season
        ? { kind: latest.kind, club: latest.club, week: latest.week }
        : { kind: latest?.kind === "retired" ? "retired" : "none", club: null, week: null };
    const left = departure(h, p.club);
    players[p.gsisId] = { now, left };
    const key = `${now.kind}${left ? `/${left.kind}` : ""}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }

  const out = path.join(DATA, "team", "draft_status.json");
  fs.writeFileSync(out, `${JSON.stringify({ builtAt: new Date().toISOString(), season, week, players }, null, 1)}\n`);
  console.log(`  draft status: ${Object.keys(players).length} picks as of ${season} week ${week} -> ${path.relative(process.cwd(), out)}`);
  console.log(`  ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
