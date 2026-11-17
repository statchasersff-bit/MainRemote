/**
 * The Game Recap's words (mak, 2026-11-17: "read like authentic NFL
 * journalism rather than automated summaries").
 *
 * Not a fixed sequence of moments. Every game is read for the storylines it
 * actually has - a star's day, an injury that changed it, a comeback, a late
 * winner, a run of turnovers, one side's control of the line, a result
 * nobody expected - each scored for how much it mattered in THIS game. The
 * best two to four are told; the rest are left out, however true.
 *
 * The recap then follows a reporter's order, bent to the kind of game it
 * was (a rout is not told like a comeback):
 *
 *   opening      winner, score, the lead storyline, what it means
 *   development  how the game unfolded: the scoring runs, drives, turns
 *   decisive     the players and figures that settled it, with cause
 *   conclusion   the loser's side of it and how the game ended
 *
 * Every sentence is built from stored data: the game story store
 * (play-by-play, with stable player ids since 2026-11-17), the per-game
 * drives, the box score, the closing line and the season's results. No
 * model call ([[no-paid-model-calls]]). A claim the data cannot back is left
 * out: an injury is tied to a play only when nflverse's play id says so,
 * never by a shared clock.
 *
 * Phrasing varies by game (a stable hash of the game, not chance), so two
 * routs of the same shape still read differently. The words are plain:
 * no "never looked back", no "dominant", no em dashes (house rule).
 */

import type { BoxTeamStats, GameOdds } from "./boxscore";
import type { GamePlayer, GamePlayers } from "./game-players";
import type { PbpDrive } from "./play-by-play";
import type { GameStory, StoryInjury, StoryPlay } from "./recap-overview";
import type { ScoreboardGame } from "./scoreboard-hero";
import { searchKey } from "../render";

/* ------------------------------------------------------------- inputs */

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  /** After this game: +3 = three straight wins, -2 = two straight losses. */
  streak: number;
}

export interface NarrativeInput {
  /** Seeds the phrasing choices; the nflverse game id or the page path. */
  seed: string;
  game: ScoreboardGame;
  story: GameStory;
  stats: { away: BoxTeamStats | null; home: BoxTeamStats | null };
  players: GamePlayers;
  /** "Detroit", "New England". */
  city: { away: string; home: string };
  /** nflverse's drives for the game (data/matchup/pbp), or null. */
  drives: PbpDrive[] | null;
  /** The closing line, or null. */
  odds: GameOdds | null;
  /** Each side's record through this game, when every earlier game is known. */
  records?: { away: TeamRecord | null; home: TeamRecord | null };
  divisional?: boolean;
}

export interface Narrative {
  headline: string;
  paragraphs: string[];
  /** The storylines told, in rank order: for tests and the before/after audit. */
  storylines: string[];
  gameType: GameType;
}

type Side = "away" | "home";
const other = (s: Side): Side => (s === "away" ? "home" : "away");

/* -------------------------------------------------------------- words */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** AP style: words for one to nine, figures from 10. */
export const word = (n: number): string => WORDS[n] ?? String(n);
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const ordinal = (n: number): string => ORD[n] ?? `${n}th`;
const join = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? "") : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string): string => `${n === 1 && /^[a-z]/.test(one) ? (/^[aeiou]/.test(one) ? "an" : "a") : word(n)} ${n === 1 ? one : many}`;
const times = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${word(n)} times`);
/** "three touchdowns", "a touchdown", "no touchdowns". */
const tdCount = (k: number): string => (k === 0 ? "no touchdowns" : plural(k, "touchdown", "touchdowns"));
const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** "a 45-yard", "an 82-yard", "an 11-yard". */
export function aYards(n: number | null | undefined): string {
  const v = n ?? 0;
  const an = v === 8 || v === 11 || v === 18 || (v >= 80 && v <= 89);
  return `${an ? "an" : "a"} ${v}-yard`;
}

/** "early in the fourth quarter", "in the final minute", from a quarter and clock. */
export function whenOf(qtr: number, clock: string | null): string {
  const [m = 0, s = 0] = (clock ?? "").split(":").map(Number);
  const left = m * 60 + s;
  if (qtr >= 5) return "in overtime";
  if (qtr === 4) {
    if (left < 60) return "in the final minute";
    if (left < 120) return "in the final two minutes";
    if (left < 300) return "late in the fourth quarter";
    if (left < 600) return "midway through the fourth quarter";
    return "early in the fourth quarter";
  }
  if (qtr === 2 && left < 120) return "just before halftime";
  const q = ["", "first", "second", "third"][qtr] ?? "";
  if (left > 600) return `early in the ${q} quarter`;
  if (left < 300) return `late in the ${q} quarter`;
  return `midway through the ${q} quarter`;
}
export const when = (p: { qtr: number; clock: string | null }): string => whenOf(p.qtr, p.clock);

/** "0:41" from "00:41"; "with 41 seconds left" reads better under a minute. */
function clockLeft(clock: string | null): string {
  const [m = 0, s = 0] = (clock ?? "").split(":").map(Number);
  if (m === 0) return `with ${s} second${s === 1 ? "" : "s"} left`;
  return `with ${m}:${String(s).padStart(2, "0")} left`;
}

/** A stable choice among phrasings for one slot of one game. */
function chooser(seed: string) {
  return <T>(slot: string, options: T[]): T => {
    let h = 2166136261;
    for (const ch of `${seed}|${slot}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return options[(h >>> 0) % options.length]!;
  };
}

/* -------------------------------------------------------------- names */

export interface Resolved {
  /** The GamePlayers key ("espn:4374302"), or null when only a spelling matched nothing. */
  key: string | null;
  full: string;
  last: string;
  player: GamePlayer | null;
}

/**
 * nflverse's "A.St. Brown" to the box score's "Amon-Ra St. Brown". By the
 * stable id first (the story's ids map, gsis -> ESPN athlete id), then by
 * club, first initial and last name, where the last name may be any tail
 * of the full name ("St. Brown", "Smith-Njigba"), so a hyphenated or
 * two-word first name still matches.
 */
export function resolver(players: GamePlayers, ids?: GameStory["ids"]) {
  const entries = Object.entries(players);
  const strip = (s: string) => s.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/, "");
  const out = (key: string, p: GamePlayer): Resolved => {
    const parts = strip(p.name).split(/\s+/);
    // The surname as the box score prints it: "St. Brown" keeps both words
    // when nflverse spells it that way, otherwise the last word.
    return { key, full: p.name, last: parts.slice(1).join(" ") || p.name, player: p };
  };
  const lastName = (abbr: string, p: GamePlayer): string => {
    const dot = abbr.indexOf(".");
    const tail = dot > 0 ? abbr.slice(dot + 1) : abbr;
    const parts = strip(p.name).split(/\s+/);
    const tailKey = searchKey(tail).replace(/[^a-z]/g, "");
    for (let k = 1; k < parts.length; k += 1) {
      const cand = parts.slice(k).join(" ");
      if (searchKey(cand).replace(/[^a-z]/g, "") === tailKey) return cand;
    }
    return parts[parts.length - 1] ?? p.name;
  };
  return (abbr: string | null | undefined, team: string | null | undefined): Resolved | null => {
    if (!abbr) return null;
    const byId = team ? ids?.[team]?.[abbr] : undefined;
    const idHit = byId ? players[`espn:${byId}`] : undefined;
    if (byId && idHit) return { ...out(`espn:${byId}`, idHit), last: lastName(abbr, idHit) };
    const dot = abbr.indexOf(".");
    const initial = dot > 0 ? searchKey(abbr.slice(0, dot)).replace(/[^a-z]/g, "").slice(0, 1) : "";
    const tailKey = searchKey(dot > 0 ? abbr.slice(dot + 1) : abbr).replace(/[^a-z]/g, "");
    const hit = entries.find(([, p]) => {
      if (team && p.team !== team) return false;
      const parts = searchKey(strip(p.name)).split(/\s+/);
      if (initial && !(parts[0] ?? "").startsWith(initial)) return false;
      for (let k = 1; k < parts.length; k += 1) if (parts.slice(k).join("") === tailKey) return true;
      return false;
    });
    if (hit) return { ...out(hit[0], hit[1]), last: lastName(abbr, hit[1]) };
    const last = dot > 0 ? abbr.slice(dot + 1) : abbr;
    return { key: null, full: abbr.replace(".", ". "), last, player: null };
  };
}

/** "Jahmyr Gibbs" the first time, "Gibbs" after. */
function call(c: Ctx, who: { full: string; last: string }): string {
  if (c.named.has(who.full)) return who.last;
  c.named.add(who.full);
  return who.full;
}
const lastOf = (full: string): string => {
  const parts = full.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/, "").split(/\s+/);
  return parts.slice(1).join(" ") || full;
};
const callName = (c: Ctx, full: string): string => call(c, { full, last: lastOf(full) });

/* -------------------------------------------------------------- facts */

export type GameType = "comeback" | "close" | "blowout" | "defensive" | "shootout" | "standard";

interface Club {
  side: Side;
  code: string;
  /** "Detroit". */
  city: string;
  /** "Lions". */
  nick: string;
  /** "Detroit Lions". */
  full: string;
  score: number;
  stats: BoxTeamStats | null;
}

interface DriveState {
  drive: PbpDrive;
  start: number;
  end: number;
  /** Winner and loser scores when it ended. */
  w: number;
  l: number;
  /** The scoring play inside it, from the story, when there is one. */
  score: StoryPlay | null;
}

interface Ctx {
  input: NarrativeInput;
  /** The story's plays with each lost fumble charged to the club that fumbled (see normalizePlays). */
  plays: StoryPlay[];
  pick: ReturnType<typeof chooser>;
  name: ReturnType<typeof resolver>;
  W: Club;
  L: Club;
  margin: number;
  total: number;
  ot: boolean;
  half: { w: number; l: number } | null;
  /** Winner-perspective score after each drive, from nflverse's drives. */
  states: DriveState[];
  maxDeficit: { size: number; at: DriveState | null };
  leadChanges: number;
  ties: number;
  trailedInFourth: boolean;
  goAhead: { state: DriveState; play: StoryPlay | null } | null;
  sealer: StoryPlay | null;
  wwp: (homeWp: number) => number;
  /** Facts already told; a later sentence skips them. */
  told: Set<string>;
  /** Players already named in full: later mentions use the last name. */
  named: Set<string>;
  day: string;
}

const elapsedOf = (qtr: number | null, clock: string | null): number => {
  const [m = 0, s = 0] = (clock ?? "15:00").split(":").map(Number);
  const q = qtr ?? 1;
  if (q >= 5) return 3600 + (q - 5) * 600 + (600 - (m * 60 + s));
  return (q - 1) * 900 + (900 - (m * 60 + s));
};

/** "on Sunday" from the kickoff, in Eastern time; "" without one. */
function dayOf(kickoff: string | null): string {
  if (!kickoff) return "";
  const d = new Date(kickoff);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/New_York" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(d));
  return hour >= 19 && day !== "Sunday" ? `${day} night` : hour >= 19 ? "Sunday night" : day;
}

/**
 * A lost fumble on a punt or kickoff is listed under the kicking club
 * (nflverse's posteam), though the returner usually lost it. With the
 * fumbling club stored (fumbleTeam), the play is restated so `pos` is the
 * side that lost the ball and `def` the side that took it, as for every
 * other turnover. Copies; the shared store is never changed.
 */
function normalizePlays(plays: StoryPlay[]): StoryPlay[] {
  return plays.map((p) => {
    // Only a plain lost fumble: an interception fumbled back on the return keeps the passer's side as `pos`.
    if (p.int || !p.fumble || !p.fumbleTeam || p.fumbleTeam === p.pos || p.fumbleTeam !== p.def) return p;
    return { ...p, pos: p.def, def: p.pos };
  });
}

