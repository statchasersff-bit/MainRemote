/**
 * RB handcuff rankings enhancement bundle.
 *
 * The board is complete before this runs - every backup, his starter, score,
 * tier and type, and under each row the breakdown and the reasons, all in the
 * HTML the server sent at the default weights. The model reference and the
 * badge guide are `<details>` and work with scripting off.
 *
 * It adds what the standalone app's React state did, over that markup:
 *
 * 1. **The weight model.** Three sliders that must total 100%, and a Re-rank
 *    button that rescores the board in place from each row's weight-
 *    independent inputs - with lib/rb-handcuffs/recompute.ts, the module the
 *    server scored it with, so the default weights give back exactly the
 *    table that was sent.
 * 2. **Sorting** by any column. Rank opens ascending, text A–Z, numbers
 *    highest first; a missing value sinks both ways.
 * 3. **The expandable rows.** One open at a time, as in the app.
 * 4. **Compare**: up to three players, a tray along the bottom of the window
 *    and a side-by-side view. Built entirely from the rows, so it follows the
 *    weights.
 * 5. **The player card**: a drawer whose body the server renders, fetched the
 *    first time each card is opened. Nothing on it moves with the weights.
 *
 * Nothing here writes to the URL. The app kept all of this in component state
 * and never wrote it to the address, and neither does this.
 */

import { wireFrameHeight } from "./enhance";
import {
  DEFAULT_WEIGHTS,
  rankOrder,
  recomputeScores,
  type HandcuffWeights,
  type RecomputeInput,
} from "../lib/rb-handcuffs/recompute";
import { barBand, handcuffType, offenseLabel, starterLoadLabel, tierFor } from "../lib/rb-handcuffs/model";
import { icon } from "../lib/rb-handcuffs/icons";

const ROOT_SELECTOR = "[data-rbh-root]";
const MAX_COMPARE = 3;
const WEIGHT_KEYS = ["contingentUpsideWeight", "pathToWorkloadWeight", "playerQualityWeight"] as const;
type WeightKey = (typeof WEIGHT_KEYS)[number];

/* ---------------------------------------------------------------- helpers */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------- one board */

interface Board {
  root: HTMLElement;
  body: HTMLTableSectionElement;
  /** The rows in the order the server sent them: the recompute's input order. */
  rows: HTMLTableRowElement[];
  inputs: RecomputeInput[];
  applied: HandcuffWeights;
  sortKey: string;
  sortDesc: boolean;
  compare: string[];
}

function rowFor(board: Board, id: string): HTMLTableRowElement | undefined {
  return board.rows.find((r) => r.dataset["id"] === id);
}

function detailFor(row: HTMLTableRowElement): HTMLTableRowElement | null {
  const next = row.nextElementSibling;
  return next instanceof HTMLTableRowElement && next.classList.contains("rbh-detail") ? next : null;
}

function readInput(row: HTMLTableRowElement): RecomputeInput {
  const d = row.dataset;
  return {
    contingentUpside: num(d["inCu"]) ?? 0,
    pathToWorkload: num(d["inPw"]) ?? 0,
    playerQuality: num(d["inPq"]) ?? 0,
    cost: num(d["inCost"]),
    pinned: d["pinned"] === "1",
    shownContingentUpside: num(d["cu"]),
    shownPathToOpportunity: num(d["pto"]),
    shownPlayerQuality: num(d["pq"]) ?? 0,
  };
}

/* ----------------------------------------------------------------- weights */

function sliderValues(board: Board): Record<WeightKey, number> {
  const out = {} as Record<WeightKey, number>;
  for (const key of WEIGHT_KEYS) {
    const input = board.root.querySelector<HTMLInputElement>(`[data-rbh-weight="${key}"]`);
    out[key] = input ? Number(input.value) || 0 : Math.round(DEFAULT_WEIGHTS[key] * 100);
  }
  return out;
}

