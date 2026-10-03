/**
 * Fantasy strength of schedule: every team's (and every relevant player's)
 * weekly opponents, scored by what those defenses allow to one position.
 *
 * Ported from the standalone Strength-of-Schedule-SOS app
 * (statchasersff-bit/Strength-of-Schedule-SOS, scripts/src/build-sos.ts). Its
 * model is kept; its data is not. That app computed aFPA itself from a 2025
 * snapshot and shipped the result as static JSON, so its board stayed a June
 * preseason baseline. Here the aFPA is the FPA table's own adjusted figure
 * (fpa/fpa-data.ts) - the same formula, already blended with the current
 * season by fpa/blend.ts - so SOS moves when the FPA page moves, and the two
 * can never disagree.
 *
 * What the source decided, and this keeps:
 *
 *   - **Defense rank 1 is the TOUGHEST** defense against the position (lowest
 *     aFPA), 32 the softest. That is the opposite of the FPA page, where 1 is
 *     the softest; mak chose the source's direction for this tool (2026-09-30).
 *   - Buckets by that rank: 1-5 Avoid, 6-10 Tough, 11-22 Neutral, 23-27
 *     Favorable, 28-32 Smash.
 *   - **Schedule ranks run the other way: 1 is the EASIEST schedule** (highest
 *     average opponent aFPA), dense, so every player on one team shares a rank.
 *   - Weeks 1-17 only. Week 18 is not a fantasy week. PO3 is weeks 15-17 and
 *     PO2 weeks 16-17; each is ranked across the 32 teams like a defense
 *     (1 = toughest) and bucketed from that rank.
 *   - ROS is the weeks still to play through 17. The source started it at the
 *     week after the last one with any result; here it starts at the first week
 *     with a game not yet final, so a Thursday game does not move a whole week
 *     out of "rest of season" before Sunday.
 */

import type { FpaTableData } from "../fpa/fpa-data";
import type { FantasyPosition, ScoringFormat } from "../fpa/nflverse";
import type { ScheduleSeason } from "../schedule/schedule-data";
import { getTeamByAbbreviation, TEAMS, type NflTeam } from "../team/teams";

/* --------------------------------------------------------------- the state */

export type SosTab = "team" | "player";
export type SosScoring = "ppr" | "half-ppr" | "std";

export const SOS_TABS: readonly SosTab[] = ["team", "player"];
export const SOS_POSITIONS: readonly FantasyPosition[] = ["QB", "RB", "WR", "TE"];
export const SOS_SCORINGS: readonly SosScoring[] = ["ppr", "half-ppr", "std"];

/** The source's defaults: the Team board, running backs, PPR. */
export const DEFAULT_STATE: SosState = { tab: "team", position: "RB", scoring: "ppr" };

export interface SosState {
  tab: SosTab;
  position: FantasyPosition;
  scoring: SosScoring;
}

export const SCORING_LABELS: Record<SosScoring, string> = {
  ppr: "PPR",
  "half-ppr": "Half-PPR",
  std: "Standard",
};

export const SCORING_FORMAT: Record<SosScoring, ScoringFormat> = {
  ppr: "ppr",
  "half-ppr": "half",
  std: "standard",
};

function lower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** One spelling per value - the URL's own - and anything else is the default. */
export function parseSosState(query: {
  tab?: unknown;
  pos?: unknown;
  scoring?: unknown;
}): SosState {
  const tab = lower(query.tab);
  const pos = lower(query.pos).toUpperCase();
  const scoring = lower(query.scoring);
  return {
    tab: (SOS_TABS as readonly string[]).includes(tab) ? (tab as SosTab) : DEFAULT_STATE.tab,
    position: (SOS_POSITIONS as readonly string[]).includes(pos)
      ? (pos as FantasyPosition)
      : DEFAULT_STATE.position,
    scoring: (SOS_SCORINGS as readonly string[]).includes(scoring)
      ? (scoring as SosScoring)
      : DEFAULT_STATE.scoring,
  };
}

/* ------------------------------------------------------------- the buckets */

export type Bucket = "smash" | "favorable" | "neutral" | "tough" | "avoid";

/** Ordered easiest to toughest, as the legend reads. */
export const BUCKETS: readonly Bucket[] = ["smash", "favorable", "neutral", "tough", "avoid"];

