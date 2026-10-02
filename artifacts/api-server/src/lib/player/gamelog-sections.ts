/**
 * "Where His Weeks Finished" and "Game-by-Game Breakdown" — the two Game Log
 * sections of mak's spec of 2026-10-01, directly after the week-by-week table.
 *
 * Both are generated entirely from game data; no API key, no model call. The
 * ladder shows every weekly finish as a pin on a positional scale with the
 * tier-1 and tier-2 ranges shaded — the spread of outcomes a points-per-game
 * average hides. The breakdown gives one card per played game, most recent
 * first: score, a rule-picked headline, the stat line, a one-to-three-sentence
 * note, and the fantasy points with the weekly finish.
 *
 * WHERE THE EXTRA FACTS COME FROM. The Sleeper log carries the stat line and
 * the weekly rank; everything else a card states — the date, home or away, the
 * closing line, trailing by ten in the second half, who the targets went to,
 * fumbles lost — is read from the stored ESPN box scores the matchup pages are
 * built on (data/matchup/boxscores/<season>.json). Stored data only, per the
 * store-verified-data posture: nothing here fetches. A played week whose box
 * score is not stored yet is left out of both sections rather than rendered
 * with an invented "vs" — the spec is explicit that home/away is never
 * defaulted — and it joins them when the store catches up. A season with no
 * stored box scores at all (anything before 2021) renders neither section.
 *
 * VALIDATION. Every number in a headline or note is one of the game's stat
 * values, a rate computed from them, or a count derived from them; every name
 * is from the game's own box score. Sentences whose inputs are missing are
 * dropped, never padded. That is the spec's own rule and it is also why the
 * fumble-unknown case (a box score with no player block) silences the
 * "clean, mistake-free" sentence instead of guessing.
 *
 * The copy generators are exported and pure — the test suite drives them with
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
  /** For the "clean, mistake-free {start|game}" word. */
  started: boolean;
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
  /** Positional rank for the season; null drops the lede's middle clause. */
  seasonRank: number | null;
  /** QB attempts per game — the volume-outlier baseline. */
  avgAtt: number;
  /** Season efficiency: QB Y/A, RB yards per carry, WR/TE yards per target. */
  seasonEff: number | null;
  /** Past-season pages say "finished" and "went" where this season says "get". */
  pastTense: boolean;
  /** The latest played week, for the byline. */
  updatedWeek: number;
  /** The latest played game's kickoff, for the past-season byline date. */
  updatedDateMs: number | null;
  /** True when any card carries analyst copy — it changes the byline. */
  hasOverrides: boolean;
  /** Distinguishes the archive copy's ids from the active season's. */
  idSuffix: string;
}

