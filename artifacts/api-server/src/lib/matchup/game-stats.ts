/**
 * The postgame player layer: who played, what they did, and what it meant.
 *
 * Four things come out of one pass over the game's appearances:
 *
 *   - the **stat tables** a "eagles vs commanders player stats" search is
 *     actually asking for, by category, both teams in one table;
 *   - the **fantasy table**, which is the same game in the three scorings this
 *     site's readers play and the positional finish each score produced —
 *     the column FOX and ESPN's box scores do not have;
 *   - the **usage table**, snaps and share and targets, because a role change
 *     is worth more to next week's lineup than this week's yardage;
 *   - the **takeaways**, which are that usage read against the player's own
 *     season to date.
 *
 * Everything here is measured. The takeaways are the only prose on the page
 * that is not a stat, and every sentence one of them prints restates a figure
 * printed beside it — there is no sentence about a player's outlook, because
 * this file has no basis for one. A player with no prior games in the season
 * has no baseline and is therefore described rather than compared.
 *
 * Routes run are not here and cannot be: no free source carries them. The usage
 * table says snaps, snap share, targets, target share and carries, and does not
 * pretend to a routes column it would have to invent.
 */

import {
  appearances,
  num,
  positionFinishes,
  snapShareOf,
  targetShareOf,
  type Appearance,
} from "./appearances";
import { gameLeaders, type GameLeaders } from "./leaders";
import type { NflTeam } from "../team/teams";
import type { Player } from "../player/types";
import type { Meeting } from "./matchup-data";

/** What every stat row carries, whatever the category. */
interface RowBase {
  player: Player;
  team: NflTeam | null;
  position: string | null;
}

export interface PassingRow extends RowBase {
  completions: number;
  attempts: number;
  yards: number;
  touchdowns: number;
  interceptions: number;
  /** The NFL's passer rating, computed here. Null under one attempt. */
  rating: number | null;
}

export interface RushingRow extends RowBase {
  carries: number;
  yards: number;
  average: number;
  touchdowns: number;
}

export interface ReceivingRow extends RowBase {
  receptions: number;
  targets: number;
  yards: number;
  average: number;
  touchdowns: number;
}

export interface FantasyRow extends RowBase {
  ppr: number;
  half: number;
  standard: number;
  /** 8 for the WR8 of that week, league-wide. Null when he did not score. */
  positionFinish: number | null;
}

export interface UsageRow extends RowBase {
  snaps: number;
  /** 0–1, or null when the team's snap count is not in the log. */
  snapShare: number | null;
  targets: number;
  /** 0–1, or null. */
  targetShare: number | null;
  carries: number;
}

/**
 * One slice of a team's distribution of a single kind of opportunity.
 *
 * `player` is null for the pooled "Other" slice, which is what the denominator
 * has left over once the named contributors are counted — the fullback with one
 * carry, the receiver who is not a skill-position regular, the tail that would
 * otherwise be four unreadable slivers.
 */
export interface UsageSlice {
  player: Player | null;
  position: string | null;
  /** The player's name, or "Other". */
  label: string;
  /** Targets, or carries. */
  value: number;
  /** 0–1 of the team's total. */
  share: number;
}

/**
 * One team's usage, as the visual layer reads it.
 *
 * Derived beside the usage table rather than from it, because the two answer
 * different questions and need different populations. The table is about the
 * players whose snap count is in question, so it leaves quarterbacks out — a
 * starter plays every snap and his row says nothing. A carry distribution that
 * leaves the quarterback out is simply wrong: his runs are a real share of the
 * backfield, and the remaining slices would be percentages of a total that does
 * not exist. So the shares below are built from the whole appearance list.
 */
export interface TeamUsage {
  team: NflTeam | null;
  /** Top snap-share players, highest first. */
  snaps: UsageRow[];
  targets: UsageSlice[];
  carries: UsageSlice[];
  /**
   * The denominators. Zero is the page's cue to say the data is unavailable
   * rather than draw a ring with nothing in it.
   */
  targetTotal: number;
  carryTotal: number;
}

/**
 * One derived note about a player's role in this game.
 *
 * `direction` is the glyph the card leads with: a role that grew, one that
 * shrank, or one flagged for a reason that is not about size — a player who
 * carries an injury designation now.
 */
