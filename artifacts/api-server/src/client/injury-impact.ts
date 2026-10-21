/**
 * Injury impact bundle: the seven-tab injury tool (lib/injury-impact/
 * render-tool.ts): Overview, Injury database, Current players, Draft
 * simulator, Methodology, Impact study and Injury history.
 *
 * The page is complete before this runs: every tab, the default view, every
 * number in the HTML. What the two source apps' state did (the React
 * dashboard's and the Gridiron Medical + page's), this does over that markup:
 *
 * Tool:
 * 0. **The tool tabs**: showing one panel, the tab name in the hash. A
 *    research-question anchor (#q-...) opens the Impact study.
 *
 * Dashboard:
 * 1. **The question tabs**: showing one section, scrolling to anchors, the
 *    hash in the address as the app kept it.
 * 2. **The filters** (season, ADP range, min games): the analysis slice is
 *    fetched once (/embed/injury-impact/data/analysis), every view is
 *    recomputed with lib/injury-impact/model.ts and the sections redrawn with
 *    lib/injury-impact/render.ts, the module the server drew the default with.
 * 3. **The tables**: sortable headers, the injury-type toolbar and its search,
 *    the "view all types" toggle.
 * 4. **The charts**: legend toggles, a hover read-out per band or point, and a
 *    redraw at the column's real width.
 * 5. **The simulation**: its model, strategy chips, sort and trend metric.
 * 6. **Player search**: a dropdown over the packed index, opening a player's
 *    panel in a dialog from /data/player/<gsis>.
 *
 * The player page (the React app's Injury history tab, retired 2026-10-21;
 * its records table lives on in the Injury database):
 * 7. **The inline player panel** with a "Back" that returns to the tab it
 *    opened over. A player's page carries the durability profile under the
 *    reports. The standalone database page's filters, sort, paging and CSV
 *    (mountDatabase) still drive it.
 *
 * Durability tabs (the durability dataset, /data/gridiron, is fetched on the
 * first interaction and hydrated with lib/injury-impact/durability.ts, the
 * model the server scored the default views with):
 * 8. **The event database and the current players**: search, filters, sorts
 *    and paging, redrawn with lib/injury-impact/render-gm.ts.
 * 9. **The draft simulator**: the roster (search to add, presets, remove)
 *    and the 2,000-season run.
 * 10. **Player names** anywhere in those tabs open the player's page over
 *    the current tab.
 *
 * Nothing is written to the URL but the tab or question hash.
 */

import { wireFrameHeight } from "./enhance";
import { computeViews, defaultDashState, toggleHidden, type DashState, type Views } from "../lib/injury-impact/dashboard";
import {
  INJ_SORT_MAP,
  QUESTION_NAV,
  nextSort,
  parseFilters,
  tabForAnchor,
  type QuestionTab,
  type SimSortKey,
  type SimTrendMetric,
} from "../lib/injury-impact/model";
import {
  DEFAULT_WIDTHS,
  renderAdditionalTrends,
  renderAdpScatter,
  renderDraft,
  renderExecSummary,
  renderExperimentalSim,
  renderFinalSummary,
  renderInjuryTypeTable,
  renderMain,
  renderMatter,
  renderOutcomes,
  renderPositionTable,
  renderReturn,
  renderRisk,
  renderSafer,
  type Widths,
} from "../lib/injury-impact/render";
import { renderDraftSim } from "../lib/injury-impact/render-sim";
import { renderPlayerHeader, renderPlayerReports, type PlayerPanelState } from "../lib/injury-impact/render-player";
import { ALL, dbRecords, dbView, defaultDbState, renderDbFilters, renderDbTable, dbOptions, toCsv, type DbRow, type DbState } from "../lib/injury-impact/render-database";
import {
  ROSTER_CAP,
  defaultEventState,
  defaultRankState,
  eventSortStart,
  fmtScore,
  hydrate,
  nameKey,
  presetSafe,
  presetUpside,
  rankSortStart,
  runSim,
  type Durability,
  type EventSortKey,
  type EventState,
  eventCsv,
  eventRows,
  type GridironDataset,
  rankCsv,
  rankRows,
  type RankSortKey,
  type RankState,
} from "../lib/injury-impact/durability";
import { renderEventFilters, renderEventTable, renderProfileSection, renderRankFilters, renderRankTable, renderRoster, renderSimResult } from "../lib/injury-impact/render-gm";
import { RETIRED_TABS, isToolTab, type ToolTab } from "../lib/injury-impact/render-tool";
import { MIN_SEARCH_LEN, searchPlayers, seasonSpan, type PackedSearchRow } from "../lib/injury-impact/player";
import { avatar } from "../lib/injury-impact/render-shared";
import type { InjuryAssets, InjuryDataset, PlayerSlice } from "../lib/injury-impact/types";
import { escapeHtml } from "../lib/render";

const ROOT_SELECTOR = "[data-scin-root]";

type AnalysisSlice = Omit<InjuryDataset, "tagImpact" | "draftSim">;

interface Shared {
  root: HTMLElement;
  dataUrl: string;
  assets: InjuryAssets;
  tip: HTMLElement | null;
  loading: Map<string, Promise<unknown>>;
  index: PackedSearchRow[] | null;
}

/* ---------------------------------------------------------------- helpers */

