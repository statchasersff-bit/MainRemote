/**
 * The matchup page: two teams, one evergreen URL.
 *
 * Renders from MatchupData and lays itself out for the state that data
 * declares — the next meeting leads when there is one, the result when one
 * was just played, the head-to-head when neither. The URL never changes with
 * the state, so nothing here prints a date-dependent heading a search snippet
 * could go stale on; the hero names the two teams and the season, and the
 * state decides what comes under it.
 *
 * Built from the team page's own components — the scoreboard, the game card,
 * the stat rows, the injury list — so a matchup page and the two hubs it sits
 * between cannot disagree about how a game or a number looks. What is new
 * here is only the side-by-side.
 *
 * Nothing is invented to fill a section. No broadcaster means no network line;
 * no kickoff time means "Time TBD" as the schedule already says; no meetings in
 * the window means the history block is absent, not a sentence about rivalry.
 */

import { escapeHtml } from "../render";
import {
  ARROW,
  fixtureTags,
  gameDateLine,
  h2,
  injurySeverity,
  matchupSide,
  networkDefs,
  networkHtml,
  playerName,
  PUBLIC_SECTIONS,
  rankTier,
  sectionPath,
  slotChip,
  styleAttr,
  TIER_WORD,
} from "../team-render";
import { gameSegment, type MatchupGameRef } from "./pair";
import type { NflTeam } from "../team/teams";
import { headshotUrl } from "../team/roster";
import { ordinal, type StatRow, type TeamStats } from "../team/stats";
import type { ScheduleGame } from "../team/schedule";
import type { TeamPageData } from "../team/team-data";
import type { FpaRow } from "../fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "../fpa/nflverse";
import type { MatchupData, Meeting } from "./matchup-data";
import {
  boxLineFor,
  boxStatsFor,
  formatClock,
  periodLabel,
  type BoxTeamStats,
} from "./boxscore";
import type {
  FantasyRow,
  GameStats,
  PassingRow,
  ReceivingRow,
  RushingRow,
  Takeaway,
  TeamUsage,
  UsageRow,
  UsageSlice,
} from "./game-stats";
import type { GameLeader, GameLeaders } from "./leaders";

export interface MatchupRenderOptions {
  /** Inside a statchasers.com page: no H1, no page chrome. */
  embed?: boolean;
  /** Where a team hub link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Where matchup pages live. Defaults to this app's own /nfl/. */
  matchupPathPrefix?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  now?: number;
  /**
   * The meeting this request asked for, when the URL is a game address.
   *
   * Strictly a description of the request rather than of the rendering — the
   * renderer reads data.pinned, not this — but it travels with the option bag
   * because it changes which data is built, and therefore has to reach the
   * cache key beside everything else that does.
   */
  game?: MatchupGameRef | null;
}

/** The public address of a pair: `<prefix><a>-vs-<b>/`. */
export function matchupPath(prefix: string, slug: string): string {
  return `${prefix}${slug}/`;
}

/** The public address of one meeting: `<prefix><a>-vs-<b>/2026-week-1/`. */
export function gamePath(prefix: string, slug: string, ref: MatchupGameRef): string {
  return `${matchupPath(prefix, slug)}${gameSegment(ref)}/`;
}

/** The pair as a heading: "New England Patriots vs Philadelphia Eagles". */
export function matchupTitle(data: MatchupData): string {
  return `${data.pair.a.fullName} vs ${data.pair.b.fullName}`;
}

/* ------------------------------------------------------------------ atoms */

const DOT = `<span class="sct-dot" aria-hidden="true"></span>`;

/**
 * The meeting list's week, short enough for a narrow column.
 *
 * "WK 1" where the season has weeks, and the postseason round's own short form
 * where it does not — "Conference Championship" is four times the width of
 * anything else in that column and would set the column's width for every row
 * on the page.
 */
const SHORT_ROUNDS: Record<string, string> = {
  "wild card": "WILD CARD",
  "divisional round": "DIVISIONAL",
  "conference championship": "CONF CHAMP",
  "super bowl": "SUPER BOWL",
};

function shortWeek(meeting: Meeting): string {
  if (meeting.seasonType === "regular") return `WK ${meeting.week}`;
  const label = meeting.weekLabel.trim();
  return SHORT_ROUNDS[label.toLowerCase()] ?? label.toUpperCase();
}

/** "Week 8 · Sun, Oct 25 · 4:25 PM ET", from whatever parts a meeting has. */
function whenLine(meeting: Meeting): string {
  const when = gameDateLine(asGame(meeting));
  const parts = [meeting.weekLabel, when.date];
  if (when.time) parts.push(when.time);
  return parts.map(escapeHtml).join(DOT);
}

/**
 * A meeting in the shape the shared game helpers take. They read a game from
 * one team's side; for date and tag purposes the side does not matter, so the
 * home team stands in.
 */
function asGame(meeting: Meeting): ScheduleGame {
  return {
    week: meeting.week,
    seasonType: meeting.seasonType,
    weekLabel: meeting.weekLabel,
    espnEventId: meeting.espnEventId,
    kickoffMs: meeting.kickoffMs,
    timeConfirmed: meeting.timeConfirmed,
    homeAway: "home",
    neutralSite: meeting.neutralSite,
    opponent: meeting.away,
    opponentName: meeting.away.fullName,
    venue: meeting.venue,
    venueCity: meeting.venueCity,
    international: false,
    divisional: meeting.home.division === meeting.away.division,
    network: meeting.network,
    status: meeting.status,
    result: null,
  };
}

function record(side: TeamPageData): string {
  return side.profile?.record ? escapeHtml(side.profile.record) : "";
}

/* ------------------------------------------------------------------- hero */

/**
 * Whether the page lays itself out as a game page rather than as a fixture.
 *
 * One predicate, asked once, because the whole page hangs off it: the hero, the
 * order of the sections, what three of them are called. A final score is the
 * condition — not the matchup state — so a pair whose last meeting was two
 * seasons ago still gets the result treated as a result.
 */
function isPostgame(data: MatchupData): boolean {
  // A game address is a recap by definition — that is the whole reason it is a
  // separate URL. It does not age out, because nothing on it is advice: on a
  // dated page the takeaways and the usage are what happened in that week, read
  // by someone who came looking for that week.
  if (data.pinned) return data.pinned.score !== null;

  return (
    data.matchupState === "recently_completed" &&
    data.featured?.status === "final" &&
    data.featured.score !== null
  );
}

/**
 * Whether the blocks that describe *now* belong on this page.
 *
 * Season Form, the injury report and the Fantasy Matchups ranks are all read
 * from today's data, which is right on the pair's own address and right on a
 * game address from the season in progress — the reader asking about Week 1 in
 * December is still playing fantasy in 2026. It is wrong on a game from an
 * earlier season: a 2024 recap carrying 2026 injury designations is not history
 * with a bonus, it is three blocks of the wrong answer under a heading that
 * says 2024.
 */
function describesNow(data: MatchupData): boolean {
  return !data.pinned || data.pinned.season === data.state.season;
}

/**
 * The hero's heading.
 *
 * A game address says which game in its H1, because that is what separates it
 * from the pair's page — two pages headed "New England Patriots vs Seattle
 * Seahawks" are two pages competing for one query.
 */
function heroHeading(data: MatchupData): string {
  const names = matchupTitle(data);
  return data.pinned
    ? `${names}, ${data.pinned.weekLabel} ${data.pinned.season}`
    : names;
}

/**
 * Whether the featured meeting has a result to describe at all.
 *
 * Wider than isPostgame(): a pair whose last meeting was three seasons ago
 * still has a box score worth printing, and "patriots vs eagles 2023 player
 * stats" is a real search. What it does NOT get is the recap layout — the
 * takeaways are advice for the coming week, and three-year-old advice is not
 * evergreen content, it is wrong content.
 */
function hasResult(data: MatchupData): boolean {
  return data.featured?.status === "final" && data.featured.score !== null;
}

/**
 * The quarter-by-quarter line, which is the thing a score page has and a
 * fixture page does not.
 *
 * Two rows and five or six columns carrying the shape of the whole game — who
 * led at the half, who scored last, whether it needed overtime — in less space
 * than the sentence describing it. Absent entirely when the box score did not
 * load; there is no version of this table built from a final score alone.
 */
function renderLinescore(data: MatchupData): string {
  const box = data.boxscore;
  const meeting = data.featured;
  if (!box || !meeting) return "";

  const lines = [boxLineFor(box, meeting.away), boxLineFor(box, meeting.home)];
  if (lines.some((line) => line === null)) return "";

  const columns = Array.from({ length: box.periodCount }, (_, i) => periodLabel(i));

  const row = (line: NonNullable<(typeof lines)[number]>): string => {
    const team = line.team;
    const won = meeting.winner?.abbreviation === team?.abbreviation;
    return (
      `<tr${won ? ` class="is-winner"` : ""}>` +
      `<th scope="row" class="sct-mu-ls-team">` +
      (team
        ? `<img class="sct-mu-ls-logo" src="${escapeHtml(team.logo)}" alt=""` +
          ` width="20" height="20" loading="lazy" decoding="async" />`
        : "") +
      `<span>${escapeHtml(team?.code.toUpperCase() ?? line.abbr)}</span>` +
      `</th>` +
      columns
        .map(
          (_, i) =>
            `<td class="sct-mu-ls-q">${escapeHtml(String(line.periods[i] ?? 0))}</td>`,
        )
        .join("") +
      `<td class="sct-mu-ls-total">${escapeHtml(String(line.total))}</td>` +
      `</tr>`
    );
  };

  return (
    `<table class="sct-mu-linescore">` +
    `<caption class="sct-visually-hidden">Scoring by quarter</caption>` +
    `<thead><tr>` +
    `<th scope="col"><span class="sct-visually-hidden">Team</span></th>` +
    columns.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("") +
    `<th scope="col" class="sct-mu-ls-total">T</th>` +
    `</tr></thead>` +
    `<tbody>${lines.map((line) => row(line!)).join("")}</tbody>` +
    `</table>`
  );
}

/** The dot the eyebrow joins on, as text rather than as the decorative span. */
const DOT_TEXT = " · ";

/**
 * The hero, on whichever side of kickoff the page is standing.
 *
 * A finished game's hero IS the scoreboard: the reader arriving from "patriots
 * vs seahawks score" used to meet the fixture twice and the number once, half
 * a page down, so the two were merged into one object above the fold. The
 * fixture hero was never brought with it. It stayed a title block on the left
 * with a stack of crest-over-code-over-record parked on the right and the
 * kickoff squeezed into the subtitle — a second hero, in a second shape, for
 * the same two teams.
 *
 * There is one shape now, and it is the postgame one: eyebrow and title
 * centred over a horizontal board, each side a row of crest, name over record
 * and — on a final only — the number, the two sides meeting at a join in the
 * middle. Under it the venue and the kickoff; under that, on a final, the
 * quarter line. What changes between the two states is what the board has to
 * say, not how the page is built.
 *
 * Both sides are built by the same call in the same order and the right-hand
 * one is reversed in CSS, so the two are mirror images by construction rather
 * than by two orders kept in step by hand.
 */