export interface Takeaway {
  player: Player;
  team: NflTeam | null;
  position: string | null;
  direction: "up" | "down" | "watch";
  /** Three or four words: "Workload ahead of his rate". */
  headline: string;
  /** The measured facts, already formatted: ["61% of snaps", "12 carries"]. */
  facts: string[];
  /** Two sentences at most, every clause of which restates a fact above. */
  body: string;
  /** How far from his own baseline this was — the sort key, not rendered. */
  magnitude: number;
}

export interface GameStats {
  leaders: GameLeaders | null;
  passing: PassingRow[];
  rushing: RushingRow[];
  receiving: ReceivingRow[];
  fantasy: FantasyRow[];
  usage: UsageRow[];
  /** The same game, split by team and shaped for the charts. */
  usageByTeam: TeamUsage[];
  takeaways: Takeaway[];
}

/* ---------------------------------------------------------------- tables */

/**
 * The NFL's passer rating.
 *
 * Four components, each capped to the range the formula defines — without the
 * clamp a 3-for-3, 2-touchdown line rates above the 158.3 maximum, which is
 * not a rating anybody recognises. Null under one attempt, where the formula
 * divides by zero.
 */
export function passerRating(
  completions: number,
  attempts: number,
  yards: number,
  touchdowns: number,
  interceptions: number,
): number | null {
  if (attempts <= 0) return null;
  const clamp = (value: number): number => Math.min(Math.max(value, 0), 2.375);
  const a = clamp((completions / attempts - 0.3) * 5);
  const b = clamp((yards / attempts - 3) * 0.25);
  const c = clamp((touchdowns / attempts) * 20);
  const d = clamp(2.375 - (interceptions / attempts) * 25);
  return Math.round(((a + b + c + d) / 6) * 100 * 10) / 10;
}

/**
 * Each team's total targets in this game, from the game itself.
 *
 * Upstream's `target_share` is derived by a pipeline that has not filled it for
 * the current season, and `team_tgt` is absent with it — so the usage table's
 * share column was a dash for every row. It does not need either: every player
 * who saw a target in this game is in this list, so the team's total is the sum
 * of the rows, which is not an estimate of the share but the share itself.
 */
function teamTargets(list: Appearance[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of list) {
    const code = entry.team?.abbreviation;
    if (!code) continue;
    totals.set(code, (totals.get(code) ?? 0) + num(entry.stats, "rec_tgt"));
  }
  return totals;
}

function base(entry: Appearance): RowBase {
  return {
    player: entry.player,
    team: entry.team,
    position: entry.player.position ?? null,
  };
}

/** One decimal, and only when there is one: "18.4", but "18" not "18.0". */
export function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function passingRows(list: Appearance[]): PassingRow[] {
  return list
    .filter((entry) => num(entry.stats, "pass_att") > 0)
    .map((entry) => {
      const completions = num(entry.stats, "pass_cmp");
      const attempts = num(entry.stats, "pass_att");
      const yards = num(entry.stats, "pass_yd");
      const touchdowns = num(entry.stats, "pass_td");
      const interceptions = num(entry.stats, "pass_int");
      return {
        ...base(entry),
        completions,
        attempts,
        yards,
        touchdowns,
        interceptions,
        rating: passerRating(completions, attempts, yards, touchdowns, interceptions),
      };
    })
    .sort((x, y) => y.yards - x.yards || y.attempts - x.attempts);
}

function rushingRows(list: Appearance[]): RushingRow[] {
  return list
    .filter((entry) => num(entry.stats, "rush_att") > 0)
    .map((entry) => {
      const carries = num(entry.stats, "rush_att");
      const yards = num(entry.stats, "rush_yd");
      return {
        ...base(entry),
        carries,
        yards,
        average: carries > 0 ? oneDecimal(yards / carries) : 0,
        touchdowns: num(entry.stats, "rush_td"),
      };
    })
    .sort((x, y) => y.yards - x.yards || y.carries - x.carries);
}

function receivingRows(list: Appearance[]): ReceivingRow[] {
  return list
    .filter((entry) => num(entry.stats, "rec_tgt") > 0 || num(entry.stats, "rec") > 0)
    .map((entry) => {
      const receptions = num(entry.stats, "rec");
      const yards = num(entry.stats, "rec_yd");
      return {
        ...base(entry),
        receptions,
        targets: num(entry.stats, "rec_tgt"),
        yards,
        average: receptions > 0 ? oneDecimal(yards / receptions) : 0,
        touchdowns: num(entry.stats, "rec_td"),
      };
    })
    .sort((x, y) => y.yards - x.yards || y.targets - x.targets);
}

