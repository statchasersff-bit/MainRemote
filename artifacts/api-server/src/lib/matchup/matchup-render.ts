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
import type { NflTeam } from "../team/teams";
import { ordinal, type StatRow, type TeamStats } from "../team/stats";
import type { ScheduleGame } from "../team/schedule";
import type { TeamPageData } from "../team/team-data";
import type { FpaRow } from "../fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "../fpa/nflverse";
import type { MatchupData, Meeting } from "./matchup-data";
import { gameLeaders } from "./leaders";
import type { GameLeader } from "./leaders";

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
}

/** The public address of a pair: `<prefix><a>-vs-<b>/`. */
export function matchupPath(prefix: string, slug: string): string {
  return `${prefix}${slug}/`;
}

/** The pair as a heading: "New England Patriots vs Philadelphia Eagles". */
export function matchupTitle(data: MatchupData): string {
  return `${data.pair.a.fullName} vs ${data.pair.b.fullName}`;
}

/* ------------------------------------------------------------------ atoms */

const DOT = `<span class="sct-dot" aria-hidden="true"></span>`;

/** "Week 8 · Sun, Oct 25 · 4:25 PM ET", from whatever parts a meeting has. */
function whenLine(meeting: Meeting): string {
  const when = gameDateLine(asGame(meeting));
  const parts = [`Week ${meeting.week}`, when.date];
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

function renderHero(data: MatchupData, options: MatchupRenderOptions): string {
  const { a, b } = data.pair;
  const headingTag = options.embed ? "h2" : "h1";
  const featured = data.featured;

  // Away first, home second, as every scoreboard reads. With no featured game
  // the pair's own order stands and the join is "vs".
  const left = featured && !featured.neutralSite ? featured.away : a;
  const right = featured && !featured.neutralSite ? featured.home : b;
  const join = featured && !featured.neutralSite ? "@" : "vs";
  const leftData = left.abbreviation === a.abbreviation ? data.a : data.b;
  const rightData = right.abbreviation === a.abbreviation ? data.a : data.b;

  const sub =
    data.matchupState === "upcoming" && featured
      ? whenLine(featured)
      : data.matchupState === "recently_completed" && featured
        ? `Final${DOT}${whenLine(featured)}`
        : escapeHtml("Head-to-head record, team stats, injuries and recent meetings");

  const side = (team: NflTeam, teamData: TeamPageData): string =>
    `<div class="sct-mu-side">` +
    matchupSide(team, team.nickname, false) +
    (record(teamData) ? `<span class="sct-mu-record">${record(teamData)}</span>` : "") +
    `</div>`;

  return (
    `<header class="sct-hero sct-mu-hero">` +
    `<span class="sct-hero-decor" aria-hidden="true">` +
    `<span class="sct-hero-aura"></span>` +
    `</span>` +
    `<div class="sct-hero-inner sct-mu-hero-inner">` +
    `<div class="sct-hero-text">` +
    `<p class="sct-eyebrow">${escapeHtml(`NFL Matchup · ${data.state.season} Season`)}</p>` +
    `<${headingTag} class="sct-title">${escapeHtml(matchupTitle(data))}</${headingTag}>` +
    `<p class="sct-subtitle">${sub}</p>` +
    `</div>` +
    `<div class="sct-matchup sct-mu-board" aria-hidden="true">` +
    side(left, leftData) +
    `<span class="sct-matchup-at">${join}</span>` +
    side(right, rightData) +
    `</div>` +
    `<p class="sct-visually-hidden">${escapeHtml(
      `${left.fullName}${record(leftData) ? ` (${leftData.profile?.record})` : ""} ` +
        `${join === "@" ? "at" : "versus"} ` +
        `${right.fullName}${record(rightData) ? ` (${rightData.profile?.record})` : ""}`,
    )}</p>` +
    `</div>` +
    `</header>`
  );
}

/* --------------------------------------------------------- featured game */

/** The lead card: next meeting, or the one just played. */
function renderFeatured(data: MatchupData): string {
  const meeting = data.featured;
  if (!meeting) return "";

  const isResult = meeting.status === "final" && meeting.score !== null;
  const title =
    data.matchupState === "upcoming"
      ? "Up Next"
      : data.matchupState === "recently_completed"
        ? "Final"
        : "Last Meeting";

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

  const score =
    isResult && meeting.score
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

  const where = [
    meeting.venue ? escapeHtml(meeting.venue) : "",
    meeting.network && !isResult ? networkHtml(meeting.network, "sct-game-tv") : "",
  ].filter(Boolean);

  const home = meeting.neutralSite
    ? "Neutral site"
    : `${meeting.home.nickname} host`;

  return (
    `<section class="sct-block sct-mu-featured" data-state="${data.matchupState}">` +
    h2(title) +
    (meeting.network ? networkDefs([meeting.network]) : "") +
    `<div class="sct-game sct-mu-game${isResult ? " is-final" : ""}">` +
    `<div class="sct-game-head">` +
    `<span class="sct-game-week">${escapeHtml(`${meeting.season} · Week ${meeting.week}`)}</span>` +
    `<span class="sct-game-pills">${tags.join("")}` +
    `<span class="sct-game-pill" data-kind="home">${escapeHtml(home)}</span></span>` +
    `</div>` +
    score +
    // Beneath the score, and quieter than it. On a final, the date and the
    // stadium are where it happened, not what happened.
    `<div class="sct-game-meta">` +
    `<p class="sct-game-when">${whenLine(meeting)}</p>` +
    (where.length ? `<p class="sct-game-where">${where.join(" · ")}</p>` : "") +
    `</div>` +
    `</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------- game leaders */

/**
 * Who led the game, in four cards.
 *
 * Postgame only, and silent when the logs cannot answer — see gameLeaders().
 * The name is the loudest thing in each card: the number is the reason the card
 * exists, but the name is what the reader came for and what the search that
 * brought them here was about.
 */
function renderLeaders(data: MatchupData): string {
  const leaders = gameLeaders(data.featured);
  if (!leaders) return "";

  const card = (label: string, leader: GameLeader | null): string => {
    if (!leader) return "";
    const code = leader.team?.code ?? "";
    return (
      `<li class="sct-mu-leader">` +
      `<p class="sct-mu-leader-label">${escapeHtml(label)}</p>` +
      `<p class="sct-mu-leader-who">` +
      playerName(leader.player.name, "sct-mu-leader-name") +
      (leader.player.position || code
        ? `<span class="sct-mu-leader-tag">` +
          escapeHtml([leader.player.position, code].filter(Boolean).join(" · ")) +
          `</span>`
        : "") +
      `</p>` +
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
  if (when.time) rows.push(["Kickoff", escapeHtml(`${when.time} ET`)]);
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
  const rgb = (hex: string): [number, number, number] => {
    const clean = hex.trim().replace(/^#/, "");
    const n = Number.parseInt(clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean.slice(0, 6), 16);
    return Number.isFinite(n)
      ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      : [0, 0, 0];
  };
  const tooClose = (x: string, y: string): boolean => {
    const [r1, g1, b1] = rgb(x);
    const [r2, g2, b2] = rgb(y);
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
    `<caption class="sct-mu-cmp-title">` +
    `<span class="sct-mu-cmp-side" data-side="a">${escapeHtml(left.name)}</span>` +
    `<span class="sct-mu-cmp-vs">vs</span>` +
    `<span class="sct-mu-cmp-side" data-side="b">${escapeHtml(right.name)}</span>` +
    `<span class="sct-visually-hidden">${escapeHtml(` — ${caption}`)}</span>` +
    `</caption>` +
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

function renderSnapshot(data: MatchupData): string {
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
    h2("Matchup Snapshot") +
    `<p class="sct-note">${escapeHtml(note)}</p>` +
    body +
    `</section>`
  );
}

/* -------------------------------------------------------- fantasy matchups */

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
/** How the FPA table's format id reads in a sentence. */
function formatWord(format: string): string {
  return format === "ppr"
    ? "PPR"
    : format === "standard"
      ? "standard"
      : "half-PPR";
}

function renderFantasy(data: MatchupData): string {
  const { a, b } = data.pair;
  const fpa = data.fpa;
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
    // Soft is good news for the offense facing it, so the tier is read off the
    // inverted rank: 1st-softest is the green one here.
    const tier = rankTier(33 - Math.min(Math.max(entry.rank, 1), 32));
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
    `<caption class="sct-mu-cmp-title">` +
    `<span class="sct-mu-cmp-side" data-side="a">${escapeHtml(`${a.nickname} defense`)}</span>` +
    `<span class="sct-mu-cmp-vs">vs</span>` +
    `<span class="sct-mu-cmp-side" data-side="b">${escapeHtml(`${b.nickname} defense`)}</span>` +
    `<span class="sct-visually-hidden"> — fantasy points allowed per game by position</span>` +
    `</caption>` +
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

function injuryList(side: TeamPageData): string {
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
      : `<p class="sct-panel-empty">${escapeHtml(`No ${side.team.nickname} skill-position players carry an injury designation right now.`)}</p>`) +
    `</div>`
  );
}

function renderInjuries(data: MatchupData): string {
  const left = injuryList(data.a);
  const right = injuryList(data.b);
  if (!left && !right) return "";
  return (
    `<section class="sct-block sct-mu-injuries">` +
    h2("Injury Watch") +
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
function meetingRow(meeting: Meeting, data: MatchupData): string {
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
    `<span class="sct-srow-week">${escapeHtml(`${meeting.season} · WK ${meeting.week}`)}</span>` +
    `<span class="sct-mu-teams">${escapeHtml(`${meeting.away.nickname} ${meeting.neutralSite ? "vs" : "at"} ${meeting.home.nickname}`)}</span>` +
    `<span class="sct-srow-when">${escapeHtml(when.date)}</span>` +
    result +
    `</li>`
  );
}

function renderMeetings(data: MatchupData): string {
  const { a, b } = data.pair;
  const blocks: string[] = [];

  if (data.thisSeason.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">${escapeHtml(`${data.state.season} Meetings`)}</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.thisSeason.map((m) => meetingRow(m, data)).join("")}</ol>`,
    );
  }
  if (data.history.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">Recent Meetings</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.history.map((m) => meetingRow(m, data)).join("")}</ol>`,
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
          `Regular-season meetings${r.fromSeason ? ` since ${r.fromSeason}` : ""} · ${r.games} game${r.games === 1 ? "" : "s"}`,
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
        link(`${prefix}${team.slug}${query}`, `${team.fullName} hub`) +
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

  return (
    `<div class="sct sct-mu${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-matchup="${escapeHtml(data.pair.slug)}"` +
    ` data-matchup-state="${data.matchupState}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"${rootStyle}>` +
    renderHero(data, options) +
    `<div class="sct-section is-default is-active" data-sct-panel id="matchup">` +
    renderFeatured(data) +
    renderLeaders(data) +
    // Upcoming only, so it never comes between a final score and its leaders.
    renderWatch(data) +
    renderSnapshot(data) +
    renderFantasy(data) +
    renderInjuries(data) +
    renderMeetings(data) +
    `</div>` +
    renderLinks(data, options) +
    `</div>`
  );
}

/** The `data-state` attribute values, for CSS and tests. */
export const MATCHUP_STATES = ["upcoming", "recently_completed", "historical"] as const;
