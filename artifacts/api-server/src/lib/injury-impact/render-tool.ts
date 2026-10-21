/**
 * The injury tool: one root, six tabs, the Gridiron Medical + page's
 * arrangement (RESEARCH-Injury-Impact-Analysis at c6a49ce,
 * public/gridiron-medical.html). Overview, Injury database, Current players,
 * Draft simulator and Methodology are the durability tabs (render-gm.ts);
 * Impact study is the research dashboard (render.ts). The React app's
 * seventh tab, Injury history (the impact study's records table), was
 * retired on 2026-10-21 once the Injury database carried its columns and
 * filters; its player page (render-player.ts: weekly reports, play-by-play
 * log, durability profile) stays, opened over whichever tab a name is
 * clicked in, from the tool-level host after the panels.
 *
 * Every tab is rendered by the server; the inactive ones are `hidden` and
 * the bundle switches them. /injury-impact opens on Overview and
 * /injury-database on Injury database, so both addresses (and both
 * shortcodes) show the whole tool.
 */

import { escapeHtml } from "../render";
import { computeViews, defaultDashState, type DashState } from "./dashboard";
import { defaultEventState, defaultRankState, overviewView, presetSafe, rankRows, eventRows, type Durability } from "./durability";
import { renderEventDatabase, renderGmMethodology, renderOverview, renderRankings, renderSimulator } from "./render-gm";
import { renderExecSummary, renderFilterBar, renderMain, renderTabs } from "./render";
import { DEFAULT_WIDTHS, EMPTY_ASSETS, eyebrow, houseText, injuryPageCopy, n0, renderMetaIsland, type InjuryPage, type InjuryRenderOptions, type Widths } from "./render-shared";
import type { InjuryAssets, InjuryDataset } from "./types";

export type ToolTab = "overview" | "database" | "players" | "simulator" | "methodology" | "impact";

export const TOOL_TABS: { id: ToolTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "database", label: "Injury database" },
  { id: "players", label: "Current players" },
  { id: "simulator", label: "Draft simulator" },
  { id: "methodology", label: "Methodology" },
  { id: "impact", label: "Impact study" },
];

/** Hashes the retired tabs answered to, and the tab that now holds their content. */
export const RETIRED_TABS: Record<string, ToolTab> = { history: "database" };

export function isToolTab(value: string | null | undefined): value is ToolTab {
  return TOOL_TABS.some((t) => t.id === value);
}

/** The tab each address opens on. */
export function defaultToolTab(page: InjuryPage): ToolTab {
  return page === "database" ? "database" : "overview";
}

/**
 * The GSIS ids the server prints avatars for: the overview's two lists, the
 * first page of events and the first page of current players.
 */
export function printedPlayerIds(d: Durability | null): string[] {
  const ids: (string | null | undefined)[] = [];
  if (d) {
    const ov = overviewView(d);
    for (const p of [...ov.topLost, ...ov.topDurable]) ids.push(p.id);
    const ev = defaultEventState();
    for (const r of eventRows(d, ev).slice(0, ev.pageSize)) ids.push(r.gsisId);
    const rk = defaultRankState();
    for (const r of rankRows(d, rk).slice(0, rk.pageSize)) ids.push(r.p.id);
  }
  return [...new Set(ids.filter((x): x is string => !!x))];
}

export function renderToolTabs(active: ToolTab): string {
  return (
    `<nav class="scin-tool-tabs" aria-label="Sections" data-scin-tool-tabs><div class="scin-tool-tabs-row" role="tablist">` +
    TOOL_TABS.map((t) => `<a class="scin-tool-tab${t.id === active ? " is-active" : ""}" href="#${t.id}" role="tab" aria-selected="${t.id === active}" data-tool-tab="${t.id}">${escapeHtml(t.label)}</a>`).join("") +
    `</div></nav>`
  );
}

function panel(id: ToolTab, active: ToolTab, body: string, extra = ""): string {
  return `<section class="scin-panel" data-scin-panel="${id}" role="tabpanel"${extra}${id === active ? "" : " hidden"}>${body}</section>`;
}

function toolHeader(page: InjuryPage, d: Durability | null, options: InjuryRenderOptions): string {
  const copy = injuryPageCopy(page);
  return (
    `<header class="scin-head">` +
    eyebrow("Fantasy Football") +
    (options.embed ? "" : `<h1 class="scin-h1">${escapeHtml(copy.h1)}</h1>`) +
    `<p class="scin-lead">${escapeHtml(copy.description)}</p>` +
    (d ? `<p class="scin-source"><strong>${n0(d.players.length)} players</strong> · ${escapeHtml(houseText(d.source))}</p>` : "") +
    `</header>`
  );
}

export interface ToolRenderInput {
  page: InjuryPage;
  ds: InjuryDataset;
  d: Durability | null;
  /** The Impact study's state; the default when the server renders. */
  dash?: DashState;
  widths?: Widths;
}

/** The whole tool at its default state: what the server sends. */
export function renderInjuryTool(input: ToolRenderInput, options: InjuryRenderOptions = {}): string {
  const { page, ds, d } = input;
  const assets: InjuryAssets = options.assets ?? EMPTY_ASSETS;
  const active = defaultToolTab(page);
  const dash = input.dash ?? defaultDashState();
  const widths = input.widths ?? DEFAULT_WIDTHS;
  const views = computeViews(ds, dash);
  const unavailable = `<p class="scin-empty">The durability data is not available right now. Please check back soon.</p>`;

  return (
    `<div class="scin${options.embed ? " is-embed" : ""}" data-scin-root="1" data-scin-page="${page}" data-scin-active="${active}"` +
    (options.dataUrl ? ` data-scin-data="${escapeHtml(options.dataUrl)}"` : "") +
    ` data-scin-assets="${escapeHtml(assets.origin)}">` +
    toolHeader(page, d, options) +
    renderToolTabs(active) +
    panel("overview", active, d ? renderOverview(d, assets) : unavailable) +
    panel("database", active, d ? renderEventDatabase(d, defaultEventState(), assets) : unavailable) +
    panel("players", active, d ? renderRankings(d, defaultRankState(), assets) : unavailable) +
    panel("simulator", active, d ? renderSimulator(d, presetSafe(d)) : unavailable) +
    panel("methodology", active, d ? renderGmMethodology(d) : unavailable) +
    panel(
      "impact",
      active,
      renderExecSummary(views) +
        renderTabs(dash.tab) +
        renderFilterBar(dash.filters, views.seasonOptions) +
        `<div class="scin-main" data-scin-main>${renderMain(ds, views, dash, widths)}</div>` +
        `<div class="scin-tip" data-scin-tip hidden role="tooltip"></div>` +
        `<div class="scin-dialog" data-scin-dialog hidden></div>`,
      ` data-scin-tab="${dash.tab}"`,
    ) +
    // A player's page opens here, over whichever tab the name was clicked in.
    `<div class="scin-player-wrap" data-scin-player-wrap><div class="scin-player-host" data-scin-player hidden></div></div>` +
    renderMetaIsland(page, options) +
    `</div>`
  );
}