function appliedPct(board: Board, key: WeightKey): number {
  return Math.round(board.applied[key] * 100);
}

/**
 * Repaint the model from the sliders: the percentages, the allocation bar,
 * and the status line under it. MIRRORS AdvancedSettingsInline - the total
 * must be 100 before anything can be applied, and the button only lights
 * when the draft differs from what the table is showing.
 */
function paintWeights(board: Board): void {
  const values = sliderValues(board);
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + values[key], 0);
  const valid = total === 100;
  const dirty = WEIGHT_KEYS.some((key) => values[key] !== appliedPct(board, key));
  const atDefault = WEIGHT_KEYS.every((key) => values[key] === Math.round(DEFAULT_WEIGHTS[key] * 100));

  for (const key of WEIGHT_KEYS) {
    const out = board.root.querySelector(`[data-rbh-out="${key}"]`);
    if (out) out.textContent = `${values[key]}%`;
    const legend = board.root.querySelector(`[data-rbh-key="${key}"]`);
    if (legend) legend.textContent = `${values[key]}%`;
    const seg = board.root.querySelector<HTMLElement>(`[data-rbh-seg="${key}"]`);
    if (seg) seg.style.width = `${values[key]}%`;
    const input = board.root.querySelector<HTMLElement>(`[data-rbh-weight="${key}"]`);
    if (input) input.style.setProperty("--rbh-fill", `${values[key]}%`);
  }

  const status = board.root.querySelector("[data-rbh-status]");
  if (status) {
    const diff = total - 100;
    const [main, sub, tone] = !valid
      ? [`Allocation ${total}%`, diff > 0 ? `Reduce by ${diff}%` : `Add ${-diff}%`, "is-bad"]
      : dirty
        ? ["Unsaved model changes", "Ready to re-rank", "is-dirty"]
        : ["Model balanced", "No unsaved changes", "is-ok"];
    status.innerHTML =
      `<span class="rbh-status-main ${tone}">${esc(main)}</span>` +
      `<span class="rbh-status-sub">${esc(sub)}</span>`;
  }

  const apply = board.root.querySelector<HTMLButtonElement>("[data-rbh-apply]");
  if (apply) apply.disabled = !valid || !dirty;
  // Reset returns the draft to the defaults, as the app's did. The app only
  // enabled it while the draft was unapplied, which left no way back to the
  // defaults once custom weights were applied; here it is live whenever the
  // sliders are anywhere else.
  const reset = board.root.querySelector<HTMLButtonElement>("[data-rbh-reset]");
  if (reset) reset.disabled = atDefault;
}

/**
 * Rescore the board for these weights. Every row gets its new score, bar and
 * tier; the rank is its place in score order; and the rows are put back in
 * whatever order the reader last sorted by.
 */
