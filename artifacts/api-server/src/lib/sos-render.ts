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
import { headshotImg } from "./headshot-html";
import { renderSosFaq, type SosFaqFacts } from "./sos-faq";
import { getFPAUrl, getPlayerPageUrl, getTeamHubUrl } from "./team/links";
import type { FantasyPosition } from "./fpa/nflverse";
import type { NflTeam } from "./team/teams";
import {
  BUCKET_LABELS,
  BUCKET_RANGES,
  BUCKETS,
  FANTASY_WEEKS,
  PO3_WEEKS,
  pagePosition,
  SCORING_LABELS,
  SOS_POSITIONS,
  SOS_SCORINGS,
  SOS_SUB_PAGES,
  type SosBoard,
  type SosCard,
  type SosCell,
  type SosPage,
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
  /**
   * The FAQ's four team answers, from the RB/PPR board (sos-faq.ts). Unset,
   * the FAQ still prints with those answers pointing at the cards instead.
   */
  faq?: SosFaqFacts | null;
  /**
   * Which page this render is (sos-model.ts). The overview unless said
   * otherwise; a position page's board is that position's.
   */
  page?: SosPage;
  /**
   * Where the five sub-pages live, which is where the position controls
   * link: this app's own `/strength-of-schedule` by default, the WordPress
   * page's path in the embed fragment. A trailing slash is followed, as
   * rankingsPositionPath() does.
   */
  pageBase?: string;
  /** When the FPA table behind the board was written, for the "Updated" line. */
  updatedAt?: number | null;
  /** The playoffs page reads all four positions' boards; keyed by position. */
  boards?: Partial<Record<FantasyPosition, SosBoard>>;
}

export const SOS_H1 = "Fantasy Football Strength of Schedule";

/** This app's own page, which the sub-page links default to. */
export const SOS_DEFAULT_PAGE_BASE = "/strength-of-schedule";

/**
 * A sub-page's address under a base: `/strength-of-schedule/rb` here,
 * `/nfl/fantasy-football-strength-of-schedule/rb/` under the WordPress page.
 * The overview is the base itself.
 */
export function sosPagePath(base: string, page: SosPage): string {
  const trimmed = base.replace(/\/+$/, "") || "";
  if (page === "all") return base;
  const slash = base.endsWith("/") ? "/" : "";
  return `${trimmed}/${page}${slash}`;
}

const PAGE_LABELS: Record<Exclude<SosPage, "all">, string> = {
  qb: "QB",
  rb: "RB",
  wr: "WR",
  te: "TE",
  playoffs: "Playoffs",
};

/** The paragraph under the H1 on the WordPress page (mak, 2026-10-08). */
export const SOS_LEAD =
  "Fantasy football strength of schedule helps you compare the easiest and toughest " +
  "matchups by team, player, position, scoring format, rest-of-season, and fantasy " +
  "playoff weeks. Use the tool below to identify schedule edges using opponent-adjusted " +
  "fantasy points allowed.";

/**
 * The page's words. mak approved the source's title, H1 and description on
 * 2026-09-30 - those three and nothing else (no schema, no FAQ). The lead is
 * the old standalone plugin's hero paragraph, supplied by mak 2026-10-08; the
 * WordPress plugin prints it under the H1 as the hero's description.
 */
export function sosPageCopy(
  season: number,
  page: SosPage = "all",
  answer = "",
): {
  title: string;
  h1: string;
  description: string;
  lead: string;
} {
  if (page === "all") {
    return {
      title: `${SOS_H1} | ${season} SOS by Team & Player`,
      h1: SOS_H1,
      description:
        `View ${season} fantasy football strength of schedule by team, player, position, ` +
        `scoring format, rest-of-season, and fantasy playoff weeks.`,
      lead: SOS_LEAD,
    };
  }
  // The five sub-pages' words are mak's (spec of 2026-10-09, "Strength of
  // schedule: one real page per position"), as written there. The lead under
  // the H1 is the page's answer sentence, so it stands above the table.
  if (page === "playoffs") {
    return {
      title: "Fantasy Playoff Strength of Schedule (Weeks 15\u201317)",
      h1: "Fantasy Playoff Strength of Schedule",
      description:
        "Which teams have the easiest fantasy playoff schedule? Weeks 15\u201317 strength of " +
        "schedule for QB, RB, WR and TE, for all 32 teams.",
      lead: answer,
    };
  }
  const pos = page.toUpperCase();
  const tail: Record<string, string> = {
    QB: ", based on fantasy points allowed. Updated weekly.",
    RB: ", based on fantasy points allowed to running backs.",
    WR: ", based on fantasy points allowed to wide receivers.",
    TE: ", based on fantasy points allowed to tight ends.",
  };
  return {
    title: `${pos} Strength of Schedule ${season}: Fantasy Matchups`,
    h1: `${pos} Strength of Schedule`,
    description:
      `Fantasy ${pos} strength of schedule for ${season}: rest-of-season and playoff matchups ` +
      `for all 32 teams${tail[pos] ?? "."}`,
    lead: answer,
  };
}