export const BUCKET_LABELS: Record<Bucket, string> = {
  smash: "Smash",
  favorable: "Favorable",
  neutral: "Neutral",
  tough: "Tough",
  avoid: "Avoid",
};

/** The defense-rank range each bucket covers (rank 1 = toughest). */
export const BUCKET_RANGES: Record<Bucket, string> = {
  smash: "ranks 28-32",
  favorable: "ranks 23-27",
  neutral: "ranks 11-22",
  tough: "ranks 6-10",
  avoid: "ranks 1-5",
};

/** Rank 1 = toughest defense (fewest adjusted points allowed). */
export function bucketFromRank(rank: number): Bucket {
  if (rank <= 5) return "avoid";
  if (rank <= 10) return "tough";
  if (rank <= 22) return "neutral";
  if (rank <= 27) return "favorable";
  return "smash";
}

/**
 * The same five, for a schedule rank (1 = EASIEST schedule), so the ROS column
 * shades like the weekly cells: easiest green, hardest red. The source's
 * bucketFromScheduleRank (src/lib/utils.ts).
 */
export function bucketFromScheduleRank(rank: number): Bucket {
  if (rank <= 5) return "smash";
  if (rank <= 10) return "favorable";
  if (rank <= 22) return "neutral";
  if (rank <= 27) return "tough";
  return "avoid";
}

/* --------------------------------------------------------------- the weeks */

export const LAST_FANTASY_WEEK = 17;
export const FANTASY_WEEKS: readonly number[] = Array.from({ length: LAST_FANTASY_WEEK }, (_, i) => i + 1);
export const PO3_WEEKS: readonly number[] = [15, 16, 17];
export const PO2_WEEKS: readonly number[] = [16, 17];

/* --------------------------------------------------------------- the shapes */

export interface SosCell {
  week: number;
  /** Null on a bye. */
  opponent: NflTeam | null;
  isHome: boolean;
  isBye: boolean;
  /** The opponent's adjusted FPA against the position; null on a bye or an unknown defense. */
  afpa: number | null;
  /** The opponent defense's rank against the position, 1 = toughest. */
  rank: number | null;
  bucket: Bucket | null;
}

/** A stretch of weeks averaged into one figure (PO2, PO3). */
export interface SosSpan {
  afpa: number;
  /** Across the 32 teams, 1 = toughest stretch. */
  rank: number;
  bucket: Bucket;
}

interface ScheduleRanks {
  /** 1 = easiest, weeks 1-17. */
  overallRank: number;
  /** 1 = easiest remaining schedule. */
  rosRank: number;
  /** 1 = easiest weeks 15-17. */
  playoffRank: number;
}

export interface SosTeamRow extends ScheduleRanks {
  team: NflTeam;
  weeks: SosCell[];
  po2: SosSpan | null;
  po3: SosSpan | null;
  /** Average opponent aFPA over the remaining weeks; null once none are left. */
  ros: { afpa: number; bucket: Bucket } | null;
  /** Average opponent aFPA over weeks 1-17 - what the Full-Season cards compare. */
  fullAfpa: number | null;
}

export interface SosPlayerRow extends ScheduleRanks {
  id: string;
  name: string;
  slug: string | null;
  team: NflTeam;
  position: FantasyPosition;
  /** Best single-game projection for this scoring, the order within a shared rank. */
  maxProj: number;
  weeks: SosCell[];
  po2: SosSpan | null;
  po3: SosSpan | null;
  fullAfpa: number | null;
}

export type CardTone = "good" | "bad";

export interface SosCard {
  id: "easiest-full" | "toughest-full" | "easiest-playoff" | "toughest-playoff";
  title: string;
  note: string;
  tone: CardTone;
  /** A team, or a player on one. */
  team: NflTeam;
  player: SosPlayerRow | null;
  afpa: number;
  /** Against the mean of every row on the board. */
  delta: number;
  /** What a click on the card does to the table. */
  sortKey: "ovr" | "playoff";
  dir: "asc" | "desc";
  rowId: string;
}