function fetchJson<T>(s: Shared, url: string): Promise<T | null> {
  const pending = s.loading.get(url);
  if (pending) return pending as Promise<T | null>;
  const p = fetch(url, { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null)
    .finally(() => s.loading.delete(url));
  s.loading.set(url, p);
  return p;
}

async function ensureIndex(s: Shared): Promise<PackedSearchRow[]> {
  if (s.index) return s.index;
  const idx = await fetchJson<PackedSearchRow[]>(s, `${s.dataUrl}/search`);
  s.index = Array.isArray(idx) ? idx : [];
  return s.index;
}

function widths(root: HTMLElement): Widths {
  const main = root.querySelector<HTMLElement>("[data-scin-main]");
  const w = main?.clientWidth || root.clientWidth || DEFAULT_WIDTHS.full;
  const full = Math.max(280, Math.min(1400, w - 2));
  const half = Math.max(280, w >= 760 ? Math.floor((w - 24) / 2) : full);
  return { full, half };
}

/* ---------------------------------------------------------------- tooltip */

function wireTips(s: Shared): void {
  const tip = s.tip;
  if (!tip) return;
  const show = (hit: Element, x: number, y: number) => {
    const html = hit.getAttribute("data-tip");
    if (!html) return hide();
    tip.innerHTML = html;
    tip.hidden = false;
    const host = s.root.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = x - host.left + 14;
    let top = y - host.top - th / 2;
    if (left + tw > host.width - 4) left = x - host.left - tw - 14;
    left = Math.max(4, Math.min(left, host.width - tw - 4));
    top = Math.max(0, top);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const hide = () => {
    tip.hidden = true;
  };
  s.root.addEventListener("mousemove", (e) => {
    const hit = (e.target as HTMLElement | null)?.closest?.(".scin-hit");
    if (!hit || !s.root.contains(hit)) {
      if (!tip.hidden) hide();
      return;
    }
    show(hit, e.clientX, e.clientY);
  });
  s.root.addEventListener("mouseleave", hide);
  // A tap on a touch screen.
  s.root.addEventListener("click", (e) => {
    const hit = (e.target as HTMLElement | null)?.closest?.(".scin-hit");
    if (hit && s.root.contains(hit) && !(hit as HTMLElement).closest("button, a")) show(hit, e.clientX, e.clientY);
  });
}

/* ---------------------------------------------------------- image errors */

function wireImageFallback(root: HTMLElement): void {
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLImageElement;
      if (img.tagName !== "IMG" || !img.dataset["fallback"]) return;
      const span = img.parentElement;
      if (span?.classList.contains("scin-avatar")) {
        span.classList.add("is-text");
        span.textContent = img.dataset["fallback"];
      } else img.replaceWith(document.createTextNode(img.dataset["fallback"]));
    },
    true,
  );
}

/* ----------------------------------------------------------- player panel */

interface PanelHost {
  s: Shared;
  slice: PlayerSlice;
  state: PlayerPanelState;
  body: HTMLElement;
}

function panelAssets(s: Shared, slice: PlayerSlice & { assets?: InjuryAssets }): InjuryAssets {
  if (slice.assets) return { ...slice.assets, origin: slice.assets.origin || s.assets.origin };
  return s.assets;
}

function drawPanel(h: PanelHost): void {
  h.body.innerHTML = renderPlayerReports(h.slice, h.state);
}

function wirePanel(h: PanelHost): void {
  h.body.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-pp-toggle]");
    if (!btn) return;
    const which = btn.dataset["ppToggle"];
    if (which === "weekly") h.state.showWeekly = !h.state.showWeekly;
    if (which === "plays") h.state.showPlays = !h.state.showPlays;
    const body = h.body.querySelector<HTMLElement>(`[data-pp-body="${which}"]`);
    const open = which === "weekly" ? h.state.showWeekly : h.state.showPlays;
    if (body) body.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.querySelector(".scin-chev")?.classList.toggle("is-open", open);
  });
}

async function loadPlayer(s: Shared, gsisId: string | null, name: string): Promise<(PlayerSlice & { assets?: InjuryAssets }) | null> {
  if (!gsisId) return null;
  return fetchJson<PlayerSlice & { assets?: InjuryAssets }>(s, `${s.dataUrl}/player/${encodeURIComponent(gsisId)}`).then((p) => (p ? { ...p, name: p.name || name } : null));
}

function playerShell(s: Shared, slice: PlayerSlice | null, name: string, gsisId: string | null, back: string): string {
  const head = slice ? renderPlayerHeader(slice, panelAssets(s, slice)) : `<div class="scin-pp-head">${avatar(gsisId, name, s.assets, 44)}<div><h2 class="scin-pp-name">${escapeHtml(name)}</h2></div></div>`;
  const body = slice ? "" : `<p class="scin-empty">No linked injury records for ${escapeHtml(name)}.</p>`;
  return `${back}${head}<div data-pp-panel>${body}</div>`;
}

/* ------------------------------------------------------------- search box */

function wireSearch(s: Shared, onPick: (gsisId: string, name: string) => void): void {
  const box = s.root.querySelector<HTMLElement>("[data-scin-search]");
  const input = box?.querySelector<HTMLInputElement>("[data-search-input]");
  const list = box?.querySelector<HTMLElement>("[data-search-list]");
  if (!box || !input || !list) return;
  let timer = 0;
  let focused = false;
  const close = () => {
    list.hidden = true;
  };
  const draw = async () => {
    const q = input.value.trim();
    if (!focused || q.length < 1) return close();
    list.hidden = false;
    if (q.length < MIN_SEARCH_LEN) {
      list.innerHTML = `<p class="scin-search-note">Type at least ${MIN_SEARCH_LEN} letters to search.</p>`;
      return;
    }
    if (!s.index) list.innerHTML = `<p class="scin-search-note">Loading players…</p>`;
    const idx = await ensureIndex(s);
    if (input.value.trim() !== q) return;
    if (!idx.length) {
      list.innerHTML = `<p class="scin-search-note is-error">Couldn't load player data. Please try again.</p>`;
      return;
    }
    const results = searchPlayers(idx, q);
    if (!results.length) {
      list.innerHTML = `<p class="scin-search-note">No players found.</p>`;
      return;
    }
    list.innerHTML =
      `<p class="scin-search-head">${results.length} player${results.length === 1 ? "" : "s"}</p>` +
      results
        .map(
          (p) =>
            `<button type="button" class="scin-search-item" data-pick="${escapeHtml(p.gsisId)}" data-pick-name="${escapeHtml(p.fullName)}">${avatar(p.gsisId, p.fullName, s.assets, 24)}${p.position ? `<span class="scin-pos-chip" data-pos="${escapeHtml(p.position)}">${escapeHtml(p.position)}</span>` : ""}<span class="scin-search-name">${escapeHtml(p.fullName)}</span><span class="scin-search-meta">${escapeHtml([p.team, seasonSpan(p.seasons)].filter(Boolean).join(" · "))}</span></button>`,
        )
        .join("");
  };
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void draw(), 200);
  });
  input.addEventListener("focus", () => {
    focused = true;
    void draw();
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      focused = false;
      close();
    }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.blur();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      const items = [...list.querySelectorAll<HTMLElement>(".scin-search-item")];
      if (!items.length) return;
      const cur = items.findIndex((it) => it.classList.contains("is-active"));
      if (e.key === "Enter") {
        const pick = items[cur >= 0 ? cur : 0];
        if (pick) pick.click();
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, cur + 1) : Math.max(0, cur - 1);
      items.forEach((it, i) => it.classList.toggle("is-active", i === next));
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-pick]");
    if (!btn) return;
    input.value = "";
    close();
    onPick(btn.dataset["pick"] ?? "", btn.dataset["pickName"] ?? "");
  });
}

/* --------------------------------------------------------------- dashboard */

interface Dash {
  s: Shared;
  state: DashState;
  ds: InjuryDataset | null;
  views: Views | null;
  /** The tag-impact and simulation markup are the server's; the sim redraws from this slice. */
  simData: InjuryDataset["draftSim"];
  lastWidth: number;
}

