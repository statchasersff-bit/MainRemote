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
  PUBLIC_SECTIONS,
  rankTier,
  sectionPath,
  slotChip,
  styleAttr,
  TIER_WORD,
} from "../team-render";
import type { NflTeam } from "../team/teams";
import type { StatRow, TeamStats } from "../team/stats";
import type { ScheduleGame } from "../team/schedule";
import type { TeamPageData } from "../team/team-data";
import type { MatchupData, Meeting } from "./matchup-data";

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

  const score = isResult && meeting.score
    ? `<p class="sct-mu-score">` +
      `<span class="sct-mu-score-side${meeting.winner?.abbreviation === meeting.away.abbreviation ? " is-winner" : ""}">` +
      `<span class="sct-mu-score-team">${escapeHtml(meeting.away.nickname)}</span>` +
      `<span class="sct-mu-score-num">${meeting.score.away}</span></span>` +
      `<span class="sct-mu-score-side${meeting.winner?.abbreviation === meeting.home.abbreviation ? " is-winner" : ""}">` +
      `<span class="sct-mu-score-team">${escapeHtml(meeting.home.nickname)}</span>` +
      `<span class="sct-mu-score-num">${meeting.score.home}</span></span>` +
      `</p>`
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
    `<div class="sct-game sct-mu-game">` +
    `<div class="sct-game-head">` +
    `<span class="sct-game-week">${escapeHtml(`${meeting.season} · Week ${meeting.week}`)}</span>` +
    `<span class="sct-game-pills">${tags.join("")}` +
    `<span class="sct-game-pill" data-kind="home">${escapeHtml(home)}</span></span>` +
    `</div>` +
    score +
    `<div class="sct-game-meta">` +
    `<p class="sct-game-when">${whenLine(meeting)}</p>` +
    (where.length ? `<p class="sct-game-where">${where.join(" · ")}</p>` : "") +
    `</div>` +
    `</div>` +
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

/** Rows shown side by side. Keys are the Stats tab's; a row absent on either side is skipped. */
const OFFENSE_KEYS = [
  "off-points",
  "off-total-yards",
  "off-yards-per-play",
  "off-passing-yards",
  "off-rushing-yards",
] as const;

/** Offence row against the other side's matching defence row. */
const CROSS_KEYS: ReadonlyArray<[string, string]> = [
  ["off-points", "def-points"],
  ["off-total-yards", "def-total-yards"],
  ["off-yards-per-play", "def-yards-per-play"],
];

function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((cell) => cell.key === key);
    if (row) return row;
  }
  return null;
}

function cell(row: StatRow | null): string {
  if (!row) return `<span class="sct-mu-cell is-empty">—</span>`;
  const tier = row.direction === "volume" ? "none" : rankTier(row.rank);
  return (
    `<span class="sct-mu-cell">` +
    `<span class="sct-mu-val">${escapeHtml(row.value)}</span>` +
    (row.rankLabel
      ? `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(row.rankLabel)}` +
        `<span class="sct-visually-hidden"> of 32${tier !== "none" ? ` — ${escapeHtml(TIER_WORD[tier] ?? "")}` : ""}</span></span>`
      : "") +
    `</span>`
  );
}

