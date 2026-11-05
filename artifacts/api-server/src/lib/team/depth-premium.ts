/**
 * The premium Depth Chart comparison (mak's brief, 2026-11-05,
 * attached_assets/depth1.png): a navy-and-gold banner, pill view tabs, a
 * scheme-and-grades strip, and a POS / STARTER / SECOND / THIRD / FOURTH
 * matrix of compact player cards, with the "Also listed" strip beneath.
 *
 * Presentation only. The sides, slots, rows, designations, experience, name
 * links and grades are the ones the original tab prints, handed in as
 * helpers by renderDepthChart (team-render.ts) so the two blocks can never
 * disagree. Mounted under the original until mak approves it as the design.
 *
 * No captain badge: the chart document carries no captain field, and the
 * brief says to omit the badge rather than infer it.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import type { DepthGradeUnit, TeamPageData } from "../team-render";
import type { DepthRow, DepthView, FootballSide, FootballSlot } from "./depth-charts";

const e = escapeHtml;

export interface DepthPremiumHelpers {
  football: FootballSide[];
  fantasy: DepthView | null;
  summary: { lead: string; tail: string };
  formation: (side: FootballSide) => string | null;
  grades: (view: DepthView["key"]) => DepthGradeUnit[];
  experience: (name: string) => number | null;
  name: (row: DepthRow) => string;
  movement: (row: DepthRow) => string;
  badge: (row: DepthRow) => string;
  sidelined: (row: DepthRow) => boolean;
  pprRank: (pos: string, row: DepthRow) => number | null;
}

const COLUMNS = ["Starter", "Second", "Third", "Fourth"] as const;

/* ------------------------------------------------------------------ icons */

const ICON = {
  group:
    `<svg class="sct-dpp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="8" r="3" fill="currentColor"/>` +
    `<path d="M2.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M10.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  ball:
    `<svg class="sct-dpp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M4.2 19.8c-1.6-1.6-.8-6.9 3.4-11.1S17.5 2.6 19.8 4.2c1.6 1.6.8 6.9-3.4 11.1s-9.7 6.1-12.2 4.5z" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M9 15l6-6M10 12.5l1.5 1.5M12 10.5l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
    `</svg>`,
  cleat:
    `<svg class="sct-dpp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M3 16.5h7l2.5-3.5h3.5c2.5 0 5 1.5 5 3.5H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M3 16.5V13c0-1 1-2 2-2h4l1.5 2.5M5 19.5v-3M9 19.5v-3M13 19.5v-3M17 19.5v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  shield:
    `<svg class="sct-dpp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`,
};

/* ----------------------------------------------------------------- banner */

