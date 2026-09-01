/**
 * Advanced team statistics — offence and defence, every number carrying its
 * league rank.
 *
 * ── Why this is not four more per-team fetches ──────────────────────────────
 * lib/team/snapshot.ts reads ESPN's per-team statistics document, which is the
 * right shape for four headline numbers and the wrong shape for this tab. It
 * carries only the team's OWN production — its `pointsAllowed` and
 * `yardsAllowed` fields are present and always zero — so a defence built from
 * it would be a table of nothing, and ranking anything ourselves would mean
 * thirty-two requests to render one page.
 *
 * ESPN's `statistics/byteam` document solves both at once: all 32 teams, each
 * split into an "Own" and an "Opponent" half, in a single response. Opponent is
 * the defence — what this team allowed — which is the half no per-team endpoint
 * gives us. One fetch per season serves all 32 hubs, so this tab adds one
 * upstream document to the whole application rather than one per page.
 *
 * ── Why the ranks are computed here ─────────────────────────────────────────
 * The document ships ranks of its own and they are NOT used for the opponent
 * split, because their direction is not stated anywhere and is not consistent:
 * a team allowing 193.5 net passing yards a game — top-ten defence — is handed
 * back as 24th. Whether that is "24th most allowed" or a straight mistake is
 * not something a reader should have to work out, and printing it beside a
 * green tint would be an outright falsehood about the team.
 *
 * So every rank on this page is computed from all 32 teams' own values, with
 * the direction declared per metric (see `DIRECTION` on each definition):
 * fewest points allowed is 1st, most points scored is 1st, and a volume metric
 * with no better or worse end is ranked most-to-least and rendered without any
 * judgement attached. Ties share a rank and are marked as tied.
 *
 * The two rules from team-render.ts hold here as everywhere: a value ESPN does
 * not report is null and its row is dropped, and nothing is defaulted to zero.
 */

import { createKeyedCache, fetchJson, TEAM_USER_AGENT } from "./cache";
import type { NflTeam } from "./teams";

/**
 * Which end of the scale is good.
 *
 * `volume` is the honest answer for pace and play-mix: 61 plays a game is not
 * better or worse than 58, it is just more, and the renderer draws those
 * without a tier colour. It is still ranked (most first) because "18th" is how
 * a reader places a pace figure among 32 teams.
 */
export type StatDirection = "high" | "low" | "volume";

export interface StatRow {
  /** Stable id, used as the rank key and in the markup. */
  key: string;
  /** Short label, e.g. "Yds/Play". */
  label: string;
  /** Spelled out for assistive tech, which never sees the abbreviation. */
  description: string;
  /** Preformatted, e.g. "28.8", "42.9%", "+3". */
  value: string;
  /** 1-32. Null when too few teams reported the metric to rank it. */
  rank: number | null;
  /**
   * True when the figure accumulates over a season rather than being a rate.
   *
   * Only turnover margin, among what this page shows. It matters because a
   * season still in progress can be compared with a finished one on points per
   * game and cannot on a running total: +3 through four games is not a worse
   * year than +7 through seventeen. The history table reads this before it
   * marks a column's best season.
   */
  cumulative: boolean;
  /** Ordinal for display, e.g. "2nd" or "T-5th". */
  rankLabel: string | null;
  /**
   * This team's rank in the same metric one season earlier, so the page can
   * show which way a unit is moving rather than only where it stands.
   *
   * Null on a `volume` metric even when the number exists: pace moving from
   * 26th to 12th is a change of style, not an improvement, and an arrow beside
   * it would be the page reading a verdict into it that is not there.
   */
  previousRank: number | null;
  direction: StatDirection;
}

/** One season of this team, for the history table. */
export interface HistorySeason {
  season: number;
  gamesPlayed: number | null;
  /** The same metrics in the same order every season, so columns line up. */
  cells: StatRow[];
}

/** Share of offensive plays that were passes / runs. Both, or neither. */
export interface PlayBalance {
  passPct: number;
  rushPct: number;
}

