/**
 * The body of a matchup recap page: everything under the scoreboard hero.
 *
 * Main column: why the winner won, the head-to-head, the fantasy outlook, the
 * FAQ, related pages. Sidebar: the Redraft Command card and the game's facts.
 * The hero owns the page's one H1, so every section here starts at H2.
 *
 * Pure: a RecapBodyInput in, HTML out, and every figure derived from it. The
 * series record is counted from the series' own scores each time - never
 * carried as a number beside them - so the record, the tiles, the meetings
 * list, the FAQ and the FAQ's JSON-LD cannot disagree with each other: change
 * one score and all five move together. Away and home, and each side's score,
 * are read from the explicit fields of each game, never from list order.
 *
 * The page assembles the input from MatchupData in matchup-render.ts.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import type { BoxTeamStats } from "./boxscore";
import { superBowlNumeral } from "./recap";
import {
  allTimeAnswer,
  allTimeSummary,
  renderAllTimeTiles,
  rivalryIntro,
  type RivalryInput,
  type RivalryTeam,
} from "./rivalry";
import {
  pairColors,
  scoreboardKickoff,
  scoreboardResult,
  type ScoreboardGame,
} from "./scoreboard-hero";

/* ------------------------------------------------------------------ input */

export interface BodyTeam {
  /** Display code, upper case: "LAR". */
  abbr: string;
  /** "Los Angeles Rams". */
  name: string;
  /** "Rams". */
  short: string;
  /** "Ram": one player's worth, from the team table. */
  singular: string;
  /** "Los Angeles". */
  city: string;
  /** The team hub, or null when this site has no address for it. */
  hub: string | null;
  /** The team's matchups page, or null. */
  matchups: string | null;
}

/** A completed meeting in the series. */
export interface SeriesGame {
  season: number;
  /** "Week 4", "Wild Card". */
  weekLabel: string;
  playoff: boolean;
  /** ISO kickoff, or null. */
  kickoff: string | null;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  neutral: boolean;
  /** This game's recap page; null for the game this page is about. */
  url: string | null;
  /** Whether this is the game the page is about. */
  current: boolean;
}

export interface UpcomingGame {
  season: number;
  weekLabel: string;
  kickoff: string | null;
  timeConfirmed: boolean;
  away: string;
  home: string;
  neutral: boolean;
  /** Where a neutral-site game is played, when known. */
  venueCity: string | null;
}

export interface RecapBodyLinks {
  redraftCommand: string;
  startSit: string;
  projections: string;
  tradeCalculator: string;
  pointsAllowed: string | null;
  strengthOfSchedule: string | null;
  /** Redraft Command's matchup analyzer, when the site has one configured. */
  matchupAnalyzer?: string | null;
}

/** The game's top fantasy scorers in PPR, best first, for the FAQ. */
export interface FaqScorer {
  name: string;
  ppr: number;
  line: string;
}

export interface RecapBodyInput {
  game: ScoreboardGame;
  /** Both clubs, keyed by abbr. */
  teams: Record<string, BodyTeam>;
  stats: { away: BoxTeamStats | null; home: BoxTeamStats | null };
  series: { sinceSeason: number; games: SeriesGame[]; upcoming: UpcomingGame[] };
  links: RecapBodyLinks;
  /** The all-time series, when the page has it. */
  rivalry?: RivalryInput | null;
  /** The two best PPR lines in the game, for the FAQ; omitted without player lines. */
  topScorers?: FaqScorer[];
  /** Game info's extra rows, only what a feed carries. */
  info?: { tv: string | null; attendance: number | null };
  /** What the FAQ may say beyond the box score; each part omitted without data. */
  faqFacts?: FaqFacts;
}

/** A player line the FAQ can quote: "8 catches for 122 yards and a touchdown". */
export interface FaqPlayer {
  name: string;
  /** Display code. */
  team: string;
  pos: string | null;
  /** The stat line in words. */
  line: string;
  /** The player's game log for the season, or null. */
  logUrl: string | null;
}

export interface FaqFantasyPlayer extends FaqPlayer {
  ppr: number;
  half: number;
  std: number;
  /** "WR6" for the week, PPR; null when unranked. */
  finish: string | null;
  /** Share of the team's targets or carries, 0–1, when it is the story. */
  targetShare: number | null;
  carryShare: number | null;
}

export interface FaqXfpPlayer {
  name: string;
  team: string;
  ppr: number;
  xfp: number;
}

export interface FaqFacts {
  /** The recap's one-sentence summary and its yardage sentence. */
  story?: string | null;
  leaders?: { passing?: FaqPlayer; rushing?: FaqPlayer; receiving?: FaqPlayer };
  /** The top fantasy scorers, PPR order. */
  fantasy?: FaqFantasyPlayer[];
  xfp?: { over?: FaqXfpPlayer; under?: FaqXfpPlayer; volume?: FaqXfpPlayer };
  /** The score that put the winner ahead for good, fourth quarter or later. */
  winningPlay?: { text: string; team: string; quarter: number; clock: string; away: number; home: number } | null;
  /** The winner's lowest win probability, when it came back. */
  comeback?: { low: number; lowPeriod: string } | null;
  /** The biggest single swing in the home side's win probability. */
  swing?: { text: string; team: string; before: number; after: number; quarter: number; clock: string } | null;
  /** Interceptions and lost fumbles, from the drive chart; null without one. */
  turnovers?: { away: number; home: number } | null;
  /** The closing line, as the page's betting section reads it. */
  odds?: { favorite: string | null; line: number; total: number } | null;
  /** Each team's season schedule page. */
  schedules?: Record<string, string | null>;
}

/* ------------------------------------------------------------------ atoms */

const DASH = "–";
const MINUS = "−";
const EASTERN = "America/New_York";

function eastern(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, ...options }).format(new Date(iso));
}

