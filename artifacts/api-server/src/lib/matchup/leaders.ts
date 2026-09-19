/**
 * Who led one game, in four names.
 *
 * This exists for the postgame state of a matchup page. "Patriots vs Seahawks
 * player stats" is a different search from "Patriots vs Seahawks", and the page
 * answered only the second: it could say 10–13 and not one thing about who did
 * it. Four names close that; the tables under them close the rest.
 *
 * The four categories here are the summary. They are deliberately the SAME
 * numbers the Player Stats tables print in full below — this block is a way in,
 * not a second source, and a leader whose yardage disagreed with the table two
 * sections down would be a bug a reader could see.
 */

import { num, type Appearance, type Stats } from "./appearances";
import type { NflTeam } from "../team/teams";
import type { Player } from "../player/types";

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

/** One line of counting stats, skipping the zeros. "23/34, 2 TD, 1 INT". */
function parts(pieces: Array<[number, string, string?]>): string {
  return pieces
    .filter(([n]) => n > 0)
    .map(([n, singular, plural]) =>
      n === 1 || !plural ? `${n} ${singular}` : `${n} ${plural}`,
    )
    .join(", ");
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
 * Null rather than an empty shape when nobody logged a line: the caller renders
 * nothing at all in that case, and a block of four dashes is worse than no
 * block. The appearances are passed in rather than read here, because every
 * other postgame block on the page is built from the same list — see
 * game-stats.ts, which makes it once.
 */
export function gameLeaders(list: Appearance[]): GameLeaders | null {
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
        // Left for the caller to fill with the week's positional finish, which
        // needs the whole league and so is not knowable from this game alone.
        // It used to carry the position, which the tag above the name now
        // spells out in that position's own colour — the card was printing
        // "WR" twice.
        line: "",
      }),
    ),
  };

  const any =
    leaders.passing || leaders.rushing || leaders.receiving || leaders.fantasy;
  return any ? leaders : null;
}
