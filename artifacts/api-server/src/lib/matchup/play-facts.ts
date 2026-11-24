/**
 * What the play-by-play says about a play, for every section that names one
 * (WEB-037, 2026-11-24). The recap, the swing list, the scoring summary, the
 * FAQ and the drive log used to each read their own source - the ESPN
 * scoring feed for one, the story store for another - and disagreed: a
 * blocked kick read "missed", the same field goal sat at 0:00 in one table
 * and 0:01 in another, a failed fourth down read as a plain completion and a
 * last-play field goal "gave them a lead they never gave up".
 *
 * The play-by-play (data/matchup/pbp/<season>/<game id>.json, nflverse) is
 * the record each of them is checked against here:
 *
 *   refineDrives        a missed field goal the play text says was blocked
 *                       becomes "blocked_fg"
 *   matchStoryPlay      a story-store play's row in the play-by-play
 *   downFacts           down, distance and spot, a fourth down converted or
 *                       turned over on downs
 *   endsGameAt          no snap and no kickoff after this play in the file
 *   withGameEnding      ESPN's drive chart, the independent record of how the
 *                       game ended, attached to the play-by-play
 *   endsGameConfirmed   endsGameAt AND that record: the play ended the game
 *   pbpScoringPlays     the ESPN scoring plays with the matched snap's clock,
 *                       and endsGame on the score that ended the game
 *
 * A play that cannot be matched to exactly one row keeps what it had: the
 * feed's clock, no down, no ending. Pure; nothing here reads the disk.
 */

import type { GamePbp, PbpDrive, PbpPlay } from "./play-by-play";
import type { ScoringPlay } from "./scoring-plays";
import { playPoints } from "./scoring-plays";
import type { Drive } from "./boxscore";

/** Minimal story-play shape (recap-overview.ts StoryPlay), so this module imports no renderer. */
interface StoryPlayLike {
  qtr: number;
  clock: string | null;
  type: string | null;
  yds: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** "07:08" and "7:08" alike. */
export const clockKey = (c: string | null | undefined): string => (c ?? "").trim().replace(/^0(?=\d)/, "");

/** nflverse's wording for a blocked field goal: "T.Smack 35 yard field goal is BLOCKED (D.Wonnum)". */
export function isBlockedFieldGoal(text: string | null | undefined): boolean {
  return /field goal is blocked/i.test(text ?? "");
}

/** The try after a touchdown, which is not a possession. */
export function isTry(p: PbpPlay): boolean {
  return p.k === "extra_point" || /TWO-POINT CONVERSION/i.test(p.x);
}

const SNAPS = new Set(["pass", "run", "punt", "field_goal", "qb_kneel", "qb_spike", "other"]);

/** A snap from scrimmage (a flagged one with a down counts: the offense had the ball). */
function isSnap(p: PbpPlay): boolean {
  if (isTry(p)) return false;
  if (SNAPS.has(p.k)) return true;
  return p.k === "no_play" && Boolean(p.dn);
}

/**
 * Drives as the page shows them: a "missed_fg" drive whose last field goal
 * try the play text calls blocked is a "blocked_fg" drive (nflverse's
 * fixed_drive_result has one "Missed field goal" for both). A new document;
 * the one passed in is not changed.
 */
export function refineDrives(pbp: GamePbp): GamePbp {
  let changed = false;
  const drives = pbp.drives.map((d) => {
    if (d.result !== "missed_fg") return d;
    const kick = [...pbp.plays].reverse().find((p) => p.d === d.n && p.k === "field_goal");
    if (!kick || !isBlockedFieldGoal(kick.x)) return d;
    changed = true;
    return { ...d, result: "blocked_fg" as const };
  });
  return changed ? { ...pbp, drives } : pbp;
}

/**
 * The ESPN drive chart's results checked against the play-by-play: ESPN
 * files most blocked field goals as "Missed FG". A missed drive whose
 * play-by-play twin (same team, quarter and start clock) ended in a blocked
 * kick says so. Copies.
 */
export function refineEspnDrives(drives: Drive[], pbp: GamePbp | null): Drive[] {
  if (!pbp) return drives;
  const blocked = pbp.drives.filter((d) => d.result === "blocked_fg");
  if (!blocked.length) return drives;
  return drives.map((d) => {
    if (d.result !== "missed_fg") return d;
    const twin = blocked.find((b) => b.team === d.team && b.qtr === d.quarter && clockKey(b.clock) === clockKey(d.startClock));
    return twin ? { ...d, result: "blocked_fg" as const } : d;
  });
}

/** The index of a story play's row in the play-by-play, or -1 when no single row matches. */
export function matchStoryPlay(sp: StoryPlayLike, plays: PbpPlay[]): number {
  let hits: number[] = [];
  plays.forEach((p, i) => {
    if (p.q === sp.qtr && clockKey(p.c) === clockKey(sp.clock) && p.k === sp.type) hits.push(i);
  });
  if (hits.length > 1 && sp.awayScore !== null && sp.homeScore !== null) {
    hits = hits.filter((i) => plays[i]!.away === sp.awayScore && plays[i]!.home === sp.homeScore);
  }
  if (hits.length > 1 && sp.yds !== null) hits = hits.filter((i) => (plays[i]!.y ?? 0) === sp.yds);
  return hits.length === 1 ? hits[0]! : -1;
}

/**
 * True when nothing but the try (and timeouts) followed the play: no snap,
 * no kickoff. The final whistle, whatever the clock read at the snap - a
 * field goal snapped at 0:01 ends the game as surely as one at 0:00.
 */
export function endsGameAt(plays: PbpPlay[], i: number): boolean {
  if (i < 0 || i >= plays.length) return false;
  for (const p of plays.slice(i + 1)) {
    if (isTry(p)) continue;
    if (p.k === "kickoff" || isSnap(p)) return false;
  }
  return true;
}

/**
 * How the game ended, from ESPN's drive chart (independent of the nflverse
 * file): the last drive of the game was this club's scoring drive and, in
 * regulation, it ran the clock to 0:00. Overtime ends on the score itself.
 */
export interface GameEnding {
  /** The club with the ball on the last drive (the defense scored on a "defensive_td"). */
  team: string;
  quarter: number;
  result: "td" | "fg" | "defensive_td";
}

const clockSec = (c: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clockKey(c));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The drive chart's evidence that a score ended the game, or null (WEB-037
 * follow-up, 2026-11-24). A play-by-play with nothing after a score proves
 * nothing on its own: the file may stop short, and a final that matches the
 * play's score cannot tell a kick that ended the game from one followed by
 * a kickoff and a kneel-down. ESPN's last drive is the check: it ended in a
 * touchdown or field goal (or the defense's touchdown on it: a pick-six as
 * time expired), and a fourth-quarter drive ended at 0:00 (start clock minus
 * time elapsed). No drive chart, any other result, or a clock that does not
 * reach zero: null, and no sentence says "final play".
 */
