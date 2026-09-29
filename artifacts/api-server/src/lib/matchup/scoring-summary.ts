/**
 * The scoring summary: every scoring play in order, grouped by quarter, with
 * the score after each one.
 *
 * Every sentence is written here from the structured play (scoring-plays.ts),
 * never copied from the feed, and every figure is added up here: the running
 * score, the lead changes and the subtitle's counts. The one thing checked
 * against the outside is the result — validateScoringPlays() compares the sum
 * of the plays with the hero's final and quarter line, and the page logs what
 * it finds, because a play the feed dropped would otherwise print a running
 * score that ends somewhere the scoreboard above it does not.
 *
 * Pure: the game, its plays and a link resolver in, HTML out.
 */

import { escapeHtml } from "../render";
import { isTouchdown, playPoints, type ScoringPlay } from "./scoring-plays";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

export interface ScoringSummaryInput {
  game: ScoreboardGame;
  plays: ScoringPlay[];
  /** A player's page, or null when the site has none. The same resolver every section uses. */
  playerUrl: (name: string) => string | null;
}

/* ------------------------------------------------------------ validation */

/**
 * What does not add up, as sentences for the log; empty when everything does.
 * Quarters are checked one by one, then overtime as a whole (the hero keeps a
 * single overtime figure however many periods were played).
 */
export function validateScoringPlays(game: ScoreboardGame, plays: ScoringPlay[]): string[] {
  const problems: string[] = [];
  for (const side of ["away", "home"] as const) {
    const team = game[side];
    const mine = plays.filter((p) => p.team === team.abbr);
    const total = mine.reduce((sum, p) => sum + playPoints(p), 0);
    const quarters = team.quarters ?? [];
    const final = team.quarters ? quarters.reduce((s, n) => s + n, 0) + (team.ot ?? 0) : team.score ?? null;
    if (final !== null && total !== final) {
      problems.push(`${team.abbr} scoring plays add up to ${total}, the final says ${final}`);
    }
    quarters.forEach((expected, i) => {
      const got = mine.filter((p) => p.quarter === i + 1).reduce((s, p) => s + playPoints(p), 0);
      if (got !== expected) {
        problems.push(`${team.abbr} Q${i + 1}: plays add up to ${got}, the line says ${expected}`);
      }
    });
    if (team.quarters && team.ot !== null) {
      const got = mine.filter((p) => p.quarter > 4).reduce((s, p) => s + playPoints(p), 0);
      if (got !== team.ot) problems.push(`${team.abbr} OT: plays add up to ${got}, the line says ${team.ot}`);
    }
  }
  const known = new Set([game.away.abbr, game.home.abbr]);
  for (const p of plays) {
    if (!known.has(p.team)) problems.push(`a scoring play is credited to ${p.team}, not in this game`);
  }
  return problems;
}

