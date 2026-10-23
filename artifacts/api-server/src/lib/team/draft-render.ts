/**
 * Markup for the team hub's Draft tab.
 *
 * Server-rendered in full like the tabs beside it. Two views behind the same
 * pill switch the Depth Chart tab uses (client/team.ts, wireDepthViews, which
 * drives any `[data-sct-dc]` block): the next draft's picks by round, and the
 * last five drafts with the position groups they leaned on. With scripting
 * off both views stack and each carries its own title.
 *
 * No FAQ and no address of its own: a hub-only panel, like Coaching, until
 * a public URL is approved.
 */

import { escapeHtml } from "../render";
import { getPlayerProfileUrl } from "./links";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";
import type {
  CategoryShare,
  DraftCapitalView,
  DraftHistoryView,
  DraftPick,
  DraftView,
} from "./draft";

const e = escapeHtml;

/** "Texans", or the code when a club is unknown to the site. */
function nick(abbr: string): string {
  return getTeamByAbbreviation(abbr)?.nickname ?? abbr.toUpperCase();
}

/* ------------------------------------------------------------- picks view */

function capitalSummary(team: NflTeam, c: DraftCapitalView): string {
  const tile = (value: number, label: string): string =>
    `<li class="sct-dr-tile"><span class="sct-dr-num">${value}</span>` +
    `<span class="sct-dr-tile-label">${e(label)}</span></li>`;
  return (
    `<ul class="sct-dr-tiles" aria-label="${e(`${team.nickname} ${c.draftYear} draft capital`)}">` +
    tile(c.total, "Picks held") +
    tile(c.firstRounders, c.firstRounders === 1 ? "First-rounder" : "First-rounders") +
    tile(c.acquired, "Acquired") +
    tile(c.sent.length, "Sent away") +
    `</ul>`
  );
}

function roundCard(team: NflTeam, round: DraftCapitalView["rounds"][number]): string {
  const chips = round.holds.map((h) =>
    h.from === null
      ? `<li class="sct-dr-chip is-own">Own pick</li>`
      : `<li class="sct-dr-chip is-from">From ${e(nick(h.from))}</li>`,
  );
  const gone = round.sent.map(
    (s) => `<li class="sct-dr-chip is-sent">Own pick to ${e(nick(s.to))}</li>`,
  );
  const empty = chips.length === 0 && gone.length === 0 ? `<li class="sct-dr-chip is-none">No pick</li>` : "";
  const count = round.holds.length;
  return (
    `<li class="sct-dr-round${count === 0 ? " is-empty" : ""}" data-count="${count}">` +
    `<div class="sct-dr-round-head">` +
    `<span class="sct-dr-round-name">Round ${round.round}</span>` +
    `<span class="sct-dr-round-count"><span class="sct-dr-num">${count}</span>` +
    `<span class="sct-visually-hidden"> ${count === 1 ? "pick" : "picks"}</span></span>` +
    `</div>` +
    `<ul class="sct-dr-chips">${chips.join("")}${gone.join("")}${empty}</ul>` +
    `</li>`
  );
}

/** "Two" for a sentence that opens on a count; digits past nine. */
function countWord(n: number): string {
  const words = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[n] ?? String(n);
}

