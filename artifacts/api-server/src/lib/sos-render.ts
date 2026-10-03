/**
 * Markup for the fantasy strength-of-schedule board.
 *
 * Server-only, like fpa-render.ts. The whole board for one view - the four
 * insight cards, the legend, all 32 teams (or every listed player) and every
 * week - is in the response; client/sos.ts adds sorting, the card jumps, the
 * compact names and in-place view switching on top of it.
 *
 * The layout is the standalone app's (Strength-of-Schedule-SOS,
 * src/pages/home.tsx): Team/Player tabs with the filters and Export on one
 * bar, four spotlight cards, the "How to read this board" line, the legend
 * beside the baseline badge, then the grid. The dress is this app's, per the
 * house-style rule for ported tools: sos.css, not the source's Tailwind.
 *
 * Where the source needed JavaScript the server does it here instead: the
 * Position/Scoring selects are links (the source's dropdowns could not work
 * without a script), the column explanations are `title`s rather than Radix
 * tooltips, and the legend's and the baseline badge's popovers are <details>.
 */

import { escapeHtml, escapeJsonLd } from "./render";
import { getFPAUrl, getPlayerPageUrl } from "./team/links";
import type { FantasyPosition } from "./fpa/nflverse";
import {
  BUCKET_LABELS,
  BUCKET_RANGES,
  BUCKETS,
  FANTASY_WEEKS,
  SCORING_LABELS,
  SOS_POSITIONS,
  SOS_SCORINGS,
  type SosBoard,
  type SosCard,
  type SosCell,
  type SosPlayerRow,
  type SosScoring,
  type SosSpan,
  type SosState,
  type SosTab,
  type SosTeamRow,
} from "./sos/sos-model";

export interface SosRenderOptions {
  /** Inside a statchasers.com page: no H1 (the page prints it) and a page-data island. */
  embed?: boolean;
  /** Carried onto the view links so the standalone embed preview stays embedded. */
  linkQuery?: string;
  /** Where the bundle fetches another view from. Unset, every control navigates. */
  endpoint?: string;
  /** The CSV route, absolute when embedded (it lives on this origin, not WordPress). */
  csvBase?: string;
}

export const SOS_H1 = "Fantasy Football Strength of Schedule";

/**
 * The page's words. mak approved the source's title, H1 and description on
 * 2026-09-30 - those three and nothing else (no schema, no FAQ).
 */
export function sosPageCopy(season: number): { title: string; h1: string; description: string } {
  return {
    title: `${SOS_H1} | ${season} SOS by Team & Player`,
    h1: SOS_H1,
    description:
      `View ${season} fantasy football strength of schedule by team, player, position, ` +
      `scoring format, rest-of-season, and fantasy playoff weeks.`,
  };
}

const TAB_LABELS: Record<SosTab, string> = { team: "Team SOS", player: "Player SOS" };

const POSITION_NAMES: Record<FantasyPosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
};

function one(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(1);
}