/* ------------------------------------------------------------- small words */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Counts under ten in words, numerals from there — the spec's number rule. */
const word = (n: number): string => WORDS[n] ?? String(n);
const capWord = (n: number): string => {
  const w = word(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** "a, b and c" — no Oxford comma, per every template in the spec. */
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
 * Band edges sit at half-ranks — the "1" band ends at rank t1 + 0.5 — so a
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
  game: StoryGame;
  x: number;
  best: boolean;
  /** "above" is the default; "below" dodges a neighbour; "none" is sr-only. */
  label: "above" | "below" | "none";
}

/**
 * Lay the pins out and resolve label collisions left to right: a label goes
 * above unless it is within 12 units of the previous above-label, then below
 * unless within 12 of the previous below-label, then nowhere visible. With 10
 * or more games only the best and worst weeks keep labels and a compact
 * legend lists the rest.
 */
export function layoutPins(games: StoryGame[], scale: LadderScale): Pin[] {
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

  const pins: Pin[] = games
    .map((game) => ({
      game,
      x: pinX(game.rank, scale),
      best: game === best,
      label: "above" as const,
    }))
    .sort((a, b) => a.x - b.x || a.game.week - b.game.week);

  const sparse = games.length >= 10;
  let lastAbove: number | null = null;
  let lastBelow: number | null = null;
  for (const pin of pins) {
    if (sparse && !(pin.game === best || pin.game === worst)) {
      pin.label = "none";
      continue;
    }
    if (lastAbove === null || pin.x - lastAbove >= 12) {
      pin.label = "above";
      lastAbove = pin.x;
    } else if (lastBelow === null || pin.x - lastBelow >= 12) {
      pin.label = "below";
      lastBelow = pin.x;
    } else {
      pin.label = "none";
    }
  }
  return pins;
}

/**
 * The lede: the weeks counted by tier, then what the spread between the best
 * and worst week means. Everything in it restates the pins.
 */
export function ladderLede(games: StoryGame[], season: StorySeason, scale: LadderScale): string {
  const pos = season.pos;
  const past = season.pastTense;

  if (games.length === 1) {
    const only = games[0]!;
    return past
      ? `One game played: a ${pos}${only.rank} finish.`
      : `One game in: a ${pos}${only.rank} finish. Check back after a few weeks for a real range.`;
  }

  const t1 = games.filter((g) => g.rank <= scale.t1).length;
  const t2 = games.filter((g) => g.rank > scale.t1 && g.rank <= scale.t2).length;
  const bust = games.length - t1 - t2;

  let countPhrase: string;
  if (t1 === games.length) countPhrase = `All ${word(games.length)} weeks in the ${pos}1 range`;
  else if (t2 === games.length) countPhrase = `All ${word(games.length)} weeks in the ${pos}2 range`;
  else if (bust === games.length) countPhrase = `All ${word(games.length)} weeks outside the top ${scale.t2}`;
  else {
    const parts: string[] = [];
    if (t1 > 0) parts.push(`${word(t1)} ${pos}1 week${t1 === 1 ? "" : "s"}`);
    if (t2 > 0) parts.push(`${word(t2)} ${pos}2 week${t2 === 1 ? "" : "s"}`);
    if (bust > 0) parts.push(`${word(bust)} bust${bust === 1 ? "" : "s"}`);
    countPhrase = joinAnd(parts);
    countPhrase = countPhrase.charAt(0).toUpperCase() + countPhrase.slice(1);
  }

  const bestRank = Math.min(...games.map((g) => g.rank));
  const worstRank = Math.max(...games.map((g) => g.rank));
  const spread = worstRank - bestRank;

  const ceiling =
    bestRank <= 5 ? "top-5" : bestRank <= scale.t1 ? `top-${scale.t1}` : `${pos}${bestRank}`;
  const floor =
    worstRank > scale.t2 ? "waiver-wire" : worstRank > scale.t1 ? `${pos}2` : `${pos}1`;

  let interpretation: string;
  if (spread >= 20) {
    interpretation = past
      ? `the spread mattered more than the average: you got a ${ceiling} ceiling and a ${floor} floor`
      : `the spread matters more than the average: you get a ${ceiling} ceiling and a ${floor} floor`;
  } else if (spread >= 10) {
    interpretation = past
      ? `his weeks clustered in a range you could plan around, between ${pos}${bestRank} and ${pos}${worstRank}`
      : `his weeks cluster in a range you can plan around, between ${pos}${bestRank} and ${pos}${worstRank}`;
  } else {
    interpretation = past
      ? `he was one of the steadier options at the position, never worse than ${pos}${worstRank}`
      : `he's been one of the steadier options at the position, never worse than ${pos}${worstRank}`;
  }

  const posWord = POSITION_WORDS[pos] ?? pos;
  if (season.seasonRank === null) {
    // No season rank to hang the middle clause on: the interpretation stands
    // alone as its own sentence rather than wearing an empty "ranked" clause.
    return `${countPhrase}. ${interpretation.charAt(0).toUpperCase()}${interpretation.slice(1)}.`;
  }
  const ranked = past ? "who finished" : "ranked";
  return `${countPhrase}. For a ${posWord} ${ranked} ${pos}${season.seasonRank} overall, ${interpretation}.`;
}

/** "Weekly finishes on a scale from QB1 to QB32: Week 3 QB4, …" best first. */
function trackAriaLabel(games: StoryGame[], season: StorySeason, scale: LadderScale): string {
  const ordered = [...games].sort((a, b) => a.rank - b.rank || a.week - b.week);
  const list = ordered.map((g) => `Week ${g.week} ${season.pos}${g.rank}`).join(", ");
  return `Weekly finishes on a scale from ${season.pos}1 to ${season.pos}${scale.max}: ${list}.`;
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
  const pins = layoutPins(games, scale);
  const hasBelow = pins.some((p) => p.label === "below");

  const pinHtml = pins
    .map((pin) => {
      const cls =
        "scp-gl-pin" +
        (pin.best ? " is-best" : "") +
        (pin.label === "below" ? " is-below" : "") +
        (pin.label === "none" ? " is-nolabel" : "");
      const at = pin.game.homeAway === "away" ? "@" : "vs";
      return (
        `<div class="${cls}" style="left:${pctTrim(pin.x)}%"><i></i>` +
        `<span><strong>${escapeHtml(`${pos}${pin.game.rank}`)}</strong>` +
        `${escapeHtml(`Wk ${pin.game.week} ${at} ${pin.game.opp.abbr}`)}</span></div>`
      );
    })
    .join("");

  // Weeks whose labels found no room, named under the key instead.
  const hidden = pins.filter((p) => p.label === "none").map((p) => p.game);
  const sparse = games.length >= 10;
  const also =
    !sparse && hidden.length
      ? `<span class="scp-gl-also">${escapeHtml(
          `Also: ${hidden.map((g) => `Wk ${g.week} (${pos}${g.rank})`).join(", ")}`,
        )}</span>`
      : "";
  const legend = sparse
    ? `<p class="scp-gl-legend">${escapeHtml(
        [...games]
          .sort((a, b) => a.week - b.week)
          .map((g) => `Wk ${g.week} ${pos}${g.rank}`)
          .join(" · "),
      )}</p>`
    : "";

  return (
    `<section class="scp-ox-sec scp-gl-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase("Where his weeks finished"))}</h2>` +
    `<p class="scp-ox-lede">${escapeHtml(ladderLede(games, season, scale))}</p>` +
    `<figure class="scp-gl-ladder" style="margin:0">` +
    `<div class="scp-gl-track${hasBelow ? " has-below" : ""}" role="img" aria-label="${escapeHtml(
      trackAriaLabel(games, season, scale),
    )}">` +
    `<div class="scp-gl-band is-b1" style="width:${pctTrim(band1)}%"></div>` +
    `<div class="scp-gl-band is-b2" style="left:${pctTrim(band1)}%;width:${pctTrim(band2end - band1)}%"></div>` +
    pinHtml +
    `</div>` +
    `<div class="scp-gl-axis" aria-hidden="true">` +
    [1, scale.t1, scale.t2, scale.max].map((r) => `<span>${escapeHtml(`${pos}${r}`)}</span>`).join("") +
    `</div>` +
    `<figcaption class="scp-gl-key">` +
    `<span class="is-k1">${escapeHtml(`${pos}1 range (top ${scale.t1})`)}</span>` +
    `<span class="is-k2">${escapeHtml(`${pos}2 range (${scale.t1 + 1}–${scale.t2})`)}</span>` +
    `<span class="is-k3">${escapeHtml(`Bench range (${scale.t2 + 1}+)`)}</span>` +
    also +
    `</figcaption>` +
    legend +
    `</figure>` +
    `</section>`
  );
}

/* ------------------------------------------------------------- stat lines */

/** "4 carries" / "1 carry" — the one noun the spec inflects by count. */
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

  // 1. The season's highest-points game, finished top-5.
  if (seasonHigh && game.rank <= 5) {
    if (game.result.teamScore + game.result.oppScore >= 60) return "Season high in a shootout";
    return game.result.wlt === "L" ? "Season high in a loss" : "Season high in a win";
  }
  // 2. A tier-1 week.
  if (game.rank <= scale.t1) return `${pos}1 week ${at} ${city}`;
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
  // 5. Everything else.
  return game.rank <= scale.t2
    ? `Steady in a ${resultWord} ${at} ${city}`
    : `Quiet ${resultWord} ${at} ${city}`;
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

  // 1. Volume outlier — defined for the quarterback's attempt count.
  let usedVolume = false;
  if (pos === "QB" && season.avgAtt > 0 && s.att >= 1.25 * season.avgAtt) {
    usedVolume = true;
    const chasing = game.trailing2hBy10 ? " while chasing points" : "";
    const totalTd = s.passTd + s.rushTd + s.recTd;
    sentences.push(
      totalTd > 0
        ? `A ${s.att}-attempt game${chasing} produced ${word(totalTd)} total touchdown${totalTd === 1 ? "" : "s"}.`
        : `A ${s.att}-attempt game${chasing} that never found the end zone.`,
    );
  }

  // 2. Usage, only where the box score supplied it.
  if (pos === "QB" && game.usage?.targets && game.usage.targets.length >= 2) {
    const [a, b] = game.usage.targets;
    const sum = a!.targets + b!.targets;
    const whose = usedVolume ? "those" : `his ${s.att}`;
    let sentence = `${sum} of ${whose} throws went to ${a!.name} (${a!.targets} targets) and ${b!.name} (${b!.targets})`;
    const tds = game.usage.tdReceivers ?? [];
    if (tds.length > 0) {
      // Full names on first mention within the note, last names after.
      const mentioned = new Set([nameKey(a!.name), nameKey(b!.name)]);
      const names = tds.map((n) => (mentioned.has(nameKey(n)) ? lastName(n) : n));
      sentence += `, and his TD pass${tds.length === 1 ? "" : "es"} went to ${joinAnd(names)}`;
    }
    sentences.push(sentence + ".");
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
    if (bestEffWeek !== null && game.week === bestEffWeek) {
      sentences.push(`His most efficient game of the season at ${one(g1)} yards per ${unit}.`);
    } else if (g1 <= s1 - 1.5) {
      sentences.push(`Just ${one(g1)} yards per ${unit}.`);
    } else if (pos === "QB" && g1 < s1) {
      sentences.push(`At ${one(g1)} yards per attempt, most of it came underneath.`);
    } else if (pos === "QB" && g1 >= s1 + 1.0) {
      sentences.push(`At ${one(g1)} yards per attempt, he pushed the ball downfield.`);
    }
    // The in-between readings are quarterback sentences — "underneath" and
    // "downfield" describe throws — so the other positions skip them.
  }

  // 4. A bust that still found the end zone.
  const totalTd = s.passTd + s.rushTd + s.recTd;
  if (game.rank > scale.t2 && totalTd > 0) {
    sentences.push(
      `The touchdown${totalTd === 1 ? "" : "s"} kept it from being a total loss, but this is his floor when the offense can't sustain drives.`,
    );
  }

  // 5. Ball security, and where the game landed against his average.
  if (season.ppg > 0) {
    const delta = (game.pts - season.ppg) / season.ppg;
    const relation =
      Math.abs(delta) <= 0.1
        ? `right at his ${season.pastTense ? "" : "current "}season average`
        : delta > 0
          ? "well above his season average"
          : "well below his season average";
    const ints = pos === "QB" ? s.passInt : 0;
    const fum = s.fumLost;
    if (ints === 0 && fum === 0) {
      sentences.push(
        `A clean, mistake-free ${game.started ? "start" : "game"} that landed ${relation}.`,
      );
    } else if (ints > 0 || (fum ?? 0) > 0) {
      // With no interceptions the sentence opens on the fumbles instead of a
      // "Zero interceptions" nobody would write.
      const parts: string[] = [];
      if (ints > 0) parts.push(`${capWord(ints)} interception${ints === 1 ? "" : "s"}`);
      if ((fum ?? 0) > 0) {
        const f = fum!;
        const clause = `${ints > 0 ? word(f) : capWord(f)} lost fumble${f === 1 ? "" : "s"}`;
        parts.push(clause);
      }
      sentences.push(`${parts.join(" and ")} in a game that landed ${relation}.`);
    }
    // ints === 0 with fumbles unknown: the box score had no player block, so
    // neither "mistake-free" nor a turnover count can be verified. Dropped.
  }

  return sentences.slice(0, 3).join(" ");
}