function compareTable(
  caption: string,
  leftName: string,
  rightName: string,
  rows: Array<{ label: string; description: string; left: StatRow | null; right: StatRow | null }>,
): string {
  const kept = rows.filter((row) => row.left || row.right);
  if (kept.length === 0) return "";
  return (
    `<table class="sct-mu-table">` +
    `<caption class="sct-visually-hidden">${escapeHtml(caption)}</caption>` +
    `<thead><tr><th scope="col" class="sct-mu-th-side">${escapeHtml(leftName)}</th>` +
    `<th scope="col" class="sct-mu-th-label"><span class="sct-visually-hidden">Metric</span></th>` +
    `<th scope="col" class="sct-mu-th-side">${escapeHtml(rightName)}</th></tr></thead>` +
    `<tbody>` +
    kept
      .map(
        (row) =>
          `<tr>` +
          `<td class="sct-mu-td-side">${cell(row.left)}</td>` +
          `<th scope="row" class="sct-mu-td-label">${escapeHtml(row.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></th>` +
          `<td class="sct-mu-td-side">${cell(row.right)}</td>` +
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

  const offense = compareTable(
    `${a.nickname} offense against ${b.nickname} offense`,
    `${a.nickname} offense`,
    `${b.nickname} offense`,
    OFFENSE_KEYS.map((key) => {
      const l = findRow(sa, key);
      const r = findRow(sb, key);
      const any = l ?? r;
      return { label: any?.label ?? key, description: any?.description ?? "", left: l, right: r };
    }),
  );

  const cross = (offTeam: NflTeam, off: TeamStats | null, defTeam: NflTeam, def: TeamStats | null): string =>
    compareTable(
      `${offTeam.nickname} offense against ${defTeam.nickname} defense`,
      `${offTeam.nickname} offense`,
      `${defTeam.nickname} defense`,
      CROSS_KEYS.map(([offKey, defKey]) => {
        const l = findRow(off, offKey);
        const r = findRow(def, defKey);
        const any = l ?? r;
        return { label: any?.label ?? offKey, description: any?.description ?? "", left: l, right: r };
      }),
    );

  const season = sa?.season ?? sb?.season ?? data.state.statsSeason;
  const games = [sa?.gamesPlayed, sb?.gamesPlayed].filter((n): n is number => typeof n === "number");
  const note =
    season < data.state.season
      ? `${season} regular season — the ${data.state.season} season has no completed team stats yet.`
      : games.length
        ? `${season} regular season, through ${Math.min(...games)}${games.length === 2 && games[0] !== games[1] ? `–${Math.max(...games)}` : ""} games.`
        : `${season} regular season to date.`;

  const body = offense + cross(a, sa, b, sb) + cross(b, sb, a, sa);
  if (!body) return "";

  return (
    `<section class="sct-block sct-mu-snapshot">` +
    h2("Matchup Snapshot") +
    `<p class="sct-note">${escapeHtml(note)}</p>` +
    body +
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
              `<li class="sct-injury">` +
              slotChip(player.slot, true) +
              `<span class="sct-injury-name">${escapeHtml(player.name)}</span>` +
              `<span class="sct-injury-status" data-severity="${injurySeverity(player.injuryStatus)}">` +
              `${escapeHtml(player.injuryStatus ?? "")}</span>` +
              ((player.injuryBodyPart ? 1 : 0) + (player.practice ? 1 : 0)
                ? `<span class="sct-injury-detail">` +
                  [player.injuryBodyPart, player.practice]
                    .filter(Boolean)
                    .map((part) => escapeHtml(String(part)))
                    .join(` <span class="sct-injury-dot">·</span> `) +
                  `</span>`
                : "") +
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

function meetingRow(meeting: Meeting, data: MatchupData): string {
  const when = gameDateLine(asGame(meeting));
  const final = meeting.status === "final" && meeting.score;
  const result = final
    ? `<span class="sct-mu-result">` +
      (meeting.winner
        ? `${escapeHtml(meeting.winner.nickname)} ${meeting.winner.abbreviation === meeting.home.abbreviation ? meeting.score!.home : meeting.score!.away}–${meeting.winner.abbreviation === meeting.home.abbreviation ? meeting.score!.away : meeting.score!.home}`
        : `Tie ${meeting.score!.home}–${meeting.score!.away}`) +
      `</span>`
    : `<span class="sct-mu-result is-pending">${meeting.status === "live" ? "Live" : "Upcoming"}</span>`;
  const isFeatured = data.featured === meeting;
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
  const lead =
    r.games > 0
      ? `<p class="sct-mu-h2h">` +
        `<span class="sct-mu-h2h-line">${escapeHtml(
          r.aWins === r.bWins
            ? `Even at ${r.aWins}–${r.bWins}${r.ties ? `–${r.ties}` : ""}`
            : `${(r.aWins > r.bWins ? a : b).nickname} lead ${Math.max(r.aWins, r.bWins)}–${Math.min(r.aWins, r.bWins)}${r.ties ? `–${r.ties}` : ""}`,
        )}</span>` +
        `<span class="sct-note">${escapeHtml(
          `Regular-season meetings${r.fromSeason ? ` since ${r.fromSeason}` : ""} · ${r.games} game${r.games === 1 ? "" : "s"}`,
        )}</span>` +
        `</p>`
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
    renderWatch(data) +
    renderSnapshot(data) +
    renderInjuries(data) +
    renderMeetings(data) +
    `</div>` +
    renderLinks(data, options) +
    `</div>`
  );
}

/** The `data-state` attribute values, for CSS and tests. */
export const MATCHUP_STATES = ["upcoming", "recently_completed", "historical"] as const;