function applyWeights(board: Board, weights: HandcuffWeights): void {
  board.applied = weights;
  const scores = recomputeScores(board.inputs, weights);
  const order = rankOrder(scores);
  order.forEach((index, i) => {
    const row = board.rows[index]!;
    const score = scores[index]!;
    row.dataset["score"] = String(score);
    row.dataset["rank"] = String(i + 1);
    const rank = row.querySelector(".rbh-rank");
    if (rank) rank.textContent = String(i + 1);
    const text = row.querySelector("[data-rbh-score]");
    if (text) text.textContent = String(score);
    const bar = row.querySelector<HTMLElement>("[data-rbh-bar]");
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, score))}%`;
      bar.className = bar.className.replace(/\bis-tier-\w+/, `is-tier-${tierFor(score).key}`);
    }
  });
  sortRows(board);
  renderTray(board);
}

/* ----------------------------------------------------------------- sorting */

const TEXT_KEYS = new Set(["name", "team", "starter", "type"]);

function sortValue(row: HTMLTableRowElement, key: string): number | string | null {
  const d = row.dataset;
  switch (key) {
    case "rank":
      return num(d["rank"]);
    case "score":
      return num(d["score"]);
    case "name":
      return d["name"] || null;
    case "team":
      return d["team"] || null;
    case "starter":
      return d["starter"] || null;
    case "type":
      return d["type"] || null;
    default:
      return null;
  }
}

/** Put the rows in the current sort, each followed by its detail row. */
function sortRows(board: Board): void {
  const { sortKey, sortDesc } = board;
  const rows = [...board.rows];
  rows.sort((a, b) => {
    const left = sortValue(a, sortKey);
    const right = sortValue(b, sortKey);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const cmp =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return sortDesc ? -cmp : cmp;
  });
  for (const row of rows) {
    const detail = detailFor(row);
    board.body.appendChild(row);
    if (detail) board.body.appendChild(detail);
  }
  // Zebra by position, not by :nth-child, which would count the detail rows.
  rows.forEach((row, i) => row.classList.toggle("is-alt", i % 2 === 1));

  for (const th of Array.from(board.root.querySelectorAll<HTMLTableCellElement>(".rbh-table thead th[data-sort]"))) {
    const on = th.dataset["sort"] === sortKey;
    th.setAttribute("aria-sort", on ? (sortDesc ? "descending" : "ascending") : "none");
    th.classList.toggle("is-sorted", on);
  }
}

/**
 * Turn each header into a sort button. Built here rather than shipped: a
 * button that cannot sort is a control that does nothing.
 */
function wireSorting(board: Board): void {
  for (const th of Array.from(board.root.querySelectorAll<HTMLTableCellElement>(".rbh-table thead th[data-sort]"))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rbh-sort";
    while (th.firstChild) button.appendChild(th.firstChild);
    th.appendChild(button);
    button.addEventListener("click", () => {
      const key = th.dataset["sort"] ?? "rank";
      if (board.sortKey === key) {
        board.sortDesc = !board.sortDesc;
      } else {
        board.sortKey = key;
        // The app's toggleSort(): rank and text open ascending, numbers
        // highest first.
        board.sortDesc = !(key === "rank" || TEXT_KEYS.has(key));
      }
      sortRows(board);
    });
  }
}

/* ------------------------------------------------------------ expand rows */

function setExpanded(board: Board, row: HTMLTableRowElement | null): void {
  for (const r of board.rows) {
    const open = r === row && r.getAttribute("aria-expanded") !== "true";
    r.setAttribute("aria-expanded", open ? "true" : "false");
    r.classList.toggle("is-open", open);
    const detail = detailFor(r);
    if (detail) detail.hidden = !open;
  }
}

/* ----------------------------------------------------------------- compare */

function compareButton(board: Board, row: HTMLTableRowElement): string {
  const id = row.dataset["id"] ?? "";
  const on = board.compare.includes(id);
  const full = !on && board.compare.length >= MAX_COMPARE;
  const label = on ? "Remove from compare" : full ? "Compare list full (max 3)" : "Add to compare";
  return (
    `<button type="button" class="rbh-comp-btn${on ? " is-on" : ""}" data-rbh-compare="${esc(id)}"` +
    ` aria-pressed="${on}" title="${esc(label)}" aria-label="${esc(`${label}: ${row.dataset["name"] ?? ""}`)}"` +
    `${full ? " disabled" : ""}>` +
    (on
      ? icon("check")
      : `<svg class="rbh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`) +
    `</button>`
  );
}

function paintCompareButtons(board: Board): void {
  for (const row of board.rows) {
    const cell = row.querySelector<HTMLTableCellElement>(".rbh-comp");
    if (cell) cell.innerHTML = compareButton(board, row);
  }
}

function logoOf(row: HTMLTableRowElement): string {
  return row.querySelector<HTMLImageElement>(".rbh-logo")?.getAttribute("src") ?? "";
}

let tray: HTMLElement | null = null;
let trayBoard: Board | null = null;