/* ------------------------------------------------------------------- cards */

/**
 * Section B. One card per played game, most recent first, with the generated
 * headline and note — or the analyst's, where an override is stored.
 */
export function renderBreakdownSection(games: StoryGame[], season: StorySeason): string {
  const scale = SCALES[season.pos];
  if (!scale || games.length === 0) return "";

  const pos = season.pos;
  const id = `gl-breakdown-h${season.idSuffix}`;

  // Season-wide readings each card compares itself against.
  let high: StoryGame | null = null;
  for (const g of games) {
    if (!high || g.pts > high.pts || (g.pts === high.pts && g.week > high.week)) high = g;
  }
  // The most efficient game of the season, at the position's minimum volume.
  let bestEffWeek: number | null = null;
  if (pos === "QB") {
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

  const cards = [...games]
    .sort((a, b) => b.week - a.week)
    .map((game) => {
      const cardCls =
        game.rank <= scale.t1 ? " is-t12" : game.rank > scale.t2 ? " is-low" : "";
      const badgeCls =
        game.rank <= scale.t1 ? "is-t12" : game.rank <= scale.t2 ? "is-t24" : "is-low";
      const scoreCls =
        game.result.wlt === "W" ? " is-w" : game.result.wlt === "L" ? " is-l" : "";
      const { m, d } = easternDate(game.dateMs);
      const headline =
        game.override?.headline ?? headlineFor(game, season, scale, game === high);
      const note = game.override?.note ?? noteFor(game, season, scale, bestEffWeek);
      const at = game.homeAway === "away" ? "@" : "vs";

      return (
        `<article class="scp-gl-game${cardCls}">` +
        `<div>` +
        `<div class="scp-gl-when">${escapeHtml(`Week ${game.week}, ${MONTHS_SHORT[m]} ${d}`)}</div>` +
        `<div class="scp-gl-opp">${escapeHtml(`${at} ${game.opp.nickname}`)}</div>` +
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
    })
    .join("");

  return (
    `<section class="scp-ox-sec scp-gl-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase("Game-by-game breakdown"))}</h2>` +
    (byline ? `<p class="scp-gl-byline">${byline}</p>` : "") +
    `<div class="scp-gl-games">${cards}</div>` +
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
 * point", exactly — no play-by-play needed beyond the plays that scored.
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
  // A game the player's club is not in — a mid-season trade whose log row
  // still carries the old code — is no game to write a card about.
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
export function renderGamelogStory(
  data: PlayerPageData,
  opts: { archive?: boolean } = {},
): string {
  const pos = data.player.position ?? "";
  const scale = SCALES[pos];
  if (!scale) return "";

  const season = opts.archive ? data.logSeason : data.season;
  const log = data.seasonLog;
  const played = log.filter(
    (e): e is GameLogEntry & { pos_rank: number } =>
      e.game_status === "active" && typeof e.pos_rank === "number",
  );
  if (played.length === 0) return "";

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
      started: ctx.started,
      usage: {
        targets: ctx.targets,
        tdReceivers: ctx.tdReceivers,
        snapPct,
        carries: s.rush_att ?? 0,
      },
      override: copyOverride(data.player.id, season, entry.week),
    });
  }
  if (games.length === 0) return "";

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
    avgAtt,
    seasonEff,
    pastTense: Boolean(opts.archive),
    updatedWeek: latest.week,
    updatedDateMs: latest.dateMs,
    hasOverrides: games.some((g) => g.override !== null),
    idSuffix: opts.archive ? `-${season}` : "",
  };

  const html =
    renderLadderSection(games, story) + renderBreakdownSection(games, story);
  if (!html) return "";
  const ink = teamInk(data.seasonTeam ?? data.team);
  return `<div class="scp-ox scp-gl"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>`;
}