export function espnGameEnding(drives: Drive[] | null | undefined): GameEnding | null {
  const last = drives?.at(-1);
  if (!last) return null;
  const result = last.defensiveScore ? "defensive_td" : last.result === "td" || last.result === "fg" ? last.result : null;
  if (!result) return null;
  if (last.quarter < 4) return null;
  if (last.quarter === 4) {
    const start = clockSec(last.startClock);
    if (start === null || last.durationSeconds === null || start - last.durationSeconds > 0) return null;
  }
  return { team: last.team.toUpperCase(), quarter: last.quarter, result };
}

/** The play-by-play with the drive chart's ending attached (a copy; the cached file is not changed). */
export function withGameEnding(pbp: GamePbp | null, drives: Drive[] | null | undefined): GamePbp | null {
  if (!pbp) return null;
  return { ...pbp, ending: espnGameEnding(drives) };
}

/**
 * The play at `i` ended the game: nothing was snapped or kicked off after it
 * in the file AND the drive chart's ending names its club, quarter and kind
 * of score. Without the drive chart (`ending` null or never attached) the
 * answer is no: the narrowest wording the data supports.
 */
export function endsGameConfirmed(pbp: GamePbp | null | undefined, i: number): boolean {
  const end = pbp?.ending;
  if (!pbp || !end || !endsGameAt(pbp.plays, i)) return false;
  const row = pbp.plays[i]!;
  if (row.q !== end.quarter || (row.t ?? "").toUpperCase() !== end.team) return false;
  if (end.result === "fg") return row.k === "field_goal";
  if (end.result === "defensive_td") return Boolean(row.td) && Boolean(row.int || row.fum);
  return Boolean(row.td) && !row.int && !row.fum;
}

/**
 * True when the final score is this play's score plus at most its try: the
 * other side unchanged, the scorer up by nothing (a field goal, a safety) or
 * by its try (0-2 after a touchdown). A stored play-by-play can stop short
 * of the game (a partial nflverse file); the final box score is the check
 * that nothing was scored after the play, so a score the play-by-play ends
 * on is not taken for the last one when the final says otherwise.
 */
export function isFinalScore(
  at: { awayScore: number | null; homeScore: number | null },
  final: { away: number; home: number },
  scorer: "away" | "home",
  touchdown: boolean,
): boolean {
  if (at.awayScore === null || at.homeScore === null) return false;
  const mine = scorer === "away" ? final.away - at.awayScore : final.home - at.homeScore;
  const theirs = scorer === "away" ? final.home - at.homeScore : final.away - at.awayScore;
  return theirs === 0 && mine >= 0 && mine <= (touchdown ? 2 : 0);
}

