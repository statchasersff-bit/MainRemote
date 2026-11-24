/**
 * Advanced player stats enhancement bundle.
 *
 * The table is complete before this runs - every player for the open position
 * and season, every figure, every grade and the leader cards are in the HTML
 * the server sent, sorted by overall grade, with the players the default
 * filters leave out marked `hidden`. The position control is links that work
 * with scripting off; the season control is buttons this bundle wires.
 *
 * It adds what the standalone app's React state did, over that markup:
 *
 * 1. **Sorting by any column.** The header cells become buttons. Same contract
 *    as the FPA table and the matchup tables: the value is `data-sort` on the
 *    cell, the type is declared by the header, numbers open descending, and a
 *    cell with an empty `data-sort` is a missing figure held at the bottom in
 *    both directions rather than sorted as a zero.
 * 2. **The filters** - search, and behind More Filters the snap share,
 *    minimum games and the position's volume floor - narrowing rows already
 *    in the table. The menus holding them are <details>, closed here when the
 *    reader clicks elsewhere or presses Escape.
 * 3. **The views** - Overview, Receiving, Advanced and so on - each showing a
 *    set of column groups and hiding the rest.
 * 4. **Switching season without leaving the page.** A season button fetches
 *    the fragment for that season and swaps it in. The latest choice wins:
 *    a newer click aborts the older fetch, and a response that is no longer
 *    the latest is thrown away. The season is not part of the address (one
 *    page per position, for crawlers and caches); it is kept in the URL
 *    fragment, `#season=2024`, so a reload or a shared link opens on it, and
 *    the fragment is dropped for the default season. Position links are left
 *    alone: each position is its own clean page.
 * 5. **The Totals / Per Game switch.** Worked out here from the totals on the
 *    page rather than shipped as a second copy of every count - the page is
 *    already the size of fifty columns by three hundred rows.
 */

import { wireFrameHeight } from "./enhance";
import { compareText } from "./schedule-work";

const ROOT_SELECTOR = "[data-sca-root]";

interface Thresholds {
  minGP: number;
  minSnapPct: number;
  minRushAtt: number;
  minTgt: number;
  minPassAtt: number;
}

/* --------------------------------------------------------------- filtering */

