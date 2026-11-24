/**
 * The completed game's Overview tab in the new design (mak, 2026-11-07):
 * "What happened, why the winning team won, who made the difference, and how
 * the game changed." Five cards, in mak's order:
 *
 *   Game recap        a headline and two paragraphs of football story
 *   Why {team} won    three figures and the sentence that explains them
 *   How the game swung  the real play-by-play win probability + moments
 *   Game leaders      passing, rushing, receiving, defense
 *   Game highlights   the highlights video already on the page
 *
 * Every sentence is built from stored data - the game story store
 * (data/matchup/game_story_<season>.json, scripts/matchup/buildGameStory.mjs,
 * nflverse play-by-play) and the box score - with rules, never a model call
 * ([[no-paid-model-calls]]). A claim the data cannot back is left out: no
 * story store for the game means no Overview, and the page keeps the
 * previous Recap tab.
 *
 * Team stats and the scoring summary move to their own tabs in the new
 * design (matchup-render.ts recapTabs).
 */

import { railHead } from "./rail-head";
import type { ForcedFumble, StoryAdvanced } from "./box-score";
import { escapeHtml, searchKey } from "../render";
import { dataPath } from "../data-dir";
import { readDataJson } from "../team/read-json";
import type { BoxTeamStats } from "./boxscore";
import { playCalling } from "./possessions";
import type { GamePlayer, GamePlayers } from "./game-players";
import type { LeaderPick } from "./leaders-strip";
import { scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";
import { BAR_ICON } from "./recap-premium";
import type { GameOdds } from "./boxscore";
import type { GamePbp, PbpDrive } from "./play-by-play";
import { downText, halftimeLeadHeld, isFinalScore, leadHeldToFinal, scoreBefore, spotText, storyPlayFacts, type StoryPlayFacts } from "./play-facts";
import type { ScoringPlay } from "./scoring-plays";
import { composeRecap, factsHash, recapFacts, resolver, type TeamRecord } from "./recap-narrative";
import type { PlayerUrlFn } from "../team/links";

const e = escapeHtml;

/* --------------------------------------------------------------- store */

export interface StoryPlay {
  /** nflverse's play_id; absent in a store built before 2026-11-17. */
  playId?: number | null;
  qtr: number;
  clock: string | null;
  elapsed: number;
  pos: string | null;
  def: string | null;
  type: string | null;
  yds: number | null;
  int: boolean;
  fumble: boolean;
  td: boolean;
  tdTeam: string | null;
  fg: string | null;
  kickDistance?: number | null;
  sack: boolean;
  endZone: boolean;
  passer: string | null;
  receiver: string | null;
  rusher: string | null;
  interceptor: string | null;
  kicker: string | null;
  /** On a lost fumble, the club that fumbled (nflverse fumbled_1_team); absent in an older store. */
  fumbleTeam?: string | null;
  /** On a sack, who made it (nflverse spelling); absent in an older store. */
  sacker?: string | null;
  /** A safety (nflverse safety = 1); absent in an older store and on every other play. */
  safety?: boolean;
  /** On a kickoff or punt return touchdown, the returner (nflverse spelling). */
  returner?: string | null;
  /**
   * On a touchdown, the try when it was anything but a made extra point:
   * nflverse's extra_point_result ("xp_failed", "xp_blocked") or
   * two_point_conv_result ("2pt_success", "2pt_failure", ...). Absent in an
   * older store and after a made extra point.
   */
  tryResult?: string;
  /** On a kickoff or punt return touchdown, the return's yards. */
  returnYds?: number | null;
  /** Home win probability before and after, per mille. */
  wpBefore: number;
  wpAfter: number;
  homeScore: number | null;
  awayScore: number | null;
}

export interface StoryInjury {
  team: string | null;
  player: string;
  qtr: number | null;
  clock: string | null;
  teamDrive?: number | null;
  /** The play it happened on (nflverse play_id). The only evidence two injuries share a play. */
  playId?: number | null;
  returned: boolean;
}

export interface GameStory {
  season: number;
  week: number | null;
  seasonType: "regular" | "post";
  home: string;
  away: string;
  homeFinal: number;
  awayFinal: number;
  /** [elapsed seconds, home WP per mille]. */
  wp: Array<[number, number]>;
  plays: StoryPlay[];
  injuries: StoryInjury[];
  /** Each club's advanced offense, by display code (box-score.ts reads it); absent in an older store. */
  adv?: Record<string, StoryAdvanced>;
  /** Forced fumbles, which the box score does not carry; absent in an older store. */
  ff?: ForcedFumble[];
  /** Club -> nflverse spelling ("A.St. Brown") -> ESPN athlete id; absent in an older store. */
  ids?: Record<string, Record<string, string>>;
}

interface StoryDoc {
  games: Record<string, GameStory>;
}

/** The stored story for one game, or null when the store has none. */
export function findGameStory(game: {
  season: number;
  week: number;
  seasonType: string;
  home: string;
  away: string;
}): GameStory | null {
  return findGameStoryEntry(game)?.story ?? null;
}

/** The stored story and its nflverse game id ("2026_01_NE_SEA"), or null. */
export function findGameStoryEntry(game: {
  season: number;
  week: number;
  seasonType: string;
  home: string;
  away: string;
}): { id: string; story: GameStory } | null {
  const doc = readDataJson<StoryDoc>(dataPath("matchup", `game_story_${game.season}.json`));
  if (!doc) return null;
  const post = game.seasonType !== "regular";
  for (const [id, g] of Object.entries(doc.games)) {
    if (g.home !== game.home || g.away !== game.away) continue;
    if (post ? g.seasonType === "post" : g.seasonType === "regular" && g.week === game.week) return { id, story: g };
  }
  return null;
}

/* ------------------------------------------------------ written recaps */

interface WrittenRecap {
  headline: string;
  paragraphs: string[];
  /** factsHash() of the evidence it was written from. */
  hash: string;
  model: string;
  writtenAt: string;
}

/**
 * A stored, fact-checked recap for the game, or null. Null too when the
 * evidence has changed since it was written (a stat correction, a rebuilt
 * story store): the page then shows the engine's own text until the writer
 * runs again, never prose about numbers that are no longer true.
 */
function storedRecap(season: number, gameId: string, hash: string): WrittenRecap | null {
  const doc = readDataJson<{ games: Record<string, WrittenRecap> }>(dataPath("matchup", `recap_prose_${season}.json`));
  const hit = doc?.games?.[gameId];
  return hit && hit.hash === hash && hit.paragraphs?.length ? hit : null;
}

/**
 * When the game's written recap was stored, ISO, or null when it has none.
 * The sitemap's lastmod reads it (game-index.ts): a rewritten recap is a
 * change to the page. writeRecaps.mjs keeps the old stamp when an import
 * brings back the same text.
 */
export function writtenRecapAt(season: number, gameId: string): string | null {
  const doc = readDataJson<{ games: Record<string, WrittenRecap> }>(dataPath("matchup", `recap_prose_${season}.json`));
  const at = doc?.games?.[gameId]?.writtenAt;
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
}

/* --------------------------------------------------------------- input */

export interface OverviewInput {
  game: ScoreboardGame;
  story: GameStory;
  stats: { away: BoxTeamStats | null; home: BoxTeamStats | null };
  players: GamePlayers;
  leaders: LeaderPick[];
  /** "Seattle", "New England": the clubs as the copy names them. */
  city: { away: string; home: string };
  playerUrl: PlayerUrlFn;
  /** A player's face, by box-score id; "" when there is none. */
  photo: (id: string) => string;
  /** The page's highlights section, as rendered elsewhere; "" when none. */
  highlights: string;
  /** Inline style for each side's team ink: "--ov-away:#..;--ov-home:#..". */
  inks: { away: string; home: string };
  /** The recap narrative's extra evidence (recap-narrative.ts, 2026-11-17); all optional. */
  gameId?: string;
  drives?: PbpDrive[] | null;
  /** The game's play-by-play, which down, distance and the final whistle are read from (WEB-037). */
  pbp?: GamePbp | null;
  /** The box score's scoring sequence: the only evidence that a lead held to the final (WEB-037). */
  scoring?: ScoringPlay[] | null;
  odds?: GameOdds | null;
  records?: { away: TeamRecord | null; home: TeamRecord | null };
  divisional?: boolean;
}

type Side = "away" | "home";
const other = (s: Side): Side => (s === "away" ? "home" : "away");

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number): string => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string): string => `${word(n)} ${n === 1 ? one : many}`;
const join = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/* --------------------------------------------------------------- names */

