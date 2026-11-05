/**
 * The premium redesign of the strength-of-schedule board, rendered UNDER the
 * original while mak compares the two (brief of 2026-11-05: "exact premium
 * NFL strength of schedule redesign", a comparison, not a replacement).
 *
 * Nothing here is computed: every figure, rank, tier, opponent, bye, card
 * and link is read from the same SosBoard the original prints, through the
 * same helpers (sos-render.ts), so the two can never disagree. What this
 * file owns is markup and class names (`scsos-pm-*`, dressed at the end of
 * public/sos.css). The bundle (client/sos.ts) wires this block the way it
 * wires the original - sorting, card jumps, compact names, the finder - by
 * running the same code against this block's own root. Rows carry
 * `data-pm-row`, not `data-row`: the tests count the original's rows by that
 * attribute, and the FPA cells' `#scsos-team-det` ids stay the original's.
 *
 * The controls are the original's links wearing the premium classes: the
 * tab and scoring pills carry data-tab/pos/scoring and are swapped in place,
 * the position pills are the sub-pages (`is-page`) and navigate, Export is
 * the same CSV route. No new state, no second fetch.
 */

import { escapeHtml } from "./render";
import { headshotImg } from "./headshot-html";
import { getFPAUrl, getPlayerPageUrl } from "./team/links";
import type { NflTeam } from "./team/teams";
import {
  BUCKET_LABELS,
  BUCKETS,
  FANTASY_WEEKS,
  pagePosition,
  SCORING_LABELS,
  SOS_SCORINGS,
  SOS_SUB_PAGES,
  type SosBoard,
  type SosCard,
  type SosCell,
  type SosPlayerRow,
  type SosScoring,
  type SosSpan,
  type SosState,
  type SosTeamRow,
} from "./sos/sos-model";
import {
  abbreviateName,
  baselineBody,
  baselineInfo,
  csvHref,
  legendTipBody,
  one,
  PAGE_LABELS,
  pageHref,
  POSITION_NAMES,
  signed,
  TAB_LABELS,
  teamScheduleHref,
  viewHref,
  type SosRenderOptions,
} from "./sos-render";

/* ------------------------------------------------------------------ bar */