/**
 * The same game in the three scorings, and where each score finished.
 *
 * Standard and half are DERIVED from PPR rather than read: `pts_half_ppr` is on
 * most rows but not all, and standard is on none of them. Both follow from the
 * reception count by definition — a PPR point per catch is the whole difference
 * — so deriving them is arithmetic, not an estimate. When the log does carry a
 * half-PPR figure it is used, because a scoring quirk upstream knows about is
 * worth more than our subtraction.
 */
function fantasyRows(list: Appearance[], season: number, week: number): FantasyRow[] {
  const finishes = positionFinishes(season, week);
  return list
    .map((entry) => {
      const ppr = num(entry.stats, "pts_ppr");
      const receptions = num(entry.stats, "rec");
      const logged = entry.stats.pts_half_ppr;
      const half =
        typeof logged === "number" && Number.isFinite(logged)
          ? logged
          : ppr - receptions * 0.5;
      return {
        ...base(entry),
        ppr: oneDecimal(ppr),
        half: oneDecimal(half),
        standard: oneDecimal(ppr - receptions),
        positionFinish: finishes.get(entry.player.id) ?? null,
      };
    })
    .filter((row) => row.ppr > 0)
    .sort((x, y) => y.ppr - x.ppr);
}

/**
 * Snaps and share, for the players whose role is the point.
 *
 * Quarterbacks are left out: a starting quarterback plays every snap and his
 * row is the same 100% every week, which is the definition of a row that costs
 * space and says nothing. This is a table about the players whose usage is in
 * question.
 */
const USAGE_POSITIONS = new Set(["RB", "WR", "TE", "FB"]);

function usageRows(list: Appearance[]): UsageRow[] {
  const totals = teamTargets(list);
  return list
    .filter((entry) => {
      const position = entry.player.position ?? "";
      if (!USAGE_POSITIONS.has(position)) return false;
      return num(entry.stats, "off_snp") > 0;
    })
    .map((entry) => {
      const teamTotal = entry.team ? (totals.get(entry.team.abbreviation) ?? 0) : 0;
      return {
        ...base(entry),
        snaps: num(entry.stats, "off_snp"),
        snapShare: snapShareOf(entry.stats),
        targets: num(entry.stats, "rec_tgt"),
        targetShare:
          teamTotal > 0
            ? num(entry.stats, "rec_tgt") / teamTotal
            : targetShareOf(entry.stats),
        carries: num(entry.stats, "rush_att"),
      };
    })
    // By share rather than by raw snaps. The two teams did not run the same
    // number of plays — 67 against 48 in a game this table was built on — so
    // sorting on the count ranks the busier offence's bench above the other
    // side's every-down players, which is the opposite of what the column
    // beside it is for.
    .sort(
      (x, y) => (y.snapShare ?? 0) - (x.snapShare ?? 0) || y.snaps - x.snaps,
    );
}

/**
 * The positions the visual layer names.
 *
 * Wider than USAGE_POSITIONS by one — the quarterback — because he is a real
 * part of a backfield's carries even though his snap count says nothing. Anyone
 * outside this set still counts toward the denominator; he simply lands in
 * "Other" rather than taking a labelled slice.
 */
const SLICE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

/** Named slices before the tail is pooled. Six segments is a readable ring. */
const SLICE_MAX = 5;

/** The stat keys these distributions are built from. */
type StatKey = Parameters<typeof num>[1];

/**
 * A team's total of one counting stat, over every player who recorded it.
 *
 * The same shape and the same reasoning as teamTargets(): the sum of the rows
 * IS the team's total, so it is the share itself rather than an estimate of it.
 * For rushing that total includes quarterback kneels, exactly as the box score
 * does — this is not the place to invent a second definition of a rush attempt.
 */
function teamTotals(list: Appearance[], stat: StatKey): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of list) {
    const code = entry.team?.abbreviation;
    if (!code) continue;
    totals.set(code, (totals.get(code) ?? 0) + num(entry.stats, stat));
  }
  return totals;
}