export interface SosBoard {
  season: number;
  position: FantasyPosition;
  scoring: SosScoring;
  /** First week of "rest of season"; LAST_FANTASY_WEEK + 1 once it is over. */
  rosFrom: number;
  /** From the FPA table: weeks of this season in the figures, null in preseason. */
  weekNumber: number | null;
  isPreseason: boolean;
  /** The FPA table's own sentence saying what the figures are a mix of. */
  methodology: string;
  teams: SosTeamRow[];
  players: SosPlayerRow[];
  teamCards: SosCard[];
  playerCards: SosCard[];
  /** Fingerprint of everything above - the render cache key. */
  version: string;
}

/* ------------------------------------------------------------- the helpers */

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** True dense rank, highest value first: equal values share a rank, no gaps. */
export function denseRankDesc<K>(values: Map<K, number>): Map<K, number> {
  const unique = [...new Set(values.values())].sort((a, b) => b - a);
  const rankOf = new Map(unique.map((v, i) => [v, i + 1]));
  const out = new Map<K, number>();
  for (const [k, v] of values) out.set(k, rankOf.get(v)!);
  return out;
}

/** Ordinal rank, lowest value first (rank 1 = toughest). */
function rankAsc<K>(values: Map<K, number>): Map<K, number> {
  const ordered = [...values.entries()].sort((a, b) => a[1] - b[1]);
  return new Map(ordered.map(([k], i) => [k, i + 1]));
}

/* ------------------------------------------------------------- the inputs */

interface Defense {
  afpa: number;
  rank: number;
  bucket: Bucket;
}

/** Each defense's adjusted FPA against one position, ranked 1 = toughest. */
function defenses(fpa: FpaTableData, position: FantasyPosition): Map<string, Defense> {
  const adj = new Map<string, number>();
  for (const row of fpa.rows) {
    if (!row.team) continue;
    adj.set(row.team.abbreviation, row.byPos[position].fpa);
  }
  const ranks = rankAsc(adj);
  const out = new Map<string, Defense>();
  for (const [abbr, afpa] of adj) {
    const rank = ranks.get(abbr)!;
    out.set(abbr, { afpa, rank, bucket: bucketFromRank(rank) });
  }
  return out;
}

interface Slot {
  opponent: NflTeam;
  isHome: boolean;
}

/** team abbreviation -> week -> game. A missing week is a bye. */
function slots(schedule: ScheduleSeason): Map<string, Map<number, Slot>> {
  const out = new Map<string, Map<number, Slot>>();
  const put = (team: NflTeam, week: number, slot: Slot) => {
    let weeks = out.get(team.abbreviation);
    if (!weeks) out.set(team.abbreviation, (weeks = new Map()));
    weeks.set(week, slot);
  };
  for (const game of schedule.games) {
    if (!game.home || !game.away || game.week > LAST_FANTASY_WEEK) continue;
    put(game.home, game.week, { opponent: game.away, isHome: true });
    put(game.away, game.week, { opponent: game.home, isHome: false });
  }
  return out;
}

/** The first fantasy week with a game still to finish. */
export function rosStartWeek(schedule: ScheduleSeason): number {
  for (const week of FANTASY_WEEKS) {
    if (schedule.games.some((g) => g.week === week && g.status !== "final")) return week;
  }
  return LAST_FANTASY_WEEK + 1;
}

/* ------------------------------------------------------------ player list */

/** One row of data/sos/player-pool.json (scripts/sos/buildPlayerPool.mjs). */
export interface PoolPlayer {
  id: string;
  name: string;
  slug: string | null;
  team: string;
  position: FantasyPosition;
  maxProj: { ppr: number; half: number; std: number };
}

export interface Pool {
  players: PoolPlayer[];
  builtAt: string;
}

const PROJ_KEY: Record<SosScoring, keyof PoolPlayer["maxProj"]> = {
  ppr: "ppr",
  "half-ppr": "half",
  std: "std",
};

/* -------------------------------------------------------------- the board */

function cellsFor(
  weeks: Map<number, Slot> | undefined,
  def: Map<string, Defense>,
): SosCell[] {
  return FANTASY_WEEKS.map((week) => {
    const slot = weeks?.get(week);
    if (!slot) {
      return { week, opponent: null, isHome: false, isBye: true, afpa: null, rank: null, bucket: null };
    }
    const d = def.get(slot.opponent.abbreviation);
    return {
      week,
      opponent: slot.opponent,
      isHome: slot.isHome,
      isBye: false,
      afpa: d?.afpa ?? null,
      rank: d?.rank ?? null,
      // An opponent the FPA table does not know reads as neutral, as in the source.
      bucket: d?.bucket ?? "neutral",
    };
  });
}