function renderPremiumBar(board: SosBoard, state: SosState, options: SosRenderOptions): string {
  const page = options.page ?? "all";

  const tabs = (["team", "player"] as const)
    .map((tab) => {
      const active = tab === state.tab;
      return (
        `<a class="scsos-pm-tab${active ? " is-active" : ""}" href="${escapeHtml(viewHref({ ...state, tab }, options))}"` +
        ` data-tab="${tab}"${active ? ` aria-current="page"` : ""}>${TAB_LABELS[tab]}</a>`
      );
    })
    .join("");

  // The five sub-pages: four positions and, set off by a hairline, the
  // playoffs page, which is a scope rather than a position (the brief's
  // distinction). Plain links, as on the original bar.
  const positions =
    `<div class="scsos-pm-control">` +
    `<span class="scsos-pm-label">Position</span>` +
    `<div class="scsos-pm-opts" role="group" aria-label="Position">` +
    SOS_SUB_PAGES.map((p) => {
      const current = p === page;
      const active = current || (page === "all" && pagePosition(p) === board.position);
      return (
        `<a class="scsos-pm-opt is-page${p === "playoffs" ? " is-scope" : ""}${active ? " is-active" : ""}"` +
        ` href="${escapeHtml(pageHref(p, state, options))}" data-page="${p}"${current ? ` aria-current="page"` : ""}>${PAGE_LABELS[p]}</a>`
      );
    }).join("") +
    `</div></div>`;

  const scoring =
    `<div class="scsos-pm-control">` +
    `<span class="scsos-pm-label">Scoring</span>` +
    `<div class="scsos-pm-opts" role="group" aria-label="Scoring">` +
    SOS_SCORINGS.map((s) => {
      const active = s === state.scoring;
      const next = { ...state, scoring: s };
      const text = s === "std" ? "Std" : s === "half-ppr" ? "Half" : "PPR";
      return (
        `<a class="scsos-pm-opt${active ? " is-active" : ""}" href="${escapeHtml(viewHref(next, options))}"` +
        ` data-tab="${next.tab}" data-pos="${next.position.toLowerCase()}" data-scoring="${next.scoring}"` +
        `${active ? ` aria-current="true"` : ""}>${text}</a>`
      );
    }).join("") +
    `</div></div>`;

  const exportLink =
    `<a class="scsos-pm-export" href="${escapeHtml(csvHref(state, options))}" rel="nofollow" download` +
    ` title="${escapeHtml(`Download the ${TAB_LABELS[state.tab]} board as CSV`)}">` +
    `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 3v9m0 0-4-4m4 4 4-4M4 16h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `<span>Export</span></a>`;

  return (
    `<div class="scsos-pm-bar">` +
    `<nav class="scsos-pm-seg" aria-label="Board">${tabs}</nav>` +
    `<div class="scsos-pm-filters">${positions}${scoring}${exportLink}</div>` +
    `</div>` +
    `<p class="scsos-sr">${escapeHtml(
      `${board.season} season, ${SCORING_LABELS[state.scoring]} scoring, ${POSITION_NAMES[state.position]}.`,
    )}</p>`
  );
}

/* ---------------------------------------------------------------- cards */

function renderPremiumCard(card: SosCard, board: SosBoard, isPlayer: boolean): string {
  const team = card.team;
  const player = card.player;
  const name = player ? player.name : team.code;
  const href = player ? getPlayerPageUrl(player.slug) : null;
  const nameInner = player
    ? `<span class="scsos-pname-full">${escapeHtml(name)}</span><span class="scsos-pname-short">${escapeHtml(abbreviateName(name))}</span>`
    : escapeHtml(name);
  const nameHtml = href
    ? `<a class="scsos-pm-card-name" href="${escapeHtml(href)}" title="${escapeHtml(`View ${name} on StatChasers`)}">${nameInner}</a>`
    : `<span class="scsos-pm-card-name">${nameInner}</span>`;

  // The 160px square derivative in a 52px round well; the crest for a team
  // card or a player Sleeper has no photo of.
  const image =
    (player
      ? headshotImg({
          src: null,
          id: player.id,
          className: "scsos-pm-card-img is-headshot",
          alt: "",
          variants: ["160"],
          width: 52,
          height: 52,
          loading: "lazy",
        })
      : null) ??
    `<img class="scsos-pm-card-img" src="${escapeHtml(team.logo)}" alt="" width="44" height="44" loading="lazy" decoding="async" />`;

  const sub = player ? `${team.code} · ${board.position}` : team.fullName;
  const delta = card.delta;
  const deltaTone = delta > 0 ? "is-up" : delta < 0 ? "is-down" : "";

  return (
    `<article class="scsos-pm-card is-${card.tone}" data-card="${card.id}"` +
    ` data-sort-key="${card.sortKey}" data-dir="${card.dir}" data-row="${escapeHtml(card.rowId)}">` +
    `<img class="scsos-pm-card-mark" src="${escapeHtml(team.logo)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />` +
    `<p class="scsos-pm-card-title">${escapeHtml(card.title)}</p>` +
    `<p class="scsos-pm-card-note">${escapeHtml(card.note)}</p>` +
    `<div class="scsos-pm-card-body">` +
    `<div class="scsos-pm-card-who">${image}` +
    `<div class="scsos-pm-card-id">${nameHtml}<span class="scsos-pm-card-sub">${escapeHtml(sub)}</span></div>` +
    `</div>` +
    `<div class="scsos-pm-card-stat">` +
    `<span class="scsos-pm-card-value">${escapeHtml(one(card.afpa))}<small>aFPA</small></span>` +
    `<span class="scsos-pm-card-delta ${deltaTone}">${escapeHtml(signed(delta))} vs avg</span>` +
    `</div>` +
    `</div>` +
    `</article>`
  );
}

function renderPremiumCards(board: SosBoard, state: SosState): string {
  const isPlayer = state.tab === "player";
  const cards = isPlayer ? board.playerCards : board.teamCards;
  if (!cards.length) return "";
  return `<div class="scsos-pm-cards">${cards.map((c) => renderPremiumCard(c, board, isPlayer)).join("")}</div>`;
}

/* ------------------------------------------------- read strip and legend */

function renderPremiumRead(): string {
  const fpa = getFPAUrl();
  return (
    `<div class="scsos-pm-read">` +
    `<p class="scsos-pm-read-text">` +
    `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>` +
    `<span><strong>How to read this board</strong> - Higher aFPA = easier matchup · ` +
    `<strong>vs</strong> = home · <strong>@</strong> = away</span></p>` +
    (fpa
      ? `<a class="scsos-pm-afpa-link" href="${escapeHtml(fpa)}">How aFPA works` +
        `<svg class="scsos-pm-arrow" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path d="M1.5 6h10m0 0L7.5 2m4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`
      : "") +
    `</div>`
  );
}