export interface TeamStats {
  season: number;
  /** Games behind every per-game figure, so the page can say how many. */
  gamesPlayed: number | null;
  /** Efficiency ladder for this team's offence. */
  offense: StatRow[];
  /** The same ladder, row for row, for what the defence allowed. */
  defense: StatRow[];
  /** Downs, pressure and ball security. */
  situational: StatRow[];
  /** Pace and play mix — what actually decides fantasy opportunity. */
  volume: StatRow[];
  /** This offence's pass/run split. */
  balance: PlayBalance | null;
  /** The split opponents used against this defence. */
  balanceFaced: PlayBalance | null;
  /**
   * Recent seasons, newest first, `season` included as the first row.
   *
   * Empty on the cached league object and filled in by getTeamStats(), which is
   * the only place that has more than one season loaded at once.
   */
  history: HistorySeason[];
  fetchedAt: number;
}

/** Seasons in the history table, counting the most recent one. */
const HISTORY_SEASONS = 5;

/**
 * The columns of the history table, in order.
 *
 * A deliberately short list. The point of five seasons side by side is the
 * shape of the trend, and a 30-column matrix has no shape — these are the three
 * numbers that describe an offence, the two that describe a defence, and the
 * one that describes neither and decides games anyway.
 */
const HISTORY_KEYS: readonly string[] = [
  "off-points",
  "off-total-yards",
  "off-yards-per-play",
  "def-points",
  "def-total-yards",
  "turnover-margin",
];

/** Short column heads for the history table, keyed as above. */
const HISTORY_LABELS: Record<string, string> = {
  "off-points": "Pts/G",
  "off-total-yards": "Yds/G",
  "off-yards-per-play": "Yds/Play",
  "def-points": "Pts All",
  "def-total-yards": "Yds All",
  "turnover-margin": "TO +/-",
};

/* ---------------------------------------------------------------- upstream */

interface ByTeamCategory {
  name?: string;
  displayName?: string;
  values?: number[];
}

interface ByTeamEntry {
  team?: { id?: string; abbreviation?: string };
  categories?: ByTeamCategory[];
}

interface ByTeamGlossary {
  name?: string;
  names?: string[];
}

interface ByTeamResponse {
  teams?: ByTeamEntry[];
  categories?: ByTeamGlossary[];
}

type Split = "own" | "opponent";

/**
 * Column positions, per category, from the document's own glossary.
 *
 * The per-team categories are bare `values` arrays; the glossary at the top of
 * the response is the only thing that says which column is which. Rebuilt on
 * every load rather than hard-coded, because a column ESPN inserts would
 * otherwise silently shift every number on this page by one.
 *
 * First occurrence wins: several categories list a name twice (`rushing` names
 * `rushingYards` at two positions with the same value), and the duplicates are
 * genuinely duplicates.
 */
function buildIndex(payload: ByTeamResponse): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const category of payload.categories ?? []) {
    if (!category.name || !category.names) continue;
    const columns = new Map<string, number>();
    category.names.forEach((name, i) => {
      if (!columns.has(name)) columns.set(name, i);
    });
    index.set(category.name, columns);
  }
  return index;
}

/**
 * One number for one team, or null.
 *
 * The split is identified by the category's displayName ("Own Passing" /
 * "Opponent Passing") because `name` is identical for the pair — the two halves
 * of the document are distinguishable only by that string.
 */