/**
 * "D.Lock" (nflverse) to the box score's "Drew Lock": same club, same first
 * initial, same last name. Unmatched, the store's spelling with a space.
 */
function nameResolver(players: GamePlayers, ids?: GameStory["ids"]) {
  const r = resolver(players, ids);
  return (abbr: string | null, team: string | null): { full: string; last: string } | null => {
    const hit = r(abbr, team);
    return hit ? { full: hit.full, last: hit.last } : null;
  };
}

/* --------------------------------------------------------------- facts */

interface Facts {
  winner: Side;
  loser: Side;
  W: { code: string; nick: string; city: string };
  L: { code: string; nick: string; city: string };
  score: { winner: number; loser: number };
  /** Winner WP per mille for a home-WP figure. */
  wwp: (homeWp: number) => number;
  halftime: { winner: number; loser: number } | null;
  trailedLate: boolean;
  takeaways: { int: StoryPlay[]; fumbles: StoryPlay[] };
  q4Int: StoryPlay[];
  lateTd: StoryPlay | null;
  goAhead: StoryPlay | null;
  sealer: StoryPlay | null;
  longTd: StoryPlay | null;
  /** A story play's play-by-play facts (down, distance, whether it ended the game); null when unmatched. */
  pbpFacts: (p: StoryPlay) => StoryPlayFacts | null;
  /** The go-ahead score ended the game: it won it, there was no lead left to keep. */
  walkOff: boolean;
  /** The box score confirms the winner stayed ahead from the go-ahead score through the final. */
  leadHeld: boolean;
  /** The box score confirms the winner's halftime lead held through the final. */
  halfLeadHeld: boolean;
  /** "the Detroit 7" from "DET 7". */
  spot: (at: string | null) => string | null;
}

function teamOf(game: ScoreboardGame, s: Side) {
  return game[s];
}

function quarterPoints(game: ScoreboardGame, s: Side, from: number, to: number): number | null {
  const q = game[s].quarters;
  if (!q) return null;
  return q.slice(from, to).reduce((a, b) => a + b, 0);
}

