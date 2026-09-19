/**
 * Who led one game, from the per-week logs the player pages already read.
 *
 * This exists for the postgame state of a matchup page. "Patriots vs Seahawks
 * player stats" is a different search from "Patriots vs Seahawks", and the page
 * answered only the second: it could say 10–13 and not one thing about who did
 * it. Four names close that.
 *
 * Nothing here is fetched or derived twice — `loadGameLogs(season)` is the same
 * memoised read the game log on a player page uses, and the dictionary lookup
 * is the one links.ts already keeps warm. A leaders block costs one pass over a
 * season of logs, filtered to a single week.
 */

import { loadGameLogs, loadPlayers } from "../player/data";
import { getTeamByAbbreviation } from "../team/teams";
import type { NflTeam } from "../team/teams";
import type { GameLogEntry, Player } from "../player/types";
import type { Meeting } from "./matchup-data";

export interface GameLeader {
  player: Player;
  /** The team he played for in THAT game, which is not always his team now. */
  team: NflTeam | null;
  /** The headline number, already formatted: "245", "1.5". */
  value: string;
  /** What the number is: "passing yards". */
  unit: string;
  /** The supporting line: "23/34, 2 TD". Empty when there is nothing to add. */
  line: string;
}

export interface GameLeaders {
  passing: GameLeader | null;
  rushing: GameLeader | null;
  receiving: GameLeader | null;
  fantasy: GameLeader | null;
}

type Stats = GameLogEntry["stats"];

// Keyed rather than indexed: GameLogStats names its fields, and a typo here
// would otherwise read as a silent zero on every row.
const num = (stats: Stats, key: keyof Stats): number => {
  const raw = stats[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/** One line of counting stats, skipping the zeros. "23/34, 2 TD, 1 INT". */
function parts(pieces: Array<[number, string, string?]>): string {
  return pieces
    .filter(([n]) => n > 0)
    .map(([n, singular, plural]) =>
      n === 1 || !plural ? `${n} ${singular}` : `${n} ${plural}`,
    )
    .join(", ");
}

let byId: Map<string, Player> | null = null;

function playerById(id: string): Player | null {
  if (!byId) byId = new Map(loadPlayers().map((p) => [p.id, p]));
  return byId.get(id) ?? null;
}

interface Appearance {
  player: Player;
  team: NflTeam | null;
  stats: Stats;
}

/**
 * Everyone who logged a line in this game.
 *
 * Matched on the log's own `team`/`opp` codes rather than on a player's current
 * team: a player traded since is in the log under the team he played for, and
 * filtering by where he is now would drop him from a game he played in.
 */
function appearances(meeting: Meeting): Appearance[] {
  const codes = new Set(
    [meeting.home, meeting.away].map((team) => team.code.toUpperCase()),
  );
  if (codes.size !== 2) return [];

  const logs = loadGameLogs(meeting.season);
  const found: Appearance[] = [];

  for (const [id, entries] of Object.entries(logs)) {
    for (const entry of entries) {
      if (entry.week !== meeting.week) continue;
      const team = (entry.team ?? "").toUpperCase();
      const opp = (entry.opp ?? "").toUpperCase();
      // Both sides have to match, not just one: a team plays a different
      // opponent every week, and week alone would pull in the whole league.
      if (!codes.has(team) || !codes.has(opp) || team === opp) continue;
      const player = playerById(id);
      if (!player) continue;
      found.push({
        player,
        team: getTeamByAbbreviation(team),
        stats: entry.stats ?? {},
      });
      break;
    }
  }
  return found;
}

/**
 * The best of a category, or null when nobody did it.
 *
 * `gate` keeps a category honest: a game with no completed pass should show no
 * passing leader rather than the least-bad zero. Ties go to whoever the logs
 * list first, which is arbitrary but stable — the alternative is showing two
 * leaders in a slot built for one.
 */
function best(
  list: Appearance[],
  rank: (s: Stats) => number,
  build: (a: Appearance) => Omit<GameLeader, "player" | "team">,
): GameLeader | null {
  let top: Appearance | null = null;
  let topValue = 0;
  for (const entry of list) {
    const value = rank(entry.stats);
    if (value > topValue) {
      top = entry;
      topValue = value;
    }
  }
  if (!top || topValue <= 0) return null;
  return { player: top.player, team: top.team, ...build(top) };
}

/**
 * The four leaders of a completed game, or null.
 *
 * Null rather than an empty shape for a game that is not final, has no logs, or
 * predates them: the caller renders nothing at all in that case, and a block of
 * four dashes is worse than no block.
 */
export function gameLeaders(meeting: Meeting | null): GameLeaders | null {
  if (!meeting || meeting.status !== "final") return null;

  let list: Appearance[];
  try {
    list = appearances(meeting);
  } catch {
    // A season with no log file is the normal case for an old meeting, and a
    // leaders block is the least important thing on this page — it declines to
    // render rather than taking the page down with it.
    return null;
  }
  if (list.length === 0) return null;

  const leaders: GameLeaders = {
    passing: best(
      list,
      (s) => num(s, "pass_yd"),
      (a) => ({
        value: String(num(a.stats, "pass_yd")),
        unit: "passing yards",
        line: [
          num(a.stats, "pass_att") > 0
            ? `${num(a.stats, "pass_cmp")}/${num(a.stats, "pass_att")}`
            : "",
          parts([
            [num(a.stats, "pass_td"), "TD"],
            [num(a.stats, "pass_int"), "INT"],
          ]),
        ]
          .filter(Boolean)
          .join(", "),
      }),
    ),
    rushing: best(
      list,
      (s) => num(s, "rush_yd"),
      (a) => ({
        value: String(num(a.stats, "rush_yd")),
        unit: "rushing yards",
        line: parts([
          [num(a.stats, "rush_att"), "carry", "carries"],
          [num(a.stats, "rush_td"), "TD"],
        ]),
      }),
    ),
    receiving: best(
      list,
      (s) => num(s, "rec_yd"),
      (a) => ({
        value: String(num(a.stats, "rec_yd")),
        unit: "receiving yards",
        line: parts([
          [num(a.stats, "rec"), "catch", "catches"],
          [num(a.stats, "rec_tgt"), "target", "targets"],
          [num(a.stats, "rec_td"), "TD"],
        ]),
      }),
    ),
    fantasy: best(
      list,
      (s) => num(s, "pts_ppr"),
      (a) => ({
        // One decimal, and only when there is one: "18.4", but "18" not "18.0".
        value: String(Math.round(num(a.stats, "pts_ppr") * 10) / 10),
        unit: "PPR points",
        line: a.player.position ?? "",
      }),
    ),
  };

  const any =
    leaders.passing || leaders.rushing || leaders.receiving || leaders.fantasy;
  return any ? leaders : null;
}