function reader(
  entry: ByTeamEntry,
  index: Map<string, Map<string, number>>,
): (category: string, split: Split, stat: string) => number | null {
  return (category, split, stat) => {
    const column = index.get(category)?.get(stat);
    if (column === undefined) return null;
    const want = split === "own" ? "own" : "opponent";
    const found = entry.categories?.find(
      (c) =>
        c.name === category &&
        (c.displayName ?? "").trim().toLowerCase().startsWith(want),
    );
    const value = found?.values?.[column];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
}

/* ----------------------------------------------------------------- derived */

/**
 * One side of one team's season, with the figures ESPN does not publish worked
 * out from the ones it does.
 *
 * Plays and yards-per-play are the notable ones. There is no plays column in
 * this document, but a snap that was not a run was a pass attempt or a sack, so
 * `plays = pass attempts + sacks + rush attempts` — the standard definition,
 * and the one that makes net yards per play come out right against ESPN's own
 * net totals. Kneels and spikes are inside it, as they are everywhere else.
 */
interface Side {
  gamesPlayed: number | null;
  plays: number | null;
  playsPerGame: number | null;
  passPlays: number | null;
  passRate: number | null;
  pointsPerGame: number | null;
  yardsPerGame: number | null;
  yardsPerPlay: number | null;
  passYardsPerGame: number | null;
  rushYardsPerGame: number | null;
  yardsPerPassAttempt: number | null;
  yardsPerRushAttempt: number | null;
  passerRating: number | null;
  thirdDownPct: number | null;
  fourthDownPct: number | null;
  firstDownsPerGame: number | null;
  passAttemptsPerGame: number | null;
  rushAttemptsPerGame: number | null;
  passingTouchdowns: number | null;
  rushingTouchdowns: number | null;
  sacks: number | null;
  takeaways: number | null;
  giveaways: number | null;
  turnoverMargin: number | null;
  penaltyYardsPerGame: number | null;
}

/** a / b, or null when either is missing or b is zero. */
function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

function deriveSide(
  read: (category: string, split: Split, stat: string) => number | null,
  split: Split,
): Side {
  const gamesPlayed = read("general", split, "gamesPlayed");
  const games = gamesPlayed !== null && gamesPlayed > 0 ? gamesPlayed : null;

  const passAttempts = read("passing", split, "passingAttempts");
  const sacks = read("passing", split, "sacks");
  const rushAttempts = read("rushing", split, "rushingAttempts");
  const netTotalYards = read("passing", split, "netTotalYards");

  // A dropback is an attempt or a sack; everything else from scrimmage is a
  // carry. Null unless all three are present — a partial sum would understate
  // the denominator and inflate every rate built on it.
  const passPlays =
    passAttempts !== null && sacks !== null ? passAttempts + sacks : null;
  const plays =
    passPlays !== null && rushAttempts !== null ? passPlays + rushAttempts : null;

  const penaltyYards = read("miscellaneous", split, "totalPenaltyYards");
  const firstDowns = read("miscellaneous", split, "firstDowns");

  const pct = (value: number | null): number | null =>
    value === null ? null : value * 100;

  return {
    gamesPlayed,
    plays,
    playsPerGame: ratio(plays, games),
    passPlays,
    passRate: pct(ratio(passPlays, plays)),
    pointsPerGame: read("passing", split, "totalPointsPerGame"),
    // "Net" throughout, matching lib/team/snapshot.ts — sack yardage is charged
    // to the offence there and it must not be charged differently here, or the
    // Overview tab and this one would print two different totals for one team.
    yardsPerGame: read("passing", split, "netYardsPerGame"),
    yardsPerPlay: ratio(netTotalYards, plays),
    passYardsPerGame: read("passing", split, "netPassingYardsPerGame"),
    rushYardsPerGame: read("rushing", split, "rushingYardsPerGame"),
    yardsPerPassAttempt: read("passing", split, "yardsPerPassAttempt"),
    yardsPerRushAttempt: read("rushing", split, "yardsPerRushAttempt"),
    passerRating: read("passing", split, "QBRating"),
    thirdDownPct: read("miscellaneous", split, "thirdDownConvPct"),
    fourthDownPct: read("miscellaneous", split, "fourthDownConvPct"),
    firstDownsPerGame: ratio(firstDowns, games),
    passAttemptsPerGame: ratio(passAttempts, games),
    rushAttemptsPerGame: ratio(rushAttempts, games),
    passingTouchdowns: read("passing", split, "passingTouchdowns"),
    rushingTouchdowns: read("rushing", split, "rushingTouchdowns"),
    sacks,
    takeaways: read("miscellaneous", split, "totalTakeaways"),
    giveaways: read("miscellaneous", split, "totalGiveaways"),
    turnoverMargin: read("miscellaneous", split, "turnOverDifferential"),
    penaltyYardsPerGame: ratio(penaltyYards, games),
  };
}

interface TeamSides {
  espnId: string;
  own: Side;
  opponent: Side;
}

/* -------------------------------------------------------------- formatting */

function one(value: number): string {
  return value.toFixed(1);
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function whole(value: number): string {
  return String(Math.round(value));
}

/** Turnover margin is the one figure whose sign is the information. */
function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/* ------------------------------------------------------------- definitions */

interface MetricDef {
  key: string;
  label: string;
  description: string;
  split: Split;
  direction: StatDirection;
  /** See StatRow.cumulative. Defaults to false — nearly everything is a rate. */
  cumulative?: boolean;
  pick: (side: Side) => number | null;
  format: (value: number) => string;
}

/**
 * The offence ladder and the defence ladder are deliberately the SAME metrics
 * in the SAME order, one read from the team's own half of the document and one
 * from its opponents'. Side by side the reader can run a finger down two
 * columns and compare a team against itself — points scored against points
 * allowed, yards per play gained against yards per play surrendered — which is
 * the single most useful thing a team stats page can do and is impossible the
 * moment the two lists diverge.
 */
const LADDER: Array<{
  key: string;
  offenseLabel: string;
  defenseLabel: string;
  offenseDescription: string;
  defenseDescription: string;
  pick: (side: Side) => number | null;
  format: (value: number) => string;
}> = [
  {
    key: "points",
    offenseLabel: "Points/G",
    defenseLabel: "Points/G",
    offenseDescription: "Points scored per game",
    defenseDescription: "Points allowed per game",
    pick: (s) => s.pointsPerGame,
    format: one,
  },
  {
    key: "total-yards",
    offenseLabel: "Total Yds/G",
    defenseLabel: "Total Yds/G",
    offenseDescription: "Total net yards gained per game",
    defenseDescription: "Total net yards allowed per game",
    pick: (s) => s.yardsPerGame,
    format: one,
  },
  {
    key: "yards-per-play",
    offenseLabel: "Yds/Play",
    defenseLabel: "Yds/Play",
    offenseDescription: "Net yards gained per offensive play",
    defenseDescription: "Net yards allowed per play",
    pick: (s) => s.yardsPerPlay,
    format: (v) => v.toFixed(2),
  },
  {
    key: "pass-yards",
    offenseLabel: "Pass Yds/G",
    defenseLabel: "Pass Yds/G",
    offenseDescription: "Net passing yards gained per game",
    defenseDescription: "Net passing yards allowed per game",
    pick: (s) => s.passYardsPerGame,
    format: one,
  },
  {
    key: "rush-yards",
    offenseLabel: "Rush Yds/G",
    defenseLabel: "Rush Yds/G",
    offenseDescription: "Rushing yards gained per game",
    defenseDescription: "Rushing yards allowed per game",
    pick: (s) => s.rushYardsPerGame,
    format: one,
  },
  {
    key: "yards-per-attempt",
    offenseLabel: "Yds/Pass Att",
    defenseLabel: "Yds/Pass Att",
    offenseDescription: "Yards gained per pass attempt",
    defenseDescription: "Yards allowed per pass attempt",
    pick: (s) => s.yardsPerPassAttempt,
    format: (v) => v.toFixed(2),
  },
  {
    key: "yards-per-carry",
    offenseLabel: "Yds/Carry",
    defenseLabel: "Yds/Carry",
    offenseDescription: "Yards gained per rushing attempt",
    defenseDescription: "Yards allowed per rushing attempt",
    pick: (s) => s.yardsPerRushAttempt,
    format: (v) => v.toFixed(2),
  },
  {
    key: "passer-rating",
    offenseLabel: "Passer Rtg",
    defenseLabel: "Passer Rtg",
    offenseDescription: "Passer rating produced by this offense",
    defenseDescription: "Passer rating allowed to opposing quarterbacks",
    pick: (s) => s.passerRating,
    format: one,
  },
  {
    key: "third-down",
    offenseLabel: "3rd Down",
    defenseLabel: "3rd Down",
    offenseDescription: "Third downs converted",
    defenseDescription: "Third downs allowed to convert",
    pick: (s) => s.thirdDownPct,
    format: percent,
  },
];

const OFFENSE: MetricDef[] = LADDER.map((row) => ({
  key: `off-${row.key}`,
  label: row.offenseLabel,
  description: row.offenseDescription,
  split: "own",
  direction: "high",
  pick: row.pick,
  format: row.format,
}));

const DEFENSE: MetricDef[] = LADDER.map((row) => ({
  key: `def-${row.key}`,
  label: row.defenseLabel,
  description: row.defenseDescription,
  split: "opponent",
  // Every row in the ladder is something a defence wants less of, including
  // the passer rating it allows. Fewest is 1st.
  direction: "low",
  pick: row.pick,
  format: row.format,
}));

/**
 * Downs, pressure and ball security.
 *
 * Two of these read from the opposite split to the one their name suggests, and
 * the reason is worth stating: sacks in the "Own" passing category are sacks
 * this team's QUARTERBACK took, and sacks in the "Opponent" category are sacks
 * its DEFENCE recorded. Reading them the intuitive way round would print the
 * pass rush's number under "Sacks Allowed" for all 32 teams.
 */
const SITUATIONAL: MetricDef[] = [
  {
    key: "fourth-down",
    label: "4th Down",
    description: "Fourth downs converted",
    split: "own",
    direction: "high",
    pick: (s) => s.fourthDownPct,
    format: percent,
  },
  {
    key: "first-downs",
    label: "1st Downs/G",
    description: "First downs gained per game",
    split: "own",
    direction: "high",
    pick: (s) => s.firstDownsPerGame,
    format: one,
  },
  {
    key: "sacks-allowed",
    label: "Sacks Allowed",
    description: "Sacks given up by this offense",
    split: "own",
    direction: "low",
    pick: (s) => s.sacks,
    format: whole,
  },
  {
    key: "sacks-made",
    label: "Sacks",
    description: "Sacks recorded by this defense",
    split: "opponent",
    direction: "high",
    pick: (s) => s.sacks,
    format: whole,
  },
  {
    key: "takeaways",
    label: "Takeaways",
    description: "Turnovers forced by this defense",
    split: "own",
    direction: "high",
    pick: (s) => s.takeaways,
    format: whole,
  },
  {
    key: "giveaways",
    label: "Giveaways",
    description: "Turnovers committed by this offense",
    split: "own",
    direction: "low",
    pick: (s) => s.giveaways,
    format: whole,
  },
  {
    key: "turnover-margin",
    label: "TO Margin",
    description: "Turnover differential for the season",
    split: "own",
    direction: "high",
    cumulative: true,
    pick: (s) => s.turnoverMargin,
    format: signed,
  },
  {
    key: "penalty-yards",
    label: "Penalty Yds/G",
    description: "Penalty yards conceded per game",
    split: "own",
    direction: "low",
    pick: (s) => s.penaltyYardsPerGame,
    format: one,
  },
];

/**
 * Pace and play mix.
 *
 * All `volume`: none of these has a good end. A team running 66 plays a game is
 * not a better team than one running 59, it is a team whose skill players get
 * more chances — which is the only question a fantasy manager is asking of this
 * block, and why the rank is shown while the tier colour is not.
 */
const VOLUME: MetricDef[] = [
  {
    key: "plays",
    label: "Plays/G",
    description: "Offensive plays run per game",
    split: "own",
    direction: "volume",
    pick: (s) => s.playsPerGame,
    format: one,
  },
  {
    key: "pass-attempts",
    label: "Pass Att/G",
    description: "Pass attempts per game",
    split: "own",
    direction: "volume",
    pick: (s) => s.passAttemptsPerGame,
    format: one,
  },
  {
    key: "rush-attempts",
    label: "Carries/G",
    description: "Rushing attempts per game",
    split: "own",
    direction: "volume",
    pick: (s) => s.rushAttemptsPerGame,
    format: one,
  },
  {
    key: "pass-td",
    label: "Pass TD",
    description: "Passing touchdowns scored",
    split: "own",
    direction: "high",
    pick: (s) => s.passingTouchdowns,
    format: whole,
  },
  {
    key: "rush-td",
    label: "Rush TD",
    description: "Rushing touchdowns scored",
    split: "own",
    direction: "high",
    pick: (s) => s.rushingTouchdowns,
    format: whole,
  },
  {
    key: "plays-faced",
    label: "Opp Plays/G",
    description: "Plays this defense faces per game",
    split: "opponent",
    direction: "volume",
    pick: (s) => s.playsPerGame,
    format: one,
  },
];

/* ----------------------------------------------------------------- ranking */

interface Ranked {
  rank: number;
  tied: boolean;
}

/**
 * Competition ranking over the whole league for one metric.
 *
 * Equal values share a rank and the next rank skips — 1, 2, 2, 4 — which is how
 * every sports table in existence does it, and the tie is flagged so the page
 * can print "T-2nd" rather than implying a separation that is not there.
 *
 * Ranks are keyed on the value rather than on the team, so a team that reported
 * nothing simply has no entry and its row is dropped upstream.
 */
function rankMetric(
  teams: TeamSides[],
  def: MetricDef,
): Map<string, Ranked> {
  const entries: Array<{ espnId: string; value: number }> = [];
  for (const team of teams) {
    const value = def.pick(team[def.split]);
    if (value !== null) entries.push({ espnId: team.espnId, value });
  }

  // A metric only a handful of teams report cannot be ranked out of 32 without
  // the number meaning something it does not. Two thirds of the league is the
  // floor; below it the rows still render, without a rank.
  if (entries.length < 22) return new Map();

  // `low` and `volume` differ in what they mean, not in how they sort: fewest
  // first for the former, most first for the latter, same as `high`.
  const ascending = def.direction === "low";
  entries.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value));

  const counts = new Map<number, number>();
  for (const entry of entries) {
    counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
  }

  const ranks = new Map<string, Ranked>();
  const firstIndex = new Map<number, number>();
  entries.forEach((entry, i) => {
    if (!firstIndex.has(entry.value)) firstIndex.set(entry.value, i);
    ranks.set(entry.espnId, {
      rank: (firstIndex.get(entry.value) as number) + 1,
      tied: (counts.get(entry.value) ?? 1) > 1,
    });
  });
  return ranks;
}