/** "Sun, Oct 18, 2026" */
function shortDate(iso: string): string {
  return eastern(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "January 17, 2022" */
function longDate(iso: string): string {
  return eastern(iso, { month: "long", day: "numeric", year: "numeric" });
}

/** "2026-10-18": the Eastern calendar date, for <time datetime>. */
function isoDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function time(iso: string | null, text: (iso: string) => string): string {
  if (!iso) return "Date TBD";
  return `<time datetime="${escapeHtml(isoDate(iso))}">${escapeHtml(text(iso))}</time>`;
}

/** "Wk 4" for a week; the round, conference dropped, for the postseason. */
function shortLabel(label: string, playoff: boolean): string {
  if (playoff) return label.replace(/^(AFC|NFC)\s+/, "");
  return label.replace(/^Week\s+/, "Wk ");
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

function clock(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function h2(id: string, text: string): string {
  return `<h2 class="sct-rb-h2" id="${id}">${escapeHtml(text)}</h2>`;
}

function subtitle(text: string): string {
  return text ? `<p class="sct-rb-sub">${escapeHtml(text)}</p>` : "";
}

function section(id: string, heading: string, body: string, extraClass = ""): string {
  return (
    `<section class="sct-rb-section${extraClass ? ` ${extraClass}` : ""}" aria-labelledby="${id}">` +
    h2(id, heading) +
    body +
    `</section>`
  );
}

/** Each club's text and fill color on this page, told apart - see pairColors(). */
function colorsOf(input: RecapBodyInput, abbr: string): { ink: string; fill: string } {
  const colors = pairColors(input.game.away.abbr, input.game.home.abbr);
  return abbr === input.game.home.abbr ? colors.home : colors.away;
}

function teamStyle(input: RecapBodyInput, abbr: string): string {
  const c = colorsOf(input, abbr);
  return `--rb-team:${c.ink};--rb-fill:${c.fill}`;
}

/* ----------------------------------------------------------------- series */

interface Tally {
  wins: Record<string, number>;
  ties: number;
  games: number;
}

/** Wins per club and ties, counted from the scores. */
export function seriesTally(input: RecapBodyInput): Tally {
  const wins: Record<string, number> = { [input.game.away.abbr]: 0, [input.game.home.abbr]: 0 };
  let ties = 0;
  for (const g of input.series.games) {
    if (g.awayScore > g.homeScore) wins[g.away] = (wins[g.away] ?? 0) + 1;
    else if (g.homeScore > g.awayScore) wins[g.home] = (wins[g.home] ?? 0) + 1;
    else ties += 1;
  }
  return { wins, ties, games: input.series.games.length };
}

interface Record_ {
  /** "8–3", or "8–3–1" with ties. Leader first. */
  text: string;
  leader: BodyTeam | null;
}

export function seriesRecord(input: RecapBodyInput): Record_ {
  const tally = seriesTally(input);
  const [x, y] = [input.game.away.abbr, input.game.home.abbr];
  const wx = tally.wins[x] ?? 0;
  const wy = tally.wins[y] ?? 0;
  const leader = wx === wy ? null : input.teams[wx > wy ? x : y] ?? null;
  const text =
    `${Math.max(wx, wy)}${DASH}${Math.min(wx, wy)}` + (tally.ties ? `${DASH}${tally.ties}` : "");
  return { text, leader };
}

function winnerOf(g: SeriesGame): string | null {
  return g.awayScore > g.homeScore ? g.away : g.homeScore > g.awayScore ? g.home : null;
}

/** "Cardinals 37–20", winner first; "Tie 20–20". */
function resultPhrase(input: RecapBodyInput, g: SeriesGame): string {
  const w = winnerOf(g);
  if (!w) return `Tie ${g.awayScore}${DASH}${g.homeScore}`;
  const high = Math.max(g.awayScore, g.homeScore);
  const low = Math.min(g.awayScore, g.homeScore);
  return `${input.teams[w]?.short ?? w} ${high}${DASH}${low}`;
}

/* ------------------------------------------------------ section 1: why won */

export type Better = "higher" | "lower" | "neither";

interface StatRow {
  label: string;
  away: number | null;
  home: number | null;
  format: (n: number) => string;
  better: Better;
}

function statRows(away: BoxTeamStats, home: BoxTeamStats): StatRow[] {
  const whole = (n: number): string => String(Math.round(n));
  return [
    { label: "Total yards", away: away.totalYards, home: home.totalYards, format: whole, better: "higher" },
    {
      label: "Yards per play",
      away: away.yardsPerPlay,
      home: home.yardsPerPlay,
      format: (n) => n.toFixed(1),
      better: "higher",
    },
    { label: "Plays", away: away.plays, home: home.plays, format: whole, better: "neither" },
    { label: "Turnovers", away: away.turnovers, home: home.turnovers, format: whole, better: "lower" },
    {
      label: "Third-down conversion",
      away: away.thirdDown?.percent ?? null,
      home: home.thirdDown?.percent ?? null,
      format: (n) => `${Math.round(n)}%`,
      better: "higher",
    },
    {
      label: "Time of possession",
      away: away.possessionSeconds,
      home: home.possessionSeconds,
      format: clock,
      better: "higher",
    },
  ];
}

/** The away side's share of the bar, as a percentage. */
export function awayShare(row: { away: number; home: number; better: Better }): number {
  const total = row.away + row.home;
  if (total === 0) return 50;
  // Lower is better: each side's bar is the OTHER side's count, so the team
  // with fewer turnovers draws the longer bar.
  const mine = row.better === "lower" ? row.home : row.away;
  return Math.round((mine / total) * 1000) / 10;
}

/** Which side the row favors, or null for none (or a "neither" metric). */
function favored(row: Pick<StatRow, "away" | "home" | "better">): "away" | "home" | null {
  if (row.away === null || row.home === null || row.better === "neither") return null;
  if (row.away === row.home) return null;
  const awayHigher = row.away > row.home;
  return row.better === "higher" ? (awayHigher ? "away" : "home") : awayHigher ? "home" : "away";
}

const BATTLES: Array<{ name: string; label: string }> = [
  { name: "efficiency", label: "Yards per play" },
  { name: "turnover", label: "Turnovers" },
  { name: "third-down", label: "Third-down conversion" },
  { name: "time of possession", label: "Time of possession" },
];

/** "Los Angeles", or "the Rams" when the two clubs share a city. */
function place(input: RecapBodyInput, abbr: string): string {
  const team = input.teams[abbr]!;
  const other = Object.values(input.teams).find((t) => t.abbr !== abbr);
  return other && other.city === team.city ? `the ${team.short}` : team.city;
}

function battlesLine(input: RecapBodyInput, rows: StatRow[]): string {
  const { game } = input;
  const result = scoreboardResult(game);
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  const won: Record<"away" | "home", string[]> = { away: [], home: [] };
  for (const battle of BATTLES) {
    const row = byLabel.get(battle.label);
    const side = row ? favored(row) : null;
    if (side) won[side].push(battle.name);
  }
  const battles = (names: string[]): string =>
    `${list(names)} battle${names.length === 1 ? "" : "s"}`;

  if (!result) return "";
  if (result.winner === null) {
    const parts = (["away", "home"] as const)
      .filter((s) => won[s].length)
      .map((s) => `${place(input, game[s].abbr)} won the ${battles(won[s])}`);
    return parts.length ? `${cap(parts.join(" and "))}.` : "";
  }
  const w = result.winner;
  const l = w === "home" ? "away" : "home";
  const who = cap(place(input, game[w].abbr));
  if (won[w].length) return `${who} won the ${battles(won[w])}.`;
  if (won[l].length) return `${who} won despite losing the ${battles(won[l])}.`;
  return `${who} won with the two sides level on efficiency, turnovers, third downs and possession.`;
}

interface Takeaway {
  value: string;
  /** "yards/play", "turnover margin". */
  label: string;
  /** "SEA 5.9 · NE 4.1", "SEA 0 turnovers". */
  sub: string;
  /** The comparison row it stands for, which then leads the table. */
  row: string;
}

/**
 * The winner's three clearest edges, in the order that answers "why":
 * efficiency, turnovers, yardage, then third downs and possession to fill a
 * slot the winner lost. Only edges the winner actually had, so no takeaway is
 * ever negative; fewer than three when fewer exist (mak, 2026-09-30).
 */
function takeaways(input: RecapBodyInput): Takeaway[] {
  const { game } = input;
  const result = scoreboardResult(game);
  if (!result || result.winner === null) return [];
  const w = result.winner;
  const l = w === "home" ? "away" : "home";
  const ws = input.stats[w];
  const ls = input.stats[l];
  if (!ws || !ls) return [];
  const W = game[w].abbr;
  const L = game[l].abbr;
  const both = (x: string, y: string): string => `${W} ${x} · ${L} ${y}`;

  const out: Takeaway[] = [];
  const ypp = ws.yardsPerPlay !== null && ls.yardsPerPlay !== null ? ws.yardsPerPlay - ls.yardsPerPlay : null;
  if (ypp !== null && ypp > 0) {
    out.push({
      value: `+${ypp.toFixed(1)}`,
      label: "yards/play",
      sub: both(ws.yardsPerPlay!.toFixed(1), ls.yardsPerPlay!.toFixed(1)),
      row: "Yards per play",
    });
  }
  const to = ws.turnovers !== null && ls.turnovers !== null ? ls.turnovers - ws.turnovers : null;
  if (to !== null && to > 0) {
    out.push({
      value: `+${to}`,
      label: "turnover margin",
      sub: ws.turnovers === 0 ? `${W} 0 turnovers` : `${both(String(ws.turnovers), String(ls.turnovers))} turnovers`,
      row: "Turnovers",
    });
  }
  const yards = ws.totalYards !== null && ls.totalYards !== null ? ws.totalYards - ls.totalYards : null;
  if (yards !== null && yards > 0) {
    out.push({
      value: `+${yards}`,
      label: "total yards",
      sub: both(String(ws.totalYards), String(ls.totalYards)),
      row: "Total yards",
    });
  }
  const wt = ws.thirdDown?.percent ?? null;
  const lt = ls.thirdDown?.percent ?? null;
  if (wt !== null && lt !== null && wt > lt) {
    out.push({
      value: `+${Math.round(wt - lt)}%`,
      label: "third-down rate",
      sub: both(`${Math.round(wt)}%`, `${Math.round(lt)}%`),
      row: "Third-down conversion",
    });
  }
  const tp = ws.possessionSeconds !== null && ls.possessionSeconds !== null ? ws.possessionSeconds - ls.possessionSeconds : null;
  if (tp !== null && tp > 0) {
    out.push({
      value: `+${clock(tp)}`,
      label: "time of possession",
      sub: both(clock(ws.possessionSeconds!), clock(ls.possessionSeconds!)),
      row: "Time of possession",
    });
  }
  return out.slice(0, 3);
}

/** One row of a two-team stat comparison: the figures, as shown, and which end is better. */
export interface CompareRow {
  /** Below the key rows, smaller, under an "Other team stats" divider. */
  secondary?: boolean;
  label: string;
  away: number | null;
  home: number | null;
  awayText: string;
  homeText: string;
  better: Better;
}

/**
 * The two-team comparison table "Why won" draws: the figure either side of the
 * stat name, the better one emphasized, and a split bar under each row. Season
 * Form uses it too, so the two sections read as one design.
 */
export function renderStatCompare(opts: {
  caption: string;
  awayName: string;
  homeName: string;
  awayInk: string;
  homeInk: string;
  rows: CompareRow[];
}): string {
  const value = (row: CompareRow, side: "away" | "home"): string => {
    const better = favored(row) === side;
    return (
      `<td class="sct-rb-val is-${side}${better ? " is-better" : ""}">` +
      escapeHtml(side === "away" ? row.awayText : row.homeText) +
      `</td>`
    );
  };

  let divided = false;
  const body = opts.rows
    .map((row) => {
      const divider =
        row.secondary && !divided && opts.rows.some((r) => !r.secondary)
          ? `<tr class="sct-rb-divider"><th colspan="3" scope="rowgroup">Other team stats</th></tr>`
          : "";
      if (row.secondary) divided = true;
      const cls = row.secondary ? " is-secondary" : "";
      const share =
        row.away === null || row.home === null
          ? 50
          : awayShare({ away: row.away, home: row.home, better: row.better });
      return (
        divider +
        `<tr class="sct-rb-stat${cls}">` +
        value(row, "away") +
        `<th scope="row" class="sct-rb-stat-name">${escapeHtml(row.label)}</th>` +
        value(row, "home") +
        `</tr>` +
        `<tr class="sct-rb-barrow${cls}" aria-hidden="true"><td colspan="3">` +
        `<span class="sct-rb-bar">` +
        `<span class="sct-rb-bar-away" style="width:${share}%"></span>` +
        `<span class="sct-rb-bar-home" style="width:${Math.round((100 - share) * 10) / 10}%"></span>` +
        `</span></td></tr>`
      );
    })
    .join("");

  return (
    `<table class="sct-rb-table" style="${escapeHtml(`--rb-away:${opts.awayInk};--rb-home:${opts.homeInk}`)}">` +
    `<caption class="sct-rb-sr">${escapeHtml(opts.caption)}</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="sct-rb-col-away">${escapeHtml(opts.awayName)}</th>` +
    `<th scope="col" class="sct-rb-col-stat">Stat</th>` +
    `<th scope="col" class="sct-rb-col-home">${escapeHtml(opts.homeName)}</th>` +
    `</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table>`
  );
}

export function renderWhyWon(input: RecapBodyInput): string {
  const { game } = input;
  const away = input.stats.away;
  const home = input.stats.home;
  if (!away || !home) return "";
  const result = scoreboardResult(game);
  if (!result) return "";

  const rows = statRows(away, home).filter((r) => r.away !== null || r.home !== null);
  if (rows.length === 0) return "";

  const heading =
    result.winner === null
      ? `${game.away.short} vs ${game.home.short} by the numbers`
      : `Why the ${game[result.winner].short} won`;

  // The key advantages first, then the rows that back them in the same
  // order, then everything else as secondary stats (mak, 2026-09-30). A tie
  // has no advantages, so its rows keep their order and all read as key.
  const keys = takeaways(input).map((t) => t.row);
  const ordered = keys.length
    ? [
        ...keys.map((k) => rows.find((r) => r.label === k)).filter((r): r is StatRow => r !== undefined),
        ...rows.filter((r) => !keys.includes(r.label)),
      ]
    : rows;

  const table = renderStatCompare({
    caption: `Team stats comparison, ${game.away.short} vs ${game.home.short}`,
    awayName: game.away.short,
    homeName: game.home.short,
    awayInk: colorsOf(input, game.away.abbr).ink,
    homeInk: colorsOf(input, game.home.abbr).ink,
    rows: ordered.map((row) => ({
      secondary: keys.length > 0 && !keys.includes(row.label),
      label: row.label,
      away: row.away,
      home: row.home,
      awayText: row.away === null ? "-" : row.format(row.away),
      homeText: row.home === null ? "-" : row.format(row.home),
      better: row.better,
    })),
  });

  // The key advantages themselves sit in the recap story, above this
  // (mak, 2026-09-30); the table still leads with their rows.
  return section("why", heading, subtitle(battlesLine(input, rows)) + table);
}

/**
 * The winner's key advantages ("+1.8 yards/play", "SEA 5.9 · NE 4.1") under a
 * "Key advantages" label, in the winner's color, or "" for a tie or a game
 * without team stats. In the recap story, under its text.
 */
export function renderTakeaways(input: RecapBodyInput, extra = ""): string {
  const result = scoreboardResult(input.game);
  const items = takeaways(input);
  const winnerAbbr = result?.winner ? input.game[result.winner].abbr : null;
  if (!items.length || !winnerAbbr) return "";
  return (
    `<div class="sct-rb-advantages${extra ? ` ${extra}` : ""}">` +
    `<p class="sct-rb-kicker">Key advantages</p>` +
    `<ul class="sct-rb-takeaways" style="${escapeHtml(teamStyle(input, winnerAbbr))}">` +
    items
      .map(
        (t) =>
          `<li><span class="sct-rb-take-value">${escapeHtml(t.value)}</span> ` +
          `<span class="sct-rb-take-label">${escapeHtml(t.label)}</span> ` +
          `<span class="sct-rb-take-sub">${escapeHtml(t.sub)}</span></li>`,
      )
      .join("") +
    `</ul>` +
    `</div>`
  );
}

/* ------------------------------------------------ section 2: head-to-head */

/** Both sides as the all-time tiles name and color them. */
function rivalryTeams(input: RecapBodyInput): [RivalryTeam, RivalryTeam] {
  const side = (abbr: string, short: string): RivalryTeam => ({ abbr, short, ink: colorsOf(input, abbr).ink });
  return [side(input.game.away.abbr, input.game.away.short), side(input.game.home.abbr, input.game.home.short)];
}

/** The all-time summary for this page, or null without rivalry data. */
export function recapAllTime(input: RecapBodyInput) {
  return input.rivalry ? allTimeSummary(input.rivalry, input.game.away.abbr, input.game.home.abbr) : null;
}

function tileLetters(input: RecapBodyInput): { letters: Record<string, string>; wide: boolean } {
  const [x, y] = [input.game.away.abbr, input.game.home.abbr];
  const tx = input.teams[x]!;
  const ty = input.teams[y]!;
  const same = tx.short.charAt(0).toUpperCase() === ty.short.charAt(0).toUpperCase();
  return same
    ? { letters: { [x]: tx.abbr, [y]: ty.abbr }, wide: true }
    : {
        letters: { [x]: tx.short.charAt(0).toUpperCase(), [y]: ty.short.charAt(0).toUpperCase() },
        wide: false,
      };
}

function gameLabel(g: { season: number; weekLabel: string; playoff: boolean }): string {
  return `${g.season} ${shortLabel(g.weekLabel, g.playoff)}`;
}

function meetingTeams(input: RecapBodyInput, away: string, home: string, neutral: boolean): string {
  return `${input.teams[away]?.short ?? away} ${neutral ? "vs" : "at"} ${input.teams[home]?.short ?? home}`;
}

function recentRow(input: RecapBodyInput, g: SeriesGame): string {
  const w = winnerOf(g);
  const label =
    `<span class="sct-rb-mt-label"><b>${g.season}</b> ` +
    `${escapeHtml(shortLabel(g.weekLabel, g.playoff))}</span>`;
  const teams = meetingTeams(input, g.away, g.home, g.neutral);
  const matchup = g.url
    ? `<a class="sct-rb-mt-link" href="${escapeHtml(g.url)}">${escapeHtml(teams)}` +
      `<span class="sct-rb-sr">${escapeHtml(`, ${gameLabel(g)} recap`)}</span></a>`
    : `<span>${escapeHtml(teams)}</span>`;

  // Winner first; a tie keeps away then home.
  const sides = [
    { abbr: g.away, points: g.awayScore },
    { abbr: g.home, points: g.homeScore },
  ];
  if (w === g.home) sides.reverse();
  const score =
    `<span class="sct-rb-mt-score">` +
    sides
      .map(
        (s, i) =>
          `<span class="${w && i === 0 ? "is-win" : "is-other"}">` +
          `${escapeHtml(input.teams[s.abbr]?.abbr ?? s.abbr)} ${s.points}</span>`,
      )
      .join(" ") +
    `</span>`;
  const chip = w
    ? `<span class="sct-rb-chip is-win" style="${escapeHtml(`--rb-fill:${colorsOf(input, w).fill}`)}">` +
      `${escapeHtml(`${input.teams[w]?.abbr ?? w} W`)}</span>`
    : `<span class="sct-rb-chip is-tie">T</span>`;

  return (
    `<li class="sct-rb-mt${g.current ? " is-current" : ""}"` +
    (g.current ? ` aria-current="page"` : "") +
    `>` +
    // Spaces between the parts: the grid ignores them, and without them the
    // row's text reads "2025 Wk 18Cardinals at RamsSun, Jan 4" to anything
    // that reads the text rather than the layout.
    [
      label,
      `<span class="sct-rb-mt-match">${matchup} ` +
        `<span class="sct-rb-mt-date">${time(g.kickoff, shortDate)}</span></span>`,
      score,
      chip,
    ].join(" ") +
    `</li>`
  );
}

function upcomingRow(input: RecapBodyInput, g: UpcomingGame): string {
  return (
    `<li class="sct-rb-mt is-upcoming">` +
    [
      `<span class="sct-rb-mt-label"><b>${escapeHtml(g.weekLabel)}</b></span>`,
      `<span class="sct-rb-mt-match"><span>${escapeHtml(meetingTeams(input, g.away, g.home, g.neutral))}</span> ` +
        `<span class="sct-rb-mt-date">${time(g.kickoff, shortDate)}</span></span>`,
      `<span class="sct-rb-mt-score"></span>`,
      `<span class="sct-rb-chip is-upcoming">Upcoming</span>`,
    ].join(" ") +
    `</li>`
  );
}

export function renderHeadToHead(input: RecapBodyInput): string {
  const { game, series } = input;
  const allTime = recapAllTime(input);
  if (series.games.length === 0 && series.upcoming.length === 0 && !allTime) return "";
  const record = seriesRecord(input);
  const n = series.games.length;

  // All-time first - the intro and four tiles - then the recent series under
  // its own "Since" heading.
  const [awaySide, homeSide] = rivalryTeams(input);
  const top =
    allTime && input.rivalry
      ? subtitle(rivalryIntro(input.rivalry, allTime, awaySide, homeSide)) +
        renderAllTimeTiles(allTime, awaySide, homeSide) +
        (n ? `<h3 class="sct-rb-h3 sct-rb-since">${escapeHtml(`Since ${series.sinceSeason}`)}</h3>` : "")
      : "";

  const summary = n
    ? `<div class="sct-rb-h2h-summary">` +
      `<p class="sct-rb-h2h-record"><span class="sct-rb-h2h-figure">${escapeHtml(record.text)}</span> ` +
      `<span class="sct-rb-h2h-lead">${escapeHtml(record.leader ? `${record.leader.short} lead` : "Series tied")}</span></p>` +
      `<p class="sct-rb-h2h-note">${escapeHtml(
        `${n} meeting${n === 1 ? "" : "s"} since the ${series.sinceSeason} season, regular season and playoffs.`,
      )}</p>` +
      `</div>`
    : "";

  const oldest = [...series.games].sort(
    (x, y) => (x.kickoff ?? "").localeCompare(y.kickoff ?? "") || x.season - y.season,
  );
  const { letters, wide } = tileLetters(input);
  const tiles = n
    ? `<ol class="sct-rb-tiles${wide ? " is-wide" : ""}">` +
      oldest
        .map((g) => {
          const w = winnerOf(g);
          const label = `${gameLabel(g)}: ${resultPhrase(input, g)}`;
          return (
            `<li class="sct-rb-tile${w ? "" : " is-tie"}${g.current ? " is-current" : ""}"` +
            (w ? ` style="${escapeHtml(`--rb-fill:${colorsOf(input, w).fill}`)}"` : "") +
            ` title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">` +
            `<span aria-hidden="true">${escapeHtml(w ? letters[w] ?? w : "T")}</span></li>`
          );
        })
        .join("") +
      `</ol>`
    : "";

  const leaderFirst = [game.away.abbr, game.home.abbr].sort((x, y) =>
    record.leader ? (x === record.leader.abbr ? -1 : y === record.leader.abbr ? 1 : 0) : 0,
  );
  const legendParts = leaderFirst.map(
    (abbr) => `${letters[abbr]} = ${input.teams[abbr]?.short} win`,
  );
  if (series.games.some((g) => winnerOf(g) === null)) legendParts.push("T = tie");
  if (series.games.some((g) => g.current)) legendParts.push("outlined = this game");
  const legend = n
    ? `<p class="sct-rb-legend">Oldest to newest. ${escapeHtml(legendParts.join(", "))}.</p>`
    : "";

  const upcoming = series.upcoming.length
    ? `<h3 class="sct-rb-h3">${escapeHtml(`${series.upcoming[0]!.season} meetings`)}</h3>` +
      `<ul class="sct-rb-meetings">${series.upcoming.map((g) => upcomingRow(input, g)).join("")}</ul>`
    : "";

  const newest = [...oldest].reverse();
  const recent = n
    ? `<h3 class="sct-rb-h3">Recent meetings</h3>` +
      `<ul class="sct-rb-meetings">${newest.map((g) => recentRow(input, g)).join("")}</ul>`
    : "";

  // id "h2h" is the "On this page" jump target.
  return section(
    "h2h",
    `${game.away.short} vs ${game.home.short} head-to-head`,
    top + summary + tiles + legend + upcoming + recent,
  );
}

/* --------------------------------------------- section 3: fantasy outlook */

function whereUpcoming(input: RecapBodyInput, g: UpcomingGame): string {
  if (g.neutral) return g.venueCity ? ` in ${g.venueCity}` : "";
  return ` in ${input.teams[g.home]?.city ?? g.home}`;
}

export function renderFantasyOutlook(input: RecapBodyInput): string {
  const { game, series, links } = input;
  const upcoming = series.upcoming;
  const n = upcoming.length;
  const next = upcoming[0] ?? null;
  // With no meeting left the section stays: the tools answer the same
  // week-to-week question for either side, just not about a game between them.
  const lead = next
    ? `${COUNT_WORDS[n] ?? String(n)} meeting${n === 1 ? " is" : "s are"} left on the ` +
      `${next.season} schedule: ${list(upcoming.map((g) => `${g.weekLabel}${whereUpcoming(input, g)}`))}. ` +
      `Here's how to decide who to play in your league.`
    : `The two teams don't meet again this season. If you roster a ${input.teams[game.away.abbr]?.singular ?? game.away.short} ` +
      `or a ${input.teams[game.home.abbr]?.singular ?? game.home.short}, these answer the week-to-week question.`;

  const card = (title: string, text: string, href: string | null | undefined, cta: string): string =>
    href
      ? `<li><a class="sct-rb-tool" href="${escapeHtml(href)}" data-cta="${cta}">` +
        `<span class="sct-rb-tool-title">${escapeHtml(title)}</span>` +
        `<span class="sct-rb-tool-text">${escapeHtml(text)}</span></a></li>`
      : "";

  const cards =
    card(
      "Start/Sit Tool",
      `Should your ${game.away.short} or ${game.home.short} player start ${next ? `in ${next.weekLabel}` : "this week"}? ` +
        `Compare the decision against your other options.`,
      links.startSit,
      "fantasy-outlook-startsit",
    ) +
    card(
      "Fantasy Football Projections",
      `See the latest weekly and rest-of-season projections for ${game.away.short} and ${game.home.short} players.`,
      links.projections,
      "fantasy-outlook-projections",
    ) +
    card(
      "Matchup Analyzer",
      "Your starters against your opponent's, with the swing plays for this week.",
      links.matchupAnalyzer,
      "fantasy-outlook-matchup-analyzer",
    ) +
    card(
      "Fantasy Points Allowed by Position",
      `How the ${game.away.short} and ${game.home.short} defenses have treated QBs, RBs, WRs and TEs.`,
      links.pointsAllowed,
      "fantasy-outlook-fpa",
    ) +
    card(
      "Strength of Schedule",
      n === 0
        ? "Where each team's remaining games fall in your fantasy playoff run."
        : n === 1
          ? "Where this matchup falls in each team's fantasy playoff run."
          : "Where these two matchups fall in each team's fantasy playoff run.",
      links.strengthOfSchedule,
      "fantasy-outlook-sos",
    ) +
    card(
      "Redraft Command",
      "Connect your league for personalized lineup, trade and roster advice.",
      links.redraftCommand,
      "fantasy-outlook-redraft",
    );

  return section(
    "fantasy-outlook",
    next
      ? `${game.away.short} vs ${game.home.short} fantasy outlook for ${next.season}`
      : `${game.away.short} and ${game.home.short} in fantasy`,
    subtitle(lead) + `<ul class="sct-rb-tools">${cards}</ul>`,
  );
}

/* --------------------------------------------------------- section 4: FAQ */

export interface FaqLink {
  text: string;
  href: string;
  cta: string;
}

export interface FaqItem {
  question: string;
  /** Plain text: what the JSON-LD carries, and what the page shows. */
  answer: string;
  /** A phrase in the answer to render as a link, and where to. */
  link?: FaqLink;
  /** More of the same, for an answer that links more than one page. */
  links?: FaqLink[];
}

/** The questions, built once for both the page and its FAQPage JSON-LD. */
export function recapFaq(input: RecapBodyInput): FaqItem[] {
  return pickFaq(faqPool(input));
}

/** A candidate question: its topic group (the display order) and its priority. */
interface FaqCandidate extends FaqItem {
  group: "result" | "fantasy" | "flow" | "history" | "betting";
  score: number;
}

const FAQ_GROUPS: FaqCandidate["group"][] = ["result", "fantasy", "flow", "history", "betting"];
const FAQ_MAX = 15;

/** The strongest questions, at most 15, shown by topic in priority order within each. */
function pickFaq(pool: FaqCandidate[]): FaqItem[] {
  const kept = [...pool].sort((a, b) => b.score - a.score).slice(0, FAQ_MAX);
  return FAQ_GROUPS.flatMap((g) =>
    kept
      .filter((c) => c.group === g)
      .sort((a, b) => b.score - a.score)
      .map(({ question, answer, link, links }) => ({ question, answer, ...(link ? { link } : {}), ...(links ? { links } : {}) })),
  );
}

const ROUND_WORDS: Record<string, string> = {
  "Wild Card": "the Wild Card round",
  "Divisional Round": "the Divisional Round",
};

/** "Week 1 of the 2026 season", "the 2021 Wild Card round", "Super Bowl LVI". */
function whenPlayed(game: ScoreboardGame, round: string): string {
  if (game.gameType !== "playoff") return `${round} of the ${game.seasonLabel} season`;
  if (/super bowl/i.test(round)) return `Super Bowl ${superBowlNumeral(Number(game.seasonLabel))}`;
  return `${ROUND_WORDS[round] ?? `the ${round}`} of the ${game.seasonLabel} playoffs`;
}

function ordinalQuarter(q: number): string {
  return q <= 4 ? `${["first", "second", "third", "fourth"][q - 1]} quarter` : "overtime";
}

function pctText(p: number): string {
  if (p > 0.995) return ">99%";
  if (p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

function playerLink(p: { name: string; logUrl: string | null }, season: string): FaqLink | null {
  return p.logUrl ? { text: `${p.name}'s ${season} game log`, href: p.logUrl, cta: "faq-gamelog" } : null;
}

/**
 * Every question the page can answer truthfully, each scored for how often it
 * is searched after a game and how much this page adds (mak's FAQ spec,
 * 2026-09-30). Completed-game intent only: no predictions, no "who will win".
 */
function faqPool(input: RecapBodyInput): FaqCandidate[] {
  const { game, series, links } = input;
  const facts = input.faqFacts ?? {};
  const result = scoreboardResult(game);
  const round = game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
  const pair = `${game.away.short} vs ${game.home.short}`;
  const when = whenPlayed(game, round);
  const season = game.seasonLabel;
  const pool: FaqCandidate[] = [];
  const add = (c: FaqCandidate): void => {
    pool.push(c);
  };
  if (!result) return pool;
  const w = result.winner;
  const l = w === "home" ? "away" : w === "away" ? "home" : null;
  const half = (side: "away" | "home"): number => (game[side].quarters ?? []).slice(0, 2).reduce((a, b) => a + b, 0);
  const teamShort = (abbr: string): string =>
    abbr === game.home.abbr ? game.home.short : abbr === game.away.abbr ? game.away.short : abbr;

  /* ---- result */
  const date = game.kickoff ? ` on ${longDate(game.kickoff)}` : "";
  const venue = game.venue
    ? ` at ${game.venue.name}${game.venue.city ? ` in ${game.venue.city}${game.venue.state ? `, ${game.venue.state},` : ""}` : ""}`
    : "";
  add({
    group: "result",
    score: 100,
    question: `Who won the ${season} ${pair} ${round} game?`,
    answer:
      w && l
        ? `The ${game[w].name} beat the ${game[l].name} ${result[w]}${DASH}${result[l]} in ${when}. ` +
          `The game was played${venue}${date}.`
        : `The ${game.away.name} and ${game.home.name} tied ${result.away}${DASH}${result.home} in ${when}. ` +
          `The game was played${venue}${date}.`,
  });

  if (game.away.quarters && game.home.quarters) {
    const ha = half("away");
    const hh = half("home");
    const halfText =
      ha === hh
        ? `The teams were tied ${ha}${DASH}${hh} at halftime`
        : `The ${game[ha > hh ? "away" : "home"].short} led ${Math.max(ha, hh)}${DASH}${Math.min(ha, hh)} at halftime`;
    const second = (side: "away" | "home"): number => result[side] - half(side) - (game[side].ot ?? 0);
    const ot = game.away.ot !== null || game.home.ot !== null;
    add({
      group: "result",
      score: 95,
      question: `What was the final score of ${pair}?`,
      answer:
        (w && l
          ? `The final score was ${game[w].short} ${result[w]}, ${game[l].short} ${result[l]}${ot ? " in overtime" : ""}. `
          : `The final score was ${game.away.short} ${result.away}, ${game.home.short} ${result.home}${ot ? " after overtime" : ""}. `) +
        `${halfText}, and the second half went ${game.away.short} ${second("away")}, ${game.home.short} ${second("home")}` +
        `${ot ? ` before overtime` : ""}.`,
    });
  }

  if (facts.story && w && l) {
    const top = facts.fantasy?.[0];
    const to = facts.turnovers;
    const toLine =
      to && to.away !== to.home
        ? ` The ${game[to.away > to.home ? "away" : "home"].short} committed ${Math.max(to.away, to.home)} turnover${Math.max(to.away, to.home) === 1 ? "" : "s"},` +
          ` the ${game[to.away > to.home ? "home" : "away"].short} ${Math.min(to.away, to.home) === 0 ? "none" : Math.min(to.away, to.home)}.`
        : "";
    add({
      group: "result",
      score: 90,
      question: `What happened in the ${pair} game?`,
      answer:
        `${facts.story}` +
        (top ? ` ${top.name} led all players with ${top.line}.` : "") +
        toLine,
    });
  }

  if (facts.winningPlay && w) {
    const wp = facts.winningPlay;
    const mine = w === "home" ? wp.home : wp.away;
    const theirs = w === "home" ? wp.away : wp.home;
    add({
      group: "result",
      score: 78,
      question: `What was the game-winning score in ${pair}?`,
      answer:
        `${wp.text} with ${wp.clock} left in the ${ordinalQuarter(wp.quarter)} gave the ${game[w].short} a ` +
        `${mine}${DASH}${theirs} lead they never gave up.` +
        (mine === result[w] && theirs === (l ? result[l] : 0) ? ` It was the final score of the game.` : ""),
    });
  }

  /* ---- fantasy */
  const fant = facts.fantasy ?? [];
  if (fant.length) {
    const a = fant[0]!;
    const b = fant[1];
    const link = playerLink(a, season);
    add({
      group: "fantasy",
      score: 88,
      question: `Who scored the most fantasy points in ${pair}?`,
      answer:
        `${a.name} led the game with ${a.ppr.toFixed(1)} PPR fantasy points` +
        `${a.finish ? `, the ${a.finish} of ${round}` : ""}, on ${a.line}.` +
        (b ? ` ${b.name} was next with ${b.ppr.toFixed(1)}${b.finish ? ` (${b.finish})` : ""}.` : "") +
        (link ? ` See ${link.text}.` : ""),
      ...(link ? { link } : {}),
    });
    // The player-specific question, only for a genuinely big day.
    if (a.ppr >= 20 || (a.finish !== null && Number(a.finish.replace(/\D/g, "")) <= 12)) {
      const opp = a.team === game.home.abbr ? game.away.short : game.home.short;
      const share =
        a.targetShare !== null && a.targetShare >= 0.2
          ? ` He drew ${Math.round(a.targetShare * 100)}% of his team's targets.`
          : a.carryShare !== null && a.carryShare >= 0.4
            ? ` He handled ${Math.round(a.carryShare * 100)}% of his team's carries.`
            : "";
      add({
        group: "fantasy",
        score: 70,
        question: `How many fantasy points did ${a.name} score against the ${opp}?`,
        answer:
          (a.ppr.toFixed(1) === a.std.toFixed(1)
            ? `${a.name} scored ${a.ppr.toFixed(1)} fantasy points against the ${opp} in ${when}, the same in PPR, ` +
              `half-PPR and standard scoring because he had no catches, on ${a.line}.`
            : `${a.name} scored ${a.ppr.toFixed(1)} points in PPR leagues, ${a.half.toFixed(1)} in half-PPR and ` +
              `${a.std.toFixed(1)} in standard scoring against the ${opp} in ${when}, on ${a.line}.`) + share,
      });
    }
  }

  const ld = facts.leaders;
  if (ld && (ld.passing || ld.rushing || ld.receiving)) {
    const parts = [
      ld.passing ? `${ld.passing.name} (${ld.passing.team}) led all passers with ${ld.passing.line}` : "",
      ld.rushing ? `${ld.rushing.name} (${ld.rushing.team}) led in rushing with ${ld.rushing.line}` : "",
      ld.receiving ? `${ld.receiving.name} (${ld.receiving.team}) led in receiving with ${ld.receiving.line}` : "",
    ].filter(Boolean);
    add({
      group: "fantasy",
      score: 80,
      question: `Who led ${pair} in passing, rushing and receiving?`,
      answer: `${parts.join(". ")}.`,
    });
  }

  if (facts.xfp?.volume) {
    const v = facts.xfp.volume;
    add({
      group: "fantasy",
      score: 54,
      question: `Who had the highest expected fantasy points in ${pair}?`,
      answer:
        `${v.name} had the most fantasy opportunity in the game, worth ${v.xfp.toFixed(1)} expected PPR points (xFP) ` +
        `at league-average rates, and scored ${v.ppr.toFixed(1)}. Expected points measure the volume of a player's ` +
        `pass attempts, carries and targets, not how well he used them.`,
    });
  }
  const ov = facts.xfp?.over;
  const un = facts.xfp?.under;
  if (ov || un) {
    const parts = [
      ov ? `${ov.name} outperformed his expected fantasy points the most, scoring ${ov.ppr.toFixed(1)} PPR points on ${ov.xfp.toFixed(1)} xFP (+${(ov.ppr - ov.xfp).toFixed(1)})` : "",
      un ? `${un.name} fell furthest short, with ${un.ppr.toFixed(1)} points on ${un.xfp.toFixed(1)} xFP (${MINUS}${(un.xfp - un.ppr).toFixed(1)})` : "",
    ].filter(Boolean);
    const fpa = links.pointsAllowed ? { text: "fantasy points allowed by position", href: links.pointsAllowed, cta: "faq-fpa" } : null;
    add({
      group: "fantasy",
      score: 62,
      question: `Who outperformed and underperformed expected fantasy points in ${pair}?`,
      answer:
        `${parts.join(". ")}. A gap either way reflects efficiency and touchdowns in one game; it is not a forecast.` +
        (fpa ? ` For matchups ahead, see ${fpa.text}.` : ""),
      ...(fpa ? { link: fpa } : {}),
    });
  }

  /* ---- how the game went */
  if (facts.comeback && w && l) {
    const cb = facts.comeback;
    const sw = facts.swing;
    const wp = facts.winningPlay;
    add({
      group: "flow",
      score: 76,
      question: `How did the ${game[w].short} come back to beat the ${game[l].short}?`,
      answer:
        `The ${game[w].short}' chances of winning fell as low as ${pctText(cb.low)} ${cb.lowPeriod}. ` +
        (sw && sw.team === game[w].abbr
          ? `${sw.text} in the ${ordinalQuarter(sw.quarter)} was the biggest swing of the game. `
          : "") +
        (wp ? `${wp.text} then put them ahead for good.` : `They finished the comeback with a ${result[w]}${DASH}${result[l]} win.`),
    });
  } else if (w && l && input.stats[w] && input.stats[l]) {
    const ws = input.stats[w]!;
    const ls = input.stats[l]!;
    const reasons: string[] = [];
    if (ws.yardsPerPlay !== null && ls.yardsPerPlay !== null && ws.yardsPerPlay > ls.yardsPerPlay)
      reasons.push(`averaged ${ws.yardsPerPlay.toFixed(1)} yards per play to ${ls.yardsPerPlay.toFixed(1)}`);
    if (ws.turnovers !== null && ls.turnovers !== null && ws.turnovers < ls.turnovers)
      reasons.push(`won the turnover battle ${ls.turnovers}${DASH}${ws.turnovers}`);
    if (ws.totalYards !== null && ls.totalYards !== null && ws.totalYards > ls.totalYards)
      reasons.push(`outgained them ${ws.totalYards}${DASH}${ls.totalYards}`);
    if (reasons.length) {
      add({
        group: "flow",
        score: 76,
        question: `How did the ${game[w].short} beat the ${game[l].short}?`,
        answer:
          `The ${game[w].short} beat the ${game[l].short} ${result[w]}${DASH}${result[l]} because they ${list(reasons.slice(0, 3))}.` +
          (facts.winningPlay ? ` ${facts.winningPlay.text} put them ahead for good.` : ""),
      });
    }
  }

  if (facts.swing && Math.abs(facts.swing.after - facts.swing.before) >= 0.25) {
    const sw = facts.swing;
    add({
      group: "flow",
      score: 50,
      question: `What was the turning point of ${pair}?`,
      answer:
        `${sw.text} with ${sw.clock} left in the ${ordinalQuarter(sw.quarter)} was the biggest swing of the game, ` +
        `moving the ${game.home.short}' win probability from ${pctText(sw.before)} to ${pctText(sw.after)}.`,
    });
  }

  const to = facts.turnovers;
  if (to && to.away !== to.home) {
    const better = to.away < to.home ? "away" : "home";
    const worse = better === "away" ? "home" : "away";
    add({
      group: "flow",
      score: 60,
      question: `Which team won the turnover battle in ${pair}?`,
      answer:
        `The ${game[better].short} won the turnover battle ${to[worse]}${DASH}${to[better]}: the ${game[worse].short} gave the ball away ` +
        `${to[worse]} time${to[worse] === 1 ? "" : "s"} and the ${game[better].short} ${to[better] === 0 ? "not at all" : `${to[better]} time${to[better] === 1 ? "" : "s"}`}.` +
        (w === better ? ` The ${game[better].short} won the game.` : ` The ${game[worse].short} won the game anyway.`),
    });
  }

  /* ---- history */
  const allTime = recapAllTime(input);
  if (allTime) {
    const [awaySide, homeSide] = rivalryTeams(input);
    add({
      group: "history",
      score: 86,
      question: `What is the all-time ${pair} record?`,
      answer: allTimeAnswer(allTime, awaySide, homeSide),
    });
  }

  // The meeting before this one, from the full history when the page has it.
  const all = [...(input.rivalry?.allGames ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  // The history dates games by their Eastern date; a night kickoff is the next day in UTC.
  const thisDate = game.kickoff ? new Date(game.kickoff).toLocaleDateString("en-CA", { timeZone: EASTERN }) : null;
  const prior = thisDate ? all.filter((g) => g.date < thisDate) : [];
  const prev = prior[prior.length - 1];
  if (prev) {
    const pw = prev.awayScore >= prev.homeScore ? prev.away : prev.home;
    const pl = pw === prev.away ? prev.home : prev.away;
    const hi = Math.max(prev.awayScore, prev.homeScore);
    const lo = Math.min(prev.awayScore, prev.homeScore);
    const what = prev.superBowl ? `Super Bowl ${superBowlNumeral(prev.season)}` : prev.playoff ? `the ${prev.season} playoffs` : `the ${prev.season} season`;
    add({
      group: "history",
      score: 74,
      question: `When did the ${game.away.short} and ${game.home.short} last play before this game?`,
      answer:
        prev.awayScore === prev.homeScore
          ? `Before ${game.gameType === "playoff" ? `the ${season} ${round}${/round$/i.test(round) ? "" : " round"}` : `${round} of ${season}`}, the ${teamShort(prev.away)} and ${teamShort(prev.home)} last met in ${what} on ${longDate(`${prev.date}T12:00:00Z`)}, a ${hi}${DASH}${lo} tie.`
          : `Before ${game.gameType === "playoff" ? `the ${season} ${round}${/round$/i.test(round) ? "" : " round"}` : `${round} of ${season}`}, they last met in ${what} on ${longDate(`${prev.date}T12:00:00Z`)}, when the ${teamShort(pw)} beat the ${teamShort(pl)} ${hi}${DASH}${lo}.`,
    });
  }

  const bowls = all.filter((g) => g.superBowl && !(thisDate && g.date === thisDate));
  const playoffs = all.filter((g) => g.playoff);
  if (bowls.length) {
    const lines = bowls.map((g) => {
      const gw = g.awayScore > g.homeScore ? g.away : g.home;
      const gl = gw === g.away ? g.home : g.away;
      return `the ${teamShort(gw)} won Super Bowl ${superBowlNumeral(g.season)} ${Math.max(g.awayScore, g.homeScore)}${DASH}${Math.min(g.awayScore, g.homeScore)} over the ${teamShort(gl)} after the ${g.season} season`;
    });
    add({
      group: "history",
      score: 82,
      question: `Have the ${game.away.short} and ${game.home.short} played in the Super Bowl?`,
      answer: `Yes, ${bowls.length === 1 ? "once" : `${bowls.length} times`}: ${lines.join("; ")}.`,
    });
  } else if (playoffs.length) {
    const wins: Record<string, number> = {};
    for (const g of playoffs) {
      if (g.awayScore === g.homeScore) continue;
      const gw = g.awayScore > g.homeScore ? g.away : g.home;
      wins[gw] = (wins[gw] ?? 0) + 1;
    }
    const [x, y] = [game.away.abbr, game.home.abbr];
    add({
      group: "history",
      score: 66,
      question: `Have the ${game.away.short} and ${game.home.short} met in the playoffs?`,
      answer:
        `Yes, ${playoffs.length} time${playoffs.length === 1 ? "" : "s"}, most recently in the ${playoffs[playoffs.length - 1]!.season} playoffs. ` +
        `The ${teamShort(x)} are ${wins[x] ?? 0}${DASH}${wins[y] ?? 0} against the ${teamShort(y)} in the postseason.`,
    });
  }

  if (series.games.length >= 2) {
    const record = seriesRecord(input);
    const n = series.games.length;
    add({
      group: "history",
      score: 40,
      question: `What is the ${pair} record since ${series.sinceSeason}?`,
      answer: record.leader
        ? `The ${record.leader.short} lead ${record.text} across ${n} meetings since the ${series.sinceSeason} season, including this game.`
        : `The series is tied ${record.text} across ${n} meetings since the ${series.sinceSeason} season, including this game.`,
    });
  }

  /* ---- betting results */
  const odds = facts.odds;
  if (odds && w !== undefined) {
    const fav = odds.favorite === game.home.abbr ? "home" : odds.favorite === game.away.abbr ? "away" : null;
    const pickem = !fav || odds.line === 0;
    const points = result.away + result.home;
    const lineText = pickem ? "a pick'em" : `${game[fav!].short} ${MINUS}${trimNum(odds.line)}`;
    const cover = !pickem ? result[fav!] - result[fav === "home" ? "away" : "home"] - odds.line : 0;
    const coverText = pickem
      ? w
        ? `the ${game[w].short} won outright`
        : "the game ended level"
      : cover === 0
        ? "the game landed exactly on the number, a push"
        : cover > 0
          ? `the ${game[fav!].short} covered by ${trimNum(cover)}`
          : `the ${game[fav === "home" ? "away" : "home"].short} covered as ${trimNum(odds.line)}-point underdogs`;
    add({
      group: "betting",
      score: 84,
      question: `What was the closing spread for ${pair}?`,
      // The line and what it implied; who covered is its own question.
      answer:
        `The consensus closing spread at kickoff was ${lineText}` +
        `${pickem ? "" : `, making the ${game[fav!].name} ${trimNum(odds.line)}-point favorites`}, ` +
        `with a closing total of ${trimNum(odds.total)}. ` +
        (pickem
          ? `That implied about ${(odds.total / 2).toFixed(1)} points for each side.`
          : `That implied about ${((odds.total + odds.line) / 2).toFixed(1)} points for the ${game[fav!].short} and ` +
            `${((odds.total - odds.line) / 2).toFixed(1)} for the ${game[fav === "home" ? "away" : "home"].short}.`),
    });
    add({
      group: "betting",
      score: 72,
      question: pickem || cover !== 0 ? `Who covered the spread in ${pair}?` : `Was ${pair} a push against the spread?`,
      answer:
        pickem || cover !== 0
          ? `${coverText.charAt(0).toUpperCase()}${coverText.slice(1)} against the closing line of ${lineText}. ` +
            `The final margin was ${Math.abs(result.home - result.away)} point${Math.abs(result.home - result.away) === 1 ? "" : "s"}.`
          : `Yes. The ${game[fav!].short} closed as ${trimNum(odds.line)}-point favorites and won by exactly ${trimNum(odds.line)}, ` +
            `so the spread was a push: neither side covered, and spread bets were refunded.`,
    });
    const off = points - odds.total;
    add({
      group: "betting",
      score: 83,
      question: `Did ${pair} go over or under the total?`,
      answer:
        off === 0
          ? `Neither: ${points} points landed exactly on the closing total of ${trimNum(odds.total)}, a push.`
          : `The game went ${off > 0 ? "over" : "under"}. The consensus closing total was ${trimNum(odds.total)}, and the teams ` +
            `combined for ${points} points, ${trimNum(Math.abs(off))} ${off > 0 ? "over" : "under"} the number.`,
    });
  }

  // Links to the winner's schedule, from the result answer.
  if (w) {
    const sched = facts.schedules?.[game[w].abbr];
    const first = pool.find((c) => c.group === "result");
    if (sched && first && !first.link) {
      first.answer += ` See the ${game[w].short}' ${season} schedule.`;
      first.link = { text: `${game[w].short}' ${season} schedule`, href: sched, cta: "faq-schedule" };
    }
  }
  return pool;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function renderFaq(input: RecapBodyInput, items: FaqItem[] = recapFaq(input)): string {
  if (items.length === 0) return "";
  const answer = (item: FaqItem): string => {
    let html = escapeHtml(item.answer);
    for (const link of [...(item.link ? [item.link] : []), ...(item.links ?? [])]) {
      html = html.replace(
        escapeHtml(link.text),
        `<a href="${escapeHtml(link.href)}" data-cta="${link.cta}">${escapeHtml(link.text)}</a>`,
      );
    }
    return html;
  };
  return section(
    "faq",
    `${input.game.away.short} vs ${input.game.home.short} Game FAQ`,
    `<div class="sct-rb-faq-list">` +
      items
        .map(
          (item) =>
            `<details class="sct-rb-qa"><summary>${escapeHtml(item.question)}</summary>` +
            `<p>${answer(item)}</p></details>`,
        )
        .join("") +
      `</div>`,
  );
}

/** The FAQPage node for the same items, as JSON-LD or as the plugin's island. */
export function recapFaqSchema(items: FaqItem[], embed: boolean): string {
  if (items.length === 0) return "";
  const node = {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  return embed
    ? `<script type="application/json" class="sct-matchup-faq-data">${escapeJsonLd(JSON.stringify(node))}</script>`
    : `<script type="application/ld+json">${escapeJsonLd(
        JSON.stringify({ "@context": "https://schema.org", ...node }),
      )}</script>`;
}

/* ----------------------------------------------- section 5: related links */

export function renderRelated(input: RecapBodyInput): string {
  const { game } = input;
  const pills = [game.away.abbr, game.home.abbr].flatMap((abbr) => {
    const team = input.teams[abbr]!;
    return [
      team.hub ? `<li><a class="sct-rb-pill" href="${escapeHtml(team.hub)}">${escapeHtml(`${team.name} hub`)}</a></li>` : "",
      team.matchups
        ? `<li><a class="sct-rb-pill" href="${escapeHtml(team.matchups)}">${escapeHtml(`All ${team.short} matchups`)}</a></li>`
        : "",
    ];
  });
  if (!pills.some(Boolean)) return "";
  return (
    `<nav class="sct-rb-section sct-rb-related" aria-label="Related pages">` +
    h2("sct-rb-related", `More ${game.away.short} and ${game.home.short}`) +
    `<ul class="sct-rb-pills">${pills.join("")}</ul>` +
    `</nav>`
  );
}

/* ---------------------------------------------------------------- sidebar */

export function renderRedraftCard(input: RecapBodyInput): string {
  const { game, series, links } = input;
  const away = input.teams[game.away.abbr]!;
  const home = input.teams[game.home.abbr]!;
  const before = series.upcoming.length ? series.upcoming[0]!.weekLabel : "your next matchup";
  return (
    `<section class="sct-rb-card sct-rb-redraft" aria-labelledby="sct-rb-redraft">` +
    `<span class="sct-rb-ring" aria-hidden="true"></span>` +
    `<h3 class="sct-rb-redraft-title" id="sct-rb-redraft">${escapeHtml(
      `Got a ${away.singular} or ${home.singular} on your team?`,
    )}</h3>` +
    `<p class="sct-rb-redraft-text">${escapeHtml(
      `Redraft Command reads your roster, league settings and opponent, then tells you ` +
        `whether to start, sit, trade or hold them before ${before}.`,
    )}</p>` +
    `<a class="sct-rb-button" href="${escapeHtml(links.redraftCommand)}" data-cta="recap-sidebar">Connect your league</a>` +
    `<p class="sct-rb-redraft-note">Works with Sleeper, ESPN and Fleaflicker. No password needed.</p>` +
    `</section>`
  );
}

/**
 * The Redraft Command card as a full-width strip, for the matchup page's
 * Recap tab: the pitch on the left, the button on the right (mak,
 * 2026-09-30). The sidebar keeps the card for the Fantasy tab; the page hides
 * that one while Recap is open, so the offer shows once.
 */
export function renderRedraftStrip(input: RecapBodyInput): string {
  const { game, links } = input;
  const away = input.teams[game.away.abbr]!;
  const home = input.teams[game.home.abbr]!;
  return (
    `<section class="sct-rb-card sct-rb-redraft is-strip" aria-labelledby="sct-rb-redraft-strip">` +
    `<span class="sct-rb-ring" aria-hidden="true"></span>` +
    `<div class="sct-rb-redraft-pitch">` +
    `<h3 class="sct-rb-redraft-title" id="sct-rb-redraft-strip">${escapeHtml(
      `Got a ${away.singular} or ${home.singular} on your fantasy team?`,
    )}</h3>` +
    // Three tools named in one sentence rather than three more buttons.
    `<p class="sct-rb-redraft-text">` +
    `Check their next matchup with the ` +
    `<a href="${escapeHtml(links.startSit)}" data-cta="recap-strip-startsit">Start/Sit Tool</a>, compare their value in the ` +
    `<a href="${escapeHtml(links.tradeCalculator)}" data-cta="recap-strip-trade">Fantasy Trade Calculator</a>, or connect your ` +
    `league for personalized advice in <a href="${escapeHtml(links.redraftCommand)}" data-cta="recap-strip-redraft">Redraft Command</a>.` +
    `</p>` +
    `</div>` +
    `<div class="sct-rb-redraft-act">` +
    `<a class="sct-rb-button" href="${escapeHtml(links.redraftCommand)}" data-cta="recap-strip">Connect your league</a>` +
    `<p class="sct-rb-redraft-note">Works with Sleeper, ESPN and Fleaflicker. No password needed.</p>` +
    `</div>` +
    `</section>`
  );
}

export function renderGameInfo(input: RecapBodyInput): string {
  const { game } = input;
  const result = scoreboardResult(game);
  const when = scoreboardKickoff(game);
  const rows: Array<[string, string]> = [["Round", game.roundLabel]];
  if (game.kickoff) {
    rows.push([
      "Date",
      `<time datetime="${escapeHtml(isoDate(game.kickoff))}">${escapeHtml(
        eastern(game.kickoff, { month: "short", day: "numeric", year: "numeric" }),
      )}</time>`,
    ]);
  }
  if (when) rows.push(["Kickoff (ET)", escapeHtml(when.time.replace(/\s*ET$/, ""))]);
  if (game.venue) {
    rows.push([
      "Venue",
      escapeHtml([game.venue.name, game.venue.city, game.venue.state].filter(Boolean).join(", ")),
    ]);
  }
  if (result) {
    rows.push(["Winner", escapeHtml(result.winner ? game[result.winner].name : "Tie")]);
    if (result.winner) {
      const margin = Math.abs(result.away - result.home);
      rows.push(["Margin", `${margin} point${margin === 1 ? "" : "s"}`]);
    }
  }
  // Time of game and the coaches have no feed here, so those rows are left out.
  if (input.info?.tv) rows.push(["TV", escapeHtml(input.info.tv)]);
  if (input.info?.attendance) rows.push(["Attendance", input.info.attendance.toLocaleString("en-US")]);
  return (
    `<section class="sct-rb-card sct-rb-info" aria-labelledby="sct-rb-info">` +
    `<h3 class="sct-rb-h3" id="sct-rb-info">Game info</h3>` +
    `<dl class="sct-rb-dl">` +
    rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${k === "Round" ? escapeHtml(v) : v}</dd>`).join("") +
    `</dl>` +
    `</section>`
  );
}

/* ----------------------------------------------------------------- layout */

/**
 * The two columns. `lead` is what goes first in the main column (the prose
 * recap), `afterWhy` what follows "Why won" directly (the scoring summary),
 * `middle` what goes between that and the head-to-head (the box score
 * sections, on the games that have them).
 */
export interface RecapBodyParts {
  lead?: string;
  afterWhy?: string;
  middle?: string;
  /** Appended at the foot of the main column, after everything above. */
  after?: string;
  /** Appended at the foot of the sidebar. */
  asideAfter?: string;
  /**
   * Lays out the main column itself, from this module's own sections, in place
   * of the order above. The matchup page's tabs use it to put each section in
   * its panel; `lead`, `afterWhy`, `middle` and `after` are then ignored.
   */
  arrange?: (own: RecapOwnSections) => string;
}

/** The main-column sections this module renders, for `arrange`. */
export interface RecapOwnSections {
  why: string;
  headToHead: string;
  outlook: string;
  faq: string;
  related: string;
}

export function renderRecapBody(input: RecapBodyInput, parts: RecapBodyParts = {}): string {
  const faq = recapFaq(input);
  const own: RecapOwnSections = {
    why: renderWhyWon(input),
    headToHead: renderHeadToHead(input),
    outlook: renderFantasyOutlook(input),
    faq: renderFaq(input, faq),
    related: renderRelated(input),
  };
  const main = parts.arrange
    ? parts.arrange(own)
    : (parts.lead ?? "") +
      own.why +
      (parts.afterWhy ?? "") +
      (parts.middle ?? "") +
      own.headToHead +
      own.outlook +
      own.faq +
      own.related +
      (parts.after ?? "");
  return (
    `<div class="sct-rb">` +
    `<div class="sct-rb-main">` +
    main +
    `</div>` +
    `<aside class="sct-rb-aside" aria-label="Redraft Command and game info">` +
    renderRedraftCard(input) +
    renderGameInfo(input) +
    (parts.asideAfter ?? "") +
    `</aside>` +
    `</div>`
  );
}
