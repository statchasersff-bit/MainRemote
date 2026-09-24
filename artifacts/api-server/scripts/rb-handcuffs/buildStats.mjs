/**
 * Build a season of running-back stats for the handcuff model, from nflverse.
 *
 *   node scripts/rb-handcuffs/buildStats.mjs 2026
 *
 * Writes `data/rb-handcuffs/rb_stats_<season>.json` in the row shape of the
 * statchasers-data file the model was built on (`rb_advanced_stats_2025.json`),
 * so the engine reads either the same way. Regular season only, every game
 * played so far. Run it weekly in season, after Monday night, alongside
 * refresh.mjs.
 *
 * Where each figure comes from:
 *   - nflverse `stats_player` — carries, yards, TDs, targets, receptions,
 *     receiving YAC, target share, EPA, fumbles, fantasy points;
 *   - nflverse `pfr_advstats` (rushing) — broken tackles, yards
 *     before and after contact;
 *   - nflverse `snap_counts` — offensive snap share;
 *   - nflverse play-by-play — red-zone and goal-line work, 10+/15+/20+/30+
 *     runs, the longest run and TD run, negative runs, and team games played.
 *
 * Not available in season: **routes**. nflverse publishes participation data,
 * where routes come from, only after the season, and nothing else free carries
 * them. They are written as null and the model drops them — see engine/
 * player-quality.ts — so yards per route run and the route share of usage sit
 * out until a routes source exists.
 *
 * It also writes `rb_games_<season>.json`, each back's line game by game,
 * which Player Quality reads its last six games from. The previous season's
 * log is written once with `--games-only` (week 18 is in it; the engine skips
 * it): `node scripts/rb-handcuffs/buildStats.mjs 2025 --games-only`.
 *
 * `node scripts/rb-handcuffs/buildStats.mjs 2025 --check` builds 2025 the same
 * way and compares it, field by field, with the committed statchasers-data
 * file: the definitions below were matched against it.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data", "rb-handcuffs");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
const IDS_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

/** Team codes to the ones the model uses (the statchasers-data file's). */
const TEAM_FIX = { LA: "LA", LAR: "LA", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" };
const team = (t) => (t ? TEAM_FIX[t] ?? t : t);

/* -------------------------------------------------------------------- CSV */

/** One CSV line into fields, quotes and all. */
export function splitCsv(line) {
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

/** Stream a (possibly gzipped) CSV at a URL, one object per row. */
async function* rows(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  let stream = Readable.fromWeb(res.body);
  if (url.endsWith(".gz")) stream = stream.pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let pending = "";
  for await (const raw of lines) {
    // A quoted field can hold a newline; keep reading until the quotes close.
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
const round = (v, places) => (v == null ? null : Math.round(v * 10 ** places) / 10 ** places);

/* ------------------------------------------------------------------ build */

export async function buildSeason(season) {
  const regular = (r) => (r.season_type ?? r.game_type) === "REG";

  // Ids: gsis → sleeper and pfr, from the dynastyprocess crosswalk.
  const sleeperByGsis = new Map();
  const gsisByPfr = new Map();
  const birthByGsis = new Map();
  for await (const r of rows(IDS_URL)) {
    if (!r.gsis_id || r.gsis_id === "NA") continue;
    if (r.sleeper_id && r.sleeper_id !== "NA") sleeperByGsis.set(r.gsis_id, r.sleeper_id);
    if (r.pfr_id && r.pfr_id !== "NA") gsisByPfr.set(r.pfr_id, r.gsis_id);
    if (r.birthdate && r.birthdate !== "NA") birthByGsis.set(r.gsis_id, r.birthdate);
  }

  // Box-score totals per RB from stats_player.
  const players = new Map();
  const get = (id) => {
    if (!players.has(id)) {
      players.set(id, {
        id,
        name: null,
        team: null,
        lastWeek: -1,
        weeks: new Set(),
        carries: 0, rushYards: 0, rushTd: 0, rushEpa: 0,
        targets: 0, receptions: 0, recYards: 0, recTd: 0, recYac: 0, recEpa: 0,
        fumbles: 0, fantasyPoints: 0,
        teams: new Set(),
        snapPcts: [],
        byWeek: new Map(),
      });
    }
    return players.get(id);
  };
  /** One game's line for the game log, by week. */
  const gameOf = (p, week) => {
    if (!p.byWeek.has(week)) {
      p.byWeek.set(week, {
        week, team: null,
        carries: 0, rushYards: 0, targets: 0, receptions: 0, recYards: 0, recYac: 0, fumbles: 0,
        pfrCarries: 0, ybc: 0, yac: 0, broken: 0,
        pbpRushes: 0, r10: 0, r15: 0, r20: 0, r30: 0, longest: null, longestTd: null,
      });
    }
    return p.byWeek.get(week);
  };
  // Every team's targets, all positions, for target share.
  const teamTargets = new Map();
  for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`)) {
    if (!regular(r)) continue;
    teamTargets.set(team(r.team), (teamTargets.get(team(r.team)) ?? 0) + (num(r.targets) ?? 0));
    if (r.position !== "RB") continue;
    const p = get(r.player_id);
    const week = Number(r.week);
    // A game is a week with a stat line — the reference file's count.
    p.weeks.add(week);
    p.teams.add(team(r.team));
    p.name = r.player_display_name || r.player_name;
    if (week >= p.lastWeek) {
      p.lastWeek = week;
      p.team = team(r.team);
    }
    p.carries += num(r.carries) ?? 0;
    p.rushYards += num(r.rushing_yards) ?? 0;
    p.rushTd += num(r.rushing_tds) ?? 0;
    p.rushEpa += num(r.rushing_epa) ?? 0;
    p.targets += num(r.targets) ?? 0;
    p.receptions += num(r.receptions) ?? 0;
    p.recYards += num(r.receiving_yards) ?? 0;
    p.recTd += num(r.receiving_tds) ?? 0;
    p.recYac += num(r.receiving_yards_after_catch) ?? 0;
    p.recEpa += num(r.receiving_epa) ?? 0;
    p.fumbles += (num(r.rushing_fumbles) ?? 0) + (num(r.receiving_fumbles) ?? 0);
    // The advanced stats table's FPTS column, which Player Quality's
    // Production grade reads per game.
    p.fantasyPoints += num(r.fantasy_points) ?? 0;
    const g = gameOf(p, week);
    g.team = team(r.team);
    g.carries += num(r.carries) ?? 0;
    g.rushYards += num(r.rushing_yards) ?? 0;
    g.targets += num(r.targets) ?? 0;
    g.receptions += num(r.receptions) ?? 0;
    g.recYards += num(r.receiving_yards) ?? 0;
    g.recYac += num(r.receiving_yards_after_catch) ?? 0;
    g.fumbles += (num(r.rushing_fumbles) ?? 0) + (num(r.receiving_fumbles) ?? 0);
  }

  // Snap share, from snap_counts (pfr ids): the mean of each game's offensive
  // share, over every game he took a snap in — special teams included, as the
  // reference file counts it.
  for await (const r of rows(`${NFLVERSE}/snap_counts/snap_counts_${season}.csv`)) {
    if (!regular(r)) continue;
    const gsis = gsisByPfr.get(r.pfr_player_id);
    if (!gsis || !players.has(gsis)) continue;
    if ((num(r.offense_snaps) ?? 0) <= 0 && (num(r.st_snaps) ?? 0) <= 0) continue;
    players.get(gsis).snapPcts.push(num(r.offense_pct) ?? 0);
  }

  // PFR advanced: broken tackles and contact yardage.
  for await (const r of rows(`${NFLVERSE}/pfr_advstats/advstats_week_rush_${season}.csv`)) {
    if (!regular(r)) continue;
    const gsis = gsisByPfr.get(r.pfr_player_id);
    if (!gsis || !players.has(gsis)) continue;
    const p = players.get(gsis);
    p.pfrCarries = (p.pfrCarries ?? 0) + (num(r.carries) ?? 0);
    p.ybc = (p.ybc ?? 0) + (num(r.rushing_yards_before_contact) ?? 0);
    p.yac = (p.yac ?? 0) + (num(r.rushing_yards_after_contact) ?? 0);
    p.brokenRush = (p.brokenRush ?? 0) + (num(r.rushing_broken_tackles) ?? 0);
    const g = gameOf(p, Number(r.week));
    g.pfrCarries += num(r.carries) ?? 0;
    g.ybc += num(r.rushing_yards_before_contact) ?? 0;
    g.yac += num(r.rushing_yards_after_contact) ?? 0;
    g.broken += num(r.rushing_broken_tackles) ?? 0;
  }
  // Play-by-play: situational work, run lengths, and team games.
  const teamGames = new Map();
  for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
    if (r.season_type !== "REG") continue;
    if (r.posteam) {
      const t = team(r.posteam);
      if (!teamGames.has(t)) teamGames.set(t, new Set());
      teamGames.get(t).add(r.game_id);
    }
    if (r.two_point_attempt === "1" || r.aborted_play === "1") continue;
    const yardline = num(r.yardline_100);
    if (r.rush_attempt === "1" && r.rusher_player_id && players.has(r.rusher_player_id)) {
      const p = players.get(r.rusher_player_id);
      const yards = num(r.rushing_yards) ?? 0;
      p.pbpRushes = (p.pbpRushes ?? 0) + 1;
      if (yardline != null && yardline <= 20) p.rzRushes = (p.rzRushes ?? 0) + 1;
      if (yardline != null && yardline <= 5) p.glCarries = (p.glCarries ?? 0) + 1;
      if (yards >= 10) p.r10 = (p.r10 ?? 0) + 1;
      if (yards >= 15) p.r15 = (p.r15 ?? 0) + 1;
      if (yards >= 20) p.r20 = (p.r20 ?? 0) + 1;
      if (yards >= 30) p.r30 = (p.r30 ?? 0) + 1;
      if (yards >= 40) p.r40 = (p.r40 ?? 0) + 1;
      if (yards >= 50) p.r50 = (p.r50 ?? 0) + 1;
      if (yards < 0) p.negative = (p.negative ?? 0) + 1;
      p.longest = Math.max(p.longest ?? 0, yards);
      if (r.rush_touchdown === "1") p.longestTd = Math.max(p.longestTd ?? 0, yards);
      const g = gameOf(p, Number(r.week));
      g.pbpRushes += 1;
      if (yards >= 10) g.r10 += 1;
      if (yards >= 15) g.r15 += 1;
      if (yards >= 20) g.r20 += 1;
      if (yards >= 30) g.r30 += 1;
      g.longest = Math.max(g.longest ?? -Infinity, yards);
      if (r.rush_touchdown === "1") g.longestTd = Math.max(g.longestTd ?? 0, yards);
    }
    if (r.pass_attempt === "1" && r.receiver_player_id && players.has(r.receiver_player_id)) {
      const p = players.get(r.receiver_player_id);
      if (yardline != null && yardline <= 20) p.rzTargets = (p.rzTargets ?? 0) + 1;
    }
  }

  // Ages on the season's first Sunday: the first Sunday of September.
  const opener = new Date(Date.UTC(season, 8, 1));
  opener.setUTCDate(1 + ((7 - opener.getUTCDay()) % 7));
  const ageOn = (birth) => {
    const b = new Date(`${birth}T00:00:00Z`);
    if (Number.isNaN(b.getTime())) return null;
    let age = opener.getUTCFullYear() - b.getUTCFullYear();
    const had = opener.getUTCMonth() > b.getUTCMonth() ||
      (opener.getUTCMonth() === b.getUTCMonth() && opener.getUTCDate() >= b.getUTCDate());
    return had ? age : age - 1;
  };

  const out = [];
  for (const p of players.values()) {
    const touches = p.carries + p.receptions;
    const games = p.weeks.size;
    if (games === 0 || (p.carries === 0 && p.targets === 0)) continue;
    const opportunities = p.carries + p.targets;
    const brokenTackles = p.brokenRush ?? 0;
    const teamTargetTotal = Array.from(p.teams).reduce((sum, t) => sum + (teamTargets.get(t) ?? 0), 0);
    out.push({
      playerId: sleeperByGsis.get(p.id) ?? null,
      gsisId: p.id,
      playerName: p.name,
      position: "RB",
      team: p.team,
      age: birthByGsis.has(p.id) ? ageOn(birthByGsis.get(p.id)) : null,
      season,
      games,
      snapPct: p.snapPcts.length ? round((p.snapPcts.reduce((a, b) => a + b, 0) / p.snapPcts.length) * 100, 1) : null,
      routes: null,
      rushAttempts: p.carries,
      redZoneOpportunities: (p.rzRushes ?? 0) + (p.rzTargets ?? 0),
      goalLineCarries: p.glCarries ?? 0,
      targets: p.targets,
      receptions: p.receptions,
      redZoneTargets: p.rzTargets ?? 0,
      rushYards: p.rushYards,
      yardsPerCarry: p.carries > 0 ? round(p.rushYards / p.carries, 2) : null,
      rushTouchdowns: p.rushTd,
      targetSharePct: teamTargetTotal > 0 ? round((p.targets / teamTargetTotal) * 100, 1) : null,
      receivingYards: p.recYards,
      yardsPerReception: p.receptions > 0 ? round(p.recYards / p.receptions, 2) : null,
      yardsPerRouteRun: null,
      receivingTouchdowns: p.recTd,
      epaPerPlay: opportunities > 0 ? round((p.rushEpa + p.recEpa) / opportunities, 3) : null,
      fantasyPoints: round(p.fantasyPoints, 1),
      rushes10Plus: p.r10 ?? 0,
      rushes20Plus: p.r20 ?? 0,
      rushes30Plus: p.r30 ?? 0,
      rushes40Plus: p.r40 ?? 0,
      rushes50Plus: p.r50 ?? 0,
      explosiveRunPct: p.carries > 0 ? round(((p.r10 ?? 0) / p.carries) * 100, 2) : null,
      breakawayRunPct: p.carries > 0 ? round(((p.r15 ?? 0) / p.carries) * 100, 2) : null,
      longestRush: p.pbpRushes ? p.longest : null,
      longestRushTouchdown: p.longestTd ?? null,
      brokenTackles,
      rushAttemptsPerBrokenTackle: brokenTackles > 0 ? round(p.carries / brokenTackles, 2) : null,
      yardsAfterContactPerAttempt: p.pfrCarries ? round(p.yac / p.pfrCarries, 2) : null,
      yardsBeforeContactPerAttempt: p.pfrCarries ? round(p.ybc / p.pfrCarries, 2) : null,
      receivingYardsAfterCatch: p.recYac,
      // Rushing broken tackles over touches — the reference file's rate.
      tackleEludedRate: touches > 0 ? round((brokenTackles / touches) * 100, 1) : null,
      fumbles: p.fumbles,
      rushAttForNegativeYards: p.negative ?? 0,
    });
  }
  out.sort((a, b) => b.rushAttempts + b.receptions - (a.rushAttempts + a.receptions));

  // The game log: every RB's line for every week he has one, for Player
  // Quality's last-six-games window (engine/stats lastGames).
  const games = [];
  for (const p of players.values()) {
    if (p.carries === 0 && p.targets === 0) continue;
    games.push({
      gsisId: p.id,
      playerId: sleeperByGsis.get(p.id) ?? null,
      playerName: p.name,
      team: p.team,
      games: Array.from(p.byWeek.values()).sort((a, b) => a.week - b.week),
    });
  }
  games.sort((a, b) => a.playerName.localeCompare(b.playerName));

  const weeksPlayed = Math.max(0, ...Array.from(teamGames.values(), (g) => g.size));
  return {
    games,
    updated_at: new Date().toISOString(),
    season,
    week: weeksPlayed,
    source: "nflverse (stats_player, pfr_advstats, snap_counts, play_by_play)",
    team_games: Object.fromEntries(
      Array.from(teamGames.entries(), ([t, g]) => [t, g.size]).sort(([a], [b]) => a.localeCompare(b)),
    ),
    rows: out,
  };
}

/* ------------------------------------------------------------------ check */

/** Compare a built 2025 with the committed statchasers-data file. */
function check(built) {
  const ref = JSON.parse(fs.readFileSync(path.join(DATA, "rb_advanced_stats_2025.json"), "utf8"));
  const byId = new Map(built.rows.map((r) => [r.playerId, r]));
  const fields = Object.keys(built.rows[0]).filter(
    (k) => !["playerId", "gsisId", "playerName", "position", "season", "routes", "yardsPerRouteRun"].includes(k),
  );
  const tally = Object.fromEntries(fields.map((f) => [f, { same: 0, close: 0, off: 0, examples: [] }]));
  let matched = 0;
  for (const r of ref.rows) {
    const b = byId.get(String(r.playerId));
    if (!b) continue;
    matched += 1;
    for (const f of fields) {
      const a = r[f];
      const c = b[f];
      const t = tally[f];
      if (a === c || (a == null && c == null)) t.same += 1;
      else if (typeof a === "number" && typeof c === "number" && Math.abs(a - c) <= Math.max(0.05 * Math.abs(a), 0.11)) t.close += 1;
      else {
        t.off += 1;
        if (t.examples.length < 3) t.examples.push(`${r.playerName}: ${a} vs ${c}`);
      }
    }
  }
  console.log(`matched ${matched} of ${ref.rows.length} reference rows`);
  for (const [f, t] of Object.entries(tally)) {
    console.log(`${f.padEnd(30)} same ${String(t.same).padStart(3)} close ${String(t.close).padStart(3)} off ${String(t.off).padStart(3)}  ${t.examples.join(" | ")}`);
  }
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2016) throw new Error("usage: buildStats.mjs <season> [--check | --games-only]");
  const built = await buildSeason(season);
  if (process.argv.includes("--check")) {
    check(built);
    return;
  }
  const { games, ...stats } = built;
  // One game per line: a season is a few thousand of them.
  const log = path.join(DATA, `rb_games_${season}.json`);
  fs.writeFileSync(
    log,
    `{"season":${season},"week":${built.week},"players":[\n` +
      games
        .map(({ games: lines, ...who }) =>
          `${JSON.stringify({ ...who, games: "@@" })}`.replace('"@@"', `[\n${lines.map((g) => ` ${JSON.stringify(g)}`).join(",\n")}\n]`),
        )
        .join(",\n") +
      `\n]}\n`,
  );
  console.log(`wrote ${path.relative(process.cwd(), log)}: ${games.length} backs' game logs`);
  // The previous season is only needed as a game log; its season totals are
  // the committed rb_advanced_stats file.
  if (process.argv.includes("--games-only")) return;
  const out = path.join(DATA, `rb_stats_${season}.json`);
  fs.writeFileSync(out, `${JSON.stringify(stats, null, 1)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${stats.rows.length} backs through week ${stats.week}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