function el<T extends HTMLElement = HTMLElement>(root: HTMLElement, sel: string): T | null {
  return root.querySelector<T>(sel);
}

async function ensureAnalysis(d: Dash): Promise<boolean> {
  if (d.ds) return true;
  d.s.root.setAttribute("aria-busy", "true");
  const slice = await fetchJson<AnalysisSlice>(d.s, `${d.s.dataUrl}/analysis`);
  d.s.root.removeAttribute("aria-busy");
  if (!slice || !slice.analysis) return false;
  d.ds = { ...slice, tagImpact: null, draftSim: d.simData };
  return true;
}

function recompute(d: Dash): void {
  if (!d.ds) return;
  d.views = computeViews(d.ds, d.state);
}

/** Keep the folds that are open across a redraw. */
function rememberOpen(d: Dash): void {
  d.state.open = [...d.s.root.querySelectorAll<HTMLDetailsElement>("details[data-fold][open]")].map((x) => x.dataset["fold"] ?? "").filter(Boolean);
}

function redrawMain(d: Dash): void {
  if (!d.ds || !d.views) return;
  rememberOpen(d);
  const main = el(d.s.root, "[data-scin-main]");
  if (!main) return;
  const w = widths(d.s.root);
  // The tag-impact and simulation markup are the server's when their slices
  // are not loaded (neither is in the analysis slice); carry them over.
  const tag = main.querySelector("#q-tag")?.outerHTML ?? "";
  const sim = d.simData ? "" : (main.querySelector('[data-section="sim"]')?.outerHTML ?? "");
  main.innerHTML = renderMain(d.ds, d.views, d.state, w);
  if (tag) {
    const slot = main.querySelector("#q-tag");
    if (slot) slot.outerHTML = tag;
  }
  if (sim) {
    const slot = main.querySelector('[data-section="methodology"]');
    if (slot) slot.insertAdjacentHTML("beforebegin", sim);
  }
  const exec = el(d.s.root, ".scin-exec-grid");
  if (exec) exec.outerHTML = renderExecSummary(d.views);
}

function redrawSection(d: Dash, name: string): void {
  if (!d.ds || !d.views) return;
  rememberOpen(d);
  const w = widths(d.s.root);
  const sec = el(d.s.root, `[data-section="${name}"]`);
  if (!sec) return;
  let html = "";
  switch (name) {
    case "q-safer":
      html = renderSafer(d.ds, d.views, d.state, w);
      break;
    case "q-risk":
      html = renderRisk(d.views, d.state, w);
      break;
    case "q-matter": {
      const tag = sec.querySelector("#q-tag")?.outerHTML ?? "";
      sec.outerHTML = renderMatter(d.ds, d.views, d.state, w);
      const slot = el(d.s.root, "#q-tag");
      if (slot && tag) slot.outerHTML = tag;
      return;
    }
    case "q-return":
      html = renderReturn(d.ds, d.views, d.state);
      break;
    case "q-draft":
      html = renderDraft(d.views, d.state, w);
      break;
    case "final":
      html = renderFinalSummary(d.views);
      break;
    case "outcomes":
      html = renderOutcomes(d.views);
      break;
    case "additional":
      html = renderAdditionalTrends(d.views, d.state, w);
      break;
    case "adp-scatter":
      html = renderAdpScatter(d.views, d.state, w);
      break;
    case "sim":
      if (!d.simData) return;
      html = renderExperimentalSim(d.ds, d.state, w);
      break;
    default:
      return;
  }
  sec.outerHTML = html;
}

/** The chart a legend belongs to lives in one section; redraw that section. */
const CHART_SECTION: Record<string, string> = {
  trend: "q-safer",
  burden: "q-safer",
  km: "q-risk",
  ageKM: "q-risk",
  workloadKM: "q-risk",
  frontier: "q-draft",
  gamesMissed: "additional",
  adpTier: "additional",
  gamesMissedLine: "additional",
  injuryRate: "additional",
  adpScatter: "adp-scatter",
};