function renderPremiumLegend(): string {
  const tip =
    `<details class="scsos-pop scsos-pm-tip">` +
    `<summary class="scsos-pm-info" aria-label="How matchup difficulty is calculated">i</summary>` +
    `<div class="scsos-pop-body">${legendTipBody()}</div></details>`;
  const swatches =
    BUCKETS.map(
      (b) =>
        `<li><span class="scsos-pm-swatch" data-bucket="${b}" aria-hidden="true"></span>${BUCKET_LABELS[b]}</li>`,
    ).join("") + `<li><span class="scsos-pm-swatch is-bye" aria-hidden="true"></span>Bye</li>`;
  return (
    `<div class="scsos-pm-legend">` +
    `<div class="scsos-pm-legend-head"><span class="scsos-pm-legend-title">Matchup Strength</span>${tip}</div>` +
    `<ul class="scsos-pm-swatches">${swatches}</ul>` +
    `</div>`
  );
}

function renderPremiumBaseline(board: SosBoard): string {
  const info = baselineInfo(board);
  return (
    `<details class="scsos-pop scsos-pm-baseline" data-phase="${info.phase}">` +
    `<summary class="scsos-pm-baseline-pill"><span class="scsos-pm-dot" aria-hidden="true"></span>${escapeHtml(info.label)}` +
    `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>` +
    `<div class="scsos-pop-body is-right">${baselineBody(info)}</div></details>`
  );
}

/**
 * The finder, for either board: the rows under it are filtered in place by
 * the bundle (client/sos.ts wireFind), which also reveals it - without
 * script it is a box that swallows typing. The noun is what the empty state
 * says nobody is called ("No RB named ...", "No team named ...").
 */
function renderPremiumFinder(board: SosBoard, isPlayer: boolean): string {
  const noun = isPlayer ? board.position : "team";
  const placeholder = isPlayer ? `Find a ${board.position} by name` : "Find a team by name";
  return (
    `<div class="scsos-pm-find" data-scsos-pm-find data-noun="${escapeHtml(noun)}" hidden>` +
    `<label class="scsos-pm-find-field">` +
    `<span class="scsos-sr">${escapeHtml(placeholder)}</span>` +
    `<svg class="scsos-pm-find-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />` +
    `</svg>` +
    `<input class="scsos-pm-find-input" type="search" autocomplete="off" spellcheck="false"` +
    ` placeholder="${escapeHtml(placeholder)}" />` +
    `</label>` +
    `<p class="scsos-pm-find-status" role="status" aria-live="polite"></p>` +
    `</div>`
  );
}

/* ---------------------------------------------------------------- table */

interface Column {
  key: string;
  label: string;
  title: string;
  dir?: "asc" | "desc";
  type?: "text" | "number";
  cls?: string;
}

const RANK_COLUMNS: Column[] = [
  { key: "ovr", label: "OVR", title: "Overall schedule rank, Weeks 1-17. 1 = easiest schedule, 32 = hardest, by average opponent adjusted points allowed vs this position.", cls: "is-rank" },
  { key: "ros", label: "ROS", title: "Rest-of-season schedule rank - remaining games through Week 17. 1 = easiest remaining schedule.", cls: "is-rank" },
  { key: "playoff", label: "Playoff", title: "Fantasy playoff schedule rank, Weeks 15-17. 1 = easiest playoff slate.", cls: "is-rank is-playoff" },
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
  { key: "po2", label: "PO2", title: "Playoff Weeks 16-17: average opponent difficulty (adjusted points allowed).", cls: "is-week is-span" },
  { key: "po3", label: "PO3", title: "Playoff Weeks 15-17: average opponent difficulty (adjusted points allowed).", cls: "is-week is-span" },
];

function th(c: Column, extra = ""): string {
  return (
    `<th scope="col" class="scsos-pm-th${c.cls ? ` ${c.cls}` : ""}${extra}" data-key="${c.key}"` +
    ` data-sort-type="${c.type ?? "number"}" data-sort-dir="${c.dir ?? "asc"}" title="${escapeHtml(c.title)}">` +
    `${escapeHtml(c.label)}</th>`
  );
}

/**
 * One weekly cell: the tier on an inner span so the cell's padding is the
 * gutter between tiles and a sticky column's td can stay opaque. The tier's
 * name is in the cell for a screen reader, which cannot see the color; the
 * title repeats the whole story for a pointer.
 */
