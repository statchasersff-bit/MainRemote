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
 * Redraft Command's start/sit launcher. The same destination as the player
 * pages' "Should I Start or Sit" button (STARTSIT_BASE in player-render.ts).
 */
export const START_SIT_URL =
  "https://statchasers.com/redraft-command/launch/who-should-i-start/";

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

function dek(game: ScoreboardGame, w: Side, l: Side): string {
  const clauses: string[] = [];
  const halfW = w.running[1]!;
  const halfL = l.running[1]!;
  if (halfW - halfL >= 7) clauses.push(`led ${halfW}–${halfL} at halftime`);
  else if (halfW < halfL) clauses.push(`trailed ${halfL}–${halfW} at halftime`);

  const wt = w.stats?.turnovers ?? null;
  const lt = l.stats?.turnovers ?? null;
  if (wt === 0 && lt !== null && lt > 0) clauses.push("never turned the ball over");
  else if (wt !== null && lt !== null && lt - wt >= 2) {
    clauses.push(`won the turnover battle ${lt}–${wt}`);
  }

  const third = l.stats?.thirdDown ?? null;
  if (third && third.made === 0 && third.attempts >= 3) {
    clauses.push(`held ${l.place} without a third-down conversion`);
  }

  if (clauses.length < 2) {
    const wy = w.stats?.totalYards ?? null;
    const ly = l.stats?.totalYards ?? null;
    if (wy !== null && ly !== null && wy - ly >= 100) {
      clauses.push(`outgained ${l.place} ${wy}–${ly}`);
    }
  }

  const to = destination(game);
  // The halftime score alone is the recap's own first sentence; a dek that
  // only repeats it is dropped.
  if (clauses.length === 1 && halfW - halfL >= 7 && !to) return "";
  if (clauses.length === 0) {
    return to ? `The ${w.team.short} beat the ${l.team.short}${to}.` : "";
  }
  return `The ${w.team.short} ${list(clauses)}${to}.`;
}

/* ------------------------------------------------------------- paragraphs */

/** How the scoring went, from the quarters alone. */
function flow(game: ScoreboardGame, w: Side, l: Side): string {
  const sentences: string[] = [];
  const halfW = w.running[1]!;
  const halfL = l.running[1]!;
  const secondQuarterW = w.team.quarters![1]!;

  if (halfW > halfL) {
    sentences.push(
      `${cap(w.place)} led ${halfW}–${halfL} at halftime` +
        (secondQuarterW >= 14 && secondQuarterW > halfW / 2
          ? ` after scoring ${secondQuarterW} points in the second quarter.`
          : "."),
    );
  } else if (halfW < halfL) {
    sentences.push(`${cap(l.place)} led ${halfL}–${halfW} at halftime.`);
  } else {
    sentences.push(`The teams were level at ${halfW}–${halfL} at halftime.`);
  }

  // When the loser first scored, if it took them into the second half.
  const firstL = l.team.quarters!.findIndex((points) => points > 0);
  if (l.total === 0) {
    sentences.push(`${cap(l.place)} never got on the board.`);
  } else if (firstL >= 2) {
    sentences.push(`${cap(l.place)} didn't get on the board until the ${ORDINALS[firstL]} quarter.`);
  }

  const secondHalfW = w.running[3]! - halfW;
  const secondHalfL = l.running[3]! - halfL;
  // The winner is the subject of the first sentence already, so the one
  // after it names them by nickname rather than by the same city twice.
  if (halfW <= halfL) {
    sentences.push(
      `The ${w.team.short} outscored ${l.place} ${secondHalfW}–${secondHalfL} after the break.`,
    );
  } else if (secondHalfL > secondHalfW) {
    sentences.push(
      `${cap(l.place)} won the second half ${secondHalfL}–${secondHalfW}, ` +
        `but the lead held.`,
    );
  } else if (secondHalfW > 0) {
    sentences.push(`The ${w.team.short} added ${secondHalfW} more after the break.`);
  }

  const ot = w.team.ot;
  if (ot !== null && ot > 0) {
    sentences.push(`${cap(w.place)} won it with ${count(ot, "point")} in overtime.`);
  }

  return sentences.join(" ");
}

/** The box score as sentences: yards, efficiency, third down, turnovers, clock. */
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

  // Yards from the side of whoever gained more, and yards per play only when
  // it points the same way as the result: "averaged 6.2 against 6.3" is not
  // a thing a winner did.
  const ypp =
    ws.yardsPerPlay !== null && ls.yardsPerPlay !== null && ws.yardsPerPlay > ls.yardsPerPlay
      ? `${ws.yardsPerPlay.toFixed(1)} yards per play against ${ls.yardsPerPlay.toFixed(1)}`
      : "";
  if (ws.totalYards !== null && ls.totalYards !== null) {
    if (ws.totalYards >= ls.totalYards) {
      sentences.push(
        `The ${w.team.short} gained ${ws.totalYards} yards to ${possessive(l.place)} ${ls.totalYards}` +
          (ypp ? ` and averaged ${ypp}.` : "."),
      );
    } else {
      sentences.push(
        `${cap(l.place)} outgained the ${w.team.short} ${ls.totalYards}–${ws.totalYards}` +
          (ypp ? `, but the ${w.team.short} averaged ${ypp}.` : "."),
      );
    }
  }

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

/** The recap, or null for a game that is not a final with a line score. */
export function buildRecap(input: RecapInput): Recap | null {
  const { game } = input;
  const result = scoreboardResult(game);
  if (!result || result.winner === null) return null;

  const away = side(game.away, input.awayCity, input.homeCity, input.awayStats);
  const home = side(game.home, input.homeCity, input.awayCity, input.homeStats);
  if (!away || !home) return null;
  const [w, l] = result.winner === "home" ? [home, away] : [away, home];

  const headline =
    `${w.team.short} ${w.total}, ${l.team.short} ${l.total}: ${angle(game, w, l)}`;

  const paragraphs = [flow(game, w, l), numbers(w, l), aftermath(input, w)].filter(Boolean);

  // The prompt closes every recap; only the sentence about the next meeting
  // depends on there being one.
  const startSit = true;
  paragraphs.push(
    (input.next ? `The two teams meet again in ${input.next.label} of ${input.next.season}. ` : "") +
      `If you roster anyone from either side, run the start/sit call in Redraft Command ` +
      `and it will weigh your lineup, your opponent and your league scoring, not only ` +
      `the player rankings.`,
  );

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

export function renderRecap(recap: Recap, links?: RecapLinks): string {
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
      html += escapeHtml(text.slice(cursor, span.start)) + span.html;
      cursor = span.end;
    }
    html += escapeHtml(text.slice(cursor));
    return `<p>${html}</p>`;
  };
  return (
    `<section class="sct-block sct-mu-story" aria-labelledby="sct-mu-story-title">` +
    `<h2 class="sct-mu-story-title" id="sct-mu-story-title">${escapeHtml(recap.headline)}</h2>` +
    (recap.dek ? `<p class="sct-mu-story-dek">${escapeHtml(recap.dek)}</p>` : "") +
    `<h3 class="sct-mu-h3 sct-mu-story-kicker">Game recap</h3>` +
    `<div class="sct-mu-story-body">` +
    recap.paragraphs.map((p, i) => paragraph(p, i === recap.paragraphs.length - 1)).join("") +
    `</div>` +
    `</section>`
  );
}
