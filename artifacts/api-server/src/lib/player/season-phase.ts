/**
 * Where the league is, and the handful of live readings the answer-first copy
 * is built from (mak's title/description refresh, 2026-10-09).
 *
 * The hub's description, its answer sentence, the Outlook's title and the Game
 * Log's description all open on the same facts - the positional rank, the
 * points per game, the next game, the last game - and each used to read them
 * off the data in its own way. One place, so the <title>, the description and
 * the sentence on the page cannot disagree about which rank he is.
 *
 * Off player-render's import graph (like header.ts), so the SEO module and the
 * tests can use it without the DB.
 */

import type { PlayerPageData } from "./player-data";
import type { UpcomingGame } from "./upcoming";
import type { GameLogEntry } from "./types";
import { getEntryPoints } from "./scoring";

/**
 * In season: the league has logged at least one week and the club still has
 * a game to play. Before Week 1 the draft-day wording still applies; after the
 * last game there is no rest of the season to be worth anything in.
 */
export function inSeason(data: PlayerPageData): boolean {
  return (data.leagueWeek ?? 0) >= 1 && (data.upcoming?.length ?? 0) > 0;
}

/**
 * The positional rank the header prints: by points per game where that rank
 * exists (four games in), by points scored until it does. The same rule as
 * headerBoard() in header.ts and currentRank() in outlook-tab.ts.
 */
export function currentRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

/** Points per game over the season on the page, or null before he has played. */
export function seasonPpg(data: PlayerPageData): number | null {
  const stats = data.stats;
  if (!stats || stats.gamesPlayed <= 0) return null;
  return stats.ppg;
}

/** The club's next fixture, when the schedule has one. */
export function nextGame(data: PlayerPageData): UpcomingGame | null {
  return (data.upcoming ?? [])[0] ?? null;
}

/** The most recent game he played in the season on the page. */
export function lastGame(data: PlayerPageData): GameLogEntry | null {
  const played = (data.gameLog ?? []).filter((e) => e.game_status === "active");
  return played.length ? played[played.length - 1]! : null;
}

/** His points in one game, in the page's scoring format. */
export function gamePoints(data: PlayerPageData, entry: GameLogEntry): number {
  return getEntryPoints(entry.stats, data.format);
}

/** "vs TB" at home, "at TB" away. The log writes an away game as "@TB". */
export function oppPhrase(opp: string): string {
  return opp.startsWith("@") ? `at ${opp.slice(1)}` : `vs ${opp}`;
}

/** One decimal, the way the scoreboard prints points. */
export function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}