function weekCell(cell: SosCell, who: string): string {
  if (cell.isBye) {
    return (
      `<td class="scsos-pm-wk" data-sort=""><span class="scsos-pm-cell is-bye" title="${escapeHtml(`${who}, Week ${cell.week}: bye`)}">BYE</span></td>`
    );
  }
  const opp = cell.opponent!;
  const where = cell.isHome ? "vs" : "at";
  const tier = cell.bucket ? BUCKET_LABELS[cell.bucket] : "Neutral";
  const title =
    `${who}, Week ${cell.week} ${where} ${opp.fullName}: ${one(cell.afpa)} aFPA` +
    (cell.rank !== null ? `, defense rank ${cell.rank} of 32 (1 = toughest)` : "") +
    `, ${tier.toLowerCase()} matchup`;
  return (
    `<td class="scsos-pm-wk" data-sort="${cell.rank ?? ""}">` +
    `<span class="scsos-pm-cell" data-bucket="${cell.bucket ?? "neutral"}" title="${escapeHtml(title)}">` +
    `<span class="scsos-pm-opp">${cell.isHome ? "" : "@"}${escapeHtml(opp.code)}</span>` +
    `<span class="scsos-pm-afpa">${escapeHtml(one(cell.afpa))}</span>` +
    `<span class="scsos-sr">, ${escapeHtml(tier)}</span>` +
    `</span></td>`
  );
}

function spanCell(span: SosSpan | null, label: string): string {
  if (!span) return `<td class="scsos-pm-wk is-span" data-sort=""><span class="scsos-pm-cell is-bye">-</span></td>`;
  return (
    `<td class="scsos-pm-wk is-span" data-sort="${span.rank}">` +
    `<span class="scsos-pm-cell" data-bucket="${span.bucket}" title="${escapeHtml(`${label}: ${one(span.afpa)} average aFPA, rank ${span.rank} of 32 (1 = toughest)`)}">` +
    `<span class="scsos-pm-afpa-only">${escapeHtml(one(span.afpa))}</span>` +
    `<span class="scsos-sr">, ${escapeHtml(BUCKET_LABELS[span.bucket])}</span>` +
    `</span></td>`
  );
}

function rankCell(value: number, muted = false): string {
  return `<td class="scsos-pm-rank${muted ? " is-muted" : ""}" data-sort="${value}">${value}</td>`;
}

/** The team's crest and code, linked to its schedule page when the site has one. */
function teamIdentity(team: NflTeam): string {
  const inner =
    `<img class="scsos-pm-crest" src="${escapeHtml(team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async" />` +
    `<span class="scsos-pm-code">${escapeHtml(team.code)}</span>`;
  const href = teamScheduleHref(team);
  return href
    ? `<a class="scsos-pm-teamlink" href="${escapeHtml(href)}" title="${escapeHtml(`${team.fullName} schedule`)}">${inner}</a>`
    : `<span class="scsos-pm-teamlink">${inner}</span>`;
}

function caption(text: string): string {
  return `<caption class="scsos-sr">${escapeHtml(text)}</caption>`;
}

function renderPremiumTeamTable(board: SosBoard): string {
  const first: Column = { key: "team", label: "Team", title: "NFL team. Each weekly cell shows the opponent's defense difficulty vs this position.", type: "text", cls: "is-first" };
  const columns = [
    ...RANK_COLUMNS,
    ...weekColumns(),
    ...SPAN_COLUMNS,
    { key: "rosavg", label: "ROS", title: "Average opponent adjusted fantasy points allowed over remaining weeks (through Week 17). Higher = easier.", dir: "desc", cls: "is-week is-span" } as Column,
  ];
  const row = (r: SosTeamRow) =>
    `<tr data-pm-row="team-${escapeHtml(r.team.abbreviation)}">` +
    `<th scope="row" class="scsos-pm-first is-team" data-sort="${escapeHtml(r.team.code)}" data-find="${escapeHtml(`${r.team.fullName} ${r.team.code}`)}">` +
    teamIdentity(r.team) +
    `</th>` +
    rankCell(r.overallRank) +
    rankCell(r.rosRank, true) +
    rankCell(r.playoffRank) +
    r.weeks.map((c) => weekCell(c, r.team.fullName)).join("") +
    spanCell(r.po2, "Weeks 16-17") +
    spanCell(r.po3, "Weeks 15-17") +
    (r.ros
      ? `<td class="scsos-pm-wk is-span" data-sort="${r.ros.afpa.toFixed(3)}">` +
        `<span class="scsos-pm-cell" data-bucket="${r.ros.bucket}" title="${escapeHtml(`Rest of season: ${one(r.ros.afpa)} average aFPA`)}">` +
        `<span class="scsos-pm-afpa-only">${escapeHtml(one(r.ros.afpa))}</span></span></td>`
      : `<td class="scsos-pm-wk is-span" data-sort=""><span class="scsos-pm-cell is-bye">-</span></td>`) +
    `</tr>`;

  return (
    `<table class="scsos-pm-table" data-scsos-table data-kind="team">` +
    caption(
      `${board.season} fantasy strength of schedule for all 32 NFL teams against ${POSITION_NAMES[board.position]}, ` +
        `${SCORING_LABELS[board.scoring]} scoring: each week's opponent and that defense's adjusted fantasy points allowed (aFPA). ` +
        `Schedule ranks: 1 is the easiest. Defense ranks: 1 is the toughest.`,
    ) +
    `<thead><tr>${th(first)}${columns.map((c) => th(c)).join("")}</tr></thead>` +
    `<tbody>${board.teams.map(row).join("")}</tbody></table>`
  );
}