/** The tray along the bottom of the window: chips, empty slots, Compare. */
function renderTray(board: Board): void {
  paintCompareButtons(board);
  if (board.compare.length === 0) {
    tray?.remove();
    tray = null;
    trayBoard = null;
    document.documentElement.classList.remove("rbh-has-tray");
    return;
  }
  if (!tray) {
    tray = document.createElement("div");
    tray.className = "rbh-layer rbh-tray";
    tray.setAttribute("role", "region");
    tray.setAttribute("aria-label", "Compare players");
    document.body.appendChild(tray);
    document.documentElement.classList.add("rbh-has-tray");
  }
  trayBoard = board;
  const chips = board.compare
    .map((id) => rowFor(board, id))
    .filter((row): row is HTMLTableRowElement => Boolean(row))
    .map((row) => {
      const logo = logoOf(row);
      return (
        `<span class="rbh-chip-player">` +
        (logo ? `<img src="${esc(logo)}" alt="" width="16" height="16" />` : "") +
        `<span class="rbh-chip-name">${esc(row.dataset["name"])}</span>` +
        `<span class="rbh-chip-team">${esc(row.dataset["team"])}</span>` +
        `<button type="button" class="rbh-chip-x" data-rbh-uncompare="${esc(row.dataset["id"])}"` +
        ` aria-label="${esc(`Remove ${row.dataset["name"] ?? ""}`)}">×</button>` +
        `</span>`
      );
    })
    .join("");
  const slots = Array.from({ length: MAX_COMPARE - board.compare.length })
    .map(() => `<span class="rbh-chip-slot">+ player</span>`)
    .join("");
  const n = board.compare.length;
  tray.innerHTML =
    `<div class="rbh-tray-inner">` +
    `<div class="rbh-tray-chips">${chips}${slots}</div>` +
    `<div class="rbh-tray-actions">` +
    `<button type="button" class="rbh-tray-clear" data-rbh-clear>Clear</button>` +
    `<button type="button" class="rbh-tray-go" data-rbh-open-compare${n < 2 ? " disabled" : ""}>` +
    `Compare${n >= 2 ? ` <span>(${n})</span>` : ""}</button>` +
    `</div>` +
    `</div>`;
}

function toggleCompare(board: Board, id: string): void {
  if (board.compare.includes(id)) {
    board.compare = board.compare.filter((x) => x !== id);
  } else if (board.compare.length < MAX_COMPARE) {
    board.compare = [...board.compare, id];
  }
  renderTray(board);
}

const COMPARE_METRICS = [
  { key: "cu", rank: "cuRank", label: "Backfield Opportunity" },
  { key: "pto", rank: "ptoRank", label: "Path to Opportunity" },
  { key: "pq", rank: "pqRank", label: "Player Quality" },
] as const;

function trendHtml(trend: string | undefined): string {
  if (!trend) return `<span class="rbh-muted">-</span>`;
  const tone =
    trend === "Rising Fast" || trend === "Trending Up"
      ? "good"
      : trend === "Falling Fast" || trend === "Trending Down"
        ? "bad"
        : "none";
  return `<span class="rbh-trend is-${tone}">${esc(trend)}</span>`;
}