function buildCtx(input: NarrativeInput): Ctx | null {
  const { game } = input;
  const story = { ...input.story, plays: normalizePlays(input.story.plays) };
  const a = story.awayFinal;
  const h = story.homeFinal;
  if (a === h) return null;
  const winner: Side = h > a ? "home" : "away";
  const loser = other(winner);
  const club = (s: Side): Club => ({
    side: s,
    code: game[s].abbr,
    city: input.city[s],
    nick: game[s].short,
    full: game[s].name,
    score: s === "home" ? h : a,
    stats: input.stats[s],
  });
  const W = club(winner);
  const L = club(loser);
  const wwp = (x: number) => (winner === "home" ? x : 1000 - x);
  const q = (s: Side, from: number, to: number) => game[s].quarters?.slice(from, to).reduce((x, y) => x + y, 0) ?? null;
  const hw = q(winner, 0, 2);
  const hl = q(loser, 0, 2);

  // The drive timeline: each drive's window and the score when it ended.
  const drives = (input.drives ?? []).filter((d) => d.qtr !== null && d.away !== null && d.home !== null);
  const scoring = story.plays.filter((p) => p.td || p.fg === "made");
  const states: DriveState[] = drives.map((d, i) => {
    const start = elapsedOf(d.qtr, d.clock);
    const next = drives[i + 1];
    const end = next ? elapsedOf(next.qtr, next.clock) : 99999;
    const w = (winner === "home" ? d.home : d.away) ?? 0;
    const l = (winner === "home" ? d.away : d.home) ?? 0;
    return { drive: d, start, end, w, l, score: null as StoryPlay | null };
  });
  // Each scoring play belongs to the drive in progress when it happened (the
  // last drive that started at or before it). nflverse's drive labels can be
  // off, so the play, not the drive, says who scored.
  for (const p of scoring) {
    let hit: DriveState | null = null;
    for (const s of states) if (s.start <= at(p)) hit = s;
    if (hit) hit.score = p;
  }

  let maxDeficit = { size: 0, at: null as DriveState | null };
  let leader: "w" | "l" | null = null;
  let leadChanges = 0;
  let ties = 0;
  let prev = { w: 0, l: 0 };
  for (const s of states) {
    if (s.l - s.w > maxDeficit.size) maxDeficit = { size: s.l - s.w, at: s };
    if (s.w !== prev.w || s.l !== prev.l) {
      const now = s.w > s.l ? "w" : s.l > s.w ? "l" : null;
      if (now === null && s.w > 0) ties += 1;
      if (now && leader && now !== leader) leadChanges += 1;
      if (now) leader = now;
      prev = { w: s.w, l: s.l };
    }
  }
  const trailedInFourth = states.some((s) => (s.drive.qtr ?? 0) >= 4 && s.l > s.w) ||
    (() => {
      const third = [...states].reverse().find((s) => (s.drive.qtr ?? 0) <= 3);
      return third ? third.l > third.w : false;
    })();

  // The score after which the winner led for good.
  let goAhead: Ctx["goAhead"] = null;
  for (let i = states.length - 1; i >= 0; i -= 1) {
    const s = states[i]!;
    if (s.w <= s.l) break;
    const before = i > 0 ? states[i - 1]! : null;
    if (!before || before.w <= before.l) {
      goAhead = { state: s, play: s.score };
      break;
    }
  }

  const sealer =
    [...story.plays]
      .reverse()
      .find((p) => (p.int || p.fumble) && p.def === W.code && at(p) >= 3300 && (scoreOf(p, winner) ?? 0) > (scoreOf(p, loser) ?? 0) && (scoreOf(p, winner) ?? 0) - (scoreOf(p, loser) ?? 0) <= 8) ?? null;

  return {
    input,
    plays: story.plays,
    pick: chooser(input.seed),
    name: resolver(input.players, story.ids),
    W,
    L,
    margin: W.score - L.score,
    total: W.score + L.score,
    ot: game.away.ot !== null || game.home.ot !== null || story.plays.some((p) => p.qtr >= 5),
    half: hw !== null && hl !== null ? { w: hw, l: hl } : null,
    states,
    maxDeficit,
    leadChanges,
    ties,
    trailedInFourth,
    goAhead,
    sealer,
    wwp,
    told: new Set(),
    named: new Set(),
    day: dayOf(game.kickoff),
  };
}

/** A play's game time from its quarter and clock: the store's `elapsed` runs backward in overtime. */
const at = (p: StoryPlay): number => elapsedOf(p.qtr, p.clock);

function scoreOf(p: StoryPlay, s: Side): number | null {
  return s === "home" ? p.homeScore : p.awayScore;
}

/* ------------------------------------------------------- performances */

interface Performance {
  key: string;
  who: Resolved;
  side: "W" | "L";
  role: "passer" | "runner" | "receiver" | "defender";
  value: number;
}

const n = (v: number | undefined | null): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The game's exceptional individual days, best first. Thresholds pick the field; value ranks it. */
function performances(c: Ctx): Performance[] {
  const out: Performance[] = [];
  for (const [key, p] of Object.entries(c.input.players)) {
    const side = p.team === c.W.code ? "W" : p.team === c.L.code ? "L" : null;
    if (!side) continue;
    const s = p.stats;
    const parts = p.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/, "").split(/\s+/);
    const who: Resolved = { key, full: p.name, last: parts.slice(1).join(" ") || p.name, player: p };
    const scrim = n(s.rushYds) + n(s.recYds);
    const tds = n(s.rushTd) + n(s.recTd);
    const weight = side === "W" ? 1 : 0.7;
    if (n(s.passAtt) >= 10) {
      const yds = n(s.passYds);
      const td = n(s.passTd);
      const int = n(s.passInt);
      const pct = n(s.passCmp) / Math.max(1, n(s.passAtt));
      const great = (yds >= 300 && td >= 3) || td >= 4 || yds >= 380 || (td >= 3 && int === 0 && pct >= 0.7);
      if (great) out.push({ key, who, side, role: "passer", value: weight * (yds / 300 + td * 0.3 - int * 0.3 + (pct >= 0.75 ? 0.2 : 0)) });
      continue;
    }
    if (scrim >= 150 || tds >= 3 || n(s.rushYds) >= 120 || n(s.recYds) >= 125 || (tds >= 2 && scrim >= 90)) {
      const role = n(s.rushYds) >= n(s.recYds) ? "runner" : "receiver";
      out.push({ key, who, side, role, value: weight * (scrim / 140 + tds * 0.4) });
      continue;
    }
    const sacks = n(s.sacks);
    const ints = n(s.defInt);
    if (sacks >= 2.5 || ints >= 2 || n(s.defTd) >= 1 || (sacks >= 2 && n(s.tfl) >= 3)) {
      out.push({ key, who, side, role: "defender", value: weight * (sacks * 0.4 + ints * 0.6 + n(s.defTd) * 0.9) });
    }
  }
  return out.sort((x, y) => y.value - x.value);
}

/** "ran for 153 yards and two touchdowns and caught seven passes for 99 more". */
function statLine(perf: Performance, full = true): string {
  const s = perf.who.player!.stats;
  switch (perf.role) {
    case "passer": {
      const td = n(s.passTd);
      const int = n(s.passInt);
      const base = full
        ? `completed ${n(s.passCmp)} of ${n(s.passAtt)} passes for ${n(s.passYds)} yards and ${tdCount(td)}`
        : `threw for ${n(s.passYds)} yards and ${tdCount(td)}`;
      return int ? `${base}, with ${plural(int, "interception", "interceptions")}` : base;
    }
    case "runner": {
      const rush = `ran for ${n(s.rushYds)} yards${n(s.rushTd) ? ` and ${plural(n(s.rushTd), "touchdown", "touchdowns")}` : ""}`;
      const recLine = n(s.rec) >= 3 && n(s.recYds) >= 30;
      if (!recLine) return rush;
      // "ran for 153 yards and two touchdowns and caught seven passes for 99 more";
      // with a receiving score too, a comma keeps the "and"s apart.
      return n(s.recTd)
        ? `${rush}${n(s.rushTd) ? "," : ""} and caught ${plural(n(s.rec), "pass", "passes")} for ${n(s.recYds)} yards and ${n(s.recTd) === 1 ? "a score" : `${word(n(s.recTd))} scores`}`
        : `${rush} and caught ${plural(n(s.rec), "pass", "passes")} for ${n(s.recYds)} ${n(s.recYds) >= 40 ? "more" : "yards"}`;
    }
    case "receiver": {
      // Receiving touchdowns only on the catch line; a rushing score is its own clause.
      const rec = `caught ${plural(n(s.rec), "pass", "passes")} for ${n(s.recYds)} yards${n(s.recTd) ? ` and ${plural(n(s.recTd), "touchdown", "touchdowns")}` : ""}`;
      return n(s.rushTd) ? `${rec}, and ran for ${n(s.rushTd) === 1 ? "another score" : `${word(n(s.rushTd))} more scores`}` : rec;
    }
    case "defender": {
      const bits: string[] = [];
      if (n(s.sacks)) bits.push(n(s.sacks) === 1 ? "a sack" : `${n(s.sacks) % 1 ? n(s.sacks) : word(n(s.sacks))} sacks`);
      if (n(s.defInt)) bits.push(plural(n(s.defInt), "interception", "interceptions"));
      if (n(s.defTd)) bits.push(n(s.defTd) === 1 ? "a defensive touchdown" : `${word(n(s.defTd))} defensive touchdowns`);
      return `finished with ${join(bits)}`;
    }
  }
}

/** A headline figure for a performance: "252 yards", "four TDs". */
function headlineFigure(perf: Performance): string {
  const s = perf.who.player!.stats;
  if (perf.role === "passer") return n(s.passTd) >= 4 ? `throws ${word(n(s.passTd))} TDs` : `throws for ${n(s.passYds)} yards`;
  if (perf.role === "defender") {
    if (n(s.defInt) >= 2) return `picks off ${word(n(s.defInt))} passes`;
    if (n(s.defTd)) return "scores on defense";
    return `records ${n(s.sacks)} sacks`;
  }
  const scrim = n(s.rushYds) + n(s.recYds);
  const tds = n(s.rushTd) + n(s.recTd);
  if (tds >= 3) return `scores ${word(tds)} times`;
  return perf.role === "receiver" ? `catches ${n(s.rec)} for ${n(s.recYds)}` : `piles up ${scrim} yards`;
}

/* --------------------------------------------------------- storylines */

interface Storyline {
  kind:
    | "star"
    | "injury"
    | "comeback"
    | "late-winner"
    | "back-and-forth"
    | "turnovers"
    | "line-of-scrimmage"
    | "defense"
    | "upset"
    | "shootout"
    | "return-td";
  score: number;
  perf?: Performance;
  injury?: InjuryStory;
  cluster?: StoryPlay[];
}

interface InjuryStory {
  inj: StoryInjury;
  who: Resolved;
  side: "W" | "L";
  isQb: boolean;
  /** The play it came on, when nflverse's play id ties it to a play the story holds. */
  play: StoryPlay | null;
  /** Another player hurt on the same play id, not returned. */
  partner: { inj: StoryInjury; who: Resolved } | null;
  backup: GamePlayer | null;
}

function injuries(c: Ctx): InjuryStory[] {
  const out: InjuryStory[] = [];
  const { story, players } = c.input;
  for (const inj of story.injuries) {
    if (inj.returned || !inj.team) continue;
    const side = inj.team === c.W.code ? "W" : inj.team === c.L.code ? "L" : null;
    if (!side) continue;
    const who = c.name(inj.player, inj.team);
    if (!who?.player) continue;
    const s = who.player.stats;
    const isQb = who.player.pos === "QB" || n(s.passAtt) >= 3;
    // Notable: a passer, a player with a real role before he left, or a defender who made a play.
    const touches = n(s.rushAtt) + n(s.recTgt);
    if (!isQb && touches < 4 && n(s.sacks) < 1 && n(s.defInt) < 1) continue;
    // A non-quarterback hurt in the fourth quarter changed little of this game.
    if (!isQb && (inj.qtr ?? 0) >= 4) continue;
    const play = inj.playId != null ? story.plays.find((p) => p.playId === inj.playId) ?? null : null;
    let backup: GamePlayer | null = null;
    if (isQb) {
      backup =
        Object.values(players)
          .filter((p) => p.team === inj.team && p.name !== who.full && n(p.stats.passAtt) > 0)
          .sort((x, y) => n(y.stats.passAtt) - n(x.stats.passAtt))[0] ?? null;
    }
    out.push({ inj, who, side, isQb, play, partner: null, backup });
  }
  // Same play id, both out: the play hurt both of them. Only the id says so.
  for (const a of out) {
    const b = out.find((x) => x !== a && x.inj.playId != null && x.inj.playId === a.inj.playId);
    if (b) a.partner = { inj: b.inj, who: b.who };
  }
  return out;
}

