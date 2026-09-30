/**
 * The game recap: a headline, a standfirst and a few paragraphs of prose under
 * the scoreboard hero.
 *
 * Written by code, from the same numbers the page prints, under the rule the
 * "Why the X Won" sentence already keeps: every clause is backed by a figure
 * on the page, a clause whose figure is missing is dropped rather than hedged,
 * and a claim the data cannot make is not made. That is why it says "led 21–0
 * at halftime" (the quarters say so) and never "scored on its opening drive"
 * (nothing here knows about drives).
 *
 * What only a person knows — a quarterback's first playoff win — comes from
 * RECAP_NOTES in recap-notes.ts, written by hand per game and printed as given.
 *
 * Pure: a RecapInput in, a Recap out. The page assembles the input in
 * matchup-render.ts; nothing here fetches.
 */

import { escapeHtml } from "../render";
import type { BoxTeamStats } from "./boxscore";
import { scoreboardResult, type ScoreboardGame, type ScoreboardTeam } from "./scoreboard-hero";

/**
 * Redraft Command's start/sit page, at its final address: no trailing slash,
 * and not the /launch/ path that redirects to it. A player's own page is this
 * plus `/<slug>`.
 */
export const START_SIT_URL =
  "https://statchasers.com/redraft-command/who-should-i-start";

/** One of the winner's games in the postseason the recapped game belongs to. */
export interface RecapPostseasonGame {
  /** "Wild Card", "Divisional Round", "Super Bowl". */
  round: string;
  /** Postseason week, for ordering. */
  week: number;
  outcome: "W" | "L" | "T" | null;
  teamScore: number | null;
  opponentScore: number | null;
  /** "Buccaneers". */
  opponent: string;
}

export interface RecapInput {
  game: ScoreboardGame;
  /** Where each club is from, for "Los Angeles controls…". */
  awayCity: string;
  homeCity: string;
  awayStats: BoxTeamStats | null;
  homeStats: BoxTeamStats | null;
  /** The winner's postseason, in any order; null for a regular-season game. */
  winnerPostseason: RecapPostseasonGame[] | null;
  /** The pair's next meeting on the schedule, when there is one. */
  next: { label: string; season: string } | null;
  /** Hand-written sentences for this game, from recap-notes.ts. */
  notes: string[];
}

export interface Recap {
  headline: string;
  dek: string;
  paragraphs: string[];
  /** Whether the last paragraph ends with the start/sit prompt. */
  startSit: boolean;
}

interface Side {
  team: ScoreboardTeam;
  /**
   * City, or "the Rams" when both clubs share a city (Rams–Chargers). Written
   * lower case for mid-sentence; cap() it at the start of one.
   */
  place: string;
  /** "the Rams" takes a plural verb; "Los Angeles" a singular one. */
  plural: boolean;
  stats: BoxTeamStats | null;
  /** Points after each regulation quarter, cumulative. */
  running: number[];
  total: number;
}

const NEXT_ROUND: Record<string, string> = {
  "wild card": "Divisional Round",
  "divisional round": "Conference Championship",
  "conference championship": "Super Bowl",
};

const ORDINALS = ["first", "second", "third", "fourth"];

