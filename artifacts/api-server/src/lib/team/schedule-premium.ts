/**
 * The Schedule page (mak's brief, 2026-11-05; the page's own design since
 * the same day, when mak said "delete the old schedule version"): a light
 * identity header (crest in a navy tile, gold rule, the page's heading and
 * the context line), the Next Game and Last Game as two featured cards, the
 * Results and Remaining boards under navy heads on the left, and on the
 * right the dark Season Snapshot, the Season Path, the division slate and
 * the opponent breakdown. renderSchedule() (team-render.ts) prints it with
 * the network defs before it and the pair index and "More <team>" links
 * after it; the hub's preview is still renderSchedulePreview() there.
 *
 * Presentation only. Every row is the ScheduleGame the model carries, in
 * order; the figures are seasonShape() (team/season-shape.ts) and
 * recordThrough(); the links are team-render.ts's own helpers
 * (gameMatchupHref, teamHubHref); the network marks reference the symbol
 * defs the section prints. Nothing is fetched or re-derived.
 *
 * Classes are `sct-shp-*`, ids `sct-shp-*`.
 */

import { easternParts } from "../news-card";
import { escapeHtml } from "../render";
import {
  ARROW,
  gameDateLine,
  gameMatchupHref,
  gameShortDate,
  gameShortDay,
  networkHtml,
  nextGameLabel,
  sideWord,
  teamHubHref,
  type TeamRenderOptions,
} from "../team-render";
import { lastResult, nextGame, recordThrough, splitSchedule, type ScheduleGame, type TeamSchedule } from "./schedule";
import { seasonShape, type SeasonShape } from "./season-shape";
import type { TeamPageData } from "./team-data";
import type { NflTeam } from "./teams";
import { premiumTabHead } from "./premium-head";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

const ICON = {
  clipboard:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M9 4V3h6v2H9zM9 10h6M9 14h6M9 18h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  calendar:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<rect x="7" y="13" width="3" height="3" rx="0.6" fill="currentColor"/>` +
    `</svg>`,
  clock:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  pin:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M12 21s6-6.2 6-11a6 6 0 0 0-12 0c0 4.8 6 11 6 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="10" r="2.2" fill="currentColor"/>` +
    `</svg>`,
  tv:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M8 21h8M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  trophy:
    `<svg class="sct-shp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`,
};

/* ---------------------------------------------------------------- pieces */

function crest(club: NflTeam | null, size: number, cls: string): string {
  return club
    ? `<img class="${cls}" src="${e(club.logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`
    : `<span class="${cls} is-empty" aria-hidden="true"></span>`;
}

/** The score as a pill, W green / L red / T neutral, read out in words. */
function resultBadge(game: ScheduleGame, cls = ""): string {
  if (!game.result) return "";
  const { outcome, teamScore, opponentScore } = game.result;
  return (
    `<span class="sct-shp-result${cls ? ` ${cls}` : ""}" data-outcome="${outcome}">` +
    `<span aria-hidden="true">${e(`${outcome} ${teamScore}–${opponentScore}`)}</span>` +
    `<span class="sct-visually-hidden">${outcome === "W" ? "Won" : outcome === "L" ? "Lost" : "Tied"} ${teamScore} to ${opponentScore}</span>` +
    `</span>`
  );
}

/** Where a game to come stands: live, postponed, canceled, or its kickoff. */
function pendingCell(game: ScheduleGame): string {
  if (game.status === "live") return `<span class="sct-shp-state" data-state="live">Live</span>`;
  if (game.status === "postponed") return `<span class="sct-shp-state" data-state="postponed">Postponed</span>`;
  if (game.status === "canceled") return `<span class="sct-shp-state" data-state="canceled">Canceled</span>`;
  const kickoff = game.kickoffMs !== null && game.timeConfirmed ? easternParts(game.kickoffMs).time : "TBD";
  return `<span class="sct-shp-state${kickoff === "TBD" ? " is-tbd" : ""}" data-state="upcoming">${e(kickoff)}</span>`;
}

