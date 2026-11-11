/**
 * Season-wide figures for a recap, summed from the stored box scores
 * (data/matchup/boxscores/<season>.json): every club's season to date, the
 * fantasy points each defense allowed by position, each club's record against
 * the closing lines, the other games of the same week, and the rule-based
 * "similar games".
 *
 * Nothing here is stored: each figure is added up from the games' own lines,
 * so a corrected box score corrects every page that reads it. A season that
 * is not stored returns nothing, and the sections that read it hide.
 *
 * Team codes are the site's display codes, upper case ("LAR", "WAS").
 */

import { fantasyPoints, type ScoringFormat } from "./fantasy-points";
import { storedSeason, type GameBoxscore, type GameOdds, type StoredGame } from "./boxscore";
import { playPoints } from "./scoring-plays";

/* ------------------------------------------------------------------ atoms */

/** A stored game's two sides, by display code, with the final. */
export interface SeasonGame {
  eventId: string;
  season: number;
  seasonType: "regular" | "post";
  week: number;
  date: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  odds: GameOdds | null;
  /** Total yards by display code; missing when ESPN sent none. */
  yards: Record<string, number | null>;
  plays: Record<string, number | null>;
  /** The largest deficit each side overcame, by display code: 0 when it never trailed. */
  deficit: Record<string, number>;
}

function code(box: GameBoxscore, i: number): string {
  const line = box.lines[i]!;
  return line.team?.code.toUpperCase() ?? line.abbr;
}

/** The deepest hole each side was in, from the running score after every scoring play. */
function deficits(box: GameBoxscore, away: string, home: string): Record<string, number> {
  const out: Record<string, number> = { [away]: 0, [home]: 0 };
  let a = 0;
  let h = 0;
  for (const play of box.scoringPlays) {
    const points = playPoints(play);
    if (play.team === away) a += points;
    else if (play.team === home) h += points;
    else continue;
    out[away] = Math.max(out[away]!, h - a);
    out[home] = Math.max(out[home]!, a - h);
  }
  return out;
}

function toGame(season: number, g: StoredGame): SeasonGame | null {
  const box = g.box;
  if (box.lines.length !== 2) return null;
  const away = code(box, 0);
  const home = code(box, 1);
  const stat = (i: number) => box.stats[box.lines[i]!.abbr] ?? null;
  return {
    eventId: g.eventId,
    season,
    seasonType: g.seasonType,
    week: g.week,
    date: g.date,
    away,
    home,
    awayScore: box.lines[0]!.total,
    homeScore: box.lines[1]!.total,
    odds: box.odds,
    yards: { [away]: stat(0)?.totalYards ?? null, [home]: stat(1)?.totalYards ?? null },
    plays: { [away]: stat(0)?.plays ?? null, [home]: stat(1)?.plays ?? null },
    deficit: deficits(box, away, home),
  };
}

const gamesCache = new WeakMap<StoredGame[], SeasonGame[]>();

/** Every stored game of the season, as final scores. */
export function seasonGames(season: number): SeasonGame[] {
  const stored = storedSeason(season);
  const hit = gamesCache.get(stored);
  if (hit) return hit;
  const games = stored.map((g) => toGame(season, g)).filter((g): g is SeasonGame => g !== null);
  gamesCache.set(stored, games);
  return games;
}

/** Whether a game sits at or before (seasonType, week). */
export function upTo(g: { seasonType: string; week: number }, seasonType: string, week: number): boolean {
  if (g.seasonType === seasonType) return g.week <= week;
  return g.seasonType === "regular";
}

/* ----------------------------------------------------------- season to date */

export interface TeamSeason {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  yardsFor: number;
  yardsAgainst: number;
  playsFor: number;
}

export interface SeasonToDate {
  /** The last regular-season week counted. */
  throughWeek: number;
  teams: Record<string, TeamSeason>;
}

/**
 * Each of the two clubs' regular season, through the latest stored week - the
 * season as it stands, not as it stood before this game. Null when neither
 * club has a stored game.
 */
export function seasonToDate(season: number, clubs: string[]): SeasonToDate | null {
  const regular = seasonGames(season).filter((g) => g.seasonType === "regular");
  if (regular.length === 0) return null;
  const teams: Record<string, TeamSeason> = {};
  let through = 0;
  for (const club of clubs) {
    const t: TeamSeason = {
      games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, yardsFor: 0, yardsAgainst: 0, playsFor: 0,
    };
    for (const g of regular) {
      const side = g.away === club ? "away" : g.home === club ? "home" : null;
      if (!side) continue;
      const other = side === "away" ? g.home : g.away;
      const mine = side === "away" ? g.awayScore : g.homeScore;
      const theirs = side === "away" ? g.homeScore : g.awayScore;
      t.games += 1;
      if (mine > theirs) t.wins += 1;
      else if (mine < theirs) t.losses += 1;
      else t.ties += 1;
      t.pointsFor += mine;
      t.pointsAgainst += theirs;
      t.yardsFor += g.yards[club] ?? 0;
      t.yardsAgainst += g.yards[other] ?? 0;
      t.playsFor += g.plays[club] ?? 0;
      through = Math.max(through, g.week);
    }
    if (t.games) teams[club] = t;
  }
  return Object.keys(teams).length ? { throughWeek: through, teams } : null;
}