export interface DownFacts {
  down: number;
  togo: number;
  /** "DET 7", "MID 50". */
  at: string | null;
  /** A fourth down that picked up the first down or scored on the play itself. */
  converted: boolean;
  /** The drive's last snap, a fourth down short of the line: the ball went over on downs. */
  turnoverOnDowns: boolean;
  /** The pass fell incomplete. */
  incomplete: boolean;
}

/**
 * Down, distance and what came of a fourth down, from the play's row. Null
 * for a row with no down (a kickoff, a try) or one erased by a penalty
 * (no_play): that snap did not count, so neither does its down.
 */
export function downFacts(pbp: GamePbp, i: number): DownFacts | null {
  const p = pbp.plays[i];
  if (!p || !p.dn || p.togo === undefined || p.k === "no_play" || isTry(p)) return null;
  const drive: PbpDrive | undefined = pbp.drives.find((d) => d.n === p.d);
  let lastSnap = -1;
  pbp.plays.forEach((x, j) => {
    if (x.d === p.d && isSnap(x) && x.k !== "no_play") lastSnap = j;
  });
  const fourth = p.dn === 4;
  const gained = p.y ?? 0;
  const converted = fourth && !p.int && !p.fum && (Boolean(p.td) || (Boolean(p.fd) && gained >= p.togo));
  const turnoverOnDowns =
    fourth && !converted && !p.fd && !p.td && !p.int && !p.fum && lastSnap === i && drive?.result === "downs" &&
    (p.k === "pass" || p.k === "run");
  return {
    down: p.dn,
    togo: p.togo,
    at: p.at ?? null,
    converted,
    turnoverOnDowns,
    incomplete: p.k === "pass" && /\bincomplete\b/i.test(p.x),
  };
}

