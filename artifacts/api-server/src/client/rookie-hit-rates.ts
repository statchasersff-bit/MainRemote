/**
 * Rookie hit rate bundle.
 *
 * The tool is complete before this runs: all four tabs at the default view
 * (Superflex, PPR, Top-12, 2017 onward, 8 games), every number in the HTML.
 * What the standalone app's React state did, this does over that markup:
 *
 * 1. **The tabs** - Overview, Draft Classes, Year-by-Year, Players - shown one
 *    at a time, with the filter bar hiding what a tab does not use (Position
 *    and Round on the Overview, Position on Draft Classes, Search everywhere
 *    but Players).
 * 2. **The filters.** Any change loads the dataset once
 *    (/embed/rookie-hit-rates/data) and redraws the open tab with
 *    lib/rookie-hit-rates/render.ts - the module the server drew the default
 *    with - so a view here is exactly what the server would have sent.
 * 3. **The Overview table.** Simple (the heatmap) or Detailed (pick ranges),
 *    both in the page, one shown. Hovering a heatmap cell shows its breakdown
 *    in the Best Finish card and a tooltip; clicking pins it.
 * 4. **The Draft Classes table**: sortable, and each class opens to its draft
 *    board, laid out by the source's ladder (board-layout.ts) once the names
 *    are measured.
 * 5. **The breakout chart**: redrawn at the column's real width, with a hover
 *    read-out per year after entry; the Position/Round grouping.
 * 6. **The player explorer**: sorting, paging, search, and names that shorten
 *    to "F. Last" when the table would otherwise scroll sideways.
 *
 * Nothing is written to the URL. The app kept all of this in component state,
 * and so does this.
 */

import { wireFrameHeight } from "./enhance";
import {
  DEFAULT_WIDTHS,
  lensCohort,
  renderCohortTip,
  renderCohortsPanel,
  renderLens,
  renderOverviewPanel,
  renderPlayersPanel,
  renderSurvivalTip,
  renderTrendsPanel,
  type Widths,
} from "../lib/rookie-hit-rates/render";
import {
  abbreviateName,
  computeCohorts,
  computePickRangeCohorts,
  cohortsView,
  defaultState,
  makeBoard,
  pad2,
  playerSummaries,
  type Board,
  type ClassSortKey,
  type Format,
  type Outcome,
  type PackedDataset,
  type PlayerSummary,
  type Pos,
  type Scoring,
  type SortField,
  type State,
  type Tab,
  type TableView,
} from "../lib/rookie-hit-rates/model";
import {
  AVATAR_GAP,
  buildLadder,
  chooseLayout,
  type BoardLayout,
  type RoundWidth,
} from "../lib/rookie-hit-rates/board-layout";

const ROOT_SELECTOR = "[data-schr-root]";

interface Tool {
  root: HTMLElement;
  dataUrl: string;
  data: PackedDataset | null;
  loading: Promise<PackedDataset | null> | null;
  state: State;
  boards: Map<string, Board>;
  summaries: { key: string; rows: PlayerSummary[] } | null;
  /** Panels drawn at an older state, redrawn when next opened. */
  stale: Set<Tab>;
  hover: { pos: Pos; round: number } | null;
  tip: HTMLElement;
  lastWidth: number;
  /** The width the player table needs with full names, taken when it first overflows. */
  fullNamesNeed: number;
}

/* ---------------------------------------------------------------- helpers */

function board(t: Tool): Board {
  const f = t.state.filters;
  const key = `${f.format}-${f.scoring}`;
  let b = t.boards.get(key);
  if (!b) {
    b = makeBoard(t.data!, f.format, f.scoring);
    t.boards.set(key, b);
  }
  return b;
}

function summaries(t: Tool): PlayerSummary[] {
  const f = t.state.filters;
  const key = `${f.format}-${f.scoring}-${f.outcome}-${f.minGames}`;
  if (!t.summaries || t.summaries.key !== key) {
    t.summaries = { key, rows: playerSummaries(board(t), f) };
  }
  return t.summaries.rows;
}