/* -------------------------------------------------------------- assembling */

interface LeagueStats {
  season: number;
  fetchedAt: number;
  byEspnId: Map<string, TeamStats>;
}

function balanceOf(side: Side): PlayBalance | null {
  if (side.passRate === null) return null;
  const passPct = side.passRate;
  return { passPct, rushPct: 100 - passPct };
}

function buildRows(
  team: TeamSides,
  defs: MetricDef[],
  ranks: Map<string, Map<string, Ranked>>,
): StatRow[] {
  const rows: StatRow[] = [];
  for (const def of defs) {
    const value = def.pick(team[def.split]);
    // Rule 1 from team-render.ts, applied at the source: a metric this team has
    // no number for produces no row, rather than a row reading "--".
    if (value === null) continue;
    const ranked = ranks.get(def.key)?.get(team.espnId) ?? null;
    rows.push({
      key: def.key,
      label: def.label,
      description: def.description,
      value: def.format(value),
      rank: ranked?.rank ?? null,
      rankLabel: ranked
        ? `${ranked.tied ? "T-" : ""}${ordinal(ranked.rank)}`
        : null,
      // Filled in per request by getTeamStats(), which is the only caller that
      // has last season loaded as well. The cached object stays a single
      // season's truth and is never mutated to carry another's.
      previousRank: null,
      direction: def.direction,
      cumulative: def.cumulative ?? false,
    });
  }
  return rows;
}