function banner(data: TeamPageData, h: DepthPremiumHelpers): string {
  const { team } = data;
  const logo = team.logo
    ? `<img class="sct-dpp-logo" src="${e(team.logo)}" alt="" width="64" height="64" loading="lazy" decoding="async">`
    : "";
  return (
    `<header class="sct-dpp-hero">` +
    logo +
    `<span class="sct-dpp-hero-rule" aria-hidden="true"></span>` +
    `<div class="sct-dpp-hero-copy">` +
    `<h2 class="sct-dpp-title">${e(`${team.fullName} Depth Chart`)}</h2>` +
    `<p class="sct-dpp-sub">${e(h.summary.lead || h.summary.tail)}</p>` +
    `</div>` +
    `<span class="sct-dpp-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* ------------------------------------------------------------------ strip */

/**
 * The scheme-and-grades strip of a side: the base personnel the chart was
 * read from, then the two unit grades the efficiency doc gives that side.
 * Special teams has neither, so it gets no strip; the Fantasy view gets
 * the original's note instead.
 */
function strip(h: DepthPremiumHelpers, side: FootballSide): string {
  const formation = h.formation(side);
  const grades = h.grades(side.key);
  if (!formation && grades.length === 0) return "";
  const items: string[] = [];
  if (formation) {
    items.push(
      `<span class="sct-dpp-strip-item">${side.key === "offense" ? ICON.group : ICON.shield}` +
        `<span class="sct-dpp-strip-label">${e(formation)}</span></span>`,
    );
  }
  grades.forEach((g, i) => {
    items.push(
      `<span class="sct-dpp-strip-item" title="${e(g.detail)}">${i === 0 ? ICON.ball : ICON.cleat}` +
        `<span class="sct-dpp-strip-label">${e(g.label)}</span>` +
        `<span class="sct-dpp-grade" data-tone="${g.tone}">${e(g.grade)}</span>` +
        `<span class="sct-visually-hidden">, ${e(g.detail)}</span></span>`,
    );
  });
  return `<div class="sct-dpp-strip">${items.join(`<span class="sct-dpp-strip-sep" aria-hidden="true"></span>`)}</div>`;
}

/* ------------------------------------------------------------------ cards */

/**
 * One player tile: the circular headshot with any designation on its corner,
 * the name (linked when a profile exists), then the service line - "Exp 7",
 * or a ROOKIE tag for a first-year player - with the slot ahead of it in the
 * "Also listed" strip and the PPR rank chip on the Fantasy view.
 */
function card(h: DepthPremiumHelpers, row: DepthRow, options: { starter?: boolean; slot?: string | null; rank?: string | null; ppr?: number | null; pos?: string }): string {
  const sidelined = h.sidelined(row);
  const exp = h.experience(row.name);
  const service =
    exp === null ? "" : exp === 0 ? `<span class="sct-dpp-rookie">Rookie</span>` : `<span class="sct-dpp-exp">${e(`Exp ${exp}`)}</span>`;
  const slot = options.slot ? `<span class="sct-dpp-slot">${e(options.slot)}</span>` : "";
  const rank = options.rank ? `<span class="sct-dpp-rank">${e(options.rank)}</span>` : "";
  const ppr =
    options.ppr !== null && options.ppr !== undefined
      ? `<span class="sct-dpp-ppr" title="League rank by PPR points per game this season"><span class="sct-dpp-ppr-key">PPR</span>${e(`${options.pos ?? ""}${options.ppr}`)}</span>`
      : "";
  const sub = rank + slot + ppr + service;
  const photo =
    headshotImg({
      src: row.headshot,
      className: "sct-dpp-photo",
      alt: "",
      variants: ["160"],
      width: 34,
      height: 34,
      loading: "lazy",
    }) ?? "";
  return (
    `<li class="sct-dpp-card${options.starter ? " is-starter" : ""}${sidelined ? " is-sidelined" : ""}" data-rank="${row.rank}">` +
    `<span class="sct-dpp-avatar"><span class="sct-dpp-well">${photo}</span>${h.badge(row)}</span>` +
    `<span class="sct-dpp-body">` +
    `<span class="sct-dpp-name">${h.name(row)}${row.movement === "new" ? `<span class="sct-dpp-new">New</span>` : ""}${h.movement(row)}</span>` +
    (sub ? `<span class="sct-dpp-sub">${sub}</span>` : "") +
    `</span>` +
    `</li>`
  );
}

/* ----------------------------------------------------------------- matrix */

function slotRow(h: DepthPremiumHelpers, slot: FootballSlot): string {
  const shown = slot.rows.slice(0, COLUMNS.length);
  const cells = shown.map((row, i) => card(h, row, { starter: i === 0 })).join("");
  const blanks = COLUMNS.length - shown.length;
  return (
    `<div class="sct-dpp-row" data-pos="${e(slot.pos)}" data-slot="${e(slot.key)}">` +
    `<h4 class="sct-dpp-pos"><span class="sct-dpp-pos-name">${e(slot.pos)}</span><span class="sct-visually-hidden"> - ${e(slot.label)}</span></h4>` +
    `<ol class="sct-dpp-cells">${cells}${blanks > 0 ? `<li class="sct-dpp-blank" aria-hidden="true"></li>`.repeat(blanks) : ""}</ol>` +
    `</div>`
  );
}

function footballPanel(data: TeamPageData, h: DepthPremiumHelpers, side: FootballSide): string {
  const { team } = data;
  const overflow = side.slots.flatMap((slot) =>
    slot.rows.slice(COLUMNS.length).map((row) => card(h, row, { slot: `${slot.pos}${row.rank}` })),
  );
  return (
    `<section class="sct-dpp-panel" data-sct-dc-panel="${side.key}" aria-label="${e(`${team.fullName} ${side.label} Depth Chart`)}">` +
    strip(h, side) +
    (side.folded
      ? `<p class="sct-dpp-note">Listed by position group; the club's individual slots were not in this refresh.</p>`
      : "") +
    `<div class="sct-dpp-matrix">` +
    `<div class="sct-dpp-scroll" tabindex="0">` +
    `<div class="sct-dpp-inner">` +
    `<div class="sct-dpp-head" aria-hidden="true"><span class="sct-dpp-head-pos">Pos</span>` +
    COLUMNS.map((label) => `<span>${label}</span>`).join("") +
    `</div>` +
    side.slots.map((slot) => slotRow(h, slot)).join("") +
    `</div>` +
    `</div>` +
    (overflow.length
      ? `<div class="sct-dpp-more">` +
        `<h4 class="sct-dpp-more-title">Also listed<span class="sct-dpp-more-count"> · ${overflow.length}</span></h4>` +
        `<ol class="sct-dpp-cells is-loose">${overflow.join("")}</ol>` +
        `</div>`
      : "") +
    `</div>` +
    `</section>`
  );
}

