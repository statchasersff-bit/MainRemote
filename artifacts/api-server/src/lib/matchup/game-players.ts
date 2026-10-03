/**
 * Everyone who recorded a stat in one game, keyed by id, with the line the
 * leaders strip, the recap links and the scoring summary all read.
 *
 * Two sources, one shape. ESPN's box score is the first: it covers every game,
 * the postseason included, and it has the defense. The Sleeper logs are the
 * fallback for a regular-season game whose box score has no player block -
 * offense only, so a page built from them has no defensive card.
 *
 * Two-point conversions are in neither source's player line; they are counted
 * here from the scoring plays, which name the passer and the scorer.
 *
 * Pure apart from the player-dictionary lookup for a position ESPN leaves out.
 */

import { searchKey } from "../render";
import type { Appearance } from "./appearances";
import { num } from "./appearances";
import type { FantasyStatLine } from "./fantasy-points";
import type { ScoringPlay } from "./scoring-plays";

export interface PlayerGameStats extends FantasyStatLine {
  passCmp?: number;
  passAtt?: number;
  rushAtt?: number;
  recTgt?: number;
  soloTkl?: number;
  astTkl?: number;
  sacks?: number;
  defInt?: number;
  defTd?: number;
  passDef?: number;
  fgm?: number;
  fga?: number;
  xpm?: number;
  xpa?: number;
  fgLong?: number;
  tfl?: number;
  qbHits?: number;
  fumRec?: number;
}

export interface GamePlayer {
  name: string;
  /** Display code of the side he played for, upper case. */
  team: string;
  /** "QB", "CB"; null when no source says. */
  pos: string | null;
  stats: PlayerGameStats;
}

export type GamePlayers = Record<string, GamePlayer>;

/** A line from ESPN's box score, before two-point conversions are added. */
export interface BoxPlayer {
  espnId: string;
  name: string;
  team: string;
  pos: string | null;
  stats: PlayerGameStats;
}

export function isKicker(player: GamePlayer): boolean {
  if (player.pos === "K" || player.pos === "PK" || player.pos === "P") return true;
  const s = player.stats;
  const kicked = (s.fga ?? 0) > 0 || (s.xpm ?? 0) > 0 || (s.fgm ?? 0) > 0;
  const other =
    (s.passAtt ?? 0) + (s.rushAtt ?? 0) + (s.rec ?? 0) + (s.recTgt ?? 0) +
    (s.soloTkl ?? 0) + (s.astTkl ?? 0);
  return player.pos === null && kicked && other === 0;
}

/** The same player under two spellings: "Odell Beckham Jr." and "Odell Beckham". */
export function nameKey(name: string): string {
  return searchKey(name).replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
}

/** Adds each good two-point try to the passer's and the scorer's lines. */
function addTwoPointTries(players: GamePlayers, plays: ScoringPlay[]): void {
  const find = (name: string | undefined, team: string): GamePlayer | null => {
    if (!name) return null;
    const key = nameKey(name);
    return (
      Object.values(players).find((p) => p.team === team && nameKey(p.name) === key) ?? null
    );
  };
  for (const play of plays) {
    const pat = play.pat;
    if (!pat || pat.result !== "good" || pat.type === "kick") continue;
    const scorer = find(pat.player, play.team);
    if (scorer) scorer.stats.twoPtScored = (scorer.stats.twoPtScored ?? 0) + 1;
    const passer = pat.type === "two_point_pass" ? find(pat.passer, play.team) : null;
    if (passer) passer.stats.twoPtPassed = (passer.stats.twoPtPassed ?? 0) + 1;
  }
}

/** A defensive or return touchdown ESPN's defensive line did not count. */
function addDefensiveTouchdowns(players: GamePlayers, plays: ScoringPlay[]): void {
  const counted = new Map<string, number>();
  for (const play of plays) {
    if (play.type !== "int_return_td" && play.type !== "fumble_return_td") continue;
    if (!play.scorer) continue;
    const key = `${play.team}:${nameKey(play.scorer)}`;
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  for (const player of Object.values(players)) {
    const n = counted.get(`${player.team}:${nameKey(player.name)}`) ?? 0;
    if (n > (player.stats.defTd ?? 0)) player.stats.defTd = n;
  }
}

function clone(stats: PlayerGameStats): PlayerGameStats {
  return { ...stats };
}

/**
 * The game's players. `box` wins when it has anyone in it; `logs` is read only
 * when it does not. Returns an empty map when neither has a line.
 *
 * `positionOf` fills a position ESPN's box score leaves out, from the player
 * dictionary; a name it cannot place keeps a null position.
 */
export function buildGamePlayers(
  box: BoxPlayer[] | null,
  logs: Appearance[] | null,
  plays: ScoringPlay[],
  positionOf: (name: string) => string | null = () => null,
): GamePlayers {
  const players: GamePlayers = {};
  if (box && box.length) {
    for (const p of box) {
      players[`espn:${p.espnId}`] = {
        name: p.name,
        team: p.team,
        pos: p.pos ?? positionOf(p.name),
        stats: clone(p.stats),
      };
    }
  } else if (logs) {
    for (const entry of logs) {
      const s = entry.stats;
      const team = entry.team?.code.toUpperCase();
      if (!team) continue;
      players[`sleeper:${entry.player.id}`] = {
        name: entry.player.name,
        team,
        pos: entry.player.position ?? null,
        stats: {
          passCmp: num(s, "pass_cmp"),
          passAtt: num(s, "pass_att"),
          passYds: num(s, "pass_yd"),
          passTd: num(s, "pass_td"),
          passInt: num(s, "pass_int"),
          rushAtt: num(s, "rush_att"),
          rushYds: num(s, "rush_yd"),
          rushTd: num(s, "rush_td"),
          rec: num(s, "rec"),
          recTgt: num(s, "rec_tgt"),
          recYds: num(s, "rec_yd"),
          recTd: num(s, "rec_td"),
          fgm: num(s, "fgm"),
          fga: num(s, "fga"),
          xpm: num(s, "xpm"),
        },
      };
    }
  }
  addTwoPointTries(players, plays);
  addDefensiveTouchdowns(players, plays);
  return players;
}
