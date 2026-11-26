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
 * The week a player's current-season numbers are complete through, for copy
 * that says "through Week N".
 *
 * `leagueWeek` is the highest week anyone has logged, so from Thursday night
 * it already names the week in progress: after the Week 11 opener every
 * player read "through Week 11" while his own club had not played it yet. His
 * numbers are complete through the week before his club's next game, and
 * never past the league's logged week. Without a next game (season over,
 * no schedule) the league week stands, as before. An injured player still
 * reads his club's week, not his last appearance.
 */
export function statsThroughWeek(data: PlayerPageData): number {
  const league = data.leagueWeek ?? 0;
  const next = (data.upcoming ?? [])[0];
  if (!next || !Number.isFinite(next.week)) return league;
  return Math.max(0, Math.min(league, next.week - 1));
}

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
  return publishedRank(data)?.rank ?? null;
}

/**
 * The published positional rank AND the sort key it was taken from (audit
 * WEB-030, 2026-11-26: Nate Carter, two games, read "RB133 by points per
 * game" in the Overview and "RB133 in PPR total points" in the FAQ - one
 * number, the total-points rank, under two labels). Every component that
 * prints the rank names it from `basis`, never from what it assumes:
 *   - "ppg":   ranks.ts ppgPositionTable (four games played, ties share the
 *              better rank), or a season snapshot's posFinishPpg;
 *   - "total": his rank by total points, until the rate rank exists.
 */
export interface PublishedRank {
  rank: number;
  basis: "ppg" | "total";
}

export function publishedRank(data: PlayerPageData): PublishedRank | null {
  const row = data.production?.find((r) => r.season === data.season);
  const ppg = row?.posFinishPpg ?? data.seasonRank ?? null;
  if (ppg != null) return { rank: ppg, basis: "ppg" };
  const total = row?.posFinishTotal ?? data.seasonRankTotal ?? null;
  return total != null ? { rank: total, basis: "total" } : null;
}

/** "in PPR points per game" / "in total PPR points": the words a rank's basis earns. */
export function rankBasisWords(basis: PublishedRank["basis"], scoring: string): string {
  const s = scoring ? `${scoring} ` : "";
  return basis === "ppg" ? `in ${s}points per game` : `in total ${s}points`;
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

/**
 * Whether matchup advice is off for this player (mak, 2026-11-26): he is on a
 * reserve list (IR, PUP, NFI) or suspended, by the shared availability record
 * (currentStatus, or the designation it feeds). While it holds, no
 * current-week matchup risk, schedule upside, schedule or playoff verdict is
 * printed anywhere on the Outlook or in the FAQs - the card, the visible FAQ
 * and the FAQ schema all read this one predicate (Pacheco on IR read "Tough
 * matchups: the Bears in Week 12..."). The schedule itself, as facts, stays.
 */
export function matchupAdviceOff(data: PlayerPageData): boolean {
  if (data.currentStatus?.kind === "reserve") return true;
  return /^(ir|pup|nfi|injured reserve|sus)/i.test((data.designation?.injuryStatus ?? "").trim());
}