/** Three or more turnovers inside ten minutes of game clock. */
function turnoverCluster(c: Ctx): StoryPlay[] | null {
  const tos = c.plays.filter((p) => p.int || p.fumble).sort((a, b) => at(a) - at(b));
  let best: StoryPlay[] | null = null;
  for (let i = 0; i < tos.length; i += 1) {
    const run = tos.filter((p) => at(p) >= at(tos[i]!) && at(p) - at(tos[i]!) <= 600);
    if (run.length >= 3 && (!best || run.length > best.length)) best = run;
  }
  if (best) return best;
  // Or three by one defense in a single quarter.
  for (const q of [1, 2, 3, 4, 5]) {
    for (const d of new Set(tos.map((p) => p.def))) {
      const run = tos.filter((p) => p.qtr === q && p.def === d);
      if (run.length >= 3) return run;
    }
  }
  return null;
}

function storylines(c: Ctx, perfs: Performance[], hurt: InjuryStory[]): Storyline[] {
  const out: Storyline[] = [];
  const ws = c.W.stats;
  const ls = c.L.stats;

  // Individual days: the winner's best counts most; a loser's only in a close game or a shootout.
  perfs.slice(0, 3).forEach((p, i) => {
    if (p.side === "L" && c.margin > 8 && c.total < 55) return;
    out.push({ kind: "star", score: 48 + Math.min(30, (p.value - 1) * 22) - i * 6, perf: p });
  });

  // Injuries that changed the game: a quarterback lost early outranks almost anything.
  for (const h of hurt) {
    const early = (h.inj.qtr ?? 9) <= 2;
    let score = h.isQb ? (early ? 66 : 50) : 34;
    if (h.side === "W" && h.isQb && early) score += 6; // won without him
    if (h.partner) score += 4;
    out.push({ kind: "injury", score, injury: h });
  }

  if (isComeback(c)) {
    out.push({ kind: "comeback", score: 62 + Math.min(20, c.maxDeficit.size) + (c.trailedInFourth ? 6 : 0) });
  }
  const ga = c.goAhead;
  if (ga && ((ga.state.drive.qtr ?? 0) >= 4 || c.ot) && c.margin <= 8) {
    const late = ga.play ? at(ga.play) >= 3300 || ga.play.qtr >= 5 : (ga.state.drive.qtr ?? 0) >= 4;
    out.push({ kind: "late-winner", score: late ? 70 : 52 });
  }
  if (c.leadChanges >= 3) out.push({ kind: "back-and-forth", score: 40 + c.leadChanges * 4 });

  const cluster = turnoverCluster(c);
  if (cluster) {
    const late = cluster.every((p) => p.qtr >= 4) && c.margin <= 8;
    const byWinner = cluster.filter((p) => p.def === c.W.code).length;
    out.push({ kind: "turnovers", score: 38 + cluster.length * 3 + (late ? 22 : 0) + (byWinner === cluster.length ? 6 : 0), cluster });
  }

  if (ws && ls && ws.totalYards != null && ls.totalYards != null) {
    const ratio = ws.totalYards / Math.max(1, ls.totalYards);
    if (ratio >= 2 && ws.totalYards - ls.totalYards >= 180) out.push({ kind: "line-of-scrimmage", score: 36 + Math.min(14, (ratio - 2) * 6) });
    const sacks = ls.sacked ?? 0;
    if (ls.totalYards <= 220 || sacks >= 5 || (c.L.score <= 10 && c.margin >= 7)) out.push({ kind: "defense", score: 40 + (sacks >= 5 ? 6 : 0) + (ls.totalYards <= 180 ? 6 : 0) });
  }

  const odds = c.input.odds;
  if (odds && odds.favorite && odds.line >= 3) {
    if (odds.favorite === c.L.code) out.push({ kind: "upset", score: 46 + Math.min(20, odds.line * 2) });
    else if (c.margin - odds.line >= 20 && odds.line <= 3.5) out.push({ kind: "upset", score: 34 });
  }
  if (c.total >= 60 || (c.W.score >= 30 && c.L.score >= 30)) out.push({ kind: "shootout", score: 44 + Math.min(12, (c.total - 60) / 2) });

  const ret = c.plays.find((p) => p.td && p.tdTeam && p.pos !== p.tdTeam);
  if (ret) out.push({ kind: "return-td", score: ret.tdTeam === c.W.code ? 44 : 30 });

  return out.sort((a, b) => b.score - a.score);
}

/** The two to four storylines worth telling: no more than two stars, one of each other kind. */
function choose(all: Storyline[]): Storyline[] {
  const picked: Storyline[] = [];
  let stars = 0;
  const kinds = new Set<string>();
  for (const s of all) {
    if (picked.length >= 4) break;
    if (s.score < 34 && picked.length >= 2) break;
    if (s.kind === "star") {
      if (stars >= 2) continue;
      stars += 1;
    } else if (s.kind !== "injury" && kinds.has(s.kind)) continue;
    else if (s.kind === "injury" && picked.filter((x) => x.kind === "injury").length >= 2) continue;
    kinds.add(s.kind);
    picked.push(s);
  }
  return picked;
}

/** Ten points down at any time, or seven down and still behind in the fourth quarter. */
const isComeback = (c: Ctx): boolean => c.maxDeficit.size >= 10 || (c.trailedInFourth && c.maxDeficit.size >= 7);

function gameType(c: Ctx, picked: Storyline[]): GameType {
  if (isComeback(c)) return "comeback";
  if (c.margin <= 3 || (c.margin <= 8 && picked.some((s) => s.kind === "late-winner"))) return "close";
  if (c.margin >= 17) return "blowout";
  if (c.total <= 30) return "defensive";
  if (c.total >= 60 || (c.W.score >= 30 && c.L.score >= 30)) return "shootout";
  return "standard";
}

/* ---------------------------------------------------------- the plays */

/** A play in past-tense prose: "Jared Goff hit Amon-Ra St. Brown for a 56-yard touchdown". */
function playSentence(c: Ctx, p: StoryPlay, opts: { short?: boolean } = {}): string | null {
  const nm = (abbr: string | null, team: string | null) => {
    const r = c.name(abbr, team);
    return r ? (opts.short ? r.last : call(c, r)) : null;
  };
  const yd = p.yds ?? 0;
  if (p.int) {
    const who = nm(p.interceptor, p.def);
    const qb = nm(p.passer, p.pos);
    if (!who) return null;
    return `${who} intercepted ${qb ?? "a pass"}${p.endZone ? " in the end zone" : ""}${p.td ? " and returned it for a touchdown" : ""}`;
  }
  if (p.fumble) {
    const club = p.def === c.W.code ? c.W.nick : p.def === c.L.code ? c.L.nick : null;
    return `${club ? `the ${club}` : "the defense"} ${p.td ? "returned a fumble for a touchdown" : "recovered a fumble"}`;
  }
  if (p.fg === "made") {
    const k = nm(p.kicker, p.pos);
    return `${k ?? "the kicker"} made ${p.kickDistance ? `${aYards(p.kickDistance)} field goal` : "a field goal"}`;
  }
  if (p.type === "pass" && p.receiver) {
    const qb = nm(p.passer, p.pos);
    const rec = nm(p.receiver, p.pos);
    if (!qb || !rec) return null;
    const verb = c.pick(`pass-verb-${at(p)}`, ["hit", "found", "connected with"]);
    return p.td ? `${qb} ${verb} ${rec} for ${aYards(yd)} touchdown` : `${qb} ${verb} ${rec} for ${yd} yards`;
  }
  if (p.type === "run" && p.rusher) {
    const r = nm(p.rusher, p.pos);
    if (!r) return null;
    return p.td ? `${r} scored on ${aYards(yd)} run` : `${r} broke ${aYards(yd)} run`;
  }
  return null;
}

/** "a 56-yard pass from Jared Goff to Amon-Ra St. Brown", "a 28-yard run by Jahmyr Gibbs". */
function playNoun(c: Ctx, p: StoryPlay, td = false): string | null {
  const kind = td && p.td ? "touchdown " : "";
  if (p.type === "pass") {
    const qb = c.name(p.passer, p.pos);
    const rec = c.name(p.receiver, p.pos);
    return qb && rec ? `${aYards(p.yds)} ${kind}pass from ${call(c, qb)} to ${call(c, rec)}` : null;
  }
  if (p.type === "run") {
    const r = c.name(p.rusher, p.pos);
    return r ? `${aYards(p.yds)} ${kind}run by ${call(c, r)}` : null;
  }
  return null;
}

/** "a 97-yard drive that started at its own 3", for a long scoring drive. */
function driveClause(c: Ctx, s: DriveState): string | null {
  const d = s.drive;
  if (d.yards === null || d.plays === null) return null;
  const startYd = d.start?.match(/^([A-Z]+)\s+(\d+)$/);
  const own = startYd && startYd[1] === d.team ? Number(startYd[2]) : null;
  if (d.yards >= 90 && own !== null && own <= 10) return `a ${d.yards}-yard drive that started at its own ${own}`;
  if (d.yards >= 75 && d.plays >= 10) return `a ${d.plays}-play, ${d.yards}-yard drive`;
  if (d.yards >= 80) return `${aYards(d.yards)} drive`;
  return null;
}

/* ---------------------------------------------------------- paragraphs */

interface Sentence {
  text: string;
  /** Lower goes first when the recap runs long. */
  keep: number;
  /** Game time of the event it tells, where order matters. */
  at?: number;
}

const team = (c: Ctx, which: "W" | "L", form: "full" | "city" | "nick"): string => {
  const club = which === "W" ? c.W : c.L;
  return form === "full" ? `the ${club.full}` : form === "city" ? club.city : `the ${club.nick}`;
};

function verbFor(c: Ctx, type: GameType): string {
  if (type === "comeback") return c.pick("v-comeback", ["rallied to beat", "came back to beat"]);
  if (type === "close") return c.ot ? c.pick("v-ot", ["outlasted", "beat"]) : c.pick("v-close", ["edged", "held off", "beat"]);
  if (type === "blowout") return c.pick("v-blowout", ["routed", "rolled past", "pulled away from"]);
  return c.pick("v-default", ["beat", "defeated"]);
}