/* ------------------------------------------------------------- sentences */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function spell(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function count(n: number, one: string, many: string): string | null {
  return n > 0 ? `${spell(n)} ${n === 1 ? one : many}` : null;
}

/** "The Rams scored four touchdowns and two field goals; the Cardinals scored one touchdown and one field goal." */
export function scoringSubtitle(game: ScoreboardGame, plays: ScoringPlay[]): string {
  const result = scoreboardResult(game);
  const order: Array<"away" | "home"> = result?.winner === "home" ? ["home", "away"] : ["away", "home"];
  const clauses = order.map((side) => {
    const team = game[side];
    const mine = plays.filter((p) => p.team === team.abbr);
    const parts = [
      count(mine.filter(isTouchdown).length, "touchdown", "touchdowns"),
      count(mine.filter((p) => p.type === "field_goal").length, "field goal", "field goals"),
      count(mine.filter((p) => p.type === "safety").length, "safety", "safeties"),
    ].filter((x): x is string => x !== null);
    return parts.length ? `the ${team.short} scored ${list(parts)}` : `the ${team.short} did not score`;
  });
  const text = clauses.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** A sentence built from text and names; the full stop is not doubled after "Jr.". */
type Part = string | { name: string };

function yardsWord(n: number): string {
  return n === 1 ? "1 yard" : `${n} yards`;
}

function playParts(play: ScoringPlay, teamShort: string): Part[] {
  const { scorer, passer, yards } = play;
  const y = yards ?? null;
  switch (play.type) {
    case "pass_td":
      if (scorer && passer && y !== null) {
        return [{ name: passer }, ` throws a ${y}-yard touchdown pass to `, { name: scorer }];
      }
      break;
    case "rush_td":
      if (scorer && y !== null) return [{ name: scorer }, ` runs it in from ${yardsWord(y)} out`];
      break;
    case "field_goal":
      if (scorer && y !== null) return [{ name: scorer }, ` makes a ${y}-yard field goal`];
      if (scorer) return [{ name: scorer }, " makes a field goal"];
      return [`The ${teamShort} kick a field goal`];
    case "int_return_td":
    case "fumble_return_td":
    case "punt_return_td":
    case "kickoff_return_td": {
      const what = {
        int_return_td: "an interception",
        fumble_return_td: "a fumble",
        punt_return_td: "a punt",
        kickoff_return_td: "a kickoff",
      }[play.type];
      if (scorer && play.type === "fumble_return_td" && y === 0) {
        return [{ name: scorer }, " recovers a fumble in the end zone for a touchdown"];
      }
      if (scorer && y !== null) {
        return [{ name: scorer }, ` returns ${what} ${yardsWord(y)} for a touchdown`];
      }
      break;
    }
    case "safety":
      if (play.tackled) return ["Safety. ", { name: play.tackled }, " is tackled in the end zone"];
      return [`The ${teamShort} are awarded a safety`];
    case "other_td":
      if (scorer && y !== null) return [{ name: scorer }, ` scores a ${y}-yard touchdown`];
      break;
  }
  if (scorer) return [{ name: scorer }, " scores a touchdown"];
  return [`The ${teamShort} score a touchdown`];
}

function patParts(play: ScoringPlay): Part[] | null {
  const pat = play.pat;
  if (!pat || !isTouchdown(play)) return null;
  if (pat.type === "kick") {
    if (pat.result === "failed") return ["Extra point missed"];
    return pat.player ? [{ name: pat.player }, " adds the extra point"] : ["Extra point good"];
  }
  if (pat.result === "failed") return ["Two-point attempt fails"];
  if (pat.type === "two_point_pass" && pat.passer && pat.player) {
    return [{ name: pat.passer }, " finds ", { name: pat.player }, " for the two-point conversion"];
  }
  if (pat.player) return [{ name: pat.player }, " runs in the two-point conversion"];
  return ["Two-point conversion good"];
}

function sentence(parts: Part[], url: (name: string) => string | null): string {
  const html = parts
    .map((part) => {
      if (typeof part === "string") return escapeHtml(part);
      const href = url(part.name);
      return href
        ? `<a class="sct-ss-link sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(part.name)}</a>`
        : `<span class="sct-ss-name">${escapeHtml(part.name)}</span>`;
    })
    .join("");
  const last = parts[parts.length - 1];
  const lastText = typeof last === "string" ? last : last?.name ?? "";
  return lastText.endsWith(".") ? html : `${html}.`;
}

/** The play alone (no try) as linked HTML, for the win-probability list. */
export function playHtml(
  play: ScoringPlay,
  teamShort: string,
  url: (name: string) => string | null,
): string {
  return sentence(playParts(play, teamShort), url);
}

/** The play and its try as plain text, for tests and the log. */
export function playSentence(play: ScoringPlay, teamShort: string): string {
  const plain = (parts: Part[]): string => {
    const text = parts.map((p) => (typeof p === "string" ? p : p.name)).join("");
    return text.endsWith(".") ? text : `${text}.`;
  };
  const pat = patParts(play);
  return plain(playParts(play, teamShort)) + (pat ? ` ${plain(pat)}` : "");
}

/* ----------------------------------------------------------------- table */

export function periodName(q: number): string {
  if (q <= 4) return `${["1st", "2nd", "3rd", "4th"][q - 1]} quarter`;
  return q === 5 ? "Overtime" : `${q === 6 ? "2nd" : `${q - 4}th`} overtime`;
}

export interface ScoredPlay {
  play: ScoringPlay;
  away: number;
  home: number;
  change: "takes" | "ties" | null;
}

/** Each play with the score after it and whether it moved the lead. */
export function runningScore(game: ScoreboardGame, plays: ScoringPlay[]): ScoredPlay[] {
  let away = 0;
  let home = 0;
  return plays.map((play) => {
    const before = Math.sign(away - home);
    if (play.team === game.away.abbr) away += playPoints(play);
    else if (play.team === game.home.abbr) home += playPoints(play);
    const after = Math.sign(away - home);
    const change = after === before ? null : after === 0 ? "ties" : "takes";
    return { play, away, home, change };
  });
}

export function renderScoringSummary(input: ScoringSummaryInput): string {
  const { game, plays } = input;
  if (plays.length === 0) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const fillOf = (abbr: string): string =>
    abbr === game.home.abbr ? colors.home.fill : colors.away.fill;
  const shortOf = (abbr: string): string =>
    abbr === game.home.abbr ? game.home.short : abbr === game.away.abbr ? game.away.short : abbr;

  const scored = runningScore(game, plays);
  const lastPeriod = Math.max(
    4,
    ...plays.map((p) => p.quarter),
    game.away.ot !== null || game.home.ot !== null ? 5 : 4,
  );

  const score = (mine: number, theirs: number): string =>
    `<td class="sct-ss-score${mine >= theirs ? " is-ahead" : ""}">${mine}</td>`;

  let rows = "";
  for (let q = 1; q <= lastPeriod; q += 1) {
    rows +=
      `<tr class="sct-ss-period"><th colspan="5" scope="colgroup">${escapeHtml(periodName(q))}</th></tr>`;
    const inQuarter = scored.filter((s) => s.play.quarter === q);
    if (inQuarter.length === 0) {
      rows += `<tr class="sct-ss-none"><td colspan="5">No scoring</td></tr>`;
      continue;
    }
    for (const s of inQuarter) {
      const { play } = s;
      const pat = patParts(play);
      const pill =
        s.change === "takes"
          ? ` <span class="sct-ss-pill">Takes lead</span>`
          : s.change === "ties"
            ? ` <span class="sct-ss-pill">Ties game</span>`
            : "";
      rows +=
        `<tr class="sct-ss-play">` +
        `<td class="sct-ss-time">${escapeHtml(play.clock)}</td>` +
        `<td class="sct-ss-team"><span class="sct-ss-chip" style="${escapeHtml(`--ss-fill:${fillOf(play.team)}`)}">` +
        `${escapeHtml(play.team)}</span></td>` +
        `<td class="sct-ss-desc">` +
        sentence(playParts(play, shortOf(play.team)), input.playerUrl) +
        (pat ? ` ${sentence(pat, input.playerUrl)}` : "") +
        pill +
        `</td>` +
        score(s.away, s.home) +
        score(s.home, s.away) +
        `</tr>`;
    }
  }

  return (
    `<section class="sct-rb-section sct-ss" aria-labelledby="sct-rb-scoring">` +
    `<h2 class="sct-rb-h2" id="sct-rb-scoring">Scoring summary</h2>` +
    `<p class="sct-rb-sub">${escapeHtml(scoringSubtitle(game, plays))}</p>` +
    `<div class="sct-ss-wrap">` +
    `<table class="sct-ss-table">` +
    `<caption class="sct-rb-sr">${escapeHtml(`Scoring plays, ${game.away.short} vs ${game.home.short}`)}</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="sct-ss-h-time">Time</th>` +
    `<th scope="col" class="sct-ss-h-team">Team</th>` +
    `<th scope="col" class="sct-ss-h-play">Play</th>` +
    `<th scope="col" class="sct-ss-h-score">${escapeHtml(game.away.abbr)}</th>` +
    `<th scope="col" class="sct-ss-h-score">${escapeHtml(game.home.abbr)}</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>` +
    `</section>`
  );
}