function facts(input: OverviewInput): Facts | null {
  const { game, story } = input;
  const result = scoreboardResult(game);
  if (!result || !result.winner) return null;
  const winner = result.winner;
  const loser = other(winner);
  const code = (s: Side) => teamOf(game, s).abbr;
  const wCode = code(winner);
  const wwp = (h: number) => (winner === "home" ? h : 1000 - h);
  const scoreOf = (p: StoryPlay, s: Side) => (s === "home" ? p.homeScore : p.awayScore);

  const hW = quarterPoints(game, winner, 0, 2);
  const hL = quarterPoints(game, loser, 0, 2);
  const halftime = hW !== null && hL !== null ? { winner: hW, loser: hL } : null;

  // Did the winner trail in the second half? From the scores after each play.
  const trailedLate =
    (halftime !== null && halftime.winner < halftime.loser) ||
    story.plays.some((p) => p.qtr >= 3 && (scoreOf(p, winner) ?? 0) < (scoreOf(p, loser) ?? 0));

  const takeaways = {
    int: story.plays.filter((p) => p.int && p.def === wCode),
    fumbles: story.plays.filter((p) => p.fumble && p.def === wCode),
  };
  const q4Int = takeaways.int.filter((p) => p.qtr >= 4);
  // A late touchdown that mattered: the winner trailed or led by one score at most before it.
  const lateTd =
    [...story.plays]
      .reverse()
      .find(
        (p) =>
          p.td &&
          p.tdTeam === wCode &&
          p.qtr >= 4 &&
          (scoreOf(p, winner) ?? 0) - 6 - (scoreOf(p, loser) ?? 0) <= 3,
      ) ?? null;

  // The score after which the winner led for good.
  let goAhead: StoryPlay | null = null;
  let prevLead = false;
  for (const p of story.plays) {
    const w = scoreOf(p, winner);
    const l = scoreOf(p, loser);
    if (w === null || l === null) continue;
    const lead = w > l;
    const scored = p.td || p.fg === "made";
    if (lead && !prevLead && scored) goAhead = p;
    if (!lead) goAhead = null;
    prevLead = lead;
  }

  // The sealing play: the winner's last takeaway in the final five minutes
  // with the lead in hand.
  const sealer =
    [...story.plays]
      .reverse()
      .find(
        (p) =>
          (p.int || p.fumble) &&
          p.def === wCode &&
          p.elapsed >= 3300 &&
          (scoreOf(p, winner) ?? 0) > (scoreOf(p, loser) ?? 0),
      ) ?? null;

  const longTd =
    story.plays
      .filter((p) => p.td && p.tdTeam === wCode && p.pos === wCode && (p.yds ?? 0) >= 30)
      .sort((a, b) => (b.yds ?? 0) - (a.yds ?? 0))[0] ?? null;

  const nick = (s: Side) => teamOf(game, s).short;
  const known = storyPlayFacts(story.plays, input.pbp);
  const pbpFacts = (p: StoryPlay) => known.get(p) ?? null;
  const cityOf = (c: string) => (c === game.away.abbr ? input.city.away : c === game.home.abbr ? input.city.home : null);
  return {
    winner,
    loser,
    W: { code: wCode, nick: nick(winner), city: input.city[winner] },
    L: { code: code(loser), nick: nick(loser), city: input.city[loser] },
    score: { winner: result[winner], loser: result[loser] },
    wwp,
    halftime,
    trailedLate,
    takeaways,
    q4Int,
    lateTd,
    goAhead,
    sealer,
    longTd,
    pbpFacts,
    // The play-by-play says nothing came after it AND the final agrees: a
    // file that stops short of the game is not a walk-off (WEB-037).
    walkOff: goAhead
      ? pbpFacts(goAhead)?.endsGame === true && isFinalScore(goAhead, { away: result.away, home: result.home }, winner, goAhead.td)
      : false,
    spot: (at) => spotText(at, cityOf),
    leadHeld: (() => {
      if (!goAhead) return false;
      const before = scoreBefore(goAhead, winner);
      return before !== null && leadHeldToFinal(input.scoring, game.away.abbr, game.home.abbr, { away: result.away, home: result.home }, { quarter: goAhead.qtr, side: winner, before });
    })(),
    halfLeadHeld: halftimeLeadHeld(input.scoring, game.away.abbr, game.home.abbr, { away: result.away, home: result.home }, winner),
  };
}

/** "early in the fourth quarter", "in the final minute", from a play's clock. */
function when(p: StoryPlay): string {
  const [m = 0, s = 0] = (p.clock ?? "").split(":").map(Number);
  const left = m * 60 + s;
  if (p.qtr >= 5) return "in overtime";
  if (p.qtr === 4) {
    if (left < 60) return "in the final minute";
    if (left < 120) return "in the final two minutes";
    if (left < 300) return "late in the fourth quarter";
    if (left < 600) return "midway through the fourth quarter";
    return "early in the fourth quarter";
  }
  return ["", "in the first quarter", "in the second quarter", "in the third quarter"][p.qtr] ?? "";
}

/* ---------------------------------------------------- 01 · game recap */

function headline(f: Facts, input: OverviewInput): string {
  const margin = f.score.winner - f.score.loser;
  const ot = input.game.away.ot !== null || input.game.home.ot !== null;
  const verb = f.trailedLate ? "rally past" : margin >= 17 ? "rout" : margin <= 3 ? "edge" : "beat";
  const reasons: string[] = [];
  if (f.lateTd) reasons.push("a late touchdown");
  const takeaways = f.takeaways.int.length + f.takeaways.fumbles.length;
  if (f.takeaways.int.length >= 2 && f.takeaways.fumbles.length === 0) reasons.push(`${word(f.takeaways.int.length)} interceptions`);
  else if (takeaways >= 2) reasons.push(`${word(takeaways)} takeaways`);
  if (!reasons.length && f.longTd) reasons.push(`${aYards(f.longTd.yds)} touchdown ${f.longTd.type === "run" ? "run" : "play"}`);
  return (
    `${f.W.nick} ${verb} ${f.L.nick} ${f.score.winner}–${f.score.loser}` +
    (ot ? " in overtime" : "") +
    (reasons.length ? ` behind ${join(reasons.slice(0, 2))}` : "")
  );
}