function widths(t: Tool): Widths {
  const panel = t.root.querySelector<HTMLElement>(`[data-panel="${t.state.tab}"]`);
  const w = (panel?.clientWidth || t.root.clientWidth || DEFAULT_WIDTHS.chart + 34) - 34;
  const lens = t.root.querySelector<HTMLElement>("[data-schr-lens]");
  const lensW = lens && lens.clientWidth > 0 ? lens.clientWidth : DEFAULT_WIDTHS.lens;
  return { chart: Math.max(260, Math.min(1400, w)), lens: lensW };
}

function panelEl(t: Tool, tab: Tab): HTMLElement | null {
  return t.root.querySelector<HTMLElement>(`[data-panel="${tab}"]`);
}

/** Cell titles are the no-script read-out; with the bundle the tooltip replaces them. */
function stripTitles(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>(".schr-cell[title]").forEach((el) => el.removeAttribute("title"));
}

/* -------------------------------------------------------------- rendering */

function renderPanel(t: Tool, tab: Tab): void {
  const el = panelEl(t, tab);
  if (!el || !t.data) return;
  const b = board(t);
  const w = widths(t);
  if (tab === "overview") el.innerHTML = renderOverviewPanel(b, t.state, w);
  else if (tab === "trends") el.innerHTML = renderTrendsPanel(b, t.state, w);
  else if (tab === "cohorts") el.innerHTML = renderCohortsPanel(b, t.state, w);
  else el.innerHTML = renderPlayersPanel(b, t.state, summaries(t));
  stripTitles(el);
  t.stale.delete(tab);
  afterDraw(t, tab);
}

/** The measurements a freshly drawn panel needs: board rungs, name lengths. */
function afterDraw(t: Tool, tab: Tab): void {
  if (tab === "trends") layoutBoards(t);
  if (tab === "players") {
    t.fullNamesNeed = 0;
    fitPlayerNames(t);
  }
}

/** Redraw the open tab now and every other tab when it is next opened. */
function rerender(t: Tool): void {
  for (const tab of ["overview", "trends", "cohorts", "players"] as Tab[]) t.stale.add(tab);
  renderPanel(t, t.state.tab);
  syncBar(t);
}

function setPressed(el: Element, on: boolean): void {
  el.classList.toggle("is-active", on);
  el.setAttribute("aria-pressed", String(on));
}

/** The filter bar is never rebuilt (a rebuild would drop focus mid-drag); its state is set in place. */
function syncBar(t: Tool): void {
  const f = t.state.filters;
  const root = t.root;
  root.dataset["tab"] = t.state.tab;
  root.querySelectorAll<HTMLElement>("[data-tabs]").forEach((el) => {
    el.hidden = !(el.dataset["tabs"] ?? "").split(" ").includes(t.state.tab);
  });
  root.querySelectorAll("[data-format]").forEach((el) => setPressed(el, el.getAttribute("data-format") === f.format));
  root.querySelectorAll("[data-scoring]").forEach((el) => setPressed(el, el.getAttribute("data-scoring") === f.scoring));
  root.querySelectorAll("[data-outcome]").forEach((el) => setPressed(el, el.getAttribute("data-outcome") === f.outcome));
  root
    .querySelectorAll("[data-position]")
    .forEach((el) => setPressed(el, f.positions.includes(el.getAttribute("data-position") as Pos)));
  root
    .querySelectorAll("[data-round-toggle]")
    .forEach((el) => setPressed(el, f.rounds.includes(Number(el.getAttribute("data-round-toggle")))));

  const start = root.querySelector<HTMLInputElement>('[data-range="start"]');
  const end = root.querySelector<HTMLInputElement>('[data-range="end"]');
  if (start && end) {
    if (Number(start.value) !== f.yearStart) start.value = String(f.yearStart);
    if (Number(end.value) !== f.yearEnd) end.value = String(f.yearEnd);
    const min = Number(start.min);
    const max = Number(start.max);
    const span = Math.max(1, max - min);
    const fill = root.querySelector<HTMLElement>("[data-range-fill]");
    if (fill) {
      fill.style.left = `${((f.yearStart - min) / span) * 100}%`;
      fill.style.right = `${100 - ((f.yearEnd - min) / span) * 100}%`;
    }
    root.querySelector('[data-range-label="start"]')!.textContent = String(f.yearStart);
    root.querySelector('[data-range-label="end"]')!.textContent = String(f.yearEnd);
  }
  const games = root.querySelector<HTMLInputElement>("[data-schr-min-games]");
  if (games && document.activeElement !== games) games.value = String(f.minGames);

  root.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => {
    if (!el.classList.contains("schr-tab")) return;
    const on = el.dataset["tab"] === t.state.tab;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", String(on));
    el.tabIndex = on ? 0 : -1;
  });
  root.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => {
    el.hidden = el.dataset["panel"] !== t.state.tab;
  });
}