function opening(c: Ctx, type: GameType, picked: Storyline[]): Sentence[] {
  const out: Sentence[] = [];
  const lead = picked[0];
  const score = `${c.W.score}–${c.L.score}`;
  const on = c.day ? ` on ${c.day}` : "";
  const ot = c.ot ? " in overtime" : "";
  const verb = verbFor(c, type);
  const beat = `${team(c, "W", "full")} ${verb} ${team(c, "L", "full")} ${score}${ot}${on}`;

  if (lead?.kind === "star" && lead.perf && lead.perf.side === "W") {
    const p = lead.perf;
    c.told.add(`perf:${p.key}`);
    out.push({ text: `${call(c, p.who)} ${statLine(p, false)} as ${beat}.`, keep: 9 });
  } else if (lead?.kind === "comeback" && c.maxDeficit.at) {
    const d = c.maxDeficit;
    const q = d.at!.score?.qtr ?? d.at!.drive.qtr ?? 1;
    const phase = q <= 2 ? "first-half" : q === 3 ? "second-half" : "fourth-quarter";
    out.push({
      text: `${capital(team(c, "W", "full"))} ${c.pick("cb-open", ["erased", "overcame", "came back from"])} a ${d.size}-point ${phase} deficit and beat ${team(c, "L", "full")} ${score}${ot}${on}.`,
      keep: 9,
    });
    c.told.add("comeback");
  } else if (lead?.kind === "late-winner" && c.goAhead?.play) {
    const line = playSentence(c, c.goAhead.play);
    if (line) {
      const when = c.goAhead.play.qtr >= 5 ? "in overtime" : clockLeft(c.goAhead.play.clock);
      out.push({ text: `${capital(line)} ${when}, and ${team(c, "W", "full")} ${c.pick("lw", ["beat", "edged"])} ${team(c, "L", "full")} ${score}${on}.`, keep: 9 });
      c.told.add("goahead");
    }
  } else if (lead?.kind === "upset" && c.input.odds?.favorite === c.L.code) {
    out.push({ text: `${capital(team(c, "W", "full"))} were ${c.input.odds.line}-point underdogs and beat ${team(c, "L", "full")} ${score}${ot}${on}.`, keep: 9 });
    c.told.add("upset");
  } else if (type === "defensive") {
    const punts = (c.input.drives ?? []).filter((d) => d.result === "punt").length;
    out.push({
      text: punts >= 10
        ? `In a game with ${punts} punts, ${beat}.`
        : `${capital(beat)} in a game that never got past ${c.total} combined points.`,
      keep: 9,
    });
  } else if (type === "shootout") {
    const yards = (c.W.stats?.totalYards ?? 0) + (c.L.stats?.totalYards ?? 0);
    out.push({
      text: yards >= 800
        ? `${capital(team(c, "W", "full"))} and ${team(c, "L", "full")} combined for ${c.total} points and ${yards} yards${on}, and ${c.W.city} had the last word, winning ${score}${ot}.`
        : `${capital(beat)} in a game with ${c.total} combined points.`,
      keep: 9,
    });
    c.told.add("shootout");
  } else {
    out.push({ text: `${capital(beat)}.`, keep: 9 });
  }

  // What it means: records and streaks, from the season's own results.
  let recordLine: Sentence | null = null;
  const rec = c.input.records;
  const wr = rec?.[c.W.side];
  const lr = rec?.[c.L.side];
  if (wr) {
    const r = (x: TeamRecord) => `${x.wins}-${x.losses}${x.ties ? `-${x.ties}` : ""}`;
    const streak = wr.streak >= 3 ? `, its ${ordinal(wr.streak)} straight win` : wr.streak === 1 && lr && lr.streak <= -3 ? "" : "";
    const lpart = lr ? (lr.streak <= -3 ? `; ${c.L.city} has lost ${word(-lr.streak)} straight` : `; ${c.L.city} fell to ${r(lr)}`) : "";
    const subject = c.input.divisional ? `The division win ${c.pick("rec", ["lifted", "moved"])} ${c.W.city} to` : `${c.W.city} ${c.pick("rec", ["improved to", "moved to"])}`;
    recordLine = { text: `${subject} ${r(wr)}${streak}${lpart}.`, keep: 7 };
  }

  // A second storyline that frames the rest: a quarterback lost early.
  const inj = picked.find((s) => s.kind === "injury" && s.injury && !c.told.has(`inj:${s.injury.who.full}`) && (s === lead || (s.injury.isQb && (s.injury.inj.qtr ?? 9) <= 2)));
  if (inj?.injury) {
    const h = inj.injury;
    const club = h.side === "W" ? c.W : c.L;
    const backupName = h.backup ? h.backup.name : null;
    if (h.partner && h.play?.sack && h.partner.who.full && c.name(h.play.sacker, h.play.def)?.full === h.partner.who.full) {
      out.push({
        text: `${club.city} lost ${call(c, h.who)} ${earlyPhrase(h)}, when ${call(c, h.partner.who)} sacked him. Both were hurt on the play and neither returned${backupName ? `; ${callName(c, backupName)} played the rest of the way` : ""}.`,
        keep: 8,
      });
      c.told.add(`inj:${h.partner.who.full}`);
    } else {
      out.push({ text: `${club.city} lost ${call(c, h.who)} to an injury ${earlyPhrase(h)}${backupName ? `, and ${callName(c, backupName)} played the rest of the way` : ""}.`, keep: 8 });
    }
    c.told.add(`inj:${h.who.full}`);
  }
  if (recordLine) out.push(recordLine);
  return out;
}

function earlyPhrase(h: InjuryStory): string {
  if (h.inj.teamDrive === 1) return "on the opening drive";
  return whenOf(h.inj.qtr ?? 1, h.inj.clock);
}

/** How the game unfolded, by kind of game. */
function development(c: Ctx, type: GameType, picked: Storyline[]): Sentence[] {
  const out: Sentence[] = [];
  const st = c.states;
  const wDrives = st.filter((s) => s.drive.team === c.W.code);
  const firstHalf = st.filter((s) => (s.drive.qtr ?? 0) <= 2);
  const scored = (s: DriveState) => s.drive.result === "td" || s.drive.result === "fg";
  const halfLine = c.half ? `${Math.max(c.half.w, c.half.l)}–${Math.min(c.half.w, c.half.l)}` : null;
  const cluster = picked.find((s) => s.kind === "turnovers")?.cluster ?? null;

  const longestTd = c.plays
    .filter((p) => p.td && p.tdTeam === c.W.code && p.pos === c.W.code && (p.yds ?? 0) >= 35)
    .sort((a, b) => (b.yds ?? 0) - (a.yds ?? 0))[0];

  if (type === "blowout") {
    // When the game got away: the run of scores that built the lead.
    const lStart = st.findIndex((s) => s.l > 0 && s.w === 0);
    const opener = lStart >= 0 && st[lStart]!.drive.team === c.L.code ? st[lStart]! : null;
    const fromIdx = opener ? lStart + 1 : 0;
    const halfW = firstHalf.slice(fromIdx).filter((s) => s.drive.team === c.W.code && s.drive.result !== "end_half");
    const tds = halfW.filter((s) => s.drive.result === "td");
    const long = halfW.find((s) => s.drive.result === "td" && driveClause(c, s));
    let s1 = "";
    if (opener && tds.length >= 2) {
      const how = opener.drive.result === "fg" ? "a field goal" : "a touchdown";
      s1 = `${c.L.city} ${c.pick("op", ["opened the scoring with", "struck first with", "took an early lead on"])} ${how}, but ${c.W.city} scored touchdowns on ${tds.length === halfW.length ? `all ${word(halfW.length)} of its` : `${word(tds.length)} of its ${word(halfW.length)}`} first-half possessions after that`;
    } else if (tds.length >= 2) {
      s1 = tds.length === halfW.length
        ? `${c.W.city} scored touchdowns on all ${word(halfW.length)} of its first-half possessions`
        : `${c.W.city} scored touchdowns on ${word(tds.length)} of its ${word(halfW.length)} first-half possessions`;
    }
    if (s1) {
      const bits: string[] = [];
      if (longestTd && longestTd.qtr <= 2) {
        const noun = playNoun(c, longestTd, true);
        if (noun) {
          bits.push(`${longestTd === tds[0]?.score ? "the first" : "one"} on ${noun}`);
          c.told.add(`play:${at(longestTd)}`);
        }
      }
      if (long && long.score !== longestTd) {
        const dc = driveClause(c, long);
        if (dc) bits.push(`${bits.length ? "another" : "one"} at the end of ${dc}`);
      }
      out.push({ text: `${s1}${bits.length ? `, ${bits.join(" and ")}` : ""}.`, keep: 8, at: 0 });
    }
    if (cluster) out.push(clusterSentence(c, cluster));
    const h2w = c.half ? c.W.score - c.half.w : 0;
    const h2l = c.half ? c.L.score - c.half.l : 0;
    if (!s1 && halfLine && c.half && c.half.w - c.half.l <= 7) {
      const htLead = c.half.w === c.half.l ? `It was tied ${halfLine} at halftime` : `${c.half.w > c.half.l ? c.W.city : c.L.city} led ${halfLine} at halftime`;
      out.push({
        text: c.half.w > c.half.l
          ? `${htLead}, and ${c.W.city} outscored ${c.L.city} ${h2w}–${h2l} in the second half.`
          : `${htLead} before ${c.W.city} outscored ${c.L.city} ${h2w}–${h2l} in the second half.`,
        keep: 8,
        at: 1800,
      });
    } else if (halfLine && c.half && c.half.w > c.half.l) {
      out.push({ text: c.pick("ht", [`It was ${halfLine} at halftime.`, `${c.W.city} took a ${halfLine} lead into halftime.`]), keep: 7, at: 1800 });
    }
    // The second half's first score, when it widened the gap.
    const after = st.find((s) => (s.drive.qtr ?? 0) >= 3 && s.drive.team === c.W.code && s.drive.result === "td" && s.score && !c.told.has(`play:${at(s.score)}`));
    if (after?.score) {
      const line = playSentence(c, after.score);
      if (line) {
        out.push({ text: `${capital(line)} ${when(after.score)} to make it ${after.w}–${after.l}.`, keep: 4, at: at(after.score) });
        c.told.add(`play:${at(after.score)}`);
      }
    }
    return inOrder(out);
  }

  if (type === "comeback") {
    const d = c.maxDeficit;
    if (d.at) {
      const q = d.at.score?.qtr ?? d.at.drive.qtr ?? 1;
      const qName = ["", "first", "second", "third", "fourth"][q] ?? "fourth";
      const lead = `${d.at.l}–${d.at.w}`;
      out.push({
        text: c.told.has("comeback")
          ? `${c.L.city} led ${lead} in the ${qName} quarter.`
          : `${c.L.city} ${c.pick("cbl", ["built", "opened"])} a ${lead} lead in the ${qName} quarter.`,
        keep: 8,
      });
      const idx = st.indexOf(d.at);
      const rest = st.slice(idx + 1);
      // The play that turned the rally, before the go-ahead score.
      const gaAt = c.goAhead?.play ? at(c.goAhead.play) : 99999;
      const turn = c.plays
        .filter((p) => at(p) > d.at!.start && at(p) < gaAt && c.wwp(p.wpAfter) - c.wwp(p.wpBefore) >= 80 && (p.pos === c.W.code ? p.td || (p.yds ?? 0) >= 20 : p.int || p.fumble))
        .sort((x, y) => c.wwp(y.wpAfter) - c.wwp(y.wpBefore) - (c.wwp(x.wpAfter) - c.wwp(x.wpBefore)))[0];
      const pts = c.W.score - d.at.w;
      const lpts = c.L.score - d.at.l;
      const wOff = rest.filter((s) => s.drive.team === c.W.code && scored(s));
      const returnTd = c.plays.some((p) => at(p) > d.at!.start && p.td && p.tdTeam === c.W.code && p.pos !== c.W.code);
      const poss = rest.filter((s) => s.drive.team === c.W.code && !["end_half", "end_game"].includes(s.drive.result)).length;
      out.push({
        text: `${c.W.city} outscored ${c.L.city} ${pts}–${lpts} from there${!returnTd && wOff.length >= 2 ? `, scoring on ${word(wOff.length)} of its last ${word(poss)} possessions` : ""}.`,
        keep: 7,
      });
      const timed: Sentence[] = [];
      if (cluster) timed.push(clusterSentence(c, cluster));
      if (turn && !c.told.has(`play:${at(turn)}`)) {
        // A takeaway in the cluster that came just before it set it up.
        const setUp = cluster && turn.td ? [...cluster].reverse().find((p) => p.def === c.W.code && at(p) < at(turn) && at(turn) - at(p) <= 300) : undefined;
        const noun = setUp ? playNoun(c, turn, true) : null;
        if (setUp && noun) {
          const i = cluster!.indexOf(setUp);
          timed.push({ text: `The ${ordinal(i + 1)} set up ${noun} ${when(turn)}.`, keep: 6, at: at(turn) });
          c.told.add(`play:${at(turn)}`);
        } else {
          const line = playSentence(c, turn);
          if (line) {
            timed.push({ text: `The ${c.pick("cbt", ["biggest swing", "turning point"])} came ${when(turn)}, when ${line}.`, keep: 6, at: at(turn) });
            c.told.add(`play:${at(turn)}`);
          }
        }
      }
      out.push(...timed.sort((x, y) => (x.at ?? 0) - (y.at ?? 0)));
    } else if (cluster) out.push(clusterSentence(c, cluster));
    goAheadSentence(c, out);
    return out;
  }

  if (type === "close" || type === "shootout") {
    if (halfLine && c.half) {
      const lead = c.half.w === c.half.l ? `The teams were tied ${halfLine} at halftime` : `${c.half.w > c.half.l ? c.W.city : c.L.city} led ${halfLine} at halftime`;
      const changes = c.leadChanges >= 2 ? `, and the lead changed hands ${times(c.leadChanges)}${c.ties ? ` with ${plural(c.ties, "tie", "ties")} along the way` : ""}` : "";
      out.push({ text: `${lead}${changes}.`, keep: 7 });
    }
    if (type === "shootout") {
      const tds = st.filter((s) => s.drive.result === "td").length;
      if (tds >= 8) out.push({ text: `The teams combined for ${word(tds) === String(tds) ? tds : word(tds)} touchdown drives, and only ${word(st.filter((s) => s.drive.result === "punt").length)} possessions ended in a punt.`, keep: 5 });
      if (longestTd && !c.told.has(`play:${at(longestTd)}`)) {
        const line = playSentence(c, longestTd);
        if (line) {
          out.push({ text: `The longest strike came ${when(longestTd)}, when ${line}.`, keep: 4 });
          c.told.add(`play:${at(longestTd)}`);
        }
      }
    }
    if (c.margin <= 8 && !lateSequence(c, out)) closestApproach(c, out);
    goAheadSentence(c, out);
    if (cluster) out.push(clusterSentence(c, cluster));
    return inOrder(out);
  }

  if (type === "defensive") {
    const punts = st.filter((s) => s.drive.result === "punt").length;
    const fgs = st.filter((s) => s.drive.result === "fg").length;
    const tds = st.filter((s) => s.drive.result === "td");
    const bits: string[] = [];
    if (fgs) bits.push(plural(fgs, "field goal", "field goals"));
    if (tds.length) bits.push(plural(tds.length, "touchdown", "touchdowns"));
    out.push({
      text: `The scoring came on ${join(bits)}${punts >= 8 && !c.told.has("punts") ? `, and ${word(punts) === String(punts) ? punts : word(punts)} possessions ended in punts` : ""}.`,
      keep: 6,
    });
    if (halfLine && c.half) out.push({ text: `${c.half.w === c.half.l ? `It was tied ${halfLine}` : `${c.half.w > c.half.l ? c.W.city : c.L.city} led ${halfLine}`} at halftime.`, keep: 6 });
    if (tds.length === 1 && tds[0]!.score) {
      const line = playSentence(c, tds[0]!.score);
      if (line) {
        out.push({ text: `The game's only touchdown came ${when(tds[0]!.score)}, when ${line}.`, keep: 7 });
        c.told.add(`play:${at(tds[0]!.score)}`);
      }
    } else goAheadSentence(c, out);
    if (cluster) out.push(clusterSentence(c, cluster));
    return out;
  }

  // standard
  const h2w = c.half ? c.W.score - c.half.w : 0;
  const h2l = c.half ? c.L.score - c.half.l : 0;
  if (halfLine && c.half && c.half.w - c.half.l <= 7 && h2w - h2l >= 10) {
    out.push({
      text: `${c.half.w === c.half.l ? `The teams were tied ${halfLine}` : `${c.half.w > c.half.l ? c.W.city : c.L.city} led ${halfLine}`} at halftime, and ${c.W.city} pulled away after the break, outscoring ${c.L.city} ${h2w}–${h2l}.`,
      keep: 7,
    });
  } else if (halfLine && c.half) {
    out.push({
      text: c.half.w > c.half.l
        ? `${c.W.city} led ${halfLine} at halftime.`
        : c.half.w === c.half.l
          ? `The teams were tied ${halfLine} at halftime.`
          : `${c.L.city} led ${halfLine} at halftime.`,
      keep: 6,
    });
  }
  const swing = [...c.plays]
    .filter((p) => p !== c.sealer && c.wwp(p.wpAfter) - c.wwp(p.wpBefore) >= 120 && (p.pos === c.W.code ? p.td || (p.type === "pass" || p.type === "run") : p.int || p.fumble))
    .sort((a, b) => c.wwp(b.wpAfter) - c.wwp(b.wpBefore) - (c.wwp(a.wpAfter) - c.wwp(a.wpBefore)))[0];
  if (swing && !c.told.has(`play:${at(swing)}`)) {
    const line = playSentence(c, swing);
    if (line) {
      out.push({ text: `The ${c.pick("turn", ["game turned", "biggest swing came"])} ${when(swing)}, when ${line}.`, keep: 6, at: at(swing) });
      c.told.add(`play:${at(swing)}`);
    }
  }
  goAheadSentence(c, out);
  if (cluster) out.push(clusterSentence(c, cluster));
  return inOrder(out);
}