/**
 * One team's distribution of one stat: the named contributors, then the rest.
 *
 * Sorted by value, cut at SLICE_MAX, and whatever the denominator still has
 * left — the tail, plus anyone outside SLICE_POSITIONS — pooled into a single
 * "Other". A slice is never drawn for a player who did not record the stat, so
 * a two-back game draws two slices rather than twelve slivers of nothing.
 */
function usageSlices(
  list: Appearance[],
  code: string,
  stat: StatKey,
  total: number,
): UsageSlice[] {
  if (total <= 0) return [];

  const named: UsageSlice[] = list
    .filter(
      (entry) =>
        entry.team?.abbreviation === code &&
        num(entry.stats, stat) > 0 &&
        SLICE_POSITIONS.has(entry.player.position ?? ""),
    )
    .map((entry) => ({
      player: entry.player,
      position: entry.player.position ?? null,
      label: entry.player.name,
      value: num(entry.stats, stat),
      share: num(entry.stats, stat) / total,
    }))
    .sort((x, y) => y.value - x.value)
    .slice(0, SLICE_MAX);

  const counted = named.reduce((sum, slice) => sum + slice.value, 0);
  const rest = total - counted;
  if (rest > 0) {
    named.push({
      player: null,
      position: null,
      label: "Other",
      value: rest,
      share: rest / total,
    });
  }

  return named;
}

/** Top snap shares and both distributions, per team, in the pair's own order. */
function usageByTeam(list: Appearance[], rows: UsageRow[]): TeamUsage[] {
  const targetTotals = teamTotals(list, "rec_tgt");
  const carryTotals = teamTotals(list, "rush_att");

  // The teams in the order the appearance list met them, so the two panels are
  // away-then-home like every other pair of sides on the page.
  const teams: NflTeam[] = [];
  for (const entry of list) {
    if (entry.team && !teams.some((team) => team.abbreviation === entry.team!.abbreviation)) {
      teams.push(entry.team);
    }
  }

  return teams.map((team) => {
    const code = team.abbreviation;
    const targetTotal = targetTotals.get(code) ?? 0;
    const carryTotal = carryTotals.get(code) ?? 0;
    return {
      team,
      // Already sorted by share where they were built; this only narrows them.
      snaps: rows.filter((row) => row.team?.abbreviation === code).slice(0, SLICE_MAX),
      targets: usageSlices(list, code, "rec_tgt", targetTotal),
      carries: usageSlices(list, code, "rush_att", carryTotal),
      targetTotal,
      carryTotal,
    };
  });
}

/* ------------------------------------------------------------ takeaways */

/** A share as the page writes it: "61%". */
function percent(share: number | null): string | null {
  return share === null ? null : `${Math.round(share * 100)}%`;
}

/**
 * A designation as it reads inside a sentence.
 *
 * The chip elsewhere on the page prints the designation as it comes — "IR",
 * "Questionable" — and lower-casing that for a sentence produced "is listed ir",
 * which is not how anybody writes it. The acronyms get the phrase they are short
 * for; the words that already are words get lower-cased; anything unrecognised
 * is left exactly as upstream sent it rather than mangled to fit.
 */
/**
 * Two shapes, because the designations are two kinds of thing. "Questionable"
 * is a word describing the player and takes "is listed <it> on the current
 * injury report"; "IR" is a place he has been put and takes "is now <on it>",
 * because the first frame around the second produces "is listed on injured
 * reserve on the current injury report".
 */
const DESIGNATION_PHRASE: Record<string, { phrase: string; placed: boolean }> = {
  ir: { phrase: "on injured reserve", placed: true },
  pup: { phrase: "on the PUP list", placed: true },
  nfi: { phrase: "on the non-football injury list", placed: true },
  sus: { phrase: "suspended", placed: false },
  suspended: { phrase: "suspended", placed: false },
  out: { phrase: "out", placed: false },
  doubtful: { phrase: "doubtful", placed: false },
  questionable: { phrase: "questionable", placed: false },
  probable: { phrase: "probable", placed: false },
};

/** The clause a takeaway ends with: "is now on injured reserve". */
function designationClause(status: string): string {
  const key = status.trim().toLowerCase();
  const entry = DESIGNATION_PHRASE[key];
  if (!entry) return `is listed ${status.trim()} on the current injury report`;
  return entry.placed
    ? `is now ${entry.phrase}`
    : `is listed ${entry.phrase} on the current injury report`;
}