function inputValue(root: HTMLElement, name: string): number {
  const input = root.querySelector<HTMLInputElement>(`[data-sca-filters] input[name="${name}"]`);
  if (!input) return 0;
  const n = Number(input.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Does a row pass the filter bar?
 *
 * MIRRORS passesThresholds() in lib/player-stats/stats-data.ts, which decided
 * the rows the server marked `hidden`. Snap share is only tested where the row
 * has one: a missing figure is not a failing one.
 */
function passes(row: HTMLElement, position: string, t: Thresholds, search: string): boolean {
  const n = (key: string): number => Number(row.dataset[key] || 0);
  if (search !== "" && !(row.dataset["name"] ?? "").includes(search)) return false;
  if (t.minGP > 0 && n("games") < t.minGP) return false;
  const snap = row.dataset["snap"] ?? "";
  if (t.minSnapPct > 0 && snap !== "" && Number(snap) < t.minSnapPct) return false;
  if (position === "RB" && t.minRushAtt > 0 && n("rush") < t.minRushAtt) return false;
  if ((position === "WR" || position === "TE") && t.minTgt > 0 && n("tgt") < t.minTgt) return false;
  if (position === "QB" && t.minPassAtt > 0 && n("att") < t.minPassAtt) return false;
  return true;
}

/** The # column is the row's place in the table as it now stands. */
function renumber(root: HTMLElement): void {
  let rank = 0;
  for (const row of Array.from(root.querySelectorAll<HTMLTableRowElement>(".sca-table tbody tr"))) {
    const cell = row.querySelector(".sca-rank");
    if (!cell) continue;
    cell.textContent = row.hidden ? "" : String(++rank);
  }
  const count = root.querySelector("[data-sca-count]");
  if (count) count.textContent = String(rank);
}

function applyFilters(root: HTMLElement): void {
  const position = root.dataset["position"] ?? "";
  const thresholds: Thresholds = {
    minGP: inputValue(root, "minGP"),
    minSnapPct: Math.min(100, inputValue(root, "minSnapPct")),
    minRushAtt: inputValue(root, "minRushAtt"),
    minTgt: inputValue(root, "minTgt"),
    minPassAtt: inputValue(root, "minPassAtt"),
  };
  const search =
    root
      .querySelector<HTMLInputElement>(`[data-sca-filters] input[name="search"]`)
      ?.value.trim()
      .toLowerCase() ?? "";

  for (const row of Array.from(root.querySelectorAll<HTMLTableRowElement>(".sca-table tbody tr"))) {
    row.hidden = !passes(row, position, thresholds, search);
  }
  renumber(root);
  showFilterValues(root);
}

/** Say on the closed More Filters how many of its floors are off their defaults. */
function showFilterValues(root: HTMLElement): void {
  const more = root.querySelector<HTMLElement>(`[data-sca-val="more"]`);
  if (!more) return;
  const changed = Array.from(
    more.closest("details")?.querySelectorAll<HTMLInputElement>("input[data-default]") ?? [],
  ).filter((input) => inputValue(root, input.name) !== Number(input.dataset["default"] ?? 0)).length;
  more.textContent = String(changed);
  more.hidden = changed === 0;
}

/* ----------------------------------------------------------------- sorting */

/**
 * The value a cell sorts on.
 *
 * Read off the text, because the server does not repeat it: a figure cell is
 * `<td>4,394</td>` and nothing else (see renderCell() for why). A dash is a
 * missing figure. The two identity columns sort on the row's own data
 * attributes, since the player cell also holds the short name, the team and
 * the LS badge.
 */
function cellValue(row: HTMLTableRowElement, index: number, key: string, type: string): number | string | null {
  let raw: string;
  if (key === "playerName") raw = row.dataset["name"] ?? "";
  else if (key === "team") raw = row.dataset["team"] ?? "";
  else raw = (row.cells[index]?.textContent ?? "").trim();
  if (raw === "" || raw === "-") return null;
  if (type === "number") {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return raw.toLowerCase();
}

function sortBy(root: HTMLElement, header: HTMLTableCellElement, descending: boolean): void {
  const table = root.querySelector<HTMLTableElement>(".sca-table");
  const body = table?.tBodies[0];
  if (!table || !body) return;

  const index = header.cellIndex;
  const type = header.getAttribute("data-sort-type") ?? "number";
  const key = header.getAttribute("data-key") ?? "";
  const rows = Array.from(body.rows);

  // Read once per row rather than once per comparison.
  const values = new Map<HTMLTableRowElement, number | string | null>();
  for (const row of rows) values.set(row, cellValue(row, index, key, type));

  rows.sort((a, b) => {
    const left = values.get(a) ?? null;
    const right = values.get(b) ?? null;
    // Missing figures sink in both directions, as they did in the standalone
    // table: a dash is not the lowest value, it is no value.
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const cmp =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : compareText(String(left), String(right));
    return descending ? -cmp : cmp;
  });

  for (const row of rows) body.appendChild(row);

  for (const th of Array.from(table.querySelectorAll<HTMLTableCellElement>(".sca-head th"))) {
    if (th.hasAttribute("aria-sort")) th.setAttribute("aria-sort", "none");
    th.classList.remove("is-sorted");
  }
  header.setAttribute("aria-sort", descending ? "descending" : "ascending");
  header.classList.add("is-sorted");
  renumber(root);
}

/**
 * Turn each header into a sort button.
 *
 * Built here rather than shipped, because a button that cannot sort is a
 * control that does nothing. The header's title - the column's explanation -
 * moves onto the button so it stays reachable from the keyboard.
 */
function wireSorting(root: HTMLElement): void {
  const table = root.querySelector<HTMLTableElement>(".sca-table");
  if (!table || table.dataset["scaSort"] === "js") return;

  for (const th of Array.from(table.querySelectorAll<HTMLTableCellElement>(".sca-head th[data-sort-type]"))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sca-sort";
    while (th.firstChild) button.appendChild(th.firstChild);
    // The column's definition moves to data-tip, shown by showTip() on
    // hover, keyboard focus and a tap - a native title is mouse-only and
    // never reaches a phone.
    const title = th.getAttribute("title");
    if (title) {
      button.dataset["tip"] = title;
      th.removeAttribute("title");
    }
    th.appendChild(button);
    const initial = th.getAttribute("data-sort-default");
    th.setAttribute("aria-sort", initial ?? "none");
    if (initial) th.classList.add("is-sorted");
  }

  table.dataset["scaSort"] = "js";
  root.querySelector("[data-sca-sort-hint]")?.removeAttribute("hidden");
}

/* ---------------------------------------------------------------- per game */

/** A per-game figure: two places under ten ("0.47" TDs), one from ten up. */
function formatPerGame(n: number): string {
  return n.toFixed(Math.abs(n) >= 10 ? 1 : 2);
}

/**
 * Show the counting columns as totals or per game, as `data-mode` on the root
 * says.
 *
 * The columns are the headers marked `data-pg`; the divisor is the row's
 * `data-games`. A cell's total is kept on the cell the first time it is
 * divided, so switching back restores the server's own text rather than
 * multiplying a rounded figure back up. The filter bar reads the row's data
 * attributes, not cell text, so "Min TGT 25" still means 25 targets.
 */
function applyMode(root: HTMLElement): void {
  const perGame = root.dataset["mode"] === "game";
  root.classList.toggle("is-per-game", perGame);
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-sca-mode] [data-mode]"))) {
    const on = (button.dataset["mode"] === "game") === perGame;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }

  const table = root.querySelector<HTMLTableElement>(".sca-table");
  if (!table) return;
  const head = table.querySelector<HTMLTableRowElement>(".sca-head");
  const indexes = Array.from(head?.cells ?? [])
    .filter((th) => th.hasAttribute("data-pg"))
    .map((th) => th.cellIndex);

  for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
    const games = Number(row.dataset["games"] || 0);
    for (const i of indexes) {
      const cell = row.cells[i];
      if (!cell) continue;
      const kept = cell.dataset["total"];
      if (!perGame) {
        if (kept !== undefined) cell.textContent = kept;
        continue;
      }
      const total = kept ?? (cell.textContent ?? "").trim();
      cell.dataset["total"] = total;
      const n = Number(total.replace(/,/g, ""));
      cell.textContent =
        total === "" || total === "-" || !Number.isFinite(n) || games <= 0
          ? "-"
          : formatPerGame(n / games);
    }
  }

  // The figures under a sorted counting column just changed; keep its order.
  const sorted = table.querySelector<HTMLTableCellElement>(".sca-head th.is-sorted[data-pg]");
  if (sorted) sortBy(root, sorted, sorted.getAttribute("aria-sort") === "descending");
}