function build(season: number, payload: ByTeamResponse): LeagueStats {
  const index = buildIndex(payload);

  const teams: TeamSides[] = [];
  for (const entry of payload.teams ?? []) {
    const espnId = entry.team?.id;
    if (!espnId) continue;
    const read = reader(entry, index);
    const own = deriveSide(read, "own");
    // A team that has played nothing is dropped rather than ranked. ESPN
    // publishes the document from the moment a season opens, and in the week
    // before kickoff every field in it is zero — which would rank all 32 teams
    // joint first at nought points a game. Requiring a game to have been played
    // is what makes the "usable teams" guard below mean anything.
    if (own.gamesPlayed === null || own.gamesPlayed < 1) continue;
    teams.push({ espnId, own, opponent: deriveSide(read, "opponent") });
  }

  const allDefs = [...OFFENSE, ...DEFENSE, ...SITUATIONAL, ...VOLUME];
  const ranks = new Map<string, Map<string, Ranked>>();
  for (const def of allDefs) ranks.set(def.key, rankMetric(teams, def));

  const fetchedAt = Date.now();
  const byEspnId = new Map<string, TeamStats>();
  for (const team of teams) {
    byEspnId.set(team.espnId, {
      season,
      gamesPlayed: team.own.gamesPlayed,
      offense: buildRows(team, OFFENSE, ranks),
      defense: buildRows(team, DEFENSE, ranks),
      situational: buildRows(team, SITUATIONAL, ranks),
      volume: buildRows(team, VOLUME, ranks),
      balance: balanceOf(team.own),
      balanceFaced: balanceOf(team.opponent),
      history: [],
      fetchedAt,
    });
  }

  return { season, fetchedAt, byEspnId };
}