function renderHero(data: MatchupData, options: MatchupRenderOptions): string {
  const headingTag = options.embed ? "h2" : "h1";
  const meeting = data.featured;

  // The number is printed on the page that is about the number, and nowhere
  // else: isPostgame() is the whole condition, so a meeting three seasons old
  // keeps the fixture board and its result stays in Head-to-Head, where the
  // reader is asking about it in the past tense.
  const result =
    isPostgame(data) && meeting?.score
      ? { meeting, score: meeting.score }
      : null;

  // Away first, home second, as every scoreboard reads. With no featured game
  // — or one at a neutral site, where there is no host to put second — the
  // pair's own order stands and the join is "vs".
  const board = meeting && (result || !meeting.neutralSite) ? meeting : null;
  const left = board ? board.away : data.pair.a;
  const right = board ? board.home : data.pair.b;
  const leftData = left.abbreviation === data.pair.a.abbreviation ? data.a : data.b;
  const rightData = right.abbreviation === data.pair.a.abbreviation ? data.a : data.b;
  const join = result ? "&ndash;" : board ? "@" : "vs";

  // "Final", or "Final/OT" when the line score says it took longer. Read off
  // the periods actually played rather than asserted: four quarters is four
  // columns, and anything past that happened.
  const periods = data.boxscore?.periodCount ?? 4;
  const status = result
    ? periods > 4
      ? `Final${periods > 5 ? `/${periods - 4}OT` : "/OT"}`
      : "Final"
    : meeting?.status === "live"
      ? "Live"
      : data.matchupState === "upcoming"
        ? "Upcoming"
        : "";

  // The meeting the hero is actually describing — which is not every meeting
  // it can draw. An evergreen pair page boards the last one the two played,
  // and printing that game's stadium and date under the crests would date a
  // page whose subject is the rivalry: the meeting has its own section, with
  // its own year on it. So the metadata row is filled from a game the reader
  // is either waiting for or has just watched, and from nothing else.
  const subject = result ? result.meeting : status ? meeting : null;

  // The same two inks the rest of the page resolves teams to, so a side's tint
  // here and its bars further down are never two different navies — and so the
  // pairs that genuinely share a primary (Patriots and Seahawks are both
  // #002244) still come out as two distinguishable sides. See pairColors().
  const color = matchupColors(data.pair);

  const side = (team: NflTeam, which: "left" | "right"): string => {
    const teamData =
      team.abbreviation === data.pair.a.abbreviation ? data.a : data.b;
    const won = result?.meeting.winner?.abbreviation === team.abbreviation;
    const mark = record(teamData);
    const points = result ? result.score[which === "left" ? "away" : "home"] : null;
    return (
      // is-right is what reverses the row, so the home crest sits on the
      // outside and the home number beside the join — the mirror of the away
      // side. The ink is the side's own tint, which is what gives each half of
      // the strip its structure without a divider ruled down the middle of it.
      `<div class="sct-mu-strip-side${which === "right" ? " is-right" : ""}${won ? " is-winner" : ""}"` +
      styleAttr([`--mu-side-ink:${color(team)}`]) +
      `>` +
      `<img class="sct-mu-strip-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="56" height="56" loading="lazy" decoding="async" />` +
      `<span class="sct-mu-strip-who">` +
      // Nickname and code, one of which is showing at any width. Below 640px a
      // nickname truncates to "PATRI…" between a 34px crest and a 40px number,
      // and an ellipsis is a worse label than the three letters every scoreboard
      // uses. Both are in the markup because the swap is a width question and
      // the server does not know the width; the board is aria-hidden either way,
      // so nothing is announced twice.
      `<span class="sct-mu-strip-name">${escapeHtml(team.nickname)}</span>` +
      `<span class="sct-mu-strip-code">${escapeHtml(team.code.toUpperCase())}</span>` +
      (mark ? `<span class="sct-mu-strip-record">${mark}</span>` : "") +
      `</span>` +
      (points === null
        ? ""
        : `<span class="sct-mu-strip-score">${escapeHtml(String(points))}</span>`) +
      `</div>`
    );
  };

  // Season, round, and one word for where the game stands, in that order
  // whether it is coming or gone. The status is NOT repeated below: it was
  // also the first word of the metadata line and — before the board was
  // rebuilt — the thing the middle of the board wanted to say, and three
  // "Final"s in forty vertical pixels is not emphasis. With no meeting to
  // stand on, the pair's own line stands instead.
  const eyebrow =
    meeting && status
      ? `${meeting.season} NFL${DOT_TEXT}${meeting.weekLabel}${DOT_TEXT}${status}`
      : `NFL Matchup${DOT_TEXT}${data.state.season} Season`;

  const when = subject ? gameDateLine(asGame(subject)) : null;
  // gameDateLine() already spells the zone into `time`, so nothing is appended
  // here — doing it anyway printed "8:20 PM ET ET". On a game already played an
  // unconfirmed kickoff is noise; on one still to come "Time TBD" is the answer
  // to the question the reader arrived with, so it stays.
  const whenParts = when
    ? [when.date, result && when.time === "Time TBD" ? "" : when.time]
        .filter(Boolean)
        .map(String)
    : [];
  const where = subject ? [subject.venue].filter(Boolean).map(String) : [];

  // Where it happened and when — or, on a page with no current game to put
  // there, what the page is. Never both: an empty metadata row and a floating
  // sentence are the same slot asked to do two jobs.
  const meta =
    where.length || whenParts.length
      ? `<p class="sct-mu-strip-meta">` +
        (where.length
          ? `<span class="sct-mu-strip-where">${escapeHtml(where.join(" · "))}</span>`
          : "") +
        (where.length && whenParts.length ? DOT : "") +
        (whenParts.length
          ? `<span class="sct-mu-strip-when">${escapeHtml(whenParts.join(" · "))}</span>`
          : "") +
        `</p>`
      : `<p class="sct-mu-strip-note">` +
        escapeHtml("Head-to-head record, team stats, injuries and recent meetings") +
        `</p>`;

  // The board is crests and numbers; read out cell by cell it is an alphabet.
  // This is the same fact as a sentence.
  const spoken = result
    ? result.meeting.winner
      ? `${result.meeting.winner.fullName} beat ` +
        `${(result.meeting.winner.abbreviation === result.meeting.home.abbreviation ? result.meeting.away : result.meeting.home).fullName} ` +
        `${Math.max(result.score.home, result.score.away)}–${Math.min(result.score.home, result.score.away)}` +
        ` in the ${result.meeting.weekLabel} of the ${result.meeting.season} season` +
        (result.meeting.neutralSite || !result.meeting.venue
          ? "."
          : ` at ${result.meeting.venue}.`)
      : `${result.meeting.away.fullName} and ${result.meeting.home.fullName} tied ` +
        `${result.score.away}–${result.score.home} in the ${result.meeting.weekLabel} of the ${result.meeting.season} season.`
    : `${left.fullName}${record(leftData) ? ` (${leftData.profile?.record})` : ""} ` +
      `${join === "@" ? "at" : "versus"} ` +
      `${right.fullName}${record(rightData) ? ` (${rightData.profile?.record})` : ""}`;

  return (
    `<header class="sct-hero sct-mu-hero${result ? " is-final" : ""}">` +
    // No aura. It is a 320px team-coloured blur anchored to the hero's
    // top-left corner, and on a board with two sides there is no one crest for
    // it to sit behind; the side tints below do the same job in the right
    // places. The decor layer stays for the hairline of team colour it draws
    // across the top.
    `<span class="sct-hero-decor" aria-hidden="true"></span>` +
    `<div class="sct-mu-strip-inner">` +
    // NOT `.sct-hero-text`. That class is the HUB hero's named grid area —
    // `grid-area: text`, which only means anything inside `.sct-hero-inner`'s
    // `grid-template-areas`. This grid has no named areas, and a name that
    // matches no line is resolved against the IMPLICIT grid rather than
    // ignored: the block was pushed into a column of its own, the board and
    // the meta line auto-placed into the first, and the hero came apart into
    // two columns with the title stranded at the bottom of the right-hand one.
    // Everything the borrowed class was actually contributing — `min-width: 0`
    // — is on `.sct-mu-strip-text` in team.css instead.
    `<div class="sct-mu-strip-text">` +
    `<p class="sct-eyebrow">${escapeHtml(eyebrow)}</p>` +
    `<${headingTag} class="sct-title sct-mu-strip-title">${escapeHtml(heroHeading(data))}</${headingTag}>` +
    `</div>` +
    `<div class="sct-mu-strip-board" aria-hidden="true">` +
    side(left, "left") +
    // A dash on a final, not "@". The "@" was the only thing on the board
    // naming the home side, but it was also a character doing that job in the
    // one position the eye lands on first — between the two numbers, where the
    // reader is asking "what was the score", not "who was at home". Before
    // kickoff there are no numbers to separate and the question is exactly the
    // other one, so the fixture board keeps it.
    `<span class="sct-mu-strip-join">${join}</span>` +
    side(right, "right") +
    `</div>` +
    `<p class="sct-visually-hidden">${escapeHtml(spoken)}</p>` +
    meta +
    (result ? renderLinescore(data) : "") +
    `</div>` +
    `</header>`
  );
}

/* --------------------------------------------------------- featured game */