/** One player's column in the compare view. PlayerColumn. */
function compareColumn(row: HTMLTableRowElement, winners: Set<string>, only: boolean): string {
  const d = row.dataset;
  const score = num(d["score"]) ?? 0;
  const tier = tierFor(score);
  const type = handcuffType(d["type"]);
  const logo = logoOf(row);
  const tpg = num(d["tpg"]);
  const offense = num(d["offense"]);

  const bars = COMPARE_METRICS.map((m) => {
    const value = num(d[m.key]);
    const rank = num(d[m.rank]);
    const pool = num(d["pool"]);
    const dim = !only && !winners.has(m.key);
    return (
      `<div class="rbh-cbar${dim ? " is-dim" : ""}">` +
      `<p class="rbh-cbar-head"><span>${esc(m.label)}` +
      (value != null && rank != null ? ` <span class="rbh-cbar-rank">(#${rank}${pool ? `/${pool}` : ""})</span>` : "") +
      `</span><strong>${value ?? "-"}</strong></p>` +
      `<span class="rbh-bar"><span class="rbh-bar-fill is-${barBand(value)}"` +
      ` style="width:${value == null ? 0 : Math.max(0, Math.min(100, value))}%"></span></span>` +
      `</div>`
    );
  }).join("");

  return (
    `<div class="rbh-ccol">` +
    `<div class="rbh-ccol-head">` +
    (logo ? `<img src="${esc(logo)}" alt="" width="36" height="36" />` : "") +
    `<div class="rbh-ccol-id"><p class="rbh-ccol-name">${esc(d["name"])}</p>` +
    `<p class="rbh-ccol-meta">#${esc(d["rank"])} · ${esc(d["team"])}</p></div>` +
    `<button type="button" class="rbh-ccol-x" data-rbh-uncompare="${esc(d["id"])}"` +
    ` aria-label="${esc(`Remove ${d["name"] ?? ""}`)}">×</button>` +
    `</div>` +
    `<p class="rbh-ccol-tags"><span class="rbh-tier is-${tier.key}">${tier.label.toUpperCase()}</span>` +
    (d["type"] ? `<span class="rbh-type-${esc(type?.key ?? "")}">${esc(d["type"])}</span>` : "") +
    (d["committee"] === "1" ? `<span class="rbh-committee">${icon("trap")}Committee</span>` : "") +
    `</p>` +
    `<div class="rbh-ccol-score"><strong>${score}</strong><span>Overall</span></div>` +
    `<div class="rbh-cbars">${bars}</div>` +
    `<dl class="rbh-cstats">` +
    `<div><dt>Handcuff for</dt><dd>${esc(d["starter"] || "-")}</dd></div>` +
    `<div><dt>Starter Load</dt><dd>${esc(starterLoadLabel(tpg))}` +
    (tpg != null ? ` <span class="rbh-muted">(${tpg} tpg)</span>` : "") +
    `</dd></div>` +
    `<div><dt>RB Scoring Env</dt><dd>${offense != null ? esc(offenseLabel(offense)) : "-"}</dd></div>` +
    `<div><dt>Role Trend</dt><dd>${trendHtml(d["trend"])}</dd></div>` +
    `</dl>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ layers */

/**
 * The drawer and the compare view are one kind of thing: a modal layer
 * appended to <body>, so `position: fixed` means the window even when a theme
 * has put a transform on some ancestor of the board - which is how a fixed
 * overlay ends up pinned to a column instead of the screen.
 */
interface Layer {
  el: HTMLElement;
  panel: HTMLElement;
  returnFocus: HTMLElement | null;
}

let openLayer: Layer | null = null;

function closeLayer(): void {
  if (!openLayer) return;
  const layer = openLayer;
  openLayer = null;
  layer.el.remove();
  document.documentElement.classList.remove("rbh-locked");
  layer.returnFocus?.focus();
}

function openModal(kind: "drawer" | "compare", label: string, inner: string): Layer {
  closeLayer();
  const el = document.createElement("div");
  el.className = `rbh-layer rbh-modal is-${kind}`;
  el.innerHTML =
    `<div class="rbh-backdrop" data-rbh-close></div>` +
    `<div class="rbh-dialog" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">` +
    `<div class="rbh-dialog-bar">` +
    (kind === "compare" ? `<p class="rbh-dialog-title">Compare Players</p>` : "") +
    `<button type="button" class="rbh-dialog-x" data-rbh-close aria-label="Close">×</button>` +
    `</div>` +
    `<div class="rbh-dialog-body">${inner}</div>` +
    `</div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add("rbh-locked");
  const panel = el.querySelector<HTMLElement>(".rbh-dialog")!;
  const active = document.activeElement;
  openLayer = { el, panel, returnFocus: active instanceof HTMLElement ? active : null };
  panel.focus();
  return openLayer;
}

document.addEventListener("keydown", (event) => {
  if (!openLayer) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLayer();
    return;
  }
  // Keep Tab inside the dialog while it is open.
  if (event.key === "Tab") {
    const focusable = Array.from(
      openLayer.panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === openLayer.panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

function openCompare(board: Board): void {
  const rows = board.compare
    .map((id) => rowFor(board, id))
    .filter((row): row is HTMLTableRowElement => Boolean(row));
  if (rows.length < 2) return;
  const winners = new Map<string, Set<string>>(rows.map((r) => [r.dataset["id"] ?? "", new Set<string>()]));
  for (const m of COMPARE_METRICS) {
    const values = rows.map((r) => num(r.dataset[m.key])).filter((v): v is number => v != null);
    if (values.length === 0) continue;
    const max = Math.max(...values);
    for (const r of rows) {
      if (num(r.dataset[m.key]) === max) winners.get(r.dataset["id"] ?? "")!.add(m.key);
    }
  }
  const html =
    `<div class="rbh-compare is-${rows.length}">` +
    rows.map((r) => compareColumn(r, winners.get(r.dataset["id"] ?? "")!, rows.length === 1)).join("") +
    `</div>`;
  const layer = openModal("compare", "Compare players", html);
  layer.el.addEventListener("click", (event) => {
    const x = (event.target as Element).closest<HTMLElement>("[data-rbh-uncompare]");
    if (!x) return;
    toggleCompare(board, x.dataset["rbhUncompare"] ?? "");
    if (board.compare.length < 2) closeLayer();
    else openCompare(board);
  });
}

/* -------------------------------------------------------------- the drawer */

const cards = new Map<string, string>();

function cardUrl(board: Board, id: string): string | null {
  const endpoint = board.root.dataset["rbhEndpoint"];
  if (!endpoint) return null;
  const embedded = board.root.classList.contains("is-embed");
  return `${endpoint.replace(/\/+$/, "")}/player/${encodeURIComponent(id)}${embedded ? "?from=embed" : ""}`;
}

async function fetchCard(board: Board, id: string): Promise<string | null> {
  const hit = cards.get(id);
  if (hit) return hit;
  const url = cardUrl(board, id);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    cards.set(id, html);
    return html;
  } catch {
    return null;
  }
}

function openCard(board: Board, id: string): void {
  const row = rowFor(board, id);
  const name = row?.dataset["name"] ?? "Player";
  const layer = openModal("drawer", `${name} profile`, `<p class="rbh-loading">Loading ${esc(name)}…</p>`);
  void fetchCard(board, id).then((html) => {
    if (openLayer !== layer) return;
    const body = layer.el.querySelector(".rbh-dialog-body");
    if (!body) return;
    if (html) {
      body.innerHTML = html;
    } else {
      // The card could not be fetched. The row's own link still goes to his
      // page, so offer it rather than a dead end.
      const link = row?.querySelector<HTMLAnchorElement>("a.rbh-name");
      body.innerHTML =
        `<p class="rbh-loading">This player card could not be loaded.` +
        (link ? ` <a href="${esc(link.href)}" target="_top">Open ${esc(name)}'s page</a>.` : "") +
        `</p>`;
    }
  });
}

