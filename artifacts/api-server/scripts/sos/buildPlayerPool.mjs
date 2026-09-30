/**
 * Build the Player SOS list: who gets a row on the strength-of-schedule board.
 *
 *   node scripts/sos/buildPlayerPool.mjs            # from Sleeper's current week
 *   node scripts/sos/buildPlayerPool.mjs --from 1   # every week, as preseason
 *
 * Writes `data/sos/player-pool.json`. The server maps each player onto his
 * team's schedule and the live FPA table, so this file is only the list: id,
 * name, slug, team, position and his best single-game projection.
 *
 * The rule is the standalone app's (Strength-of-Schedule-SOS,
 * scripts/src/build-sos.ts): a QB, RB, WR or TE is listed when Sleeper projects
 * him for at least 8 PPR points in any one game. Projection rather than the
 * depth chart, because a stale depth chart can still list a displaced veteran
 * as the starter while the real one is unranked.
 *
 * One change for the season in progress: the games looked at are the ones
 * still to play (Sleeper's current week through 17), not all seventeen. A
 * starter lost for the year still has his week-1 projection, and the source's
 * rule would keep him on the board all season.
 *
 * Team, name and slug come from data/player/players.json (the daily players
 * index), so a player links to the page the site actually has for him. A
 * player that file does not know, or has as a free agent, is left off.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const OUT = path.join(DATA, "sos", "player-pool.json");
const PLAYERS = path.join(DATA, "player", "players.json");

const POSITIONS = ["QB", "RB", "WR", "TE"];
const LAST_WEEK = 17;
/** Minimum projected PPR points in any single game to be listed. */
const MIN_GAME_PROJ = 8;
/** Fewer than this many players means Sleeper answered badly, not that the league shrank. */
const MIN_PLAYERS = 150;

const UA = "StatChasersSOS/1.0 (+statchasers.com)";

async function fetchJson(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const round1 = (x) => Math.round(x * 10) / 10;

async function main() {
  const state = await fetchJson("https://api.sleeper.app/v1/state/nfl");
  const season = Number(state.season);
  const regular = state.season_type === "regular";
  const fromArg = Number.parseInt(argValue("--from") ?? "", 10);
  // Preseason (and the offseason) projects the whole year; in season, what is left.
  const fromWeek = Number.isFinite(fromArg)
    ? fromArg
    : regular
      ? Math.max(1, Math.min(LAST_WEEK, Number(state.week) || 1))
      : 1;

  const weeks = [];
  for (let w = fromWeek; w <= LAST_WEEK; w += 1) weeks.push(w);
  if (weeks.length === 0) {
    console.log(`Week ${fromWeek} is past the fantasy season; keeping the existing file.`);
    return;
  }

  const posParams = POSITIONS.map((p) => `position[]=${p}`).join("&");
  const best = new Map(); // id -> { ppr, half, std }
  let answered = 0;
  for (const week of weeks) {
    const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&${posParams}`;
    let rows;
    try {
      rows = await fetchJson(url);
    } catch (err) {
      console.warn(`  week ${week} projections unavailable: ${err.message}`);
      continue;
    }
    answered += 1;
    for (const e of rows) {
      const id = e?.player_id;
      if (!id) continue;
      const s = e.stats ?? {};
      const cur = best.get(id) ?? { ppr: 0, half: 0, std: 0 };
      cur.ppr = Math.max(cur.ppr, s.pts_ppr ?? 0);
      cur.half = Math.max(cur.half, s.pts_half_ppr ?? 0);
      cur.std = Math.max(cur.std, s.pts_std ?? 0);
      best.set(id, cur);
    }
  }
  if (answered === 0) throw new Error("No projection week answered; keeping the existing file.");

  const index = new Map(
    JSON.parse(fs.readFileSync(PLAYERS, "utf8")).map((p) => [String(p.id), p]),
  );

  const players = [];
  for (const [id, proj] of best) {
    if (proj.ppr < MIN_GAME_PROJ) continue;
    const p = index.get(id);
    if (!p || !POSITIONS.includes(p.position) || !p.team || p.team === "FA") continue;
    players.push({
      id,
      name: p.name,
      slug: p.slug ?? null,
      team: p.team,
      position: p.position,
      maxProj: { ppr: round1(proj.ppr), half: round1(proj.half), std: round1(proj.std) },
    });
  }
  players.sort(
    (a, b) =>
      POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
      b.maxProj.ppr - a.maxProj.ppr ||
      a.name.localeCompare(b.name),
  );

  if (players.length < MIN_PLAYERS) {
    throw new Error(`Only ${players.length} players qualified; keeping the existing file.`);
  }

  const out = {
    season,
    fromWeek,
    throughWeek: LAST_WEEK,
    minGameProj: MIN_GAME_PROJ,
    source: "Sleeper weekly projections (max single-game PPR); team and slug from data/player/players.json",
    builtAt: new Date().toISOString(),
    players,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(out, null, 1)}\n`);
  fs.renameSync(tmp, OUT);

  const counts = POSITIONS.map((pos) => `${pos} ${players.filter((p) => p.position === pos).length}`);
  console.log(
    `Player SOS pool: ${players.length} players (${counts.join(", ")}), weeks ${fromWeek}-${LAST_WEEK}, ${answered}/${weeks.length} weeks answered → ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