/** Simple / Detailed: both tables are in the page; show one and mark every toggle. */
function syncTableView(t: Tool): void {
  const view = t.state.tableView;
  t.root.querySelectorAll<HTMLElement>("[data-table-view-panel]").forEach((el) => {
    el.hidden = el.dataset["tableViewPanel"] !== view;
  });
  t.root.querySelectorAll<HTMLElement>("[data-table-view]").forEach((el) => {
    const on = el.dataset["tableView"] === view;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", String(on));
  });
}

/* ------------------------------------------------------------ data load */

function load(t: Tool): Promise<PackedDataset | null> {
  if (t.data) return Promise.resolve(t.data);
  if (t.loading) return t.loading;
  t.root.setAttribute("aria-busy", "true");
  t.loading = fetch(t.dataUrl, { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<PackedDataset>) : null))
    .catch(() => null)
    .then((data) => {
      t.root.removeAttribute("aria-busy");
      t.loading = null;
      if (data && Array.isArray(data.players)) {
        // Keep the view the reader has already set up while the data loaded.
        const fresh = defaultState(data);
        if (!t.data) t.state = { ...fresh, ...t.state, filters: { ...t.state.filters } };
        t.data = data;
        return data;
      }
      return null;
    });
  return t.loading;
}

/** Apply a state change: load the data if this is the first, then redraw. */
function update(t: Tool, change: (s: State) => void, resetPage = true): void {
  change(t.state);
  if (resetPage) t.state.page = 0;
  if (t.data) {
    rerender(t);
    return;
  }
  syncBar(t);
  void load(t).then((data) => {
    if (data) rerender(t);
  });
}

/* ---------------------------------------------------------------- tooltip */