/* ------------------------------------------------------------------- views */
/**
 * Fix the banner's spans for what is on screen.
 *
 * The first visible group's banner also spans the pinned cells - #, Player,
 * and Team while the Player Info group is showing - and the stylesheet drops
 * # and Team on a narrow table, which a colspan written by the server cannot
 * know about. So the spans are counted off what is actually displayed.
 */
function fixSpans(root: HTMLElement): void {
  const table = root.querySelector<HTMLTableElement>(".sca-table");
  if (!table) return;
  const shown = (el: Element | null): boolean =>
    !!el && getComputedStyle(el).display !== "none";

  const pinned =
    (shown(table.querySelector(".sca-th-rank")) ? 1 : 0) +
    1 +
    (shown(table.querySelector(".sca-th-team")) ? 1 : 0);

  let first = true;
  for (const band of Array.from(table.querySelectorAll<HTMLTableCellElement>(".sca-band"))) {
    if (!shown(band)) continue;
    const own = Number(band.dataset["span"] ?? "1");
    band.colSpan = own + (first ? pinned : 0);
    first = false;
  }
}

/**
 * Show exactly the groups not in `groups`.
 *
 * The body cells do not say which group they are in - only the header row
 * does - so the column indexes come from the header, and each row's cells at
 * those indexes follow it. Hidden with the `hidden` attribute, which the
 * stylesheet backs with `display: none !important`.
 */
