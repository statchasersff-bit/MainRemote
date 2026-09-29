/**
 * Advanced player stats enhancement bundle.
 *
 * The table is complete before this runs — every player for the open position
 * and season, every figure, every grade and the leader cards are in the HTML
 * the server sent, sorted by overall grade, with the players the default
 * filters leave out marked `hidden`. The season and position controls are
 * links that work with scripting off.
 *
 * It adds what the standalone app's React state did, over that markup:
 *
 * 1. **Sorting by any column.** The header cells become buttons. Same contract
 *    as the FPA table and the matchup tables: the value is `data-sort` on the
 *    cell, the type is declared by the header, numbers open descending, and a
 *    cell with an empty `data-sort` is a missing figure held at the bottom in
 *    both directions rather than sorted as a zero.
 * 2. **The filters** — search, and behind More Filters the snap share,
 *    minimum games and the position's volume floor — narrowing rows already
 *    in the table. The menus holding them are <details>, closed here when the
 *    reader clicks elsewhere or presses Escape.
 * 3. **The views** — Overview, Receiving, Advanced and so on — each showing a
 *    set of column groups and hiding the rest.
 * 4. **Switching season without leaving the page.** The season links are
 *    intercepted, the fragment for that season is fetched and swapped in, and
 *    nothing is written to the URL — the season was never part of the address
 *    in the standalone app either. Position links are left alone: each
 *    position is its own page.
 * 5. **The Totals / Per Game switch.** Worked out here from the totals on the
 *    page rather than shipped as a second copy of every count — the page is
 *    already the size of fifty columns by three hundred rows.
 */

import { wireFrameHeight } from "./enhance";

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
        : String(left).localeCompare(String(right));
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
 * control that does nothing. The header's title — the column's explanation —
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
    const title = th.getAttribute("title");
    if (title) {
      button.title = title;
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
 * The first visible group's banner also spans the pinned cells — #, Player,
 * and Team while the Player Info group is showing — and the stylesheet drops
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
 * The body cells do not say which group they are in — only the header row
 * does — so the column indexes come from the header, and each row's cells at
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
 * Show the view `root.dataset.view` names, or the first one — Overview —
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
}

/* ------------------------------------------------------------------ menus */

function closeMenus(root: HTMLElement, except?: Element | null): void {
  for (const menu of Array.from(root.querySelectorAll<HTMLDetailsElement>("details.sca-menu[open]"))) {
    if (menu !== except) menu.open = false;
  }
}

/* ------------------------------------------------------------ season swap */

/** Re-point the position links at the season now on screen. */
function syncPositionLinks(root: HTMLElement, season: string): void {
  const fallback = root.dataset["defaultSeason"] ?? "";
  for (const link of Array.from(
    root.querySelectorAll<HTMLAnchorElement>("[data-sca-positions] a"),
  )) {
    try {
      const url = new URL(link.href, document.baseURI);
      if (season === fallback) url.searchParams.delete("season");
      else url.searchParams.set("season", season);
      link.setAttribute("href", url.pathname + url.search);
    } catch {
      // A link we cannot parse keeps its href; it still loads a real table.
    }
  }
}

/*
 * The blocks a season change rewrites. Not the position strip: its links are
 * this page's own addresses, which the fragment endpoint does not know, so
 * they stay and only their season is updated.
 */
const SWAPPABLE = [
  "[data-sca-seasons]", "[data-sca-filters]", "[data-sca-sections]", "[data-sca-body]",
];

async function swapSeason(root: HTMLElement, season: string): Promise<boolean> {
  const endpoint = root.dataset["scaEndpoint"];
  if (!endpoint) return false;

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
    });
    if (!res.ok) return false;
    markup = await res.text();
  } catch {
    return false;
  }

  const next = new DOMParser()
    .parseFromString(markup, "text/html")
    .querySelector<HTMLElement>(ROOT_SELECTOR);
  if (!next) return false;

  // The search box is the one thing a reader typed that survives a season
  // change, as it did in the standalone app. The thresholds do not: each
  // season opens on its own defaults, the multi-season table tighter ones.
  const search =
    root.querySelector<HTMLInputElement>(`[data-sca-filters] input[name="search"]`)?.value ?? "";

  for (const selector of SWAPPABLE) {
    const live = root.querySelector(selector);
    const fresh = next.querySelector(selector);
    if (live && fresh) live.replaceWith(fresh);
  }

  root.dataset["season"] = next.dataset["season"] ?? season;
  closeMenus(root);
  syncPositionLinks(root, root.dataset["season"] ?? season);

  const box = root.querySelector<HTMLInputElement>(`[data-sca-filters] input[name="search"]`);
  if (box) box.value = search;

  enhance(root);
  // The view and the Totals / Per Game choice carry over: the new season's
  // table arrives whole and as totals, and is put back the way the reader
  // had it.
  applyView(root);
  applyMode(root);
  applyFilters(root);
  return true;
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
 * are among those a season swap replaces — a listener bound to a view would be
 * a listener on a detached node one click later.
 */
function wire(root: HTMLElement): void {
  if (root.dataset["empty"] === "1") return;

  enhance(root);
  applyView(root);
  applyFilters(root);

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

  root.addEventListener("keydown", (event) => {
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
  // once the reader moves on — the standalone app's blur behaviour.
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
    const mouse = event as MouseEvent;
    const target = event.target as Element | null;
    if (!target) return;

    const sort = target.closest<HTMLButtonElement>(".sca-sort");
    if (sort) {
      const th = sort.closest<HTMLTableCellElement>("th");
      if (!th) return;
      const current = th.getAttribute("aria-sort");
      // A fresh column opens descending — biggest first, which is what a
      // reader sorting by "Targets" wants — and a second click flips it.
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

    const link = target.closest<HTMLAnchorElement>("[data-sca-seasons] a[data-sca-season]");
    if (!link) return;
    // Modified clicks are the reader asking for the other URL in another tab,
    // and that URL is real and serves that exact table.
    if (mouse.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) {
      return;
    }
    event.preventDefault();

    const season = link.dataset["scaSeason"] ?? "";
    if (season === root.dataset["season"] || root.getAttribute("aria-busy") === "true") return;

    root.setAttribute("aria-busy", "true");
    void swapSeason(root, season)
      .then((ok) => {
        if (!ok) {
          // The link still works. Following it beats a control that silently
          // does nothing.
          window.location.href = link.href;
          return;
        }
        // The menu clicked in has been replaced by its fresh, closed copy;
        // put focus on its button rather than letting it fall back to <body>.
        root.querySelector<HTMLElement>("[data-sca-seasons] summary")?.focus();
      })
      .finally(() => root.removeAttribute("aria-busy"));
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
    }).observe(root);
  }

  wireFrameHeight(root);
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
