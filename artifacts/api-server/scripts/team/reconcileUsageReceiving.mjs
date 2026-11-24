/**
 * Team Usage receiving yards against the player pages' game logs, every
 * club/player pair, same games.
 *
 *   node scripts/team/reconcileUsageReceiving.mjs <season>
 *        [--at <git-sha>]      read usage + game logs as committed at that sha
 *        [--pbp <dir>]         play_by_play_<season>.csv.gz in <dir>: per-game
 *                              Usage yards and a cause for every mismatch
 *        [--player <slug|name>] print that player's game-by-game table
 *        [--json <file>]
 *
 * The two sides:
 *   Team Usage   data/team/usage_<season>.json, players[].recYards, built by
 *                scripts/team/buildUsage.mjs from nflverse play-by-play over
 *                the club's games through `throughWeek` (teams[club].games).
 *   Player pages data/player/game_logs/<season>.json (Sleeper weekly stats,
 *                keyed by Sleeper id), stats.rec_yd per game. The hub header,
 *                Stats tab and Game Log all sum these rows (season-line.ts).
 *
 * A pair = one player at one club. Its window = that club's games in the
 * Usage file; the log side sums only rows in those weeks with that club, so a
 * traded player is compared club by club. Both promise official season
 * receiving yards, so the expected difference is zero.
 *
 * Causes, when --pbp is given (per game, play-by-play rebuilt with the
 * builder's own receivingCredits()):
 *   usage-stale-lateral   the Usage file equals play-by-play WITHOUT lateral
 *                         yards: built before the 2026-11-19 lateral fix
 *   usage-stale           the Usage file differs from today's play-by-play
 *                         some other way (an older feed; rebuild)
 *   log-missing-game      the player has a Usage game with yards and no log row
 *   log-stale             the logs stop before the Usage file's last week
 *   qb-catch              a quarterback's catch (self-caught deflection, trick
 *                         play) that play-by-play credits and the log lacks
 *   lateral               a game where only the lateral yards differ
 *   unexplained           none of the above
 * Without --pbp a mismatch is "unclassified".
 *
 * Exit code 1 when any mismatch is unexplained or unclassified, so a weekly
 * refresh can run it as a gate.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { receivingCredits } from "./buildUsage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "..");
const DATA = path.join(APP, "data");

/* ------------------------------------------------------------- inputs */

