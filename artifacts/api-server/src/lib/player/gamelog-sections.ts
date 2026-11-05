/**
 * "Where His Weeks Finished" and "Game-by-Game Breakdown" - the two Game Log
 * sections of mak's spec of 2026-10-01, directly after the week-by-week table.
 *
 * Both are generated entirely from game data; no API key, no model call. The
 * ladder shows every weekly finish as a pin on a positional scale with the
 * tier-1 and tier-2 ranges shaded - the spread of outcomes a points-per-game
 * average hides. The breakdown gives one card per played game, most recent
 * first: score, a rule-picked headline, the stat line, a one-to-three-sentence
 * note, and the fantasy points with the weekly finish.
 *
 * WHERE THE EXTRA FACTS COME FROM. The Sleeper log carries the stat line and
 * the weekly rank; everything else a card states - the date, home or away, the
 * closing line, trailing by ten in the second half, who the targets went to,
 * fumbles lost - is read from the stored ESPN box scores the matchup pages are
 * built on (data/matchup/boxscores/<season>.json). Stored data only, per the
 * store-verified-data posture: nothing here fetches. A played week whose box
 * score is not stored yet is left out of both sections rather than rendered
 * with an invented "vs" - the spec is explicit that home/away is never
 * defaulted - and it joins them when the store catches up. A season with no
 * stored box scores at all (anything before 2021) renders neither section.
 *
 * VALIDATION. Every number in a headline or note is one of the game's stat
 * values, a rate computed from them, or a count derived from them; every name
 * is from the game's own box score. Sentences whose inputs are missing are
 * dropped, never padded. That is the spec's own rule and it is also why the
 * fumble-unknown case (a box score with no player block) silences the
 * "clean, mistake-free" sentence instead of guessing.
 *
 * The copy generators are exported and pure - the test suite drives them with
 * the spec's Part 6 fixtures (Jacoby Brissett, 2026 through Week 3) and
 * asserts the expected output word for word.
 */

import fs from "node:fs";
import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import { getTeamByAbbreviation } from "../team/teams";
import { storedSeason, type StoredGame } from "../matchup/boxscore";
import { playPoints, type ScoringPlay } from "../matchup/scoring-plays";
import { nameKey } from "../matchup/game-players";
import { getEntryPoints } from "./scoring";
import { teamCode } from "./ranks";
import { lastName, teamInk } from "./header";
import { titleCase } from "./title-case";
import type { PlayerPageData } from "./player-data";
import type { GameLogEntry } from "./types";

/* ------------------------------------------------------------------ scales */

/** The axis and band cutoffs for one position's ladder. */
export interface LadderScale {
  /** Axis maximum: ranks beyond it clamp to the right edge. */
  max: number;
  /** The "1" band's last rank: QB1 range is top 12, RB1 range top 24. */
  t1: number;
  /** The "2" band's last rank; past it is the bench range. */
  t2: number;
}

/**
 * QB, TE and K ladder to 32 with bands at 12 and 24; RB and WR ladder to 60
 * with bands at 24 and 36, because 12-team leagues start about two of each,
 * plus flex. Positions outside this table have no weekly rank worth drawing.
 */
const SCALES: Record<string, LadderScale> = {
  QB: { max: 32, t1: 12, t2: 24 },
  TE: { max: 32, t1: 12, t2: 24 },
  K: { max: 32, t1: 12, t2: 24 },
  RB: { max: 60, t1: 24, t2: 36 },
  WR: { max: 60, t1: 24, t2: 36 },
};

const POSITION_WORDS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
};

export function ladderScale(pos: string): LadderScale | null {
  return SCALES[pos] ?? null;
}

/* ------------------------------------------------------------- pure inputs */

/** One played game, with everything the two sections state about it. */
export interface StoryGame {
  week: number;
  /** Kickoff, epoch ms; the card's date renders in Eastern time. */
  dateMs: number;
  opp: {
    city: string;
    nickname: string;
    abbr: string;
    /** The two LA and two NY clubs go by nickname: "the Rams", not "Los Angeles". */
    useNickname: boolean;
    /** The club's crest (lib/team/teams.ts `logo`), absolute for the request; null when the club is unknown. */
    logo: string | null;
  };
  homeAway: "home" | "away";
  result: { wlt: "W" | "L" | "T"; teamScore: number; oppScore: number };
  stats: {
    cmp: number;
    att: number;
    passYds: number;
    passTd: number;
    passInt: number;
    car: number;
    rushYds: number;
    rushTd: number;
    tgt: number;
    rec: number;
    recYds: number;
    recTd: number;
    fgm: number;
    fga: number;
    fgLong: number;
    xpm: number;
    xpa: number;
    /** Null when the box score has no player block to read it from. */
    fumLost: number | null;
  };
  /** Site scoring, unrounded; display rounds to one decimal. */
  pts: number;
  /** Weekly finish among the position, 1 is best. */
  rank: number;
  /** From the stored closing line; false when ESPN kept no odds. */
  wasUnderdog: boolean;
  /** Trailed by 10+ at any point in the second half, from the scoring plays. */
  trailing2hBy10: boolean;
  /** Started the game: the log's own `gs` flag where the builder kept it, else the box score's volume read. */
  started: boolean;
  /** A quarterback who threw without starting: came on in relief (never "a start"). */
  relief?: boolean;
  usage: {
    /** Teammates' targets that game, every receiver, most-targeted first. */
    targets?: Array<{ name: string; targets: number }>;
    /** His TD receivers, in scoring order, deduplicated. */
    tdReceivers?: string[];
    snapPct?: number | null;
    carries?: number;
  } | null;
  /** Analyst copy, used verbatim in place of the generated pair. */
  override?: { headline: string; note: string } | null;
}

/** The season the games sit in, for the lede and the comparisons. */
export interface StorySeason {
  pos: string;
  /** Unrounded points per game in the page's scoring format. */
  ppg: number;
  /** Positional rank for the season; the breakdown cards read it, the lede no longer does. */
  seasonRank: number | null;
  /** The player's last name, the subject of the lede's second sentence; "He" when absent. */
  lastName?: string;
  /** QB attempts per game - the volume-outlier baseline. */
  avgAtt: number;
  /** Season efficiency: QB Y/A, RB yards per carry, WR/TE yards per target. */
  seasonEff: number | null;
  /** Past-season pages say "finished" and "went" where this season says "get". */
  pastTense: boolean;
  /** The latest played week, for the byline. */
  updatedWeek: number;
  /** The latest played game's kickoff, for the past-season byline date. */
  updatedDateMs: number | null;
  /** True when any card carries analyst copy - it changes the byline. */
  hasOverrides: boolean;
  /** Distinguishes the archive copy's ids from the active season's. */
  idSuffix: string;
}