/**
 * One entry for the whole league, keyed on the season.
 *
 * Not one per team: the document is league-wide and the ranks in it are only
 * correct when every team was parsed from the same snapshot. Caching per team
 * would fetch the same 370KB thirty-two times and could still hand a reader a
 * Tuesday rank beside a Sunday value.
 */
const cache = createKeyedCache<LeagueStats>({
  name: "espn-byteam",
  // Season aggregates move once a week, on the same cadence as the Overview
  // tab's snapshot; six hours matches it deliberately so the two tabs cannot
  // drift apart within a page view.
  ttlMs: 6 * 60 * 60 * 1000,
  // Larger than its neighbours: this is 370KB rather than a few KB, and the one
  // caller who pays for it is the first visitor to any team page in the season.
  timeoutMs: 10_000,
  load: async (key, signal) => {
    const season = Number(key);
    const url =
      `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/` +
      `statistics/byteam?region=us&lang=en&contentorigin=espn` +
      `&season=${season}&seasontype=2`;
    const payload = await fetchJson<ByTeamResponse>(url, signal, TEAM_USER_AGENT);
    const league = build(season, payload);

    // A 200 carrying no usable team is a failure, not an empty league — the
    // same rule lib/team/schedule.ts applies to a season with no games. Throwing
    // keeps whatever was cached rather than replacing it with nothing.
    if (league.byEspnId.size < 22) {
      throw new Error(
        `ESPN byteam returned ${league.byEspnId.size} usable teams for ${season}`,
      );
    }
    return league;
  },
});