function setTab(d: Dash, tab: QuestionTab, scrollTo: string | null, fromBar: boolean): void {
  d.state.tab = tab;
  d.s.root.dataset["scinTab"] = tab;
  d.s.root.querySelectorAll<HTMLElement>("[data-tab]").forEach((a) => {
    const on = a.dataset["tab"] === tab;
    a.classList.toggle("is-active", on);
    a.setAttribute("aria-selected", String(on));
  });
  const show = new Set<string>([tab === "q-recur" ? "q-risk" : tab]);
  if (tab === "q-matter") show.add("injury-types");
  for (const name of ["q-safer", "q-risk", "q-matter", "injury-types", "q-return", "q-draft"]) {
    const sec = el(d.s.root, `[data-section="${name}"]`);
    if (sec) sec.hidden = !show.has(name);
  }
  d.s.root.querySelectorAll<HTMLElement>("[data-subtab]").forEach((x) => {
    const sub = x.dataset["subtab"];
    x.hidden = tab === "q-recur" ? sub !== "q-recur" : sub === "q-recur";
  });
  if (scrollTo) {
    history.replaceState(null, "", `#${scrollTo}`);
    requestAnimationFrame(() => {
      const target = scrollTo === tab ? el(d.s.root, "[data-scin-main]") : document.getElementById(scrollTo);
      if (target && (!fromBar || target.getBoundingClientRect().top < 0)) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  // The visible charts were drawn at a nominal width when hidden; take the column's now.
  redrawVisibleCharts(d);
}

function redrawVisibleCharts(d: Dash): void {
  if (!d.views) return;
  const w = widths(d.s.root).full;
  if (Math.abs(w - d.lastWidth) < 8) return;
  d.lastWidth = w;
  const active = d.state.tab === "q-recur" ? "q-risk" : d.state.tab;
  for (const name of [active, "additional", "adp-scatter", "sim"]) redrawSection(d, name);
  if (d.state.tab === "q-matter") redrawSection(d, "q-matter");
}

async function onFilters(d: Dash, change: Partial<DashState["filters"]>): Promise<void> {
  const next = parseFilters({ season: change.season ?? d.state.filters.season, adpLo: (change.adp ?? d.state.filters.adp)[0], adpHi: (change.adp ?? d.state.filters.adp)[1], minGames: change.minGames ?? d.state.filters.minGames });
  if (JSON.stringify(next) === JSON.stringify(d.state.filters)) return;
  d.state.filters = next;
  const ok = await ensureAnalysis(d);
  if (JSON.stringify(next) !== JSON.stringify(d.state.filters)) return;
  if (!ok) {
    const main = el(d.s.root, "[data-scin-main]");
    if (main) main.insertAdjacentHTML("afterbegin", `<div class="scin-callout is-amber"><p>The filtered view could not be loaded. Please try again.</p></div>`);
    return;
  }
  recompute(d);
  redrawMain(d);
}

function readRange(d: Dash): void {
  const lo = el<HTMLInputElement>(d.s.root, "[data-adp-lo]");
  const hi = el<HTMLInputElement>(d.s.root, "[data-adp-hi]");
  const out = el(d.s.root, "[data-adp-out]");
  if (!lo || !hi) return;
  let a = Number(lo.value);
  let b = Number(hi.value);
  if (a > b) [a, b] = [b, a];
  if (out) out.textContent = `${a}-${b}`;
  const dual = lo.parentElement;
  if (dual) {
    dual.style.setProperty("--lo", `${((a - 1) / 179) * 100}%`);
    dual.style.setProperty("--hi", `${((b - 1) / 179) * 100}%`);
  }
}

function wireDashboard(d: Dash): void {
  const root = d.s.root;

  // Tabs and in-page anchors.
  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || !root.contains(a)) return;
    const anchor = a.getAttribute("href")?.slice(1) ?? "";
    const tab = tabForAnchor(anchor);
    if (!tab) return;
    e.preventDefault();
    setTab(d, tab, anchor, a.getAttribute("role") === "tab");
  });
  window.addEventListener("hashchange", () => {
    const anchor = window.location.hash.slice(1);
    const tab = tabForAnchor(anchor);
    if (tab) setTab(d, tab, anchor, false);
  });
  const initial = tabForAnchor(window.location.hash.slice(1));
  if (initial && initial !== d.state.tab) setTab(d, initial, window.location.hash.slice(1), false);

  // Filters.
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const ds = t.dataset;
    if (ds["season"] !== undefined) void onFilters(d, { season: (t as HTMLSelectElement).value });
    else if (ds["adpLo"] !== undefined || ds["adpHi"] !== undefined) {
      readRange(d);
      const lo = el<HTMLInputElement>(root, "[data-adp-lo]");
      const hi = el<HTMLInputElement>(root, "[data-adp-hi]");
      if (lo && hi) void onFilters(d, { adp: [Math.min(Number(lo.value), Number(hi.value)), Math.max(Number(lo.value), Number(hi.value))] });
    } else if (ds["minGames"] !== undefined) {
      const out = el(root, "[data-min-out]");
      if (out) out.textContent = (t as HTMLInputElement).value;
      void onFilters(d, { minGames: Number((t as HTMLInputElement).value) });
    } else if (ds["injCategory"] !== undefined) {
      d.state.injuryCategory = (t as HTMLSelectElement).value;
      void withViews(d, () => redrawInjTable(d));
    } else if (ds["injPos"] !== undefined) {
      d.state.injuryPos = (t as HTMLSelectElement).value;
      d.state.injuryCategory = "all";
      void withViews(d, () => redrawSection(d, "injury-types"), true);
    } else if (ds["injSortSelect"] !== undefined) {
      d.state.injSort = INJ_SORT_MAP[(t as HTMLSelectElement).value] ?? { key: "points_lost", dir: "desc" };
      void withViews(d, () => redrawInjTable(d));
    } else if (ds["simModel"] !== undefined || ds["simTrend"] !== undefined) {
      // handled as buttons below
    }
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.dataset["adpLo"] !== undefined || t.dataset["adpHi"] !== undefined) readRange(d);
    else if (t.dataset["minGames"] !== undefined) {
      const out = el(root, "[data-min-out]");
      if (out) out.textContent = (t as HTMLInputElement).value;
    } else if (t.dataset["injSearch"] !== undefined) {
      d.state.injurySearch = (t as HTMLInputElement).value;
      void withViews(d, () => redrawInjTable(d));
    }
  });

  // Buttons: sorts, legends, toggles, sim controls.
  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("button");
    if (!btn || !root.contains(btn)) return;
    const ds = btn.dataset;
    if (ds["posSort"] !== undefined) {
      d.state.posSort = nextSort(d.state.posSort, ds["posSort"]);
      void withViews(d, () => {
        const block = el(root, "[data-pos-table]");
        if (block && d.views) block.outerHTML = renderPositionTable(d.views.sortedPos, d.state.posSort);
      });
    } else if (ds["injSort"] !== undefined) {
      d.state.injSort = nextSort(d.state.injSort, ds["injSort"]);
      void withViews(d, () => redrawInjTable(d));
    } else if (ds["injToggle"] !== undefined) {
      d.state.showAllInjuries = !d.state.showAllInjuries;
      void withViews(d, () => redrawInjTable(d));
    } else if (ds["legend"] !== undefined && ds["series"] !== undefined) {
      toggleHidden(d.state, ds["legend"], ds["series"]);
      const section = CHART_SECTION[ds["legend"]];
      void withViews(d, () => (section ? redrawSection(d, section) : undefined));
    } else if (ds["simModel"] !== undefined) {
      d.state.sim.model = ds["simModel"] as DashState["sim"]["model"];
      redrawSim(d);
    } else if (ds["simTrend"] !== undefined) {
      d.state.sim.trendMetric = ds["simTrend"] as SimTrendMetric;
      redrawSim(d);
    } else if (ds["simSort"] !== undefined) {
      d.state.sim.sortKey = ds["simSort"] as SimSortKey;
      redrawSim(d);
    } else if (ds["simStrategy"] !== undefined) {
      const k = ds["simStrategy"];
      d.state.sim.hidden = d.state.sim.hidden.includes(k) ? d.state.sim.hidden.filter((x) => x !== k) : [...d.state.sim.hidden, k];
      redrawSim(d);
    }
  });

  // The collapsed scatter and simulation are drawn on their first open.
  root.addEventListener(
    "toggle",
    (e) => {
      const det = e.target as HTMLDetailsElement;
      if (!det.open || !det.querySelector("[data-lazy]")) return;
      const fold = det.dataset["fold"];
      if (fold === "adp-scatter") void withViews(d, () => redrawSection(d, "adp-scatter"));
      else if (fold === "experimental-sim") redrawSim(d);
    },
    true,
  );

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void withViews(d, () => redrawVisibleCharts(d)), 150);
  });

  // The server drew the charts at a nominal width; take the column's now.
  const w = widths(root).full;
  if (Math.abs(w - DEFAULT_WIDTHS.full) >= 8) void withViews(d, () => redrawVisibleCharts(d));
  else d.lastWidth = w;

  // Player search opens a dialog.
  const dialog = el(root, "[data-scin-dialog]");
  wireSearch(d.s, (gsisId, name) => void openDialog(d, dialog, gsisId, name));
  dialog?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-dialog-close]") || t === dialog) closeDialog(dialog);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialog && !dialog.hidden) closeDialog(dialog);
  });
}