/** How many of these a page will carry before it stops being a highlight. */
const MAX_TAKEAWAYS = 6;

/** A snap share has to move this far from a player's own rate to be news. */
const SNAP_SWING = 0.12;
/** And a target count this far, off a base of at least five a game. */
const TARGET_SWING = 3;

/**
 * What changed about a player's role, measured against his own season.
 *
 * The comparison is always to the SAME player's prior weeks, never to an
 * expectation this server does not hold: "up from 38%" is a fact about the
 * logs, where "more than expected" would be a claim about a projection nobody
 * here made. A player in his first logged game of the season has no prior
 * weeks, so he is described at a threshold — a genuinely large role — rather
 * than compared with a baseline that does not exist.
 *
 * `injured` are the players carrying a designation on the current injury
 * report. A player who played this game and is on it now is flagged to watch,
 * because that is the one thing on this page that is about next week.
 */
function takeawaysFrom(
  list: Appearance[],
  injured: Map<string, string>,
): Takeaway[] {
  const found: Takeaway[] = [];

  for (const entry of list) {
    const position = entry.player.position ?? "";
    if (!USAGE_POSITIONS.has(position)) continue;

    const snapShare = snapShareOf(entry.stats);
    const snaps = num(entry.stats, "off_snp");
    if (snaps <= 0) continue;

    const carries = num(entry.stats, "rush_att");
    const targets = num(entry.stats, "rec_tgt");
    const receptions = num(entry.stats, "rec");
    const rushYards = num(entry.stats, "rush_yd");
    const recYards = num(entry.stats, "rec_yd");

    const prior = entry.priorAverage;
    const snapDelta =
      prior && snapShare !== null ? snapShare - prior.snapShare : null;

    const facts: string[] = [];
    const share = percent(snapShare);
    if (share) facts.push(`${share} of snaps`);
    else facts.push(`${snaps} snap${snaps === 1 ? "" : "s"}`);
    if (carries > 0) facts.push(`${carries} carr${carries === 1 ? "y" : "ies"}`);
    if (targets > 0) facts.push(`${targets} target${targets === 1 ? "" : "s"}`);
    if (rushYards > 0) facts.push(`${rushYards} rush yds`);
    if (recYards > 0) facts.push(`${receptions} rec, ${recYards} yds`);

    const designation = injured.get(entry.player.id);

    // A designation outranks a role change: a manager reading this page wants
    // to know the player is questionable before they want to know his snap
    // share moved, and one card per player is the rule.
    if (designation) {
      found.push({
        ...base(entry),
        direction: "watch",
        headline: `Listed ${designation.trim()}`,
        facts,
        body:
          `Played ${share ? `${share} of the offensive snaps` : `${snaps} snaps`} ` +
          `and ${designationClause(designation)}.`,
        magnitude: 1,
      });
      continue;
    }

    if (snapDelta !== null && snapShare !== null && prior) {
      const from = percent(prior.snapShare);
      if (snapDelta >= SNAP_SWING && snapShare >= 0.4) {
        found.push({
          ...base(entry),
          direction: "up",
          headline: "Workload ahead of his rate",
          facts,
          body:
            `Played ${share} of the offensive snaps, up from ${from} across his ` +
            `previous ${prior.games} game${prior.games === 1 ? "" : "s"}.` +
            (carries > 0 || targets > 0
              ? ` That came with ${[
                  carries > 0 ? `${carries} carr${carries === 1 ? "y" : "ies"}` : "",
                  targets > 0 ? `${targets} target${targets === 1 ? "" : "s"}` : "",
                ]
                  .filter(Boolean)
                  .join(" and ")}.`
              : ""),
          magnitude: snapDelta,
        });
        continue;
      }
      if (snapDelta <= -SNAP_SWING && prior.snapShare >= 0.4) {
        found.push({
          ...base(entry),
          direction: "down",
          headline: "Role smaller than his rate",
          facts,
          body:
            `Played ${share} of the offensive snaps, down from ${from} across his ` +
            `previous ${prior.games} game${prior.games === 1 ? "" : "s"}.`,
          magnitude: -snapDelta,
        });
        continue;
      }
    }

    // Targets are compared as COUNTS, not as share. A prior week's share needs
    // that week's team total, which is a scan of every teammate's log; the
    // count is in the player's own row and says the same thing about his role.
    if (prior && prior.games >= 2) {
      const targetDelta = targets - prior.targets;
      const from = prior.targets.toFixed(1);
      if (targetDelta >= TARGET_SWING && targets >= 5) {
        found.push({
          ...base(entry),
          direction: "up",
          headline: "Targets ahead of his rate",
          facts,
          body:
            `Saw ${targets} target${targets === 1 ? "" : "s"}, against ${from} a game across his ` +
            `previous ${prior.games} — ${receptions} of them caught for ${recYards} yards.`,
          magnitude: targetDelta / 10,
        });
        continue;
      }
      if (targetDelta <= -TARGET_SWING && prior.targets >= 5) {
        found.push({
          ...base(entry),
          direction: "down",
          headline: "Targets behind his rate",
          facts,
          body:
            `Saw ${targets} target${targets === 1 ? "" : "s"}, against ${from} a game across his ` +
            `previous ${prior.games}.`,
          magnitude: -targetDelta / 10,
        });
        continue;
      }
    }

    // No baseline to compare with — the season's first logged game. A role this
    // size is still the most useful thing the page can say about the player, so
    // it is described rather than called a change. The headline names whichever
    // part of it stood out: six cards all reading "every-down role" is the
    // section saying one thing six times, which is what the first draft did.
    if (!prior && snapShare !== null && snapShare >= 0.65) {
      const headline =
        targets >= 8
          ? "Commanded the targets"
          : carries >= 15
            ? "Led the backfield"
            : snapShare >= 0.85
              ? "Every-down role"
              : "Full-time role";
      const detail =
        targets >= 8
          ? ` and saw ${targets} targets, ${receptions} caught for ${recYards} yards`
          : carries >= 15
            ? ` and carried it ${carries} times for ${rushYards} yards`
            : targets > 0
              ? ` on ${targets} target${targets === 1 ? "" : "s"}`
              : "";
      found.push({
        ...base(entry),
        direction: "up",
        headline,
        facts,
        body: `Played ${share} of the offensive snaps${detail}.`,
        magnitude: snapShare - 0.65,
      });
    }
  }

  // Loudest first, and never more than six: past that this stops being the
  // section's highlights and becomes the usage table again, in prose.
  return found
    .sort((x, y) => {
      const rank = (t: Takeaway): number => (t.direction === "watch" ? 1 : 0);
      return rank(y) - rank(x) || y.magnitude - x.magnitude;
    })
    .slice(0, MAX_TAKEAWAYS);
}