function averageOver(cells: SosCell[], weeks: readonly number[]): number | null {
  const set = new Set(weeks);
  return mean(
    cells
      .filter((c) => set.has(c.week) && c.afpa !== null)
      .map((c) => c.afpa as number),
  );
}

function spans(
  byTeam: Map<string, SosCell[]>,
  weeks: readonly number[],
): Map<string, SosSpan> {
  const avgs = new Map<string, number>();
  for (const [abbr, cells] of byTeam) {
    const avg = averageOver(cells, weeks);
    if (avg !== null) avgs.set(abbr, avg);
  }
  const ranks = rankAsc(avgs);
  const out = new Map<string, SosSpan>();
  for (const [abbr, afpa] of avgs) {
    const rank = ranks.get(abbr)!;
    out.set(abbr, { afpa, rank, bucket: bucketFromRank(rank) });
  }
  return out;
}

function cardsFor<R extends { fullAfpa: number | null; po3: SosSpan | null }>(
  rows: R[],
  position: FantasyPosition,
  isPlayer: boolean,
  teamOf: (row: R) => NflTeam,
  idOf: (row: R) => string,
): SosCard[] {
  const extremes = (metric: (row: R) => number | null) => {
    const scored = rows
      .map((row) => ({ row, v: metric(row) }))
      .filter((x): x is { row: R; v: number } => x.v !== null);
    if (!scored.length) return null;
    // Higher average opponent aFPA = more points allowed = easier schedule.
    const easiest = scored.reduce((a, b) => (b.v > a.v ? b : a));
    const toughest = scored.reduce((a, b) => (b.v < a.v ? b : a));
    const avg = scored.reduce((a, b) => a + b.v, 0) / scored.length;
    return { easiest, toughest, avg };
  };

  const full = extremes((r) => r.fullAfpa);
  const po = extremes((r) => r.po3?.afpa ?? null) ?? full;
  if (!full || !po) return [];

  // The source's two wordings: a team has a schedule, a player a slate.
  const noun = isPlayer ? "slate" : "schedule";
  const make = (
    id: SosCard["id"],
    title: string,
    note: string,
    pick: { row: R; v: number },
    avg: number,
    tone: CardTone,
    sortKey: SosCard["sortKey"],
    dir: SosCard["dir"],
  ): SosCard => ({
    id,
    title,
    note,
    tone,
    team: teamOf(pick.row),
    player: isPlayer ? (pick.row as unknown as SosPlayerRow) : null,
    afpa: pick.v,
    delta: pick.v - avg,
    sortKey,
    dir,
    rowId: idOf(pick.row),
  });

  return [
    make("easiest-full", "Easiest Full-Season", `Best ${position} ${noun} by opponent aFPA.`, full.easiest, full.avg, "good", "ovr", "asc"),
    make("toughest-full", "Toughest Full-Season", `Worst ${position} ${noun} by opponent aFPA.`, full.toughest, full.avg, "bad", "ovr", "desc"),
    make("easiest-playoff", "Easiest Playoff", `Best ${position} playoff ${noun} by opponent aFPA.`, po.easiest, po.avg, "good", "playoff", "asc"),
    make("toughest-playoff", "Toughest Playoff", `Worst ${position} playoff ${noun} by opponent aFPA.`, po.toughest, po.avg, "bad", "playoff", "desc"),
  ];
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Build the pure board from its three inputs. Exported for the tests, which
 * hand it a fixed FPA table and schedule rather than a database and nflverse.
 */
export function buildSosBoard(
  fpa: FpaTableData,
  schedule: ScheduleSeason,
  pool: Pool | null,
  position: FantasyPosition,
  scoring: SosScoring,
): SosBoard {
  const def = defenses(fpa, position);
  const byTeamSlots = slots(schedule);
  const rosFrom = rosStartWeek(schedule);
  const rosWeeks = FANTASY_WEEKS.filter((w) => w >= rosFrom);

  const cellsByTeam = new Map<string, SosCell[]>();
  for (const team of TEAMS) cellsByTeam.set(team.abbreviation, cellsFor(byTeamSlots.get(team.abbreviation), def));

  const fullAvg = new Map<string, number>();
  const rosAvg = new Map<string, number>();
  const playoffAvg = new Map<string, number>();
  for (const [abbr, cells] of cellsByTeam) {
    // The source ranks a team with no usable games as 0 rather than dropping it.
    fullAvg.set(abbr, averageOver(cells, FANTASY_WEEKS) ?? 0);
    rosAvg.set(abbr, averageOver(cells, rosWeeks) ?? 0);
    playoffAvg.set(abbr, averageOver(cells, PO3_WEEKS) ?? 0);
  }
  const overallRank = denseRankDesc(fullAvg);
  const rosRank = denseRankDesc(rosAvg);
  const playoffRank = denseRankDesc(playoffAvg);
  const po2 = spans(cellsByTeam, PO2_WEEKS);
  const po3 = spans(cellsByTeam, PO3_WEEKS);

  const teams: SosTeamRow[] = TEAMS.map((team) => {
    const cells = cellsByTeam.get(team.abbreviation)!;
    const ros = rosWeeks.length ? averageOver(cells, rosWeeks) : null;
    const rank = rosRank.get(team.abbreviation)!;
    return {
      team,
      overallRank: overallRank.get(team.abbreviation)!,
      rosRank: rank,
      playoffRank: playoffRank.get(team.abbreviation)!,
      weeks: cells,
      po2: po2.get(team.abbreviation) ?? null,
      po3: po3.get(team.abbreviation) ?? null,
      ros: ros === null ? null : { afpa: ros, bucket: bucketFromScheduleRank(rank) },
      fullAfpa: averageOver(cells, FANTASY_WEEKS),
    };
  }).sort((a, b) => a.overallRank - b.overallRank || a.team.code.localeCompare(b.team.code));

  // Players take their team's schedule; their ranks are dense among the players
  // listed, so a board of 46 backs ranks 1-N over the teams they play for.
  const projKey = PROJ_KEY[scoring];
  const listed = (pool?.players ?? [])
    .filter((p) => p.position === position)
    .map((p) => ({ p, team: getTeamByAbbreviation(p.team) }))
    .filter((x): x is { p: PoolPlayer; team: NflTeam } => x.team !== null);

  const rankAmong = (source: Map<string, number>) =>
    denseRankDesc(new Map(listed.map(({ p, team }) => [p.id, source.get(team.abbreviation) ?? 0])));
  const pOverall = rankAmong(fullAvg);
  const pRos = rankAmong(rosAvg);
  const pPlayoff = rankAmong(playoffAvg);

  const players: SosPlayerRow[] = listed
    .map(({ p, team }) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      team,
      position,
      maxProj: p.maxProj[projKey] ?? 0,
      overallRank: pOverall.get(p.id)!,
      rosRank: pRos.get(p.id)!,
      playoffRank: pPlayoff.get(p.id)!,
      weeks: cellsByTeam.get(team.abbreviation)!,
      po2: po2.get(team.abbreviation) ?? null,
      po3: po3.get(team.abbreviation) ?? null,
      fullAfpa: averageOver(cellsByTeam.get(team.abbreviation)!, FANTASY_WEEKS),
    }))
    .sort(
      (a, b) =>
        a.overallRank - b.overallRank || b.maxProj - a.maxProj || a.name.localeCompare(b.name),
    );

  const teamCards = cardsFor(teams, position, false, (r) => r.team, (r) => `team-${r.team.abbreviation}`);
  const playerCards = cardsFor(players, position, true, (r) => r.team, (r) => `player-${r.id}`);

  return {
    season: schedule.season,
    position,
    scoring,
    rosFrom,
    weekNumber: fpa.weekNumber,
    isPreseason: fpa.isPreseason,
    methodology: fpa.methodology,
    teams,
    players,
    teamCards,
    playerCards,
    version: hash(
      [fpa.version, schedule.version, rosFrom, pool?.builtAt ?? "", position, scoring].join("|"),
    ),
  };
}