function readJsonAt(rel, sha) {
  if (!sha) return JSON.parse(fs.readFileSync(path.join(APP, rel), "utf8"));
  const repoRel = path.relative(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: APP, encoding: "utf8" }).trim(), path.join(APP, rel));
  const text = execFileSync("git", ["show", `${sha}:${repoRel}`], { cwd: APP, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(text);
}

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

/**
 * The plays the Usage report counts, with only the fields this check needs.
 * Same filter as buildUsage.mjs: regular season, through `throughWeek`, an
 * offense, play_type pass or run, no two-point try.
 */
export async function readPbpPlays(file, throughWeek) {
  const keep = [
    "game_id", "play_id", "season_type", "week", "posteam", "play_type", "two_point_attempt", "pass_attempt", "sack",
    "complete_pass", "receiver_player_id", "receiving_yards", "lateral_receiver_player_id", "lateral_receiving_yards",
    "passer_player_id", "desc",
  ];
  let stream = fs.createReadStream(file);
  if (file.endsWith(".gz")) stream = stream.pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let idx = null;
  let pending = "";
  const plays = [];
  for await (const raw of lines) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if ((line.match(/"/g) ?? []).length % 2 === 1) {
      pending = line;
      continue;
    }
    pending = "";
    const f = splitCsv(line);
    if (!header) {
      header = f;
      idx = keep.map((k) => header.indexOf(k));
      continue;
    }
    const r = {};
    keep.forEach((k, i) => {
      r[k] = idx[i] >= 0 ? f[idx[i]] : undefined;
    });
    if (r.season_type !== "REG" || !r.posteam || r.posteam === "NA") continue;
    if (Number(r.week) > throughWeek) continue;
    if (r.two_point_attempt === "1") continue;
    if (r.play_type !== "pass" && r.play_type !== "run") continue;
    plays.push(r);
  }
  return plays;
}

/* ------------------------------------------------------------- compare */

const TEAM_FIX = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const club = (t) => (t ? (TEAM_FIX[t] ?? t).toLowerCase() : null);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");

/** Per club|gsis|week: { yards, noLat, lateral, plays[] } and club|week -> game_id. */
export function pbpByGame(plays) {
  const byKey = new Map();
  const gameIds = new Map();
  for (const r of plays) {
    const c = club(r.posteam);
    const week = Number(r.week);
    gameIds.set(`${c}|${week}`, r.game_id);
    for (const cr of receivingCredits(r)) {
      const k = `${c}|${cr.id}|${week}`;
      let e = byKey.get(k);
      if (!e) byKey.set(k, (e = { yards: 0, noLat: 0, lateral: 0, plays: [] }));
      e.yards += cr.yards;
      if (cr.lateral) {
        e.lateral += cr.yards;
        e.plays.push({ game: r.game_id, play: r.play_id, lateralYards: cr.yards, desc: r.desc });
      } else e.noLat += cr.yards;
      if (!cr.lateral && r.passer_player_id === cr.id) e.plays.push({ game: r.game_id, play: r.play_id, selfCatch: true, desc: r.desc });
    }
  }
  return { byKey, gameIds };
}

/**
 * Every Usage row with a target or receiving yards against the logs.
 * `players` (players.json) lets a row with no Sleeper id fall back to a
 * unique name + club match. `pbp` is pbpByGame()'s result, or null.
 */
export function reconcile({ usage, logs, players = [], logsThroughWeek = null, pbp = null }) {
  const byNameClub = new Map();
  for (const p of players) {
    const k = `${norm(p.name)}|${String(p.team ?? "").toLowerCase()}`;
    byNameClub.set(k, byNameClub.has(k) ? null : String(p.id));
  }
  const out = [];
  for (const [c, t] of Object.entries(usage.teams)) {
    const window = [...(t.games ?? [])].sort((a, b) => a - b);
    for (const p of t.players) {
      if (!p.targets && !p.recYards) continue;
      let sid = p.sleeperId ? String(p.sleeperId) : null;
      let idVia = "sleeperId";
      if (!sid) {
        // A first initial + last name ("Matthew" / "Matt") still finds him.
        sid = byNameClub.get(`${norm(p.name)}|${c}`) ?? null;
        if (!sid) {
          const last = norm(String(p.name).split(" ").slice(1).join(" "));
          const hits = players.filter(
            (q) => String(q.team ?? "").toLowerCase() === c && norm(String(q.name).split(" ").slice(1).join(" ")) === last && norm(q.name)[0] === norm(p.name)[0],
          );
          sid = hits.length === 1 ? String(hits[0].id) : null;
        }
        idVia = sid ? "name+club" : "none";
      }
      const rows = sid ? (logs[sid] ?? []).filter((r) => window.includes(r.week) && String(r.team ?? "").toLowerCase() === c) : [];
      const logYards = rows.reduce((s, r) => s + (r.stats?.rec_yd ?? 0), 0);
      const logRec = rows.reduce((s, r) => s + (r.stats?.rec ?? 0), 0);
      const games = window.map((week) => {
        const row = rows.find((r) => r.week === week);
        const e = pbp?.byKey.get(`${c}|${p.id}|${week}`);
        return {
          week,
          gameId: pbp?.gameIds.get(`${c}|${week}`) ?? null,
          log: row ? (row.stats?.rec_yd ?? 0) : null,
          pbp: pbp ? (e?.yards ?? 0) : null,
          pbpNoLateral: pbp ? (e?.noLat ?? 0) : null,
          plays: e?.plays ?? [],
        };
      });
      const pair = {
        club: c,
        name: p.name,
        pos: p.pos,
        gsis: p.id,
        sleeperId: sid,
        idVia,
        window,
        usage: p.recYards ?? null,
        usageRec: p.receptions,
        logSum: sid ? logYards : null,
        logRec: sid ? logRec : null,
        diff: sid && p.recYards != null ? p.recYards - logYards : null,
        games,
        causes: [],
      };
      if (pair.diff === 0) pair.status = "match";
      else if (!sid) pair.status = "no-log-id";
      else {
        pair.status = "mismatch";
        pair.causes = classify(pair, usage.throughWeek, logsThroughWeek, pbp != null);
      }
      out.push(pair);
    }
  }
  return out;
}

function classify(pair, usageThrough, logsThrough, havePbp) {
  const causes = [];
  if (logsThrough != null && logsThrough < usageThrough) causes.push("log-stale");
  if (!havePbp) return causes.length ? causes : ["unclassified"];
  const pbpSum = pair.games.reduce((s, g) => s + g.pbp, 0);
  const pbpNoLat = pair.games.reduce((s, g) => s + g.pbpNoLateral, 0);
  if (pair.usage !== pbpSum) causes.push(pair.usage === pbpNoLat && pbpNoLat !== pbpSum ? "usage-stale-lateral" : "usage-stale");
  for (const g of pair.games) {
    if (g.log == null) {
      if (g.pbp !== 0) causes.push("log-missing-game");
      continue;
    }
    if (g.pbp === g.log) continue;
    if (g.pbpNoLateral === g.log && g.plays.some((x) => x.lateralYards != null)) causes.push("lateral");
    else if (pair.pos === "QB" || g.plays.some((x) => x.selfCatch)) causes.push("qb-catch");
    else causes.push("unexplained");
  }
  const uniq = [...new Set(causes)];
  // Usage stale and the logs right: the game rows explain nothing more.
  return uniq.length ? uniq : ["unexplained"];
}

/**
 * The first game whose Usage-side yards differ from the log. The Usage file
 * keeps season totals only, so its per-game side is play-by-play under the
 * rule the file was built with: without lateral yards for a pre-fix file
 * (usage-stale-lateral), with them otherwise.
 */
export function firstDifferingGame(pair) {
  const side = pair.causes.includes("usage-stale-lateral") ? "pbpNoLateral" : "pbp";
  return pair.games.find((g) => g[side] != null && g.log != null && g[side] !== g.log) ?? null;
}

/* ------------------------------------------------------------------- main */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const season = Number(argv[0]);
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  if (!Number.isInteger(season)) {
    console.error("usage: node scripts/team/reconcileUsageReceiving.mjs <season> [--at <sha>] [--pbp <dir>] [--player <slug|name>] [--json <file>]");
    process.exit(2);
  }
  const sha = opt("--at");
  const usage = readJsonAt(`data/team/usage_${season}.json`, sha);
  const logs = readJsonAt(`data/player/game_logs/${season}.json`, sha);
  let players = [];
  try {
    players = readJsonAt("data/player/players.json", sha);
  } catch {
    /* no name fallback */
  }
  let logsMeta = null;
  try {
    logsMeta = readJsonAt("data/dataset-meta.json", sha).datasets?.game_logs?.[String(season)] ?? null;
  } catch {
    /* older commits have no dataset-meta.json */
  }
  let pbp = null;
  const pbpDir = opt("--pbp");
  if (pbpDir) {
    const file = path.join(path.resolve(pbpDir), `play_by_play_${season}.csv.gz`);
    pbp = pbpByGame(await readPbpPlays(file, usage.throughWeek));
  }
  const pairs = reconcile({ usage, logs, players, logsThroughWeek: logsMeta?.throughWeek ?? null, pbp });

  console.log(`Team Usage receiving yards vs player game logs, ${season}${sha ? ` at ${sha}` : ""}`);
  console.log(`  usage:     built ${usage.builtAt}, through Week ${usage.throughWeek}`);
  console.log(
    `  game logs: ${logsMeta ? `ingested ${logsMeta.lastIngestedAt}, through Week ${logsMeta.throughWeek} (${logsMeta.latestCompletedGame})` : "no dataset-meta entry"}`,
  );
  const mism = pairs.filter((p) => p.status === "mismatch");
  const byCause = {};
  for (const p of mism) for (const c of p.causes) byCause[c] = (byCause[c] ?? 0) + 1;
  const viaName = pairs.filter((p) => p.idVia === "name+club").length;
  console.log(
    `  pairs ${pairs.length}: match ${pairs.filter((p) => p.status === "match").length}, mismatch ${mism.length}, no log id ${pairs.filter((p) => p.status === "no-log-id").length}` +
      (viaName ? ` (${viaName} paired by name + club: no Sleeper id in the Usage row)` : ""),
  );
  if (mism.length) console.log(`  causes: ${Object.entries(byCause).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const p of mism) {
    const first = firstDifferingGame(p);
    console.log(
      `  ${p.club.toUpperCase()} ${p.name} (${p.pos}, ${p.gsis} / ${p.sleeperId}): Usage ${p.usage}, logs ${p.logSum}, diff ${p.diff > 0 ? "+" : ""}${p.diff} [${p.causes.join(", ")}]` +
        (first ? ` first differing game Week ${first.week} ${first.gameId ?? ""}` : ""),
    );
  }
  const who = opt("--player");
  if (who) {
    const w = norm(who);
    for (const p of pairs.filter((x) => norm(x.name) === w || norm(x.name).includes(w))) {
      console.log(`\n  ${p.club.toUpperCase()} ${p.name}: Usage ${p.usage} vs logs ${p.logSum} over Weeks ${p.window.join(",")}`);
      console.log("  week  game_id            pbp(catch+lat)  pbp(catch only)  log  diff");
      for (const g of p.games) {
        const d = g.pbp != null && g.log != null ? g.pbp - g.log : "";
        console.log(
          `  ${String(g.week).padStart(4)}  ${String(g.gameId ?? "").padEnd(18)} ${String(g.pbp ?? "-").padStart(14)}  ${String(g.pbpNoLateral ?? "-").padStart(15)}  ${String(g.log ?? "-").padStart(3)}  ${d}`,
        );
        for (const x of g.plays) console.log(`        play ${x.play}: ${x.desc}`);
      }
    }
  }
  const json = opt("--json");
  if (json) fs.writeFileSync(json, `${JSON.stringify({ season, sha, usageBuiltAt: usage.builtAt, throughWeek: usage.throughWeek, logsMeta, pairs }, null, 1)}\n`);
  const bad = mism.filter((p) => p.causes.some((c) => c === "unexplained" || c === "unclassified"));
  process.exit(bad.length ? 1 : 0);
}