/** Load the analysis if needed, then run `fn` (the first interaction pays for the fetch). */
async function withViews(d: Dash, fn: () => void, recomputeFirst = true): Promise<void> {
  const ok = await ensureAnalysis(d);
  if (!ok) return;
  if (recomputeFirst || !d.views) recompute(d);
  fn();
}

function redrawInjTable(d: Dash): void {
  if (!d.views) return;
  const block = el(d.s.root, "[data-inj-table]");
  if (block) block.outerHTML = renderInjuryTypeTable(d.views, d.state);
}

async function ensureSim(d: Dash): Promise<boolean> {
  if (d.simData) return true;
  const sim = await fetchJson<InjuryDataset["draftSim"]>(d.s, `${d.s.dataUrl}/sim`);
  if (sim && Array.isArray(sim.strategies)) {
    d.simData = sim;
    if (d.ds) d.ds.draftSim = sim;
  }
  return !!d.simData;
}

function redrawSim(d: Dash): void {
  void ensureSim(d).then((ok) => {
    if (!ok || !d.simData) return;
    rememberOpen(d);
    const sim = el(d.s.root, "[data-scin-sim]");
    if (sim) sim.outerHTML = renderDraftSim(d.simData, d.state.sim, widths(d.s.root), d.state.open.includes("sim-how"));
    else {
      const lazy = el(d.s.root, '[data-lazy="experimental-sim"]');
      if (lazy) lazy.outerHTML = renderDraftSim(d.simData, d.state.sim, widths(d.s.root), d.state.open.includes("sim-how"));
    }
  });
}

async function openDialog(d: Dash, dialog: HTMLElement | null, gsisId: string, name: string): Promise<void> {
  if (!dialog) return;
  dialog.hidden = false;
  document.body.classList.add("scin-modal-open");
  const back = `<button type="button" class="scin-dialog-close" data-dialog-close aria-label="Close">×</button>`;
  dialog.innerHTML = `<div class="scin-dialog-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(name)} injury history">${playerShell(d.s, null, name, gsisId, back)}<p class="scin-empty" data-pp-loading>Loading injury history…</p></div>`;
  const slice = await loadPlayer(d.s, gsisId, name);
  if (dialog.hidden) return;
  const card = dialog.querySelector<HTMLElement>(".scin-dialog-card");
  if (!card) return;
  card.innerHTML = playerShell(d.s, slice, name, gsisId, back);
  const body = card.querySelector<HTMLElement>("[data-pp-panel]");
  if (slice && body) {
    const h: PanelHost = { s: d.s, slice, state: { showWeekly: false, showPlays: false }, body };
    drawPanel(h);
    wirePanel(h);
  }
}

function closeDialog(dialog: HTMLElement): void {
  dialog.hidden = true;
  dialog.innerHTML = "";
  document.body.classList.remove("scin-modal-open");
}

function mountDashboard(s: Shared): Dash {
  const state = defaultDashState();
  state.tab = (s.root.dataset["scinTab"] as QuestionTab) ?? "q-safer";
  if (!QUESTION_NAV.some((q) => q.id === state.tab)) state.tab = "q-safer";
  // The simulation's data is its own slice (/data/sim), fetched on the first sandbox interaction.
  const d: Dash = { s, state, ds: null, views: null, simData: null, lastWidth: DEFAULT_WIDTHS.full };
  wireDashboard(d);
  return d;
}

/* ---------------------------------------------------------------- database */

interface Db {
  s: Shared;
  state: DbState;
  records: DbRow[] | null;
  total: number;
  /** Markup to add under a player's reports: the durability profile, in the tool. */
  profile?: (name: string, gsisId: string | null, key: string | null) => Promise<string>;
  /** In the tool: the element a player's page covers (the open tab's panel), and the Back label. */
  main?: () => HTMLElement | null;
  backLabel?: string;
  /** The element hidden while a player's page is open, to show again on Back. */
  hiddenMain?: HTMLElement | null;
}

async function ensureRecords(db: Db): Promise<boolean> {
  if (db.records) return true;
  db.s.root.setAttribute("aria-busy", "true");
  const slice = await fetchJson<AnalysisSlice>(db.s, `${db.s.dataUrl}/analysis`);
  db.s.root.removeAttribute("aria-busy");
  if (!slice || !slice.analysis) return false;
  db.records = dbRecords(slice.analysis.player_injury_impacts, slice.current);
  db.total = db.records.length;
  return true;
}

function redrawDb(db: Db, filtersToo: boolean): void {
  if (!db.records) return;
  const view = dbView(db.records, db.state);
  const table = el(db.s.root, "[data-db-table]");
  if (table) table.outerHTML = renderDbTable(view, db.state, db.records.length, db.s.assets);
  if (filtersToo) {
    const bar = el(db.s.root, "[data-scin-bar]");
    const active = document.activeElement as HTMLElement | null;
    const keepSearch = active?.dataset["dbSearch"] !== undefined;
    if (bar && !keepSearch) bar.outerHTML = renderDbFilters(db.state, dbOptions(db.records));
    else if (bar) {
      // Typing: redraw only the reset button so the input keeps focus.
      const reset = bar.querySelector("[data-db-reset]");
      const any = Object.entries(db.state.filters).some(([k, v]) => (k === "seasonEndingOnly" ? v === true : k === "search" ? v !== "" : v !== ALL));
      if (any && !reset) bar.insertAdjacentHTML("beforeend", `<button type="button" class="scin-clear" data-db-reset>Clear</button>`);
      if (!any && reset) reset.remove();
    }
  }
}

async function withRecords(db: Db, fn: () => void): Promise<void> {
  if (await ensureRecords(db)) fn();
}