function setHidden(root: HTMLElement, groups: Set<string>): void {
  root.dataset["hide"] = Array.from(groups).join(" ");

  const table = root.querySelector<HTMLTableElement>(".sca-table");
  if (table) {
    const off = (el: Element): boolean => groups.has(`g${el.getAttribute("data-g")}`);
    for (const band of Array.from(table.querySelectorAll<HTMLElement>(".sca-band"))) {
      band.hidden = off(band);
    }
    const head = table.querySelector<HTMLTableRowElement>(".sca-head");
    const hideAt: boolean[] = [];
    for (const th of Array.from(head?.cells ?? [])) {
      const grouped = th.hasAttribute("data-g");
      hideAt[th.cellIndex] = grouped && off(th);
      if (grouped) th.hidden = hideAt[th.cellIndex]!;
    }
    for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
      for (let i = 0; i < row.cells.length; i += 1) {
        const hide = hideAt[i] ?? false;
        const cell = row.cells[i]!;
        if (cell.hidden !== hide) cell.hidden = hide;
      }
    }
  }

  fixSpans(root);
}

/**
 * Show the view `root.dataset.view` names, or the first one - Overview -
 * when it names none this table has. Each view button lists the group
 * indexes it shows; every other group is hidden.
 */
function applyView(root: HTMLElement): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-sca-sections] [data-view]"));
  const current =
    buttons.find((button) => button.dataset["view"] === root.dataset["view"]) ?? buttons[0];
  if (!current) return;
  root.dataset["view"] = current.dataset["view"] ?? "";

  for (const button of buttons) {
    const on = button === current;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }

  const shown = new Set((current.dataset["groups"] ?? "").split(" ").filter(Boolean));
  const hidden = new Set<string>();
  for (const band of Array.from(root.querySelectorAll<HTMLElement>(".sca-band"))) {
    const g = band.dataset["g"] ?? "";
    if (!shown.has(g)) hidden.add(`g${g}`);
  }
  setHidden(root, hidden);
  updateScrollCues(root);
}

/* ------------------------------------------------------- column definitions */

let tipSeq = 0;
let tipTimer = 0;

/** The one tooltip a root uses, created on first need. */
function tipEl(root: HTMLElement): HTMLElement {
  let tip = root.querySelector<HTMLElement>(":scope > .sca-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "sca-tip";
    tip.id = `sca-tip-${++tipSeq}`;
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    root.appendChild(tip);
  }
  return tip;
}

function showTip(root: HTMLElement, button: HTMLElement): void {
  const text = button.dataset["tip"];
  if (!text) return;
  const tip = tipEl(root);
  tip.textContent = text;
  tip.hidden = false;
  button.setAttribute("aria-describedby", tip.id);
  // Fixed to the viewport, under the header cell, kept inside the window.
  const box = button.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(box.bottom + 8)}px`;
}

function hideTip(root: HTMLElement): void {
  window.clearTimeout(tipTimer);
  const tip = root.querySelector<HTMLElement>(":scope > .sca-tip");
  if (!tip || tip.hidden) return;
  tip.hidden = true;
  root.querySelector(`[aria-describedby="${tip.id}"]`)?.removeAttribute("aria-describedby");
}

/* ----------------------------------------------------------- scroll cues */

/**
 * The sideways-scroll cues on the table's wrap: `has-more` while columns
 * remain off to the right (an edge fade), `is-scrolled` once the reader has
 * moved off the left edge (a shadow on the pinned names). Reads three numbers
 * and toggles two classes - no layout writes, so it is cheap on every frame.
 */
function updateScrollCues(root: HTMLElement): void {
  const wrap = root.querySelector<HTMLElement>("[data-sca-scroll]");
  const scroller = wrap?.querySelector<HTMLElement>(".sca-scroll");
  if (!wrap || !scroller) return;
  const max = scroller.scrollWidth - scroller.clientWidth;
  wrap.classList.toggle("has-more", scroller.scrollLeft < max - 2);
  wrap.classList.toggle("is-scrolled", scroller.scrollLeft > 2);
}

/* ------------------------------------------------------------------ menus */

function closeMenus(root: HTMLElement, except?: Element | null): void {
  for (const menu of Array.from(root.querySelectorAll<HTMLDetailsElement>("details.sca-menu[open]"))) {
    if (menu !== except) menu.open = false;
  }
}

/* ------------------------------------------------------------ season swap */

/** The `#season=` fragment's value, or null when the hash is something else. */
function hashSeason(): string | null {
  const match = /^#season=([^&]*)$/.exec(window.location.hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return "";
  }
}