/** Every row of one season, indexed by metric key. */
function rowIndex(stats: TeamStats): Map<string, StatRow> {
  const index = new Map<string, StatRow>();
  for (const row of [
    ...stats.offense,
    ...stats.defense,
    ...stats.situational,
    ...stats.volume,
  ]) {
    index.set(row.key, row);
  }
  return index;
}

/**
 * Rows carrying last season's rank alongside this one's.
 *
 * A copy, never a mutation: the rows handed in belong to the cached league
 * object and are shared by every request for every team in that season. Writing
 * `previousRank` onto them would leave one team's history stuck to another's
 * numbers for as long as the entry lived.
 */
function withPreviousRanks(
  rows: StatRow[],
  previous: Map<string, StatRow> | null,
): StatRow[] {
  if (!previous) return rows;
  return rows.map((row) => {
    if (row.direction === "volume") return row;
    const before = previous.get(row.key)?.rank ?? null;
    return before === null ? row : { ...row, previousRank: before };
  });
}

/**
 * This team's stats, with the seasons behind them.
 *
 * ── The fallback ────────────────────────────────────────────────────────────
 * The same judgement lib/team/nfl-state.ts already makes one step earlier,
 * applied one step later. `statsSeason` switches to the current year the moment
 * Sleeper says Week 1, but ESPN has nothing to average until games have
 * actually been played — through the opening week its document for the new
 * season is an empty object. Being handed nothing is not a reason to drop the
 * tab in the week of the year most people are looking at it; last season is
 * real football and the page says whose. Which season came back is carried on
 * `TeamStats.season` and the renderer labels the block from that, so the two
 * can never disagree.
 *
 * ── The history ─────────────────────────────────────────────────────────────
 * Four further seasons, requested together rather than in sequence. Each is one
 * more league-wide document — not one per team — so the whole five-season view
 * costs this application five upstream documents in total, and a completed
 * season's numbers never change once they are in memory.
 *
 * Every one is allowed to fail on its own. A season that does not come back is
 * a row the table does not have, which is the same rule the rest of the page
 * follows; it is never a gap filled with zeroes, and it never costs us the
 * current season.
 */