function wireDatabase(db: Db): void {
  const root = db.s.root;
  const set = (patch: Partial<DbState["filters"]>, filtersToo = true) => {
    db.state.filters = { ...db.state.filters, ...patch };
    db.state.pageIndex = 0;
    void withRecords(db, () => redrawDb(db, filtersToo));
  };
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.dataset["dbSearch"] !== undefined) set({ search: t.value });
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const ds = t.dataset;
    const v = (t as HTMLSelectElement).value;
    if (ds["dbSeason"] !== undefined) set({ season: v });
    else if (ds["dbPosition"] !== undefined) set({ position: v });
    else if (ds["dbTeam"] !== undefined) set({ team: v });
    else if (ds["dbInjury"] !== undefined) set({ injury: v });
    else if (ds["dbImpact"] !== undefined) set({ impact: v });
    else if (ds["dbEnding"] !== undefined) set({ seasonEndingOnly: (t as HTMLInputElement).checked });
    else if (ds["dbPageSize"] !== undefined) {
      db.state.pageSize = Number(v) || 25;
      db.state.pageIndex = 0;
      void withRecords(db, () => redrawDb(db, false));
    }
  });
  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("button");
    if (!btn || !root.contains(btn)) return;
    const ds = btn.dataset;
    if (ds["dbSort"] !== undefined) {
      const id = ds["dbSort"] as keyof DbRow;
      db.state.sort = db.state.sort.id === id ? { id, desc: !db.state.sort.desc } : { id, desc: false };
      void withRecords(db, () => redrawDb(db, false));
    } else if (ds["dbPrev"] !== undefined) {
      db.state.pageIndex = Math.max(0, db.state.pageIndex - 1);
      void withRecords(db, () => redrawDb(db, false));
    } else if (ds["dbNext"] !== undefined) {
      db.state.pageIndex += 1;
      void withRecords(db, () => redrawDb(db, false));
    } else if (ds["dbReset"] !== undefined) {
      db.state.filters = defaultDbState().filters;
      db.state.pageIndex = 0;
      void withRecords(db, () => redrawDb(db, true));
    } else if (ds["dbExport"] !== undefined) {
      void withRecords(db, () => {
        if (!db.records) return;
        const rows = dbView(db.records, db.state).filtered;
        downloadText(toCsv(rows), "injury_database.csv", "text/csv;charset=utf-8;");
      });
    } else if (ds["player"] !== undefined) {
      void openInline(db, ds["player"] || null, ds["playerName"] ?? "", ds["gmKey"] || null);
    } else if (ds["dbBack"] !== undefined) {
      closeInline(db);
    }
  });
}

/** Close a player's page and show what it covered again. */
function closeInline(db: Db): void {
  const host = el(db.s.root, "[data-scin-player]");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  const main = db.hiddenMain ?? el(db.s.root, "[data-scin-main]");
  if (main) main.hidden = false;
  db.hiddenMain = null;
  db.state.player = null;
}

async function openInline(db: Db, gsisId: string | null, name: string, key: string | null = null): Promise<void> {
  const host = el(db.s.root, "[data-scin-player]");
  const main = db.main ? db.main() : el(db.s.root, "[data-scin-main]");
  if (!host || !main) return;
  const opened = { gsisId, name };
  db.state.player = opened;
  if (db.hiddenMain && db.hiddenMain !== main) db.hiddenMain.hidden = false;
  db.hiddenMain = main;
  main.hidden = true;
  host.hidden = false;
  const back = `<button type="button" class="scin-back" data-db-back>&larr; ${escapeHtml(db.backLabel ?? "Back to database")}</button>`;
  host.innerHTML = playerShell(db.s, null, name, gsisId, back) + (gsisId ? `<p class="scin-empty" data-pp-loading>Loading injury history…</p>` : "");
  host.scrollIntoView({ block: "start", behavior: "smooth" });
  const slice = await loadPlayer(db.s, gsisId, name);
  if (host.hidden || db.state.player !== opened) return;
  host.innerHTML = playerShell(db.s, slice, name, gsisId, back);
  const body = host.querySelector<HTMLElement>("[data-pp-panel]");
  if (slice && body) {
    const h: PanelHost = { s: db.s, slice, state: { showWeekly: false, showPlays: false }, body };
    drawPanel(h);
    wirePanel(h);
  }
  if (db.profile) {
    const html = await db.profile(name, gsisId, key ?? gsisId ?? nameKey(name));
    if (!host.hidden && db.state.player === opened) host.insertAdjacentHTML("beforeend", html);
  }
}

function mountDatabase(s: Shared): Db {
  const db: Db = { s, state: defaultDbState(), records: null, total: 0 };
  wireDatabase(db);
  return db;
}

/* ------------------------------------------------------------------ mount */

function mount(root: HTMLElement): void {
  if (root.dataset["empty"] === "1") return;
  if (root.querySelector("[data-scin-panel]")) {
    mountTool(root);
    return;
  }
  const s: Shared = {
    root,
    dataUrl: (root.dataset["scinData"] ?? "/embed/injury-impact/data").replace(/\/+$/, ""),
    assets: { origin: root.dataset["scinAssets"] ?? "", headshots: {}, sleeper: {} },
    tip: root.querySelector<HTMLElement>("[data-scin-tip]"),
    loading: new Map(),
    index: null,
  };
  wireTips(s);
  wireImageFallback(root);
  wireFrameHeight(root);
  if (root.dataset["scinPage"] === "database") mountDatabase(s);
  else mountDashboard(s);
}


/* ------------------------------------------------------------------- tool */

interface Tool {
  root: HTMLElement;
  dataUrl: string;
  assets: InjuryAssets;
  loading: Map<string, Promise<unknown>>;
  active: ToolTab;
  dash: Dash | null;
  db: Db | null;
  gm: Durability | null;
  ev: EventState;
  rk: RankState;
  roster: string[];
}

function toolPanel(t: Tool, tab: ToolTab): HTMLElement | null {
  return t.root.querySelector<HTMLElement>(`[data-scin-panel="${tab}"]`);
}

/** The durability dataset, fetched once and hydrated (the first interaction pays for it). */
async function ensureGm(t: Tool): Promise<Durability | null> {
  if (t.gm) return t.gm;
  const pending = t.loading.get("gridiron");
  if (pending) return pending as Promise<Durability | null>;
  const p = fetch(`${t.dataUrl}/gridiron`, { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<GridironDataset>) : null))
    .then((raw) => (raw && Array.isArray(raw.players) ? (t.gm = hydrate(raw)) : null))
    .catch(() => null)
    .finally(() => t.loading.delete("gridiron"));
  t.loading.set("gridiron", p);
  return p;
}

function setToolTab(t: Tool, tab: ToolTab, writeHash: boolean): void {
  t.active = tab;
  t.root.dataset["scinActive"] = tab;
  t.root.querySelectorAll<HTMLElement>("[data-tool-tab]").forEach((a) => {
    const on = a.dataset["toolTab"] === tab;
    a.classList.toggle("is-active", on);
    a.setAttribute("aria-selected", String(on));
  });
  // A player's page open over the old tab closes; the new tab's panel shows.
  if (t.db?.state.player) closeInline(t.db);
  t.root.querySelectorAll<HTMLElement>("[data-scin-panel]").forEach((p) => {
    p.hidden = p.dataset["scinPanel"] !== tab;
  });
  if (writeHash) history.replaceState(null, "", `#${tab}`);
  // The study's charts were drawn at a nominal width while hidden; take the column's now.
  if (tab === "impact" && t.dash) redrawVisibleCharts(t.dash);
}

