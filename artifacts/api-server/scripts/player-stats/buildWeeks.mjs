/**
 * Cut the advanced stats tables to weeks 1-17 - the fantasy season.
 *
 *   node scripts/player-stats/buildWeeks.mjs [--dir <data dir>] [--cache <dir>]
 *
 * Reads the snapshot in `<data dir>/source/` and writes the tables the site
 * serves to `<data dir>`. Two directories hold such tables:
 * `data/player-stats` (the default; the advanced stats table) and
 * `data/player/advanced_stats` (the player pages' Advanced section - an
 * earlier cut of the same pipeline, see stats-data.ts). Run it for both. The snapshot is the file set the
 * standalone app shipped: full regular seasons, weeks 1-18, built by a pipeline
 * that is not in any repo we have. So this does not rebuild a table from
 * scratch. For every figure it computes the same stat twice from nflverse's
 * weekly data - through week 17 and through week 18 - and moves the snapshot's
 * value by the difference:
 *
 *     weeks 1-17 = snapshot + (ours through 17 − ours through 18)
 *
 * Where our definition matches the snapshot's, that is exactly our weeks 1-17
 * figure; where the two differ a little, the snapshot's own definition survives
 * and only week 18 comes out.
 *
 * Every definition below was matched against the snapshot, and the match is
 * re-checked on every run, per file and per column: a column is cut only when
 * our through-18 figure agrees with the snapshot for at least MIN_AGREEMENT of
 * the players. The rest - no weekly source at all (on-target %, pocket time,
 * batted passes), a different vendor's charting (time to throw, throwaways,
 * catchable targets), or a season the snapshot left blank - keep their
 * weeks 1-18 values and are listed in the output's `fullSeason`, which the
 * table footnotes.
 *
 * A player whose only game was week 18 has no weeks 1-17 line and is dropped.
 *
 * Sources, all nflverse weekly (regular season): stats_player (box score,
 * fantasy points), play_by_play (situational and per-play figures),
 * pbp_participation (routes), ftn_charting (catchable, throwaways),
 * pfr_advstats (drops, bad throws, pressure, broken tackles, contact yards),
 * snap_counts; ids through the dynastyprocess crosswalk. `--cache <dir>` reads
 * a file from <dir> by its name when it is there, which keeps re-runs off the
 * network.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { splitCsv } from "../rb-handcuffs/buildStats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "..");
let DATA = path.join(APP, "data", "player-stats");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
const IDS_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

export const LAST_WEEK = 17;
const CUTS = [LAST_WEEK, 18];
const MIN_AGREEMENT = 0.7;
const POSITIONS = ["qb", "rb", "wr", "te"];

const TEAM_FIX = { LAR: "LA", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" };
const team = (t) => (t ? TEAM_FIX[t] ?? t : t);
const num = (v) => {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ input */

let cacheDir = null;
export const useCache = (dir) => {
  cacheDir = dir;
};