/**
 * Write the season on screen to the fragment, or take it off for the default
 * season. Only a `#season=` fragment is ever removed; another hash the host
 * page uses is left alone unless a season replaces it.
 */
function writeHash(root: HTMLElement, season: string): void {
  const fallback = root.dataset["defaultSeason"] ?? "";
  const base = window.location.pathname + window.location.search;
  try {
    if (season !== fallback) {
      history.replaceState(history.state, "", `${base}#season=${encodeURIComponent(season)}`);
    } else if (hashSeason() !== null) {
      history.replaceState(history.state, "", base);
    }
  } catch {
    // A sandboxed frame may refuse; the table on screen is still right.
  }
}

/*
 * The blocks a season change rewrites. Not the position strip: its links are
 * this page's own addresses, which the fragment endpoint does not know, so
 * they stay as they are.
 */
const SWAPPABLE = [
  "[data-sca-seasons]", "[data-sca-filters]", "[data-sca-sections]", "[data-sca-body]",
];

/**
 * Per root, the id of the latest season request and the fetch it started.
 * Every request takes the next id and aborts the one before it, and a
 * response whose id is no longer the latest is discarded, so an older season
 * can never land on top of a newer choice.
 */
interface SwapState {
  id: number;
  controller: AbortController | null;
}
const swaps = new WeakMap<HTMLElement, SwapState>();

type SwapResult = "ok" | "stale" | "failed";

async function swapSeason(root: HTMLElement, season: string): Promise<SwapResult> {
  const endpoint = root.dataset["scaEndpoint"];
  if (!endpoint) return "failed";

  let state = swaps.get(root);
  if (!state) {
    state = { id: 0, controller: null };
    swaps.set(root, state);
  }
  state.controller?.abort();
  const id = ++state.id;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  state.controller = controller;
  const current = state;
  const isLatest = (): boolean => current.id === id;

  const url = new URL(endpoint, document.baseURI);
  url.searchParams.set("pos", (root.dataset["position"] ?? "QB").toLowerCase());
  url.searchParams.set("season", season);

  let markup: string;
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "text/html" },
      // Same-origin, not omit: on this origin's own pages the key cookie
      // (lib/embed-key.ts) must ride along. Cross-origin it sends nothing.
      credentials: "same-origin",
      signal: controller?.signal,
    });
    if (!isLatest()) return "stale";
    if (!res.ok) return "failed";
    markup = await res.text();
  } catch {
    return isLatest() ? "failed" : "stale";
  }
  if (!isLatest()) return "stale";
  current.controller = null;

  const next = new DOMParser()
    .parseFromString(markup, "text/html")
    .querySelector<HTMLElement>(ROOT_SELECTOR);
  if (!next) return "failed";

  // The search box is the one thing a reader typed that survives a season
  // change, as it did in the standalone app. The thresholds do not: each
  // season opens on its own defaults, the multi-season table tighter ones.
  const search =
    root.querySelector<HTMLInputElement>(`[data-sca-filters] input[name="search"]`)?.value ?? "";
  // So is the column the reader sorted by: every season of a position has
  // the same columns, so the sort is put back on the new table.
  const sorted = root.querySelector<HTMLTableCellElement>(".sca-head th.is-sorted");
  const sortDescending = sorted?.getAttribute("aria-sort") !== "ascending";
  // The new table already arrives in the default order (grade, descending).
  const sortKey =
    sorted && !(sorted.hasAttribute("data-sort-default") && sortDescending)
      ? sorted.dataset["key"] ?? null
      : null;

  for (const selector of SWAPPABLE) {
    const live = root.querySelector(selector);
    const fresh = next.querySelector(selector);
    if (live && fresh) live.replaceWith(fresh);
  }

  root.dataset["season"] = next.dataset["season"] ?? season;
  closeMenus(root);
  writeHash(root, root.dataset["season"] ?? season);

  const box = root.querySelector<HTMLInputElement>(`[data-sca-filters] input[name="search"]`);
  if (box) box.value = search;

  enhance(root);
  // The view and the Totals / Per Game choice carry over: the new season's
  // table arrives whole and as totals, and is put back the way the reader
  // had it.
  applyView(root);
  applyMode(root);
  applyFilters(root);
  if (sortKey) {
    const th = root.querySelector<HTMLTableCellElement>(`.sca-head th[data-key="${CSS.escape(sortKey)}"]`);
    if (th) sortBy(root, th, sortDescending);
  }
  updateScrollCues(root);
  return "ok";
}