/** The tab a hash names: a tool tab by name, or the Impact study for a research question. */
function toolTabForHash(hash: string): ToolTab | null {
  const anchor = hash.replace(/^#/, "");
  if (isToolTab(anchor)) return anchor;
  if (RETIRED_TABS[anchor]) return RETIRED_TABS[anchor] as ToolTab;
  if (tabForAnchor(anchor)) return "impact";
  return null;
}

function wireToolTabs(t: Tool): void {
  t.root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-tool-tab]");
    if (!a || !t.root.contains(a)) return;
    e.preventDefault();
    const tab = a.dataset["toolTab"];
    if (isToolTab(tab)) {
      setToolTab(t, tab, true);
      t.root.querySelector<HTMLElement>("[data-scin-tool-tabs]")?.scrollIntoView({ block: "nearest" });
    }
  });
  window.addEventListener("hashchange", () => {
    const tab = toolTabForHash(window.location.hash);
    if (tab && tab !== t.active) setToolTab(t, tab, false);
  });
  const initial = toolTabForHash(window.location.hash);
  if (initial && initial !== t.active) setToolTab(t, initial, false);
}

/* ------------------------------------------------- durability tabs */

function redrawEvents(t: Tool, filtersToo: boolean): void {
  if (!t.gm) return;
  const panel = toolPanel(t, "database");
  if (!panel) return;
  const table = el(panel, "[data-ev-table]");
  if (table) table.outerHTML = renderEventTable(t.gm, t.ev, t.assets);
  if (filtersToo) {
    const bar = el(panel, "[data-ev-bar]");
    if (bar) bar.outerHTML = renderEventFilters(t.gm, t.ev);
  }
}

function redrawRanks(t: Tool, filtersToo: boolean): void {
  if (!t.gm) return;
  const panel = toolPanel(t, "players");
  if (!panel) return;
  const table = el(panel, "[data-rk-table]");
  if (table) table.outerHTML = renderRankTable(t.gm, t.rk, t.assets);
  if (filtersToo) {
    const bar = el(panel, "[data-rk-bar]");
    if (bar) bar.outerHTML = renderRankFilters(t.gm, t.rk);
  }
}

function redrawRoster(t: Tool): void {
  if (!t.gm) return;
  const host = t.root.querySelector<HTMLElement>("[data-sim-roster]");
  if (host) host.innerHTML = renderRoster(t.gm, t.roster);
}

function runRosterSim(t: Tool): void {
  if (!t.gm) return;
  const out = t.root.querySelector<HTMLElement>("[data-sim-out]");
  if (!out) return;
  const roster = t.roster.map((k) => t.gm!.byKey[k]).filter((p): p is NonNullable<typeof p> => !!p);
  out.innerHTML = renderSimResult(runSim(roster));
}

function drawSimSearch(t: Tool, q: string): void {
  const list = t.root.querySelector<HTMLElement>("[data-sim-list]");
  if (!list) return;
  const key = nameKey(q);
  if (!key) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  if (!t.gm) {
    list.innerHTML = `<li class="scin-search-note">Loading players…</li>`;
    return;
  }
  const hits = t.gm.players.filter((p) => nameKey(p.n).includes(key)).slice(0, 8);
  list.innerHTML = hits.length
    ? hits.map((p) => `<li><button type="button" class="scin-search-item" data-sim-add="${escapeHtml(p.key)}"><span class="scin-search-name">${escapeHtml(p.n)}</span><span class="scin-search-meta">${escapeHtml(p.pos)} · ${escapeHtml(p.tm)} · ${fmtScore(p.score)}</span></button></li>`).join("")
    : `<li class="scin-search-note">No players found.</li>`;
}

function withGm(t: Tool, fn: () => void): void {
  void ensureGm(t).then((gm) => {
    if (gm) fn();
  });
}

/** Open a player's page over the current tab, from anywhere in the tool. */
function openHistoryPlayer(t: Tool, gsisId: string | null, name: string, key: string | null): void {
  if (!t.db) return;
  void openInline(t.db, gsisId, name, key);
}