function signed(value: number): string {
  const r = Math.round(value * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
}

/** "Justin Jefferson" → "J. Jefferson"; "Jacory Croskey-Merritt" → "J. Croskey". The source's rule. */
export function abbreviateName(name: string): string {
  const sp = name.indexOf(" ");
  if (sp <= 0) return name;
  const last = name.slice(sp + 1);
  return `${name[0]}. ${last.includes("-") ? last.split("-")[0] : last}`;
}

function viewHref(state: SosState, options: SosRenderOptions): string {
  const extra = (options.linkQuery ?? "").replace(/^\?/, "");
  const q =
    `?tab=${state.tab}&pos=${state.position.toLowerCase()}&scoring=${state.scoring}` +
    (extra ? `&${extra}` : "");
  return q;
}

function csvHref(state: SosState, options: SosRenderOptions): string {
  const base = options.csvBase ?? "/sos";
  return `${base}/download.csv?tab=${state.tab}&pos=${state.position.toLowerCase()}&scoring=${state.scoring}`;
}

/* ------------------------------------------------------------------- bar */

function renderBar(board: SosBoard, state: SosState, options: SosRenderOptions): string {
  const tabs = (["team", "player"] as const)
    .map((tab) => {
      const active = tab === state.tab;
      return (
        `<a class="scsos-tab${active ? " is-active" : ""}" href="${escapeHtml(viewHref({ ...state, tab }, options))}"` +
        ` data-tab="${tab}"${active ? ` aria-current="page"` : ""}>${TAB_LABELS[tab]}</a>`
      );
    })
    .join("");

  const group = <T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    text: (v: T) => string,
    next: (v: T) => SosState,
  ) =>
    `<div class="scsos-control">` +
    `<span class="scsos-control-label">${label}</span>` +
    `<div class="scsos-opts" role="group" aria-label="${label}">` +
    values
      .map((v) => {
        const active = v === current;
        const s = next(v);
        return (
          `<a class="scsos-opt${active ? " is-active" : ""}" href="${escapeHtml(viewHref(s, options))}"` +
          ` data-tab="${s.tab}" data-pos="${s.position.toLowerCase()}" data-scoring="${s.scoring}"` +
          `${active ? ` aria-current="true"` : ""}>${escapeHtml(text(v))}</a>`
        );
      })
      .join("") +
    `</div></div>`;

  return (
    `<div class="scsos-bar">` +
    `<nav class="scsos-tabs" aria-label="Board">${tabs}</nav>` +
    `<div class="scsos-filters">` +
    group("Position", SOS_POSITIONS, state.position, (p) => p, (p) => ({ ...state, position: p })) +
    group<SosScoring>(
      "Scoring",
      SOS_SCORINGS,
      state.scoring,
      (s) => (s === "std" ? "Std" : s === "half-ppr" ? "Half" : "PPR"),
      (s) => ({ ...state, scoring: s }),
    ) +
    `<a class="scsos-export" href="${escapeHtml(csvHref(state, options))}" rel="nofollow" download` +
    ` title="${escapeHtml(`Download the ${TAB_LABELS[state.tab]} board as CSV`)}">` +
    `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `Export</a>` +
    `</div>` +
    `</div>` +
    // The bar does not say which season; the board does, once, for anyone
    // arriving mid-year wondering whether the grid is last year's.
    `<p class="scsos-sr">${escapeHtml(`${board.season} season, ${SCORING_LABELS[state.scoring]} scoring, ${POSITION_NAMES[state.position]}.`)}</p>`
  );
}

/* ----------------------------------------------------------------- cards */

function renderCard(card: SosCard, board: SosBoard, isPlayer: boolean): string {
  const team = card.team;
  const player = card.player;
  const name = player ? player.name : team.code;
  const href = player ? getPlayerPageUrl(player.slug) : null;
  const nameHtml = href
    ? `<a class="scsos-card-name" href="${escapeHtml(href)}" title="${escapeHtml(`View ${name} on StatChasers`)}">` +
      `<span class="scsos-pname-full">${escapeHtml(name)}</span>` +
      `<span class="scsos-pname-short">${escapeHtml(abbreviateName(name))}</span></a>`
    : player
      ? `<span class="scsos-card-name"><span class="scsos-pname-full">${escapeHtml(name)}</span>` +
        `<span class="scsos-pname-short">${escapeHtml(abbreviateName(name))}</span></span>`
      : `<span class="scsos-card-name">${escapeHtml(name)}</span>`;

  const image = player
    ? `<img class="scsos-card-img is-headshot" src="https://sleepercdn.com/content/nfl/players/${escapeHtml(player.id)}.jpg"` +
      ` alt="" width="36" height="36" loading="lazy" decoding="async" />`
    : `<img class="scsos-card-img" src="${escapeHtml(team.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;

  const sub = player ? `${team.code} · ${board.position}` : team.fullName;
  const delta = isPlayer
    ? `${signed(card.delta)} vs avg`
    : `${signed(card.delta)} vs <span class="scsos-card-league">league </span>avg`;

  return (
    `<article class="scsos-card is-${card.tone}" data-card="${card.id}"` +
    ` data-sort-key="${card.sortKey}" data-dir="${card.dir}" data-row="${escapeHtml(card.rowId)}">` +
    `<img class="scsos-card-mark" src="${escapeHtml(team.logo)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />` +
    `<p class="scsos-card-title">${escapeHtml(card.title)}</p>` +
    `<p class="scsos-card-note">${escapeHtml(card.note)}</p>` +
    `<div class="scsos-card-body">${image}` +
    `<div class="scsos-card-main">` +
    `<div class="scsos-card-row">${nameHtml}` +
    `<span class="scsos-card-value">${escapeHtml(one(card.afpa))}<small>aFPA</small></span></div>` +
    `<div class="scsos-card-row is-sub"><span class="scsos-card-sub">${escapeHtml(sub)}</span>` +
    `<span class="scsos-card-delta">${delta}</span></div>` +
    `</div></div>` +
    `</article>`
  );
}

function renderCards(board: SosBoard, state: SosState): string {
  const isPlayer = state.tab === "player";
  const cards = isPlayer ? board.playerCards : board.teamCards;
  if (!cards.length) return "";
  return `<div class="scsos-cards">${cards.map((c) => renderCard(c, board, isPlayer)).join("")}</div>`;
}

/* ------------------------------------------------------ read line, legend */

function renderReadLine(): string {
  const fpa = getFPAUrl();
  return (
    `<div class="scsos-read">` +
    `<p class="scsos-read-text">` +
    `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>` +
    `<span><strong>How to read this board</strong> - Higher aFPA = easier matchup · ` +
    `<strong>vs</strong> = home · <strong>@</strong> = away</span></p>` +
    (fpa ? `<a class="scsos-afpa-link" href="${escapeHtml(fpa)}">How aFPA works →</a>` : "") +
    `</div>`
  );
}

function renderLegend(): string {
  const tip =
    `<details class="scsos-pop scsos-legend-tip">` +
    `<summary class="scsos-info" aria-label="How matchup difficulty is calculated">i</summary>` +
    `<div class="scsos-pop-body">` +
    `<p>Based on opponent aFPA rank by selected position (1 = toughest D, 32 = easiest).</p>` +
    `<ul class="scsos-pop-list">` +
    BUCKETS.map(
      (b) => `<li><span>${BUCKET_LABELS[b]}</span><span>${BUCKET_RANGES[b]}</span></li>`,
    ).join("") +
    `</ul></div></details>`;

  const swatches =
    BUCKETS.map(
      (b) =>
        `<li><span class="scsos-swatch" data-bucket="${b}" aria-hidden="true"></span>${BUCKET_LABELS[b]}</li>`,
    ).join("") +
    `<li><span class="scsos-swatch" data-bucket="bye" aria-hidden="true"></span>Bye</li>`;

  return (
    `<div class="scsos-legend">` +
    `<div class="scsos-legend-head"><span class="scsos-legend-title">Matchup Strength</span>${tip}</div>` +
    `<ul class="scsos-swatches">${swatches}</ul>` +
    `</div>`
  );
}

/**
 * The baseline badge. The source hard-coded "Preseason Baseline Active"; the
 * figures here move with the season, so the badge says which phase of the FPA
 * blend (fpa/blend.ts) is on, and the popover carries the FPA table's own
 * sentence about the mix - the same words the FPA page prints.
 */
function renderBaseline(board: SosBoard): string {
  const prior = board.season - 1;
  const week = board.weekNumber ?? 0;
  const phase = board.isPreseason || week < 1 ? 0 : week <= 4 ? 1 : week < 12 ? 2 : 3;
  const phases: [string, string][] = [
    ["Preseason", `100% ${prior} full season`],
    ["Weeks 1–4", `Blended baseline and ${board.season} data`],
    ["Week 5+", "Mostly current-season data"],
    ["Week 12+", "Rolling 10-week data"],
  ];
  const label =
    phase === 0
      ? "Preseason Baseline Active"
      : phase === 3
        ? "Rolling 10-Week Data Active"
        : `${prior}–${board.season} Blend Active`;
  const lead =
    phase === 0
      ? `Using ${prior} full-season data until ${board.season} sample sizes become reliable.`
      : `Through Week ${week}: ${board.methodology}`;

  return (
    `<details class="scsos-pop scsos-baseline" data-phase="${phase}">` +
    `<summary class="scsos-baseline-pill"><span class="scsos-dot" aria-hidden="true"></span>${escapeHtml(label)}` +
    `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>` +
    `<div class="scsos-pop-body is-right">` +
    `<p class="scsos-pop-title">${escapeHtml(label)}</p>` +
    `<p>${escapeHtml(lead)}</p>` +
    `<ul class="scsos-pop-list is-phases">` +
    phases
      .map(
        ([when, what], i) =>
          `<li${i === phase ? ` class="is-current" aria-current="true"` : ""}><span>${escapeHtml(when)}</span><span>${escapeHtml(what)}</span></li>`,
      )
      .join("") +
    `</ul></div></details>`
  );
}

/* ----------------------------------------------------------------- table */

function weekCell(cell: SosCell): string {
  if (cell.isBye) {
    return `<td class="scsos-wk" data-bucket="bye" data-sort="">BYE</td>`;
  }
  const opp = cell.opponent!;
  const where = cell.isHome ? "vs" : "at";
  const title =
    `Week ${cell.week} ${where} ${opp.fullName}: ${one(cell.afpa)} aFPA` +
    (cell.rank !== null ? `, defense rank ${cell.rank} of 32 (1 = toughest)` : "");
  return (
    `<td class="scsos-wk" data-bucket="${cell.bucket ?? "neutral"}" data-sort="${cell.rank ?? ""}" title="${escapeHtml(title)}">` +
    `<span class="scsos-opp">${cell.isHome ? "" : "@"}${escapeHtml(opp.code)}</span>` +
    `<span class="scsos-afpa">${escapeHtml(one(cell.afpa))}</span>` +
    `</td>`
  );
}

function spanCell(span: SosSpan | null, label: string): string {
  if (!span) return `<td class="scsos-wk is-span" data-sort="">-</td>`;
  return (
    `<td class="scsos-wk is-span" data-bucket="${span.bucket}" data-sort="${span.rank}"` +
    ` title="${escapeHtml(`${label}: ${one(span.afpa)} average aFPA, rank ${span.rank} of 32 (1 = toughest)`)}">` +
    `<span class="scsos-afpa-only">${escapeHtml(one(span.afpa))}</span></td>`
  );
}

function rankCell(value: number, muted = false): string {
  return `<td class="scsos-rank${muted ? " is-muted" : ""}" data-sort="${value}">${value}</td>`;
}

interface Column {
  key: string;
  label: string;
  title: string;
  /** Which way a first click sorts. */
  dir?: "asc" | "desc";
  type?: "text" | "number";
  cls?: string;
}

const RANK_COLUMNS: Column[] = [
  { key: "ovr", label: "OVR", title: "Overall schedule rank, Weeks 1-17. 1 = easiest schedule, 32 = hardest, by average opponent adjusted points allowed vs this position." },
  { key: "ros", label: "ROS", title: "Rest-of-season schedule rank - remaining games through Week 17. 1 = easiest remaining schedule." },
  { key: "playoff", label: "Play Off", title: "Fantasy playoff schedule rank, Weeks 15-17. 1 = easiest playoff slate.", cls: "is-playoff" },
];

function weekColumns(): Column[] {
  return FANTASY_WEEKS.map((w) => ({
    key: `w${w}`,
    label: `W${w}`,
    title: `Week ${w} matchup. Color shows how tough the opponent's defense is vs this position (their adjusted-points-allowed rank).`,
    cls: "is-week",
  }));
}

const SPAN_COLUMNS: Column[] = [
  { key: "po2", label: "PO2", title: "Playoff Weeks 16-17: average opponent difficulty (adjusted points allowed).", cls: "is-week" },
  { key: "po3", label: "PO3", title: "Playoff Weeks 15-17: average opponent difficulty (adjusted points allowed).", cls: "is-week" },
];

function headRow(first: Column[], rest: Column[]): string {
  const th = (c: Column, row = false) =>
    `<th scope="col" class="scsos-th${c.cls ? ` ${c.cls}` : ""}${row ? " is-first" : ""}" data-key="${c.key}"` +
    ` data-sort-type="${c.type ?? "number"}" data-sort-dir="${c.dir ?? "asc"}" title="${escapeHtml(c.title)}">` +
    `${c.label === "Play Off" ? "Play<br />Off" : escapeHtml(c.label)}</th>`;
  return `<tr>${first.map((c) => th(c, true)).join("")}${rest.map((c) => th(c)).join("")}</tr>`;
}

function renderTeamTable(board: SosBoard): string {
  const columns = [
    ...RANK_COLUMNS,
    ...weekColumns(),
    ...SPAN_COLUMNS,
    { key: "rosavg", label: "ROS", title: "Average opponent adjusted fantasy points allowed over remaining weeks (through Week 17). Higher = easier.", dir: "desc", cls: "is-week" } as Column,
  ];
  const first: Column = { key: "team", label: "Team", title: "NFL team. Each weekly cell shows the opponent's defense difficulty vs this position.", type: "text" };

  const row = (r: SosTeamRow) =>
    `<tr data-row="team-${escapeHtml(r.team.abbreviation)}">` +
    `<th scope="row" class="scsos-first" data-sort="${escapeHtml(r.team.code)}">` +
    `<span class="scsos-team"><img src="${escapeHtml(r.team.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />` +
    `<span>${escapeHtml(r.team.code)}</span></span></th>` +
    rankCell(r.overallRank) +
    rankCell(r.rosRank, true) +
    rankCell(r.playoffRank) +
    r.weeks.map(weekCell).join("") +
    spanCell(r.po2, "Weeks 16-17") +
    spanCell(r.po3, "Weeks 15-17") +
    (r.ros
      ? `<td class="scsos-wk is-span" data-bucket="${r.ros.bucket}" data-sort="${r.ros.afpa.toFixed(3)}">` +
        `<span class="scsos-afpa-only">${escapeHtml(one(r.ros.afpa))}</span></td>`
      : `<td class="scsos-wk is-span" data-sort="">-</td>`) +
    `</tr>`;

  return (
    `<table class="scsos-table" data-scsos-table data-kind="team">` +
    `<caption class="scsos-sr">${escapeHtml(
      `${board.season} fantasy strength of schedule for all 32 NFL teams against ${POSITION_NAMES[board.position]}, ` +
        `${SCORING_LABELS[board.scoring]} scoring: each week's opponent and that defense's adjusted fantasy points allowed (aFPA). ` +
        `Schedule ranks: 1 is the easiest. Defense ranks: 1 is the toughest.`,
    )}</caption>` +
    `<thead>${headRow([first], columns)}</thead>` +
    `<tbody>${board.teams.map(row).join("")}</tbody></table>`
  );
}

function renderPlayerTable(board: SosBoard): string {
  const first: Column = { key: "player", label: "Player", title: "Player, mapped to their current NFL team. Weekly cells use their team's opponent defense vs this position.", type: "text" };
  const columns = [
    { key: "team", label: "Team", title: "Player's current NFL team.", type: "text" } as Column,
    ...RANK_COLUMNS,
    ...weekColumns(),
    ...SPAN_COLUMNS,
  ];

  const row = (r: SosPlayerRow) => {
    const href = getPlayerPageUrl(r.slug);
    const inner =
      `<span class="scsos-pname-full">${escapeHtml(r.name)}</span>` +
      `<span class="scsos-pname-short">${escapeHtml(abbreviateName(r.name))}</span>`;
    const name = href
      ? `<a class="scsos-player" href="${escapeHtml(href)}" title="${escapeHtml(`View ${r.name} on StatChasers`)}">${inner}</a>`
      : `<span class="scsos-player">${inner}</span>`;
    return (
      `<tr data-row="player-${escapeHtml(r.id)}">` +
      `<th scope="row" class="scsos-first is-player" data-sort="${escapeHtml(r.name)}">${name}</th>` +
      `<td class="scsos-rank is-muted is-team" data-sort="${escapeHtml(r.team.code)}">${escapeHtml(r.team.code)}</td>` +
      rankCell(r.overallRank) +
      rankCell(r.rosRank, true) +
      rankCell(r.playoffRank) +
      r.weeks.map(weekCell).join("") +
      spanCell(r.po2, "Weeks 16-17") +
      spanCell(r.po3, "Weeks 15-17") +
      `</tr>`
    );
  };

  if (!board.players.length) {
    return `<p class="scsos-empty">No player data found.</p>`;
  }

  return (
    `<table class="scsos-table" data-scsos-table data-kind="player">` +
    `<caption class="scsos-sr">${escapeHtml(
      `${board.season} fantasy strength of schedule for ${board.players.length} ${POSITION_NAMES[board.position]}, ` +
        `${SCORING_LABELS[board.scoring]} scoring, by their team's weekly opponents. ` +
        `Schedule ranks: 1 is the easiest. Defense ranks: 1 is the toughest.`,
    )}</caption>` +
    `<thead>${headRow([first], columns)}</thead>` +
    `<tbody>${board.players.map(row).join("")}</tbody></table>`
  );
}

/* --------------------------------------------------------- page assembly */

function renderMetaIsland(board: SosBoard, options: SosRenderOptions): string {
  if (!options.embed) return "";
  return (
    `<script type="application/json" class="scsos-page-data">` +
    escapeJsonLd(JSON.stringify(sosPageCopy(board.season))) +
    `</script>`
  );
}

/**
 * The board for one view. `state.position` and `state.scoring` must be the
 * board's own; `state.tab` picks which half of it is shown.
 */
export function renderSosPage(
  board: SosBoard,
  state: SosState,
  options: SosRenderOptions = {},
): string {
  return (
    `<div class="scsos${options.embed ? " is-embed" : ""}" data-scsos-root="1"` +
    ` data-season="${board.season}" data-tab="${state.tab}"` +
    ` data-pos="${state.position.toLowerCase()}" data-scoring="${state.scoring}"` +
    (options.endpoint ? ` data-scsos-endpoint="${escapeHtml(options.endpoint)}"` : "") +
    `>` +
    (options.embed ? "" : `<h1 class="scsos-h1">${escapeHtml(SOS_H1)}</h1>`) +
    renderBar(board, state, options) +
    `<div class="scsos-view">` +
    renderCards(board, state) +
    renderReadLine() +
    `<hr class="scsos-rule" />` +
    `<div class="scsos-legend-row">${renderLegend()}${renderBaseline(board)}</div>` +
    `<div class="scsos-scroll">` +
    (state.tab === "player" ? renderPlayerTable(board) : renderTeamTable(board)) +
    `</div>` +
    `</div>` +
    renderMetaIsland(board, options) +
    `</div>`
  );
}

/** No FPA ingested or no schedule: a sentence, not a grid of dashes. */
export function renderSosEmpty(options: SosRenderOptions = {}): string {
  return (
    `<div class="scsos${options.embed ? " is-embed" : ""}" data-scsos-root="1" data-empty="1">` +
    (options.embed ? "" : `<h1 class="scsos-h1">${escapeHtml(SOS_H1)}</h1>`) +
    `<p class="scsos-empty">Strength of schedule figures are not available right now. Please check back soon.</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------- CSV */

function csvCell(cell: SosCell): string {
  if (cell.isBye) return "BYE";
  const opp = `${cell.isHome ? "" : "@"}${cell.opponent!.code}`;
  return cell.rank !== null ? `${opp} (${cell.rank})` : opp;
}

/**
 * The board as CSV - the source's columns (its header named 18 weeks over 17
 * cells; this names the 17 it has), plus the two playoff spans. A weekly cell
 * is "@DEN (9)": the opponent and that defense's rank, 1 = toughest.
 */
export function renderSosCsv(board: SosBoard, tab: SosTab): string {
  const quote = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const weeks = FANTASY_WEEKS.map((w) => `W${w}`);
  const lines: (string | number)[][] = [];
  if (tab === "player") {
    lines.push(["Player", "Team", "Position", "SOSRank", "ROSRank", "PlayoffRank", ...weeks, "PO2", "PO3"]);
    for (const r of board.players) {
      lines.push([
        r.name, r.team.code, r.position, r.overallRank, r.rosRank, r.playoffRank,
        ...r.weeks.map(csvCell), one(r.po2?.afpa), one(r.po3?.afpa),
      ]);
    }
  } else {
    lines.push(["Team", "OverallRank", "ROSRank", "PlayoffRank", "ROSSummary", ...weeks, "PO2", "PO3"]);
    for (const r of board.teams) {
      lines.push([
        r.team.code, r.overallRank, r.rosRank, r.playoffRank, r.ros ? one(r.ros.afpa) : "",
        ...r.weeks.map(csvCell), one(r.po2?.afpa), one(r.po3?.afpa),
      ]);
    }
  }
  return lines.map((l) => l.map(quote).join(",")).join("\n") + "\n";
}