/**
 * The Fantasy view keeps its own meaning: one row per skill position, the
 * cards in StatChasers' order, each tagged WR1, WR2... with the player's
 * league-wide PPR rank beside it. A ranking, so no Starter / Second head.
 */
function fantasyPanel(data: TeamPageData, h: DepthPremiumHelpers, view: DepthView): string {
  const { team } = data;
  const rows = view.columns
    .filter((column) => column.rows.length)
    .map(
      (column) =>
        `<div class="sct-dpp-row is-fan" data-pos="${e(column.pos)}">` +
        `<h4 class="sct-dpp-pos"><span class="sct-dpp-pos-name">${e(column.pos)}</span><span class="sct-visually-hidden"> - ${e(column.label)}</span></h4>` +
        `<ol class="sct-dpp-cells is-fan">` +
        column.rows.map((row, i) => card(h, row, { starter: i === 0, rank: `${column.pos}${row.rank}`, ppr: h.pprRank(column.pos, row), pos: column.pos })).join("") +
        `</ol>` +
        `</div>`,
    )
    .join("");
  return (
    `<section class="sct-dpp-panel" data-sct-dc-panel="fantasy" aria-label="${e(`${team.fullName} Fantasy Depth Chart`)}">` +
    `<p class="sct-dpp-note">StatChasers' fantasy hierarchy at each skill position. ` +
    `WR1, WR2 and WR3 rank players by fantasy value, so the order can differ from the starting slots on the team depth chart.</p>` +
    `<div class="sct-dpp-matrix"><div class="sct-dpp-scroll" tabindex="0"><div class="sct-dpp-inner is-fan">` +
    `<div class="sct-dpp-head" aria-hidden="true"><span class="sct-dpp-head-pos">Pos</span><span>StatChasers fantasy hierarchy</span></div>` +
    rows +
    `</div></div></div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- section */

export function renderDepthPremium(data: TeamPageData, h: DepthPremiumHelpers): string {
  const panels: Array<{ key: string; label: string; html: string }> = [
    ...h.football.map((side) => ({ key: side.key, label: side.label, html: footballPanel(data, h, side) })),
    ...(h.fantasy ? [{ key: "fantasy", label: "Fantasy", html: fantasyPanel(data, h, h.fantasy) }] : []),
  ];
  if (panels.length === 0) return "";
  const tabs =
    `<div class="sct-dpp-tabs" role="group" aria-label="Depth chart view">` +
    panels
      .map(
        (panel, i) =>
          `<button type="button" class="sct-dpp-tab" data-sct-dc-view="${panel.key}" aria-pressed="${i === 0 ? "true" : "false"}">${e(panel.label)}</button>`,
      )
      .join("") +
    `</div>`;
  return (
    `<div class="sct-dpp" data-sct-depth-premium>` +
    `<p class="sct-dpp-flag">New design - comparison</p>` +
    banner(data, h) +
    `<div class="sct-dpp-views" data-sct-dc>${tabs}${panels.map((p) => p.html).join("")}</div>` +
    `</div>`
  );
}
