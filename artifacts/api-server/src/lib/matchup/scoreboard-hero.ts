/**
 * The scoreboard hero: the panel at the top of a matchup recap page.
 *
 * One object, `ScoreboardGame`, and everything on the panel is derived from it:
 * the totals are the quarters summed, the winner is the bigger total, the badge
 * is the status, the result tag is the round. Nothing is stored twice, so the
 * hero cannot print a final that its own quarter table disagrees with.
 *
 * Home and away are whatever the game object says they are. The adapter that
 * builds one from a Meeting (matchupScoreboardGame() in matchup-render.ts)
 * reads them off ESPN's own `homeAway` field on each competitor, never off the
 * order the pair is listed in, which is alphabetical and means nothing.
 *
 * The H1 lives here. Its wording is fixed per game, "{away} vs {home}, {round}
 * {season}", and does not change as the game goes from upcoming to live to
 * final, so a page's main heading is stable for as long as the page exists. A
 * page whose subject is the pair rather than one game (the evergreen pair
 * address) passes its own heading in instead.
 *
 * Everything the reader sees is in the server's HTML. The only motion is a CSS
 * load animation on the two scores, and it is off under reduced motion.
 */

import { escapeHtml } from "../render";
import { TEAMS } from "../team/teams";

export type ScoreboardStatus = "final" | "upcoming" | "in_progress";

export interface ScoreboardTeam {
  /** Display code, upper case: "ARI". Keys teamColors. */
  abbr: string;
  /** "Arizona Cardinals". */
  name: string;
  /** "Cardinals". */
  short: string;
  /**
   * Points per regulation quarter, in order. Shorter than four while a game is
   * in progress; empty before kickoff; null when the line score could not be
   * had at all.
   */
  quarters: number[] | null;
  /** Overtime points, or null when the game did not go to overtime. */
  ot: number | null;
  /**
   * The final as reported, read ONLY when `quarters` is null: a game whose line
   * score could not be had still has a result. Whenever there is a line, the
   * total is the line summed and this is ignored.
   */
  score?: number | null;
  /** A crest to print beside the name. Absent means the name alone. */
  logoUrl?: string | null;
  /** Hub link for the team, used by the structured data only. */
  url?: string | null;
}

export interface ScoreboardVenue {
  name: string;
  city: string | null;
  state: string | null;
  /** Super Bowl, London, São Paulo: nobody is at home. */
  neutral: boolean;
}

export interface ScoreboardGame {
  status: ScoreboardStatus;
  /** "2021": the season the game belongs to, not the year it was played in. */
  seasonLabel: string;
  gameType: "regular" | "playoff";
  /** "NFC Wild Card", "Super Bowl" or "Week 14". */
  roundLabel: string;
  /** ISO 8601, or null when the NFL has not scheduled it. */
  kickoff: string | null;
  /** False when the date is set but the kickoff time is not (flex weeks). */
  timeConfirmed?: boolean;
  venue: ScoreboardVenue | null;
  away: ScoreboardTeam;
  home: ScoreboardTeam;
}

export interface ScoreboardHeroOptions {
  /** "h1" on a page the hero heads; "h2" inside a host page that has its own. */
  headingTag?: "h1" | "h2";
  /** The heading's id, which the header's aria-labelledby points at. */
  headingId?: string;
  /** A heading other than the game's own, for a page about the pair. */
  heading?: string;
}

/* ----------------------------------------------------------------- colours */

/** The panel's navy, and what a side colour falls back to. */
const NAVY = "#0F1E33";
const FALLBACK_COLOR = "#1E3A5F";
/** Each side is laid over the navy at this opacity. */
const SIDE_ALPHA = 0.9;
/** WCAG AA for normal text: the "Away"/"Home" labels are 13px. */
const AA_CONTRAST = 4.5;

/**
 * Every club's official primary and secondary colour, keyed by display code.
 *
 * Built from the team table rather than restated: teams.ts is the one place a
 * team's colours live (it takes them from render.ts, which the news cards use),
 * and a second copy here would be a second thing to keep in sync.
 */
export const teamColors: Record<string, { primary: string; secondary: string }> =
  Object.fromEntries(
    TEAMS.map((team) => [
      team.code.toUpperCase(),
      { primary: team.primaryColor, secondary: team.secondaryColor },
    ]),
  );

function rgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour as it actually shows: laid over the navy at SIDE_ALPHA. */
function overNavy(hex: string): [number, number, number] {
  const top = rgb(hex) ?? rgb(FALLBACK_COLOR)!;
  const base = rgb(NAVY)!;
  return [0, 1, 2].map((i) =>
    Math.round(top[i]! * SIDE_ALPHA + base[i]! * (1 - SIDE_ALPHA)),
  ) as [number, number, number];
}

/** WCAG contrast of white text on a colour. */
function whiteContrast([r, g, b]: [number, number, number]): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return 1.05 / (lum + 0.05);
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex) ?? rgb(FALLBACK_COLOR)!;
  const to = (c: number): string =>
    Math.round(c * (1 - amount)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The colour a side of the panel is painted, as a hex string.
 *
 * The primary when white text on it passes AA; otherwise the secondary when
 * that does (Cincinnati's orange gives way to its black, Denver's to its navy);
 * otherwise the primary, darkened until it passes, for the clubs whose
 * secondary is paler still (Carolina, Miami, the Chargers).
 */
export function heroSideColor(abbr: string): string {
  const colors = teamColors[abbr.toUpperCase()];
  if (!colors) return FALLBACK_COLOR;
  const passes = (hex: string): boolean => whiteContrast(overNavy(hex)) >= AA_CONTRAST;
  if (passes(colors.primary)) return colors.primary;
  if (passes(colors.secondary)) return colors.secondary;
  for (let amount = 0.1; amount < 1; amount += 0.1) {
    const darker = darken(colors.primary, amount);
    if (passes(darker)) return darker;
  }
  return FALLBACK_COLOR;
}

function rgba(hex: string): string {
  const [r, g, b] = rgb(hex) ?? rgb(FALLBACK_COLOR)!;
  return `rgba(${r}, ${g}, ${b}, ${SIDE_ALPHA})`;
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  const linear = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminanceOf(rgb(a) ?? [0, 0, 0]);
  const lb = luminanceOf(rgb(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The first of the candidates that passes AA against `against`, darkening the last. */
function passing(candidates: string[], against: string): string {
  for (const hex of candidates) {
    if (rgb(hex) && contrastRatio(hex, against) >= AA_CONTRAST) return hex;
  }
  const base = candidates[0] ?? FALLBACK_COLOR;
  for (let amount = 0.1; amount < 1; amount += 0.1) {
    const darker = darken(base, amount);
    if (contrastRatio(darker, against) >= AA_CONTRAST) return darker;
  }
  return FALLBACK_COLOR;
}

/**
 * A club's colour as TEXT on the page and its cards: the primary when it
 * passes AA there, otherwise the primary darkened until it does. Not the secondary -
 * for most clubs that is the paler of the two.
 */
export function teamInk(abbr: string, useSecondary = false): string {
  const colors = teamColors[abbr.toUpperCase()];
  // Measured against the page's paper (#F5F7FA), the darker of the two
  // light backgrounds it sits on: passing there passes on the white card too.
  if (!colors) return FALLBACK_COLOR;
  return passing([useSecondary ? colors.secondary : colors.primary], "#F5F7FA");
}

/** Two colours a reader could mistake for one: #002244 and #0B162A, say. */
export function tooClose(a: string, b: string): boolean {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return false;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 60;
}

/**
 * Text and fill colours for both sides of one page, told apart.
 *
 * Several clubs share a primary - the Patriots and the Seahawks are both
 * #002244, and the Raiders, Saints and Steelers the same near-black - and a
 * comparison drawn in one colour on both sides has lost what the colour was
 * for. The home side then takes its secondary instead (Seattle's green),
 * made safe for text the same way, and a neutral slate if even that clashes.
 */
export function pairColors(
  away: string,
  home: string,
): Record<"away" | "home", { ink: string; fill: string }> {
  const awayInk = teamInk(away);
  const awayFill = teamFill(away);
  let homeInk = teamInk(home);
  let homeFill = teamFill(home);
  if (tooClose(awayInk, homeInk) || tooClose(awayFill, homeFill)) {
    const alt = teamInk(home, true);
    const clash = tooClose(awayInk, alt);
    homeInk = clash ? "#5B6778" : alt;
    homeFill = clash ? "#5B6778" : alt;
  }
  return { away: { ink: awayInk, fill: awayFill }, home: { ink: homeInk, fill: homeFill } };
}

/**
 * A club's colour as a FILL under white text (the series tiles, the result
 * chips): primary, then secondary, then the primary darkened.
 */
export function teamFill(abbr: string): string {
  const colors = teamColors[abbr.toUpperCase()];
  return colors ? passing([colors.primary, colors.secondary], "#FFFFFF") : FALLBACK_COLOR;
}

/** A side's paint as the panel lays it: heroSideColor() at SIDE_ALPHA. */
export function heroSideFill(abbr: string): string {
  return rgba(heroSideColor(abbr));
}

/* ------------------------------------------------------------------- facts */

/** Quarters plus overtime, or null when there is no line to add up. */
export function scoreboardTotal(team: ScoreboardTeam): number | null {
  if (!team.quarters) return team.score ?? null;
  if (team.quarters.length === 0 && team.ot === null) return null;
  return team.quarters.reduce((sum, n) => sum + n, 0) + (team.ot ?? 0);
}

export interface ScoreboardResult {
  away: number;
  home: number;
  /** Null on a tie. */
  winner: "away" | "home" | null;
}

/** The final, or null before a game is over or when it has no line score. */
export function scoreboardResult(game: ScoreboardGame): ScoreboardResult | null {
  if (game.status !== "final") return null;
  const away = scoreboardTotal(game.away);
  const home = scoreboardTotal(game.home);
  if (away === null || home === null) return null;
  return { away, home, winner: away > home ? "away" : home > away ? "home" : null };
}

function wentToOvertime(game: ScoreboardGame): boolean {
  return game.away.ot !== null || game.home.ot !== null;
}

function isSuperBowl(game: ScoreboardGame): boolean {
  return /super bowl/i.test(game.roundLabel);
}

/** "Wild Card" from "NFC Wild Card": the round as the heading says it. */
function roundWithoutConference(label: string): string {
  return label.replace(/^(AFC|NFC)\s+/, "");
}

/** "Arizona Cardinals vs Los Angeles Rams, Wild Card 2021". */
export function scoreboardHeading(game: ScoreboardGame): string {
  return (
    `${game.away.name} vs ${game.home.name}, ` +
    `${roundWithoutConference(game.roundLabel)} ${game.seasonLabel}`
  );
}

/** The badge: "Final", "Final/OT", "Final, tie", "Live" or "Upcoming". */
export function scoreboardBadge(game: ScoreboardGame): string {
  if (game.status === "upcoming") return "Upcoming";
  if (game.status === "in_progress") return "Live";
  const result = scoreboardResult(game);
  const tie = result !== null && result.winner === null;
  return `Final${wentToOvertime(game) ? "/OT" : ""}${tie ? ", tie" : ""}`;
}

function resultTag(game: ScoreboardGame): string {
  if (game.gameType === "regular") return "Won";
  return isSuperBowl(game) ? "Won Super Bowl" : "Won, advanced";
}

/* ------------------------------------------------------------------ kickoff */

const EASTERN = "America/New_York";

function easternParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export interface KickoffText {
  /** "Mon, Jan 17, 2022" */
  date: string;
  /** "8:15 PM ET", or "Time TBD". */
  time: string;
}

/** Kickoff in US Eastern time, or null for a game with no date. */
export function scoreboardKickoff(game: ScoreboardGame): KickoffText | null {
  if (!game.kickoff) return null;
  const at = new Date(game.kickoff);
  if (Number.isNaN(at.getTime())) return null;
  const p = easternParts(at);
  return {
    date: `${p["weekday"]}, ${p["month"]} ${p["day"]}, ${p["year"]}`,
    time:
      game.timeConfirmed === false
        ? "Time TBD"
        : `${p["hour"]}:${p["minute"]} ${p["dayPeriod"]} ET`,
  };
}

/* -------------------------------------------------------------------- seo */

/**
 * The page title candidates, most descriptive first, without the brand.
 *
 * "Cardinals vs Rams Wild Card 2021: Final Score 34–11, Stats & Recap". The
 * score is written winner first, the way it is said. Before kickoff there is
 * no score to put in it and the score clause goes. The caller fits the first
 * candidate that the length budget allows - see fitMatchupTitle().
 */
export function scoreboardTitleCandidates(game: ScoreboardGame): string[] {
  const lead =
    `${game.away.short} vs ${game.home.short} ` +
    `${roundWithoutConference(game.roundLabel)} ${game.seasonLabel}`;
  const result = scoreboardResult(game);
  if (!result) return [`${lead}: Stats & Recap`, lead];
  const high = Math.max(result.away, result.home);
  const low = Math.min(result.away, result.home);
  const score = `${high}–${low}`;
  return [
    `${lead}: Final Score ${score}, Stats & Recap`,
    `${lead}: Final Score ${score}`,
    `${lead} Final Score ${score}`,
    `${lead}: ${score}`,
  ];
}

/** "Final: Los Angeles Rams 34, Arizona Cardinals 11." - winner first. */
export function scoreboardSummary(game: ScoreboardGame): string {
  const result = scoreboardResult(game);
  if (!result) {
    const when = scoreboardKickoff(game);
    return (
      `${game.away.name} ${game.venue?.neutral ? "vs." : "at"} ${game.home.name}` +
      (when ? `, ${when.date}${when.time === "Time TBD" ? "" : `, ${when.time}`}` : "") +
      "."
    );
  }
  const sides = [
    { team: game.away, points: result.away },
    { team: game.home, points: result.home },
  ];
  if (result.winner === "home") sides.reverse();
  return (
    `Final${wentToOvertime(game) ? " (OT)" : ""}: ` +
    sides.map((s) => `${s.team.name} ${s.points}`).join(", ") +
    "."
  );
}

type Node = Record<string, unknown>;

function teamNode(team: ScoreboardTeam): Node {
  return {
    "@type": "SportsTeam",
    name: team.name,
    ...(team.url ? { url: team.url } : {}),
  };
}

/**
 * The game as a schema.org SportsEvent, or null when it cannot be one.
 *
 * Google reads a SportsEvent as an Event, and an Event without a startDate or a
 * location is an error in Search Console, so a game missing either gets no
 * node rather than a broken one. The same rule team/schedule-schema.ts keeps.
 */
export function scoreboardSportsEvent(game: ScoreboardGame): Node | null {
  if (!game.kickoff || !game.venue) return null;
  const address: Node = { "@type": "PostalAddress" };
  if (game.venue.city) address["addressLocality"] = game.venue.city;
  if (game.venue.state) address["addressRegion"] = game.venue.state;
  return {
    "@type": "SportsEvent",
    name: scoreboardHeading(game),
    sport: "American football",
    startDate: game.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "StadiumOrArena",
      name: game.venue.name,
      ...(Object.keys(address).length > 1 ? { address } : {}),
    },
    homeTeam: teamNode(game.home),
    awayTeam: teamNode(game.away),
    description: scoreboardSummary(game),
  };
}

/* ------------------------------------------------------------------ render */

function logo(team: ScoreboardTeam): string {
  if (!team.logoUrl) return "";
  return (
    `<img class="sct-sbh-logo" src="${escapeHtml(team.logoUrl)}"` +
    ` alt="${escapeHtml(team.name)}" width="48" height="48" decoding="async" />`
  );
}

/** The quarter cell: the points, or a dash for a quarter not yet played. */
function quarterCell(team: ScoreboardTeam, i: number): string {
  const value = team.quarters?.[i];
  return value === undefined ? "–" : String(value);
}

/**
 * Scoring by quarter, as a real table: two rows, away first, home second.
 *
 * Absent before kickoff and whenever either side has no line score - there is
 * no version of this table built from a final score alone.
 */
function linescore(game: ScoreboardGame, result: ScoreboardResult | null): string {
  if (game.status === "upcoming" || !game.away.quarters || !game.home.quarters) return "";
  const ot = wentToOvertime(game);
  const columns = ["Q1", "Q2", "Q3", "Q4", ...(ot ? ["OT"] : [])];
  const row = (team: ScoreboardTeam, side: "away" | "home"): string => {
    const total = scoreboardTotal(team);
    const won = result?.winner === side;
    return (
      `<tr${won ? ` class="is-winner"` : ""}>` +
      `<th scope="row" class="sct-mu-ls-team">${escapeHtml(team.short)}</th>` +
      [0, 1, 2, 3].map((i) => `<td>${quarterCell(team, i)}</td>`).join("") +
      (ot ? `<td>${team.ot === null ? "–" : String(team.ot)}</td>` : "") +
      `<td class="sct-mu-ls-total">${total === null ? "–" : String(total)}</td>` +
      `</tr>`
    );
  };
  return (
    `<div class="sct-sbh-linescore">` +
    `<table class="sct-mu-linescore">` +
    `<caption>Scoring by quarter</caption>` +
    `<thead><tr>` +
    `<th scope="col">Team</th>` +
    columns.map((label) => `<th scope="col">${label}</th>`).join("") +
    `<th scope="col" class="sct-mu-ls-total">Final</th>` +
    `</tr></thead>` +
    `<tbody>${row(game.away, "away")}${row(game.home, "home")}</tbody>` +
    `</table>` +
    `</div>`
  );
}

/**
 * The scoreboard hero for one game.
 *
 * Four rows: the meta bar (status badge and round on the left, venue and
 * kickoff on the right), the H1, the score, and the quarter table. Before
 * kickoff the score row carries the kickoff instead and the table is absent.
 */
export function renderScoreboardHero(
  game: ScoreboardGame,
  options: ScoreboardHeroOptions = {},
): string {
  const tag = options.headingTag ?? "h1";
  const headingId = options.headingId ?? "sct-sbh-title";
  const heading = options.heading ?? scoreboardHeading(game);
  const result = scoreboardResult(game);
  const neutral = game.venue?.neutral === true;
  const when = scoreboardKickoff(game);


  // Row 1. The round with its conference ("2021 NFC Wild Card"); the heading
  // below drops it.
  const where = game.venue
    ? `<span class="sct-sbh-venue">${escapeHtml(game.venue.name)}</span>` +
      [game.venue.city, game.venue.state]
        .filter(Boolean)
        .map((part) => `, ${escapeHtml(part)}`)
        .join("")
    : "";
  const kickoff = when
    ? `<time datetime="${escapeHtml(game.kickoff!)}">` +
      escapeHtml(`${when.date}, ${when.time}`) +
      `</time>`
    : "";
  const meta =
    `<div class="sct-sbh-meta">` +
    `<p class="sct-sbh-meta-game">` +
    `<span class="sct-sbh-badge" data-status="${game.status}">${escapeHtml(scoreboardBadge(game))}</span>` +
    `<span class="sct-sbh-round">${escapeHtml(`${game.seasonLabel} ${game.roundLabel}`)}</span>` +
    `</p>` +
    (where || kickoff
      ? `<p class="sct-sbh-meta-where">` +
        (where ? `<span>${where}</span>` : "") +
        (where && kickoff ? `<span class="sct-sbh-divider" aria-hidden="true">|</span>` : "") +
        kickoff +
        `</p>`
      : "") +
    `</div>`;

  // Row 3. Scores print on a final and while the game is being played; before
  // kickoff the kickoff takes their place.
  const scored = game.status !== "upcoming";
  const side = (team: ScoreboardTeam, which: "away" | "home"): string => {
    const total = scored ? scoreboardTotal(team) : null;
    const won = result?.winner === which;
    const lost = result !== null && result.winner !== null && !won;
    const label = neutral ? "" : which === "away" ? "Away" : "Home";
    const tag = won ? resultTag(game) : "";
    return (
      `<div class="sct-sbh-team is-${which}${won ? " is-winner" : ""}${lost ? " is-loser" : ""}">` +
      `<p class="sct-sbh-name">${logo(team)}<span>${escapeHtml(team.name)}</span></p>` +
      (label || tag
        ? `<p class="sct-sbh-label">` +
          (label ? `<span>${label}</span>` : "") +
          (tag ? `<span class="sct-sbh-tag">${escapeHtml(tag)}</span>` : "") +
          `</p>`
        : "") +
      (total === null
        ? ""
        : `<p class="sct-sbh-score" aria-label="${escapeHtml(`${team.short} ${total}`)}">${total}</p>`) +
      `</div>`
    );
  };

  const upcoming =
    game.status === "upcoming" || (scored && scoreboardTotal(game.away) === null)
      ? `<p class="sct-sbh-kickoff">` +
        (when
          ? `<span class="sct-sbh-kickoff-date">${escapeHtml(when.date)}</span>` +
            `<span class="sct-sbh-kickoff-time">${escapeHtml(when.time)}</span>`
          : `<span class="sct-sbh-kickoff-date">Date TBD</span>`) +
        `</p>`
      : "";

  const board =
    `<div class="sct-sbh-board">` +
    side(game.away, "away") +
    `<span class="sct-sbh-vs" aria-hidden="true">vs</span>` +
    side(game.home, "home") +
    `</div>` +
    upcoming;

  const tie = result !== null && result.winner === null;

  return (
    `<header class="sct-sbh${tie ? " is-tie" : ""}" data-status="${game.status}"` +
    ` aria-labelledby="${escapeHtml(headingId)}"` +
    ` style="${escapeHtml(
      `--sbh-away:${heroSideFill(game.away.abbr)};--sbh-home:${heroSideFill(game.home.abbr)}`,
    )}"` +
    `>` +
    meta +
    `<${tag} class="sct-sbh-title" id="${escapeHtml(headingId)}" data-sct-hero-heading>` +
    `${escapeHtml(heading)}</${tag}>` +
    board +
    linescore(game, result) +
    `</header>`
  );
}