/**
 * Switch to a season and put focus back on the season menu's button (the
 * menu that was clicked in has been replaced by its fresh, closed copy).
 * `aria-busy` stays on until the latest request settles. A failure keeps
 * the table that is on screen.
 */
function selectSeason(root: HTMLElement, season: string, refocus: boolean): void {
  root.setAttribute("aria-busy", "true");
  void swapSeason(root, season).then((result) => {
    if (result === "stale") return;
    root.removeAttribute("aria-busy");
    if (result === "failed") closeMenus(root);
    if (refocus) root.querySelector<HTMLElement>("[data-sca-seasons] summary")?.focus();
  });
}

/** The season button for a value, if the menu offers it. */
function seasonButton(root: HTMLElement, season: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[data-sca-seasons] [data-sca-season="${CSS.escape(season)}"]`,
  );
}

/**
 * Open on the season the fragment names. An unknown value is cleared; the
 * season already rendered needs no fetch.
 */
function seasonFromHash(root: HTMLElement): void {
  const wanted = hashSeason();
  if (wanted === null) return;
  if (!seasonButton(root, wanted)) {
    try {
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
    } catch {
      // Nothing to undo: the table on screen is the rendered one.
    }
    return;
  }
  if (wanted === root.dataset["season"]) return;
  selectSeason(root, wanted, false);
}

/* ------------------------------------------------------------------ wiring */

/** Everything a swap replaces, brought up again. Idempotent. */
function enhance(root: HTMLElement): void {
  root.querySelector<HTMLElement>("[data-sca-filters]")?.removeAttribute("hidden");
  root.querySelector<HTMLElement>("[data-sca-sections]")?.removeAttribute("hidden");
  root.querySelector<HTMLElement>("[data-sca-mode]")?.removeAttribute("hidden");
  wireSorting(root);
}

/**
 * Every listener is on the root, delegated, because the elements they serve
 * are among those a season swap replaces - a listener bound to a view would be
 * a listener on a detached node one click later.
 */
function wire(root: HTMLElement): void {
  if (root.dataset["empty"] === "1") return;

  enhance(root);
  applyView(root);
  applyFilters(root);
  updateScrollCues(root);

  // One menu open at a time. `toggle` does not bubble, so this listens in
  // the capture phase.
  root.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target as HTMLDetailsElement | null;
      if (menu instanceof HTMLDetailsElement && menu.open && menu.matches(".sca-menu")) {
        closeMenus(root, menu);
      }
    },
    true,
  );

  // A click anywhere outside an open menu closes it, as a dropdown does.
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    closeMenus(root, target?.closest("details.sca-menu") ?? null);
  });

  // The view tabs: Left/Right (and Home/End) move between them and open the
  // one reached, as a tab strip does.
  root.addEventListener("keydown", (event) => {
    const view = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-sca-sections] [data-view]");
    if (!view || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const all = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-sca-sections] [data-view]"));
    const at = all.indexOf(view);
    const next =
      event.key === "Home" ? all[0]
      : event.key === "End" ? all[all.length - 1]
      : all[(at + (event.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
    if (!next) return;
    event.preventDefault();
    next.focus();
    root.dataset["view"] = next.dataset["view"] ?? "";
    applyView(root);
  });

  // Column definitions: hover and keyboard focus show one, leaving hides it.
  root.addEventListener("mouseover", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(".sca-sort[data-tip]");
    if (button) showTip(root, button);
  });
  root.addEventListener("mouseout", (event) => {
    const button = (event.target as Element | null)?.closest(".sca-sort[data-tip]");
    const to = (event as MouseEvent).relatedTarget as Node | null;
    if (button && !(to && button.contains(to))) hideTip(root);
  });
  root.addEventListener("focusin", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(".sca-sort[data-tip]");
    if (button) showTip(root, button);
  });
  root.addEventListener("focusout", (event) => {
    if ((event.target as Element | null)?.closest(".sca-sort[data-tip]")) hideTip(root);
  });
  // Scrolling anywhere (the page or the table) moves the header out from
  // under a fixed tip, so it goes. The same capture listener keeps the
  // table's scroll cues current - scroll does not bubble, capture sees it.
  let cueFrame = 0;
  document.addEventListener(
    "scroll",
    (event) => {
      hideTip(root);
      const target = event.target as Element | null;
      if (target instanceof Element && target.matches(".sca-scroll") && root.contains(target) && !cueFrame) {
        cueFrame = requestAnimationFrame(() => {
          cueFrame = 0;
          updateScrollCues(root);
        });
      }
    },
    { capture: true, passive: true },
  );

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTip(root);
    if (event.key !== "Escape") return;
    const menu = (event.target as Element | null)?.closest<HTMLDetailsElement>("details.sca-menu[open]");
    if (!menu) return;
    menu.open = false;
    menu.querySelector<HTMLElement>("summary")?.focus();
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-sca-filters]")) applyFilters(root);
  });

  // A blank number box reads as zero while it is being typed in, and shows it
  // once the reader moves on - the standalone app's blur behavior.
  root.addEventListener("focusout", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.type !== "number" || !input.closest("[data-sca-filters]")) return;
    const n = Number(input.value);
    let value = Number.isFinite(n) && n > 0 ? n : 0;
    if (input.name === "minSnapPct") value = Math.min(100, value);
    input.value = String(value);
  });

  root.addEventListener("focusin", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.type === "number" && input.closest("[data-sca-filters]")) input.select();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;

    const sort = target.closest<HTMLButtonElement>(".sca-sort");
    if (sort) {
      const th = sort.closest<HTMLTableCellElement>("th");
      if (!th) return;
      const current = th.getAttribute("aria-sort");
      // On a touchscreen there is no hover: a tap sorts and shows what the
      // column is for a moment.
      if ((event as PointerEvent).pointerType === "touch" && sort.dataset["tip"]) {
        showTip(root, sort);
        window.clearTimeout(tipTimer);
        tipTimer = window.setTimeout(() => hideTip(root), 2600);
      }
      // A fresh column opens descending - biggest first, which is what a
      // reader sorting by "Targets" wants - and a second click flips it.
      sortBy(root, th, current !== "descending");
      return;
    }

    const mode = target.closest<HTMLButtonElement>("[data-sca-mode] [data-mode]");
    if (mode) {
      root.dataset["mode"] = mode.dataset["mode"] ?? "total";
      applyMode(root);
      return;
    }

    const view = target.closest<HTMLButtonElement>("[data-sca-sections] [data-view]");
    if (view) {
      root.dataset["view"] = view.dataset["view"] ?? "";
      applyView(root);
      return;
    }

    // A button, so Enter and Space arrive here as clicks too.
    const choice = target.closest<HTMLElement>("[data-sca-seasons] [data-sca-season]");
    if (!choice) return;
    event.preventDefault();
    const season = choice.dataset["scaSeason"] ?? "";
    if (season === "") return;
    if (season === root.dataset["season"] && root.getAttribute("aria-busy") !== "true") {
      closeMenus(root);
      root.querySelector<HTMLElement>("[data-sca-seasons] summary")?.focus();
      return;
    }
    selectSeason(root, season, true);
  });

  // A headshot that fails is removed rather than left as a broken image:
  // the leader still reads without it.
  root.addEventListener(
    "error",
    (event) => {
      const img = event.target as HTMLElement | null;
      if (img instanceof HTMLImageElement && img.closest(".sca-leader")) img.remove();
    },
    true,
  );

  // The # and Team columns come and go with the table's width, and the
  // banner's first span has to follow them.
  if ("ResizeObserver" in window) {
    let width = 0;
    new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next === width) return;
      width = next;
      fixSpans(root);
      updateScrollCues(root);
    }).observe(root);
  }

  wireFrameHeight(root);

  seasonFromHash(root);
  window.addEventListener("hashchange", () => seasonFromHash(root));
}

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
