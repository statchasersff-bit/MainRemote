/**
 * What the fantasy section needs beyond the box score, read from the season's
 * game logs: each player's snaps in this game, the five games before it, the
 * season-to-date shares a role change is judged against, and the league's
 * per-opportunity rates that expected points are built from.
 *
 * The box score is ESPN's and the logs are Sleeper's, so a player is matched
 * across the two by name and team — the same key game-players.ts uses — and a
 * name two players on one side share is left unmatched rather than guessed.
 * A playoff game has no log of its own: its snaps are unknown (the page says
 * so) and "the five games before it" are the last five of the regular season.
 */

import { loadGameLogs, loadPlayers } from "../player/data";
import type { GameLogEntry, Player } from "../player/types";
import { nameKey, type GamePlayer } from "./game-players";
import type { XfpRates } from "./fantasy-section";

export interface LoggedGame {
  /** "W14". */
  label: string;
  week: number;
  ppr: number;
  passInt: number;
  targets: number;
  carries: number;
  touchdowns: number;
  snapShare: number | null;
  targetShare: number | null;
}

export interface PlayerContext {
  sleeperId: string;
  /** Whether the player is on an active roster today, for the Start/Sit links. */
  active: boolean;
  /** Offensive snaps in this game, and the team's, from this week's log. Null for a playoff game. */
  snaps: number | null;
  teamSnaps: number | null;
  /** Every earlier game this season, oldest first. */
  before: LoggedGame[];
}

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function logged(entry: GameLogEntry): LoggedGame {
  const s = entry.stats ?? ({} as GameLogEntry["stats"]);
  const teamSnaps = n(s.tm_off_snp);
  const teamTargets = n(s.team_tgt);
  return {
    label: `W${entry.week}`,
    week: entry.week,
    ppr: Math.round(n(s.pts_ppr) * 10) / 10,
    passInt: n(s.pass_int),
    targets: n(s.rec_tgt),
    carries: n(s.rush_att),
    touchdowns: n(s.rush_td) + n(s.rec_td),
    snapShare: teamSnaps > 0 ? n(s.off_snp) / teamSnaps : null,
    targetShare: teamTargets > 0 ? n(s.rec_tgt) / teamTargets : null,
  };
}

let playersById: Map<string, Player> | null = null;

function dictionary(): Map<string, Player> {
  if (!playersById) playersById = new Map(loadPlayers().map((p) => [p.id, p]));
  return playersById;
}

/**
 * Each box-score player's context, keyed by the box-score id. `week` is the
 * game's week in its own half of the season; a postseason game reads every
 * regular-season week as "before".
 */
export function playerContexts(
  players: Record<string, GamePlayer>,
  season: number,
  week: number,
  postseason: boolean,
): Record<string, PlayerContext> {
  let logs: Record<string, GameLogEntry[]>;
  try {
    logs = loadGameLogs(season);
  } catch {
    return {};
  }
  const ids = dictionary();

  // name+team → sleeper id, from anyone who logged a game for that team this season.
  const index = new Map<string, string | null>();
  for (const [id, entries] of Object.entries(logs)) {
    const player = ids.get(id);
    if (!player) continue;
    const key = nameKey(player.name);
    for (const team of new Set(entries.map((e) => (e.team ?? "").toUpperCase()).filter(Boolean))) {
      const k = `${team}:${key}`;
      index.set(k, index.has(k) && index.get(k) !== id ? null : id);
    }
  }

  const out: Record<string, PlayerContext> = {};
  for (const [boxId, p] of Object.entries(players)) {
    const sleeperId = index.get(`${p.team}:${nameKey(p.name)}`);
    if (!sleeperId) continue;
    const entries = [...(logs[sleeperId] ?? [])].sort((a, b) => a.week - b.week);
    const current = postseason ? null : entries.find((e) => e.week === week) ?? null;
    const before = entries
      .filter((e) => (postseason ? true : e.week < week))
      .filter((e) => e.game_status !== "bye" && (n(e.stats?.off_snp) > 0 || n(e.stats?.pts_ppr) !== 0));
    out[boxId] = {
      sleeperId,
      active: (ids.get(sleeperId)?.status ?? "").toLowerCase() === "active",
      snaps: current ? n(current.stats?.off_snp) || null : null,
      teamSnaps: current ? n(current.stats?.tm_off_snp) || null : null,
      before: before.map(logged),
    };
  }
  return out;
}

/* ------------------------------------------------------------ league rates */

const ratesCache = new Map<number, XfpRates | null>();

/**
 * The league's per-opportunity fantasy value in one season, from every logged
 * line in it: what a target, a carry and a pass attempt were worth on average.
 * Null when the season is too thin to say (under 2,000 targets logged).
 */
export function leagueRates(season: number): XfpRates | null {
  if (ratesCache.has(season)) return ratesCache.get(season)!;
  let logs: Record<string, GameLogEntry[]>;
  try {
    logs = loadGameLogs(season);
  } catch {
    ratesCache.set(season, null);
    return null;
  }
  const t = { tgt: 0, rec: 0, recYd: 0, recTd: 0, car: 0, rushYd: 0, rushTd: 0, att: 0, passYd: 0, passTd: 0, int: 0 };
  for (const entries of Object.values(logs)) {
    for (const e of entries) {
      const s = e.stats ?? ({} as GameLogEntry["stats"]);
      t.tgt += n(s.rec_tgt);
      t.rec += n(s.rec);
      t.recYd += n(s.rec_yd);
      t.recTd += n(s.rec_td);
      t.car += n(s.rush_att);
      t.rushYd += n(s.rush_yd);
      t.rushTd += n(s.rush_td);
      t.att += n(s.pass_att);
      t.passYd += n(s.pass_yd);
      t.passTd += n(s.pass_td);
      t.int += n(s.pass_int);
    }
  }
  if (t.tgt < 2000 || t.car < 1000 || t.att < 2000) {
    ratesCache.set(season, null);
    return null;
  }
  const catchRate = t.rec / t.tgt;
  const rates: XfpRates = {
    season,
    catchRate,
    perTargetPpr: catchRate + (t.recYd / t.tgt) * 0.1 + (t.recTd / t.tgt) * 6,
    perCarry: (t.rushYd / t.car) * 0.1 + (t.rushTd / t.car) * 6,
    perPassAttempt: (t.passYd / t.att) * 0.04 + (t.passTd / t.att) * 4 - (t.int / t.att) * 2,
  };
  ratesCache.set(season, rates);
  return rates;
}

/** The game's season, or the one before when the game's own is too early to read. */
export function ratesFor(season: number): XfpRates | null {
  return leagueRates(season) ?? leagueRates(season - 1);
}
