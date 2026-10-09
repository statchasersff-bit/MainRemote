/**
 * How the game swung: the home side's win probability from kickoff to the
 * final whistle, as a server-drawn chart and a list of the plays that moved it.
 *
 * The score-only model. With nothing but the score, the clock and the closing
 * line, the home side's chance is
 *
 *   WP = Φ((margin + spread × f) / (13.5 × √f))
 *
 * where margin is home minus away, spread is the points the home side was
 * favored by (negative when it was the underdog), and f is the fraction of
 * the game left. At f = 0 it is 1, 0 or ½. Overtime is a fresh period of its
 * own length, with f measured against a full game so a tied overtime starts
 * close to a coin flip. The line drifts as the clock runs and jumps only at a
 * score, and the page says so: a sack on third down moves nothing here.
 *
 * Pure: the game, its scoring plays and the line in, HTML out.
 */

import { escapeHtml } from "../render";
import type { GameOdds } from "./boxscore";
import { playPoints, type ScoringPlay } from "./scoring-plays";
import { playLabel, playShort } from "./scoring-summary";
import { pairColors, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

export interface WinProbabilityInput {
  game: ScoreboardGame;
  plays: ScoringPlay[];
  odds: GameOdds | null;
  playerUrl: (name: string) => string | null;
}

const REGULATION = 3600;
const QUARTER = 900;
const SIGMA = 13.5;

/* ------------------------------------------------------------------ model */

/** The standard normal CDF, to about seven places (Abramowitz and Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** The home side's chance, from the margin, its spread in points favored and the fraction left. */
export function homeWinProbability(margin: number, spread: number, fraction: number): number {
  if (fraction <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return normalCdf((margin + spread * fraction) / (SIGMA * Math.sqrt(fraction)));
}

/** Points the home side was favored by: 3.5 for "LAR −3.5" at home, −3.5 for the road favorite. */
export function homeSpread(game: ScoreboardGame, odds: GameOdds | null): number {
  if (!odds || odds.favorite === null) return 0;
  if (odds.favorite === game.home.abbr) return odds.line;
  if (odds.favorite === game.away.abbr) return -odds.line;
  return 0;
}

function overtimeLength(game: ScoreboardGame): number {
  // Ten minutes in the regular season since 2017; the postseason still plays fifteen.
  return game.gameType === "playoff" ? QUARTER : 600;
}

function clockSeconds(clock: string): number {
  const [m, s] = clock.split(":").map((n) => Number.parseInt(n, 10));
  return (Number.isFinite(m) ? m! : 0) * 60 + (Number.isFinite(s) ? s! : 0);
}

/** Seconds played when a play happened. */
function elapsedAt(game: ScoreboardGame, quarter: number, clock: string): number {
  const left = clockSeconds(clock);
  if (quarter <= 4) return (quarter - 1) * QUARTER + (QUARTER - Math.min(left, QUARTER));
  const ot = overtimeLength(game);
  return REGULATION + (quarter - 5) * ot + (ot - Math.min(left, ot));
}

/** The fraction of a full game left at `elapsed`, restarting at each overtime period. */
function fractionLeft(game: ScoreboardGame, elapsed: number, end: number): number {
  if (elapsed >= end) return 0;
  if (elapsed < REGULATION) return (REGULATION - elapsed) / REGULATION;
  const ot = overtimeLength(game);
  const periodEnd = REGULATION + (Math.floor((elapsed - REGULATION) / ot) + 1) * ot;
  return (Math.min(periodEnd, end) - elapsed) / REGULATION;
}

export interface WpSwing {
  play: ScoringPlay;
  elapsed: number;
  before: number;
  after: number;
  /** The swing in whole percentage points, home side's terms: what the list prints. */
  points: number;
}

export interface WpModel {
  spread: number;
  kickoff: number;
  /** Where the chart is drawn to: the end of regulation, or of the last overtime played. */
  end: number;
  swings: WpSwing[];
  /** [seconds, home WP] pairs, jumps as two points at one time. */
  curve: Array<[number, number]>;
}

export function winProbabilityModel(input: Pick<WinProbabilityInput, "game" | "plays" | "odds">): WpModel | null {
  const { game, plays } = input;
  const result = scoreboardResult(game);
  if (!result) return null;
  const spread = homeSpread(game, input.odds);
  const lastPeriod = Math.max(4, ...plays.map((p) => p.quarter), game.home.ot !== null || game.away.ot !== null ? 5 : 4);
  // The last overtime ends when its winning score does, which is sudden death.
  const ot = overtimeLength(game);
  const lastPlay = plays[plays.length - 1];
  const end =
    lastPeriod > 4
      ? lastPlay && lastPlay.quarter === lastPeriod
        ? elapsedAt(game, lastPlay.quarter, lastPlay.clock)
        : REGULATION + (lastPeriod - 4) * ot
      : REGULATION;

  const events = plays
    .map((play) => ({ play, elapsed: elapsedAt(game, play.quarter, play.clock) }))
    .sort((a, b) => a.elapsed - b.elapsed);

  let margin = 0;
  const swings: WpSwing[] = [];
  const curve: Array<[number, number]> = [];
  let t = 0;
  const kickoff = homeWinProbability(0, spread, 1);
  const sampleTo = (until: number): void => {
    for (; t < until; t += 60) curve.push([t, homeWinProbability(margin, spread, fractionLeft(game, t, end))]);
    t = until;
  };

  for (const { play, elapsed } of events) {
    sampleTo(elapsed);
    const f = fractionLeft(game, elapsed, end);
    const before = homeWinProbability(margin, spread, f);
    margin += (play.team === game.home.abbr ? 1 : play.team === game.away.abbr ? -1 : 0) * playPoints(play);
    const after = homeWinProbability(margin, spread, f);
    curve.push([elapsed, before], [elapsed, after]);
    swings.push({
      play,
      elapsed,
      before,
      after,
      points: Math.round((after - before) * 100),
    });
  }
  sampleTo(end);
  curve.push([end, homeWinProbability(margin, spread, 0)]);
  return { spread, kickoff, end, swings, curve };
}

/** ">99%" and "<1%" at the ends, so a game still going never reads as settled. */
export function formatWp(p: number): string {
  if (p > 0.995) return ">99%";
  if (p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

/* ----------------------------------------------------------------- copy */

function periodPhrase(elapsed: number): string {
  if (elapsed < 1800) return "before halftime";
  if (elapsed < 2700) return "in the third quarter";
  if (elapsed < REGULATION) return "in the fourth quarter";
  return "in overtime";
}

/**
 * The section's story in one sentence (mak, 2026-09-30): where the home side
 * opened, the one turn worth saying, and how it ended.
 * "Seattle opened at 59% win probability, fell as low as 11%, then rallied to win."
 */
export function wpSubtitle(game: ScoreboardGame, model: WpModel): string {
  const result = scoreboardResult(game);
  const opened = `${homeCity(game)} opened at ${Math.round(model.kickoff * 100)}% win probability`;
  const points = model.curve;
  if (result?.winner === "home") {
    const low = Math.min(...points.map(([, p]) => p));
    const safe = points.find(([, p]) => p >= 0.98);
    if (low < 0.2) return `${opened}, fell as low as ${formatWp(low)}, then rallied to win.`;
    if (safe) return `${opened} and passed 98% ${periodPhrase(safe[0])} on the way to the win.`;
    return `${opened} and held on to win.`;
  }
  if (result?.winner === "away") {
    const high = Math.max(...points.map(([, p]) => p));
    const gone = points.find(([, p]) => p <= 0.02);
    if (high > 0.8) return `${opened}, climbed as high as ${formatWp(high)}, then lost.`;
    if (gone) return `${opened} and fell below 2% ${periodPhrase(gone[0])}.`;
    return `${opened} and lost a game that stayed in reach.`;
  }
  return `${opened}; the game finished level.`;
}

function homeCity(game: ScoreboardGame): string {
  // The hero's team object has no city; the name minus the nickname is it.
  const name = game.home.name;
  return name.endsWith(` ${game.home.short}`) ? name.slice(0, -game.home.short.length - 1) : game.home.short;
}

/* ----------------------------------------------------------------- chart */

const W = 640;
const H = 190;
const PAD = { left: 40, right: 10, top: 12, bottom: 26 };

function chart(game: ScoreboardGame, model: WpModel, colors: ReturnType<typeof pairColors>): string {
  const x = (s: number): number => PAD.left + (s / model.end) * (W - PAD.left - PAD.right);
  const y = (p: number): number => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const r = (n: number): string => n.toFixed(1);

  const line = model.curve.map(([s, p], i) => `${i ? "L" : "M"}${r(x(s))} ${r(y(p))}`).join(" ");
  const area = `${line} L${r(x(model.end))} ${r(y(0))} L${r(x(0))} ${r(y(0))} Z`;

  const periods: Array<{ at: number; label: string }> = [0, 1, 2, 3].map((q) => ({ at: q * QUARTER, label: `Q${q + 1}` }));
  const ot = overtimeLength(game);
  for (let at = REGULATION; at < model.end; at += ot) periods.push({ at, label: "OT" });

  const grid = periods
    .map(
      ({ at, label }, i) =>
        (i ? `<line class="sct-wp-grid" x1="${r(x(at))}" x2="${r(x(at))}" y1="${PAD.top}" y2="${H - PAD.bottom}"/>` : "") +
        `<text class="sct-wp-axis" x="${r(x(at + Math.min(QUARTER, model.end - at) / 2))}" y="${H - 8}" text-anchor="middle">${label}</text>`,
    )
    .join("");
  const yLabels = [1, 0.5, 0]
    .map((p) => `<text class="sct-wp-axis" x="${PAD.left - 6}" y="${r(y(p) + 4)}" text-anchor="end">${p * 100}%</text>`)
    .join("");
  const dots = model.swings
    .map((s) => {
      const fill = s.play.team === game.home.abbr ? colors.home.fill : colors.away.fill;
      return `<circle cx="${r(x(s.elapsed))}" cy="${r(y(s.after))}" r="4" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`;
    })
    .join("");

  const desc = wpDescription(game, model);
  return (
    `<svg class="sct-wp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="sct-wp-t sct-wp-d" preserveAspectRatio="none">` +
    `<title id="sct-wp-t">${escapeHtml(`${game.home.short} win probability by game minute`)}</title>` +
    `<desc id="sct-wp-d">${escapeHtml(desc)}</desc>` +
    grid +
    `<line class="sct-wp-half" x1="${PAD.left}" x2="${W - PAD.right}" y1="${r(y(0.5))}" y2="${r(y(0.5))}"/>` +
    yLabels +
    // Painted through style, not attributes, so the page's dark theme can swap the ink.
    `<path d="${area}" style="fill:${colors.home.ink}" fill-opacity="0.14" stroke="none"/>` +
    `<path d="${line}" fill="none" style="stroke:${colors.home.ink}" stroke-width="3.25" stroke-linejoin="round"/>` +
    dots +
    `</svg>`
  );
}

function wpDescription(game: ScoreboardGame, model: WpModel): string {
  const half = model.curve.filter(([s]) => s <= 1800).pop();
  const final = model.curve[model.curve.length - 1];
  return (
    `${game.home.short} started at ${formatWp(model.kickoff)}` +
    (half ? `, stood at ${formatWp(half[1])} at halftime` : "") +
    (final ? ` and finished at ${final[1] >= 0.5 ? "100%" : "0%"}` : "") +
    `, across ${model.swings.length} scoring play${model.swings.length === 1 ? "" : "s"}.`
  );
}

/* ---------------------------------------------------------------- section */

export function renderWinProbability(input: WinProbabilityInput): string {
  const { game } = input;
  if (input.plays.length === 0) return "";
  const model = winProbabilityModel(input);
  if (!model) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const shortOf = (abbr: string): string =>
    abbr === game.home.abbr ? game.home.short : abbr === game.away.abbr ? game.away.short : abbr;

  const deciding = model.swings
    .filter((s) => Math.abs(s.after - s.before) >= 0.01)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.elapsed - b.elapsed)
    .slice(0, 5)
    // Picked by size, shown in the order they happened (spec 11b).
    .sort((a, b) => a.elapsed - b.elapsed);
  // Key swings, compact, beside the chart (mak, 2026-09-30): the swing, the
  // play in a few words, the win probability it moved, the clock tiny.
  const list = deciding.length
    ? `<div class="sct-wp-side">` +
      `<h3 class="sct-rb-h3">Key swings</h3>` +
      `<ol class="sct-wp-plays">` +
      deciding
        .map((s) => {
          const up = s.points > 0;
          const ink = up ? colors.home.ink : colors.away.ink;
          const period = s.play.quarter <= 4 ? `Q${s.play.quarter}` : "OT";
          return (
            `<li class="sct-wp-play">` +
            `<b class="sct-wp-swing" style="color:${ink}">${up ? "+" : "−"}${Math.abs(s.points)}</b>` +
            `<span class="sct-wp-text">${escapeHtml(playShort(s.play, shortOf(s.play.team)))}</span>` +
            `<span class="sct-wp-move">${escapeHtml(`${formatWp(s.before)} → ${formatWp(s.after)}`)}` +
            `<span class="sct-wp-when">${escapeHtml(`${period} ${s.play.clock}`)}</span></span>` +
            `</li>`
          );
        })
        .join("") +
      `</ol>` +
      `<p class="sct-wp-unit">${escapeHtml(`Swing in ${game.home.short} win probability, in points`)}</p>` +
      `</div>`
    : "";

  // Labels on the chart at the two or three biggest swings, each ten points
  // or more, as HTML over the drawing so the type is never stretched.
  const labels = [...model.swings]
    .filter((s) => Math.abs(s.after - s.before) >= 0.1)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 3)
    .map((s) => {
      const left = ((PAD.left + (s.elapsed / model.end) * (W - PAD.left - PAD.right)) / W) * 100;
      const top = ((PAD.top + (1 - s.after) * (H - PAD.top - PAD.bottom)) / H) * 100;
      const cls = [
        "sct-wp-label",
        top < 22 ? "is-below" : "",
        left > 82 ? "is-end" : left < 18 ? "is-start" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        `<span class="${cls}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%" aria-hidden="true">` +
        `${escapeHtml(playLabel(s.play, shortOf(s.play.team)))}</span>`
      );
    })
    .join("");

  // The low point (or, for a home side that lost, the high point) the story
  // sentence names, marked where it happened.
  const result = scoreboardResult(game);
  const lowAt = model.curve.reduce((m, pt) => (pt[1] < m[1] ? pt : m), model.curve[0]!);
  const highAt = model.curve.reduce((m, pt) => (pt[1] > m[1] ? pt : m), model.curve[0]!);
  const mark =
    result?.winner === "home" && lowAt[1] < 0.2
      ? { at: lowAt, text: `Low: ${formatWp(lowAt[1])}` }
      : result?.winner === "away" && highAt[1] > 0.8
        ? { at: highAt, text: `High: ${formatWp(highAt[1])}` }
        : null;
  const extreme = mark
    ? (() => {
        const left = ((PAD.left + (mark.at[0] / model.end) * (W - PAD.left - PAD.right)) / W) * 100;
        const top = ((PAD.top + (1 - mark.at[1]) * (H - PAD.top - PAD.bottom)) / H) * 100;
        const below = mark.text.startsWith("Low");
        return (
          `<span class="sct-wp-label is-extreme${below ? " is-below" : ""}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%" aria-hidden="true">` +
          `${escapeHtml(mark.text)}</span>`
        );
      })()
    : "";

  return (
    `<section class="sct-rb-section sct-wp" aria-labelledby="wp">` +
    `<h2 class="sct-rb-h2" id="wp">How the game swung</h2>` +
    `<p class="sct-wp-story">${escapeHtml(wpSubtitle(game, model))}</p>` +
    // Chart and key swings side by side, about 65/35 (mak, 2026-09-30).
    `<div class="sct-wp-row">` +
    `<div class="sct-wp-main">` +
    `<p class="sct-wp-legend">${escapeHtml(`${game.home.short} win probability`)}</p>` +
    `<div class="sct-wp-frame">${chart(game, model, colors)}${labels}${extreme}</div>` +
    `</div>` +
    list +
    `</div>` +
    `</section>`
  );
}