/** nflverse's yard-line codes ("LA 25") as the site's club codes; `t` is already the site's. */
const SPOT_FIX: Record<string, string> = { LA: "LAR", STL: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
const spotSide = (side: string): string => SPOT_FIX[side] ?? side;

/** "fourth-and-4", "fourth-and-goal" (the distance is the spot inside the opponent's 10). */
export function downText(f: DownFacts, offense: string | null): string {
  const ord = ["", "first", "second", "third", "fourth"][f.down] ?? `${f.down}th`;
  const [side, yd] = (f.at ?? "").split(" ");
  const goal = Boolean(side) && Boolean(offense) && side !== "MID" && spotSide(side!) !== offense && Number(yd) === f.togo && f.togo <= 10;
  return `${ord}-and-${goal ? "goal" : f.togo}`;
}

/** "the Detroit 7", "midfield", from "DET 7" and a club-code -> city lookup. */
export function spotText(at: string | null, city: (code: string) => string | null): string | null {
  if (!at) return null;
  if (/^MID\b/.test(at)) return "midfield";
  const m = at.match(/^([A-Z]+)\s+(\d+)$/);
  if (!m) return null;
  const name = city(spotSide(m[1]!));
  return name ? `the ${name} ${m[2]}` : null;
}

/**
 * The scoring plays with the play-by-play's clock (the snap's, which the
 * drive log, the recap and the win-probability list all print) and
 * `endsGame` on a score after which nothing was snapped or kicked off.
 *
 * Matched by what the score made: the quarter and the score after the play
 * (a touchdown before its try). A play with no single match keeps the
 * feed's clock. Only the feed's LAST scoring play can have ended the game:
 * a play-by-play that stops at an earlier score (a partial file) does not
 * make it a walk-off when the box score holds a later one. Without a
 * play-by-play, a fourth-quarter or overtime score the feed clocks at 0:00
 * is the only ending taken on trust.
 */
export function pbpScoringPlays(plays: ScoringPlay[], pbp: GamePbp | null, away: string, home: string): ScoringPlay[] {
  let a = 0;
  let h = 0;
  const used = new Set<number>();
  return plays.map((play, n) => {
    const last = n === plays.length - 1;
    const action = play.type === "field_goal" ? 3 : play.type === "safety" ? 2 : 6;
    const wantA = a + (play.team === away ? action : 0);
    const wantH = h + (play.team === home ? action : 0);
    if (play.team === away) a += playPoints(play);
    else if (play.team === home) h += playPoints(play);
    if (!pbp) {
      return last && play.quarter >= 4 && clockKey(play.clock) === "0:00" ? { ...play, endsGame: true } : play;
    }
    const hits: number[] = [];
    pbp.plays.forEach((p, i) => {
      if (used.has(i) || p.q !== play.quarter || isTry(p) || p.k === "no_play") return;
      if (!(p.score || p.td)) return;
      if (p.away === wantA && p.home === wantH) hits.push(i);
    });
    if (hits.length !== 1) return play;
    const i = hits[0]!;
    used.add(i);
    const row = pbp.plays[i]!;
    const clock = clockKey(row.c) || play.clock;
    const ends = last && endsGameConfirmed(pbp, i);
    return { ...play, clock, ...(ends ? { endsGame: true } : {}) };
  });
}

export interface StoryPlayFacts {
  down: DownFacts | null;
  /** It ended the game: nothing after it in the file, and the drive chart agrees (endsGameConfirmed). */
  endsGame: boolean;
}

/**
 * Each story play's facts from its play-by-play row, for the sections that
 * word story plays (the recap, the swing list). A play with no single
 * matching row is left out of the map: its sentence stays as it was.
 */
export function storyPlayFacts<T extends StoryPlayLike>(plays: T[], pbp: GamePbp | null | undefined): Map<T, StoryPlayFacts> {
  const out = new Map<T, StoryPlayFacts>();
  if (!pbp?.plays.length) return out;
  for (const sp of plays) {
    const i = matchStoryPlay(sp, pbp.plays);
    if (i < 0) continue;
    out.set(sp, { down: downFacts(pbp, i), endsGame: endsGameConfirmed(pbp, i) });
  }
  return out;
}

type Side = "away" | "home";

/**
 * The box score's scoring sequence with the running score after each play,
 * or null when it does not add up to the final (a dropped or partial feed):
 * a sequence that cannot be checked confirms nothing.
 */
function runningScores(
  scoring: ScoringPlay[] | null | undefined,
  away: string,
  home: string,
  final: { away: number; home: number },
): Array<{ play: ScoringPlay; before: { away: number; home: number }; after: { away: number; home: number } }> | null {
  if (!scoring?.length) return null;
  let a = 0;
  let h = 0;
  const out = scoring.map((play) => {
    const before = { away: a, home: h };
    if (play.team === away) a += playPoints(play);
    else if (play.team === home) h += playPoints(play);
    return { play, before, after: { away: a, home: h } };
  });
  return a === final.away && h === final.home ? out : null;
}

/**
 * "Led the rest of the way" and "ahead for good", checked (WEB-037): true
 * only when the box score's complete scoring sequence holds the score that
 * gave `from.side` the lead - same quarter, that side scoring, the same
 * score before it - and that side stayed strictly ahead after it and every
 * later score through the final. A later tie or lead change, a sequence
 * that does not add up to the final, or no single matching score: false.
 */
export function leadHeldToFinal(
  scoring: ScoringPlay[] | null | undefined,
  away: string,
  home: string,
  final: { away: number; home: number },
  from: { quarter: number; side: Side; before: { away: number; home: number } },
): boolean {
  const seq = runningScores(scoring, away, home, final);
  if (!seq) return false;
  const code = from.side === "away" ? away : home;
  const hits = seq
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.play.quarter === from.quarter && s.play.team === code && s.before.away === from.before.away && s.before.home === from.before.home);
  if (hits.length !== 1) return false;
  const ahead = (x: { away: number; home: number }) => (from.side === "away" ? x.away > x.home : x.home > x.away);
  return seq.slice(hits[0]!.i).every((s) => ahead(s.after));
}

/** A halftime lead kept through the final: every second-half score left `side` strictly ahead, by the complete sequence. */
export function halftimeLeadHeld(
  scoring: ScoringPlay[] | null | undefined,
  away: string,
  home: string,
  final: { away: number; home: number },
  side: Side,
): boolean {
  const seq = runningScores(scoring, away, home, final);
  if (!seq) return false;
  const ahead = (x: { away: number; home: number }) => (side === "away" ? x.away > x.home : x.home > x.away);
  const half = [...seq].reverse().find((s) => s.play.quarter <= 2)?.after ?? { away: 0, home: 0 };
  return ahead(half) && seq.filter((s) => s.play.quarter >= 3).every((s) => ahead(s.after));
}

/** The score before a story play, from the score after it (a touchdown's before its try). */
export function scoreBefore(
  p: { td: boolean; fg: string | null; safety?: boolean; awayScore: number | null; homeScore: number | null },
  side: Side,
): { away: number; home: number } | null {
  if (p.awayScore === null || p.homeScore === null) return null;
  const pts = p.td ? 6 : p.fg === "made" ? 3 : p.safety ? 2 : 0;
  return side === "away" ? { away: p.awayScore - pts, home: p.homeScore } : { away: p.awayScore, home: p.homeScore - pts };
}