/* ------------------------------------------------ fantasy points allowed */

export const ALLOWED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

export interface PointsAllowed {
  throughWeek: number;
  /** Per defense, per position, per format: points per game. */
  teams: Record<string, { games: number; perGame: Record<AllowedPosition, Record<"ppr" | "half" | "std", number>> }>;
}

const FORMAT_KEYS: Array<["ppr" | "half" | "std", ScoringFormat]> = [
  ["ppr", "ppr"],
  ["half", "half"],
  ["std", "standard"],
];

/**
 * The fantasy points each of the clubs' defenses gave up per game to
 * opposing QBs, RBs, WRs and TEs, over the regular season's stored games.
 * Scored with the page's own engine. ESPN's stored lines carry no position, so
 * `positionOf` supplies it from the player dictionary; a name it cannot place
 * is left out rather than guessed.
 */
export function pointsAllowed(
  season: number,
  clubs: string[],
  positionOf: (name: string) => string | null = () => null,
): PointsAllowed | null {
  const stored = storedSeason(season).filter((g) => g.seasonType === "regular");
  if (stored.length === 0) return null;
  const teams: PointsAllowed["teams"] = {};
  let through = 0;
  for (const club of clubs) {
    const sums: Record<AllowedPosition, Record<"ppr" | "half" | "std", number>> = {
      QB: { ppr: 0, half: 0, std: 0 },
      RB: { ppr: 0, half: 0, std: 0 },
      WR: { ppr: 0, half: 0, std: 0 },
      TE: { ppr: 0, half: 0, std: 0 },
    };
    let games = 0;
    for (const g of stored) {
      const box = g.box;
      if (box.lines.length !== 2) continue;
      const codes = [code(box, 0), code(box, 1)];
      if (!codes.includes(club)) continue;
      const opponent = codes[0] === club ? codes[1]! : codes[0]!;
      if (box.players.length === 0) continue;
      games += 1;
      through = Math.max(through, g.week);
      for (const p of box.players) {
        if (p.team !== opponent) continue;
        const raw = p.pos ?? positionOf(p.name);
        const pos = (raw === "FB" ? "RB" : raw) as AllowedPosition | null;
        if (!pos || !(ALLOWED_POSITIONS as readonly string[]).includes(pos)) continue;
        for (const [key, format] of FORMAT_KEYS) sums[pos][key] += fantasyPoints(p.stats, format);
      }
    }
    if (!games) continue;
    const perGame = Object.fromEntries(
      ALLOWED_POSITIONS.map((pos) => [
        pos,
        Object.fromEntries(FORMAT_KEYS.map(([key]) => [key, Math.round((sums[pos][key] / games) * 10) / 10])),
      ]),
    ) as PointsAllowed["teams"][string]["perGame"];
    teams[club] = { games, perGame };
  }
  return Object.keys(teams).length ? { throughWeek: through, teams } : null;
}

/* --------------------------------------------------------------- betting */

export type Cover = "cover" | "push" | "fail";

/** How one side did against the closing spread, or null without one. */
export function againstSpread(g: SeasonGame, club: string): Cover | null {
  const o = g.odds;
  if (!o) return null;
  const side = g.away === club ? "away" : g.home === club ? "home" : null;
  if (!side) return null;
  const margin = side === "away" ? g.awayScore - g.homeScore : g.homeScore - g.awayScore;
  // The club's own line: minus the spread when it was favored, plus when not.
  const line = o.favorite === null ? 0 : o.favorite === club ? -o.line : o.line;
  const result = margin + line;
  return result > 0 ? "cover" : result < 0 ? "fail" : "push";
}

/** Over, under or push against the closing total, or null without one. */
export function againstTotal(g: SeasonGame): "over" | "under" | "push" | null {
  const total = g.odds?.total ?? null;
  if (total === null) return null;
  const points = g.awayScore + g.homeScore;
  return points > total ? "over" : points < total ? "under" : "push";
}

/** The pair's stored meetings, newest first, up to and including the recapped one. */
export function storedMeetings(
  seasons: number[],
  a: string,
  b: string,
  until: { season: number; seasonType: "regular" | "post"; week: number },
): SeasonGame[] {
  const out: SeasonGame[] = [];
  for (const season of seasons) {
    if (season > until.season) continue;
    for (const g of seasonGames(season)) {
      const pair = (g.away === a && g.home === b) || (g.away === b && g.home === a);
      if (!pair) continue;
      if (season === until.season && !upTo(g, until.seasonType, until.week)) continue;
      out.push(g);
    }
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

/** The seasons the store holds, oldest first. */
export function storedSeasons(from = 2000, to = new Date().getUTCFullYear() + 1): number[] {
  const out: number[] = [];
  for (let s = from; s <= to; s++) if (storedSeason(s).length) out.push(s);
  return out;
}

/* -------------------------------------------------------- nearby games */