function renderCapital(team: NflTeam, c: DraftCapitalView): string {
  const extra = c.acquired ? ` ${countWord(c.acquired)} of them came by trade.` : "";
  const out = c.sent.length
    ? ` ${countWord(c.sent.length)} of the club's own picks belong${c.sent.length === 1 ? "s" : ""} to other teams.`
    : "";
  return (
    `<section class="sct-dr-panel" data-sct-dc-panel="picks">` +
    `<h3 class="sct-dr-h3">${e(`${c.draftYear} NFL Draft Picks`)}</h3>` +
    `<p class="sct-dr-lede">${e(
      `The ${team.nickname} hold ${c.total} ${c.total === 1 ? "pick" : "picks"} in the ${c.draftYear} draft.${extra}${out}`,
    )}</p>` +
    capitalSummary(team, c) +
    `<ol class="sct-dr-rounds">${c.rounds.map((r) => roundCard(team, r)).join("")}</ol>` +
    `<p class="sct-note sct-dr-foot">Compensatory picks are awarded in March and join the rounds then. Pick ownership updates when a trade moves a pick.</p>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- history view */

function shareBars(title: string, rows: CategoryShare[], total: number): string {
  if (rows.length === 0) return "";
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    `<div class="sct-dr-shares">` +
    `<h4 class="sct-dr-h4">${e(title)}</h4>` +
    `<ul class="sct-dr-share-list" aria-label="${e(`${title}: ${total} picks by position group`)}">` +
    rows
      .map(
        (r) =>
          `<li class="sct-dr-share">` +
          `<span class="sct-dr-share-label">${e(r.label)}</span>` +
          `<span class="sct-dr-share-bar" aria-hidden="true">` +
          `<span class="sct-dr-share-fill" style="${e(`width:${((r.pct / max) * 100).toFixed(1)}%`)}"></span>` +
          `</span>` +
          `<span class="sct-dr-share-pct"><span class="sct-dr-num">${e(r.pct.toFixed(0))}%</span>` +
          `<span class="sct-dr-share-count">${r.count}</span></span>` +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `</div>`
  );
}

function playerCell(pick: DraftPick): string {
  const href = getPlayerProfileUrl(pick.name);
  return href
    ? `<a class="sct-dr-name sct-player-link" href="${e(href)}" target="_top">${e(pick.name)}</a>`
    : `<span class="sct-dr-name">${e(pick.name)}</span>`;
}

function seasonTable(team: NflTeam, season: number, picks: DraftPick[]): string {
  const rows = picks
    .map(
      (p) =>
        `<tr>` +
        `<td class="sct-dr-td is-num">${p.round}</td>` +
        `<td class="sct-dr-td is-num">${p.pick}</td>` +
        `<th scope="row" class="sct-dr-td is-player">${playerCell(p)}</th>` +
        `<td class="sct-dr-td"><span class="sct-dr-pos">${e(p.position)}</span></td>` +
        `<td class="sct-dr-td is-college">${e(p.college)}</td>` +
        `<td class="sct-dr-td is-num">${p.games}</td>` +
        `<td class="sct-dr-td is-num">${p.proBowls}</td>` +
        `</tr>`,
    )
    .join("");
  const firsts = picks.filter((p) => p.round === 1).length;
  return (
    `<div class="sct-dr-season">` +
    `<div class="sct-dr-season-head">` +
    `<h4 class="sct-dr-h4">${e(`${season} Draft`)}</h4>` +
    `<span class="sct-dr-season-sum">${e(
      `${picks.length} ${picks.length === 1 ? "pick" : "picks"}` +
        (firsts ? ` · ${firsts} in Round 1` : ""),
    )}</span>` +
    `</div>` +
    `<div class="sct-dr-scroll" tabindex="0">` +
    `<table class="sct-dr-table">` +
    `<caption class="sct-visually-hidden">${e(`${team.fullName} ${season} draft picks, with each player's career games and Pro Bowls to date.`)}</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="sct-dr-th is-num">Rd</th>` +
    `<th scope="col" class="sct-dr-th is-num">Pick</th>` +
    `<th scope="col" class="sct-dr-th is-player">Player</th>` +
    `<th scope="col" class="sct-dr-th">Pos</th>` +
    `<th scope="col" class="sct-dr-th is-college">College</th>` +
    `<th scope="col" class="sct-dr-th is-num"><abbr title="Career games played">GP</abbr></th>` +
    `<th scope="col" class="sct-dr-th is-num"><abbr title="Pro Bowl selections">PB</abbr></th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

function renderHistory(team: NflTeam, h: DraftHistoryView): string {
  const span = `${h.firstSeason}-${h.lastSeason}`;
  return (
    `<section class="sct-dr-panel" data-sct-dc-panel="history">` +
    `<h3 class="sct-dr-h3">${e(`Last ${h.seasons.length} Drafts`)}</h3>` +
    `<p class="sct-dr-lede">${e(
      `${h.total} picks across the ${span} drafts, ${h.firstRounders} of them in Round 1. Position groups are the broad ones: every lineman counts as OL or DL, every corner and safety as DB.`,
    )}</p>` +
    `<div class="sct-dr-share-grid">` +
    shareBars("All picks", h.allPicks, h.total) +
    shareBars("Round 1 only", h.roundOne, h.firstRounders) +
    `</div>` +
    h.seasons.map((s) => seasonTable(team, s.season, s.picks)).join("") +
    `<p class="sct-note sct-dr-foot">Games and Pro Bowls are career totals through the current season. A player's name links to their profile where the site has one.</p>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- section */

interface DraftViewTab {
  key: "picks" | "history";
  label: string;
  note: string;
  html: string;
}

/**
 * The whole tab, or "" when neither file has this club, which drops the tab
 * from the strip rather than mounting an empty panel.
 */
export function renderDraftSection(team: NflTeam, view: DraftView): string {
  const tabs: DraftViewTab[] = [];
  if (view.capital) {
    tabs.push({
      key: "picks",
      label: `${view.capital.draftYear} Picks`,
      note: `Every pick the ${team.nickname} hold in the ${view.capital.draftYear} NFL Draft, round by round, with the club each acquired pick came from.`,
      html: renderCapital(team, view.capital),
    });
  }
  if (view.history) {
    tabs.push({
      key: "history",
      label: "Draft History",
      note: `The ${team.nickname}' last ${view.history.seasons.length} draft classes, newest first, and the position groups the club spent its picks on.`,
      html: renderHistory(team, view.history),
    });
  }
  if (tabs.length === 0) return "";

  const notes =
    `<div class="sct-dc-notes">` +
    tabs
      .map(
        (t, i) =>
          `<p class="sct-note sct-dc-note" data-sct-dc-note="${t.key}"${i === 0 ? "" : " hidden"}>${e(t.note)}</p>`,
      )
      .join("") +
    `</div>`;

  const switcher =
    tabs.length > 1
      ? `<div class="sct-dc-views" role="group" aria-label="Draft view">` +
        tabs
          .map(
            (t, i) =>
              `<button type="button" class="sct-dc-view" data-sct-dc-view="${t.key}"` +
              ` aria-pressed="${i === 0 ? "true" : "false"}">${e(t.label)}</button>`,
          )
          .join("") +
        `</div>`
      : "";

  return (
    `<h2 class="sct-h2">${e(`${team.nickname} Draft Picks & History`)}</h2>` +
    `<div class="sct-dc sct-dr" data-sct-dc>${notes}${switcher}${tabs.map((t) => t.html).join("")}</div>`
  );
}