/** Hand the browser a file to save. */
function downloadText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function wireDurability(t: Tool): void {
  const root = t.root;
  const gmPanel = (node: HTMLElement | null): boolean => {
    const panel = node?.closest<HTMLElement>("[data-scin-panel]");
    const id = panel?.dataset["scinPanel"];
    return id === "overview" || id === "database" || id === "players" || id === "simulator";
  };
  const evSet = (patch: Partial<EventState["filters"]>) => {
    t.ev.filters = { ...t.ev.filters, ...patch };
    t.ev.pageIndex = 0;
    withGm(t, () => redrawEvents(t, true));
  };
  const rkSet = (patch: Partial<RankState["filters"]>) => {
    t.rk.filters = { ...t.rk.filters, ...patch };
    t.rk.pageIndex = 0;
    withGm(t, () => redrawRanks(t, true));
  };

  root.addEventListener("input", (e) => {
    const el0 = e.target as HTMLInputElement | null;
    if (!el0 || !gmPanel(el0)) return;
    const ds = el0.dataset;
    if (ds["evSearch"] !== undefined) {
      t.ev.filters.search = el0.value;
      t.ev.pageIndex = 0;
      withGm(t, () => redrawEvents(t, false));
    } else if (ds["rkSearch"] !== undefined) {
      t.rk.filters.search = el0.value;
      t.rk.pageIndex = 0;
      withGm(t, () => redrawRanks(t, false));
    } else if (ds["simInput"] !== undefined) {
      drawSimSearch(t, el0.value);
      if (!t.gm) withGm(t, () => drawSimSearch(t, el0.value));
    }
  });

  root.addEventListener("change", (e) => {
    const el0 = e.target as HTMLSelectElement | null;
    if (!el0 || !gmPanel(el0)) return;
    const ds = el0.dataset;
    const v = el0.value;
    if (ds["evPos"] !== undefined) evSet({ pos: v });
    else if (ds["evSeason"] !== undefined) evSet({ season: v });
    else if (ds["evBody"] !== undefined) evSet({ bodyPart: v });
    else if (ds["evSev"] !== undefined) evSet({ sev: v });
    else if (ds["evTeam"] !== undefined) evSet({ team: v });
    else if (ds["evImpact"] !== undefined) evSet({ impact: v });
    else if (ds["evEnding"] !== undefined) evSet({ seasonEndingOnly: (el0 as unknown as HTMLInputElement).checked });
    else if (ds["evPageSize"] !== undefined) {
      t.ev.pageSize = Number(v) || 50;
      t.ev.pageIndex = 0;
      withGm(t, () => redrawEvents(t, false));
    } else if (ds["rkPos"] !== undefined) rkSet({ pos: v });
    else if (ds["rkTeam"] !== undefined) rkSet({ team: v });
    else if (ds["rkStatus"] !== undefined) rkSet({ status: v });
    else if (ds["rkMin"] !== undefined) rkSet({ minSeasons: Number(v) || 1 });
    else if (ds["rkPageSize"] !== undefined) {
      t.rk.pageSize = Number(v) || 50;
      t.rk.pageIndex = 0;
      withGm(t, () => redrawRanks(t, false));
    }
  });

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("button");
    if (!btn || !root.contains(btn) || !gmPanel(btn)) return;
    const ds = btn.dataset;
    if (ds["player"] !== undefined) {
      openHistoryPlayer(t, ds["player"] || null, ds["playerName"] ?? "", ds["gmKey"] || null);
    } else if (ds["evSort"] !== undefined) {
      const key = ds["evSort"] as EventSortKey;
      t.ev.sort = t.ev.sort.key === key ? { key, dir: t.ev.sort.dir === 1 ? -1 : 1 } : { key, dir: eventSortStart(key) };
      withGm(t, () => redrawEvents(t, false));
    } else if (ds["evPrev"] !== undefined || ds["evNext"] !== undefined) {
      t.ev.pageIndex = Math.max(0, t.ev.pageIndex + (ds["evNext"] !== undefined ? 1 : -1));
      withGm(t, () => redrawEvents(t, false));
    } else if (ds["evReset"] !== undefined) {
      t.ev = defaultEventState();
      withGm(t, () => redrawEvents(t, true));
    } else if (ds["evCsv"] !== undefined) {
      withGm(t, () => {
        if (!t.gm) return;
        downloadText(eventCsv(eventRows(t.gm, t.ev)), "injury-database-events.csv", "text/csv;charset=utf-8;");
      });
    } else if (ds["rkCsv"] !== undefined) {
      withGm(t, () => {
        if (!t.gm) return;
        downloadText(rankCsv(rankRows(t.gm, t.rk)), "injury-current-players.csv", "text/csv;charset=utf-8;");
      });
    } else if (ds["rkSort"] !== undefined) {
      const key = ds["rkSort"] as RankSortKey;
      t.rk.sort = t.rk.sort.key === key ? { key, dir: t.rk.sort.dir === 1 ? -1 : 1 } : { key, dir: rankSortStart(key) };
      withGm(t, () => redrawRanks(t, false));
    } else if (ds["rkPrev"] !== undefined || ds["rkNext"] !== undefined) {
      t.rk.pageIndex = Math.max(0, t.rk.pageIndex + (ds["rkNext"] !== undefined ? 1 : -1));
      withGm(t, () => redrawRanks(t, false));
    } else if (ds["rkReset"] !== undefined) {
      t.rk = defaultRankState();
      withGm(t, () => redrawRanks(t, true));
    } else if (ds["simAdd"] !== undefined) {
      const key = ds["simAdd"] ?? "";
      const input = root.querySelector<HTMLInputElement>("[data-sim-input]");
      const list = root.querySelector<HTMLElement>("[data-sim-list]");
      if (input) input.value = "";
      if (list) list.hidden = true;
      if (key && !t.roster.includes(key)) {
        if (t.roster.length >= ROSTER_CAP) window.alert(`Roster cap is ${ROSTER_CAP} players. Remove one first.`);
        else t.roster.push(key);
      }
      withGm(t, () => redrawRoster(t));
    } else if (ds["simRm"] !== undefined) {
      t.roster = t.roster.filter((k) => k !== ds["simRm"]);
      withGm(t, () => redrawRoster(t));
    } else if (ds["simSafe"] !== undefined) {
      withGm(t, () => {
        t.roster = presetSafe(t.gm!);
        redrawRoster(t);
      });
    } else if (ds["simUpside"] !== undefined) {
      withGm(t, () => {
        t.roster = presetUpside(t.gm!);
        redrawRoster(t);
      });
    } else if (ds["simRun"] !== undefined) {
      const out = root.querySelector<HTMLElement>("[data-sim-out]");
      if (out && !t.gm) out.innerHTML = `<p class="scin-empty">Loading players…</p>`;
      withGm(t, () => runRosterSim(t));
    }
  });

  // The search list closes on a click elsewhere.
  document.addEventListener("click", (e) => {
    const list = root.querySelector<HTMLElement>("[data-sim-list]");
    if (list && !list.hidden && !(e.target as HTMLElement | null)?.closest?.("[data-sim-search]")) list.hidden = true;
  });
}

function mountTool(root: HTMLElement): void {
  const dataUrl = (root.dataset["scinData"] ?? "/embed/injury-impact/data").replace(/\/+$/, "");
  const assets: InjuryAssets = { origin: root.dataset["scinAssets"] ?? "", headshots: {}, sleeper: {} };
  const loading = new Map<string, Promise<unknown>>();
  const active = root.dataset["scinActive"];
  const t: Tool = {
    root,
    dataUrl,
    assets,
    loading,
    active: isToolTab(active) ? active : "overview",
    dash: null,
    db: null,
    gm: null,
    ev: defaultEventState(),
    rk: defaultRankState(),
    roster: [...root.querySelectorAll<HTMLElement>("[data-sim-rm]")].map((b) => b.dataset["simRm"] ?? "").filter(Boolean),
  };
  wireImageFallback(root);
  wireFrameHeight(root);

  const impact = toolPanel(t, "impact");
  if (impact) {
    const s: Shared = { root: impact, dataUrl, assets, tip: impact.querySelector<HTMLElement>("[data-scin-tip]"), loading, index: null };
    wireTips(s);
    t.dash = mountDashboard(s);
  }
  // The player page's host sits after the panels; a player opens over the panel in view.
  const wrap = root.querySelector<HTMLElement>("[data-scin-player-wrap]");
  if (wrap) {
    const s: Shared = { root: wrap, dataUrl, assets, tip: null, loading, index: null };
    t.db = mountDatabase(s);
    t.db.main = () => root.querySelector<HTMLElement>("[data-scin-panel]:not([hidden])");
    t.db.backLabel = "Back";
    t.db.profile = async (name, gsisId, key) => renderProfileSection(await ensureGm(t), name, key ?? gsisId);
  }
  wireToolTabs(t);
  wireDurability(t);
}

function init(): void {
  document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(mount);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
