/**
 * Strength-of-schedule enhancement bundle.
 *
 * The board is complete before this runs: the cards, the legend, every team or
 * player and every week are in the HTML the server sent, and the Team/Player
 * tabs and the Position/Scoring pills are ordinary links to a URL that serves
 * that view with scripting off.
 *
 * It adds what the standalone app did in React, on top of that markup:
 *
 *   1. **Sorting by any column**, cycling as the source's did: the column's own
 *      direction, then the other, then back to the server's order. A bye (or
 *      any empty cell) stays at the bottom both ways.
 *   2. **The cards jump the table**: a click sorts by the card's column,
 *      highlights the row it names and scrolls to it.
 *   3. **Names that fit**: once the grid would scroll sideways, player names
 *      drop to "F. Last", and come back when there is room again.
 *   4. **Views without a page load**: a tab or pill click fetches that view's
 *      fragment and swaps it in, and the address takes `?tab&pos&scoring`, as
 *      the source's embed did, so the view is shareable and Back works.
 *   5. The two popovers (<details>) close on an outside click or Escape.
 */

import { wireFrameHeight } from "./enhance";

const ROOT_SELECTOR = "[data-scsos-root]";

/* ----------------------------------------------------------------- sorting */

type Dir = "asc" | "desc";

function sortValue(cell: Element | undefined, type: string): number | string | null {
  const raw = cell?.getAttribute("data-sort");
  if (raw === null || raw === undefined || raw === "") return null;
  if (type === "text") return raw.toLowerCase();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface SortState {
  key: string;
  dir: Dir;
}

function wireSort(root: HTMLElement): (key: string, dir: Dir) => void {
  const table = root.querySelector<HTMLTableElement>("table[data-scsos-table]");
  const body = table?.tBodies[0];
  if (!table || !body) return () => {};

  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
  const original = Array.from(body.rows);
  original.forEach((row, i) => (row.dataset["i"] = String(i)));
  let state: SortState | null = null;

  const apply = (next: SortState | null) => {
    state = next;
    let rows = original.slice();
    if (next) {
      const index = headers.findIndex((h) => h.dataset["key"] === next.key);
      const type = headers[index]?.dataset["sortType"] ?? "number";
      const factor = next.dir === "asc" ? 1 : -1;
      rows = rows.sort((a, b) => {
        const av = sortValue(a.cells[index], type);
        const bv = sortValue(b.cells[index], type);
        if (av === null && bv === null) return Number(a.dataset["i"]) - Number(b.dataset["i"]);
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return cmp * factor || Number(a.dataset["i"]) - Number(b.dataset["i"]);
      });
    }
    for (const row of rows) body.appendChild(row);
    for (const h of headers) {
      const on = next !== null && h.dataset["key"] === next.key;
      h.setAttribute("aria-sort", on ? (next!.dir === "asc" ? "ascending" : "descending") : "none");
      h.classList.toggle("is-sorted", on);
    }
  };

  for (const header of headers) {
    const key = header.dataset["key"];
    if (!key) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scsos-sort";
    button.innerHTML = header.innerHTML;
    const title = header.getAttribute("title");
    if (title) {
      button.title = title;
      header.removeAttribute("title");
    }
    header.textContent = "";
    header.appendChild(button);
    header.setAttribute("aria-sort", "none");

    const first = (header.dataset["sortDir"] as Dir | undefined) ?? "asc";
    button.addEventListener("click", () => {
      if (!state || state.key !== key) apply({ key, dir: first });
      else if (state.dir === first) apply({ key, dir: first === "asc" ? "desc" : "asc" });
      else apply(null);
    });
  }

  return (key, dir) => apply({ key, dir });
}

/* ------------------------------------------------------------------- cards */

function wireCards(root: HTMLElement, sortBy: (key: string, dir: Dir) => void): void {
  let clear: number | undefined;
  for (const card of Array.from(root.querySelectorAll<HTMLElement>(".scsos-card[data-row]"))) {
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const go = () => {
      sortBy(card.dataset["sortKey"] ?? "ovr", (card.dataset["dir"] as Dir) ?? "asc");
      const row = root.querySelector<HTMLElement>(`tr[data-row="${card.dataset["row"]}"]`);
      if (!row) return;
      root.querySelectorAll(".is-focus").forEach((el) => el.classList.remove("is-focus"));
      row.classList.add("is-focus");
      // Let the re-sorted rows settle before scrolling to the target.
      window.setTimeout(
        () => row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }),
        60,
      );
      window.clearTimeout(clear);
      clear = window.setTimeout(() => row.classList.remove("is-focus"), 2400);
    };
    card.addEventListener("click", (event) => {
      // The player's name is a link to his page; let it be one.
      if ((event.target as Element).closest("a")) return;
      go();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });
  }
}

/* ----------------------------------------------------------- compact names */

/**
 * "F. Last" once the grid would scroll, full names back once the width they
 * needed is available again. Measured against the width with full names, so
 * the switch cannot flicker at the boundary.
 */
function wireCompactNames(root: HTMLElement): void {
  const scroll = root.querySelector<HTMLElement>(".scsos-scroll");
  const table = scroll?.querySelector<HTMLTableElement>("table[data-kind='player']");
  if (!scroll || !table || typeof ResizeObserver === "undefined") return;

  let fullWidth = 0;
  const measure = () => {
    const available = scroll.clientWidth;
    const compact = root.classList.contains("is-compact");
    if (!compact && table.scrollWidth > available + 1) {
      fullWidth = table.scrollWidth;
      root.classList.add("is-compact");
    } else if (compact && fullWidth && available >= fullWidth) {
      root.classList.remove("is-compact");
    }
  };
  measure();
  new ResizeObserver(measure).observe(scroll);
}