/** Super Bowl LVI for the 2021 season: the first was played after 1966. */
export function superBowlNumeral(season: number): string {
  let n = season - 1965;
  const table: Array<[number, string]> = [
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function roundOnly(label: string): string {
  return label.replace(/^(AFC|NFC)\s+/, "");
}

/** "Rams'" and "Cardinals'", "Chiefs'" — every NFL nickname is a plural. */
function possessive(nickname: string): string {
  return nickname.endsWith("s") ? `${nickname}'` : `${nickname}'s`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function count(n: number, noun: string): string {
  const word = NUMBER_WORDS[n] ?? String(n);
  return `${word} ${noun}${n === 1 ? "" : "s"}`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function side(team: ScoreboardTeam, city: string, otherCity: string, stats: BoxTeamStats | null): Side | null {
  if (!team.quarters || team.quarters.length < 4) return null;
  const running: number[] = [];
  team.quarters.slice(0, 4).reduce((sum, n, i) => (running[i] = sum + n), 0);
  return {
    team,
    place: city === otherCity ? `the ${team.short}` : city,
    plural: city === otherCity,
    stats,
    running,
    total: running[3]! + (team.ot ?? 0),
  };
}

/* --------------------------------------------------------------- headline */

function angle(game: ScoreboardGame, w: Side, l: Side): string {
  const playoff = game.gameType === "playoff";
  const context = playoff ? `the ${game.seasonLabel} ${roundOnly(game.roundLabel)}` : "";
  const ot = game.away.ot !== null || game.home.ot !== null;
  const ledEveryQuarter = [0, 1, 2].every((i) => w.running[i]! > l.running[i]!);
  const halfMargin = w.running[1]! - l.running[1]!;
  const finalMargin = w.total - l.total;
  // Present tense, so the verb agrees with the subject: "Los Angeles
  // controls", "the Rams control".
  const who = cap(w.place);
  const verb = (singular: string, plural: string): string => (w.plural ? plural : singular);

  if (ot) return `${who} ${verb("wins", "win")} ${context || "it"} in overtime`;
  if (halfMargin < 0) {
    return `${who} ${verb("rallies", "rally")} from ${-halfMargin} down at halftime${context ? ` in ${context}` : ""}`;
  }
  if (w.running[2]! < l.running[2]!) {
    return `${who} ${verb("rallies", "rally")} in the fourth quarter${context ? ` of ${context}` : ""}`;
  }
  if (ledEveryQuarter && finalMargin >= 14) {
    return context
      ? `${who} ${verb("controls", "control")} ${context} from start to finish`
      : `${who} ${verb("leads", "lead")} from start to finish`;
  }
  if (finalMargin <= 3) {
    return `${who} ${verb("holds", "hold")} off ${l.place}${context ? ` in ${context}` : ""}`;
  }
  if (Math.abs(halfMargin) <= 7 && finalMargin >= 14) {
    return `${who} ${verb("pulls", "pull")} away${context ? ` in ${context}` : ` from ${l.place}`}`;
  }
  return context
    ? `${who} ${verb("wins", "win")} ${context}`
    : `${who} ${verb("beats", "beat")} ${l.place}`;
}

/* -------------------------------------------------------------------- dek */

function destination(game: ScoreboardGame): string {
  if (game.gameType !== "playoff") return "";
  const round = roundOnly(game.roundLabel);
  if (/super bowl/i.test(round)) {
    return ` to win Super Bowl ${superBowlNumeral(Number(game.seasonLabel))}`;
  }
  const next = NEXT_ROUND[round.toLowerCase()];
  return next ? ` to reach the ${next}` : "";
}

/**
 * The dek: how the game turned, in one sentence, then the yardage. The two
 * facts the story used to state twice — the halftime score and the second
 * half — are said once, here (mak, 2026-09-30):
 *
 *   "Seattle erased a 7–0 halftime deficit, outscoring New England 13–3 after
 *    the break to win 13–10. The Seahawks finished with a narrow 285–277 edge
 *    in total offense and averaged 5.9 yards per play."
 */
function dek(game: ScoreboardGame, w: Side, l: Side): string {
  const halfW = w.running[1]!;
  const halfL = l.running[1]!;
  const secondW = w.running[3]! - halfW;
  const secondL = l.running[3]! - halfL;
  const ot = game.away.ot !== null || game.home.ot !== null;
  const final = `${w.total}–${l.total}`;
  const finish = ` to win ${final}`;
  const who = cap(w.place);
  const secondQuarterW = w.team.quarters![1]!;

  let first: string;
  if (ot) {
    // Level after regulation, so no half was "held on" to: the halftime
    // score, the tie that forced overtime, and who won it.
    const reg = w.running[3]!;
    first =
      (halfW > halfL
        ? `${who} led ${halfW}–${halfL} at halftime`
        : halfW < halfL
          ? `${who} trailed ${halfL}–${halfW} at halftime`
          : `The teams were tied ${halfW}–${halfL} at halftime`) +
      `, regulation ended ${reg}–${reg}, and the ${w.team.short} won it ${final} in overtime.`;
  } else if (halfW < halfL) {
    first =
      `${who} erased a ${halfL}–${halfW} halftime deficit` +
      (secondW > secondL ? `, outscoring ${l.place} ${secondW}–${secondL} after the break` : "") +
      finish +
      ".";
  } else if (halfW === halfL) {
    first =
      `${who} broke a ${halfW}–${halfL} halftime tie` +
      (secondW > secondL ? `, outscoring ${l.place} ${secondW}–${secondL} after the break` : "") +
      finish +
      ".";
  } else {
    const run =
      secondQuarterW >= 14 && secondQuarterW > halfW / 2 ? ` after a ${secondQuarterW}-point second quarter` : "";
    first =
      secondL > secondW
        ? `${who} led ${halfW}–${halfL} at halftime${run} and won ${final}, ` +
          `though ${l.place} took the second half ${secondL}–${secondW}.`
        : `${who} led ${halfW}–${halfL} at halftime${run}` +
          (secondW > secondL ? ` and outscored ${l.place} ${secondW}–${secondL} after the break` : "") +
          finish +
          ".";
  }

  const ws = w.stats;
  const ls = l.stats;
  const wy = ws?.totalYards ?? null;
  const ly = ls?.totalYards ?? null;
  if (wy === null || ly === null) return first;
  // Yards per play only when it points the same way as the result.
  const ypp =
    ws?.yardsPerPlay != null && ls?.yardsPerPlay != null && ws.yardsPerPlay > ls.yardsPerPlay
      ? ws.yardsPerPlay.toFixed(1)
      : null;
  let second: string;
  if (wy > ly) {
    const narrow = wy - ly <= 25 ? "a narrow " : "a ";
    second =
      `The ${w.team.short} finished with ${narrow}${wy}–${ly} edge in total offense` +
      (ypp ? ` and averaged ${ypp} yards per play.` : ".");
  } else if (wy < ly) {
    second =
      `${cap(l.place)} outgained the ${w.team.short} ${ly}–${wy}` +
      (ypp ? `, but the ${w.team.short} averaged ${ypp} yards per play.` : ".");
  } else {
    second = `Both teams finished with ${wy} yards` + (ypp ? `, and the ${w.team.short} averaged ${ypp} per play.` : ".");
  }
  return `${first} ${second}`;
}

/* ------------------------------------------------------------- paragraphs */

/** What the dek leaves out of the scoring: when the loser got on the board. */
function flow(l: Side): string {
  const firstL = l.team.quarters!.findIndex((points) => points > 0);
  if (l.total === 0) return `${cap(l.place)} never got on the board.`;
  if (firstL >= 2) return `${cap(l.place)} didn't get on the board until the ${ORDINALS[firstL]} quarter.`;
  return "";
}

/** The box score as sentences: third down, turnovers, clock. Yards are in the dek. */
function numbers(w: Side, l: Side): string {
  const ws = w.stats;
  const ls = l.stats;
  if (!ws || !ls) return "";
  const sentences: string[] = [];

  const better = [
    ws.totalYards !== null && ls.totalYards !== null && ws.totalYards > ls.totalYards,
    ws.yardsPerPlay !== null && ls.yardsPerPlay !== null && ws.yardsPerPlay > ls.yardsPerPlay,
    ws.turnovers !== null && ls.turnovers !== null && ws.turnovers < ls.turnovers,
    (ws.thirdDown?.percent ?? null) !== null &&
      (ls.thirdDown?.percent ?? null) !== null &&
      ws.thirdDown!.percent! > ls.thirdDown!.percent!,
  ];
  if (better.every(Boolean)) sentences.push("The gap showed up everywhere.");

  const loserParts: string[] = [];
  const third = ls.thirdDown;
  if (third && third.attempts > 0) {
    loserParts.push(`went ${third.made}-for-${third.attempts} on third down`);
  }
  if (ls.turnovers !== null && ls.turnovers > 0) {
    loserParts.push(`committed ${count(ls.turnovers, "turnover")}`);
  }
  const winnerParts: string[] = [];
  if (ws.possessionSeconds !== null && ws.possessionSeconds >= 32 * 60) {
    winnerParts.push(`kept the ball for ${clock(ws.possessionSeconds)}`);
  }
  if (ws.turnovers === 0) winnerParts.push("finished without a giveaway");

  if (loserParts.length) {
    sentences.push(
      `The ${l.team.short} ${list(loserParts)}` +
        (winnerParts.length ? `, while the ${w.team.short} ${list(winnerParts)}.` : "."),
    );
  } else if (winnerParts.length) {
    sentences.push(`The ${w.team.short} ${list(winnerParts)}.`);
  }

  return sentences.join(" ");
}

/** Where the win led, from the rest of the winner's postseason. */
function aftermath(input: RecapInput, w: Side): string {
  const { game } = input;
  const sentences = [...input.notes];
  const run = input.winnerPostseason;
  if (game.gameType !== "playoff" || !run) return sentences.join(" ");

  const round = roundOnly(game.roundLabel).toLowerCase();
  if (round === "super bowl") return sentences.join(" ");

  const ordered = [...run].sort((x, y) => x.week - y.week);
  const here = ordered.findIndex((g) => g.round.toLowerCase() === round);
  if (here === -1) return sentences.join(" ");
  const later = ordered.slice(here + 1).filter((g) => g.outcome !== null);
  if (later.length === 0) return sentences.join(" ");

  const subject = sentences.length ? "It" : "The win";
  const loss = later.find((g) => g.outcome === "L");
  const last = later[later.length - 1]!;
  if (!loss && /super bowl/i.test(last.round)) {
    const numeral = superBowlNumeral(Number(game.seasonLabel));
    sentences.push(
      round === "wild card"
        ? `${subject} started the run that ended with the ${w.team.short} winning Super Bowl ${numeral}.`
        : `The ${w.team.short} went on to win Super Bowl ${numeral}.`,
    );
  } else if (loss && loss.teamScore !== null && loss.opponentScore !== null) {
    sentences.push(
      `The ${possessive(w.team.short)} run ended in the ${loss.round}, ` +
        `a ${loss.opponentScore}–${loss.teamScore} loss to the ${loss.opponent}.`,
    );
  }
  return sentences.join(" ");
}

/* ------------------------------------------------------------------ build */

/** A tie: the score, the halftime score and the yardage, and nothing claimed about a winner. */
function tieRecap(input: RecapInput, away: Side, home: Side): Recap {
  const { game } = input;
  const round = game.gameType === "playoff" ? roundOnly(game.roundLabel) : game.roundLabel;
  const places = away.place === home.place ? `the ${away.team.short} and ${home.team.short}` : `${away.place} and ${home.place}`;
  const headline =
    `${away.team.short} ${away.total}, ${home.team.short} ${home.total}: ` +
    `${cap(places)} tie in ${game.seasonLabel} ${round}`;
  const ay = away.stats?.totalYards ?? null;
  const hy = home.stats?.totalYards ?? null;
  const ha = away.running[1]!;
  const hh = home.running[1]!;
  const half =
    ha === hh
      ? `The teams were tied ${ha}–${hh} at halftime`
      : `The ${(ha > hh ? away : home).team.short} led ${Math.max(ha, hh)}–${Math.min(ha, hh)} at halftime`;
  const dekText =
    half +
    (ay !== null && hy !== null
      ? `; the ${away.team.short} finished with ${ay} yards and the ${home.team.short} with ${hy}.`
      : ".");
  const paragraphs: string[] = [];
  if (input.next) {
    paragraphs.push(
      `The two teams meet again in ${input.next.label} of ${input.next.season}. ` +
        `If you roster anyone from either side, run the start/sit call in Redraft Command ` +
        `and it will weigh your lineup, your opponent and your league scoring, not only ` +
        `the player rankings.`,
    );
  }
  return { headline, dek: dekText, paragraphs, startSit: input.next !== null };
}

/** The recap, or null for a game that is not a final with a line score. */
export function buildRecap(input: RecapInput): Recap | null {
  const { game } = input;
  const result = scoreboardResult(game);
  if (!result) return null;

  const away = side(game.away, input.awayCity, input.homeCity, input.awayStats);
  const home = side(game.home, input.homeCity, input.awayCity, input.homeStats);
  if (!away || !home) return null;
  if (result.winner === null) return tieRecap(input, away, home);
  const [w, l] = result.winner === "home" ? [home, away] : [away, home];

  const headline =
    `${w.team.short} ${w.total}, ${l.team.short} ${l.total}: ${angle(game, w, l)}`;

  const paragraphs = [flow(l), numbers(w, l), aftermath(input, w)].filter(Boolean);

  // The closing prompt is about the next meeting, so it needs one.
  const startSit = input.next !== null;
  if (input.next) {
    paragraphs.push(
      `The two teams meet again in ${input.next.label} of ${input.next.season}. ` +
        `If you roster anyone from either side, run the start/sit call in Redraft Command ` +
        `and it will weigh your lineup, your opponent and your league scoring, not only ` +
        `the player rankings.`,
    );
  }

  return { headline, dek: dek(game, w, l), paragraphs, startSit };
}

/**
 * The section. An H2 for the headline, never an H1: the page's one H1 is the
 * hero's. "Redraft Command" in the last paragraph is the link to the start/sit
 * launcher.
 */
/** The words of the closing paragraph that carry the start/sit link. */
const START_SIT_PHRASE = "run the start/sit call in Redraft Command";

export interface RecapLinks {
  /** Everyone with a line in the game; the first mention of each is linked. */
  playerNames: string[];
  /** A player's page, or null when the site has none. */
  playerUrl: (name: string) => string | null;
}

interface Span {
  start: number;
  end: number;
  html: string;
}

/**
 * Where each linkable thing first appears in one paragraph, not overlapping.
 * Longer names claim first, so "Odell Beckham Jr." is not cut to "Odell Beckham".
 */
function linkSpans(text: string, names: string[], links: RecapLinks, seen: Set<string>): Span[] {
  const spans: Span[] = [];
  const free = (start: number, end: number): boolean =>
    spans.every((s) => end <= s.start || start >= s.end);
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (seen.has(name)) continue;
    let at = text.indexOf(name);
    while (at >= 0) {
      const before = text.charAt(at - 1);
      const after = text.charAt(at + name.length);
      const bounded = !/[\w]/.test(before) && !/[\w]/.test(after);
      if (bounded && free(at, at + name.length)) break;
      at = text.indexOf(name, at + 1);
    }
    if (at < 0) continue;
    const href = links.playerUrl(name);
    seen.add(name);
    if (!href) continue;
    spans.push({
      start: at,
      end: at + name.length,
      html:
        `<a class="sct-mu-story-player sct-player-link" href="${escapeHtml(href)}" target="_top">` +
        `${escapeHtml(name)}</a>`,
    });
  }
  return spans;
}

/** Keep a score or a yardage pair ("13–3", "285–277") on one line. On escaped text only. */
function keepScores(html: string): string {
  return html.replace(/\d+–\d+/g, (pair) => `<span class="sct-mu-score-pair">${pair}</span>`);
}

export function renderRecap(recap: Recap, links?: RecapLinks, after = ""): string {
  const seen = new Set<string>();
  const names = [...new Set(links?.playerNames ?? [])].filter(Boolean);
  const paragraph = (text: string, last: boolean): string => {
    const spans = links ? linkSpans(text, names, links, seen) : [];
    if (last && recap.startSit) {
      const at = text.indexOf(START_SIT_PHRASE);
      if (at >= 0 && spans.every((s) => at + START_SIT_PHRASE.length <= s.start || at >= s.end)) {
        spans.push({
          start: at,
          end: at + START_SIT_PHRASE.length,
          html:
            `<a class="sct-mu-story-cta" href="${escapeHtml(START_SIT_URL)}" data-cta="recap-startsit">` +
            `${escapeHtml(START_SIT_PHRASE)}</a>`,
        });
      }
    }
    spans.sort((a, b) => a.start - b.start);
    let html = "";
    let cursor = 0;
    for (const span of spans) {
      html += keepScores(escapeHtml(text.slice(cursor, span.start))) + span.html;
      cursor = span.end;
    }
    html += keepScores(escapeHtml(text.slice(cursor)));
    return `<p>${html}</p>`;
  };
  return (
    `<section class="sct-block sct-mu-story" id="recap" aria-labelledby="sct-mu-story-title">` +
    `<h2 class="sct-mu-story-title" id="sct-mu-story-title">${escapeHtml(recap.headline)}</h2>` +
    (recap.dek ? `<p class="sct-mu-story-dek">${keepScores(escapeHtml(recap.dek))}</p>` : "") +
    `<div class="sct-mu-story-body">` +
    recap.paragraphs.map((p, i) => paragraph(p, i === recap.paragraphs.length - 1)).join("") +
    `</div>` +
    after +
    `</section>`
  );
}