/* ---------------------------------------------------------------- answers */

/** "RBs", the plural the answer sentences use. */
function posPlural(position: FantasyPosition): string {
  return `${position}s`;
}

/**
 * The one-sentence answer above a position page's table (mak's wording):
 * "Easiest rest-of-season RB schedule: {Team} ({n} fantasy points allowed per
 * game to RBs by remaining opponents). Hardest: {Team}." Once the regular
 * fantasy season is over there is no rest of it, and the sentence reads the
 * full season instead. Empty when the board has no averages at all.
 */
export function sosPositionAnswer(board: SosBoard): string {
  const pos = board.position;
  const ros = board.teams.filter((t) => t.ros !== null);
  if (ros.length >= 2) {
    const sorted = [...ros].sort((a, b) => a.rosRank - b.rosRank);
    const easiest = sorted[0]!;
    const hardest = sorted[sorted.length - 1]!;
    return (
      `Easiest rest-of-season ${pos} schedule: ${easiest.team.fullName} ` +
      `(${one(easiest.ros!.afpa)} fantasy points allowed per game to ${posPlural(pos)} by remaining opponents). ` +
      `Hardest: ${hardest.team.fullName}.`
    );
  }
  const full = board.teams.filter((t) => t.fullAfpa !== null);
  if (full.length < 2) return "";
  const sorted = [...full].sort((a, b) => a.overallRank - b.overallRank);
  const easiest = sorted[0]!;
  const hardest = sorted[sorted.length - 1]!;
  return (
    `Easiest full-season ${pos} schedule: ${easiest.team.fullName} ` +
    `(${one(easiest.fullAfpa)} fantasy points allowed per game to ${posPlural(pos)} by its opponents). ` +
    `Hardest: ${hardest.team.fullName}.`
  );
}

/**
 * The playoffs page's answer: the easiest and hardest Weeks 15-17 slate for
 * each position, from each board's playoff rank (1 = easiest).
 */
export function sosPlayoffAnswer(boards: Partial<Record<FantasyPosition, SosBoard>>): string {
  const easiest: string[] = [];
  const hardest: string[] = [];
  for (const pos of SOS_POSITIONS) {
    const board = boards[pos];
    if (!board) continue;
    const ranked = board.teams.filter((t) => t.po3 !== null).sort((a, b) => a.playoffRank - b.playoffRank);
    if (ranked.length < 2) continue;
    easiest.push(`${pos} ${ranked[0]!.team.fullName}`);
    hardest.push(`${pos} ${ranked[ranked.length - 1]!.team.fullName}`);
  }
  if (!easiest.length) return "";
  return (
    `Easiest fantasy playoff schedule (Weeks 15-17): ${easiest.join(", ")}. ` +
    `Hardest: ${hardest.join(", ")}.`
  );
}

/** The answer for whichever page is being rendered; "" on the overview. */
export function sosAnswerFor(
  page: SosPage,
  board: SosBoard,
  boards?: Partial<Record<FantasyPosition, SosBoard>>,
): string {
  if (page === "all") return "";
  if (page === "playoffs") return sosPlayoffAnswer(boards ?? { [board.position]: board });
  return sosPositionAnswer(board);
}