/**
 * The cards' player names, the same way and all together, as the source
 * did: the moment one full name would be cut off, every card switches to
 * "F. Last", so the row stays uniform.
 */
function wireCardNames(root: HTMLElement): void {
  const cards = root.querySelector<HTMLElement>(".scsos-cards");
  const names = Array.from(root.querySelectorAll<HTMLElement>(".scsos-card-name"));
  if (!cards || !names.some((n) => n.querySelector(".scsos-pname-full")) || typeof ResizeObserver === "undefined") {
    return;
  }
  const measure = () => {
    cards.classList.remove("is-short");
    const cut = names.some((n) => n.scrollWidth > n.clientWidth + 1);
    cards.classList.toggle("is-short", cut);
  };
  measure();
  new ResizeObserver(measure).observe(cards);
  void document.fonts?.ready.then(measure);
}

/* ---------------------------------------------------------------- popovers */

let popoversWired = false;

function wirePopovers(): void {
  if (popoversWired) return;
  popoversWired = true;
  const open = () => Array.from(document.querySelectorAll<HTMLDetailsElement>(".scsos-pop[open]"));
  document.addEventListener("click", (event) => {
    const inside = (event.target as Element).closest(".scsos-pop");
    for (const d of open()) if (d !== inside) d.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") for (const d of open()) d.open = false;
  });
}

/* ------------------------------------------------------------------- views */

interface View {
  tab: string;
  pos: string;
  scoring: string;
}

function viewOf(el: HTMLElement): View | null {
  const root = el.closest<HTMLElement>(ROOT_SELECTOR);
  if (!root) return null;
  return {
    tab: el.dataset["tab"] ?? root.dataset["tab"] ?? "team",
    pos: el.dataset["pos"] ?? root.dataset["pos"] ?? "rb",
    scoring: el.dataset["scoring"] ?? root.dataset["scoring"] ?? "ppr",
  };
}

/** The blocks a view change rewrites. The standalone page's H1 is not one of them. */
const SWAPPABLE = [".scsos-bar", ".scsos-view"] as const;

async function swapTo(root: HTMLElement, view: View): Promise<boolean> {
  const endpoint = root.dataset["scsosEndpoint"];
  if (!endpoint) return false;
  const url = new URL(endpoint, document.baseURI);
  url.searchParams.set("tab", view.tab);
  url.searchParams.set("pos", view.pos);
  url.searchParams.set("scoring", view.scoring);
  // A position page's fragment is that page's: same bar, same Related block.
  const page = root.dataset["page"];
  if (page && page !== "all") url.searchParams.set("page", page);

  let markup: string;
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "text/html" },
      // Same-origin: on this origin's own pages the key cookie must ride along.
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

  for (const selector of SWAPPABLE) {
    const live = root.querySelector(selector);
    const fresh = next.querySelector(selector);
    if (live && fresh) live.replaceWith(fresh);
  }
  root.dataset["tab"] = view.tab;
  root.dataset["pos"] = view.pos;
  root.dataset["scoring"] = view.scoring;
  root.classList.remove("is-compact");
  enhanceView(root);
  return true;
}

/**
 * The tab and the scoring go in the address; the position never does. It is
 * the page's own since the per-position pages, and `?pos=` 301s away, so a
 * reload of an address this wrote would leave the page.
 */
function writeAddress(view: View, push: boolean): void {
  const u = new URL(window.location.href);
  u.searchParams.set("tab", view.tab);
  u.searchParams.delete("pos");
  u.searchParams.set("scoring", view.scoring);
  if (u.href === window.location.href) return;
  const data = { scsos: view };
  if (push) window.history.pushState(data, "", u.href);
  else window.history.replaceState(data, "", u.href);
}

function wireViews(root: HTMLElement): void {
  if (!root.dataset["scsosEndpoint"]) return;
  root.addEventListener("click", (event) => {
    const mouse = event as MouseEvent;
    if (mouse.defaultPrevented) return;
    // A modified click is a reader asking for that URL in another tab.
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a.scsos-tab, a.scsos-opt");
    if (!link || !root.contains(link)) return;
    // A position link is a page of its own: an ordinary navigation.
    if (link.classList.contains("is-page")) return;
    const view = viewOf(link);
    if (!view) return;
    event.preventDefault();
    if (link.classList.contains("is-active")) return;
    root.setAttribute("aria-busy", "true");
    void swapTo(root, view).then((ok) => {
      root.removeAttribute("aria-busy");
      if (ok) writeAddress(view, true);
      else window.location.href = link.href;
    });
  });
}

let historyWired = false;

function wireHistory(): void {
  if (historyWired) return;
  historyWired = true;
  window.addEventListener("popstate", () => {
    const p = new URLSearchParams(window.location.search);
    for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
      const view: View = {
        tab: p.get("tab") ?? "team",
        // The position is the page's, not the address's.
        pos: root.dataset["pos"] ?? "rb",
        scoring: p.get("scoring") ?? "ppr",
      };
      if (
        view.tab === root.dataset["tab"] &&
        view.pos === root.dataset["pos"] &&
        view.scoring === root.dataset["scoring"]
      ) {
        continue;
      }
      void swapTo(root, view);
    }
  });
}

/* -------------------------------------------------------------------- boot */

function enhanceView(root: HTMLElement): void {
  const sortBy = wireSort(root);
  wireCards(root, sortBy);
  wireCompactNames(root);
  wireCardNames(root);
  wireFrameHeight(root);
}

function boot(): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR));
  for (const root of roots) {
    if (root.dataset["scsosWired"] || root.dataset["empty"]) continue;
    root.dataset["scsosWired"] = "1";
    enhanceView(root);
    wireViews(root);
  }
  if (roots.length) {
    wirePopovers();
    wireHistory();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