/* ---------------------------------------------------------------- build */

/**
 * Everything the postgame blocks need, from one pass over the logs.
 *
 * Null for a game that is not final, and null when the logs cannot answer —
 * an old meeting whose season predates them is the normal case, and every
 * caller renders nothing rather than an empty table.
 */
export function buildGameStats(
  meeting: Meeting | null,
  injured: Map<string, string> = new Map(),
): GameStats | null {
  if (!meeting || meeting.status !== "final") return null;

  let list: Appearance[];
  try {
    list = appearances(meeting);
  } catch {
    // A season with no log file takes this block out, not the page.
    return null;
  }
  if (list.length === 0) return null;

  const fantasy = fantasyRows(list, meeting.season, meeting.week);
  const usage = usageRows(list);
  const leaders = gameLeaders(list);

  // The fantasy leader's supporting line is the finish that score produced —
  // "WR6" — which is the number a manager converts every score into and the
  // one thing about it this page knows that the box score does not. It is
  // filled here rather than in gameLeaders(), which sees one game and cannot
  // rank a player against the other thirty-one teams' receivers.
  if (leaders?.fantasy) {
    const row = fantasy.find((entry) => entry.player.id === leaders.fantasy!.player.id);
    if (row?.positionFinish !== null && row?.positionFinish !== undefined && row.position) {
      leaders.fantasy.line = `${row.position}${row.positionFinish} this week`;
    }
  }

  const stats: GameStats = {
    leaders,
    passing: passingRows(list),
    rushing: rushingRows(list),
    receiving: receivingRows(list),
    fantasy,
    usage,
    usageByTeam: usageByTeam(list, usage),
    takeaways: takeawaysFrom(list, injured),
  };

  const any =
    stats.leaders ||
    stats.passing.length ||
    stats.rushing.length ||
    stats.receiving.length ||
    stats.fantasy.length;
  return any ? stats : null;
}
