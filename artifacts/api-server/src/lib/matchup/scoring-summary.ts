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

/* ------------------------------------------------------ scorebook lines */

/**
 * The scorebook line for the table: the scoring action on one line, the try
 * under it in small type (mak, 2026-09-30).
 *
 *   Drew Lock → Jaxon Smith-Njigba, 45-yard TD
 *   Jason Myers XP
 */
function compactParts(play: ScoringPlay, teamShort: string): Part[] {
  const { scorer, passer, yards } = play;
  const y = yards ?? null;
  switch (play.type) {
    case "pass_td":
      if (scorer && passer && y !== null) return [{ name: passer }, " → ", { name: scorer }, `, ${y}-yard TD`];
      break;
    case "rush_td":
      if (scorer && y !== null) return [{ name: scorer }, ` ${y}-yard TD run`];
      break;
    case "field_goal":
      if (scorer && y !== null) return [{ name: scorer }, ` ${y}-yard FG`];
      if (scorer) return [{ name: scorer }, " FG"];
      return [`${teamShort} FG`];
    case "int_return_td":
    case "fumble_return_td":
    case "punt_return_td":
    case "kickoff_return_td": {
      const what = {
        int_return_td: "interception return",
        fumble_return_td: "fumble return",
        punt_return_td: "punt return",
        kickoff_return_td: "kickoff return",
      }[play.type];
      if (scorer && play.type === "fumble_return_td" && y === 0) return [{ name: scorer }, " fumble recovery TD"];
      if (scorer && y !== null) return [{ name: scorer }, ` ${y}-yard ${what} TD`];
      break;
    }
    case "safety":
      return ["Safety"];
    case "other_td":
      if (scorer && y !== null) return [{ name: scorer }, ` ${y}-yard TD`];
      break;
  }
  if (scorer) return [{ name: scorer }, " TD"];
  return [`${teamShort} TD`];
}

/** The small line under it: the try, or who was tackled for a safety; null when there is nothing. */
function compactDetail(play: ScoringPlay): Part[] | null {
  if (play.type === "safety") return play.tackled ? [{ name: play.tackled }, " tackled in the end zone"] : null;
  const pat = play.pat;
  if (!pat || !isTouchdown(play)) return null;
  if (pat.type === "kick") {
    if (pat.result === "failed") return ["XP missed"];
    return pat.player ? [{ name: pat.player }, " XP"] : ["XP good"];
  }
  if (pat.result === "failed") return ["2-pt try failed"];
  if (pat.type === "two_point_pass" && pat.passer && pat.player) {
    return [{ name: pat.passer }, " → ", { name: pat.player }, ", 2-pt conversion"];
  }
  if (pat.player) return [{ name: pat.player }, " 2-pt run"];
  return ["2-pt conversion good"];
}

/** Parts as HTML with no closing full stop: scorebook lines are not sentences. */
function fragment(parts: Part[], url: (name: string) => string | null): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return escapeHtml(part);
      const href = url(part.name);
      return href
        ? `<a class="sct-ss-link sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(part.name)}</a>`
        : `<span class="sct-ss-name">${escapeHtml(part.name)}</span>`;
    })
    .join("");
}

/** The scorebook line as linked HTML ("Drew Lock → Jaxon Smith-Njigba, 45-yard TD"), for other sections. */
export function playLineHtml(play: ScoringPlay, teamShort: string, url: (name: string) => string | null): string {
  return fragment(compactParts(play, teamShort), url);
}

/** A few words for a chart label: "Lock → Smith-Njigba TD", "Myers 26-yd FG". */
export function playLabel(play: ScoringPlay, teamShort: string): string {
  const last = (name: string): string => {
    const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(/\s+/);
    return parts[parts.length - 1] ?? name;
  };
  const { scorer, passer, yards } = play;
  switch (play.type) {
    case "pass_td":
      if (scorer && passer) return `${last(passer)} → ${last(scorer)} TD`;
      break;
    case "rush_td":
      if (scorer) return `${last(scorer)} TD run`;
      break;
    case "field_goal":
      if (scorer) return yards != null ? `${last(scorer)} ${yards}-yd FG` : `${last(scorer)} FG`;
      return `${teamShort} FG`;
    case "safety":
      return `${teamShort} safety`;
  }
  return scorer ? `${last(scorer)} TD` : `${teamShort} TD`;
}