export async function* rows(url) {
  const cached = cacheDir ? path.join(cacheDir, path.basename(url)) : null;
  let stream;
  if (cached && fs.existsSync(cached)) stream = fs.createReadStream(cached);
  else {
    const res = await fetch(url, { redirect: "follow" });
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

/* ------------------------------------------------------------ accumulating */

/**
 * Sums per player, per scope ("2023" … and "all"), per cutoff. A week counts
 * toward every cutoff it falls under, so one pass fills both.
 */
class Tally {
  constructor(seasons) {
    this.players = {};
    for (const scope of [...seasons.map(String), "all"]) {
      this.players[scope] = Object.fromEntries(CUTS.map((cut) => [cut, new Map()]));
    }
    /** "season:week:team" → team sums, for shares. */
    this.teamWeek = new Map();
  }

  maps(season, week) {
    const out = [];
    for (const cut of CUTS) {
      if (week > cut) continue;
      out.push(this.players[String(season)][cut], this.players.all[cut]);
    }
    return out;
  }

  player(map, id) {
    let p = map.get(id);
    if (!p) {
      p = { weeks: new Set(), last: {}, snapPcts: [] };
      map.set(id, p);
    }
    return p;
  }

  add(season, week, id, field, value) {
    if (!id || value == null) return;
    for (const map of this.maps(season, week)) {
      const p = this.player(map, id);
      p[field] = (p[field] ?? 0) + value;
    }
  }

  max(season, week, id, field, value) {
    if (!id || value == null) return;
    for (const map of this.maps(season, week)) {
      const p = this.player(map, id);
      p[field] = Math.max(p[field] ?? -Infinity, value);
    }
  }

  each(season, week, id, fn) {
    if (!id) return;
    for (const map of this.maps(season, week)) fn(this.player(map, id));
  }

  team(season, week, t, field, value) {
    if (!t) return;
    const key = `${season}:${week}:${t}`;
    if (!this.teamWeek.has(key)) this.teamWeek.set(key, {});
    const o = this.teamWeek.get(key);
    o[field] = (o[field] ?? 0) + value;
  }

  /**
   * A team figure over the player's LAST team in each season, weeks 1..cut -
   * the snapshot's denominator for shares, which is why a traded receiver's
   * route share is against the team he finished with.
   */
  lastTeamTotal(p, cut, field) {
    let total = 0;
    for (const [season, [, t]] of Object.entries(p.last)) {
      for (let w = 1; w <= cut; w += 1) total += this.teamWeek.get(`${season}:${w}:${t}`)?.[field] ?? 0;
    }
    return total;
  }
}

export async function collect(seasons) {
  const tally = new Tally(seasons);
  const regular = (r) => (r.season_type ?? r.game_type) === "REG";

  const sleeperToGsis = new Map();
  const gsisByPfr = new Map();
  /** gsis id → the crosswalk row, for a table built from scratch (buildSeason.mjs). */
  const people = new Map();
  for await (const r of rows(IDS_URL)) {
    if (!r.gsis_id || r.gsis_id === "NA") continue;
    people.set(r.gsis_id, r);
    if (r.sleeper_id && r.sleeper_id !== "NA") sleeperToGsis.set(r.sleeper_id, r.gsis_id);
    if (r.pfr_id && r.pfr_id !== "NA") gsisByPfr.set(r.pfr_id, r.gsis_id);
  }
  const names = new Map();
  const positions = new Map();
  /** Seasons nflverse has no participation file for yet: no routes. */
  const noRoutes = new Set();

  for (const season of seasons) {
    // Box score.
    const BOX = {
      cmp: "completions", att: "attempts", passYds: "passing_yards", passTd: "passing_tds",
      int: "passing_interceptions", sacks: "sacks_suffered", sackYds: "sack_yards_lost",
      sackFum: "sack_fumbles", passAir: "passing_air_yards", passEpa: "passing_epa",
      carries: "carries", rushYds: "rushing_yards", rushTd: "rushing_tds", rushFum: "rushing_fumbles",
      rushEpa: "rushing_epa", targets: "targets", rec: "receptions", recYds: "receiving_yards",
      recTd: "receiving_tds", recFum: "receiving_fumbles", recAir: "receiving_air_yards",
      recYac: "receiving_yards_after_catch", recEpa: "receiving_epa", fp: "fantasy_points",
    };
    for await (const r of rows(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`)) {
      if (!regular(r)) continue;
      const w = Number(r.week);
      const t = team(r.team);
      const id = r.player_id;
      if (id) {
        names.set(id, r.player_display_name || r.player_name);
        positions.set(id, r.position);
      }
      tally.team(season, w, t, "targets", num(r.targets) ?? 0);
      tally.each(season, w, id, (p) => {
        p.weeks.add(`${season}:${w}`);
        if (!p.last[season] || w >= p.last[season][0]) p.last[season] = [w, t];
      });
      for (const [field, col] of Object.entries(BOX)) tally.add(season, w, id, field, num(r[col]));
    }

    // Snap share: the mean of each game's offensive share, over every game
    // with a snap on offense or special teams (matched in rb-handcuffs).
    for await (const r of rows(`${NFLVERSE}/snap_counts/snap_counts_${season}.csv`)) {
      if (!regular(r)) continue;
      const id = gsisByPfr.get(r.pfr_player_id);
      if (!id) continue;
      if ((num(r.offense_snaps) ?? 0) <= 0 && (num(r.st_snaps) ?? 0) <= 0) continue;
      tally.each(season, Number(r.week), id, (p) => p.snapPcts.push(num(r.offense_pct) ?? 0));
    }

    // PFR advanced, weekly.
    const PFR = {
      pass: { pDrops: "passing_drops", bad: "passing_bad_throws", blitz: "times_blitzed", hurry: "times_hurried", hit: "times_hit", press: "times_pressured" },
      rec: { recBt: "receiving_broken_tackles", rDrops: "receiving_drop", rInt: "receiving_int" },
      rush: { pfrCar: "carries", ybc: "rushing_yards_before_contact", yaco: "rushing_yards_after_contact", rushBt: "rushing_broken_tackles" },
    };
    for (const [kind, fields] of Object.entries(PFR)) {
      for await (const r of rows(`${NFLVERSE}/pfr_advstats/advstats_week_${kind}_${season}.csv`)) {
        if (!regular(r)) continue;
        const id = gsisByPfr.get(r.pfr_player_id);
        if (!id) continue;
        for (const [field, col] of Object.entries(fields)) tally.add(season, Number(r.week), id, field, num(r[col]));
      }
    }

    // Play by play. `plays` remembers the pass plays for the participation
    // and charting files, which key on the same game and play ids.
    const plays = new Map();
    for await (const r of rows(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`)) {
      if (r.season_type !== "REG" || r.two_point_attempt === "1" || r.aborted_play === "1") continue;
      const w = Number(r.week);
      const t = team(r.posteam);
      const yl = num(r.yardline_100);
      const air = num(r.air_yards);
      const epa = num(r.epa) ?? 0;
      const success = num(r.success) ?? 0;
      const dropback = r.qb_dropback === "1";
      const scramble = r.qb_scramble === "1";
      const attempt = r.pass_attempt === "1" && r.sack !== "1";

      if (dropback && !scramble) tally.team(season, w, t, "dbNoScr", 1);
      if (attempt && air != null) tally.team(season, w, t, "air", air);
      if (dropback || attempt) {
        plays.set(`${r.game_id}:${num(r.play_id)}`, {
          w, passer: r.passer_player_id, receiver: r.receiver_player_id, dropback, scramble, attempt,
        });
      }

      const qb = r.passer_player_id || (dropback ? r.rusher_player_id : null);
      if (dropback && qb) {
        tally.add(season, w, qb, "db", 1);
        tally.add(season, w, qb, "dbEpa", epa);
        tally.add(season, w, qb, "dbSucc", success);
        if (scramble) {
          tally.add(season, w, qb, "scr", 1);
          tally.add(season, w, qb, "scrYds", num(r.rushing_yards) ?? 0);
        }
      }
      if (r.rush_attempt === "1" && r.rusher_player_id && !dropback) {
        tally.add(season, w, r.rusher_player_id, "designRush", 1);
        tally.add(season, w, r.rusher_player_id, "drSucc", success);
      }
      if (r.pass_attempt === "1" && yl != null && yl <= 20) tally.add(season, w, r.passer_player_id, "rzAtt", 1);
      if (attempt && r.passer_player_id) {
        const id = r.passer_player_id;
        const yards = num(r.passing_yards) ?? 0;
        if (air != null && air >= 20) tally.add(season, w, id, "deep", 1);
        if (r.complete_pass === "1") {
          tally.add(season, w, id, "cay", air ?? 0);
          for (const n of [10, 20, 30, 40, 50]) if (yards >= n) tally.add(season, w, id, `p${n}`, 1);
          tally.max(season, w, id, "longPass", yards);
        }
        const cpoe = num(r.cpoe);
        if (cpoe != null) {
          tally.add(season, w, id, "cpoeSum", cpoe);
          tally.add(season, w, id, "cpoeN", 1);
        }
      }
      if (attempt && r.receiver_player_id) {
        const id = r.receiver_player_id;
        const yards = num(r.receiving_yards) ?? 0;
        tally.add(season, w, id, "tgtPbp", 1);
        tally.add(season, w, id, "tgtSucc", success);
        if (yl != null && yl <= 20) tally.add(season, w, id, "rzTgt", 1);
        // The snapshot's "EZ TGT" is targets inside the 10.
        if (yl != null && yl <= 10) tally.add(season, w, id, "tgt10", 1);
        if (r.complete_pass === "1") {
          for (const n of [10, 20, 30, 40, 50]) if (yards >= n) tally.add(season, w, id, `r${n}`, 1);
          tally.max(season, w, id, "longRec", yards);
        }
      }
      if (r.rush_attempt === "1" && r.rusher_player_id) {
        const id = r.rusher_player_id;
        const yards = num(r.rushing_yards) ?? 0;
        if (yl != null && yl <= 20) tally.add(season, w, id, "rzRush", 1);
        if (yl != null && yl <= 5) tally.add(season, w, id, "glCar", 1);
        for (const n of [10, 15, 20, 30, 40, 50]) if (yards >= n) tally.add(season, w, id, `ru${n}`, 1);
        if (yards < 0) {
          tally.add(season, w, id, "neg", 1);
          tally.add(season, w, id, "negYds", -yards);
        }
        tally.max(season, w, id, "longRush", yards);
        if (r.rush_touchdown === "1") tally.max(season, w, id, "longRushTd", yards);
      }
    }

    // Routes: every dropback a player was on the field for, scrambles out.
    // nflverse publishes a season's participation file late, so a season in
    // progress has none; its route columns are left blank.
    try {
      for await (const r of rows(`${NFLVERSE}/pbp_participation/pbp_participation_${season}.csv`)) {
        const play = plays.get(`${r.nflverse_game_id}:${num(r.play_id)}`);
        if (!play?.dropback || play.scramble) continue;
        for (const id of (r.offense_players || "").split(";")) if (id) tally.add(season, play.w, id, "routes", 1);
      }
    } catch (err) {
      if (!/answered 404/.test(err.message)) throw err;
      noRoutes.add(season);
      console.log(`  ${season}: no participation file yet, so no routes`);
    }

    for await (const r of rows(`${NFLVERSE}/ftn_charting/ftn_charting_${season}.csv`)) {
      const play = plays.get(`${r.nflverse_game_id}:${num(r.nflverse_play_id)}`);
      if (!play) continue;
      if (play.attempt && play.receiver && r.is_catchable_ball === "TRUE") tally.add(season, play.w, play.receiver, "catchable", 1);
      if (play.passer && r.is_throw_away === "TRUE") tally.add(season, play.w, play.passer, "throwaway", 1);
    }
    console.log(`  ${season} collected`);
  }
  return { tally, sleeperToGsis, names, positions, people, noRoutes };
}

/* ------------------------------------------------------------ definitions */

const g = (p, k) => p[k] ?? 0;
const ratio = (a, b, scale = 1) => (b ? (a / b) * scale : null);

/**
 * Each column's figure from one player's sums at one cutoff. The chosen
 * definition is the one that matched the snapshot; the alternatives tried are
 * noted where the choice is not obvious.
 */
export function definitions(position, tally) {
  const common = {
    games: (p) => p.weeks.size,
    fantasyPoints: (p) => g(p, "fp"),
    snapPct: (p) => (p.snapPcts.length ? (p.snapPcts.reduce((a, b) => a + b, 0) / p.snapPcts.length) * 100 : null),
  };
  if (position === "qb") {
    return {
      ...common,
      attempts: (p) => g(p, "att"),
      completions: (p) => g(p, "cmp"),
      completionPct: (p) => ratio(g(p, "cmp"), g(p, "att"), 100),
      passingYards: (p) => g(p, "passYds"),
      // Labeled "Yds / Comp", but the snapshot's figure is yards per attempt.
      yardsPerCatch: (p) => ratio(g(p, "passYds"), g(p, "att")),
      passingTouchdowns: (p) => g(p, "passTd"),
      interceptions: (p) => g(p, "int"),
      airYards: (p) => g(p, "passAir"),
      completedAirYards: (p) => g(p, "cay"),
      airYardsPerAttempt: (p) => ratio(g(p, "passAir"), g(p, "att")),
      completedAirYardsPerCompletion: (p) => ratio(g(p, "cay"), g(p, "cmp")),
      // Sacks included: pass_attempt is 1 on a sack in nflverse.
      redZoneAttempts: (p) => g(p, "rzAtt"),
      rushAttempts: (p) => g(p, "carries"),
      rushYards: (p) => g(p, "rushYds"),
      rushTouchdowns: (p) => g(p, "rushTd"),
      poorThrows: (p) => g(p, "bad"),
      badThrowPct: (p) => ratio(g(p, "bad"), g(p, "att") - g(p, "throwaway"), 100),
      passesDropped: (p) => g(p, "pDrops"),
      epaPerPlay: (p) => ratio(g(p, "passEpa") + g(p, "rushEpa"), g(p, "att") + g(p, "sacks") + g(p, "carries")),
      successRate: (p) => ratio(g(p, "dbSucc") + g(p, "drSucc"), g(p, "db") + g(p, "designRush"), 100),
      cpoe: (p) => ratio(g(p, "cpoeSum"), g(p, "cpoeN")),
      passes10Plus: (p) => g(p, "p10"),
      passes20Plus: (p) => g(p, "p20"),
      passes30Plus: (p) => g(p, "p30"),
      passes40Plus: (p) => g(p, "p40"),
      passes50Plus: (p) => g(p, "p50"),
      longestPass: (p) => p.longPass ?? null,
      deepAttemptPct: (p) => ratio(g(p, "deep"), g(p, "att") + g(p, "sacks"), 100),
      throwaways: (p) => g(p, "throwaway"),
      scrambleRate: (p) => ratio(g(p, "scr"), g(p, "att") + g(p, "sacks") + g(p, "scr"), 100),
      yardsPerScramble: (p) => ratio(g(p, "scrYds"), g(p, "scr")),
      hurries: (p) => g(p, "hurry"),
      blitzes: (p) => g(p, "blitz"),
      knockdowns: (p) => g(p, "hit"),
      pressurePct: (p) => ratio(g(p, "press"), g(p, "db"), 100),
      sacks: (p) => g(p, "sacks"),
      sackYardsLost: (p) => Math.abs(g(p, "sackYds")),
      fumbles: (p) => g(p, "rushFum") + g(p, "recFum") + g(p, "sackFum"),
    };
  }

  const receiving = {
    ...common,
    routes: (p) => g(p, "routes"),
    targets: (p) => g(p, "targets"),
    receptions: (p) => g(p, "rec"),
    receivingYards: (p) => g(p, "recYds"),
    receivingTouchdowns: (p) => g(p, "recTd"),
    redZoneTargets: (p) => g(p, "rzTgt"),
    endZoneTargets: (p) => g(p, "tgt10"),
    yardsPerReception: (p) => ratio(g(p, "recYds"), g(p, "rec")),
    yardsPerRouteRun: (p) => ratio(g(p, "recYds"), g(p, "routes")),
    fumbles: (p) => g(p, "rushFum") + g(p, "recFum"),
  };
  // Shares are of the last team's weeks-1..cut totals; see lastTeamTotal().
  const share = (cut) => ({
    targetSharePct: (p) => ratio(g(p, "targets"), tally.lastTeamTotal(p, cut, "targets"), 100),
  });

  if (position === "rb") {
    return (cut) => ({
      ...receiving,
      ...share(cut),
      rushAttempts: (p) => g(p, "carries"),
      rushYards: (p) => g(p, "rushYds"),
      rushTouchdowns: (p) => g(p, "rushTd"),
      yardsPerCarry: (p) => ratio(g(p, "rushYds"), g(p, "carries")),
      redZoneOpportunities: (p) => g(p, "rzRush") + g(p, "rzTgt"),
      goalLineCarries: (p) => g(p, "glCar"),
      receivingYardsAfterCatch: (p) => g(p, "recYac"),
      epaPerPlay: (p) => ratio(g(p, "rushEpa") + g(p, "recEpa"), g(p, "carries") + g(p, "targets")),
      rushes10Plus: (p) => g(p, "ru10"),
      rushes20Plus: (p) => g(p, "ru20"),
      rushes30Plus: (p) => g(p, "ru30"),
      rushes40Plus: (p) => g(p, "ru40"),
      rushes50Plus: (p) => g(p, "ru50"),
      explosiveRunPct: (p) => ratio(g(p, "ru10"), g(p, "carries"), 100),
      breakawayRunPct: (p) => ratio(g(p, "ru15"), g(p, "carries"), 100),
      longestRush: (p) => p.longRush ?? null,
      longestRushTouchdown: (p) => p.longRushTd ?? null,
      brokenTackles: (p) => g(p, "rushBt"),
      rushAttemptsPerBrokenTackle: (p) => ratio(g(p, "carries"), g(p, "rushBt")),
      yardsBeforeContactPerAttempt: (p) => ratio(g(p, "ybc"), g(p, "pfrCar")),
      yardsAfterContactPerAttempt: (p) => ratio(g(p, "yaco"), g(p, "pfrCar")),
      tackleEludedRate: (p) => ratio(g(p, "rushBt"), g(p, "carries") + g(p, "rec"), 100),
      tacklesForLoss: (p) => g(p, "neg"),
      tacklesForLossYards: (p) => g(p, "negYds"),
      rushAttForNegativeYards: (p) => g(p, "neg"),
    });
  }

  return (cut) => ({
    ...receiving,
    ...share(cut),
    routePct: (p) => ratio(g(p, "routes"), tally.lastTeamTotal(p, cut, "dbNoScr"), 100),
    targetsPerRouteRun: (p) => ratio(g(p, "targets"), g(p, "routes")),
    airYardsPerTarget: (p) => ratio(g(p, "recAir"), g(p, "targets")),
    airYardsPerReception: (p) => ratio(g(p, "recAir"), g(p, "rec")),
    airYardsSharePct: (p) => ratio(g(p, "recAir"), tally.lastTeamTotal(p, cut, "air"), 100),
    wopr: (p) => {
      const targets = tally.lastTeamTotal(p, cut, "targets");
      const air = tally.lastTeamTotal(p, cut, "air");
      return targets && air ? (1.5 * g(p, "targets")) / targets + (0.7 * g(p, "recAir")) / air : null;
    },
    yardsBeforeCatchPerReception: (p) => ratio(g(p, "recYds") - g(p, "recYac"), g(p, "rec")),
    yardsAfterCatchPerReception: (p) => ratio(g(p, "recYac"), g(p, "rec")),
    totalYards: (p) => g(p, "recYds") + g(p, "rushYds"),
    epaPerPlay: (p) => ratio(g(p, "recEpa"), g(p, "targets")),
    successRate: (p) => ratio(g(p, "tgtSucc"), g(p, "tgtPbp"), 100),
    catchPct: (p) => ratio(g(p, "rec"), g(p, "targets"), 100),
    catchableTargets: (p) => g(p, "catchable"),
    drops: (p) => g(p, "rDrops"),
    dropPct: (p) => ratio(g(p, "rDrops"), g(p, "targets"), 100),
    interceptionsWhenTargeted: (p) => g(p, "rInt"),
    brokenTackles: (p) => g(p, "recBt"),
    avoidedTackleRate: (p) => ratio(g(p, "recBt"), g(p, "rec"), 100),
    receptions10Plus: (p) => g(p, "r10"),
    receptions20Plus: (p) => g(p, "r20"),
    receptions30Plus: (p) => g(p, "r30"),
    receptions40Plus: (p) => g(p, "r40"),
    receptions50Plus: (p) => g(p, "r50"),
    longestReception: (p) => p.longRec ?? null,
  });
}

/* --------------------------------------------------------------- applying */

const normalName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");

/** Does our through-18 figure agree with the snapshot's? */
function agrees(snap, ours) {
  if (snap == null) return ours == null || ours === 0;
  if (ours == null) return snap === 0;
  const tolerance = Math.max(Number.isInteger(snap) ? 0.5 : 0.051, 0.03 * Math.abs(snap));
  return Math.abs(snap - ours) <= tolerance;
}

/** Decimal places the snapshot prints a column to. */
export function placesOf(values) {
  let places = 0;
  for (const v of values) {
    if (typeof v !== "number" || Number.isInteger(v)) continue;
    places = Math.max(places, (String(v).split(".")[1] ?? "").length);
  }
  return Math.min(places, 3);
}

function cutTable(position, scope, source, collected) {
  const { tally, sleeperToGsis, names } = collected;
  const defs = definitions(position, tally);
  const defsAt = (cut) => (typeof defs === "function" ? defs(cut) : defs);
  const at17 = defsAt(LAST_WEEK);
  const at18 = defsAt(18);
  const players17 = tally.players[scope][LAST_WEEK];
  const players18 = tally.players[scope][18];

  // Ids: the row's Sleeper id through the crosswalk, else its name among the
  // players nflverse has for this scope.
  const byName = new Map();
  for (const id of players18.keys()) {
    const key = normalName(names.get(id));
    if (key) byName.set(key, byName.has(key) ? null : id);
  }
  const idOf = (row) => {
    const viaSleeper = sleeperToGsis.get(String(row.playerId));
    if (viaSleeper && players18.has(viaSleeper)) return viaSleeper;
    return byName.get(normalName(row.playerName)) ?? null;
  };

  const matched = source.rows.map((row) => ({ row, id: idOf(row) }));
  const found = matched.filter((m) => m.id);

  // Which columns this table can cut.
  const cut = [];
  const fullSeason = [];
  const keys = source.columns.map((c) => c.key);
  for (const key of keys) {
    if (["rank", "playerId", "playerName", "position", "team", "age", "season"].includes(key)) continue;
    // A column the snapshot left blank throughout has nothing to footnote.
    if (source.rows.every((row) => row[key] == null)) continue;
    if (!at18[key]) {
      fullSeason.push(key);
      continue;
    }
    const agree = found.filter(({ row, id }) => agrees(row[key], at18[key](players18.get(id)))).length;
    if (found.length > 0 && agree / found.length >= MIN_AGREEMENT) cut.push(key);
    else fullSeason.push(key);
  }

  const places = Object.fromEntries(keys.map((k) => [k, placesOf(source.rows.map((r) => r[k]))]));
  // By the column's type, not the value: FPTS 246.0 is a decimal that happens
  // to be whole.
  const counts = new Set(source.columns.filter((c) => c.type === "number").map((c) => c.key));
  const round = (v, k) => {
    const f = 10 ** places[k];
    return Math.round(v * f) / f;
  };

  let dropped = 0;
  let unmatched = 0;
  const out = [];
  for (const { row, id } of matched) {
    if (!id) {
      // No weekly line to take week 18 out of. Rare (a handful per table) and
      // almost all fringe players; kept as they are.
      unmatched += 1;
      out.push({ ...row });
      continue;
    }
    const p18 = players18.get(id);
    const p17 = players17.get(id);
    if (!p17) {
      // His only game was week 18.
      dropped += 1;
      continue;
    }
    const next = { ...row };
    for (const key of cut) {
      const base = row[key];
      if (base == null) continue;
      const a = at17[key](p17);
      const b = at18[key](p18);
      if (a == null || b == null) continue;
      const value = round(base + (a - b), key);
      next[key] = counts.has(key) ? Math.round(value) : value;
    }
    out.push(next);
  }

  return {
    table: {
      ...source,
      week: LAST_WEEK,
      weeks: `1-${LAST_WEEK}`,
      fullSeason,
      rows: out,
    },
    report: { cut: cut.length, fullSeason, dropped, unmatched, rows: out.length, of: source.rows.length },
  };
}

/* -------------------------------------------------------------------- run */

async function main() {
  const at = process.argv.indexOf("--cache");
  if (at > 0) cacheDir = path.resolve(process.argv[at + 1]);
  const dir = process.argv.indexOf("--dir");
  if (dir > 0) DATA = path.resolve(APP, process.argv[dir + 1]);
  const SOURCE = path.join(DATA, "source");

  const files = fs.readdirSync(SOURCE).filter((f) => /^(qb|rb|wr|te)_(\d{4}|all)\.json$/.test(f));
  const seasons = [...new Set(files.map((f) => /_(\d{4})\.json$/.exec(f)?.[1]).filter(Boolean).map(Number))].sort();
  console.log(`collecting nflverse weeks for ${seasons.join(", ")}`);
  const collected = await collect(seasons);

  for (const file of files.sort()) {
    const [, position, scope] = /^(\w+)_(\d{4}|all)\.json$/.exec(file);
    if (!POSITIONS.includes(position)) continue;
    const source = JSON.parse(fs.readFileSync(path.join(SOURCE, file), "utf8"));
    const { table, report } = cutTable(position, scope, source, collected);
    fs.writeFileSync(path.join(DATA, file), `${JSON.stringify(table, null, 2)}\n`);
    console.log(
      `${file}: ${report.rows}/${report.of} rows (${report.dropped} week-18-only dropped, ${report.unmatched} unmatched kept), ` +
        `${report.cut} columns cut, full season: ${report.fullSeason.join(", ") || "none"}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