/** The lead card: the meeting just played, or the last one there was. */
function renderFeatured(data: MatchupData): string {
  const meeting = data.featured;
  if (!meeting) return "";

  const isResult = meeting.status === "final" && meeting.score !== null;
  // A card with no score on it. Every line the fixture version drew — season,
  // round, stadium, kickoff — the hero had already drawn above it, and "Where
  // to Watch" drew the kickoff and the stadium again directly below: the same
  // four facts three times, under a heading promising a fifth. The scoreboard
  // is the only thing this card has that the hero does not, so it renders
  // when there is a scoreboard and not otherwise. A fixture is announced once.
  if (!isResult) return "";

  const title = data.matchupState === "recently_completed" ? "Final" : "Last Meeting";

  const tags = fixtureTags(asGame(meeting)).map(
    (tag) =>
      `<span class="sct-game-tag" data-kind="${tag.kind}">${escapeHtml(tag.label)}</span>`,
  );

  // The scoreboard. Away on the left, as every scoreboard writes it, and the
  // winner carried as a class rather than as a word — the bigger number is
  // already saying it, and "W" beside it says it twice.
  const sbSide = (side: "home" | "away"): string => {
    const team = side === "home" ? meeting.home : meeting.away;
    const won = meeting.winner?.abbreviation === team.abbreviation;
    return (
      `<div class="sct-mu-sb-side${won ? " is-winner" : ""}">` +
      `<img class="sct-mu-sb-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="64" height="64" loading="lazy" decoding="async" />` +
      `<span class="sct-mu-sb-name">${escapeHtml(team.nickname)}</span>` +
      `<span class="sct-mu-sb-score">${meeting.score?.[side] ?? ""}</span>` +
      `</div>`
    );
  };

  const score = meeting.score
    ? `<div class="sct-mu-scoreboard">` +
      sbSide("away") +
      `<span class="sct-mu-sb-sep" aria-hidden="true">–</span>` +
      sbSide("home") +
      `</div>` +
      // The result as a sentence, for a screen reader reading the numbers
      // out of a grid that only makes sense to the eye.
      `<p class="sct-visually-hidden">${escapeHtml(
        meeting.winner
          ? `${meeting.winner.nickname} won ${Math.max(meeting.score.home, meeting.score.away)}–${Math.min(meeting.score.home, meeting.score.away)}`
          : `Tied ${meeting.score.home}–${meeting.score.away}`,
      )}</p>`
    : "";

  // The stadium alone. The broadcaster belonged to the fixture version of this
  // card — who is showing a game that has been played is not a fact anyone
  // needs — and that version is gone.
  const where = meeting.venue ? escapeHtml(meeting.venue) : "";

  const home = meeting.neutralSite
    ? "Neutral site"
    : `${meeting.home.nickname} host`;

  return (
    `<section class="sct-block sct-mu-featured" data-state="${data.matchupState}">` +
    h2(title) +
    `<div class="sct-game sct-mu-game is-final">` +
    `<div class="sct-game-head">` +
    `<span class="sct-game-week">${escapeHtml(`${meeting.season} · ${meeting.weekLabel}`)}</span>` +
    `<span class="sct-game-pills">${tags.join("")}` +
    `<span class="sct-game-pill" data-kind="home">${escapeHtml(home)}</span></span>` +
    `</div>` +
    score +
    renderLinescore(data) +
    // Beneath the score, and quieter than it. On a final, the date and the
    // stadium are where it happened, not what happened.
    `<div class="sct-game-meta">` +
    `<p class="sct-game-when">${whenLine(meeting)}</p>` +
    (where ? `<p class="sct-game-where">${where}</p>` : "") +
    `</div>` +
    `</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------- game leaders */

/**
 * The caption over a two-sided comparison: one name per column, the join between.
 *
 * The grid is an inner element and NOT the <caption> itself, which is the whole
 * reason this is a function. Setting `display: flex` or `display: grid` on a
 * caption replaces `display: table-caption`, so the browser stops treating it
 * as a caption at all and wraps it in an anonymous cell — it was rendering at
 * the width of the first column, clustered over the left-hand side's numbers
 * instead of spanning the three columns it names. The caption keeps its own
 * display; the row inside it does the layout.
 *
 * `hidden` is what a screen reader hears in place of the three words, which on
 * their own are two team names and a preposition.
 */
function compareCaption(
  leftName: string,
  join: string,
  rightName: string,
  hidden: string,
): string {
  return (
    `<caption class="sct-mu-cmp-title">` +
    `<span class="sct-mu-cmp-row">` +
    `<span class="sct-mu-cmp-side" data-side="a">${escapeHtml(leftName)}</span>` +
    `<span class="sct-mu-cmp-vs">${escapeHtml(join)}</span>` +
    `<span class="sct-mu-cmp-side" data-side="b">${escapeHtml(rightName)}</span>` +
    `</span>` +
    `<span class="sct-visually-hidden">${escapeHtml(hidden)}</span>` +
    `</caption>`
  );
}

/**
 * "QB · SEA", with the position carrying its own colour.
 *
 * The four skill positions are colour-coded across the whole site — the depth
 * chart's slot chips and the outlook cards use the same four inks, and they are
 * tokens rather than literals so a page cannot drift from the others. Split
 * into its own element because only the POSITION is coloured: the team code
 * beside it stays muted, or a row of these becomes a row of two-tone text with
 * no hierarchy in it.
 *
 * Either part may be absent, and the separator is drawn only when both are
 * there — a player with no position must not render a leading dot.
 */
function positionTag(
  position: string | null | undefined,
  teamCode: string | null | undefined,
  className: string,
): string {
  const pos = (position ?? "").trim();
  const code = (teamCode ?? "").trim().toUpperCase();
  if (!pos && !code) return "";
  return (
    `<span class="${className}">` +
    (pos
      ? `<span class="sct-pos" data-pos="${escapeHtml(pos.toUpperCase())}">${escapeHtml(pos)}</span>`
      : "") +
    (pos && code ? `<span class="sct-pos-dot" aria-hidden="true">·</span>` : "") +
    (code ? `<span class="sct-pos-team">${escapeHtml(code)}</span>` : "") +
    `</span>`
  );
}

/**
 * A player's face, in the round well the depth chart and the outlook cards use.
 *
 * Decorative, so the alt is empty: the name is on the row beside it and
 * announcing the face as well reads the player out twice. The well is drawn by
 * the stylesheet and survives an image that 404s, which is the ordinary case
 * for a rookie Sleeper has no thumbnail for — a missing face leaves a tinted
 * disc rather than a broken-image glyph.
 */
function playerPhoto(playerId: string, className: string, size: number): string {
  return (
    `<span class="${className}" aria-hidden="true">` +
    `<img src="${escapeHtml(headshotUrl(playerId))}" alt=""` +
    ` width="${size}" height="${size}" loading="lazy" decoding="async" />` +
    `</span>`
  );
}

/**
 * Who led the game, in four cards.
 *
 * Postgame only, and silent when the logs cannot answer. The name is the
 * loudest thing in each card: the number is the reason the card exists, but the
 * name is what the reader came for and what the search that brought them here
 * was about. The face is there because these are the four players the page is
 * about and a row of text undersold them.
 */
function renderLeaders(data: MatchupData): string {
  const leaders: GameLeaders | null = data.gameStats?.leaders ?? null;
  if (!leaders) return "";

  const card = (label: string, leader: GameLeader | null): string => {
    if (!leader) return "";
    const code = leader.team?.code ?? "";
    // The crest of the team he played for THAT day, as the card's watermark —
    // the device the outlook cards already use, and the reason it is a CSS
    // background rather than an <img>: it is texture, not a second picture of
    // something. A leader whose team the logs could not name simply has none,
    // and the card falls back to the plain surface it had before.
    const logo = leader.team?.logo ?? null;
    return (
      `<li class="sct-mu-leader${logo ? " has-team-logo" : ""}"` +
      styleAttr([logo ? `--mu-leader-logo:url('${logo}')` : null]) +
      `>` +
      `<p class="sct-mu-leader-label">${escapeHtml(label)}</p>` +
      `<div class="sct-mu-leader-body">` +
      playerPhoto(leader.player.id, "sct-mu-leader-photo", 56) +
      `<div class="sct-mu-leader-who">` +
      playerName(leader.player.name, "sct-mu-leader-name") +
      positionTag(leader.player.position, code, "sct-mu-leader-tag") +
      `</div>` +
      `</div>` +
      `<p class="sct-mu-leader-stat">` +
      `<span class="sct-mu-leader-value">${escapeHtml(leader.value)}</span>` +
      `<span class="sct-mu-leader-unit">${escapeHtml(leader.unit)}</span>` +
      `</p>` +
      // The fantasy card puts the position here, so it is not always a stat
      // line — hence no leading separator baked into the markup.
      (leader.line
        ? `<p class="sct-mu-leader-line">${escapeHtml(leader.line)}</p>`
        : "") +
      `</li>`
    );
  };

  const cards =
    card("Passing", leaders.passing) +
    card("Rushing", leaders.rushing) +
    card("Receiving", leaders.receiving) +
    card("Fantasy", leaders.fantasy);
  if (!cards) return "";

  return (
    `<section class="sct-block sct-mu-leaders">` +
    h2("Game Leaders") +
    `<ul class="sct-mu-leader-grid">${cards}</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------ how it was won */

/** One comparison row of the glance: a label, two figures, two bars. */
interface GlanceRow {
  label: string;
  description: string;
  away: number | null;
  home: number | null;
  /** How each figure prints. */
  format: (value: number) => string;
  /**
   * Which end of this metric is the good one.
   *
   * It decides both the highlight and the bar, and it has to, because a bar
   * drawn straight from the raw number says the wrong thing on a row like
   * turnovers: three against none fills the bar of the side that threw them
   * away, and a longer bar everywhere else on this table means the side that
   * did better. `lower` inverts the bar so length always means the same thing.
   * `neutral` is for a metric with no better end at all — sixty-seven plays is
   * more plays, not a better game — where a highlight would be a verdict the
   * number does not support.
   */
  better: "higher" | "lower" | "neutral";
}

function glanceRows(away: BoxTeamStats, home: BoxTeamStats): GlanceRow[] {
  const whole = (value: number): string => String(Math.round(value));
  const tenth = (value: number): string => value.toFixed(1);
  const pct = (value: number): string => `${Math.round(value)}%`;
  return [
    {
      label: "Total Yards",
      description: "Total net yards gained",
      away: away.totalYards,
      home: home.totalYards,
      format: whole,
      better: "higher",
    },
    {
      label: "Yards / Play",
      description: "Net yards gained per offensive play",
      away: away.yardsPerPlay,
      home: home.yardsPerPlay,
      format: tenth,
      better: "higher",
    },
    {
      label: "Plays",
      description: "Offensive plays run",
      away: away.plays,
      home: home.plays,
      format: whole,
      better: "neutral",
    },
    {
      label: "Turnovers",
      description: "Giveaways",
      away: away.turnovers,
      home: home.turnovers,
      format: whole,
      better: "lower",
    },
    {
      label: "Third Down",
      description: "Third-down conversion rate",
      away: away.thirdDown?.percent ?? null,
      home: home.thirdDown?.percent ?? null,
      format: pct,
      better: "higher",
    },
    {
      label: "Possession",
      description: "Time of possession",
      away: away.possessionSeconds,
      home: home.possessionSeconds,
      format: (value) => formatClock(value) ?? "",
      better: "higher",
    },
  ];
}

/**
 * One sentence saying what the numbers above add up to.
 *
 * Composed from the same rows the block just printed, and only from the gaps
 * wide enough to be worth a word — a two-play difference in volume is not
 * "controlling the game". Every clause it can produce is backed by a row
 * directly above it, and when no gap clears its threshold the sentence is
 * absent rather than hedged into meaninglessness.
 */
function glanceSentence(
  winner: NflTeam,
  loser: NflTeam,
  forWinner: BoxTeamStats,
  forLoser: BoxTeamStats,
): string {
  const gap = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : x - y;

  // Collected as nouns rather than as whole clauses, so the sentence can say
  // "won the efficiency and turnover battles" instead of repeating the verb
  // once per advantage, which is what naming them as phrases produced.
  const winnerBattles: string[] = [];
  const loserBattles: string[] = [];
  let volumeFor: NflTeam | null = null;

  const efficiency = gap(forWinner.yardsPerPlay, forLoser.yardsPerPlay);
  if (efficiency !== null && Math.abs(efficiency) >= 0.8) {
    (efficiency > 0 ? winnerBattles : loserBattles).push("efficiency");
  }

  const turnovers = gap(forLoser.turnovers, forWinner.turnovers);
  if (turnovers !== null && Math.abs(turnovers) >= 2) {
    (turnovers > 0 ? winnerBattles : loserBattles).push("turnover");
  }

  const third = gap(forWinner.thirdDown?.percent ?? null, forLoser.thirdDown?.percent ?? null);
  if (third !== null && Math.abs(third) >= 15) {
    (third > 0 ? winnerBattles : loserBattles).push("third-down");
  }

  const plays = gap(forWinner.plays, forLoser.plays);
  if (plays !== null && Math.abs(plays) >= 8) volumeFor = plays > 0 ? winner : loser;

  const list = (parts: string[]): string =>
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const clauses = (team: NflTeam, battles: string[]): string => {
    const parts: string[] = [];
    if (battles.length) {
      parts.push(`won the ${list(battles)} battle${battles.length > 1 ? "s" : ""}`);
    }
    if (volumeFor?.abbreviation === team.abbreviation) parts.push("controlled the volume");
    return parts.join(" and ");
  };

  const winnerHas = clauses(winner, winnerBattles);
  const loserHas = clauses(loser, loserBattles);

  if (winnerHas && loserHas) {
    return `The ${loser.nickname} ${loserHas}, but the ${winner.nickname} ${winnerHas}.`;
  }
  if (winnerHas) return `The ${winner.nickname} ${winnerHas}.`;
  // An em dash rather than a second "and": "won the efficiency battle and
  // controlled the volume and still lost" is one conjunction too many.
  if (loserHas) return `The ${loser.nickname} ${loserHas} — and lost anyway.`;
  return "";
}

/**
 * The game in six figures, as one comparison rather than six cards.
 *
 * Named for the result: "Why the Seahawks Won" when there was a winner, and
 * "How the Game Was Won" when it was a tie or the sides are too close to give
 * the heading to one of them. That naming is the point of the section — the
 * pregame Snapshot asked which team is better, and after the game the only
 * question left is how this one went.
 *
 * The bars are drawn from the two figures against each other rather than
 * against the league, because both numbers describe the same sixty minutes:
 * 277 yards against 285 is a real comparison, where 277 against the league's
 * distribution would be a different section.
 */
function renderGlance(data: MatchupData): string {
  const meeting = data.featured;
  const box = data.boxscore;
  if (!meeting || !box) return "";

  const awayStats = boxStatsFor(box, meeting.away);
  const homeStats = boxStatsFor(box, meeting.home);
  if (!awayStats || !homeStats) return "";

  const rows = glanceRows(awayStats, homeStats).filter(
    (row) => row.away !== null || row.home !== null,
  );
  if (rows.length === 0) return "";

  const color = matchupColors(data.pair);
  const style = styleAttr([
    `--mu-cmp-left:${color(meeting.away)}`,
    `--mu-cmp-right:${color(meeting.home)}`,
  ]);

  const cell = (
    row: GlanceRow,
    value: number | null,
    other: number | null,
    side: "a" | "b",
  ): string => {
    if (value === null) return `<span class="sct-mu-cell is-empty">—</span>`;
    // Share of the pair's total, so the two bars together fill the row — and
    // inverted on a row whose good end is the low one, so that a longer bar is
    // the better side on every row of the table. Both zero (no turnovers
    // either way) draws two half bars rather than none, which is the honest
    // picture of a dead heat.
    const total = value + (other ?? 0);
    const mine = row.better === "lower" ? (other ?? 0) : value;
    const pct = total > 0 ? Math.round((mine / total) * 100) : 50;
    const better =
      other === null || row.better === "neutral"
        ? false
        : row.better === "lower"
          ? value < other
          : value > other;
    return (
      `<span class="sct-mu-cell">` +
      `<span class="sct-mu-figure">` +
      `<span class="sct-mu-val${better ? " is-better" : ""}">${escapeHtml(row.format(value))}</span>` +
      `</span>` +
      `<span class="sct-mu-bar" data-side="${side}" aria-hidden="true">` +
      `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
      `</span>` +
      `</span>`
    );
  };

  const winner = meeting.winner;
  const loser = winner
    ? winner.abbreviation === meeting.home.abbreviation
      ? meeting.away
      : meeting.home
    : null;
  const sentence =
    winner && loser
      ? glanceSentence(
          winner,
          loser,
          winner.abbreviation === meeting.home.abbreviation ? homeStats : awayStats,
          winner.abbreviation === meeting.home.abbreviation ? awayStats : homeStats,
        )
      : "";

  const title = winner ? `Why the ${winner.nickname} Won` : "How the Game Was Played";

  return (
    `<section class="sct-block sct-mu-glance">` +
    h2(title) +
    (sentence ? `<p class="sct-mu-glance-line">${escapeHtml(sentence)}</p>` : "") +
    `<table class="sct-mu-table"${style}>` +
    compareCaption(
      meeting.away.nickname,
      "at",
      meeting.home.nickname,
      " — team statistics from this game",
    ) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(meeting.away.nickname)}</th>` +
    `<th scope="col">Statistic</th>` +
    `<th scope="col">${escapeHtml(meeting.home.nickname)}</th></tr></thead>` +
    `<tbody>` +
    rows
      .map(
        (row) =>
          `<tr>` +
          `<td class="sct-mu-td-side">${cell(row, row.away, row.home, "a")}</td>` +
          `<th scope="row" class="sct-mu-td-label">${escapeHtml(row.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></th>` +
          `<td class="sct-mu-td-side">${cell(row, row.home, row.away, "b")}</td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ player stats */

/** The team code a stat row belongs to, as a chip. */
function statTeam(team: NflTeam | null): string {
  return team
    ? `<span class="sct-mu-ps-team">${escapeHtml(team.code.toUpperCase())}</span>`
    : "";
}

/** The name cell every stat table shares: face, link, position. */
function statName(row: { player: { id: string; name: string }; team: NflTeam | null; position: string | null }): string {
  // The flex box is an inner span, not the cell. `display:flex` on a <th>
  // takes it out of table layout altogether, which left the name column a
  // different width from its own header and broke every row rule under it.
  //
  // `data-sort` is the name alone. The cell's text is the name, the position
  // and the team code run together, so sorting on what is written here would
  // sort "Drew LockQB · SEA" — right by accident for a name that leads the
  // cell, and wrong the moment the cell's order changes.
  return (
    `<th scope="row" class="sct-mu-ps-name" data-sort="${escapeHtml(row.player.name)}">` +
    `<span class="sct-mu-ps-cell">` +
    playerPhoto(row.player.id, "sct-mu-ps-photo", 32) +
    `<span class="sct-mu-ps-who">` +
    playerName(row.player.name, "sct-mu-ps-link") +
    positionTag(row.position, row.team?.code, "sct-mu-ps-meta") +
    `</span>` +
    `</span>` +
    `</th>`
  );
}

/**
 * One column of a stat table.
 *
 * `type` is declared by the header rather than sniffed from the cells, which is
 * the contract the FPA table's sorting already uses: the client does not have
 * to guess whether a column of "16/22" is a number, and a column that happens
 * to hold only digits this week cannot change type next week.
 *
 * `sorted` marks the column the SERVER has already ordered the rows by, so the
 * table arrives with its sort state announced rather than claiming to be
 * unsorted while visibly sorted.
 */
interface StatColumn {
  label: string;
  type: "number" | "text";
  sorted?: boolean;
}

/** A numeric column, which is all of them but the name. */
function col(label: string, sorted = false): StatColumn {
  return sorted ? { label, type: "number", sorted } : { label, type: "number" };
}

/**
 * One stat table: a caption, a header row, and the rows a caller built.
 *
 * `data-sct-sortable` is the opt-in the client bundle looks for. The header
 * cells are plain text here and the buttons are built in the browser — a
 * control that cannot work must not be in the HTML, which is the rule the game
 * log on the player pages follows for the same reason.
 */
function statTable(
  title: string | null,
  label: string,
  columns: StatColumn[],
  rows: string[],
): string {
  if (rows.length === 0) return "";
  const header = (column: StatColumn): string =>
    `<th scope="col" data-sort-type="${column.type}"` +
    (column.sorted ? ` data-sort-default="descending"` : "") +
    `>${escapeHtml(column.label)}</th>`;
  return (
    `<div class="sct-mu-ps-block">` +
    (title ? `<h3 class="sct-mu-h3">${escapeHtml(title)}</h3>` : "") +
    `<div class="sct-mu-ps-scroll">` +
    `<table class="sct-mu-ps-table" data-sct-sortable>` +
    `<caption class="sct-visually-hidden">${escapeHtml(label)}</caption>` +
    `<thead><tr>` +
    header({ label: "Player", type: "text" }) +
    columns.map(header).join("") +
    `</tr></thead>` +
    `<tbody>${rows.join("")}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

/**
 * One cell: what it shows, and what it sorts on.
 *
 * The two are separate because they disagree more often than not — "16/22" is
 * two numbers, "90%" is a string, "WR6" is a position and a rank, and "—" is
 * nothing at all. `sort` is null for that last case and the attribute is
 * emitted empty, which is what tells the client to sink the row rather than
 * treat the missing value as a zero and rank it above a real one.
 */
function statCell(
  display: string | number,
  sort: number | null,
  className = "",
): string {
  return (
    `<td${className ? ` class="${className}"` : ""}` +
    ` data-sort="${sort === null ? "" : escapeHtml(String(sort))}">` +
    `${escapeHtml(String(display))}</td>`
  );
}

/**
 * The box score, by category, both teams in one table.
 *
 * "eagles vs commanders match player stats" is a search this page was not built
 * to answer and now is. One table per category rather than one per team: the
 * reader is comparing the two quarterbacks, not reading two rosters, and a
 * category with nobody in it — a game with no completed pass — is absent rather
 * than empty.
 *
 * The Fantasy table is the one nobody else prints. PPR, half and standard are
 * the three scorings this site's readers actually play, and the positional
 * finish is what turns 26.2 points into "the WR3 of the week", which is the
 * number a manager is really asking for.
 */
function renderPlayerStats(data: MatchupData): string {
  const stats: GameStats | null = data.gameStats;
  if (!stats) return "";

  const passing = stats.passing.map(
    (row: PassingRow) =>
      `<tr>` +
      statName(row) +
      // Sorted on completions: the column reads "C/ATT" and C is the number it
      // leads with, so ordering by anything else would order it by a figure
      // the eye is not on.
      statCell(`${row.completions}/${row.attempts}`, row.completions) +
      statCell(row.yards, row.yards, "is-key") +
      statCell(row.touchdowns, row.touchdowns) +
      statCell(row.interceptions, row.interceptions) +
      statCell(row.rating === null ? "—" : row.rating.toFixed(1), row.rating) +
      `</tr>`,
  );

  const rushing = stats.rushing.map(
    (row: RushingRow) =>
      `<tr>` +
      statName(row) +
      statCell(row.carries, row.carries) +
      statCell(row.yards, row.yards, "is-key") +
      statCell(row.average.toFixed(1), row.average) +
      statCell(row.touchdowns, row.touchdowns) +
      `</tr>`,
  );

  const receiving = stats.receiving.map(
    (row: ReceivingRow) =>
      `<tr>` +
      statName(row) +
      statCell(row.receptions, row.receptions) +
      statCell(row.targets, row.targets) +
      statCell(row.yards, row.yards, "is-key") +
      statCell(row.average.toFixed(1), row.average) +
      statCell(row.touchdowns, row.touchdowns) +
      `</tr>`,
  );

  const fantasy = stats.fantasy.map(
    (row: FantasyRow) =>
      `<tr>` +
      statName(row) +
      statCell(row.ppr.toFixed(1), row.ppr, "is-key") +
      statCell(row.half.toFixed(1), row.half) +
      statCell(row.standard.toFixed(1), row.standard) +
      // A finish sorts on the rank alone, so WR6 and RB17 order against each
      // other as 6 and 17 — best week at the position first. A player with no
      // finish has no value rather than a zero, or he would lead the column.
      statCell(
        row.positionFinish !== null && row.position
          ? `${row.position}${row.positionFinish}`
          : "—",
        row.positionFinish,
      ) +
      `</tr>`,
  );

  // Two columns: passing over rushing on the left, receiving beside them.
  //
  // Stacked, these four tables ran to most of a screen each and the reader
  // scrolled past three of them to reach the one they wanted. Side by side they
  // are one object — and the pairing is not arbitrary: passing and rushing are
  // the two SHORT tables (three quarterbacks, seven backs) and receiving is the
  // long one, so stacking the short pair against the long one is what makes the
  // two columns come out roughly level instead of leaving half a screen of
  // white space under a three-row table.
  //
  // Fantasy stays out of the row on purpose. It is the table nobody else
  // prints — three scorings and a positional finish — and it is the one a
  // reader comes to this page FOR, so it gets the width rather than half of it.
  const passingBlock =
    statTable("Passing", "Passing statistics", [
      col("C/ATT"),
      col("YDS", true),
      col("TD"),
      col("INT"),
      col("RATE"),
    ], passing);

  const rushingBlock =
    statTable("Rushing", "Rushing statistics", [
      col("CAR"),
      col("YDS", true),
      col("AVG"),
      col("TD"),
    ], rushing);

  const receivingBlock =
    statTable("Receiving", "Receiving statistics", [
      col("REC"),
      col("TGT"),
      col("YDS", true),
      col("AVG"),
      col("TD"),
    ], receiving);

  const fantasyBlock = statTable("Fantasy", "Fantasy statistics", [
    col("PPR", true),
    col("HALF"),
    col("STD"),
    col("FINISH"),
  ], fantasy);

  // The left column is a column even when it holds one table, so the grid always
  // has the same two children and the row cannot silently become "receiving,
  // then passing" in a game with no rushing attempts.
  const stack = passingBlock + rushingBlock;
  const board =
    (stack ? `<div class="sct-mu-ps-stack">${stack}</div>` : "") + receivingBlock;
  if (!board && !fantasyBlock) return "";
  const blocks = (board ? `<div class="sct-mu-ps-row">${board}</div>` : "") + fantasyBlock;

  return (
    `<section class="sct-block sct-mu-playerstats">` +
    h2("Player Stats") +
    blocks +
    `<p class="sct-note">${escapeHtml(
      "Finish is where that PPR score ranked among the league's players at the " +
        "position in this week. Half and standard follow from the reception count.",
    )}</p>` +
    `</section>`
  );
}

/* -------------------------------------------------------------- takeaways */

/** The glyph a takeaway leads with, and what it is called out loud. */
const TAKEAWAY_MARK: Record<Takeaway["direction"], { glyph: string; word: string }> = {
  up: { glyph: "&uarr;", word: "Role up" },
  down: { glyph: "&darr;", word: "Role down" },
  watch: { glyph: "&#9888;", word: "Watch" },
};

/**
 * What to take away from the game, for next week's lineup.
 *
 * Every card is measured. The comparison is always against the same player's
 * own earlier weeks — "up from 38%" is a fact about the logs — and never
 * against an expectation this server does not hold. A player in his first
 * logged game of the season has no baseline and is described rather than
 * compared; the copy says so rather than quietly comparing him with zero.
 *
 * This is the section that makes the page StatChasers' rather than a box score:
 * the tables above say what happened, and these six cards say which parts of it
 * are worth carrying into the next lineup decision.
 */
function renderTakeaways(data: MatchupData): string {
  const takeaways = data.gameStats?.takeaways ?? [];
  if (takeaways.length === 0) return "";

  const card = (item: Takeaway): string => {
    const mark = TAKEAWAY_MARK[item.direction];
    return (
      `<li class="sct-mu-take" data-direction="${item.direction}">` +
      `<p class="sct-mu-take-head">` +
      `<span class="sct-mu-take-mark" aria-hidden="true">${mark.glyph}</span>` +
      `<span class="sct-visually-hidden">${escapeHtml(`${mark.word}: `)}</span>` +
      playerName(item.player.name, "sct-mu-take-name") +
      positionTag(item.position, item.team?.code, "sct-mu-take-tag") +
      `</p>` +
      `<p class="sct-mu-take-line">${escapeHtml(item.headline)}</p>` +
      (item.facts.length
        ? `<p class="sct-mu-take-facts">${item.facts.map((fact) => escapeHtml(fact)).join(` <span class="sct-injury-dot">·</span> `)}</p>`
        : "") +
      `<p class="sct-mu-take-body">${escapeHtml(item.body)}</p>` +
      `</li>`
    );
  };

  return (
    `<section class="sct-block sct-mu-takeaways">` +
    h2("Fantasy Takeaways") +
    `<ul class="sct-mu-take-grid">${takeaways.map(card).join("")}</ul>` +
    `<p class="sct-note">${escapeHtml(
      "Each note compares a player with his own season to date, from the weekly " +
        "logs. Routes run are not published by any free source, so they are not here.",
    )}</p>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ fantasy usage */

/** A share as this section writes it: "85%". Null has no percentage at all. */
function usagePercent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** The ring's geometry, in the user units of its own 120-square viewBox. */
const USAGE_RING_RADIUS = 42;
const USAGE_RING_LENGTH = 2 * Math.PI * USAGE_RING_RADIUS;
/** The hairline of white between two neighbouring slices. */
const USAGE_SLICE_GAP = 2;

/** The pooled tail. Grey on purpose: "Other" is not a player and must not read as one. */
const USAGE_INK_OTHER = "#c2c8d2";

/**
 * One team's ink, a step lighter per slice.
 *
 * Six unrelated saturated colours in a 90px ring is a pie chart from a
 * spreadsheet. The slices of one team are one hue instead, separated by
 * lightness, and the legend beside them carries the name and the percentage —
 * so the colour is what groups the ring to its team, not what carries the
 * meaning. Nothing here is legible only in colour.
 *
 * A pale ink — Green Bay's yellow, Cincinnati's orange — is darkened toward the
 * page's navy before the ramp starts, because five steps lighter than #FFB612
 * is five steps of white on white.
 */
function usageRamp(base: string, count: number): string[] {
  const start = luminance(base) > 0.6 ? mixHex(base, "#0b1f33", 0.45) : base;
  return Array.from({ length: Math.max(count, 1) }, (_, i) =>
    mixHex(start, "#ffffff", Math.min(i * 0.15, 0.6)),
  );
}

/** The three lines a slice's hover tooltip carries. Supplemental, never the source. */
function usageTip(slice: UsageSlice, unit: string, metric: string): string {
  return (
    `${slice.label}\n` +
    `${slice.value} ${unit}\n` +
    `${Math.round(slice.share * 100)}% ${metric}`
  );
}

/** What each ring is called, counts, and says when it has nothing to draw. */
const USAGE_RINGS: ReadonlyArray<{
  key: "targets" | "carries";
  total: "targetTotal" | "carryTotal";
  heading: string;
  unit: string;
  metric: string;
  unavailable: string;
}> = [
  {
    key: "targets",
    total: "targetTotal",
    heading: "Target Share",
    unit: "targets",
    metric: "target share",
    unavailable: "Target share data unavailable",
  },
  {
    key: "carries",
    total: "carryTotal",
    heading: "Carry Share",
    unit: "carries",
    metric: "carry share",
    unavailable: "Carry share data unavailable",
  },
];

/**
 * One part-to-whole distribution: a ring, and the legend that says what it means.
 *
 * The ring is drawn as one dashed circle per slice — no chart library, no
 * canvas, no dependency — and it is `aria-hidden` because everything in it is
 * written out in the list beside it: the name, the percentage, and the raw
 * count in the span a screen reader reads and a sighted reader does not need.
 * The tooltips are the same three facts again, for a mouse.
 *
 * A zero denominator draws nothing. There is no such thing as a share of no
 * carries, and an empty ring would be a claim that there is.
 */
function usageRing(
  team: TeamUsage,
  spec: (typeof USAGE_RINGS)[number],
  ink: string,
): string {
  const total = team[spec.total];
  const slices = team[spec.key];
  const head =
    `<h4 class="sct-mu-usage-metric-h">${escapeHtml(spec.heading)}` +
    (total > 0
      ? `<span class="sct-mu-usage-denom">${total} ${escapeHtml(spec.unit)}</span>`
      : "") +
    `</h4>`;

  if (total <= 0 || slices.length === 0) {
    return (
      `<div class="sct-mu-usage-metric">${head}` +
      `<p class="sct-mu-usage-none">${escapeHtml(spec.unavailable)}</p>` +
      `</div>`
    );
  }

  const ramp = usageRamp(ink, slices.filter((slice) => slice.player).length);
  // The named slices are already highest-first and "Other" is already last, so
  // the ramp index is the slice index and the ring reads light-ward clockwise.
  const inked = slices.map((slice, i) => ({
    slice,
    tone: slice.player ? (ramp[i] ?? USAGE_INK_OTHER) : USAGE_INK_OTHER,
  }));

  let start = 0;
  const arcs = inked.map(({ slice, tone }) => {
    const length = slice.share * USAGE_RING_LENGTH;
    // The gap is taken off the drawn length, not added between arcs, so the
    // slices still sum to the circle. A ring with one slice in it keeps its
    // full length — a gap there looks like a broken circle, not a division.
    const drawn =
      inked.length > 1 ? Math.max(length - USAGE_SLICE_GAP, 0.75) : length;
    const offset = start;
    start += length;
    return (
      `<circle class="sct-mu-usage-arc" cx="60" cy="60" r="${USAGE_RING_RADIUS}"` +
      ` stroke="${escapeHtml(tone)}"` +
      ` stroke-dasharray="${drawn.toFixed(2)} ${(USAGE_RING_LENGTH - drawn).toFixed(2)}"` +
      ` stroke-dashoffset="${(-offset).toFixed(2)}">` +
      `<title>${escapeHtml(usageTip(slice, spec.unit, spec.metric))}</title>` +
      `</circle>`
    );
  });

  const legend = inked.map(({ slice, tone }) => {
    const name = slice.player
      ? playerName(slice.label, "sct-mu-usage-key-name")
      : `<span class="sct-mu-usage-key-name is-other">${escapeHtml(slice.label)}</span>`;
    return (
      `<li class="sct-mu-usage-key">` +
      `<span class="sct-mu-usage-swatch" aria-hidden="true"${styleAttr([`background:${tone}`])}></span>` +
      name +
      `<span class="sct-mu-usage-key-pct">${usagePercent(slice.share)}</span>` +
      `<span class="sct-visually-hidden">, ${slice.value} ${escapeHtml(spec.unit)}</span>` +
      `</li>`
    );
  });

  return (
    `<div class="sct-mu-usage-metric">${head}` +
    `<div class="sct-mu-usage-ring-row">` +
    `<svg class="sct-mu-usage-ring" viewBox="0 0 120 120" width="96" height="96"` +
    ` aria-hidden="true" focusable="false">` +
    `<g transform="rotate(-90 60 60)">${arcs.join("")}</g>` +
    `</svg>` +
    `<ol class="sct-mu-usage-keys">${legend.join("")}</ol>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Snap share, as a ranked list rather than a ring.
 *
 * Snap percentages are not a distribution — five players can each be on the
 * field for 80% of the same snaps — so a pie of them would be arithmetic
 * nonsense. Ranked bars are the honest shape: the comparison is player against
 * player, and the eye does that down a column of left-aligned bars better than
 * around a circle.
 */
function usageBars(team: TeamUsage): string {
  if (team.snaps.length === 0) return "";
  const rows = team.snaps.map((row) => {
    const share = row.snapShare;
    const tip = `${row.player.name}\n${row.snaps} snaps\n${usagePercent(share)} snap share`;
    return (
      `<li class="sct-mu-usage-bar" title="${escapeHtml(tip)}">` +
      playerPhoto(row.player.id, "sct-mu-usage-face", 30) +
      `<span class="sct-mu-usage-bar-body">` +
      `<span class="sct-mu-usage-bar-head">` +
      playerName(row.player.name, "sct-mu-usage-bar-name") +
      // No team code: the player is already inside his own team's panel.
      positionTag(row.position, null, "sct-mu-usage-bar-meta") +
      `<span class="sct-mu-usage-bar-pct">${usagePercent(share)}</span>` +
      `</span>` +
      `<span class="sct-mu-usage-track" aria-hidden="true">` +
      `<span class="sct-mu-usage-fill"${styleAttr([
        `width:${Math.round((share ?? 0) * 100)}%`,
      ])}></span>` +
      `</span>` +
      `<span class="sct-mu-usage-bar-raw">${row.snaps} snaps</span>` +
      `</span>` +
      `</li>`
    );
  });
  return (
    `<div class="sct-mu-usage-metric">` +
    `<h4 class="sct-mu-usage-metric-h">Snap Share</h4>` +
    `<ol class="sct-mu-usage-bars">${rows.join("")}</ol>` +
    `</div>`
  );
}

/**
 * One team's panel: the badge, the bars, and the two rings under them.
 *
 * Both panels are built from the same function in the same order, which is the
 * whole point of splitting the section by team — Target Share is in the same
 * place on the right as it is on the left, so the two are compared by looking
 * across rather than by reading twice.
 */
function usagePanel(team: TeamUsage, ink: string): string {
  const bars = usageBars(team);
  const rings = USAGE_RINGS.map((spec) => usageRing(team, spec, ink));
  // A team with no snaps in the log and nothing to distribute has no panel.
  // The rings above return their own "unavailable" line, so this asks the data
  // rather than the markup.
  if (!bars && team.targetTotal <= 0 && team.carryTotal <= 0) return "";

  const name = team.team;
  return (
    `<article class="sct-mu-usage-team"${styleAttr([`--mu-usage-ink:${ink}`])}>` +
    (name
      ? `<h3 class="sct-mu-usage-team-name">` +
        `<img class="sct-mu-usage-logo" src="${escapeHtml(name.logo)}" alt=""` +
        ` width="28" height="28" loading="lazy" decoding="async" />` +
        `${escapeHtml(name.fullName)}</h3>`
      : "") +
    bars +
    `<div class="sct-mu-usage-rings">${rings.join("")}</div>` +
    `</article>`
  );
}

/**
 * Who controlled the snaps, the targets and the backfield, for each side.
 *
 * Snaps and share are the half of a fantasy day the box score misses: a
 * receiver who was on the field for 82% of the dropbacks and caught two passes
 * had a better day for next week than the one who caught two on a third of the
 * snaps. That was a six-column table on a page that already has five of them,
 * and a table is a poor answer to a question about proportion — so the default
 * layer is now two team panels of pictures, and the table it was built from is
 * one click underneath, unchanged and still sortable.
 *
 * The visual layer and the table disagree about quarterbacks on purpose. The
 * table is about snap counts, where a starting quarterback's row says 100%
 * every week and is worth no space; a carry distribution that leaves him out is
 * simply wrong. See usageByTeam() in game-stats.ts, which is where both
 * populations are decided — the page does not recalculate a share here.
 */
function renderUsage(data: MatchupData): string {
  const usage = data.gameStats?.usage ?? [];
  if (usage.length === 0) return "";

  const rows = usage.map(
    (row: UsageRow) =>
      `<tr>` +
      statName(row) +
      statCell(row.snaps, row.snaps) +
      // The share sorts on the fraction, not on the rounded percent it prints,
      // so two rows that both read 46% still order against each other.
      statCell(usagePercent(row.snapShare), row.snapShare, "is-key") +
      statCell(row.targets, row.targets) +
      statCell(usagePercent(row.targetShare), row.targetShare) +
      statCell(row.carries, row.carries) +
      `</tr>`,
  );

  const table = statTable(
    null,
    "Offensive snaps and share for the skill positions",
    [col("SNAPS"), col("SNAP %", true), col("TGT"), col("TGT %"), col("CAR")],
    rows,
  );

  // One colour per team for the whole page, the same resolution the Snapshot
  // and the Fantasy Matchups table use, so a reader learns the pair's two inks
  // once and carries them down.
  const color = matchupColors(data.pair);

  // Pair order, not log order. usageByTeam() hands these back in the order the
  // appearance list met the two teams, which is whoever the feed listed first
  // and has nothing to do with the order this page reads in — on a page whose
  // hero, linescore and every comparison table put pair.a on the left, that put
  // the two panels the other way round from everything above them. The panels
  // are the one place on the page where the sides were not the pair's own
  // order, so the order is resolved here, where the pair is known.
  const order = new Map([
    [data.pair.a.abbreviation, 0],
    [data.pair.b.abbreviation, 1],
  ]);
  // A team the pair does not name cannot be placed against it, so it keeps the
  // position it arrived in rather than being sorted to the front.
  const place = (team: TeamUsage): number => order.get(team.team?.abbreviation ?? "") ?? 2;

  const panels = [...(data.gameStats?.usageByTeam ?? [])]
    .sort((left, right) => place(left) - place(right))
    .map((team) => usagePanel(team, team.team ? color(team.team) : "#0b1f33"))
    .filter((panel) => panel !== "");

  // Nothing to draw — a log with snaps but no team attribution — leaves the
  // table as the section, open, exactly as it was before the panels existed.
  if (panels.length === 0) {
    return `<section class="sct-block sct-mu-usage">` + h2("Fantasy Usage") + table + `</section>`;
  }

  return (
    `<section class="sct-block sct-mu-usage">` +
    h2("Fantasy Usage") +
    `<p class="sct-mu-usage-sub">` +
    escapeHtml("How each offense distributed snaps, targets and carries.") +
    `</p>` +
    `<div class="sct-mu-usage-teams">${panels.join("")}</div>` +
    `<p class="sct-mu-usage-note">` +
    escapeHtml(
      "Shares are based on official game usage totals. Snap share covers the skill positions.",
    ) +
    `</p>` +
    // <details> rather than a script: the table is in the HTML either way, so
    // it is one copy, it is indexed, and it opens with JavaScript switched off.
    (table
      ? `<details class="sct-mu-usage-full">` +
        `<summary class="sct-mu-usage-toggle">` +
        `<span class="sct-mu-usage-toggle-more">View full usage table</span>` +
        `<span class="sct-mu-usage-toggle-less">Hide full usage table</span>` +
        `</summary>` +
        table +
        `</details>`
      : "") +
    `</section>`
  );
}

/* ------------------------------------------------------- where to watch */

/**
 * Only for an upcoming meeting, and only the fields the schedule actually
 * carries. Streaming is not one of them — ESPN's schedule names a broadcaster,
 * not a service — so there is no streaming line rather than a guessed one.
 */
function renderWatch(data: MatchupData): string {
  if (data.matchupState !== "upcoming" || !data.featured) return "";
  const meeting = data.featured;
  const when = gameDateLine(asGame(meeting));

  const rows: Array<[string, string]> = [];
  if (meeting.kickoffMs !== null) rows.push(["Date", escapeHtml(when.date)]);
  // No " ET" appended: easternParts() already spells the zone into the time,
  // and the row was reading "1:00 PM ET ET" — the same slip the hero's
  // metadata line carries a note about. "Time TBD" is not a time to qualify
  // either, which appending would have done.
  if (when.time) rows.push(["Kickoff", escapeHtml(when.time)]);
  if (meeting.network) rows.push(["TV", networkHtml(meeting.network, "sct-mu-tv")]);
  if (meeting.venue) {
    rows.push([
      "Venue",
      escapeHtml(meeting.venueCity ? `${meeting.venue} · ${meeting.venueCity}` : meeting.venue),
    ]);
  }
  if (rows.length === 0) return "";

  return (
    `<section class="sct-block sct-mu-watch">` +
    h2(`Where to Watch ${data.pair.a.nickname} vs ${data.pair.b.nickname}`) +
    // The symbol the TV row's <use> points at. It used to be defined by the
    // featured card above, which no longer draws on a fixture page — a logo
    // whose symbol is nowhere on the page renders as an empty box.
    (meeting.network ? networkDefs([meeting.network]) : "") +
    `<dl class="sct-mu-facts">` +
    rows
      .map(
        ([label, value]) =>
          `<div class="sct-mu-fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`,
      )
      .join("") +
    `</dl>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- snapshot */

/**
 * The Snapshot's rows: one team down each side, the metric between them.
 *
 * This used to be three tables — both offences, then each offence against the
 * other defence — which printed the same nine figures twice under captions a
 * reader had to parse ("Patriots offense vs Seahawks defense") before any of
 * the numbers meant anything. One team per column says the same thing in a
 * sixth of the space: the left column IS the Patriots, all the way down.
 *
 * Both halves of the ladder are here rather than only the offensive one,
 * because "scores 24, allows 17" is the shape of a team and two offence rows
 * alone are half a scouting report. The labels are written out here instead of
 * taken from the metric: the Stats tab calls both rows "Points/G" and relies on
 * an Offense/Defense heading above them, which this table does not have.
 *
 * Keys are the Stats tab's. A row absent on both sides is skipped.
 */
const SNAPSHOT_ROWS: ReadonlyArray<{ key: string; label: string; description: string }> = [
  { key: "record", label: "Record", description: "Win-loss record this season" },
  { key: "off-points", label: "Pts/G", description: "Points scored per game" },
  { key: "off-total-yards", label: "Yds/G", description: "Total net yards gained per game" },
  { key: "off-yards-per-play", label: "Yds/Play", description: "Net yards gained per offensive play" },
  { key: "def-points", label: "Pts/G Allowed", description: "Points allowed per game" },
  { key: "def-total-yards", label: "Yds/G Allowed", description: "Total net yards allowed per game" },
];

/**
 * The record as a row of the table.
 *
 * Not a ranked metric and not pretending to be: no rank chip, no bar, and
 * `volume` so the renderer gives it no tier colour either. It leads the table
 * because it is the first thing anyone wants from two team names.
 */
function recordRow(side: TeamPageData): StatRow | null {
  const value = side.profile?.record;
  if (!value) return null;
  return {
    key: "record",
    label: "Record",
    description: "Win-loss record this season",
    value,
    rank: null,
    cumulative: true,
    rankLabel: null,
    previousRank: null,
    direction: "volume",
  };
}

function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((cell) => cell.key === key);
    if (row) return row;
  }
  return null;
}

/**
 * How full this side's bar is: 1st fills it, 32nd barely registers.
 *
 * Rank rather than the raw figure, because the raw figures are not comparable.
 * Two of these rows put an offence beside a defence, where 20 points scored and
 * 20 allowed are the same number meaning opposite things, and a bar drawn from
 * the values would show the better defence as the shorter bar. Rank already has
 * the direction folded in — 1st is the best of the thirty-two either way — so a
 * bar drawn from it reads the same on every row.
 *
 * Null for a metric nobody ranked, and for a `volume` one: pace has no better
 * end, and a bar is a claim that it does.
 */
function barPercent(row: StatRow | null): number | null {
  if (!row || row.direction === "volume" || row.rank === null) return null;
  const rank = Math.min(Math.max(row.rank, 1), 32);
  // 1st -> 100%, 32nd -> ~9%. Floored above zero so last place is still a mark
  // on the page rather than an empty slot that reads as missing data.
  return Math.round(((33 - rank) / 32) * 100);
}

function cell(row: StatRow | null, side: "a" | "b"): string {
  if (!row) return `<span class="sct-mu-cell is-empty">—</span>`;
  const tier = row.direction === "volume" ? "none" : rankTier(row.rank);
  const pct = barPercent(row);
  return (
    `<span class="sct-mu-cell">` +
    `<span class="sct-mu-figure">` +
    `<span class="sct-mu-val">${escapeHtml(row.value)}</span>` +
    (row.rankLabel
      ? `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(row.rankLabel)}` +
        `<span class="sct-visually-hidden"> of 32${tier !== "none" ? ` — ${escapeHtml(TIER_WORD[tier] ?? "")}` : ""}</span></span>`
      : "") +
    `</span>` +
    // Decorative: the rank beside it is the same fact in words, and a screen
    // reader reading "83 percent" for a 6th-place defence would be inventing a
    // number the page never claims.
    (pct === null
      ? ""
      : `<span class="sct-mu-bar" data-side="${side}" aria-hidden="true">` +
        `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
        `</span>`) +
    `</span>`
  );
}

/* ----------------------------------------------------------------- colour */

/** A hex colour as three channels. Anything unparseable reads as black. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  const n = Number.parseInt(
    clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean.slice(0, 6),
    16,
  );
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/** `from` moved `amount` of the way toward `to`, back as a hex string. */
function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (i: number): string =>
    Math.round(a[i]! + (b[i]! - a[i]!) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Rough relative luminance — enough to ask "is this ink too pale for white". */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Two colours a reader can tell apart, for the two sides of a comparison.
 *
 * Several pairings share a primary. The Patriots and the Seahawks are both
 * #002244, and the Raiders, Saints and Steelers all wear the same near-black,
 * so a bar keyed straight to `primaryColor` would draw both sides of those
 * pages in one colour and the comparison would lose the only thing the colour
 * was there to carry.
 *
 * The right-hand side falls back to its own accent, which is the colour that
 * actually distinguishes it — Seattle's green against New England's navy, which
 * is the pair a reader expects anyway — and to a neutral grey in the case where
 * that clashes too, rather than to a third team's colour.
 *
 * Compared with a small distance rather than for equality: #101820 and #0B162A
 * are not the same value and are the same colour to the eye.
 */
function pairColors(a: NflTeam, b: NflTeam): [string, string] {
  const tooClose = (x: string, y: string): boolean => {
    const [r1, g1, b1] = hexToRgb(x);
    const [r2, g2, b2] = hexToRgb(y);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 60;
  };
  if (!tooClose(a.primaryColor, b.primaryColor)) {
    return [a.primaryColor, b.primaryColor];
  }
  if (!tooClose(a.primaryColor, b.secondaryColor)) {
    return [a.primaryColor, b.secondaryColor];
  }
  return [a.primaryColor, "#7a8699"];
}

/**
 * One colour per team, fixed for the whole page.
 *
 * Resolved from the pair once rather than per table. Deciding the colours
 * inside each table made Seattle green in one and navy in the next — the reader
 * has to be able to learn a colour once and carry it down the page, past the
 * Snapshot and into the Fantasy Matchups table under it.
 */
function matchupColors(pair: MatchupData["pair"]): (team: NflTeam) => string {
  const [colorA, colorB] = pairColors(pair.a, pair.b);
  return (team) => (team.abbreviation === pair.b.abbreviation ? colorB : colorA);
}

/**
 * One comparison: two sides, the same metrics, side by side.
 *
 * The pairing is named once, in the caption, and the column headers that would
 * repeat it on every row are visually hidden. They stay in the markup because a
 * screen reader moving cell by cell still needs to hear which side it is on —
 * what came off the page is the repetition, not the information.
 *
 * `left.team`/`right.team` colour the bars and follow the TEAM rather than the
 * column. The Snapshot puts one team in each column so the two agree there, but
 * the Fantasy block below compares the two defences and reuses this, so the
 * colour has to be resolved from the team either way.
 */
function compareTable(
  caption: string,
  left: { team: NflTeam; name: string },
  right: { team: NflTeam; name: string },
  rows: Array<{ label: string; description: string; left: StatRow | null; right: StatRow | null }>,
  color: (team: NflTeam) => string,
): string {
  const kept = rows.filter((row) => row.left || row.right);
  if (kept.length === 0) return "";
  const style = styleAttr([
    `--mu-cmp-left:${color(left.team)}`,
    `--mu-cmp-right:${color(right.team)}`,
  ]);
  return (
    `<table class="sct-mu-table"${style}>` +
    compareCaption(left.name, "vs", right.name, ` — ${caption}`) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(left.name)}</th>` +
    `<th scope="col">Metric</th>` +
    `<th scope="col">${escapeHtml(right.name)}</th></tr></thead>` +
    `<tbody>` +
    kept
      .map(
        (row) =>
          `<tr>` +
          `<td class="sct-mu-td-side">${cell(row.left, "a")}</td>` +
          `<th scope="row" class="sct-mu-td-label">${escapeHtml(row.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></th>` +
          `<td class="sct-mu-td-side">${cell(row.right, "b")}</td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`
  );
}

/**
 * The season comparison.
 *
 * Before the game this is the Matchup Snapshot and it leads the analysis: two
 * teams, the same six metrics, which one is better. After the game it is still
 * true and no longer the question — the result above answered that for these
 * sixty minutes — so it keeps the numbers, takes the name "Season Form", and
 * sits below the game itself. The heading moves; the table does not, because a
 * postgame reader who scrolls this far is asking the pregame question again
 * about next time.
 */
function renderSnapshot(data: MatchupData): string {
  if (!describesNow(data)) return "";
  const { a, b } = data.pair;
  const sa = data.a.stats;
  const sb = data.b.stats;
  if (!sa && !sb) return "";

  // One colour per team for the whole page, so a reader learns it once.
  const color = matchupColors(data.pair);

  const body = compareTable(
    `${a.nickname} compared with ${b.nickname}`,
    { team: a, name: a.nickname },
    { team: b, name: b.nickname },
    SNAPSHOT_ROWS.map(({ key, label, description }) =>
      key === "record"
        ? { label, description, left: recordRow(data.a), right: recordRow(data.b) }
        : { label, description, left: findRow(sa, key), right: findRow(sb, key) },
    ),
    color,
  );

  const season = sa?.season ?? sb?.season ?? data.state.statsSeason;
  const games = [sa?.gamesPlayed, sb?.gamesPlayed].filter((n): n is number => typeof n === "number");
  const played = games.length ? Math.min(...games) : 0;
  const spread = games.length === 2 && games[0] !== games[1] ? `–${Math.max(...games)}` : "";
  const note =
    season < data.state.season
      ? `${season} regular season — the ${data.state.season} season has no completed team stats yet.`
      : games.length
        ? `${season} regular season, through ${played}${spread} ${played === 1 && !spread ? "game" : "games"}.`
        : `${season} regular season to date.`;

  if (!body) return "";

  return (
    `<section class="sct-block sct-mu-snapshot">` +
    h2(isPostgame(data) ? "Season Form" : "Matchup Snapshot") +
    `<p class="sct-note">${escapeHtml(note)}</p>` +
    body +
    `</section>`
  );
}

/* -------------------------------------------------------- fantasy matchups */

/** How the FPA table's format id reads in a sentence. */
function formatWord(format: string): string {
  return format === "ppr"
    ? "PPR"
    : format === "standard"
      ? "standard"
      : "half-PPR";
}

/**
 * What each defense gives up, by position.
 *
 * The Snapshot above compares the two units as units. This asks the question a
 * fantasy manager actually arrives with — "is my Seahawks receiver in a good
 * spot this week" — which is a property of the defense opposite him, not of
 * either offense.
 *
 * The bar here reads the OPPOSITE way round to the Snapshot's, and that is
 * deliberate rather than an oversight: there, a full bar is a better unit;
 * here, a full bar is a softer defense, because a soft defense is the good news
 * on a fantasy page. The note under the block says so in words, and each side
 * is labelled "<team> defense" so neither bar can be read as an offense's.
 */
function renderFantasy(data: MatchupData): string {
  if (!describesNow(data)) return "";

  const { a, b } = data.pair;  const fpa = data.fpa;
  if (!fpa || (!fpa.a && !fpa.b)) return "";

  // Rank 1 allows the most, so rank 1 is the fullest bar — the softest
  // matchup. See rankDescending() in fpa/fpa-data.ts.
  const softness = (rank: number | null): number | null => {
    if (rank === null) return null;
    const r = Math.min(Math.max(rank, 1), 32);
    return Math.round(((33 - r) / 32) * 100);
  };

  const side = (row: FpaRow | null, position: FantasyPosition, which: "a" | "b"): string => {
    const entry = row?.byPos?.[position];
    if (!entry) return `<span class="sct-mu-cell is-empty">—</span>`;
    const pct = softness(entry.rank);
    // Soft is good news for the offense facing it, so 1st — the most points
    // allowed — is the green chip.
    //
    // This used to invert the rank first, `rankTier(33 - rank)`, which made
    // the softest defense RED and the toughest GREEN: the opposite of what the
    // comment above it claimed, the opposite of the bar on the same row (which
    // fills for a soft defense), and the opposite of the FPA tool's own legend,
    // where 1–6 is green and 27–32 red. The rank goes in as it is.
    const tier = rankTier(entry.rank);
    return (
      `<span class="sct-mu-cell">` +
      `<span class="sct-mu-figure">` +
      `<span class="sct-mu-val">${escapeHtml(entry.fpa.toFixed(1))}</span>` +
      `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(ordinal(entry.rank))}` +
      `<span class="sct-visually-hidden">${escapeHtml(
        ` of 32 most points allowed to ${position}s`,
      )}</span></span>` +
      `</span>` +
      (pct === null
        ? ""
        : `<span class="sct-mu-bar" data-side="${which}" aria-hidden="true">` +
          `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
          `</span>`) +
      `</span>`
    );
  };

  const color = matchupColors(data.pair);
  const style = styleAttr([`--mu-cmp-left:${color(a)}`, `--mu-cmp-right:${color(b)}`]);

  const rows = FANTASY_POSITIONS.map(
    (position) =>
      `<tr>` +
      `<td class="sct-mu-td-side">${side(fpa.a, position, "a")}</td>` +
      `<th scope="row" class="sct-mu-td-label">${escapeHtml(position)}</th>` +
      `<td class="sct-mu-td-side">${side(fpa.b, position, "b")}</td>` +
      `</tr>`,
  ).join("");

  return (
    `<section class="sct-block sct-mu-fantasy">` +
    h2("Fantasy Matchups") +
    `<table class="sct-mu-table"${style}>` +
    compareCaption(
      `${a.nickname} defense`,
      "vs",
      `${b.nickname} defense`,
      " — fantasy points allowed per game by position",
    ) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(`${a.nickname} defense`)}</th>` +
    `<th scope="col">Position</th>` +
    `<th scope="col">${escapeHtml(`${b.nickname} defense`)}</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<p class="sct-note">${escapeHtml(
      `Fantasy points allowed per game, ${fpa.season} ${fpa.dataMode.toLowerCase()}, ${formatWord(fpa.format)} scoring. ` +
        `1st allows the most — a longer bar is a softer defense and a better matchup for the offense facing it.`,
    )}</p>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- injuries */

/**
 * One side's injury list.
 *
 * `postgame` changes only the empty sentence. The designations themselves are
 * the CURRENT report either way — that is the only injury data this app holds,
 * and it is genuinely the useful one after a game, because what a manager wants
 * from a recap is who is hurt NOW. What this cannot say is who left this
 * particular game and when: no free source carries an in-game exit, so the
 * section does not claim one.
 */
function injuryList(side: TeamPageData, postgame: boolean): string {
  if (!side.roster) return "";
  const rows = side.injuries;
  return (
    `<div class="sct-mu-col">` +
    `<h3 class="sct-mu-h3">${escapeHtml(side.team.nickname)}</h3>` +
    (rows.length
      ? `<ul class="sct-injuries">` +
        rows
          .map(
            (player) =>
              // Name, then what is wrong, then the designation — reading
              // order and eye order the same way round. The status pill used
              // to sit second, where it was the loudest thing in a list whose
              // point is which players are on it.
              `<li class="sct-injury sct-mu-injury">` +
              `<span class="sct-mu-injury-main">` +
              slotChip(player.slot, true) +
              playerName(player.name, "sct-injury-name") +
              `</span>` +
              ((player.injuryBodyPart ? 1 : 0) + (player.practice ? 1 : 0)
                ? `<span class="sct-injury-detail">` +
                  [player.injuryBodyPart, player.practice]
                    .filter(Boolean)
                    .map((part) => escapeHtml(String(part)))
                    .join(` <span class="sct-injury-dot">·</span> `) +
                  `</span>`
                : "") +
              `<span class="sct-injury-status" data-severity="${injurySeverity(player.injuryStatus)}">` +
              `${escapeHtml(player.injuryStatus ?? "")}</span>` +
              `</li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="sct-panel-empty">${escapeHtml(
          postgame
            ? `No ${side.team.nickname} skill-position player came out of the week with a designation.`
            : `No ${side.team.nickname} skill-position players carry an injury designation right now.`,
        )}</p>`) +
    `</div>`
  );
}

/**
 * Who is hurt — and after a game, what that means for the week ahead.
 *
 * "Injury Watch" is a pregame heading: it means "these are the calls still to
 * be made before kickoff". After the game the same list is answering a
 * different question, so it is called Injuries & Fallout and says what it is —
 * the report as it stands now, which is the one a manager setting next week's
 * lineup needs. Every name links to that player's page, which is where the
 * history behind the designation lives.
 */
function renderInjuries(data: MatchupData): string {
  if (!describesNow(data)) return "";
  const postgame = isPostgame(data);
  const left = injuryList(data.a, postgame);
  const right = injuryList(data.b, postgame);
  if (!left && !right) return "";
  return (
    `<section class="sct-block sct-mu-injuries">` +
    h2(postgame ? "Injuries & Fallout" : "Injury Watch") +
    (postgame
      ? `<p class="sct-note">${escapeHtml(
          "The current injury report for both sides. Designations are as they " +
            "stand now, not as of kickoff.",
        )}</p>`
      : "") +
    `<div class="sct-mu-cols">${left}${right}</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- meetings */

/**
 * One past meeting, written the way a result is written.
 *
 * "2024 · SEA 23 — NE 20", winner first and emphasised, rather than a fixture
 * line and a verdict in separate columns at the same weight. The loser is still
 * at full opacity — this is a result, not a ranking, and greying a team out
 * reads as missing data.
 */
function meetingRow(
  meeting: Meeting,
  data: MatchupData,
  options: MatchupRenderOptions,
): string {
  const when = gameDateLine(asGame(meeting));
  const final = meeting.status === "final" && meeting.score !== null;
  const isFeatured = data.featured === meeting;

  let result: string;
  if (final && meeting.score) {
    const homeWon = meeting.winner?.abbreviation === meeting.home.abbreviation;
    // Winner on the left when there is one; a tie keeps the away-at-home order
    // every other line on this page uses.
    const [first, second] = meeting.winner
      ? homeWon
        ? [
            { team: meeting.home, points: meeting.score.home },
            { team: meeting.away, points: meeting.score.away },
          ]
        : [
            { team: meeting.away, points: meeting.score.away },
            { team: meeting.home, points: meeting.score.home },
          ]
      : [
          { team: meeting.away, points: meeting.score.away },
          { team: meeting.home, points: meeting.score.home },
        ];
    const part = (
      entry: { team: NflTeam; points: number },
      won: boolean,
    ): string =>
      `<span class="sct-mu-res-side${won ? " is-winner" : ""}">` +
      `<span class="sct-mu-res-team">${escapeHtml(entry.team.code)}</span>` +
      `<span class="sct-mu-res-score">${entry.points}</span>` +
      `</span>`;
    result =
      `<span class="sct-mu-result">` +
      part(first, !!meeting.winner) +
      `<span class="sct-mu-res-dash" aria-hidden="true">—</span>` +
      part(second, false) +
      `</span>`;
  } else {
    result = `<span class="sct-mu-result is-pending">${meeting.status === "live" ? "Live" : "Upcoming"}</span>`;
  }

  return (
    `<li class="sct-srow sct-mu-row${isFeatured ? " is-featured" : ""}">` +
    `<span class="sct-srow-week">${escapeHtml(`${meeting.season} · ${shortWeek(meeting)}`)}</span>` +
    `<span class="sct-mu-teams">${escapeHtml(`${meeting.away.nickname} ${meeting.neutralSite ? "vs" : "at"} ${meeting.home.nickname}`)}</span>` +
    `<span class="sct-srow-when">${escapeHtml(when.date)}</span>` +
    result +
    recapLink(meeting, data, options) +
    `</li>`
  );
}

/**
 * The link from a meeting to its own dated page.
 *
 * On every finished meeting except the one the page is already about. Two jobs,
 * and the second is the one that matters: it is how a reader reaches a Week 1
 * recap in December, and it is the ONLY link to a dated URL anywhere on the
 * site — without it those pages are addressable but undiscoverable, which for a
 * crawler is the same as absent.
 *
 * Suppressed while the pair's own address is still leading with that game,
 * because the dated URL 301s back here until the window closes and a link
 * straight into a redirect is a link that says the wrong thing about which
 * address owns the page.
 */
function recapLink(
  meeting: Meeting,
  data: MatchupData,
  options: MatchupRenderOptions,
): string {
  const empty = `<span class="sct-mu-recap"></span>`;
  if (meeting.status !== "final" || meeting.score === null) return empty;
  if (data.pinned === meeting) return empty;
  if (data.matchupState === "recently_completed" && data.featured === meeting) {
    return empty;
  }

  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const href = `${gamePath(prefix, data.pair.slug, {
    season: meeting.season,
    week: meeting.week,
    seasonType: meeting.seasonType,
  })}${options.linkQuery ?? ""}`;

  return (
    `<a class="sct-textlink sct-mu-recap" href="${escapeHtml(href)}">` +
    `Recap ${ARROW}</a>`
  );
}

function renderMeetings(data: MatchupData, options: MatchupRenderOptions): string {
  const { a, b } = data.pair;
  const blocks: string[] = [];

  if (data.thisSeason.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">${escapeHtml(`${data.state.season} Meetings`)}</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.thisSeason.map((m) => meetingRow(m, data, options)).join("")}</ol>`,
    );
  }
  if (data.history.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">Recent Meetings</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.history.map((m) => meetingRow(m, data, options)).join("")}</ol>`,
    );
  }
  if (blocks.length === 0) return "";

  const r = data.record;
  // The record is the strongest fact this section has, so it is set as a stat:
  // the numbers at display size with the leader named under them, rather than a
  // sentence carrying the whole thing at body weight.
  const even = r.aWins === r.bWins;
  const leader = r.aWins > r.bWins ? a : b;
  const tally =
    `${Math.max(r.aWins, r.bWins)}–${Math.min(r.aWins, r.bWins)}` +
    (r.ties ? `–${r.ties}` : "");
  const lead =
    r.games > 0
      ? `<div class="sct-mu-h2h"${
          even
            ? ""
            : styleAttr([`--mu-h2h-accent:${leader.primaryColor}`])
        }>` +
        (even
          ? ""
          : `<img class="sct-mu-h2h-logo" src="${escapeHtml(leader.logo)}" alt=""` +
            ` width="44" height="44" loading="lazy" decoding="async" />`) +
        `<p class="sct-mu-h2h-figure">` +
        `<span class="sct-mu-h2h-tally">${escapeHtml(tally)}</span>` +
        `<span class="sct-mu-h2h-who">${escapeHtml(
          even ? "All square" : `${leader.nickname} lead`,
        )}</span>` +
        `</p>` +
        `<p class="sct-mu-h2h-note">${escapeHtml(
          `Meetings${r.fromSeason ? ` since ${r.fromSeason}` : ""} · ${r.games} game${r.games === 1 ? "" : "s"}`,
        )}</p>` +
        `</div>`
      : "";

  return (
    `<section class="sct-block sct-mu-meetings">` +
    h2("Head-to-Head") +
    lead +
    blocks.join("") +
    `</section>`
  );
}

/* ------------------------------------------------------------------ links */

function renderLinks(data: MatchupData, options: MatchupRenderOptions): string {
  const prefix = (options.teamPathPrefix ?? "/team/").trim();
  const query = options.linkQuery ?? "";
  // No `target="_top"` — see renderMatchups() in team-render.ts. These go to
  // the tool's own team hubs, not out to the main site.
  const link = (href: string, label: string): string =>
    `<li><a class="sct-crosslink" href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
  const items = [data.pair.a, data.pair.b]
    .map(
      (team) =>
        link(`${prefix}${team.slug}/${query}`, `${team.fullName} hub`) +
        ((PUBLIC_SECTIONS as readonly string[]).includes("matchups")
          ? link(`${sectionPath(prefix, team.slug, "matchups")}${query}`, `All ${team.nickname} matchups`)
          : ""),
    )
    .join("");
  return (
    `<nav class="sct-pages" aria-label="Team pages">` +
    `<ul class="sct-pages-list">${items}</ul>` +
    `</nav>`
  );
}

/* ------------------------------------------------------------------- page */

export function renderMatchupPage(data: MatchupData, options: MatchupRenderOptions = {}): string {
  const { a, b } = data.pair;
  const rootStyle = styleAttr([
    `--team-primary:${a.primaryColor}`,
    `--team-secondary:${a.secondaryColor}`,
    `--mu-a-primary:${a.primaryColor}`,
    `--mu-b-primary:${b.primaryColor}`,
    `--mu-a-logo:url('${a.logo}')`,
    `--mu-b-logo:url('${b.logo}')`,
  ]);

  // Two orders, one per state, rather than one order with sections that know
  // where they are. Before the game the reader is deciding something: the
  // fixture, then how the two compare, then who is hurt, then the history.
  // After it they are reading a result, and the questions run score, who did
  // it, what it meant, and only then what it means for the rivalry — so
  // Head-to-Head goes last rather than second. The hero has already carried the
  // score, which is why there is no featured card in the postgame order — and
  // it has already carried the fixture, which is why there is none in the
  // upcoming order either. Only an old meeting still needs a card, because
  // only its scoreboard is somewhere the hero is not.
  const body = isPostgame(data)
    ? // A game just played. The reader is reading a result, and the questions
      // run: score (the hero has it), how it happened, who did it, what it
      // means — and only then what it means for the rivalry.
      renderGlance(data) +
      renderLeaders(data) +
      renderPlayerStats(data) +
      renderTakeaways(data) +
      renderUsage(data) +
      renderInjuries(data) +
      renderSnapshot(data) +
      renderMeetings(data, options)
    : hasResult(data)
      ? // No meeting this season and none coming: an evergreen rivalry page.
        // The head-to-head IS the subject here, so it leads rather than
        // closes — the same principle as above, applied to a page whose
        // reader has no current game to ask about. The last meeting's detail
        // follows it, minus the two forward-looking fantasy blocks.
        renderMeetings(data, options) +
        renderFeatured(data) +
        renderGlance(data) +
        renderLeaders(data) +
        renderPlayerStats(data) +
        renderSnapshot(data) +
        renderFantasy(data) +
        renderInjuries(data)
      : renderWatch(data) +
        renderSnapshot(data) +
        renderFantasy(data) +
        renderInjuries(data) +
        renderMeetings(data, options);

  return (
    `<div class="sct sct-mu${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-matchup="${escapeHtml(data.pair.slug)}"` +
    ` data-matchup-state="${data.matchupState}"` +
    ` data-postgame="${isPostgame(data) ? "1" : "0"}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"${rootStyle}>` +
    renderHero(data, options) +
    `<div class="sct-section is-default is-active" data-sct-panel id="matchup">` +
    body +
    `</div>` +
    renderLinks(data, options) +
    `</div>`
  );
}

/** The `data-state` attribute values, for CSS and tests. */
export const MATCHUP_STATES = ["upcoming", "recently_completed", "historical"] as const;