/** A key-swing line, short: "Lock → Smith-Njigba, 45-yd TD", "Myers 26-yd FG". */
export function playShort(play: ScoringPlay, teamShort: string): string {
  const last = (name: string): string => {
    const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(/\s+/);
    return parts[parts.length - 1] ?? name;
  };
  const { scorer, passer, yards } = play;
  const yd = yards != null ? `${yards}-yd ` : "";
  switch (play.type) {
    case "pass_td":
      if (scorer && passer) return `${last(passer)} → ${last(scorer)}, ${yd}TD`;
      break;
    case "rush_td":
      if (scorer) return `${last(scorer)} ${yd}TD run`;
      break;
    case "field_goal":
      return scorer ? `${last(scorer)} ${yd}FG` : `${teamShort} FG`;
    case "int_return_td":
      if (scorer) return `${last(scorer)} ${yd}pick-six`;
      break;
    case "safety":
      return `${teamShort} safety`;
  }
  return scorer ? `${last(scorer)} ${yd}TD` : `${teamShort} TD`;
}

/** The scorebook line and its detail as plain text, for tests. */
export function playLine(play: ScoringPlay, teamShort: string): { line: string; detail: string | null } {
  const plain = (parts: Part[]): string => parts.map((p) => (typeof p === "string" ? p : p.name)).join("");
  const detail = compactDetail(play);
  return { line: plain(compactParts(play, teamShort)), detail: detail ? plain(detail) : null };
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
  /**
   * What the table's pill says: the lead taken, tied or extended, and the
   * winner's go-ahead score it never gave back, when that came in the fourth
   * quarter or overtime. Null for a score that only cut into a lead.
   */
  tag: "takes" | "ties" | "extends" | "winner" | null;
}

/** Each play with the score after it and whether it moved the lead. */
export function runningScore(game: ScoreboardGame, plays: ScoringPlay[]): ScoredPlay[] {
  let away = 0;
  let home = 0;
  const scored: ScoredPlay[] = plays.map((play) => {
    const before = Math.sign(away - home);
    if (play.team === game.away.abbr) away += playPoints(play);
    else if (play.team === game.home.abbr) home += playPoints(play);
    const after = Math.sign(away - home);
    const change: ScoredPlay["change"] = after === before ? null : after === 0 ? "ties" : "takes";
    const scorerSign = play.team === game.away.abbr ? 1 : play.team === game.home.abbr ? -1 : 0;
    const tag: ScoredPlay["tag"] = change ?? (before !== 0 && before === scorerSign ? "extends" : null);
    return { play, away, home, change, tag };
  });
  // The game winner: the winner's last lead-taking score, if the lead held
  // from there to the end and it came late (fourth quarter or overtime).
  const result = scoreboardResult(game);
  if (result?.winner) {
    const winnerAbbr = game[result.winner].abbr;
    const at = scored.map((s) => s.change).lastIndexOf("takes");
    const last = scored[at];
    if (last && last.play.team === winnerAbbr && last.play.quarter >= 4) last.tag = "winner";
  }
  return scored;
}

const TAG_LABEL: Record<NonNullable<ScoredPlay["tag"]>, string> = {
  takes: "Takes lead",
  ties: "Ties game",
  extends: "Extends lead",
  winner: "Game winner",
};

export function renderScoringSummary(input: ScoringSummaryInput): string {
  const { game, plays } = input;
  if (plays.length === 0) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const fillOf = (abbr: string): string =>
    abbr === game.home.abbr ? colors.home.fill : colors.away.fill;
  const inkOf = (abbr: string): string =>
    abbr === game.home.abbr ? colors.home.ink : colors.away.ink;
  const shortOf = (abbr: string): string =>
    abbr === game.home.abbr ? game.home.short : abbr === game.away.abbr ? game.away.short : abbr;

  const scored = runningScore(game, plays);
  const lastPeriod = Math.max(
    4,
    ...plays.map((p) => p.quarter),
    game.away.ot !== null || game.home.ot !== null ? 5 : 4,
  );

  // The side ahead (or level) in its team's colour, as everywhere on the page.
  const score = (mine: number, theirs: number, abbr: string): string =>
    `<td class="sct-ss-score${mine >= theirs ? " is-ahead" : ""}" style="${escapeHtml(`--ss-ink:${inkOf(abbr)}`)}">${mine}</td>`;

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
      const detail = compactDetail(play);
      const pill = s.tag ? ` <span class="sct-ss-pill is-${s.tag}">${TAG_LABEL[s.tag]}</span>` : "";
      rows +=
        `<tr class="sct-ss-play">` +
        `<td class="sct-ss-time">${escapeHtml(play.clock)}</td>` +
        `<td class="sct-ss-team"><span class="sct-ss-chip" style="${escapeHtml(`--ss-fill:${fillOf(play.team)}`)}">` +
        `${escapeHtml(play.team)}</span></td>` +
        `<td class="sct-ss-desc">` +
        `<span class="sct-ss-line">${fragment(compactParts(play, shortOf(play.team)), input.playerUrl)}${pill}</span>` +
        (detail ? `<span class="sct-ss-detail">${fragment(detail, input.playerUrl)}</span>` : "") +
        `</td>` +
        score(s.away, s.home, game.away.abbr) +
        score(s.home, s.away, game.home.abbr) +
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