/** Timed sentences in game order; untimed ones (halftime, totals) keep their place at the front. */
function inOrder(out: Sentence[]): Sentence[] {
  const head = out.filter((x) => x.at === undefined);
  const rest = out.filter((x) => x.at !== undefined);
  return [...head, ...rest.sort((x, y) => (x.at ?? 0) - (y.at ?? 0))];
}

/**
 * The late back-and-forth in a close game: the loser's last lead-taking (or
 * tying) score before the winner's go-ahead. "Cincinnati went ahead 27–24
 * early in the fourth quarter when ..."
 */
function lateSequence(c: Ctx, out: Sentence[]): boolean {
  const ga = c.goAhead;
  if (!ga) return false;
  const idx = c.states.indexOf(ga.state);
  const before = c.states.slice(0, idx).filter((s) => s.score && (s.drive.qtr ?? 0) >= 3);
  // The last score that put the loser ahead or level.
  const last = [...before].reverse().find((s) => s.l >= s.w && s.score && (s.drive.team === c.L.code || s.drive.defScore));
  if (!last?.score || c.told.has(`play:${at(last.score)}`) || (last.drive.qtr ?? 0) < 3) return false;
  const line = playSentence(c, last.score);
  if (!line) return false;
  const state = last.l > last.w ? `went ahead ${last.l}–${last.w}` : `tied it at ${last.l}`;
  out.push({ text: `${c.L.city} ${state} ${when(last.score)} when ${line}.`, keep: 6, at: at(last.score) });
  c.told.add(`play:${at(last.score)}`);
  return true;
}

/** The loser's last push in the second half: "Tampa Bay pulled within 33–27 when ...". */
function closestApproach(c: Ctx, out: Sentence[]): void {
  const late = c.states.filter((s) => (s.drive.qtr ?? 0) >= 3 && s.score && s.drive.team === c.L.code && s.w > s.l);
  const last = late[late.length - 1];
  if (!last?.score || last.w - last.l > 8 || c.told.has(`play:${at(last.score)}`)) return;
  const line = playSentence(c, last.score);
  if (!line) return;
  out.push({ text: `${c.L.city} pulled within ${last.w}–${last.l} ${when(last.score)} when ${line}, but got no closer.`, keep: 6, at: at(last.score) });
  c.told.add(`play:${at(last.score)}`);
}

/** The go-ahead score, with its drive when the drive is worth naming. */
function goAheadSentence(c: Ctx, out: Sentence[]): void {
  const ga = c.goAhead;
  if (!ga || c.told.has("goahead")) return;
  // A lead taken in the first quarter and kept is not a go-ahead moment worth telling.
  if ((ga.play?.qtr ?? ga.state.drive.qtr ?? 0) <= 1) return;
  const p = ga.play;
  if (!p || c.told.has(`play:${at(p)}`)) return;
  const line = playSentence(c, p);
  if (!line) return;
  const dc = driveClause(c, ga.state);
  const late = p.qtr >= 4;
  const score = `${ga.state.w}–${ga.state.l}`;
  const text = late
    ? `${capital(line)} ${p.qtr >= 5 ? (/^00:/.test(p.clock ?? "") ? `${clockLeft(p.clock)} in overtime` : "in overtime") : clockLeft(p.clock)}${dc ? `, finishing ${dc}` : ""}, to put ${c.W.city} ahead ${score} for good.`
    : `${capital(line)} ${when(p)}${dc ? `, finishing ${dc}` : ""}, and ${c.W.city} led the rest of the way.`;
  out.push({ text, keep: 8, at: at(p) });
  c.told.add("goahead");
  c.told.add(`play:${at(p)}`);
}

/** "Three interceptions in the last 5:53 of the half, two thrown by Goff, produced no points." */
function clusterSentence(c: Ctx, cluster: StoryPlay[]): Sentence {
  const ints = cluster.filter((p) => p.int).length;
  const fums = cluster.length - ints;
  const sides = new Set(cluster.map((p) => p.pos));
  const giver = sides.size === 1 ? ([...sides][0] === c.W.code ? c.W.city : [...sides][0] === c.L.code ? c.L.city : null) : null;
  const what = ints && fums ? `${word(cluster.length)} turnovers` : ints ? `${word(ints)} interceptions` : `${word(fums)} lost fumbles`;
  const first = cluster[0]!;
  const last = cluster[cluster.length - 1]!;
  const sameQ = first.qtr === last.qtr;
  const span = sameQ && first.qtr === 2 && at(last) >= 1500
    ? `in the final ${(first.clock ?? "").replace(/^0/, "")} of the first half`
    : sameQ
      ? `in a ${Math.max(2, Math.round((at(last) - at(first)) / 60))}-minute stretch of the ${["", "first", "second", "third", "fourth"][first.qtr] ?? ""} quarter`
      : `within ${word(Math.max(2, Math.round((at(last) - at(first)) / 60)))} minutes`;
  // Who threw them, when one passer threw more than one.
  const byPasser = new Map<string, number>();
  for (const p of cluster) if (p.int && p.passer) byPasser.set(`${p.pos}|${p.passer}`, (byPasser.get(`${p.pos}|${p.passer}`) ?? 0) + 1);
  const repeat = [...byPasser.entries()].find(([, k]) => k >= 2);
  const repeatWho = repeat ? c.name(repeat[0].split("|")[1]!, repeat[0].split("|")[0]!) : null;
  const repeatName = repeatWho ? call(c, repeatWho) : null;
  // Points off them: the next drive by the side that took the ball.
  let points = 0;
  for (const p of cluster) {
    const i = c.states.findIndex((s) => at(p) >= s.start && at(p) <= s.end);
    const next = c.states.slice(i + 1).find((s) => s.drive.team === p.def);
    if (p.td || (next && (next.drive.result === "td" || next.drive.result === "fg"))) points += 1;
  }
  c.told.add("turnovers");
  const taker = new Set(cluster.map((p) => p.def)).size === 1 ? (cluster[0]!.def === c.W.code ? c.W.city : cluster[0]!.def === c.L.code ? c.L.city : null) : null;
  const result = points === 0
    ? "and neither team scored off any of them"
    : taker
      ? `and ${taker} scored after ${points === cluster.length ? (points === 2 ? "both" : "all of them") : `${word(points)} of them`}`
      : points === cluster.length ? "and each one led to points" : `and ${word(points)} of them led to points`;
  if (repeatName && repeat![1] === cluster.length) {
    const whole = sameQ && at(last) - at(first) > 600 ? `in the ${["", "first", "second", "third", "fourth"][first.qtr] ?? ""} quarter` : span;
    return { text: `${capital(repeatName)} threw ${word(cluster.length)} interceptions ${whole}, ${result}.`.replace("and neither team scored off any of them", "though neither team scored off them"), keep: 7, at: at(first) };
  }
  if (!repeatName) {
    return {
      at: at(first),
      text: giver
        ? `${giver} turned the ball over ${times(cluster.length)} ${span}, ${result}.`
        : `The teams combined for ${what} ${span}, ${result}.`,
      keep: 6,
    };
  }
  return {
    at: at(first),
    text: `${capital(what)} came ${span}${repeatName ? `, ${repeat![1] === cluster.length ? "all" : `${word(repeat![1])} of them`} thrown by ${repeatName}` : ""}, ${result}.`,
    keep: 6,
  };
}

