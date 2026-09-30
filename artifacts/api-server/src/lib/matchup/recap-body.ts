/**
 * The body of a matchup recap page: everything under the scoreboard hero.
 *
 * Main column: why the winner won, the head-to-head, the fantasy outlook, the
 * FAQ, related pages. Sidebar: the Redraft Command card and the game's facts.
 * The hero owns the page's one H1, so every section here starts at H2.
 *
 * Pure: a RecapBodyInput in, HTML out, and every figure derived from it. The
 * series record is counted from the series' own scores each time — never
 * carried as a number beside them — so the record, the tiles, the meetings
 * list, the FAQ and the FAQ's JSON-LD cannot disagree with each other: change
 * one score and all five move together. Away and home, and each side's score,
 * are read from the explicit fields of each game, never from list order.
 *
 * The page assembles the input from MatchupData in matchup-render.ts.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import type { BoxTeamStats } from "./boxscore";
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
}

/* ------------------------------------------------------------------ atoms */

const DASH = "–";
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

/** "Sunday, October 18, 2026" */
function fullDate(iso: string): string {
  return eastern(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
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

/** Each club's text and fill colour on this page, told apart — see pairColors(). */
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

/** Which side the row favours, or null for none (or a "neither" metric). */
function favoured(row: Pick<StatRow, "away" | "home" | "better">): "away" | "home" | null {
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
    const side = row ? favoured(row) : null;
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
  label: string;
}

/**
 * Three numbers from the winner's side. A figure the winner lost on is
 * replaced from a short reserve (yards per play, then third-down rate), so no
 * takeaway ever shows a negative number; when the reserve runs out the
 * takeaway is dropped rather than invented.
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
  const short = game[w].short;

  const diff = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : x - y;

  const primary: Array<Takeaway | null> = [];
  const yards = diff(ws.totalYards, ls.totalYards);
  primary.push(yards !== null && yards > 0 ? { value: `+${yards}`, label: `Yard advantage for the ${short}` } : null);
  const turnovers = diff(ls.turnovers, ws.turnovers);
  primary.push(
    turnovers !== null && turnovers > 0
      ? {
          value: `+${turnovers}`,
          label: `Turnover margin${ws.turnovers === 0 ? `, no ${short} giveaways` : ""}`,
        }
      : null,
  );
  const possession = diff(ws.possessionSeconds, ls.possessionSeconds);
  primary.push(
    possession !== null && possession > 0
      ? { value: `+${clock(possession)}`, label: "More time with the ball" }
      : null,
  );

  const reserve: Takeaway[] = [];
  const ypp = diff(ws.yardsPerPlay, ls.yardsPerPlay);
  if (ypp !== null && ypp > 0) reserve.push({ value: `+${ypp.toFixed(1)}`, label: "More yards per play" });
  const third = diff(ws.thirdDown?.percent ?? null, ls.thirdDown?.percent ?? null);
  if (third !== null && third > 0) {
    reserve.push({ value: `+${Math.round(third)}%`, label: "Better third-down conversion rate" });
  }

  return primary
    .map((t) => t ?? reserve.shift() ?? null)
    .filter((t): t is Takeaway => t !== null);
}

/** One row of a two-team stat comparison: the figures, as shown, and which end is better. */
export interface CompareRow {
  label: string;
  away: number | null;
  home: number | null;
  awayText: string;
  homeText: string;
  better: Better;
}

/**
 * The two-team comparison table "Why won" draws: the figure either side of the
 * stat name, the better one emphasised, and a split bar under each row. Season
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
    const better = favoured(row) === side;
    return (
      `<td class="sct-rb-val is-${side}${better ? " is-better" : ""}">` +
      escapeHtml(side === "away" ? row.awayText : row.homeText) +
      `</td>`
    );
  };

  const body = opts.rows
    .map((row) => {
      const share =
        row.away === null || row.home === null
          ? 50
          : awayShare({ away: row.away, home: row.home, better: row.better });
      return (
        `<tr class="sct-rb-stat">` +
        value(row, "away") +
        `<th scope="row" class="sct-rb-stat-name">${escapeHtml(row.label)}</th>` +
        value(row, "home") +
        `</tr>` +
        `<tr class="sct-rb-barrow" aria-hidden="true"><td colspan="3">` +
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

  const table = renderStatCompare({
    caption: `Team stats comparison, ${game.away.short} vs ${game.home.short}`,
    awayName: game.away.short,
    homeName: game.home.short,
    awayInk: colorsOf(input, game.away.abbr).ink,
    homeInk: colorsOf(input, game.home.abbr).ink,
    rows: rows.map((row) => ({
      label: row.label,
      away: row.away,
      home: row.home,
      awayText: row.away === null ? "—" : row.format(row.away),
      homeText: row.home === null ? "—" : row.format(row.home),
      better: row.better,
    })),
  });

  const items = takeaways(input);
  const winnerAbbr = result.winner ? game[result.winner].abbr : null;
  const strip =
    items.length && winnerAbbr
      ? `<ul class="sct-rb-takeaways" style="${escapeHtml(teamStyle(input, winnerAbbr))}">` +
        items
          .map(
            (t) =>
              `<li><span class="sct-rb-take-value">${escapeHtml(t.value)}</span> ` +
              `<span class="sct-rb-take-label">${escapeHtml(t.label)}</span></li>`,
          )
          .join("") +
        `</ul>`
      : "";

  return section("why", heading, subtitle(battlesLine(input, rows)) + table + strip);
}

/* ------------------------------------------------ section 2: head-to-head */

/** Both sides as the all-time tiles name and colour them. */
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

  // All-time first — the intro and four tiles — then the recent series under
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
  // Only with a meeting still to come: the section is about that meeting.
  if (!next) return "";
  const lead =
    `${COUNT_WORDS[n] ?? String(n)} meeting${n === 1 ? " is" : "s are"} left on the ` +
    `${next.season} schedule: ${list(upcoming.map((g) => `${g.weekLabel}${whereUpcoming(input, g)}`))}. ` +
    `Here's how to decide who to play in your league.`;

  const card = (title: string, text: string, href: string | null | undefined, cta: string): string =>
    href
      ? `<li><a class="sct-rb-tool" href="${escapeHtml(href)}" data-cta="${cta}">` +
        `<span class="sct-rb-tool-title">${escapeHtml(title)}</span>` +
        `<span class="sct-rb-tool-text">${escapeHtml(text)}</span></a></li>`
      : "";

  const cards =
    card(
      "Start/Sit Tool",
      `Should your ${game.away.short} or ${game.home.short} player start in ${next.weekLabel}? ` +
        `Compare the decision against your other options.`,
      links.startSit,
      "fantasy-outlook-startsit",
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
      n === 1
        ? "Where this matchup falls in each team's fantasy playoff run."
        : "Where these two matchups fall in each team's fantasy playoff run.",
      links.strengthOfSchedule,
      "fantasy-outlook-sos",
    );

  return section(
    "fantasy-outlook",
    `${game.away.short} vs ${game.home.short} fantasy outlook for ${next.season}`,
    subtitle(lead) + `<ul class="sct-rb-tools">${cards}</ul>`,
  );
}

/* --------------------------------------------------------- section 4: FAQ */

export interface FaqItem {
  question: string;
  /** Plain text: what the JSON-LD carries, and what the page shows. */
  answer: string;
  /** A phrase in the answer to render as a link, and where to. */
  link?: { text: string; href: string; cta: string };
}

/** The questions, built once for both the page and its FAQPage JSON-LD. */
export function recapFaq(input: RecapBodyInput): FaqItem[] {
  const { game, series, links } = input;
  const result = scoreboardResult(game);
  const round = game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
  const pair = `${game.away.short} vs ${game.home.short}`;
  const items: FaqItem[] = [];

  if (result) {
    const date = game.kickoff ? ` on ${longDate(game.kickoff)}` : "";
    const at = game.venue ? ` at ${game.venue.name}` : "";
    const high = Math.max(result.away, result.home);
    const low = Math.min(result.away, result.home);
    items.push({
      question: `Who won the ${game.seasonLabel} ${pair} ${round} game?`,
      answer:
        result.winner === null
          ? `The ${game.away.name} and ${game.home.name} tied ${result.away}${DASH}${result.home}${at}${date}.`
          : `The ${game[result.winner].name} won ${high}${DASH}${low}${at}${date}.`,
    });
  }

  const top = input.topScorers ?? [];
  if (top.length) {
    const first = top[0]!;
    const second = top[1];
    items.push({
      question: `Who scored the most fantasy points in the ${game.seasonLabel} ${pair} ${round} game?`,
      answer:
        `${first.name} led all players with ${first.ppr.toFixed(1)} PPR points (${first.line}).` +
        (second ? ` ${second.name} was next with ${second.ppr.toFixed(1)}.` : ""),
    });
  }

  if (series.games.length) {
    const record = seriesRecord(input);
    const n = series.games.length;
    const includes = series.games.some((g) => g.current) ? `, including this ${round} game` : "";
    items.push({
      question: `What is the ${pair} record since ${series.sinceSeason}?`,
      answer: record.leader
        ? `The ${record.leader.short} lead ${record.text} across ${n} meeting${n === 1 ? "" : "s"}${includes}.`
        : `The series is tied ${record.text} across ${n} meeting${n === 1 ? "" : "s"}${includes}.`,
    });
  }

  const allTime = recapAllTime(input);
  if (allTime) {
    const [awaySide, homeSide] = rivalryTeams(input);
    items.push({
      question: `What is the all-time ${pair} record?`,
      answer: allTimeAnswer(allTime, awaySide, homeSide),
    });
  }

  if (series.upcoming.length) {
    const visits = series.upcoming.map((g) => {
      const away = input.teams[g.away]?.short ?? g.away;
      const home = input.teams[g.home]?.short ?? g.home;
      const when = g.kickoff ? `${g.weekLabel}, ${fullDate(g.kickoff)}: ` : `${g.weekLabel}, date to be set: `;
      return g.neutral
        ? `${when}the ${away} and ${home} meet${g.venueCity ? ` in ${g.venueCity}` : ""}.`
        : `${when}the ${away} visit the ${home}.`;
    });
    items.push({
      question: `When do the ${game.away.short} and ${game.home.short} play next?`,
      answer: visits.join(" "),
    });
  }

  if (series.upcoming.length) items.push({
    question: `Should I start ${game.away.short} or ${game.home.short} players in fantasy when they play each other?`,
    answer:
      "It depends on your roster, not only the player's ranking: who else you could start, " +
      "whether you're favored that week, and your league's scoring. Redraft Command's " +
      "Start/Sit Tool weighs all of that and gives one call with a confidence level.",
    link: { text: "Redraft Command's Start/Sit Tool", href: links.startSit, cta: "faq-startsit" },
  });

  return items;
}

export function renderFaq(input: RecapBodyInput, items: FaqItem[] = recapFaq(input)): string {
  if (items.length === 0) return "";
  const answer = (item: FaqItem): string => {
    let html = escapeHtml(item.answer);
    if (item.link) {
      html = html.replace(
        escapeHtml(item.link.text),
        `<a href="${escapeHtml(item.link.href)}" data-cta="${item.link.cta}">${escapeHtml(item.link.text)}</a>`,
      );
    }
    return html;
  };
  return section(
    "faq",
    `${input.game.away.short} vs ${input.game.home.short} FAQ`,
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