function recapParagraphs(f: Facts, input: OverviewInput, name: ReturnType<typeof nameResolver>): string[] {
  const { story, players } = input;
  const first: string[] = [];
  const second: string[] = [];

  // A starting quarterback lost early, and who replaced him.
  const qbOut = story.injuries.find((inj) => {
    if (inj.returned || !inj.team) return false;
    const who = name(inj.player, inj.team);
    const p = Object.values(players).find((x) => x.name === who?.full && x.team === inj.team);
    return p?.pos === "QB" || (p?.stats.passAtt ?? 0) > 0;
  });
  if (qbOut && qbOut.team && (qbOut.qtr ?? 9) <= 2) {
    const who = name(qbOut.player, qbOut.team)!;
    const backup = Object.values(players)
      .filter((p) => p.team === qbOut.team && p.name !== who.full && (p.stats.passAtt ?? 0) > 0)
      .sort((a, b) => (b.stats.passAtt ?? 0) - (a.stats.passAtt ?? 0))[0];
    const side: Side = qbOut.team === f.W.code ? f.winner : f.loser;
    const club = input.city[side];
    const whenOut = qbOut.teamDrive === 1 ? "on the opening drive" : qbOut.qtr === 1 ? "in the first quarter" : "before halftime";
    first.push(
      `${club} lost ${who.full} to an injury ${whenOut}` +
        (backup ? `, and ${backup.name} took over at quarterback.` : "."),
    );
  }

  if (f.halftime) {
    const { winner, loser } = f.halftime;
    const h2w = f.score.winner - winner;
    const h2l = f.score.loser - loser;
    if (winner < loser) {
      first.push(`${f.W.city} trailed ${loser}–${winner} at halftime, then outscored ${f.L.city} ${h2w}–${h2l} after the break.`);
    } else if (winner === loser) {
      first.push(`The teams were tied ${winner}–${loser} at halftime before ${f.W.city} won the second half ${h2w}–${h2l}.`);
    } else {
      // Did the lead survive the second half? From the scores after each play.
      const scoreOf = (p: StoryPlay, s: Side) => (s === "home" ? p.homeScore : p.awayScore);
      const late = story.plays.filter((p) => p.qtr >= 3);
      const trailed = late.some((p) => (scoreOf(p, f.winner) ?? 0) < (scoreOf(p, f.loser) ?? 0));
      const tied = late.some((p) => (scoreOf(p, f.winner) ?? 0) === (scoreOf(p, f.loser) ?? 0));
      first.push(
        trailed
          ? `${f.W.city} led ${winner}–${loser} at halftime, but ${f.L.city} came back to take the lead in the second half.`
          : tied
            ? `${f.W.city} led ${winner}–${loser} at halftime before ${f.L.city} pulled level in the second half.`
            : f.halfLeadHeld
              ? `${f.W.city} led ${winner}–${loser} at halftime and never gave up the lead.`
              : `${f.W.city} led ${winner}–${loser} at halftime.`,
      );
    }
  }

  // When the game changed: the winner's biggest win-probability swing. A
  // swing that came with the winner already a heavy favorite (80%+) did not
  // turn the game, it sealed it (mak, 2026-11-11: an 87% -> 98% fumble
  // return is "the moment New England sealed the victory").
  const swing = swingPlay(f, story);
  if (swing) {
    const line = describe(swing, f, name, "sentence");
    if (line) {
      first.push(
        f.wwp(swing.wpBefore) >= 800
          ? `${f.W.city} sealed it ${when(swing)}, when ${line}.`
          : `The game turned ${when(swing)}, when ${line}.`,
      );
    }
  }

  // The deciding factors: fourth-quarter takeaways, the go-ahead score, the sealer.
  if (f.q4Int.length >= 2) {
    const passer = name(f.q4Int[0]!.passer, f.L.code);
    const picks = f.q4Int.map((p) => name(p.interceptor, f.W.code)?.full).filter(Boolean) as string[];
    second.push(
      `${passer ? passer.full : `${f.L.city}'s quarterback`} threw ${plural(f.q4Int.length, "interception", "interceptions")} in the fourth quarter` +
        (picks.length === f.q4Int.length ? `, to ${join(picks)}.` : "."),
    );
  }
  if (f.goAhead && f.goAhead !== swing) {
    const line = describe(f.goAhead, f, name, "sentence");
    if (line) {
      second.push(
        f.walkOff
          ? `${capital(line)} ${when(f.goAhead)} to win it on the final play.`
          : f.leadHeld
            ? `${capital(line)} ${when(f.goAhead)} to put ${f.W.city} ahead for good.`
            : `${capital(line)} ${when(f.goAhead)} to give ${f.W.city} the lead.`,
      );
    }
  }
  if (f.sealer) {
    const who = name(f.sealer.interceptor, f.W.code);
    if (f.sealer.int && who) {
      second.push(
        `${who.full}${who.full.endsWith("s") ? "'" : "'s"} ${f.sealer.endZone ? "end-zone " : ""}interception ${when(f.sealer)} sealed the win.`,
      );
    } else if (f.sealer.fumble) {
      second.push(`A fumble recovery ${when(f.sealer)} sealed the win.`);
    }
  }
  if (!second.length) {
    const ws = input.stats[f.winner];
    const ls = input.stats[f.loser];
    if (ws?.totalYards != null && ls?.totalYards != null) {
      second.push(`${f.W.city} finished with ${ws.totalYards} yards to ${f.L.city}'s ${ls.totalYards}.`);
    }
  }
  return [first.join(" "), second.join(" ")].filter(Boolean);
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The winner's biggest win-probability swing (10+ points), the sealing takeaway aside. */
function swingPlay(f: Facts, story: GameStory): StoryPlay | undefined {
  return [...story.plays]
    .filter((p) => p !== f.sealer && f.wwp(p.wpAfter) - f.wwp(p.wpBefore) >= 100)
    .sort((a, b) => f.wwp(b.wpAfter) - f.wwp(b.wpBefore) - (f.wwp(a.wpAfter) - f.wwp(a.wpBefore)))[0];
}

/** The plays the Game Recap paragraphs name, which the why card leaves to it. */
function toldInRecap(f: Facts, story: GameStory): Set<StoryPlay> {
  return new Set([swingPlay(f, story), f.goAhead, f.sealer].filter((p): p is StoryPlay => Boolean(p)));
}

/** The winner's touchdown on defense: an interception or fumble returned for a score. */
function defensiveTd(f: Facts, story: GameStory): StoryPlay | null {
  return story.plays.find((p) => p.td && p.tdTeam === f.W.code && p.pos !== f.W.code && (p.int || p.fumble)) ?? null;
}

/** "a 45-yard", "an 82-yard", "an 11-yard". */
export function aYards(n: number | null | undefined): string {
  const v = n ?? 0;
  const an = v === 8 || v === 11 || v === 18 || (v >= 80 && v <= 89);
  return `${an ? "an" : "a"} ${v}-yard`;
}

/**
 * A play in words. "sentence" for the recap ("Drew Lock hit Jaxon
 * Smith-Njigba for a 45-yard touchdown"); "moment" for the swing list
 * ("Lock connects with Smith-Njigba for a 45-yard TD").
 */
function describe(
  p: StoryPlay,
  f: Facts,
  name: ReturnType<typeof nameResolver>,
  style: "sentence" | "moment",
): string | null {
  const m = style === "moment";
  const nm = (abbr: string | null, team: string | null) => {
    const n = name(abbr, team);
    return n ? (m ? n.last : n.full) : null;
  };
  const yd = p.yds ?? 0;
  if (p.int) {
    const who = nm(p.interceptor, p.def);
    const qb = nm(p.passer, p.pos);
    if (!who) return null;
    if (m && p === f.sealer) return `${who}'s late interception seals the victory`;
    return `${who} intercepts ${qb ?? "the pass"}${p.endZone ? " in the end zone" : ""}`;
  }
  if (p.fumble) {
    // "the Patriots defense", so "New England sealed it ... when the Patriots
    // defense returned a fumble" doesn't name the club twice.
    const club = p.def === f.W.code ? `the ${f.W.nick} defense` : p.def === f.L.code ? `the ${f.L.nick} defense` : "the defense";
    if (m) return `${p.def ?? "The defense"} ${p.td ? "returns a fumble for a TD" : "recovers a fumble"}`;
    return `${club} ${p.td ? "returned a fumble for a touchdown" : "recovered a fumble"}`;
  }
  if (p.fg === "made") {
    const k = nm(p.kicker, p.pos);
    const kick = p.kickDistance ? `${aYards(p.kickDistance)} field goal` : "a field goal";
    // The last play of the game won it; "go-ahead" is for a lead that then had to hold.
    if (p === f.goAhead && m) return `${k ?? "The kicker"} makes the ${f.walkOff ? "game-winning" : "go-ahead"} field goal`;
    return m ? `${k ?? "The kicker"} makes ${kick}` : `${k ?? "The kicker"} made ${kick}`;
  }
  // Down and distance from the play-by-play (WEB-037): a fourth down that
  // came up short is a turnover on downs, not a gain of no yards.
  const down = f.pbpFacts(p)?.down ?? null;
  if (down?.turnoverOnDowns && (p.type === "pass" || p.type === "run")) {
    const where = f.spot(down.at);
    const tail = ` on ${downText(down, p.pos)}${where ? ` at ${where}` : ""}, a turnover on downs`;
    if (p.type === "pass") {
      const qb = nm(p.passer, p.pos);
      const rec = p.receiver ? nm(p.receiver, p.pos) : null;
      const pass = `${qb ? `${qb}${qb.endsWith("s") ? "'" : "'s"} pass` : m ? "The pass" : "the pass"}${rec ? ` to ${rec}` : ""}`;
      const how = down.incomplete ? (m ? "falls incomplete" : "fell incomplete") : m ? "comes up short" : "came up short";
      return `${pass} ${how}${tail}`;
    }
    const r = p.rusher ? nm(p.rusher, p.pos) : null;
    return `${r ?? (m ? "The runner" : "the runner")} ${m ? "is stopped" : "was stopped"}${tail}`;
  }
  // A converted fourth down says so; anything else reads as before.
  const onFourth = down?.converted && !p.td ? ` on ${downText(down, p.pos)}` : "";
  if (p.type === "pass" && p.receiver) {
    const qb = nm(p.passer, p.pos);
    const rec = nm(p.receiver, p.pos);
    if (p.td) return m ? `${qb} connects with ${rec} for ${aYards(yd)} TD` : `${qb} hit ${rec} for ${aYards(yd)} touchdown`;
    return m ? `${qb} finds ${rec} for ${yd} yards${onFourth}` : `${qb} found ${rec} for ${yd} yards${onFourth}`;
  }
  if (p.type === "run" && p.rusher) {
    const r = nm(p.rusher, p.pos);
    if (p.td) return m ? `${r} scores on ${aYards(yd)} run` : `${r} scored on ${aYards(yd)} run`;
    return m ? `${r} runs for ${yd} yards${onFourth}` : `${r} ran for ${yd} yards${onFourth}`;
  }
  if (p.sack) return m ? `A sack of ${nm(p.passer, p.pos) ?? "the quarterback"}` : null;
  return null;
}

/* -------------------------------------------------- 02 · why they won */

function whyWon(f: Facts, input: OverviewInput, name: ReturnType<typeof nameResolver>): { tiles: Array<[string, string]>; text: string } {
  const ws = input.stats[f.winner];
  const ls = input.stats[f.loser];
  const tiles: Array<[string, string]> = [];
  const to = ws && ls && ws.turnovers != null && ls.turnovers != null ? ls.turnovers - ws.turnovers : null;
  if (to !== null && to > 0) tiles.push([`+${to}`, "Turnover margin"]);
  // The tiles follow the same evidence as the sentence (mak, 2026-11-11).
  const wPlay = ws ? playCalling(ws) : null;
  const lPlay = ls ? playCalling(ls) : null;
  if (wPlay?.perDropback != null && lPlay?.perDropback != null && wPlay.perDropback - lPlay.perDropback >= 1.5) {
    tiles.push([wPlay.perDropback.toFixed(1), `${f.W.code} yards/dropback`]);
  } else if (ws?.yardsPerPlay != null && ls?.yardsPerPlay != null && ws.yardsPerPlay > ls.yardsPerPlay) {
    tiles.push([ws.yardsPerPlay.toFixed(1), `${f.W.code} yards/play`]);
  }
  const lThird = ls?.thirdDown;
  if (lThird && lThird.attempts >= 8 && lThird.made / lThird.attempts <= 0.34) {
    tiles.push([`${lThird.made}/${lThird.attempts}`, `${f.L.code} third downs`]);
  }
  const q = input.game[f.winner].quarters;
  if (tiles.length < 3 && q && q.length >= 4) {
    const q4 = (q[3] ?? 0) + (input.game[f.winner].ot ?? 0);
    const second = (q[2] ?? 0) + q4;
    const lq = input.game[f.loser].quarters;
    const loserSecond = lq && lq.length >= 4 ? (lq[2] ?? 0) + (lq[3] ?? 0) + (input.game[f.loser].ot ?? 0) : null;
    if (q4 >= 7 && q4 >= Math.max(...q.slice(0, 3))) tiles.push([String(q4), "Q4 points"]);
    else if (second >= 10 && loserSecond !== null && second > loserSecond) tiles.push([String(second), "2nd-half points"]);
  }
  if (tiles.length < 3 && f.longTd && !toldInRecap(f, input.story).has(f.longTd)) {
    tiles.push([`${f.longTd.yds}`, f.longTd.type === "run" ? "Yard TD run" : "Yard TD pass"]);
  }
  if (tiles.length < 3 && ws?.totalYards != null && ls?.totalYards != null && ws.totalYards > ls.totalYards) {
    tiles.push([String(ws.totalYards), `${f.W.code} total yards`]);
  }

  const overcame: string[] = [];
  if (ws?.thirdDown && ls?.thirdDown && ws.thirdDown.percent !== null && ls.thirdDown.percent !== null && ws.thirdDown.percent < ls.thirdDown.percent) {
    overcame.push(`poor third-down efficiency (${ws.thirdDown.made}-for-${ws.thirdDown.attempts})`);
  }
  if (ws?.plays != null && ls?.plays != null && ls.plays - ws.plays >= 5) overcame.push(`${ls.plays - ws.plays} fewer offensive plays`);
  if (ws?.totalYards != null && ls?.totalYards != null && ws.totalYards < ls.totalYards) overcame.push(`being outgained ${ls.totalYards}–${ws.totalYards}`);
  if (f.halftime && f.halftime.winner < f.halftime.loser) overcame.push(`a ${f.halftime.loser}–${f.halftime.winner} halftime deficit`);

  // The evidence, never a play the Game Recap already tells (mak,
  // 2026-11-11): efficiency, the other side's third downs, a defensive score.
  const told = toldInRecap(f, input.story);
  const edges: string[] = [];
  if (to !== null && to > 0) edges.push(`a +${to} turnover margin`);
  const wc = ws ? playCalling(ws) : null;
  const lc = ls ? playCalling(ls) : null;
  if (wc?.perDropback != null && lc?.perDropback != null && wc.perDropback - lc.perDropback >= 1.5) {
    edges.push(`${wc.perDropback.toFixed(1)} yards per dropback to ${f.L.city}'s ${lc.perDropback.toFixed(1)}`);
  }
  const lt = ls?.thirdDown;
  if (lt && lt.attempts >= 8 && lt.made / lt.attempts <= 0.34) {
    edges.push(`a defense that held ${f.L.city} to ${lt.made}-for-${lt.attempts} on third down`);
  }
  const dTd = defensiveTd(f, input.story);
  if (dTd) edges.push(dTd.int ? "an interception-return touchdown" : "a fumble-return touchdown");
  if (f.q4Int.length >= 2) edges.push(`${word(f.q4Int.length)} fourth-quarter interceptions`);
  if (f.longTd && !told.has(f.longTd) && edges.length < 3) {
    const line = describe(f.longTd, f, name, "sentence");
    const qb = name(f.longTd.passer, f.W.code);
    const rec = name(f.longTd.receiver, f.W.code);
    const rusher = name(f.longTd.rusher, f.W.code);
    if (f.longTd.type === "pass" && qb && rec) edges.push(`a decisive ${f.longTd.yds}-yard touchdown from ${qb.full} to ${rec.full}`);
    else if (f.longTd.type === "run" && rusher) edges.push(`${rusher.full}'s ${f.longTd.yds}-yard touchdown run`);
    else if (line) edges.push(`${aYards(f.longTd.yds)} touchdown`);
  }
  if (!edges.length && ws?.yardsPerPlay != null && ls?.yardsPerPlay != null && ws.yardsPerPlay > ls.yardsPerPlay) {
    edges.push(`${ws.yardsPerPlay.toFixed(1)} yards per play to ${ls.yardsPerPlay.toFixed(1)}`);
  }
  edges.splice(3);
  const text = overcame.length && edges.length
    ? `${f.W.city} overcame ${join(overcame)} thanks to ${join(edges)}.`
    : edges.length
      ? `${f.W.city} won it with ${join(edges)}.`
      : "";
  return { tiles: tiles.slice(0, 3), text };
}

/* ----------------------------------------------- 03 · how the game swung */

function moments(f: Facts, story: GameStory): StoryPlay[] {
  const gain = (p: StoryPlay) => f.wwp(p.wpAfter) - f.wwp(p.wpBefore);
  const big = story.plays.filter((p) => gain(p) >= 100).sort((a, b) => gain(b) - gain(a)).slice(0, 2);
  const picks = new Set<StoryPlay>(big);
  if (f.goAhead) picks.add(f.goAhead);
  if (f.sealer) picks.add(f.sealer);
  return [...picks].sort((a, b) => a.elapsed - b.elapsed || story.plays.indexOf(a) - story.plays.indexOf(b)).slice(0, 4);
}

function swingChart(f: Facts, story: GameStory, marks: StoryPlay[], input: OverviewInput): string {
  const W = 720;
  const H = 200;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const end = Math.max(3600, story.wp[story.wp.length - 1]?.[0] ?? 3600);
  const x = (s: number) => padL + (s / end) * (W - padL - padR);
  const y = (pmille: number) => padT + (1 - pmille / 1000) * (H - padT - padB);
  const pts = story.wp.map(([s, h]) => `${x(s).toFixed(1)},${y(f.wwp(h)).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const area = `${line}L${x(end).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const quarters = [900, 1800, 2700, ...(end > 3600 ? [3600] : [])]
    .map((s) => `<line class="sct-ov-wp-q" x1="${x(s)}" x2="${x(s)}" y1="${padT}" y2="${H - padB}"/>`)
    .join("");
  const qLabels = ["Q1", "Q2", "Q3", "Q4", ...(end > 3600 ? ["OT"] : [])]
    .map((l, i) => `<text class="sct-ov-wp-t" x="${x(i * 900 + 450)}" y="${H - 6}" text-anchor="middle">${l}</text>`)
    .join("");
  const yLabels = [[1000, "100%"], [500, "50%"], [0, "0%"]]
    .map(([v, l]) => `<text class="sct-ov-wp-t" x="${padL - 6}" y="${y(v as number) + 4}" text-anchor="end">${l}</text>`)
    .join("");
  const dots = marks
    .map((p, i) => {
      const cx = x(p.elapsed);
      const cy = y(f.wwp(p.wpAfter));
      return `<g class="sct-ov-wp-mark"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9"/><text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`;
    })
    .join("");
  return (
    `<svg class="sct-ov-wp" viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(`${f.W.nick} win probability through the game`)}" style="--ov-team:${e(input.inks[f.winner])}">` +
    `<line class="sct-ov-wp-mid" x1="${padL}" x2="${W - padR}" y1="${y(500)}" y2="${y(500)}"/>` +
    quarters +
    `<path class="sct-ov-wp-area" d="${area}"/>` +
    `<path class="sct-ov-wp-line" d="${line}"/>` +
    dots +
    yLabels +
    qLabels +
    `</svg>`
  );
}

/* --------------------------------------------------- 04 · game leaders */

function leaderLine(pick: LeaderPick, f: Facts | null, sealerName: string | null): string {
  const s = pick.player.stats;
  const parts: string[] = [];
  switch (pick.role) {
    case "passing":
      parts.push(`${s.passYds ?? 0} yards`);
      if (s.passTd) parts.push(`${s.passTd} TD`);
      if (s.passInt) parts.push(`${s.passInt} INT`);
      break;
    case "rushing":
      parts.push(`${s.rushYds ?? 0} yards`, `${s.rushAtt ?? 0} att`);
      if (s.rushTd) parts.push(`${s.rushTd} TD`);
      break;
    case "receiving":
      parts.push(`${s.recYds ?? 0} yards`);
      if (s.recTd) parts.push(`${s.recTd} TD`);
      else parts.push(`${s.rec ?? 0} rec`);
      break;
    case "defense":
      if (sealerName && pick.player.name === sealerName && f?.sealer?.int) return "Game-sealing INT";
      if (s.defInt) parts.push(`${s.defInt} INT`);
      if (s.sacks) parts.push(`${s.sacks} sack${s.sacks === 1 ? "" : "s"}`);
      parts.push(`${(s.soloTkl ?? 0) + (s.astTkl ?? 0)} TKL`);
      break;
  }
  return parts.join(" · ");
}

/* ----------------------------------------------------------------- page */

// No "01 ·" step numbers (mak 11-08): a card carries a small label only when
// its H2 doesn't already say it; today no card passes one.
function card(label: string, id: string, title: string, body: string, extra = "", icon = ""): string {
  return (
    `<section class="sct-ov-card${extra ? ` ${extra}` : ""}" aria-labelledby="${e(id)}">` +
    `<div class="sct-ov-head">${icon}<div class="sct-ov-head-text">${label ? `<p class="sct-ov-step">${e(label)}</p>` : ""}` +
    `<h2 class="sct-ov-h" id="${e(id)}">${e(title)}</h2></div>` +
    `<span class="sct-ov-slash" aria-hidden="true"></span></div>` +
    `<div class="sct-ov-body">${body}</div>` +
    `</section>`
  );
}

/**
 * The Overview's cards with Game Leaders lifted out (mak, 2026-11-08): `main`
 * holds the other four cards, `leaders` the leaders as a sidebar card in Game
 * info's own markup (sct-rb-card, h3, label/value list), for the page to print
 * directly under Game info. Both "" when the game has no story.
 */
export function renderRecapOverviewParts(input: OverviewInput): { main: string; leaders: string } {
  const f = facts(input);
  if (!f) return { main: "", leaders: "" };
  const name = nameResolver(input.players, input.story.ids);
  const link = (full: string, gameKey?: string) => {
    const url = input.playerUrl(full, gameKey ? { gameKey } : undefined);
    return url ? `<a href="${e(url)}">${e(full)}</a>` : e(full);
  };

  // 01: the narrative engine (recap-narrative.ts, 2026-11-17); the older
  // fixed-sequence copy stays as the fallback for a game it cannot tell.
  const narrativeInput = {
    seed: input.gameId ?? `${input.game.away.abbr}-${input.game.home.abbr}-${input.game.kickoff ?? ""}`,
    game: input.game,
    story: input.story,
    stats: input.stats,
    players: input.players,
    city: input.city,
    drives: input.drives ?? null,
    pbp: input.pbp ?? null,
    scoring: input.scoring ?? null,
    odds: input.odds ?? null,
    records: input.records,
    divisional: input.divisional,
  };
  // The written recap (scripts/matchup/writeRecaps.mjs), checked against the
  // facts and stored, wins while the evidence it was written from is unchanged.
  const packet = input.gameId ? recapFacts(narrativeInput, input.gameId) : null;
  const written = packet ? storedRecap(input.story.season, packet.gameId, factsHash(packet)) : null;
  const told = written ?? (packet ? packet.draft : composeRecap(narrativeInput));
  const paras = told?.paragraphs.length ? told.paragraphs : recapParagraphs(f, input, name);
  const head = told?.paragraphs.length ? told.headline : headline(f, input);
  const recap = card(
    "",
    "sct-ov-recap",
    "Game Recap",
    // The headline opens the card body in bold (mak 11-08), not the H2.
    `<p class="sct-ov-copy sct-ov-headline"><strong>${e(head)}</strong></p>` +
      paras.map((p) => `<p class="sct-ov-copy">${e(p)}</p>`).join(""),
    "is-recap", BAR_ICON["recap"],
  );

  // 02
  const why = whyWon(f, input, name);
  const whyCard = why.tiles.length
    ? card(
        "",
        "sct-ov-why",
        `Why the ${f.W.nick} Won`,
        `<ul class="sct-ov-tiles">${why.tiles
          .map(([v, l]) => `<li><b class="sct-ov-num">${e(v)}</b><span>${e(l)}</span></li>`)
          .join("")}</ul>` + (why.text ? `<p class="sct-ov-copy">${e(why.text)}</p>` : ""),
        "is-why", BAR_ICON["why"],
      )
    : "";

  // 03
  const marks = moments(f, input.story);
  const items = marks
    .map((p, i) => {
      const text = describe(p, f, name, "moment");
      if (!text) return "";
      const before = Math.round(f.wwp(p.wpBefore) / 10);
      const after = Math.round(f.wwp(p.wpAfter) / 10);
      return (
        `<li><span class="sct-ov-mk">${i + 1}</span><span class="sct-ov-mt"><b>${e(text)}.</b>` +
        `<small>${e(`Q${p.qtr >= 5 ? "OT" : p.qtr} ${(p.clock ?? "").replace(/^0/, "")} · ${f.W.code} win probability ${before}% → ${after}%`)}</small></span></li>`
      );
    })
    .join("");
  const swingCard =
    input.story.wp.length > 10
      ? card(
          "",
          "sct-ov-swing",
          "How the Game Swung",
          `<p class="sct-ov-legend">${e(`${f.W.nick} win probability, play by play`)}</p>` +
            swingChart(f, input.story, marks, input) +
            (items ? `<ol class="sct-ov-moments">${items}</ol>` : ""),
          "is-swing", BAR_ICON["swing"],
        )
      : "";

  // 04
  const order = ["passing", "rushing", "receiving", "defense"] as const;
  const LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };
  const sealerName = f.sealer?.interceptor ? (name(f.sealer.interceptor, f.W.code)?.full ?? null) : null;
  // In the sidebar under Game info now, in that card's design (mak, 2026-11-08):
  // the role as the label, the name and the line as the value. No faces, as
  // Game info has none; the club code leads the line so a name reads alone.
  const asideRows = order
    .map((role) => input.leaders.find((l) => l.role === role))
    .filter((l): l is LeaderPick => Boolean(l))
    .map(
      (l) =>
        // 2026-11-08 (the News rail's Injury Watch rows): the face, the name
        // over the line, and the role as a pill at the right; the CSS puts
        // the dt there. A player with no image key keeps an empty circle.
        `<dt><span class="sct-rb-pill">${e(LABEL[l.role])}</span></dt>` +
        `<dd><span class="sct-rb-leader-face">${input.photo(l.id)}</span>` +
        `<span class="sct-rb-leader-who"><span class="sct-rb-leader-name">${link(l.player.name, l.id)}</span>` +
        `<span class="sct-rb-leader-line">${e(`${l.player.team} · ${leaderLine(l, f, sealerName)}`)}</span></span></dd>`,
    )
    .join("");
  const leadersAside = asideRows
    ? `<section class="sct-rb-card sct-rb-info sct-rb-leaders" aria-labelledby="sct-rb-leaders">` +
      railHead("leaders", "sct-rb-leaders", "Game leaders", true) +
      `<dl class="sct-rb-dl">${asideRows}</dl>` +
      `</section>`
    : "";

  // 05
  const highlightsCard = input.highlights
    ? card("", "sct-ov-highlights", "Game Highlights", input.highlights, "is-highlights", BAR_ICON["video"])
    : "";

  return {
    main:
      `<div class="sct-ov" style="${e(`--ov-away:${input.inks.away};--ov-home:${input.inks.home}`)}">` +
      recap +
      whyCard +
      swingCard +
      highlightsCard +
      `</div>`,
    leaders: leadersAside,
  };
}

export type { GamePlayer };