/** "AT" / "VS" with the gold rule, and "neutral site" read out where it applies. */
function siteMark(game: ScheduleGame): string {
  return (
    `<span class="sct-shp-site" data-kind="${game.site}"${game.site === "neutral" ? ` title="Neutral site"` : ""}>${sideWord(game)}</span>` +
    (game.site === "neutral" ? `<span class="sct-visually-hidden">, neutral site</span>` : "")
  );
}

function opponentCell(game: ScheduleGame, options: TeamRenderOptions): string {
  const shown = game.opponent?.fullName ?? game.opponentName;
  const hub = teamHubHref(game.opponent, options);
  const name = hub
    ? `<a class="sct-shp-opp-name" href="${e(hub)}">${e(shown)}</a>`
    : `<span class="sct-shp-opp-name">${e(shown)}</span>`;
  return `<span class="sct-shp-opp">${siteMark(game)}${crest(game.opponent, 24, "sct-shp-opp-logo")}${name}</span>`;
}

function weekCell(game: ScheduleGame): string {
  return game.seasonType === "post"
    ? `<span class="sct-shp-week is-round">${e(game.weekLabel)}</span>`
    : `<span class="sct-shp-week">${e(`W${game.week}`)}</span>`;
}

function venueText(game: ScheduleGame): string {
  return [game.venue ?? "", game.site === "neutral" ? (game.venueCity ?? "Neutral site") : ""].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- header */

function identity(data: TeamPageData, schedule: TeamSchedule): string {
  const { team } = data;
  // The shared premium tab header (premium-head.ts), the Draft tab's design,
  // since 2026-11-05 evening (mak: "should have the same design as the
  // [Draft Picks & History] header"); the context line is its dek. The
  // page's heading (the first h2 in the section is what the WordPress mount
  // promotes to its H1): .sct-h2 is the house heading, .sct-up-h2 the
  // shared header's treatment.
  return premiumTabHead({
    hook: "sct-shp-hero",
    icon: "schedule",
    art: "schedule",
    heading: `<h2 class="sct-h2 sct-up-h2 sct-shp-title">${e(`${team.fullName} Schedule`)}</h2>`,
    // A standing description like the other tabs' (mak, 2026-11-06), in
    // place of the season / record / division / bye / updated line.
    dek: `Every ${team.nickname} game of the ${schedule.season} season, with dates, kickoff times, TV, venues and results.`,
  });
}

/* -------------------------------------------------------------- featured */

function nextCard(data: TeamPageData, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  const { team } = data;
  const next = nextGame(schedule, now);
  if (!next) {
    return (
      `<section class="sct-shp-card is-next is-empty" aria-label="Next game">` +
      `<p class="sct-shp-badges"><span class="sct-shp-badge is-gold">Next Game</span></p>` +
      `<p class="sct-shp-card-empty">${e(`The ${schedule.season} regular season is complete.`)}</p>` +
      `</section>`
    );
  }
  const when = gameDateLine(next);
  const opponentName = next.opponent?.fullName ?? next.opponentName;
  const side = (club: NflTeam | null, name: string, isTeam: boolean): string => {
    const href = club && !isTeam ? teamHubHref(club, options) : null;
    const label = href
      ? `<a class="sct-shp-fx-name" href="${e(href)}">${e(name)}</a>`
      : `<span class="sct-shp-fx-name${isTeam ? " is-team" : ""}">${e(name)}</span>`;
    return `<span class="sct-shp-fx-side">${crest(club, 40, "sct-shp-fx-logo")}${label}</span>`;
  };
  // Away at home, as a scoreboard reads; a neutral site puts this team first and says "vs".
  const fixture =
    next.site === "home"
      ? side(next.opponent, opponentName, false) + `<span class="sct-shp-fx-at">at</span>` + side(team, team.fullName, true)
      : next.site === "away"
        ? side(team, team.fullName, true) + `<span class="sct-shp-fx-at">at</span>` + side(next.opponent, opponentName, false)
        : side(team, team.fullName, true) + `<span class="sct-shp-fx-at">vs</span>` + side(next.opponent, opponentName, false);
  const facts: string[] = [`<span class="sct-shp-fact">${ICON.calendar}${e(when.date)}</span>`];
  if (when.time) facts.push(`<span class="sct-shp-fact">${ICON.clock}${e(when.time)}</span>`);
  if (next.network) facts.push(`<span class="sct-shp-fact is-tv">${networkHtml(next.network, "sct-shp-tv")}</span>`);
  else if (next.status === "scheduled") facts.push(`<span class="sct-shp-fact is-tbd">${ICON.tv}TV TBD</span>`);
  const venue = venueText(next) || (next.international && next.venueCity ? next.venueCity : "");
  if (venue) facts.push(`<span class="sct-shp-fact">${ICON.pin}${e(venue)}</span>`);
  const href = gameMatchupHref(team, next, schedule, options, now);
  const live = next.status === "live" && next.statusDetail ? `<span class="sct-shp-badge is-live">${e(next.statusDetail)}</span>` : "";
  return (
    `<section class="sct-shp-card is-next" aria-label="${e(`${team.nickname} next game`)}">` +
    crest(team, 160, "sct-shp-watermark") +
    `<p class="sct-shp-badges"><span class="sct-shp-badge is-gold">${e(nextGameLabel(next, now))}</span><span class="sct-shp-badge-week">${e(next.weekLabel)}</span>${live}</p>` +
    `<p class="sct-shp-fixture">${fixture}</p>` +
    `<p class="sct-shp-facts">${facts.join("")}</p>` +
    (href ? `<p class="sct-shp-cta"><a class="sct-shp-button" href="${e(href)}">View matchup <span class="sct-shp-arrow" aria-hidden="true">&rarr;</span></a></p>` : "") +
    `</section>`
  );
}

function lastCard(data: TeamPageData, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  const { team } = data;
  const last = lastResult(schedule);
  if (!last?.result) {
    return (
      `<section class="sct-shp-card is-last is-empty" aria-label="Last game">` +
      `<p class="sct-shp-badges"><span class="sct-shp-badge is-blue">Last Game</span></p>` +
      `<p class="sct-shp-card-empty">${e(`No ${schedule.season} games have been played yet.`)}</p>` +
      `</section>`
    );
  }
  const record = recordThrough(schedule.games, last).text;
  const opponentName = last.opponent?.nickname ?? last.opponentName;
  const hub = teamHubHref(last.opponent, options);
  const href = gameMatchupHref(team, last, schedule, options, now);
  return (
    `<section class="sct-shp-card is-last" aria-label="${e(`${team.nickname} last game`)}">` +
    crest(team, 160, "sct-shp-watermark") +
    `<p class="sct-shp-badges"><span class="sct-shp-badge is-blue">Last Game</span><span class="sct-shp-badge-week">${e(last.weekLabel)}</span></p>` +
    `<p class="sct-shp-last-line">` +
    resultBadge(last, "is-big") +
    `<span class="sct-shp-last-opp">${siteMark(last)}${crest(last.opponent, 26, "sct-shp-opp-logo")}` +
    (hub ? `<a class="sct-shp-opp-name" href="${e(hub)}">${e(opponentName)}</a>` : `<span class="sct-shp-opp-name">${e(opponentName)}</span>`) +
    `</span>` +
    `</p>` +
    `<p class="sct-shp-facts">` +
    `<span class="sct-shp-fact">${ICON.calendar}${e(gameShortDay(last))}</span>` +
    `<span class="sct-shp-fact">${ICON.trophy}Record <b class="sct-shp-num">${e(record)}</b></span>` +
    `</p>` +
    `<span class="sct-visually-hidden">${e(`${team.nickname} record after the game: ${record}`)}</span>` +
    (href ? `<p class="sct-shp-cta"><a class="sct-shp-button is-light" href="${e(href)}">View recap <span class="sct-shp-arrow" aria-hidden="true">&rarr;</span></a></p>` : "") +
    `</section>`
  );
}

/* ---------------------------------------------------------------- boards */

function sectionHead(icon: string, id: string, title: string, range: string): string {
  return (
    `<div class="sct-shp-head">${icon}<h3 class="sct-shp-h3" id="${id}">${e(title)}</h3>` +
    (range ? `<span class="sct-shp-head-range">${e(range)}</span>` : "") +
    `<span class="sct-shp-slash" aria-hidden="true"></span></div>`
  );
}

function rangeOf(games: ScheduleGame[]): string {
  if (!games.length) return "";
  const first = games[0] as ScheduleGame;
  const last = games[games.length - 1] as ScheduleGame;
  if (first.seasonType === "post") return "";
  return games.length === 1 ? `Week ${first.week}` : `Weeks ${first.week}–${last.week}`;
}

function linkCell(team: NflTeam, game: ScheduleGame, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  const href = gameMatchupHref(team, game, schedule, options, now);
  if (!href) return `<td class="sct-shp-td is-view"></td>`;
  return (
    `<td class="sct-shp-td is-view"><a class="sct-shp-view" href="${e(href)}">` +
    `${game.status === "final" ? "View recap" : "View matchup"} <span class="sct-shp-arrow" aria-hidden="true">&rarr;</span></a></td>`
  );
}

function resultRow(team: NflTeam, game: ScheduleGame, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  return (
    `<tr class="sct-shp-row" data-site="${game.site}">` +
    `<th scope="row" class="sct-shp-td is-week">${weekCell(game)}</th>` +
    `<td class="sct-shp-td is-opp">${opponentCell(game, options)}</td>` +
    `<td class="sct-shp-td is-date"${game.dateConfirmed ? "" : ` title="Date and time to be announced by the NFL"`}>${e(gameShortDate(game))}</td>` +
    `<td class="sct-shp-td is-result">${resultBadge(game)}</td>` +
    `<td class="sct-shp-td is-record"><span class="sct-shp-num">${e(recordThrough(schedule.games, game).text)}</span></td>` +
    linkCell(team, game, schedule, options, now) +
    `</tr>`
  );
}

function remainingRow(team: NflTeam, game: ScheduleGame, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  const venue = venueText(game);
  return (
    `<tr class="sct-shp-row" data-site="${game.site}">` +
    `<th scope="row" class="sct-shp-td is-week">${weekCell(game)}</th>` +
    `<td class="sct-shp-td is-opp">${opponentCell(game, options)}</td>` +
    `<td class="sct-shp-td is-date"${game.dateConfirmed ? "" : ` title="Date and time to be announced by the NFL"`}>${e(gameShortDate(game))}</td>` +
    `<td class="sct-shp-td is-time">${pendingCell(game)}</td>` +
    `<td class="sct-shp-td is-tv">${game.network ? networkHtml(game.network, "sct-shp-tv") : `<span class="sct-shp-tbd">TBD</span>`}</td>` +
    `<td class="sct-shp-td is-venue"${venue ? ` title="${e(venue)}"` : ""}>${venue ? e(venue) : `<span class="sct-shp-tbd">TBD</span>`}</td>` +
    linkCell(team, game, schedule, options, now) +
    `</tr>`
  );
}

function byeRow(week: number, columns: number): string {
  return (
    `<tr class="sct-shp-row is-bye">` +
    `<th scope="row" class="sct-shp-td is-week"><span class="sct-shp-week">${e(`W${week}`)}</span></th>` +
    `<td class="sct-shp-td is-bye" colspan="${columns - 1}"><span class="sct-shp-bye">Bye week</span></td>` +
    `</tr>`
  );
}

function table(kind: "results" | "remaining", caption: string, rows: string[]): string {
  const head =
    kind === "results"
      ? `<th scope="col" class="is-week">Wk</th><th scope="col" class="is-opp">Opponent</th><th scope="col" class="is-date">Date</th><th scope="col" class="is-result">Result</th><th scope="col" class="is-record">Record</th><th scope="col" class="is-view"><span class="sct-visually-hidden">Game page</span></th>`
      : `<th scope="col" class="is-week">Wk</th><th scope="col" class="is-opp">Opponent</th><th scope="col" class="is-date">Date</th><th scope="col" class="is-time">Time</th><th scope="col" class="is-tv">TV</th><th scope="col" class="is-venue">Venue</th><th scope="col" class="is-view"><span class="sct-visually-hidden">Game page</span></th>`;
  return (
    `<div class="sct-shp-scroll" tabindex="0">` +
    `<table class="sct-shp-table" data-shp-board="${kind}">` +
    `<caption class="sct-visually-hidden">${e(caption)}</caption>` +
    `<thead><tr class="sct-shp-th-row">${head}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody>` +
    `</table>` +
    `</div>`
  );
}

function boards(data: TeamPageData, schedule: TeamSchedule, options: TeamRenderOptions, now: number): string {
  const { team } = data;
  const { results, remaining } = splitSchedule(schedule);
  const bye = schedule.byeWeek;
  const lastPlayedWeek = results.length ? (results[results.length - 1] as ScheduleGame).week : 0;
  const resultRows = results.map((g) => resultRow(team, g, schedule, options, now));
  const remainingRows = remaining.map((g) => remainingRow(team, g, schedule, options, now));
  // The bye where its week falls, as the original slots it.
  if (bye) {
    if (bye < lastPlayedWeek) {
      const at = results.findIndex((g) => g.week > bye);
      resultRows.splice(at === -1 ? resultRows.length : at, 0, byeRow(bye, 6));
    } else {
      const at = remaining.findIndex((g) => g.week > bye);
      remainingRows.splice(at === -1 ? remainingRows.length : at, 0, byeRow(bye, 7));
    }
  }
  const resultsBlock =
    `<section class="sct-shp-board" aria-labelledby="sct-shp-results-h">` +
    sectionHead(ICON.clipboard, "sct-shp-results-h", `${team.fullName} Results`, rangeOf(results)) +
    (resultRows.length
      ? table("results", `${team.fullName} ${schedule.season} results: week, opponent, date, result, record after the game.`, resultRows)
      : `<p class="sct-shp-board-empty">${e(`No ${schedule.season} games have been played yet.`)}</p>`) +
    `</section>`;
  const remainingBlock =
    `<section class="sct-shp-board" aria-labelledby="sct-shp-remaining-h">` +
    sectionHead(ICON.calendar, "sct-shp-remaining-h", `${team.fullName} Remaining Schedule`, rangeOf(remaining)) +
    (remainingRows.length
      ? table("remaining", `${team.fullName} ${schedule.season} remaining schedule: week, opponent, date, kickoff, network, venue.`, remainingRows)
      : `<p class="sct-shp-board-empty">${e(`The ${schedule.season} regular season is complete.`)}</p>`) +
    `</section>`;
  // Results first while the season is on; before it starts the remaining
  // board is the schedule, as the original orders them.
  let out = results.length ? resultsBlock + remainingBlock : remainingBlock + resultsBlock;
  const post = data.postseason;
  if (post && post.games.length) {
    const split = splitSchedule(post);
    const blocks: string[] = [];
    if (split.results.length) {
      blocks.push(table("results", `${team.fullName} postseason results.`, split.results.map((g) => resultRow(team, g, post, options, now))));
    }
    if (split.remaining.length) {
      blocks.push(table("remaining", `${team.fullName} postseason schedule.`, split.remaining.map((g) => remainingRow(team, g, post, options, now))));
    }
    out +=
      `<section class="sct-shp-board" aria-labelledby="sct-shp-post-h">` +
      sectionHead(ICON.trophy, "sct-shp-post-h", `${team.fullName} Postseason Schedule`, "") +
      blocks.join("") +
      `</section>`;
  }
  return out;
}

/* ------------------------------------------------------------------ rail */

function snapshotCard(shape: SeasonShape): string {
  const cells: Array<[string, string]> = [
    ["Games", String(shape.total)],
    ["Home", String(shape.home)],
    ["Away", String(shape.away)],
    ...(shape.neutral ? ([["Neutral", String(shape.neutral)]] as Array<[string, string]>) : []),
    ["Division", String(shape.division)],
    ["Remaining", String(shape.remaining)],
  ];
  const denominator = Math.max(shape.total, 1);
  const bar = (kind: "home" | "away" | "neutral", label: string, value: number): string =>
    `<div class="sct-shp-bar" data-kind="${kind}">` +
    `<dt class="sct-shp-bar-label">${label}</dt>` +
    `<dd class="sct-shp-bar-body"><span class="sct-shp-bar-track" aria-hidden="true"><span class="sct-shp-bar-fill" style="${e(`width:${Math.round((value / denominator) * 100)}%`)}"></span></span>` +
    `<span class="sct-shp-bar-value sct-shp-num">${value}</span></dd>` +
    `</div>`;
  return (
    `<section class="sct-shp-snap" aria-labelledby="sct-shp-snap-h">` +
    `<h3 class="sct-shp-snap-h" id="sct-shp-snap-h">${e(`${shape.season} Season Snapshot`)}</h3>` +
    `<dl class="sct-shp-snap-grid">` +
    cells.map(([label, value]) => `<div class="sct-shp-snap-cell"><dd class="sct-shp-snap-value sct-shp-num">${e(value)}</dd><dt class="sct-shp-snap-label">${e(label)}</dt></div>`).join("") +
    `</dl>` +
    `<p class="sct-shp-snap-bye"><span class="sct-shp-snap-bye-week sct-shp-num">${e(shape.bye ? `W${shape.bye}` : "TBD")}</span><span class="sct-shp-snap-bye-label">Bye week</span></p>` +
    `<dl class="sct-shp-bars">` +
    bar("home", "Home", shape.home) +
    bar("away", "Away", shape.away) +
    (shape.neutral ? bar("neutral", "Neutral", shape.neutral) : "") +
    `</dl>` +
    `</section>`
  );
}

function pathCard(shape: SeasonShape, nextWeek: number | null): string {
  const cells = shape.marks
    .map(
      (mark) =>
        `<li class="sct-shp-path-week${mark.week === nextWeek ? " is-now" : ""}" data-kind="${mark.kind}" title="${e(`Week ${mark.week} · ${mark.label}`)}" tabindex="0">` +
        `<span class="sct-visually-hidden">${e(`Week ${mark.week}: ${mark.label}${mark.week === nextWeek ? " (next)" : ""}`)}</span>` +
        `</li>`,
    )
    .join("");
  return (
    `<section class="sct-shp-rail-card is-path" aria-labelledby="sct-shp-path-h">` +
    `<h3 class="sct-shp-rail-h" id="sct-shp-path-h">Season Path</h3>` +
    `<ol class="sct-shp-path">${cells}</ol>` +
    `<p class="sct-shp-legend" aria-hidden="true">` +
    `<span class="sct-shp-key" data-kind="home">Home</span><span class="sct-shp-key" data-kind="away">Away</span>` +
    (shape.neutral ? `<span class="sct-shp-key" data-kind="neutral">Neutral</span>` : "") +
    `<span class="sct-shp-key" data-kind="bye">Bye</span>` +
    `</p>` +
    `<dl class="sct-shp-segs">` +
    shape.segments.map((s) => `<div class="sct-shp-seg"><dt class="sct-shp-seg-label">${e(`Weeks ${s.from}–${s.to}`)}</dt><dd class="sct-shp-seg-detail">${e(s.detail)}</dd></div>`).join("") +
    `</dl>` +
    `</section>`
  );
}

function slateCard(data: TeamPageData, schedule: TeamSchedule, shape: SeasonShape, options: TeamRenderOptions, now: number): string {
  const { team } = data;
  const rows = shape.slate
    .map((game) => {
      const fixture = schedule.games.find((g) => g.seasonType === "regular" && g.week === game.week && g.opponent === game.opponent);
      const href = fixture ? gameMatchupHref(team, fixture, schedule, options, now) : null;
      const name = href ? `<a class="sct-shp-slate-link" href="${e(href)}">${e(game.name)}</a>` : e(game.name);
      const status = fixture
        ? fixture.result
          ? resultBadge(fixture, "is-small")
          : `<span class="sct-shp-slate-when">${e(gameShortDate(fixture))}</span>`
        : "";
      return (
        `<li class="sct-shp-slate-row">` +
        `<span class="sct-shp-week">${e(`W${game.week}`)}</span>` +
        crest(game.opponent, 20, "sct-shp-slate-logo") +
        `<span class="sct-shp-slate-name"><span class="sct-shp-site is-plain" data-kind="${game.site}">${game.site === "away" ? "at" : "vs"}</span>${name}</span>` +
        `<span class="sct-shp-slate-status">${status}</span>` +
        `</li>`
      );
    })
    .join("");
  const neutral = shape.slate.length - shape.slateHome - shape.slateAway;
  return (
    `<section class="sct-shp-rail-card is-slate" aria-labelledby="sct-shp-slate-h">` +
    `<h3 class="sct-shp-rail-h" id="sct-shp-slate-h">${e(`${team.division} Schedule`)}</h3>` +
    (shape.slate.length
      ? `<ul class="sct-shp-slate">${rows}</ul>` +
        `<p class="sct-shp-caption">${e(`${shape.slateHome} home · ${shape.slateAway} away${neutral ? ` · ${neutral} neutral` : ""}`)}</p>`
      : `<p class="sct-shp-caption">No division games scheduled.</p>`) +
    `</section>`
  );
}

function opponentsCard(team: NflTeam, shape: SeasonShape): string {
  const max = shape.divisions[0]?.count ?? 1;
  return (
    `<section class="sct-shp-rail-card is-opponents" aria-labelledby="sct-shp-opp-h">` +
    `<h3 class="sct-shp-rail-h" id="sct-shp-opp-h">${e(`Who ${team.city} Plays`)}</h3>` +
    (shape.divisions.length
      ? `<dl class="sct-shp-bars is-light">` +
        shape.divisions
          .map(
            (d) =>
              `<div class="sct-shp-bar"><dt class="sct-shp-bar-label">${e(d.division)}</dt>` +
              `<dd class="sct-shp-bar-body"><span class="sct-shp-bar-track" aria-hidden="true"><span class="sct-shp-bar-fill" style="${e(`width:${Math.round((d.count / max) * 100)}%`)}"></span></span>` +
              `<span class="sct-shp-bar-value sct-shp-num">${d.count}</span></dd></div>`,
          )
          .join("") +
        `</dl>` +
        `<dl class="sct-shp-conf">` +
        shape.conferences.map(([conf, n]) => `<div class="sct-shp-conf-cell"><dt>${e(conf)}</dt><dd class="sct-shp-num">${n}</dd></div>`).join("") +
        `</dl>`
      : `<p class="sct-shp-caption">No opponents scheduled.</p>`) +
    `</section>`
  );
}

/* --------------------------------------------------------------- section */

/** The whole dashboard, or "" without a schedule (renderSchedule prints its empty state then). */
export function renderSchedulePremium(data: TeamPageData, options: TeamRenderOptions, now: number): string {
  const { team, schedule } = data;
  if (!schedule) return "";
  const shape = seasonShape(schedule, team);
  const next = nextGame(schedule, now);
  const rail = shape
    ? `<aside class="sct-shp-rail" aria-label="${e(`${schedule.season} ${team.nickname} season shape`)}">` +
      snapshotCard(shape) +
      pathCard(shape, next?.seasonType === "regular" ? next.week : null) +
      slateCard(data, schedule, shape, options, now) +
      opponentsCard(team, shape) +
      `</aside>`
    : "";
  return (
    `<div class="sct-shp">` +
    identity(data, schedule) +
    `<div class="sct-shp-featured">` +
    nextCard(data, schedule, options, now) +
    lastCard(data, schedule, options, now) +
    `</div>` +
    `<div class="sct-shp-layout${rail ? "" : " is-single"}">` +
    `<div class="sct-shp-main">${boards(data, schedule, options, now)}</div>` +
    rail +
    `</div>` +
    `</div>`
  );
}