export async function getTeamStats(
  team: NflTeam,
  season: number,
): Promise<TeamStats | null> {
  const current = await cache.ensure(String(season));
  let base = current?.byEspnId.get(team.espnId) ?? null;
  let baseSeason = season;

  if (!base) {
    baseSeason = season - 1;
    const fallback = await cache.ensure(String(baseSeason));
    base = fallback?.byEspnId.get(team.espnId) ?? null;
  }
  if (!base) return null;

  // Settled, not awaited as a group that can reject: one unreachable season
  // must cost its own row and nothing else.
  const older = await Promise.allSettled(
    Array.from({ length: HISTORY_SEASONS - 1 }, (_, i) =>
      cache.ensure(String(baseSeason - 1 - i)),
    ),
  );
  const earlier = older.map((result) =>
    result.status === "fulfilled"
      ? (result.value?.byEspnId.get(team.espnId) ?? null)
      : null,
  );

  const lastSeason = earlier[0] ? rowIndex(earlier[0]) : null;

  const history: HistorySeason[] = [];
  for (const stats of [base, ...earlier]) {
    if (!stats) continue;
    const index = rowIndex(stats);
    const cells: StatRow[] = [];
    for (const key of HISTORY_KEYS) {
      const row = index.get(key);
      if (row) cells.push({ ...row, label: HISTORY_LABELS[key] ?? row.label });
    }
    // A season that produced none of the six columns is not a row, it is a
    // blank line with a year on it.
    if (cells.length > 0) {
      history.push({
        season: stats.season,
        gamesPlayed: stats.gamesPlayed,
        cells,
      });
    }
  }

  return {
    ...base,
    offense: withPreviousRanks(base.offense, lastSeason),
    defense: withPreviousRanks(base.defense, lastSeason),
    situational: withPreviousRanks(base.situational, lastSeason),
    // A single season is not a history. One row under a "Season History"
    // heading reads as a table that failed to load.
    history: history.length > 1 ? history : [],
  };
}

/** Exported for tests: the parse and the ranking, with no network involved. */
export const __internals = { build, ordinal, rankMetric };