function showTip(t: Tool, html: string, anchor: DOMRect, prefer: "above" | "side" = "above"): void {
  if (!html) return hideTip(t);
  const tip = t.tip;
  tip.innerHTML = html;
  tip.hidden = false;
  const host = t.root.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left: number;
  let top: number;
  if (prefer === "side") {
    left = anchor.right - host.left + 12;
    if (left + tw > host.width) left = anchor.left - host.left - tw - 12;
    top = anchor.top - host.top + anchor.height / 2 - th / 2;
  } else {
    left = anchor.left - host.left + anchor.width / 2 - tw / 2;
    top = anchor.top - host.top - th - 8;
    if (top < 0) top = anchor.bottom - host.top + 8;
  }
  left = Math.max(4, Math.min(left, host.width - tw - 4));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(0, top))}px`;
}

function hideTip(t: Tool): void {
  t.tip.hidden = true;
}

function cellTip(t: Tool, cell: HTMLElement): void {
  if (!t.data) return;
  const b = board(t);
  const f = t.state.filters;
  const pos = cell.dataset["pos"] as Pos;
  const round = Number(cell.dataset["round"]);
  const pick = cell.dataset["pick"];
  if (pick) {
    const start = Number(pick);
    const c = computePickRangeCohorts(b.drafts, b.ranks, f, b.data.latestSeason).find(
      (x) => x.pos === pos && x.rookie_round === round && x.pickStart === start,
    );
    const end = start + 2;
    showTip(t, renderCohortTip(c, `${pos} Picks ${round}.${pad2(start)}–${round}.${pad2(end)}`, false), cell.getBoundingClientRect());
  } else {
    const c = computeCohorts(b.drafts, b.ranks, f, b.data.latestSeason).find(
      (x) => x.pos === pos && x.rookie_round === round,
    );
    showTip(t, renderCohortTip(c, `${pos} Round ${round}`, true), cell.getBoundingClientRect());
  }
}

/* ---------------------------------------------------------- best finish */

function drawLens(t: Tool): void {
  if (!t.data) return;
  const lens = t.root.querySelector<HTMLElement>("[data-schr-lens]");
  if (!lens) return;
  const b = board(t);
  const cohorts = computeCohorts(b.drafts, b.ranks, t.state.filters, b.data.latestSeason);
  const active = t.hover ?? t.state.selected;
  lens.innerHTML = renderLens(lensCohort(cohorts, active), t.state.filters, widths(t).lens);
}

function markSelected(t: Tool): void {
  const b = board(t);
  const cohorts = computeCohorts(b.drafts, b.ranks, t.state.filters, b.data.latestSeason);
  const sel = lensCohort(cohorts, t.state.selected);
  t.root.querySelectorAll<HTMLElement>(".schr-heat-table .schr-cell").forEach((el) => {
    const on = !!sel && el.dataset["pos"] === sel.pos && Number(el.dataset["round"]) === sel.rookie_round;
    el.classList.toggle("is-selected", on);
    el.setAttribute("aria-pressed", String(on));
  });
}

/* ------------------------------------------------------------ chart hover */

function chartHover(t: Tool, rect: SVGRectElement): void {
  if (!t.data) return;
  const chart = rect.closest<HTMLElement>("[data-chart]");
  const svg = rect.ownerSVGElement;
  if (!chart || !svg || chart.dataset["chart"] !== "survival") return;
  const x = Number(rect.dataset["x"]);
  const html = renderSurvivalTip(cohortsView(board(t), t.state.filters, t.state.groupBy), x);
  const cursor = svg.querySelector<SVGLineElement>(".schr-cursor");
  if (cursor) {
    const cx = Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2;
    cursor.setAttribute("x1", String(cx));
    cursor.setAttribute("x2", String(cx));
    cursor.setAttribute("visibility", "visible");
  }
  showTip(t, html, rect.getBoundingClientRect(), "side");
}

function chartLeave(t: Tool, chart: Element): void {
  chart.querySelector(".schr-cursor")?.setAttribute("visibility", "hidden");
  hideTip(t);
}

/* ----------------------------------------------------------- draft boards */

const measureCanvas = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;

function textWidth(text: string, font: string): number {
  if (!measureCanvas) return text.length * 6;
  measureCanvas.font = font;
  return measureCanvas.measureText(text).width;
}

function fontOf(el: Element | null): string {
  if (!el) return "normal 500 11px sans-serif";
  const cs = getComputedStyle(el);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

/**
 * Pick each open board's rung: the first of the ladder whose columns fit the
 * board's width with the names measured in the real font. Applied as
 * attributes the stylesheet reads (abbreviation, chrome) and the grid's
 * columns; nothing is re-rendered.
 */
function layoutBoards(t: Tool): void {
  t.root.querySelectorAll<HTMLElement>("[data-board]").forEach((grid) => {
    const rounds = Array.from(grid.querySelectorAll<HTMLElement>(".schr-board-round"));
    if (!rounds.length) return;
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || 8;
    const avail = grid.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (avail <= 0) return;
    const nameFont = fontOf(grid.querySelector(".schr-board-name"));
    const metaFont = fontOf(grid.querySelector(".schr-board-meta"));
    const widthsByRound = new Map<number, RoundWidth>();
    const keys: number[] = [];
    rounds.forEach((col, i) => {
      let full = 0;
      let abbrev = 0;
      col.querySelectorAll<HTMLElement>(".schr-board-pill").forEach((pill) => {
        const name = pill.dataset["name"] ?? "";
        full = Math.max(full, textWidth(name, nameFont));
        abbrev = Math.max(abbrev, textWidth(abbreviateName(name), nameFont));
        // The "1.05 WR" line sits under the name and can out-width a short one.
        const meta = textWidth(pill.querySelector(".schr-board-meta")?.textContent?.replace(/\s+/g, " ") ?? "", metaFont) + 4;
        full = Math.max(full, meta);
        abbrev = Math.max(abbrev, meta);
      });
      widthsByRound.set(i, { full, abbrev });
      keys.push(i);
    });
    const pick: BoardLayout = chooseLayout(buildLadder(rounds.length), keys, widthsByRound, avail, gap);
    grid.dataset["chrome"] = pick.chrome;
    grid.dataset["abbrev"] = pick.abbrev ? "1" : "0";
    grid.style.gridTemplateColumns = pick.fill ? `repeat(${pick.cols}, minmax(0, 1fr))` : `repeat(${pick.cols}, max-content)`;
    grid.style.setProperty("--schr-board-gap", `${AVATAR_GAP}px`);
  });
}

/* ----------------------------------------------------------- player names */

/**
 * When the player table cannot fit without scrolling sideways, every name
 * collapses to "F. Last". The width full names need is kept from the moment
 * the table first overflows, so names only return once there is room again -
 * no flicker at the breakpoint.
 */
function fitPlayerNames(t: Tool): void {
  const scroll = t.root.querySelector<HTMLElement>("[data-players-scroll]");
  const table = scroll?.querySelector<HTMLElement>(".schr-players-table");
  if (!scroll || !table) return;
  if (!table.classList.contains("is-abbrev")) {
    t.fullNamesNeed = scroll.scrollWidth;
    if (scroll.scrollWidth > scroll.clientWidth + 1) table.classList.add("is-abbrev");
  } else if (scroll.clientWidth >= t.fullNamesNeed) {
    table.classList.remove("is-abbrev");
  }
}

/* ----------------------------------------------------------------- wiring */

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function wire(t: Tool): void {
  const root = t.root;

  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    const el = target.closest<HTMLElement>(
      "[data-tab],[data-format],[data-scoring],[data-outcome],[data-position],[data-round-toggle]," +
        "[data-table-view],[data-class-sort],[data-class-toggle],[data-group-by],[data-sort],[data-page]," +
        ".schr-heat-table .schr-cell,tr[data-class-row]",
    );
    if (!el || !root.contains(el)) return;

    if (el.matches(".schr-tab[data-tab]")) {
      const tab = el.dataset["tab"] as Tab;
      if (tab === t.state.tab) return;
      t.state.tab = tab;
      hideTip(t);
      syncBar(t);
      if (t.stale.has(tab)) renderPanel(t, tab);
      // A chart first drawn while hidden was drawn at the fallback width, and
      // a table measured while hidden measured nothing.
      else if (tab === "cohorts") {
        if (t.data) renderPanel(t, tab);
      } else afterDraw(t, tab);
      return;
    }
    if (el.dataset["format"]) return update(t, (s) => void (s.filters.format = el.dataset["format"] as Format));
    if (el.dataset["scoring"]) return update(t, (s) => void (s.filters.scoring = el.dataset["scoring"] as Scoring));
    if (el.dataset["outcome"]) return update(t, (s) => void (s.filters.outcome = el.dataset["outcome"] as Outcome));
    if (el.dataset["position"]) {
      return update(t, (s) => void (s.filters.positions = toggle(s.filters.positions, el.dataset["position"] as Pos)));
    }
    if (el.dataset["roundToggle"]) {
      return update(t, (s) => void (s.filters.rounds = toggle(s.filters.rounds, Number(el.dataset["roundToggle"]))));
    }
    if (el.dataset["tableView"]) {
      t.state.tableView = el.dataset["tableView"] as TableView;
      syncTableView(t);
      hideTip(t);
      return;
    }
    if (el.dataset["classSort"]) {
      const key = el.dataset["classSort"] as ClassSortKey;
      return update(
        t,
        (s) => {
          s.classSort =
            s.classSort.key === key
              ? { key, dir: s.classSort.dir === "asc" ? "desc" : "asc" }
              : { key, dir: key === "year" ? "asc" : "desc" };
        },
        false,
      );
    }
    if (el.dataset["classToggle"] || el.dataset["classRow"]) {
      const year = Number(el.dataset["classToggle"] ?? el.dataset["classRow"]);
      update(t, (s) => void (s.expandedYears = toggle(s.expandedYears, year)), false);
      root.querySelector<HTMLElement>(`#schr-class-${year}`)?.focus();
      return;
    }
    if (el.dataset["groupBy"]) return update(t, (s) => void (s.groupBy = el.dataset["groupBy"] as State["groupBy"]), false);
    if (el.dataset["sort"]) {
      const field = el.dataset["sort"] as SortField;
      return update(t, (s) => {
        if (s.sortField === field) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
        else {
          s.sortField = field;
          s.sortDir = "desc";
        }
      });
    }
    if (el.dataset["page"] !== undefined) {
      const page = Number(el.dataset["page"]);
      update(t, (s) => void (s.page = Math.max(0, page)), false);
      root.querySelector(".schr-players")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (el.matches(".schr-cell")) {
      const pos = el.dataset["pos"] as Pos;
      const round = Number(el.dataset["round"]);
      t.state.selected = { pos, round };
      if (!t.data) {
        void load(t).then(() => {
          markSelected(t);
          drawLens(t);
        });
        return;
      }
      markSelected(t);
      drawLens(t);
    }
  });

  root.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    // Arrow keys move between tabs, as a tablist promises.
    if (target.matches(".schr-tab") && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const tabs = Array.from(root.querySelectorAll<HTMLElement>(".schr-tab"));
      const i = tabs.indexOf(target);
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
      next.focus();
      next.click();
      e.preventDefault();
    }
  });

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches("[data-range]")) {
      const start = root.querySelector<HTMLInputElement>('[data-range="start"]')!;
      const end = root.querySelector<HTMLInputElement>('[data-range="end"]')!;
      let a = Number(start.value);
      let b = Number(end.value);
      // The thumbs never cross, as the source's Radix slider kept them.
      if (a > b) {
        if (el === start) a = b;
        else b = a;
        start.value = String(a);
        end.value = String(b);
      }
      update(t, (s) => {
        s.filters.yearStart = a;
        s.filters.yearEnd = b;
      });
      return;
    }
    if (el.matches("[data-schr-min-games]")) {
      update(t, (s) => void (s.filters.minGames = parseInt(el.value, 10) || 1));
      return;
    }
    if (el.matches("[data-schr-search]")) {
      update(t, (s) => void (s.search = el.value));
    }
  });

  // Hover: the Best Finish card follows the pointer and falls back to the pinned cell.
  root.addEventListener("mouseover", (e) => {
    const target = e.target as Element;
    const cell = target.closest<HTMLElement>(".schr-cell");
    if (cell) {
      if (!t.data) {
        void load(t);
        return;
      }
      cellTip(t, cell);
      if (!cell.dataset["pick"]) {
        t.hover = { pos: cell.dataset["pos"] as Pos, round: Number(cell.dataset["round"]) };
        drawLens(t);
      }
      return;
    }
    const hit = target.closest<SVGRectElement>(".schr-hit");
    if (hit) {
      if (!t.data) {
        void load(t);
        return;
      }
      chartHover(t, hit);
    }
  });

  root.addEventListener("mouseout", (e) => {
    const target = e.target as Element;
    const related = e.relatedTarget as Element | null;
    const cell = target.closest(".schr-cell");
    if (cell && !(related && cell.contains(related))) {
      hideTip(t);
      if (t.hover) {
        t.hover = null;
        drawLens(t);
      }
    }
    const chart = target.closest("[data-chart]");
    if (chart && !(related && chart.contains(related))) chartLeave(t, chart);
  });

  root.addEventListener("focusin", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".schr-cell");
    if (cell && t.data) cellTip(t, cell);
  });
  root.addEventListener("focusout", (e) => {
    if ((e.target as Element).closest(".schr-cell")) hideTip(t);
  });

  // A headshot the CDN does not have falls back to initials, as the source's avatar did.
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLImageElement;
      if (img.tagName !== "IMG" || !img.dataset["fallback"]) return;
      const span = document.createElement("span");
      span.textContent = img.dataset["fallback"];
      img.replaceWith(span);
    },
    true,
  );

  // Redraw the chart at the column's width when it changes; re-fit the boards
  // and the player names on any change.
  if (typeof ResizeObserver !== "undefined") {
    let timer = 0;
    new ResizeObserver(() => {
      if (t.state.tab === "trends") layoutBoards(t);
      if (t.state.tab === "players") fitPlayerNames(t);
      const w = root.clientWidth;
      if (Math.abs(w - t.lastWidth) < 24) return;
      t.lastWidth = w;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!t.data) {
          void load(t).then((d) => d && renderPanel(t, t.state.tab));
          return;
        }
        for (const tab of ["overview", "cohorts"] as Tab[]) t.stale.add(tab);
        if (t.state.tab === "overview" || t.state.tab === "cohorts") renderPanel(t, t.state.tab);
      }, 150);
    }).observe(root);
  }

  // Text measurement is only trustworthy once the real font is in.
  document.fonts?.ready.then(() => {
    layoutBoards(t);
    fitPlayerNames(t);
  });
}