/* ------------------------------------------------------------- small words */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Counts under ten in words, numerals from there - the spec's number rule. */
const word = (n: number): string => WORDS[n] ?? String(n);
const capWord = (n: number): string => {
  const w = word(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** "a, b and c" - no Oxford comma, per every template in the spec. */
const joinAnd = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const DASH = "–";

/** One decimal, for points and rates. */
const one = (v: number): string => v.toFixed(1);

/** A percentage of track width to one decimal, without a trailing ".0". */
const pctTrim = (v: number): string => {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The game's date in Eastern time, where the schedule lives. */
function easternDate(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

/* ------------------------------------------------------------------ ladder */

/** Pin position: rank 1 at the left edge, the axis max at the right. */
export function pinX(rank: number, scale: LadderScale): number {
  const clamped = Math.min(rank, scale.max);
  return ((clamped - 1) / (scale.max - 1)) * 100;
}

/**
 * Band edges sit at half-ranks - the "1" band ends at rank t1 + 0.5 - so a
 * rank-t1 pin sits inside the band rather than on its edge.
 *
 * The spec's QB worked example says 35.5% here, but that is 11/31: the pin
 * position of rank 12, not the stated formula's 11.5/31, and its own QB2
 * worked example (23.5/31 = 75.8%) does the arithmetic the formula's way. The
 * formula and its stated reason win: 37.1% for QB. Flagged to mak 2026-10-01.
 */
export function bandEdges(scale: LadderScale): { band1: number; band2end: number } {
  return {
    band1: ((scale.t1 + 0.5 - 1) / (scale.max - 1)) * 100,
    band2end: ((scale.t2 + 0.5 - 1) / (scale.max - 1)) * 100,
  };
}

interface Pin {
  /** Every game that finished at this rank, oldest first (mak's 2026-10-29 critique: one dot per rank, "×2" when weeks share it). */
  games: StoryGame[];
  rank: number;
  x: number;
  best: boolean;
  /** "above" is the default; "below" dodges a neighbor; "none" is sr-only. */
  label: "above" | "below" | "none";
}

/** The season-average marker: a dashed line through the band, labeled like a pin. */
interface AvgMark {
  rank: number;
  x: number;
  label: "above" | "below" | "none";
}

export interface LadderLayout {
  pins: Pin[];
  /** Null with fewer than two games: one game IS its own average. */
  avg: AvgMark | null;
}

/**
 * The mean weekly finish, rounded - the same figure the game log's Avg row
 * prints in its Finish cell, so the two agree.
 */
export function averageRank(games: StoryGame[]): number | null {
  if (games.length < 2) return null;
  return Math.round(games.reduce((sum, g) => sum + g.rank, 0) / games.length);
}

/**
 * Resolve label collisions left to right: a label goes in the first row under
 * the band unless it is within 12 units of the previous first-row label, then
 * the second row unless within 12 of the previous second-row label, then
 * nowhere visible. ("above" is the first row and "below" the second: the names
 * predate the 2026-10-22 restyle that moved every label under the band.)
 */
function placeLabels<T extends { x: number; label: "above" | "below" | "none" }>(
  items: T[],
  keep: (item: T) => boolean,
): void {
  let lastAbove: number | null = null;
  let lastBelow: number | null = null;
  for (const item of items) {
    if (!keep(item)) {
      item.label = "none";
      continue;
    }
    if (lastAbove === null || item.x - lastAbove >= 12) {
      item.label = "above";
      lastAbove = item.x;
    } else if (lastBelow === null || item.x - lastBelow >= 12) {
      item.label = "below";
      lastBelow = item.x;
    } else {
      item.label = "none";
    }
  }
}

/**
 * Lay the ladder out. Weeks that finished at the same rank share one dot
 * (two QB15s used to sit on top of each other with their labels split across
 * the two rows, which read as if the rows meant something). The average
 * marker's label takes part in the same collision pass as the dots'. With 10
 * or more games only the best and worst weeks keep labels and a compact
 * legend lists the rest; the average keeps its label regardless.
 */
export function layoutLadder(games: StoryGame[], scale: LadderScale): LadderLayout {
  // Best week: highest points; on a tie, the most recent game.
  let best: StoryGame | null = null;
  for (const g of games) {
    if (!best || g.pts > best.pts || (g.pts === best.pts && g.week > best.week)) best = g;
  }
  // Worst week for the 10-game rule: highest rank, most recent on a tie.
  let worst: StoryGame | null = null;
  for (const g of games) {
    if (!worst || g.rank > worst.rank || (g.rank === worst.rank && g.week > worst.week)) worst = g;
  }

  const byRank = new Map<number, StoryGame[]>();
  for (const g of games) {
    const list = byRank.get(g.rank) ?? [];
    list.push(g);
    byRank.set(g.rank, list);
  }
  const pins: Pin[] = [...byRank.entries()]
    .map(([rank, list]) => ({
      games: list.sort((a, b) => a.week - b.week),
      rank,
      x: pinX(rank, scale),
      best: best !== null && list.includes(best),
      label: "above" as const,
    }))
    .sort((a, b) => a.x - b.x);

  const avgRank = averageRank(games);
  const avg: AvgMark | null =
    avgRank === null ? null : { rank: avgRank, x: pinX(avgRank, scale), label: "above" };

  const sparse = games.length >= 10;
  type Item = { x: number; label: "above" | "below" | "none"; pin?: Pin; avg?: AvgMark };
  const items: Item[] = pins.map((pin) => ({ x: pin.x, label: pin.label, pin }));
  if (avg) items.push({ x: avg.x, label: avg.label, avg });
  // A dot and the average at the same spot: the dot's label comes first.
  items.sort((a, b) => a.x - b.x || (a.avg ? 1 : 0) - (b.avg ? 1 : 0));
  placeLabels(items, (item) =>
    item.avg
      ? true
      : !sparse || item.pin!.games.includes(best!) || item.pin!.games.includes(worst!),
  );
  for (const item of items) {
    if (item.pin) item.pin.label = item.label;
    if (item.avg) item.avg.label = item.label;
  }
  return { pins, avg };
}

/** The dots alone, for callers that do not draw the average. */
export function layoutPins(games: StoryGame[], scale: LadderScale): Pin[] {
  return layoutLadder(games, scale).pins;
}

/**
 * The finishes counted by tier, as the short summary that sits on the
 * heading's row (mak, 2026-10-22: "2 QB1 · 2 QB2 · 2 busts"). It replaced the
 * two-sentence lede, which restated the pins at paragraph length. One game
 * in, it names that finish.
 */
export function ladderSummary(games: StoryGame[], season: StorySeason, scale: LadderScale): string[] {
  const pos = season.pos;
  if (games.length === 1) return [`1 game`, `${pos}${games[0]!.rank}`];
  const t1 = games.filter((g) => g.rank <= scale.t1).length;
  const t2 = games.filter((g) => g.rank > scale.t1 && g.rank <= scale.t2).length;
  const bust = games.length - t1 - t2;
  const parts: string[] = [];
  if (t1 > 0) parts.push(`${t1} ${pos}1`);
  if (t2 > 0) parts.push(`${t2} ${pos}2`);
  if (bust > 0) parts.push(`${bust} bust${bust === 1 ? "" : "s"}`);
  return parts;
}

/** "Weekly finishes on a scale from QB1 to QB32: Week 3 QB4, …" best first. */
function trackAriaLabel(
  games: StoryGame[],
  season: StorySeason,
  scale: LadderScale,
  avgRank: number | null,
): string {
  const ordered = [...games].sort((a, b) => a.rank - b.rank || a.week - b.week);
  const list = ordered.map((g) => `Week ${g.week} ${season.pos}${g.rank}`).join(", ");
  const avg = avgRank === null ? "" : ` Season average ${season.pos}${avgRank}.`;
  return `Weekly finishes on a scale from ${season.pos}1 to ${season.pos}${scale.max}: ${list}.${avg}`;
}

/**
 * Section A. The spec's markup under the site's class armour: every class is
 * scp-gl-prefixed and every selector in player.css starts with `.scp`, for
 * the Divi reasons the header block documents; modifiers are `is-` flagged so
 * a theme's own `.best` or `.w` can never reach them.
 */
export function renderLadderSection(games: StoryGame[], season: StorySeason): string {
  const scale = SCALES[season.pos];
  if (!scale || games.length === 0) return "";

  const pos = season.pos;
  const id = `gl-finishes-h${season.idSuffix}`;
  const { band1, band2end } = bandEdges(scale);
  const { pins, avg } = layoutLadder(games, scale);
  const hasBelow = pins.some((p) => p.label === "below") || avg?.label === "below";

  const labelCls = (label: Pin["label"]): string =>
    (label === "below" ? " is-below" : "") + (label === "none" ? " is-nolabel" : "");

  const pinHtml = pins
    .map((pin) => {
      const cls =
        "scp-gl-pin" +
        (pin.best ? " is-best" : "") +
        (pin.games.length > 1 ? " is-multi" : "") +
        labelCls(pin.label);
      const weeks = pin.games
        .map((g) => {
          const at = g.homeAway === "away" ? "@" : "vs";
          return `<span class="scp-gl-wk">${escapeHtml(`Wk ${g.week}`)} <small>${escapeHtml(`${at} ${g.opp.abbr}`)}</small></span>`;
        })
        .join("");
      return (
        `<div class="${cls}" style="left:${pctTrim(pin.x)}%"><i></i>` +
        `<span><strong>${escapeHtml(`${pos}${pin.rank}`)}` +
        (pin.games.length > 1 ? `<b>${escapeHtml(` ×${pin.games.length}`)}</b>` : "") +
        `</strong>${weeks}` +
        // The one colored dot says why it is colored (critique, 2026-10-29).
        (pin.best ? `<em>Best week</em>` : "") +
        `</span></div>`
      );
    })
    .join("");

  // Where he usually lands: a dashed line through the band at his mean finish,
  // labeled like a dot and placed by the same collision pass. The headrow
  // repeats the figure, so a label that found no room loses nothing.
  const avgHtml = avg
    ? `<div class="scp-gl-avg${labelCls(avg.label)}" style="left:${pctTrim(avg.x)}%" title="${escapeHtml(
        `Season average finish: ${pos}${avg.rank}`,
      )}"><i></i><span><strong>${escapeHtml(`${pos}${avg.rank}`)}</strong><span class="scp-gl-wk">Season avg</span></span></div>`
    : "";

  // Weeks whose labels found no room, named under the track instead.
  const hidden = pins.filter((p) => p.label === "none").flatMap((p) => p.games);
  const sparse = games.length >= 10;
  const also =
    !sparse && hidden.length
      ? `<p class="scp-gl-also">${escapeHtml(
          `Also: ${hidden.map((g) => `Wk ${g.week} (${pos}${g.rank})`).join(", ")}`,
        )}</p>`
      : "";

  // The three tiers named above the band, each centered over its segment,
  // with the cutoff ranks printed at the two seams and the axis ends stated
  // (critique, 2026-10-29: a region needs its boundary values). The band
  // itself carries hairline markers at the seams. One word for the bottom
  // tier, "bust", here and in the counts.
  const tiers =
    `<div class="scp-gl-tiers" aria-hidden="true">` +
    `<span class="is-k1" style="left:0;width:${pctTrim(band1)}%">${escapeHtml(`${pos}1`)}<small> range</small></span>` +
    `<span class="is-k2" style="left:${pctTrim(band1)}%;width:${pctTrim(band2end - band1)}%">${escapeHtml(`${pos}2`)}<small> range</small></span>` +
    `<span class="is-k3" style="left:${pctTrim(band2end)}%;width:${pctTrim(100 - band2end)}%">Bust<small> range</small></span>` +
    `<b class="scp-gl-cut is-end is-lo" style="left:0">${escapeHtml(`${pos}1`)}</b>` +
    `<b class="scp-gl-cut" style="left:${pctTrim(band1)}%">${escapeHtml(`${pos}${scale.t1}`)}</b>` +
    `<b class="scp-gl-cut" style="left:${pctTrim(band2end)}%">${escapeHtml(`${pos}${scale.t2}`)}</b>` +
    `<b class="scp-gl-cut is-end is-hi" style="left:100%">${escapeHtml(`${pos}${scale.max}`)}</b>` +
    `</div>`;
  const marks =
    `<i class="scp-gl-mark" style="left:${pctTrim(band1)}%"></i>` +
    `<i class="scp-gl-mark" style="left:${pctTrim(band2end)}%"></i>`;
  const legend = sparse
    ? `<p class="scp-gl-legend">${escapeHtml(
        [...games]
          .sort((a, b) => a.week - b.week)
          .map((g) => `Wk ${g.week} ${pos}${g.rank}`)
          .join(" · "),
      )}</p>`
    : "";

  const summary = ladderSummary(games, season, scale)
    .map((t) => `<span>${escapeHtml(t)}</span>`)
    .join(`<i aria-hidden="true"> · </i>`);
  const avgSummary = avg
    ? `<i aria-hidden="true"> · </i><b class="scp-gl-avgsum">${escapeHtml(`Avg ${pos}${avg.rank}`)}</b>`
    : "";

  // The compact read (2026-11-04): the three tier counts as tiles with their
  // shares, then the best week and the average in one line, and the ladder
  // under them (mak kept it in view).
  const n = games.length;
  const t1 = games.filter((g) => g.rank <= scale.t1).length;
  const t2 = games.filter((g) => g.rank > scale.t1 && g.rank <= scale.t2).length;
  const bust = n - t1 - t2;
  const share = (k: number): string => `${Math.round((k / n) * 100)}% of weeks`;
  const tile = (count: number, label: string): string =>
    `<div class="scp-gl-tile"><b>${count}</b><span>${escapeHtml(label)}</span><small>${escapeHtml(share(count))}</small></div>`;
  const tiles =
    `<div class="scp-gl-tiles">` +
    tile(t1, `${pos}1 weeks`) +
    tile(t2, `${pos}2 weeks`) +
    tile(bust, `${pos}${scale.t2 + 1}+ weeks`) +
    `</div>`;
  // No "Best week ... · Average weekly finish ..." line (mak, 2026-11-04):
  // the ladder marks the best week and the headrow carries the average.

  return (
    `<section class="scp-ox-sec scp-gl-sec" aria-labelledby="${id}">` +
    `<div class="scp-gl-headrow">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase("Where his weeks finished"))}</h2>` +
    `<p class="scp-gl-sum">${summary}${avgSummary}</p>` +
    `</div>` +
    tiles +
    // The ladder itself, in view under the tiles (mak, 2026-11-04: "bring
    // back the visual bar"); it folded behind a control for an hour.
    `<figure class="scp-gl-ladder" style="margin:0">` +
    tiers +
    `<div class="scp-gl-track${hasBelow ? " has-below" : ""}" role="img" aria-label="${escapeHtml(
      trackAriaLabel(games, season, scale, avg?.rank ?? null),
    )}">` +
    `<div class="scp-gl-band is-b1" style="width:${pctTrim(band1)}%"></div>` +
    `<div class="scp-gl-band is-b2" style="left:${pctTrim(band1)}%;width:${pctTrim(band2end - band1)}%"></div>` +
    marks +
    avgHtml +
    pinHtml +
    `</div>` +
    also +
    legend +
    `</figure>` +
    `</section>`
  );
}

/* ------------------------------------------------------------- stat lines */

/** "4 carries" / "1 carry" - the one noun the spec inflects by count. */
const carries = (n: number): string => `${n} ${n === 1 ? "carry" : "carries"}`;

/** The card's stat line, in the spec's format for the position. */
export function statLineFor(game: StoryGame, pos: string): string {
  const s = game.stats;
  let line: string;
  if (pos === "QB") {
    line = `${s.cmp}/${s.att}, ${s.passYds} yds, ${s.passTd} TD, ${s.passInt} INT.`;
    if (s.car > 0) {
      line += ` ${carries(s.car)}, ${s.rushYds} yds${s.rushTd > 0 ? `, ${s.rushTd} TD` : ""}.`;
    }
  } else if (pos === "RB") {
    line = `${s.car} carries, ${s.rushYds} yds${s.rushTd > 0 ? `, ${s.rushTd} TD` : ""}.`;
    line += ` ${s.rec}/${s.tgt} receiving, ${s.recYds} yds${s.recTd > 0 ? `, ${s.recTd} TD` : ""}.`;
  } else if (pos === "WR" || pos === "TE") {
    line = `${s.rec}/${s.tgt}, ${s.recYds} yds${s.recTd > 0 ? `, ${s.recTd} TD` : ""}.`;
    if (s.car > 0) line += ` ${carries(s.car)}, ${s.rushYds} rush yds.`;
  } else {
    line = `FG ${s.fgm}/${s.fga} (long ${s.fgLong}). XP ${s.xpm}/${s.xpa}.`;
  }
  if ((s.fumLost ?? 0) > 0) {
    line += ` ${s.fumLost} fumble${s.fumLost === 1 ? "" : "s"} lost.`;
  }
  return line;
}

/* -------------------------------------------------------------- headlines */

/** "Seattle", or "the Rams" for the clubs whose city names two teams. */
const cityWord = (game: StoryGame): string =>
  game.opp.useNickname ? `the ${game.opp.nickname}` : game.opp.city;

/** Game efficiency on the position's own stat; null when nothing to divide. */
export function gameEfficiency(game: StoryGame, pos: string): number | null {
  const s = game.stats;
  if (pos === "QB") return s.att > 0 ? s.passYds / s.att : null;
  if (pos === "RB") return s.car > 0 ? s.rushYds / s.car : null;
  if (pos === "WR" || pos === "TE") return s.tgt > 0 ? s.recYds / s.tgt : null;
  return null;
}

/**
 * The headline: five rules checked in order, first match wins. Shown for QB
 * in the spec; other positions use their own cutoffs and efficiency stat.
 */
export function headlineFor(
  game: StoryGame,
  season: StorySeason,
  scale: LadderScale,
  seasonHigh: boolean,
): string {
  const pos = season.pos;
  const at = game.homeAway === "away" ? "at" : "vs.";
  const city = cityWord(game);
  const resultWord =
    game.result.wlt === "W" ? "win" : game.result.wlt === "L" ? "loss" : "tie";

  // 1. The season's highest-points game, finished top-5 (three games or
  //    more: one game is nobody's season high).
  if (seasonHigh && game.rank <= 5) {
    if (game.result.teamScore + game.result.oppScore >= 60) return "Season high in a shootout";
    return game.result.wlt === "L" ? "Season high in a loss" : "Season high in a win";
  }
  // 2. A tier-1 week - in relief, when he did not start (2026-11-04).
  if (game.rank <= scale.t1) return game.relief ? `${pos}1 week in relief ${at} ${city}` : `${pos}1 week ${at} ${city}`;
  // 3. A bust.
  if (game.rank > scale.t2) {
    return game.result.wlt === "L" ? `Shut down by ${city}` : `Held in check by ${city}`;
  }
  // 4. A win carried by efficiency.
  const eff = gameEfficiency(game, pos);
  if (
    game.result.wlt === "W" &&
    eff !== null &&
    season.seasonEff !== null &&
    eff >= season.seasonEff + 1.5
  ) {
    if (game.homeAway === "away") {
      return game.wasUnderdog ? "Efficient in a road upset" : "Efficient in a road win";
    }
    return "Efficient in a home win";
  }
  // 5. Everything else: the finish and the result, which differ game to
  //    game, rather than "Steady in a loss" on every card (2026-11-04).
  if (game.relief) return `Relief appearance in a ${resultWord} ${at} ${city}`;
  return `${pos}${game.rank} week in a ${resultWord} ${at} ${city}`;
}

/* ------------------------------------------------------------------ notes */

/**
 * The note: candidate sentences in the spec's priority order, keeping the
 * first three that apply. Every figure traces to the game's own data; a
 * sentence whose inputs are missing is dropped rather than approximated.
 */
export function noteFor(
  game: StoryGame,
  season: StorySeason,
  scale: LadderScale,
  bestEffWeek: number | null,
): string {
  const pos = season.pos;
  const s = game.stats;
  const sentences: string[] = [];

  // 0. A relief appearance is the first fact of the game (2026-11-04): the
  //    starter's numbers and his are not the same kind of line.
  if (game.relief) sentences.push("Came on in relief; not a start.");

  // 1. Volume outlier - defined for the quarterback's attempt count.
  if (pos === "QB" && season.avgAtt > 0 && s.att >= 1.25 * season.avgAtt && !game.relief) {
    const chasing = game.trailing2hBy10 ? " while chasing points" : "";
    const totalTd = s.passTd + s.rushTd + s.recTd;
    sentences.push(
      totalTd > 0
        ? `A ${s.att}-attempt game${chasing} produced ${word(totalTd)} total touchdown${totalTd === 1 ? "" : "s"}.`
        : `A ${s.att}-attempt game${chasing} that never found the end zone.`,
    );
  }

  // 2. Usage, only where it is HIS. The box score's target counts are the
  //    club's receivers for the whole game, not this passer's throws, and a
  //    two-quarterback game put "19 of his 17 passes" on the page
  //    (2026-11-04): that sentence is gone until targets can be tied to the
  //    passer. His touchdown passes are his - the scoring play names him.
  if (pos === "QB" && game.usage?.tdReceivers && game.usage.tdReceivers.length > 0) {
    const tds = game.usage.tdReceivers;
    sentences.push(`His TD pass${tds.length === 1 ? "" : "es"} went to ${joinAnd(tds)}.`);
  } else if (pos === "RB" && game.usage?.snapPct != null && game.usage.carries != null) {
    sentences.push(
      `He played ${Math.round(game.usage.snapPct)}% of the snaps and handled ${game.usage.carries} carries.`,
    );
  }
  // WR/TE route share is not in any stored source, so the spec's third usage
  // sentence never renders; the validation rule beats an approximated figure.

  // 3. Efficiency against his own season.
  const eff = gameEfficiency(game, pos);
  if (eff !== null && season.seasonEff !== null) {
    const unit = pos === "QB" ? "attempt" : pos === "RB" ? "carry" : "target";
    const g1 = Number(eff.toFixed(1));
    const s1 = Number(season.seasonEff.toFixed(1));
    // "Most efficient game of the season" only against a season: the caller
    // sets bestEffWeek from three games or more (2026-11-04).
    if (bestEffWeek !== null && game.week === bestEffWeek) {
      sentences.push(`His most efficient game of the season at ${one(g1)} yards per ${unit}.`);
    } else if (g1 <= s1 - 1.5) {
      sentences.push(`Just ${one(g1)} yards per ${unit}.`);
    } else if (pos === "QB" && g1 >= s1 + 1.0) {
      sentences.push(`At ${one(g1)} yards per attempt, he pushed the ball downfield.`);
    }
    // The "most of it came underneath" reading for a merely below-average
    // Y/A is gone: it described every ordinary game the same way.
  }

  // 4. A bust that still found the end zone: the fact, without the forecast
  //    ("this is his floor when...") that followed it on every such card.
  const totalTd = s.passTd + s.rushTd + s.recTd;
  if (game.rank > scale.t2 && totalTd > 0) {
    sentences.push(`The touchdown${totalTd === 1 ? "" : "s"} kept it from being a total loss.`);
  }

  // 5. Turnovers, when there were any. The "clean, mistake-free start that
  //    landed well above his season average" sentence is gone (2026-11-04):
  //    it called a relief appearance a start, and "well above / well below
  //    his season average" closed most cards on the page with the same
  //    words. The finish badge beside the card already says where the game
  //    landed.
  const ints = pos === "QB" ? s.passInt : 0;
  const fum = s.fumLost ?? 0;
  if (ints > 0 || fum > 0) {
    const parts: string[] = [];
    if (ints > 0) parts.push(`${capWord(ints)} interception${ints === 1 ? "" : "s"}`);
    if (fum > 0) parts.push(`${ints > 0 ? word(fum) : capWord(fum)} lost fumble${fum === 1 ? "" : "s"}`);
    sentences.push(`${parts.join(" and ")}.`);
  }

  return sentences.slice(0, 3).join(" ");
}

/**
 * How much a game stands out from its season, for the archive's short list
 * (2026-11-04): the season high, tier-1 weeks, busts and relief
 * appearances first, then distance from his average. Ties go to the later
 * week, so the list reads newest first among equals.
 */
function notability(game: StoryGame, season: StorySeason, scale: LadderScale, high: StoryGame | null): number {
  let score = Math.abs(game.pts - season.ppg);
  if (high && game === high) score += 100;
  if (game.rank <= scale.t1) score += 50;
  if (game.rank > scale.t2) score += 30;
  if (game.relief) score += 40;
  return score;
}

/* ------------------------------------------------------------------- cards */

/**
 * Section B. One card per played game, most recent first, with the generated
 * headline and note - or the analyst's, where an override is stored.
 */
/** One breakdown card's readings, shared by the tab's cards and the premium comparison block. */
export interface BreakdownCard {
  game: StoryGame;
  headline: string;
  note: string;
  /** "t12" = finished inside the chart's top tier (rank <= t1), "t24" the middle tier, "low" a bust. */
  tier: "t12" | "t24" | "low";
  /** The season's highest-points game (three games or more). */
  seasonHigh: boolean;
  /** "Nov 1", Eastern time. */
  date: string;
  /** One of a finished season's notable games, shown before the fold. */
  lead: boolean;
}

/**
 * The cards in page order (newest first) with the copy each one prints,
 * so the tab's breakdown and the premium comparison under it cannot
 * disagree. Null for a position with no scale or a season with no games.
 */
export function buildBreakdownCards(
  games: StoryGame[],
  season: StorySeason,
): { cards: BreakdownCard[]; scale: LadderScale } | null {
  const scale = SCALES[season.pos];
  if (!scale || games.length === 0) return null;
  const pos = season.pos;

  // Season-wide readings each card compares itself against - from three
  // games on. One or two games make no season to be the high or the most
  // efficient of (2026-11-04).
  let high: StoryGame | null = null;
  if (games.length >= 3) {
    for (const g of games) {
      if (!high || g.pts > high.pts || (g.pts === high.pts && g.week > high.week)) high = g;
    }
  }
  // The most efficient game of the season, at the position's minimum volume.
  let bestEffWeek: number | null = null;
  if (pos === "QB" && games.length >= 3) {
    let bestEff = -Infinity;
    for (const g of games) {
      if (g.stats.att < 15) continue;
      const eff = g.stats.passYds / g.stats.att;
      if (eff > bestEff) {
        bestEff = eff;
        bestEffWeek = g.week;
      }
    }
  }

  // A finished season leads with its two or three most notable games and
  // folds the rest behind one control (2026-11-04); the season in progress
  // shows every card, newest first, as before.
  const byWeek = [...games].sort((a, b) => b.week - a.week);
  const lead = new Set<StoryGame>();
  if (season.pastTense && games.length > 4) {
    [...games]
      .sort((a, b) => notability(b, season, scale, high) - notability(a, season, scale, high) || b.week - a.week)
      .slice(0, 3)
      .forEach((g) => lead.add(g));
  }

  const cards = byWeek.map((game): BreakdownCard => {
    const { m, d } = easternDate(game.dateMs);
    return {
      game,
      headline: game.override?.headline ?? headlineFor(game, season, scale, game === high),
      note: game.override?.note ?? noteFor(game, season, scale, bestEffWeek),
      tier: game.rank <= scale.t1 ? "t12" : game.rank <= scale.t2 ? "t24" : "low",
      seasonHigh: game === high,
      date: `${MONTHS_SHORT[m]} ${d}`,
      lead: lead.has(game),
    };
  });
  return { cards, scale };
}

export function renderBreakdownSection(games: StoryGame[], season: StorySeason): string {
  const built = buildBreakdownCards(games, season);
  if (!built) return "";
  const { cards: list } = built;
  const pos = season.pos;
  const id = `gl-breakdown-h${season.idSuffix}`;
  const lead = list.filter((c) => c.lead);

  const byline = (() => {
    if (season.pastTense) {
      const ms = season.updatedDateMs;
      if (ms === null) return `Season summary.`;
      const { y, m, d } = easternDate(ms);
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return (
        `Season summary, updated <time datetime="${iso}">` +
        escapeHtml(`${MONTHS_FULL[m]} ${d}, ${y}`) +
        `</time>.`
      );
    }
    // mak, 2026-10-02: no "Updated automatically after Week n" line.
    if (!season.hasOverrides) return "";
    const ms = season.updatedDateMs ?? Date.now();
    const { y, m, d } = easternDate(ms);
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return (
      `By the StatChasers staff. Updated <time datetime="${iso}">` +
      escapeHtml(`${MONTHS_FULL[m]} ${d}, ${y}`) +
      `</time> after Week ${season.updatedWeek}.`
    );
  })();

  const card = (c: BreakdownCard): string => {
      const { game } = c;
      const cardCls = c.tier === "t12" ? " is-t12" : c.tier === "low" ? " is-low" : "";
      const badgeCls = c.tier === "t12" ? "is-t12" : c.tier === "t24" ? "is-t24" : "is-low";
      const scoreCls =
        game.result.wlt === "W" ? " is-w" : game.result.wlt === "L" ? " is-l" : "";
      const { headline, note } = c;
      const at = game.homeAway === "away" ? "@" : "vs";

      return (
        `<article class="scp-gl-game${cardCls}">` +
        `<div class="scp-gl-meta">` +
        `<div class="scp-gl-when">${escapeHtml(`Week ${game.week}, ${c.date}`)}</div>` +
        // Crest AFTER the name (mak, 2026-10-29): "vs Broncos" then the logo.
        `<div class="scp-gl-opp">` +
        `<span>${escapeHtml(`${at} ${game.opp.nickname}`)}</span>` +
        (game.opp.logo
          ? `<img class="scp-gl-opp-logo" src="${escapeHtml(game.opp.logo)}" alt="" aria-hidden="true" width="22" height="22" loading="lazy" decoding="async" />`
          : "") +
        `</div>` +
        `<div class="scp-gl-score${scoreCls}">${escapeHtml(
          `${game.result.wlt} ${game.result.teamScore}${DASH}${game.result.oppScore}`,
        )}</div>` +
        `</div>` +
        `<div class="scp-gl-body">` +
        `<h3 class="scp-gl-head">${escapeHtml(headline)}</h3>` +
        `<p class="scp-gl-line">${escapeHtml(statLineFor(game, pos))}</p>` +
        (note ? `<p class="scp-gl-note">${escapeHtml(note)}</p>` : "") +
        `</div>` +
        `<div class="scp-gl-fp"><b>${escapeHtml(one(game.pts))}</b>` +
        `<span class="scp-gl-fbadge ${badgeCls}">${escapeHtml(`${pos}${game.rank}`)}</span></div>` +
        `</article>`
      );
  };

  let cards: string;
  if (lead.length) {
    const rest = list.filter((c) => !c.lead);
    cards =
      `<div class="scp-gl-games">${lead.map(card).join("")}</div>` +
      `<details class="scp-gl-more"><summary>${escapeHtml(`Show all ${games.length} games`)}</summary>` +
      `<div class="scp-gl-games">${rest.map(card).join("")}</div></details>`;
  } else {
    cards = `<div class="scp-gl-games">${list.map(card).join("")}</div>`;
  }

  return (
    `<section class="scp-ox-sec scp-gl-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase("Game-by-game breakdown"))}</h2>` +
    (byline ? `<p class="scp-gl-byline">${byline}</p>` : "") +
    (lead.length ? `<p class="scp-gl-lede">${escapeHtml(`The ${lead.length} games that stood out, then the rest of the season.`)}</p>` : "") +
    cards +
    `</section>`
  );
}

/* --------------------------------------------------- context from the store */

interface WeekContext {
  dateMs: number;
  homeAway: "home" | "away";
  teamScore: number;
  oppScore: number;
  wasUnderdog: boolean;
  trailing2hBy10: boolean;
  fumLost: number | null;
  started: boolean;
  targets: Array<{ name: string; targets: number }>;
  tdReceivers: string[];
}

/**
 * Trailed by ten or more at any point in the second half. The score only
 * moves on scoring plays, so walking them in order and checking the deficit
 * entering the third quarter and after every second-half score IS "at any
 * point", exactly - no play-by-play needed beyond the plays that scored.
 */
export function trailedBy10In2h(plays: ScoringPlay[], code: string): boolean {
  let mine = 0;
  let theirs = 0;
  let atHalf = 0;
  const after: Array<{ q: number; deficit: number }> = [];
  for (const play of plays) {
    const pts = playPoints(play);
    if (play.team === code) mine += pts;
    else theirs += pts;
    after.push({ q: play.quarter, deficit: theirs - mine });
  }
  for (const a of after) if (a.q <= 2) atHalf = a.deficit;
  if (atHalf >= 10) return true;
  return after.some((a) => a.q >= 3 && a.deficit >= 10);
}

/** One season's stored games, keyed by `CODE_week` for both sides. */
const contextIndex = new WeakMap<StoredGame[], Map<string, StoredGame>>();

function seasonIndex(season: number): Map<string, StoredGame> {
  const games = storedSeason(season);
  const hit = contextIndex.get(games);
  if (hit) return hit;
  const index = new Map<string, StoredGame>();
  for (const g of games) {
    if (g.seasonType !== "regular") continue;
    for (const line of g.box.lines) {
      const code = line.team?.code ?? teamCode(line.abbr);
      if (code) index.set(`${code}_${g.week}`, g);
    }
  }
  contextIndex.set(games, index);
  return index;
}

/** Everything the stored box score knows about one player's week. */
function weekContext(
  stored: StoredGame,
  myCode: string,
  playerName: string,
): WeekContext | null {
  const box = stored.box;
  const sideOf = (abbr: string, team: { code: string } | null): boolean =>
    (team?.code ?? teamCode(abbr)) === myCode;
  const away = box.lines[0];
  const home = box.lines[1];
  if (!away || !home) return null;
  const homeAway: "home" | "away" | null = sideOf(away.abbr, away.team)
    ? "away"
    : sideOf(home.abbr, home.team)
      ? "home"
      : null;
  // A game the player's club is not in - a mid-season trade whose log row
  // still carries the old code - is no game to write a card about.
  if (homeAway === null) return null;
  const mine = homeAway === "away" ? away : home;
  const theirs = homeAway === "away" ? home : away;

  const myKey = nameKey(playerName);
  const teammates = box.players.filter((p) => teamCode(p.team) === myCode);
  const me = teammates.find((p) => nameKey(p.name) === myKey) ?? null;

  // Started, for the quarterback's "mistake-free start": he threw more than
  // any teammate. The box score has no starter flag, and for the position
  // whose sentence uses the word, volume is the fact.
  const myAtt = me?.stats.passAtt ?? 0;
  const started =
    myAtt > 0 && teammates.every((p) => p === me || (p.stats.passAtt ?? 0) <= myAtt);

  const targets = teammates
    .filter((p) => nameKey(p.name) !== myKey && (p.stats.recTgt ?? 0) > 0)
    .map((p) => ({ name: p.name, targets: p.stats.recTgt! }))
    .sort((a, b) => b.targets - a.targets);

  const tdReceivers: string[] = [];
  for (const play of box.scoringPlays) {
    if (play.type !== "pass_td" || play.team !== myCode) continue;
    if (!play.passer || nameKey(play.passer) !== myKey || !play.scorer) continue;
    if (!tdReceivers.some((n) => nameKey(n) === nameKey(play.scorer!))) {
      tdReceivers.push(play.scorer);
    }
  }

  return {
    dateMs: Date.parse(stored.date),
    homeAway,
    teamScore: mine.total,
    oppScore: theirs.total,
    wasUnderdog: box.odds !== null && box.odds.favorite !== null && box.odds.favorite !== myCode,
    trailing2hBy10: trailedBy10In2h(box.scoringPlays, myCode),
    // No player block means no fumble column to read; null keeps the copy
    // from claiming a clean game it cannot verify.
    fumLost: box.players.length > 0 ? (me?.stats.fumblesLost ?? 0) : null,
    started,
    targets,
    tdReceivers,
  };
}

/* ------------------------------------------------------- analyst overrides */

/**
 * Hand-written card copy, where an analyst has filed any: keyed by player id,
 * then season, then week. The file is optional and absent today; the hook is
 * the spec's, so filing copy is an edit to data/, not to code.
 */
interface CopyOverride {
  headline?: string;
  note?: string;
}

let overridesCache: Record<string, Record<string, Record<string, CopyOverride>>> | null | undefined;

function copyOverride(playerId: string, season: number, week: number): { headline: string; note: string } | null {
  if (overridesCache === undefined) {
    try {
      overridesCache = JSON.parse(
        fs.readFileSync(dataPath("player", "gamelog_copy.json"), "utf8"),
      ) as typeof overridesCache;
    } catch {
      overridesCache = null;
    }
  }
  const o = overridesCache?.[playerId]?.[String(season)]?.[String(week)];
  return o && typeof o.headline === "string" && typeof o.note === "string"
    ? { headline: o.headline, note: o.note }
    : null;
}

/* ---------------------------------------------------------------- assembly */

/** The clubs fans call by nickname, because the city names two teams. */
const NICKNAME_CLUBS = new Set(["LAR", "LAC", "NYG", "NYJ"]);

/**
 * Both sections for whichever season the caller is showing, or "" when the
 * position has no ladder, nothing was played, or no played week has a stored
 * box score to read the schedule facts from.
 */
/** What renderGamelogStory() draws from: the played games with a stored box score, the season they sit in, and the team ink. */
export interface GamelogStory {
  games: StoryGame[];
  story: StorySeason;
  ink: string | null;
}

/**
 * The ladder's and the cards' inputs, built once from the page data so the
 * premium comparison block (gamelog-premium.ts, 2026-11-05) reads the SAME
 * games, counts and average the sections above it do. Null wherever the
 * sections would render nothing.
 */
export function buildGamelogStory(
  data: PlayerPageData,
  opts: { archive?: boolean } = {},
): GamelogStory | null {
  const pos = data.player.position ?? "";
  const scale = SCALES[pos];
  if (!scale) return null;

  const season = opts.archive ? data.logSeason : data.season;
  const log = data.seasonLog;
  const played = log.filter(
    (e): e is GameLogEntry & { pos_rank: number } =>
      e.game_status === "active" && typeof e.pos_rank === "number",
  );
  if (played.length === 0) return null;

  const index = seasonIndex(season);
  const games: StoryGame[] = [];
  for (const entry of played) {
    const myCode = teamCode(entry.team);
    if (!myCode) continue;
    const stored = index.get(`${myCode}_${entry.week}`);
    if (!stored) continue;
    const ctx = weekContext(stored, myCode, data.player.name);
    if (!ctx) continue;

    const oppTeam = getTeamByAbbreviation(entry.opp);
    const oppCode = teamCode(entry.opp);
    const s = entry.stats;
    const snapPct =
      s.off_snp != null && s.tm_off_snp ? (s.off_snp / s.tm_off_snp) * 100 : null;

    games.push({
      week: entry.week,
      dateMs: ctx.dateMs,
      opp: {
        city: oppTeam?.city ?? oppCode,
        nickname: oppTeam?.nickname ?? oppCode,
        abbr: oppCode,
        useNickname: NICKNAME_CLUBS.has(oppCode),
        logo: oppTeam?.logo ?? null,
      },
      homeAway: ctx.homeAway,
      result: {
        wlt: ctx.teamScore > ctx.oppScore ? "W" : ctx.teamScore < ctx.oppScore ? "L" : "T",
        teamScore: ctx.teamScore,
        oppScore: ctx.oppScore,
      },
      stats: {
        cmp: s.pass_cmp ?? 0,
        att: s.pass_att ?? 0,
        passYds: s.pass_yd ?? 0,
        passTd: s.pass_td ?? 0,
        passInt: s.pass_int ?? 0,
        car: s.rush_att ?? 0,
        rushYds: s.rush_yd ?? 0,
        rushTd: s.rush_td ?? 0,
        tgt: s.rec_tgt ?? 0,
        rec: s.rec ?? 0,
        recYds: s.rec_yd ?? 0,
        recTd: s.rec_td ?? 0,
        fgm: s.fgm ?? 0,
        fga: s.fga ?? 0,
        fgLong: s.fgm_lng ?? 0,
        xpm: s.xpm ?? 0,
        xpa: s.xpa ?? 0,
        fumLost: ctx.fumLost,
      },
      pts: getEntryPoints(entry.stats, data.format),
      rank: entry.pos_rank,
      wasUnderdog: ctx.wasUnderdog,
      trailing2hBy10: ctx.trailing2hBy10,
      // The log's own starter flag (Sleeper's gs, kept since 2026-11-04)
      // where the row has one; the box score's volume read for older rows.
      started: typeof s.gs === "number" ? s.gs > 0 : ctx.started,
      relief: pos === "QB" && typeof s.gs === "number" && s.gs === 0 && (s.pass_att ?? 0) > 0,
      usage: {
        targets: ctx.targets,
        tdReceivers: ctx.tdReceivers,
        snapPct,
        carries: s.rush_att ?? 0,
      },
      override: copyOverride(data.player.id, season, entry.week),
    });
  }
  if (games.length === 0) return null;

  // Season figures, computed from the same played games the pins show.
  const sum = (f: (g: StoryGame) => number): number => games.reduce((t, g) => t + f(g), 0);
  const avgAtt = sum((g) => g.stats.att) / games.length;
  let seasonEff: number | null = null;
  if (pos === "QB") {
    const att = sum((g) => g.stats.att);
    seasonEff = att > 0 ? sum((g) => g.stats.passYds) / att : null;
  } else if (pos === "RB") {
    const car = sum((g) => g.stats.car);
    seasonEff = car > 0 ? sum((g) => g.stats.rushYds) / car : null;
  } else if (pos === "WR" || pos === "TE") {
    const tgt = sum((g) => g.stats.tgt);
    seasonEff = tgt > 0 ? sum((g) => g.stats.recYds) / tgt : null;
  }

  // The season's positional rank, read the way the header reads it: the rate
  // rank where it exists, the points rank until it does.
  const row = data.production.find((r) => r.season === season) ?? null;
  const seasonRank = opts.archive
    ? (row?.posFinishPpg ?? row?.posFinishTotal ?? null)
    : (row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal);

  const latest = games.reduce((a, b) => (b.week > a.week ? b : a));
  const story: StorySeason = {
    pos,
    ppg: sum((g) => g.pts) / games.length,
    seasonRank,
    lastName: lastName(data.player.name),
    avgAtt,
    seasonEff,
    pastTense: Boolean(opts.archive),
    updatedWeek: latest.week,
    updatedDateMs: latest.dateMs,
    hasOverrides: games.some((g) => g.override !== null),
    idSuffix: opts.archive ? `-${season}` : "",
  };

  return { games, story, ink: teamInk(data.seasonTeam ?? data.team) };
}

export function renderGamelogStory(
  data: PlayerPageData,
  opts: { archive?: boolean } = {},
): string {
  const built = buildGamelogStory(data, opts);
  if (!built) return "";
  const { games, story, ink } = built;
  const html =
    renderLadderSection(games, story) + renderBreakdownSection(games, story);
  if (!html) return "";
  return `<div class="scp-ox scp-gl"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>`;
}