/** "Updated Oct 9", in Eastern time, as the FPA table's own date. */
function renderUpdated(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const text = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  return `<p class="scsos-updated">Updated <time datetime="${escapeHtml(d.toISOString().slice(0, 10))}">${escapeHtml(text)}</time></p>`;
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

/**
 * A view of the current page: the tab and the scoring in the query string.
 * The position is the page's own since the per-position pages (2026-10-09),
 * and `?pos=` 301s to that page, so no link writes it any more.
 */
function viewHref(state: SosState, options: SosRenderOptions): string {
  const extra = (options.linkQuery ?? "").replace(/^\?/, "");
  const q = `?tab=${state.tab}&scoring=${state.scoring}` + (extra ? `&${extra}` : "");
  return q;
}

/**
 * A sub-page's link, carrying a non-default scoring (and the Player tab,
 * which the playoffs page does not have) so the reader's view follows them.
 */
function pageHref(page: Exclude<SosPage, "all">, state: SosState, options: SosRenderOptions): string {
  const params: string[] = [];
  if (state.tab !== "team" && page !== "playoffs") params.push(`tab=${state.tab}`);
  if (state.scoring !== "ppr") params.push(`scoring=${state.scoring}`);
  const extra = (options.linkQuery ?? "").replace(/^\?/, "");
  if (extra) params.push(extra);
  const base = options.pageBase ?? SOS_DEFAULT_PAGE_BASE;
  return sosPagePath(base, page) + (params.length ? `?${params.join("&")}` : "");
}

function csvHref(state: SosState, options: SosRenderOptions): string {
  const base = options.csvBase ?? "/sos";
  return `${base}/download.csv?tab=${state.tab}&pos=${state.position.toLowerCase()}&scoring=${state.scoring}`;
}

/* ------------------------------------------------------------------- bar */

function renderBar(board: SosBoard, state: SosState, options: SosRenderOptions): string {
  const page = options.page ?? "all";
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

  // The five sub-pages, as plain links (mak, 2026-10-09): each position is a
  // page of its own now, so the control navigates rather than swapping the
  // board in place. No data-tab/pos/scoring on these, which is how the bundle
  // knows to leave them alone. The board's own position is marked, so the
  // overview (which opens on the RB board) still shows which one it is on.
  const pages =
    `<div class="scsos-control">` +
    `<span class="scsos-control-label">Position</span>` +
    `<div class="scsos-opts" role="group" aria-label="Position">` +
    SOS_SUB_PAGES.map((p) => {
      const current = p === page;
      const active = current || (page === "all" && pagePosition(p) === board.position);
      return (
        `<a class="scsos-opt is-page${active ? " is-active" : ""}" href="${escapeHtml(pageHref(p, state, options))}"` +
        ` data-page="${p}"${current ? ` aria-current="page"` : ""}>${PAGE_LABELS[p]}</a>`
      );
    }).join("") +
    `</div></div>`;

  const playoffs = page === "playoffs";

  return (
    `<div class="scsos-bar">` +
    (playoffs ? "" : `<nav class="scsos-tabs" aria-label="Board">${tabs}</nav>`) +
    `<div class="scsos-filters">` +
    pages +
    group<SosScoring>(
      "Scoring",
      SOS_SCORINGS,
      state.scoring,
      (s) => (s === "std" ? "Std" : s === "half-ppr" ? "Half" : "PPR"),
      (s) => ({ ...state, scoring: s }),
    ) +
    (playoffs
      ? ""
      : `<a class="scsos-export" href="${escapeHtml(csvHref(state, options))}" rel="nofollow" download` +
        ` title="${escapeHtml(`Download the ${TAB_LABELS[state.tab]} board as CSV`)}">` +
        `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `Export</a>`) +
    `</div>` +
    `</div>` +
    // The bar does not say which season; the board does, once, for anyone
    // arriving mid-year wondering whether the grid is last year's.
    `<p class="scsos-sr">${escapeHtml(
      playoffs
        ? `${board.season} season, ${SCORING_LABELS[state.scoring]} scoring, fantasy playoff weeks 15-17, all four positions.`
        : `${board.season} season, ${SCORING_LABELS[state.scoring]} scoring, ${POSITION_NAMES[state.position]}.`,
    )}</p>`
  );
}

/* --------------------------------------------------------------- related */

/**
 * The "Related" block on the sub-pages (mak's spec): the position's
 * rest-of-season rankings and projections, the FPA table, and Start/Sit.
 * The playoffs page links the two position tools at their bases.
 */
export function sosRelatedLinks(page: SosPage): { label: string; href: string }[] {
  if (page === "all") return [];
  const site = "https://statchasers.com";
  const pos = pagePosition(page);
  const seg = pos ? pos.toLowerCase() : "";
  const links: { label: string; href: string }[] = [
    {
      label: pos ? `Rest-of-Season ${pos} Rankings` : "Rest-of-Season Rankings",
      href: `${site}/fantasy-football/rest-of-season-rankings/${seg ? `${seg}/` : ""}`,
    },
    {
      label: pos ? `${pos} Fantasy Projections` : "Fantasy Football Projections",
      href: `${site}/redraft-command/fantasy-football-projections${seg ? `/${seg}` : ""}`,
    },
    { label: "Fantasy Points Allowed by Position", href: `${site}/nfl/fantasy-points-allowed-by-position/` },
    { label: "Who Should I Start?", href: `${site}/redraft-command/who-should-i-start` },
  ];
  return links;
}

function renderRelated(page: SosPage): string {
  const links = sosRelatedLinks(page);
  if (!links.length) return "";
  return (
    `<nav class="scsos-related" aria-labelledby="scsos-related-title">` +
    `<h2 id="scsos-related-title" class="scsos-related-title">Related</h2>` +
    `<ul class="scsos-related-list">` +
    links.map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`).join("") +
    `</ul></nav>`
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

  // The 160px square derivative for the 36px round well (headshot-html.ts);
  // the crest when the card is a team's, or when Sleeper has no photo.
  const image =
    (player
      ? headshotImg({
          src: null,
          id: player.id,
          className: "scsos-card-img is-headshot",
          alt: "",
          variants: ["160"],
          width: 36,
          height: 36,
          loading: "lazy",
        })
      : null) ??
    `<img class="scsos-card-img" src="${escapeHtml(team.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;

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

/** The team's schedule page on statchasers.com: the hub's /schedule/ section (mak's spec). */
export function teamScheduleHref(team: NflTeam): string | null {
  const hub = getTeamHubUrl(team);
  return hub ? `${hub.replace(/\/+$/, "")}/schedule/` : null;
}

/** The team cell: crest and code, linked to the team's schedule when the site has one. */
function teamCell(team: NflTeam): string {
  const inner =
    `<img src="${escapeHtml(team.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />` +
    `<span>${escapeHtml(team.code)}</span>`;
  const href = teamScheduleHref(team);
  return href
    ? `<a class="scsos-team" href="${escapeHtml(href)}" title="${escapeHtml(`${team.fullName} schedule`)}">${inner}</a>`
    : `<span class="scsos-team">${inner}</span>`;
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
    teamCell(r.team) +
    `</th>` +
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

/* --------------------------------------------------------- playoffs table */

/**
 * The playoffs page's grid: every team's Weeks 15-17 opponents, then the
 * PO3 average aFPA and its rank for each of the four positions, shaded by
 * that span's bucket, and the mean of the four schedule ranks, which is the
 * default order (easiest overall slate first).
 */
function renderPlayoffTable(
  season: number,
  scoring: SosScoring,
  boards: Partial<Record<FantasyPosition, SosBoard>>,
): string {
  const present = SOS_POSITIONS.filter((p) => boards[p]);
  const anchor = present.length ? boards[present[0]!]! : null;
  if (!anchor) return `<p class="scsos-empty">No playoff data found.</p>`;

  const first: Column = { key: "team", label: "Team", title: "NFL team. The weekly cells are its fantasy playoff opponents.", type: "text" };
  const columns: Column[] = [
    { key: "avg", label: "Avg", title: "Average of the four positions' playoff schedule ranks (1 = easiest).", cls: "is-playoff" },
    ...PO3_WEEKS.map((w) => ({ key: `w${w}`, label: `W${w}`, title: `Week ${w} opponent.`, cls: "is-week", type: "text" as const })),
    ...present.map((p) => ({
      key: `po3-${p.toLowerCase()}`,
      label: p,
      title: `Weeks 15-17: average opponent adjusted fantasy points allowed to ${POSITION_NAMES[p]}, and the playoff schedule rank (1 = easiest).`,
      dir: "desc" as const,
      cls: "is-week",
    })),
  ];

  const rowsByTeam = new Map<string, Partial<Record<FantasyPosition, SosTeamRow>>>();
  for (const p of present) {
    for (const r of boards[p]!.teams) {
      let entry = rowsByTeam.get(r.team.abbreviation);
      if (!entry) rowsByTeam.set(r.team.abbreviation, (entry = {}));
      entry[p] = r;
    }
  }

  const rows = anchor.teams
    .map((r) => {
      const perPos = rowsByTeam.get(r.team.abbreviation) ?? {};
      const ranks = present.map((p) => perPos[p]?.playoffRank).filter((v): v is number => typeof v === "number");
      const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
      return { team: r.team, weeks: r.weeks, perPos, avg };
    })
    .sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99) || a.team.code.localeCompare(b.team.code));

  const weekCellPlain = (cells: SosCell[], week: number) => {
    const cell = cells.find((c) => c.week === week);
    if (!cell || cell.isBye) return `<td class="scsos-wk" data-bucket="bye" data-sort="">BYE</td>`;
    const opp = cell.opponent!;
    return (
      `<td class="scsos-wk is-plain" data-sort="${escapeHtml(opp.code)}" title="${escapeHtml(`Week ${week} ${cell.isHome ? "vs" : "at"} ${opp.fullName}`)}">` +
      `<span class="scsos-opp">${cell.isHome ? "" : "@"}${escapeHtml(opp.code)}</span></td>`
    );
  };

  const po3Cell = (row: SosTeamRow | undefined, p: FantasyPosition) => {
    const span = row?.po3 ?? null;
    if (!row || !span) return `<td class="scsos-wk is-span" data-sort="">-</td>`;
    return (
      `<td class="scsos-wk is-span" data-bucket="${span.bucket}" data-sort="${span.afpa.toFixed(3)}"` +
      ` title="${escapeHtml(`${p}, Weeks 15-17: ${one(span.afpa)} average aFPA allowed to ${POSITION_NAMES[p]}, playoff schedule rank ${row.playoffRank} of 32 (1 = easiest)`)}">` +
      `<span class="scsos-afpa-only">${escapeHtml(one(span.afpa))}</span>` +
      `<span class="scsos-po-rank">#${row.playoffRank}</span></td>`
    );
  };

  const body = rows
    .map(
      (r) =>
        `<tr data-row="team-${escapeHtml(r.team.abbreviation)}">` +
        `<th scope="row" class="scsos-first" data-sort="${escapeHtml(r.team.code)}">${teamCell(r.team)}</th>` +
        `<td class="scsos-rank" data-sort="${r.avg === null ? "" : r.avg.toFixed(2)}">${r.avg === null ? "-" : escapeHtml(one(r.avg))}</td>` +
        PO3_WEEKS.map((w) => weekCellPlain(r.weeks, w)).join("") +
        present.map((p) => po3Cell(r.perPos[p], p)).join("") +
        `</tr>`,
    )
    .join("");

  return (
    `<table class="scsos-table is-playoffs" data-scsos-table data-kind="playoffs">` +
    `<caption class="scsos-sr">${escapeHtml(
      `${season} fantasy playoff strength of schedule, Weeks 15-17, ${SCORING_LABELS[scoring]} scoring, for all 32 NFL teams: ` +
        `each week's opponent and the average adjusted fantasy points allowed to quarterbacks, running backs, wide receivers and tight ends. ` +
        `Schedule ranks: 1 is the easiest.`,
    )}</caption>` +
    `<thead>${headRow([first], columns)}</thead>` +
    `<tbody>${body}</tbody></table>`
  );
}

/* --------------------------------------------------------- page assembly */

function renderMetaIsland(board: SosBoard, options: SosRenderOptions): string {
  if (!options.embed) return "";
  const page = options.page ?? "all";
  return (
    `<script type="application/json" class="scsos-page-data">` +
    escapeJsonLd(JSON.stringify(sosPageCopy(board.season, page, sosAnswerFor(page, board, options.boards)))) +
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
  const page = options.page ?? "all";
  const playoffs = page === "playoffs";
  const copy = sosPageCopy(board.season, page, sosAnswerFor(page, board, options.boards));
  const table = playoffs
    ? renderPlayoffTable(board.season, state.scoring, options.boards ?? { [board.position]: board })
    : state.tab === "player"
      ? renderPlayerTable(board)
      : renderTeamTable(board);
  return (
    `<div class="scsos${options.embed ? " is-embed" : ""}" data-scsos-root="1"` +
    ` data-season="${board.season}" data-tab="${state.tab}"` +
    ` data-pos="${state.position.toLowerCase()}" data-scoring="${state.scoring}"` +
    ` data-page="${page}"` +
    (options.endpoint ? ` data-scsos-endpoint="${escapeHtml(options.endpoint)}"` : "") +
    `>` +
    // Standalone, the page prints its own heading and the answer under it;
    // embedded, the host page prints both from the island.
    (options.embed
      ? ""
      : `<h1 class="scsos-h1">${escapeHtml(copy.h1)}</h1>` +
        (page !== "all" && copy.lead ? `<p class="scsos-answer">${escapeHtml(copy.lead)}</p>` : "")) +
    (page === "all" ? "" : renderUpdated(options.updatedAt)) +
    renderBar(board, state, options) +
    `<div class="scsos-view">` +
    (playoffs ? "" : renderCards(board, state)) +
    renderReadLine() +
    `<hr class="scsos-rule" />` +
    `<div class="scsos-legend-row">${renderLegend()}${renderBaseline(board)}</div>` +
    `<div class="scsos-scroll">` +
    table +
    `</div>` +
    `</div>` +
    // Outside .scsos-view, so a view swap (client/sos.ts) leaves them alone.
    // The FAQ is the overview's (mak, 2026-10-08); the sub-pages carry the
    // Related block instead of a sixth copy of it.
    (page === "all" ? renderSosFaq(board.season, options.faq ?? null) : renderRelated(page)) +
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
