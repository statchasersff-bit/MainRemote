/**
 * Which final games a stats build actually holds (audit WEB-032).
 *
 * The tables used to say "Weeks 1-N" for the highest week with any row, so on
 * November 16 a Week 10 with its Sunday games but not Monday night read
 * "Weeks 1-10" (Justin Herbert: 8 games, 1,591 yards there; 9 and 1,720 on his
 * page). This compares the club-weeks a build has rows for with the final
 * games in the stored schedule (data/schedule/games.csv) and says what is
 * complete, what is partial and what is missing. Completeness is never read
 * off the highest week number.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GAMES_CSV = path.resolve(here, "..", "..", "data", "schedule", "games.csv");

/** nflverse slate codes -> the codes the tables use. */
const FIX = { LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR", JAC: "JAX", WSH: "WAS" };
const code = (t) => (t ? FIX[t] ?? t : t);

/** The season's regular-season games from the stored slate, final or not. */
export function slateGames(season, file = GAMES_CSV) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const head = lines[0].split(",");
  const at = (k) => head.indexOf(k);
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith(`${season}_`)) continue;
    const c = line.split(",");
    if (c[at("game_type")] !== "REG") continue;
    const away = code(c[at("away_team")]);
    const home = code(c[at("home_team")]);
    const final = c[at("away_score")] !== "" && c[at("away_score")] !== "NA" && c[at("home_score")] !== "" && c[at("home_score")] !== "NA";
    out.push({
      gameId: c[at("game_id")],
      week: Number(c[at("week")]),
      gameday: c[at("gameday")],
      gametime: c[at("gametime")] || null,
      away,
      home,
      final,
    });
  }
  return out;
}

/**
 * @param season
 * @param present  Set of "week:TEAM" the build has rows for
 * @param options  { lastWeek?: number, games?: slateGames() }
 * @returns {{ throughWeek: number, partialWeek: number|null, gamesIncluded: number,
 *            gamesFinal: number, missing: string[], latestFinalGame: string|null,
 *            latestIncludedGame: string|null, complete: boolean }}
 */
export function coverage(season, present, options = {}) {
  const games = options.games ?? slateGames(season);
  // Both sides on one code set: the builders spell the Rams "LA", the tables "LAR".
  present = new Set([...present].map((k) => {
    const [w, t] = k.split(":");
    return `${w}:${code(t)}`;
  }));
  const lastWeek = options.lastWeek ?? 18;
  const finals = games.filter((g) => g.final && g.week <= lastWeek);
  const has = (g) => present.has(`${g.week}:${g.away}`) && present.has(`${g.week}:${g.home}`);
  const included = finals.filter(has);
  const missing = finals.filter((g) => !has(g));
  const order = (a, b) => (a.gameday + (a.gametime ?? "")).localeCompare(b.gameday + (b.gametime ?? ""));
  // A week is complete when every game in it is final AND held.
  const weeks = [...new Set(games.filter((g) => g.week <= lastWeek).map((g) => g.week))].sort((a, b) => a - b);
  let throughWeek = 0;
  for (const w of weeks) {
    const inWeek = games.filter((g) => g.week === w);
    if (inWeek.every((g) => g.final && has(g))) throughWeek = w;
    else break;
  }
  const heldWeeks = [...new Set(included.map((g) => g.week))];
  const partialWeek = heldWeeks.filter((w) => w > throughWeek).sort((a, b) => a - b)[0] ?? null;
  return {
    throughWeek,
    partialWeek,
    gamesIncluded: included.length,
    gamesFinal: finals.length,
    missing: missing.sort(order).map((g) => g.gameId),
    latestFinalGame: finals.sort(order).at(-1)?.gameId ?? null,
    latestIncludedGame: included.sort(order).at(-1)?.gameId ?? null,
    complete: missing.length === 0,
  };
}