function renderPremiumPlayerTable(board: SosBoard): string {
  const first: Column = { key: "player", label: "Player", title: "Player, mapped to their current NFL team. Weekly cells use their team's opponent defense vs this position.", type: "text", cls: "is-first" };
  const columns = [
    { key: "team", label: "Team", title: "Player's current NFL team.", type: "text", cls: "is-teamcol" } as Column,
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
      ? `<a class="scsos-pm-player" href="${escapeHtml(href)}" title="${escapeHtml(`View ${r.name} on StatChasers`)}">${inner}</a>`
      : `<span class="scsos-pm-player" title="${escapeHtml(r.name)}">${inner}</span>`;
    return (
      `<tr data-pm-row="player-${escapeHtml(r.id)}">` +
      `<th scope="row" class="scsos-pm-first is-player" data-sort="${escapeHtml(r.name)}">${name}</th>` +
      `<td class="scsos-pm-teamcell" data-sort="${escapeHtml(r.team.code)}"><span class="scsos-pm-badge" title="${escapeHtml(r.team.fullName)}">${escapeHtml(r.team.code)}</span></td>` +
      rankCell(r.overallRank) +
      rankCell(r.rosRank, true) +
      rankCell(r.playoffRank) +
      r.weeks.map((c) => weekCell(c, r.name)).join("") +
      spanCell(r.po2, "Weeks 16-17") +
      spanCell(r.po3, "Weeks 15-17") +
      `</tr>`
    );
  };

  if (!board.players.length) return `<p class="scsos-pm-empty">No player data found.</p>`;

  return (
    `<table class="scsos-pm-table" data-scsos-table data-kind="player">` +
    caption(
      `${board.season} fantasy strength of schedule for ${board.players.length} ${POSITION_NAMES[board.position]}, ` +
        `${SCORING_LABELS[board.scoring]} scoring, by their team's weekly opponents. ` +
        `Schedule ranks: 1 is the easiest. Defense ranks: 1 is the toughest.`,
    ) +
    `<thead><tr>${th(first)}${columns.map((c) => th(c)).join("")}</tr></thead>` +
    `<tbody>${board.players.map(row).join("")}</tbody></table>`
  );
}

/* --------------------------------------------------------------- assembly */

/**
 * The whole premium block for one view: bar, cards, read strip, legend row
 * (legend, blend badge, finder), then the heatmap in its shell. Inside the
 * original's `.scsos-view`, so a view swap replaces it with the next view's.
 */
export function renderSosPremium(board: SosBoard, state: SosState, options: SosRenderOptions = {}): string {
  const isPlayer = state.tab === "player";
  const table = isPlayer ? renderPremiumPlayerTable(board) : renderPremiumTeamTable(board);
  return (
    `<section class="scsos-pm${isPlayer ? "" : " is-team-board"}" data-scsos-pm aria-label="Strength of schedule, new design">` +
    `<p class="scsos-pm-flag">New Design · Comparison</p>` +
    renderPremiumBar(board, state, options) +
    renderPremiumCards(board, state) +
    renderPremiumRead() +
    `<div class="scsos-pm-legend-row">` +
    renderPremiumLegend() +
    renderPremiumBaseline(board) +
    renderPremiumFinder(board, isPlayer) +
    `</div>` +
    `<div class="scsos-pm-shell"><div class="scsos-pm-scroll">${table}</div></div>` +
    `</section>`
  );
}