function init(root: HTMLElement): void {
  if (root.dataset["schrReady"] || root.dataset["empty"]) return;
  root.dataset["schrReady"] = "1";
  const tip = document.createElement("div");
  tip.className = "schr-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  root.appendChild(tip);
  const first = Number(root.querySelector<HTMLInputElement>('[data-range="start"]')?.min ?? 2017);
  const last = Number(root.querySelector<HTMLInputElement>('[data-range="end"]')?.max ?? 2025);
  const t: Tool = {
    root,
    dataUrl: root.dataset["schrData"] ?? "/embed/rookie-hit-rates/data",
    data: null,
    loading: null,
    state: defaultState({ firstClass: first, lastClass: last }),
    boards: new Map(),
    summaries: null,
    stale: new Set(),
    hover: null,
    tip,
    lastWidth: root.clientWidth,
    fullNamesNeed: 0,
  };
  stripTitles(root);
  wire(t);
  wireFrameHeight(root);
  fitPlayerNames(t);
  // The chart was drawn at a fallback width; fetch the data in the
  // background so the first redraw and the first hover are instant.
  void load(t).then((data) => {
    if (!data) return;
    const w = widths(t).chart;
    if (Math.abs(w - DEFAULT_WIDTHS.chart) > 24) {
      for (const tab of ["overview", "cohorts"] as Tab[]) t.stale.add(tab);
      if (t.state.tab === "overview" || t.state.tab === "cohorts") renderPanel(t, t.state.tab);
    }
  });
}

function boot(): void {
  document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(init);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