/** The players and figures that settled it. */
function decisive(c: Ctx, perfs: Performance[], picked: Storyline[]): Sentence[] {
  const out: Sentence[] = [];
  const ws = c.W.stats;
  const ls = c.L.stats;
  const stars = picked.filter((s) => s.kind === "star" && s.perf && s.perf.side === "W").map((s) => s.perf!);
  // A winner's star not picked as a storyline still earns a line when he is the reason.
  if (!stars.length && perfs[0]?.side === "W") stars.push(perfs[0]);

  for (const p of stars.slice(0, 2)) {
    const s = p.who.player!.stats;
    if (c.told.has(`perf:${p.key}`)) {
      // Already in the opening: add what the opening did not say.
      if (p.role === "runner" && ws?.rushYards != null && ws.rushYards >= 150 && ws.possessionSeconds != null && ls?.possessionSeconds != null && ws.possessionSeconds - ls.possessionSeconds >= 240) {
        out.push({ text: `${p.who.last} ${c.pick("carry", ["carried", "led"])} an offense that ran for ${ws.rushYards} yards and held the ball for ${mmss(ws.possessionSeconds)}.`, keep: 6 });
      } else if (p.role === "runner" && n(s.rushAtt) > 0) {
        out.push({ text: `${p.who.last} averaged ${(n(s.rushYds) / n(s.rushAtt)).toFixed(1)} yards on ${n(s.rushAtt)} carries.`, keep: 4 });
      }
      continue;
    }
    c.told.add(`perf:${p.key}`);
    out.push({ text: performanceSentence(c, p), keep: 7 });
  }

  // The passer who fed the stars, when he had a real day.
  const qb = Object.entries(c.input.players)
    .filter(([, p]) => p.team === c.W.code && n(p.stats.passAtt) >= 15)
    .sort(([, a], [, b]) => n(b.stats.passAtt) - n(a.stats.passAtt))[0];
  if (qb && !c.told.has(`perf:${qb[0]}`) && (n(qb[1].stats.passYds) >= 250 || n(qb[1].stats.passTd) >= 2 || out.length < 1)) {
    const s = qb[1].stats;
    const tds = n(s.passTd);
    const ints = n(s.passInt);
    const fav = scorersFor(c, qb[1].name);
    const name = callName(c, qb[1].name);
    const toFav = fav && tds >= 2 ? `, ${fav.count === tds ? (tds === 2 ? "both" : "all") : `${word(fav.count)} of them`} to ${callName(c, fav.name)}` : "";
    const picks = ints ? (toFav ? `, though he was intercepted ${times(ints)}` : ` but was intercepted ${times(ints)}`) : "";
    const body = tds ? `${name} threw for ${n(s.passYds)} yards and ${tdCount(tds)}${toFav}${picks}` : `${name} threw for ${n(s.passYds)} yards without a touchdown pass${picks.replace(" but was", ", and was")}`;
    out.push({ text: `${body}.`.replace(",,", ","), keep: stars.length ? 5 : 7 });
    c.told.add(`perf:${qb[0]}`);
  }

  // Each other's star receiver, briefly, when the opening named only one.
  const other = perfs.find((p) => p.side === "W" && !c.told.has(`perf:${p.key}`) && (p.role === "receiver" || p.role === "runner"));
  if (other && out.length < 3) {
    c.told.add(`perf:${other.key}`);
    out.push({ text: performanceSentence(c, other), keep: 6 });
  }

  // No star: the winner's leading rusher and receiver, when they carried real weight.
  if (out.length < 2) {
    const pool = Object.entries(c.input.players).filter(([k, p]) => p.team === c.W.code && !c.told.has(`perf:${k}`) && n(p.stats.passAtt) < 5);
    const rb = pool.filter(([, p]) => n(p.stats.rushYds) >= 70).sort(([, a], [, b]) => n(b.stats.rushYds) - n(a.stats.rushYds))[0];
    const wr = pool.filter(([k, p]) => k !== rb?.[0] && (n(p.stats.recYds) >= 80 || n(p.stats.recTd) >= 2)).sort(([, a], [, b]) => n(b.stats.recYds) - n(a.stats.recYds))[0];
    for (const [k, p] of [rb, wr].filter((x): x is [string, GamePlayer] => Boolean(x))) {
      const role = n(p.stats.rushYds) >= n(p.stats.recYds) ? "runner" : "receiver";
      const perf: Performance = { key: k, who: { key: k, full: p.name, last: lastOf(p.name), player: p }, side: "W", role, value: 0 };
      c.told.add(`perf:${k}`);
      out.push({ text: performanceSentence(c, perf), keep: 5 });
    }
  }

  // The defense, when it was a reason.
  const def = picked.find((s) => s.kind === "defense");
  if (ls && (def || (ls.sacked ?? 0) >= 4)) {
    const sacked = ls.sacked ?? 0;
    const tos = ls.turnovers ?? 0;
    const bits: string[] = [];
    if (sacked >= 3) bits.push(`sacked ${c.L.city} quarterbacks ${word(sacked)} times`);
    if (ls.thirdDown && ls.thirdDown.attempts >= 8 && ls.thirdDown.made / ls.thirdDown.attempts <= 0.35 && !c.told.has("third")) {
      bits.push(ls.thirdDown.made === 0 ? `did not allow a conversion on ${ls.thirdDown.attempts} third downs` : `allowed ${plural(ls.thirdDown.made, "conversion", "conversions")} on ${ls.thirdDown.attempts} third downs`);
      c.told.add("third");
    }
    const starInts = perfs.filter((p) => p.side === "W" && p.role === "defender").reduce((a, p) => a + n(p.who.player?.stats.defInt), 0);
    if (tos >= 2 && (ws?.turnovers ?? 0) < tos && !c.told.has("turnovers") && starInts < tos) bits.push(`forced ${word(tos)} turnovers`);
    if (bits.length) out.push({ text: `${possessive(c.W.city)} defense ${join(bits)}.`, keep: 6 });
  }

  // A winning defender's big day.
  const d = perfs.find((p) => p.side === "W" && p.role === "defender" && !c.told.has(`perf:${p.key}`));
  if (d) {
    out.push({ text: `${d.who.full} ${statLine(d)}.`, keep: 5 });
    c.told.add(`perf:${d.key}`);
  }

  // A turnover edge, when nothing above said it.
  if (ws && ls && ws.turnovers != null && ls.turnovers != null && ls.turnovers - ws.turnovers >= 2 && !c.told.has("turnovers") && !out.some((s) => /turnover|intercept/.test(s.text))) {
    c.told.add("turnovers");
    out.push({ text: `${c.W.city} forced ${word(ls.turnovers)} turnovers and ${ws.turnovers ? `gave the ball away ${word(ws.turnovers)} ${ws.turnovers === 1 ? "time" : "times"}` : "did not commit one"}.`, keep: 6 });
  }
  return out;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** "including a 56-yard touchdown catch in the first quarter", the player's longest stored play. */
function longestBy(c: Ctx, p: Performance): string | null {
  const plays = c.plays.filter((x) => {
    if (x.pos !== p.who.player?.team) return false;
    const r = x.type === "pass" ? c.name(x.receiver, x.pos) : x.type === "run" ? c.name(x.rusher, x.pos) : null;
    // Never a gain that ended in a lost fumble or interception: "a 48-yard catch" that was fumbled away misleads.
    return r?.key === p.key && (x.yds ?? 0) >= 25 && !x.fumble && !x.int;
  });
  const best = plays.sort((a, b) => (b.yds ?? 0) - (a.yds ?? 0))[0];
  if (!best || c.told.has(`play:${at(best)}`)) return null;
  c.told.add(`play:${at(best)}`);
  const kind = best.type === "pass" ? (best.td ? "touchdown catch" : "catch") : best.td ? "touchdown run" : "run";
  return `including ${aYards(best.yds)} ${kind} ${when(best)}`;
}

/** The receiver a passer threw the most touchdowns to, when one caught two or more. */
function scorersFor(c: Ctx, passer: string): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const p of c.plays) {
    if (!(p.td && p.type === "pass" && p.pos === c.W.code)) continue;
    const qb = c.name(p.passer, p.pos);
    if (qb?.full !== passer) continue;
    const rec = c.name(p.receiver, p.pos);
    if (rec) counts.set(rec.full, (counts.get(rec.full) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  return best && best[1] >= 2 ? { name: best[0], count: best[1] } : null;
}

/** "Amon-Ra St. Brown caught four passes for 98 yards and two touchdowns, including ..." */
function performanceSentence(c: Ctx, p: Performance): string {
  const long = longestBy(c, p);
  return `${call(c, p.who)} ${statLine(p)}${long ? `, ${long}` : ""}.`;
}

/** The loser's side, and how it ended. */
function conclusion(c: Ctx, type: GameType, hurt: InjuryStory[]): Sentence[] {
  const out: Sentence[] = [];
  const ls = c.L.stats;
  const st = c.states;
  const lDrives = st.filter((s) => s.drive.team === c.L.code);
  const punts = lDrives.filter((s) => s.drive.result === "punt").length;
  const qbLost = hurt.find((h) => h.side === "L" && h.isQb && (h.inj.qtr ?? 9) <= 2);

  // Why the loser's offense stalled, with the cause first when we know it.
  if (ls && ls.yardsPerPlay != null && (ls.yardsPerPlay <= 4.5 || (ls.totalYards ?? 999) <= 260)) {
    const parts: string[] = [];
    const backup = qbLost?.backup;
    if (backup && n(backup.stats.passAtt) >= 10) {
      const s = backup.stats;
      parts.push(`${callName(c, backup.name)} completed ${n(s.passCmp)} of ${n(s.passAtt)} passes for ${n(s.passYds)} yards`);
    }
    parts.push(`${parts.length ? `the ${c.L.nick}` : c.L.city} averaged ${ls.yardsPerPlay.toFixed(1)} yards per play`);
    if (punts >= 6 && !c.told.has("punts")) {
      parts.push(`${parts.length >= 2 ? "they" : `the ${c.L.nick}`} punted ${punts >= 10 ? punts : word(punts)} times`);
      c.told.add("punts");
    }
    if (ls.thirdDown && ls.thirdDown.attempts >= 8 && ls.thirdDown.made / ls.thirdDown.attempts <= 0.35 && !c.told.has("third")) {
      parts.push(ls.thirdDown.made === 0 ? `${parts.length >= 2 ? "they" : `the ${c.L.nick}`} failed on all ${ls.thirdDown.attempts} third downs` : `${parts.length >= 2 ? "they" : `the ${c.L.nick}`} converted ${word(ls.thirdDown.made)} of ${ls.thirdDown.attempts} third downs`);
      c.told.add("third");
    }
    const lead = qbLost && c.told.has(`inj:${qbLost.who.full}`) ? `Without ${qbLost.who.last}, ${c.L.city} could not sustain drives. ` : "";
    if (parts.length >= 2 || ls.yardsPerPlay <= 3.5) out.push({ text: `${lead}${capital(join(parts))}.`, keep: 8 });
  } else if (ls && type !== "close" && type !== "comeback") {
    const tos = ls.turnovers ?? 0;
    if (tos >= 3 && !c.told.has("turnovers")) out.push({ text: `${c.L.city} turned the ball over ${word(tos)} times.`, keep: 5 });
  }

  // The loser's best day, in a game close enough or wild enough for it to matter.
  {
    const lp = Object.entries(c.input.players)
      .filter(([k, p]) => p.team === c.L.code && !c.told.has(`perf:${k}`))
      .map(([k, p]) => {
        const s = p.stats;
        const close = c.margin <= 3;
        const near = c.margin <= 8 || type === "shootout";
        // A loser's day earns a line in any game when it was big; in a close one, sooner.
        const passBar = close ? 230 : near ? 275 : 320;
        const scrimBar = close ? 90 : near ? 110 : 140;
        const v = n(s.passAtt) >= 10
          ? (n(s.passYds) >= passBar || n(s.passTd) >= (close ? 2 : near ? 3 : 4) ? n(s.passYds) / 300 + n(s.passTd) * 0.3 : 0)
          : (n(s.rushYds) + n(s.recYds) >= scrimBar || (near && n(s.rushTd) + n(s.recTd) >= 2) ? (n(s.rushYds) + n(s.recYds)) / 140 + (n(s.rushTd) + n(s.recTd)) * 0.4 : 0);
        return { k, p, v };
      })
      .filter((x) => x.v > 0)
      .sort((x, y) => y.v - x.v)[0];
    if (lp) {
      const s = lp.p.stats;
      const role = n(s.passAtt) >= 10 ? "passer" : n(s.rushYds) >= n(s.recYds) ? "runner" : "receiver";
      const perf: Performance = { key: lp.k, who: { key: lp.k, full: lp.p.name, last: lastOf(lp.p.name), player: lp.p }, side: "L", role, value: lp.v };
      c.told.add(`perf:${lp.k}`);
      out.push({ text: `For ${c.L.city}, ${call(c, perf.who)} ${statLine(perf, false)}.`, keep: 5 });
    }
  }

  // Other injuries that cost a side for the rest of the game.
  for (const h of hurt) {
    if (c.told.has(`inj:${h.who.full}`)) continue;
    const club = h.side === "W" ? c.W : c.L;
    const also = [...c.told].some((k) => k.startsWith("inj:")) ? "also " : "";
    out.push({ text: `${club.city} ${also}lost ${call(c, h.who)} to an injury ${whenOf(h.inj.qtr ?? 1, h.inj.clock)}${h.isQb ? "" : ""}, and he did not return.`, keep: h.isQb ? 6 : 5 });
    c.told.add(`inj:${h.who.full}`);
    if (out.length >= 3) break;
  }

  // How it ended.
  if (type === "blowout" || c.margin >= 14) {
    const lastL = [...st].reverse().find((s) => s.drive.team === c.L.code && s.drive.result === "td");
    const lTds = lDrives.filter((s) => s.drive.result === "td").length;
    if (lastL?.score && lTds === 1 && lastL.w - lastL.l + 7 >= 17) {
      const noun = playNoun(c, lastL.score);
      if (noun) out.push({ text: `${possessive(c.L.city)} only touchdown, ${noun} ${when(lastL.score)}, came with the game decided.`, keep: 5 });
    } else if (lTds === 0 && c.L.score > 0) {
      out.push({ text: `${c.L.city} never reached the end zone.`, keep: 5 });
    }
  } else if (c.sealer) {
    const who = c.name(c.sealer.interceptor, c.W.code);
    if (c.sealer.int && who) out.push({ text: `${possessive(call(c, who))} ${c.sealer.endZone ? "end-zone " : ""}interception ${when(c.sealer)} ended ${possessive(c.L.city)} last chance.`, keep: 7 });
    else if (c.sealer.fumble) out.push({ text: `${c.W.city} recovered a fumble ${when(c.sealer)} to end ${possessive(c.L.city)} last chance.`, keep: 7 });
  } else {
    // The loser's last real possession.
    const last = [...st].reverse().find((s) => s.drive.team === c.L.code && s.drive.result !== "end_game" && s.drive.result !== "end_half");
    if (last && (last.drive.qtr ?? 0) >= 4 && c.margin <= 8) {
      const how: Record<string, string> = {
        downs: "turned the ball over on downs",
        punt: "ended in a punt",
        int: "ended in an interception",
        fumble: "ended in a lost fumble",
        missed_fg: "ended with a missed field goal",
      };
      const what = how[last.drive.result];
      if (what) out.push({ text: `${possessive(c.L.city)} final possession ${what.startsWith("turned") ? `ended when the ${c.L.nick} ${what}` : what}${last.drive.start ? ` after starting at the ${last.drive.start.replace(/^([A-Z]+) (\d+)$/, (_m, t, y) => (t === c.L.code ? `${c.L.city} ${y}` : `${c.W.city} ${y}`))}` : ""}.`, keep: 6 });
    }
  }
  return out;
}

/* ------------------------------------------------------------ headline */

function headlineFor(c: Ctx, type: GameType, picked: Storyline[]): string {
  const lead = picked[0];
  const score = `${c.W.score}–${c.L.score}`;
  const ot = c.ot ? " in OT" : "";
  const W = c.W.nick;
  const L = c.L.nick;
  if (lead?.kind === "star" && lead.perf?.side === "W") {
    const verb = type === "blowout" ? "rout" : type === "comeback" ? "rally past" : type === "close" ? "edge" : "beat";
    return `${lead.perf.who.last} ${headlineFigure(lead.perf)} as ${W} ${verb} ${L} ${score}${ot}`;
  }
  if (lead?.kind === "comeback") return `${W} rally from ${c.maxDeficit.size} down to beat ${L} ${score}${ot}`;
  if (lead?.kind === "late-winner" && c.goAhead?.play) {
    const p = c.goAhead.play;
    const who = p.fg === "made" ? c.name(p.kicker, p.pos) : p.type === "pass" ? c.name(p.receiver, p.pos) : c.name(p.rusher, p.pos);
    const what = p.fg === "made" ? `late field goal` : p.type === "pass" ? "late touchdown catch" : "late touchdown run";
    if (who) return `${possessive(who.last)} ${p.qtr >= 5 ? what.replace("late ", "") + " in OT" : what} lifts ${W} past ${L} ${score}`.replace(" in OT in OT", " in OT");
  }
  if (lead?.kind === "upset") return `Underdog ${W} beat ${L} ${score}${ot}`;
  if (lead?.kind === "injury" && lead.injury) {
    const h = lead.injury;
    return h.side === "W" ? `${W} beat ${L} ${score} without ${h.who.last}` : `${W} beat ${L} ${score} after ${h.who.last} exits early`;
  }
  if (type === "defensive") return `${W} grind out ${score} win over ${L}`;
  if (type === "shootout") return `${W} outlast ${L} ${score}${ot}`;
  if (type === "blowout") return `${W} rout ${L} ${score}`;
  return `${W} beat ${L} ${score}${ot}`;
}

/* --------------------------------------------------------------- main */

/** Fits a set of sentence groups to the word budget, dropping the lowest keep first. */
function fit(groups: Sentence[][], max = 260): string[] {
  const words = () => groups.flat().reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  while (words() > max) {
    let lowest: { g: number; i: number; keep: number } | null = null;
    groups.forEach((g, gi) =>
      g.forEach((s, si) => {
        if (!lowest || s.keep < lowest.keep) lowest = { g: gi, i: si, keep: s.keep };
      }),
    );
    if (!lowest || (lowest as { keep: number }).keep >= 9) break;
    const l = lowest as { g: number; i: number };
    groups[l.g]!.splice(l.i, 1);
  }
  return groups.map((g) => g.map((s) => s.text).join(" ")).filter(Boolean);
}

export function composeRecap(input: NarrativeInput): Narrative | null {
  const c = buildCtx(input);
  if (!c) return null;
  const perfs = performances(c);
  const hurt = injuries(c);
  const picked = choose(storylines(c, perfs, hurt));
  const type = gameType(c, picked);

  const p1 = opening(c, type, picked);
  const p2 = development(c, type, picked);
  const p3 = decisive(c, perfs, picked);
  const p4 = conclusion(c, type, hurt);

  // Short games: development and decisive read as one paragraph.
  const groups = [p1, p2, p3, p4].filter((g) => g.length);
  const paragraphs = fit(groups).map((p) => p.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim());
  return {
    headline: headlineFor(c, type, picked),
    paragraphs,
    storylines: picked.map((s) => (s.perf ? `star:${s.perf.who.full}` : s.injury ? `injury:${s.injury.who.full}` : s.kind)),
    gameType: type,
  };
}

/* -------------------------------------------------- the facts packet */

/**
 * Everything the recap may say about one game, as plain checked facts, for
 * the offline writing step (scripts/matchup/writeRecaps.mjs, mak 2026-11-17:
 * "build it"). A writer, human or model, may choose among these and word
 * them; it may not add to them. `data` is the evidence and is what the hash
 * covers; `storylines` and `draft` are the engine's reading of it.
 */
export interface RecapFacts {
  gameId: string;
  data: {
    game: {
      day: string;
      date: string | null;
      week: string;
      /** Stadium and city, with neutral = an international or other neutral-site game. */
      venue: { name: string; city: string | null; neutral: boolean } | null;
      overtime: boolean;
      divisional: boolean;
      winner: string;
      loser: string;
      final: string;
      margin: number;
      combinedPoints: number;
      halftime: string | null;
      secondHalf: string | null;
      combinedYards: number | null;
      combinedPunts: number;
      byQuarter: Record<string, number[] | null>;
    };
    teams: Record<string, { city: string; nickname: string; name: string; score: number; recordAfter: string | null; streakAfter: string | null }>;
    /** Every score in order, with the score after its drive. */
    scoring: string[];
    turnovers: string[];
    /** Non-scoring gains of 20+ through the air, 15+ on the ground. */
    bigPlays: string[];
    /** Runs of 10+ unanswered points. */
    scoringRuns: string[];
    /** Each team's last possession that did not end with the clock (a final kneel-down or clock-out drive is not counted). */
    finalPossessions: string[];
    injuries: string[];
    players: Array<{ name: string; team: string; pos: string | null; line: string }>;
    teamStats: Record<string, Record<string, string | number>>;
    /** Present only when the line is part of the story (an upset or a big miss). */
    closingLine: string | null;
  };
  gameType: GameType;
  /** Every candidate storyline, ranked, with the engine's verified sentence(s). */
  storylines: Array<{ rank: number; kind: string; importance: number; about: string }>;
  draft: { headline: string; paragraphs: string[] };
}

const recentFacts = new Map<string, RecapFacts>();
/** The last packet rendered for a game in this process, for the guarded facts route. */
export function renderedFacts(gameId: string): RecapFacts | null {
  return recentFacts.get(gameId) ?? null;
}

function qClock(qtr: number, clock: string | null): string {
  return `${qtr >= 5 ? "OT" : `Q${qtr}`} ${(clock ?? "").replace(/^0/, "")}`.trim();
}

export function recapFacts(input: NarrativeInput, gameId: string): RecapFacts | null {
  const draft = composeRecap(input);
  const c = buildCtx(input);
  if (!draft || !c) return null;
  const { game, story } = input;
  const perfs = performances(c);
  const hurt = injuries(c);
  const ranked = storylines(c, perfs, hurt);
  const type = gameType(c, choose(ranked));
  // Fresh name state for each phrase: the packet names everyone in full.
  const fresh = () => {
    c.named.clear();
    return c;
  };

  const scoring: string[] = [];
  for (const p of c.plays.filter((x) => x.td || x.fg === "made").sort((x, y) => at(x) - at(y))) {
    let s: DriveState | null = null;
    for (const x of c.states) if (x.start <= at(p)) s = x;
    const by = p.td ? p.tdTeam : p.pos;
    const defensive = p.td && p.tdTeam !== p.pos;
    const what = p.fg === "made"
      ? `${c.name(p.kicker, p.pos)?.full ?? "kicker"} ${p.kickDistance ?? "?"}-yard field goal`
      : defensive
        ? `${playSentence(fresh(), p) ?? "defensive touchdown"}`
        : `${playNoun(fresh(), p, true) ?? playSentence(fresh(), p) ?? "touchdown"}`;
    const drive = s && !defensive && s.drive.team === by && s.drive.plays != null && s.drive.yards != null && s.drive.plays > 0
      ? ` (drive: ${s.drive.plays} plays, ${s.drive.yards} yards${s.drive.start ? `, started at ${s.drive.start}` : ""})`
      : "";
    // The score after the drive (extra point or two-point try included); the play's own score when no drive holds it.
    const after = s && s.drive.away != null && s.drive.home != null && s.drive.away + s.drive.home >= (p.awayScore ?? 0) + (p.homeScore ?? 0)
      ? `${game.away.abbr} ${s.drive.away}, ${game.home.abbr} ${s.drive.home}`
      : `${game.away.abbr} ${p.awayScore}, ${game.home.abbr} ${p.homeScore} before the try`;
    scoring.push(`${qClock(p.qtr, p.clock)} ${by}: ${what}${drive}`.replace(/\.$/, "") + `. Score after: ${after}`);
  }

  const turnovers = c.plays
    .filter((p) => p.int || p.fumble)
    .map((p) => {
      const i = c.states.findIndex((s) => at(p) >= s.start && at(p) <= s.end);
      const next = c.states.slice(i + 1).find((s) => s.drive.team === p.def);
      const after = p.td ? "returned for a touchdown" : next ? `next ${p.def} possession: ${next.drive.result}` : "no possession followed";
      let what = playSentence(fresh(), p) ?? (p.int ? "interception" : "lost fumble");
      if (p.fumble && !p.int) {
        const carrier = p.type === "pass" ? c.name(p.receiver, p.pos) : p.type === "run" ? c.name(p.rusher, p.pos) : null;
        const qb = p.sack ? c.name(p.passer, p.pos) : null;
        if (qb) what = `${qb.full} fumbled on a sack; ${p.def} recovered`;
        else if (carrier) what = `${carrier.full} fumbled after ${p.type === "pass" ? `a ${p.yds}-yard catch` : `a ${p.yds}-yard run`}; ${p.def} recovered`;
      }
      return `${qClock(p.qtr, p.clock)} ${p.pos} turnover: ${what}${p.td ? "" : ""} (${after})`;
    });

  const bigPlays = c.plays
    .filter((p) => !p.td && !p.int && !p.fumble && !p.fg && ((p.type === "pass" && (p.yds ?? 0) >= 20) || (p.type === "run" && (p.yds ?? 0) >= 15)))
    .map((p) => `${qClock(p.qtr, p.clock)} ${p.pos}: ${playSentence(fresh(), p) ?? `${p.yds}-yard play`}`);

  // Unanswered runs, from the drive scores.
  const scoringRuns: string[] = [];
  {
    let team: string | null = null;
    let pts = 0;
    let from: DriveState | null = null;
    let prev = { a: 0, h: 0 };
    const flush = (until: DriveState | null) => {
      if (team && pts >= 10 && from) {
        scoringRuns.push(`${team} scored ${pts} unanswered points (from Q${from.drive.qtr} to ${until ? `Q${until.drive.qtr}` : "the end"})`);
      }
    };
    for (const s of c.states) {
      const a = s.drive.away ?? 0;
      const h = s.drive.home ?? 0;
      const da = a - prev.a;
      const dh = h - prev.h;
      prev = { a, h };
      if (!da && !dh) continue;
      const scorer = da > 0 ? game.away.abbr : game.home.abbr;
      if (scorer === team) pts += da + dh;
      else {
        flush(s);
        team = scorer;
        pts = da + dh;
        from = s;
      }
    }
    flush(null);
  }

  const inj = story.injuries
    .filter((x) => x.team)
    .map((x) => {
      const who = c.name(x.player, x.team);
      const h = hurt.find((y) => y.inj === x);
      const play = x.playId != null ? c.plays.find((p) => p.playId === x.playId) : undefined;
      const sacker = play?.sack && play.sacker ? c.name(play.sacker, play.def)?.full ?? play.sacker : null;
      const passer = play?.passer ? c.name(play.passer, play.pos)?.full ?? play.passer : null;
      const onPlay = !sacker
        ? ""
        : sacker === who?.full
          ? `; hurt on the play on which he sacked ${passer ?? "the quarterback"} (same play id)`
          : `; hurt on a sack by ${sacker} (same play id)`;
      return `${x.team} ${who?.full ?? x.player}${who?.player?.pos ? ` (${who.player.pos})` : ""} injured ${qClock(x.qtr ?? 1, x.clock)}${x.teamDrive === 1 ? " on his team's opening drive" : ""}${onPlay}; ${x.returned ? "returned" : "did not return"}${h?.backup ? `; ${h.backup.name} took over at quarterback` : ""}`;
    });

  const players: RecapFacts["data"]["players"] = [];
  for (const p of Object.values(input.players)) {
    const s = p.stats;
    const bits: string[] = [];
    if (n(s.passAtt) >= 5) bits.push(`${n(s.passCmp)}/${n(s.passAtt)} passing, ${n(s.passYds)} yds, ${n(s.passTd)} TD, ${n(s.passInt)} INT`);
    if (n(s.rushAtt) >= 3 && (n(s.rushYds) >= 40 || n(s.rushTd))) bits.push(`${n(s.rushAtt)} rushes, ${n(s.rushYds)} yds (${(n(s.rushYds) / n(s.rushAtt)).toFixed(1)} per carry), ${n(s.rushTd)} TD`);
    if (n(s.recYds) >= 25 || n(s.rec) >= 3 || n(s.recTd)) bits.push(`${n(s.rec)} catches on ${n(s.recTgt)} targets, ${n(s.recYds)} yds, ${n(s.recTd)} TD`);
    if (n(s.rushYds) > 0 && n(s.recYds) > 0 && n(s.rushYds) + n(s.recYds) >= 60) bits.push(`${n(s.rushYds) + n(s.recYds)} scrimmage yds`);
    if (n(s.sacks) >= 1 || n(s.defInt) || n(s.defTd)) bits.push(`${n(s.sacks)} sacks, ${n(s.defInt)} INT, ${n(s.defTd)} defensive TD, ${n(s.soloTkl) + n(s.astTkl)} tackles`);
    if (n(s.fgm) || n(s.fga)) bits.push(`${n(s.fgm)}/${n(s.fga)} field goals${s.fgLong ? `, long ${s.fgLong}` : ""}`);
    // The position only where the line is an offensive one: the dictionary
    // fallback can mislabel a defender who shares a receiver's name.
    const offense = n(s.passAtt) + n(s.rushAtt) + n(s.rec) + n(s.fga) > 0;
    if (bits.length) players.push({ name: p.name, team: p.team, pos: offense ? p.pos : null, line: bits.join("; ") });
  }

  const stat = (b: BoxTeamStats | null, code: string): Record<string, string | number> => {
    if (!b) return {};
    const punts = c.states.filter((s) => s.drive.team === code && s.drive.result === "punt").length;
    const out: Record<string, string | number> = {};
    const put = (k: string, v: string | number | null | undefined) => {
      if (v !== null && v !== undefined) out[k] = v;
    };
    put("total yards", b.totalYards);
    put("yards per play", b.yardsPerPlay != null ? b.yardsPerPlay.toFixed(1) : null);
    put("passing yards", b.passYards);
    put("rushing yards", b.rushYards);
    put("rushing attempts", b.rushAttempts);
    put("turnovers", b.turnovers);
    put("times sacked", b.sacked);
    put("third downs", b.thirdDown ? `${b.thirdDown.made} of ${b.thirdDown.attempts}` : null);
    put("red zone", b.redZone ? `${b.redZone.made} of ${b.redZone.attempts}` : null);
    put("time of possession", b.possessionSeconds != null ? mmss(b.possessionSeconds) : null);
    put("punts", punts);
    return out;
  };

  const rec = input.records;
  const recLine = (s: Side) => {
    const r = rec?.[s];
    return r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : null;
  };
  const streak = (s: Side) => {
    const r = rec?.[s];
    if (!r || Math.abs(r.streak) < 2) return null;
    return `${Math.abs(r.streak)} straight ${r.streak > 0 ? "wins" : "losses"}`;
  };
  const team = (s: Side) => ({
    city: input.city[s],
    nickname: game[s].short,
    name: game[s].name,
    score: s === "home" ? story.homeFinal : story.awayFinal,
    recordAfter: recLine(s),
    streakAfter: streak(s),
  });
  const upset = ranked.find((s) => s.kind === "upset");
  const odds = input.odds;

  // The engine's sentence for each storyline, in a fresh context.
  const about = (s: Storyline): string => {
    const cc = buildCtx(input)!;
    if (s.perf) return `${s.perf.who.full} (${s.perf.side === "W" ? c.W.code : c.L.code}) ${statLine(s.perf)}`;
    if (s.injury) return `${s.injury.who.full} (${s.injury.side === "W" ? c.W.code : c.L.code}${s.injury.isQb ? ", QB" : ""}) injured ${qClock(s.injury.inj.qtr ?? 1, s.injury.inj.clock)}, did not return`;
    if (s.cluster) return clusterSentence(cc, s.cluster).text;
    switch (s.kind) {
      case "comeback": return `${c.W.city} trailed by as many as ${c.maxDeficit.size} (${c.maxDeficit.at ? `${c.maxDeficit.at.l}-${c.maxDeficit.at.w}` : ""}) and won`;
      case "late-winner": return c.goAhead?.play ? `go-ahead score ${qClock(c.goAhead.play.qtr, c.goAhead.play.clock)}: ${playSentence(cc, c.goAhead.play)}` : "late go-ahead score";
      case "back-and-forth": return `${c.leadChanges} lead changes, ${c.ties} ties`;
      case "line-of-scrimmage": return `${c.W.city} outgained ${c.L.city} ${c.W.stats?.totalYards}-${c.L.stats?.totalYards}`;
      case "defense": return `${c.L.city} held to ${c.L.stats?.totalYards} yards, sacked ${c.L.stats?.sacked ?? 0} times`;
      case "upset": return odds ? `${odds.favorite} was favored by ${odds.line}; final margin ${c.margin} the other way or far beyond the line` : "unexpected result";
      case "shootout": return `${c.total} combined points`;
      case "return-td": return "a defensive or return touchdown";
      default: return s.kind;
    }
  };

  const facts: RecapFacts = {
    gameId,
    data: {
      game: {
        day: c.day,
        date: game.kickoff,
        week: game.roundLabel,
        venue: game.venue ? { name: game.venue.name, city: game.venue.city, neutral: game.venue.neutral } : null,
        overtime: c.ot,
        divisional: Boolean(input.divisional),
        winner: c.W.code,
        loser: c.L.code,
        final: `${c.W.code} ${c.W.score}, ${c.L.code} ${c.L.score}`,
        margin: c.margin,
        combinedPoints: c.total,
        halftime: c.half ? `${c.W.code} ${c.half.w}, ${c.L.code} ${c.half.l}` : null,
        secondHalf: c.half ? `${c.W.code} ${c.W.score - c.half.w}, ${c.L.code} ${c.L.score - c.half.l}` : null,
        combinedYards: c.W.stats?.totalYards != null && c.L.stats?.totalYards != null ? c.W.stats.totalYards + c.L.stats.totalYards : null,
        combinedPunts: c.states.filter((x) => x.drive.result === "punt").length,
        byQuarter: { [game.away.abbr]: game.away.quarters, [game.home.abbr]: game.home.quarters },
      },
      teams: { [game.away.abbr]: team("away"), [game.home.abbr]: team("home") },
      scoring,
      turnovers,
      bigPlays,
      scoringRuns,
      finalPossessions: [c.W.code, c.L.code].map((code) => {
        const last = [...c.states].reverse().find((x) => x.drive.team === code && x.drive.result !== "end_game" && x.drive.result !== "end_half");
        return last ? `${code} last possession that did not end with the half or game clock running out: started Q${last.drive.qtr} ${(last.drive.clock ?? "").replace(/^0/, "")} at ${last.drive.start ?? "?"}, ${last.drive.plays ?? "?"} plays, ${last.drive.yards ?? "?"} yards, result ${last.drive.result}` : `${code} final possession: none`;
      }),
      injuries: inj,
      players,
      teamStats: { [c.W.code]: stat(c.W.stats, c.W.code), [c.L.code]: stat(c.L.stats, c.L.code) },
      closingLine: upset && odds?.favorite ? `${odds.favorite} favored by ${odds.line} (closing line)` : null,
    },
    gameType: type,
    storylines: ranked.map((s, i) => ({ rank: i + 1, kind: s.kind, importance: Math.round(s.score), about: about(s) })),
    draft: { headline: draft.headline, paragraphs: draft.paragraphs },
  };
  recentFacts.set(gameId, facts);
  return facts;
}

/** A stable fingerprint of the evidence: stored prose is shown only while it matches. */
export function factsHash(facts: RecapFacts): string {
  const s = JSON.stringify(facts.data);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 2246822519);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}