/* ------------------------------------------------------------------ wiring */

function wire(root: HTMLElement): void {
  if (root.dataset["rbhWired"] === "1" || root.dataset["empty"] === "1") return;
  root.dataset["rbhWired"] = "1";

  const table = root.querySelector<HTMLTableElement>("[data-rbh-table]");
  const body = table?.tBodies[0];
  if (!table || !body) return;

  const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr.rbh-row"));
  const board: Board = {
    root,
    body,
    rows,
    inputs: rows.map(readInput),
    applied: { ...DEFAULT_WEIGHTS },
    sortKey: "rank",
    sortDesc: false,
    compare: [],
  };

  // The controls that need this bundle, now that it is here.
  root.querySelector("[data-rbh-weights]")?.removeAttribute("hidden");
  root.querySelector("[data-rbh-hint]")?.removeAttribute("hidden");
  for (const cell of Array.from(root.querySelectorAll<HTMLElement>(".rbh-th-comp, .rbh-comp"))) {
    cell.hidden = false;
  }
  for (const row of rows) {
    row.tabIndex = 0;
    row.setAttribute("aria-expanded", "false");
  }
  root.classList.add("is-live");

  wireSorting(board);
  sortRows(board);
  paintCompareButtons(board);
  paintWeights(board);

  root.addEventListener("input", (event) => {
    if ((event.target as Element | null)?.closest("[data-rbh-weight]")) paintWeights(board);
  });

  root.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;

    if (target.closest("[data-rbh-apply]")) {
      const values = sliderValues(board);
      applyWeights(board, {
        contingentUpsideWeight: values.contingentUpsideWeight / 100,
        pathToWorkloadWeight: values.pathToWorkloadWeight / 100,
        playerQualityWeight: values.playerQualityWeight / 100,
        costWeight: 0,
      });
      paintWeights(board);
      return;
    }

    if (target.closest("[data-rbh-reset]")) {
      for (const key of WEIGHT_KEYS) {
        const input = root.querySelector<HTMLInputElement>(`[data-rbh-weight="${key}"]`);
        if (input) input.value = String(Math.round(DEFAULT_WEIGHTS[key] * 100));
      }
      paintWeights(board);
      return;
    }

    const compare = target.closest<HTMLElement>("[data-rbh-compare]");
    if (compare) {
      toggleCompare(board, compare.dataset["rbhCompare"] ?? "");
      return;
    }

    const card = target.closest<HTMLElement>("[data-rbh-card]");
    if (card) {
      openCard(board, card.dataset["rbhCard"] ?? "");
      return;
    }

    // A link or a control inside a row does its own thing; anywhere else on
    // the row opens it.
    if (target.closest("a, button, input, summary")) return;
    const row = target.closest<HTMLTableRowElement>("tr.rbh-row");
    if (row && board.rows.includes(row)) setExpanded(board, row);
  });

  root.addEventListener("keydown", (event) => {
    const row = (event.target as Element | null)?.closest?.("tr.rbh-row");
    if (!(row instanceof HTMLTableRowElement) || event.target !== row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setExpanded(board, row);
    }
  });

  // A logo that fails is removed rather than left as a broken image: the
  // abbreviation beside it says the same thing.
  root.addEventListener(
    "error",
    (event) => {
      const img = event.target as HTMLElement | null;
      if (img instanceof HTMLImageElement) img.remove();
    },
    true,
  );

  wireFrameHeight(root);
}

/** The tray and the layers live on <body>, so their clicks are handled here. */
document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  if (!target) return;

  if (openLayer && target.closest("[data-rbh-close]")) {
    closeLayer();
    return;
  }

  if (!tray || !trayBoard || !tray.contains(target)) return;
  const board = trayBoard;
  const remove = target.closest<HTMLElement>("[data-rbh-uncompare]");
  if (remove) {
    toggleCompare(board, remove.dataset["rbhUncompare"] ?? "");
    return;
  }
  if (target.closest("[data-rbh-clear]")) {
    board.compare = [];
    renderTray(board);
    return;
  }
  if (target.closest("[data-rbh-open-compare]")) openCompare(board);
});

/* The headshot in a card that fails falls back to the initials behind it. */
document.addEventListener(
  "error",
  (event) => {
    const img = event.target as HTMLElement | null;
    if (img instanceof HTMLImageElement && img.closest(".rbh-layer")) img.remove();
  },
  true,
);

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wire(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
