/**
 * Fantasy Points Allowed enhancement bundle.
 *
 * The table is complete before this runs - all 32 defenses, every figure, every
 * rank and the tints are in the HTML the server sent, sorted softest-first.
 *
 * It adds two things the server cannot:
 *
 * 1. **Sorting by any column without a round trip.** Worth a bundle because it
 *    is the table's primary verb - "who is softest against tight ends" is a
 *    click, not a page load. `aria-sort` on the header says which column and
 *    which way, and the arrow beside the label says it on screen.
 *
 * 2. **Scoring format and view without a page load.** The six combinations
 *    are one page - the canonical has always said so - so the controls are
 *    buttons (WEB-020, 2026-11-27), not links a crawler would queue as six
 *    addresses. A press fetches that combination's fragment and swaps it in,
 *    and the address takes it as a fragment, `#format=half&view=adjusted`, so
 *    the table is shareable, reloads as it was, and Back and Forward walk it.
 *    The path is never touched: /2025/ stays the 2025 table. An old
 *    `?format=&view=` bookmark is still rendered by the server; it is
 *    rewritten to the fragment form in place.
 *
 * With scripting off, or before this file arrives, the page's own table is on
 * screen and every figure in it is real - only the switching is lost.
 */

import { wireFrameHeight } from "./enhance";
import { compareText } from "./schedule-work";

const ROOT_SELECTOR = "[data-scf-root]";

/**
 * The value a cell sorts on.
 *
 * Read from `data-sort` rather than parsed out of the text, because the cells
 * carry two numbers (the figure and its rank) and text-parsing would sort on
 * whichever came first. The header declares the type, so the team column sorts
 * alphabetically without this having to guess.
 */
function cellValue(cell: HTMLTableCellElement, type: string): number | string {
  const raw = cell.getAttribute("data-sort");
  if (type === "number") {
    const n = Number(raw ?? cell.textContent);
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  }
  return (raw ?? cell.textContent ?? "").trim().toLowerCase();
}

function wireSortableTable(root: HTMLElement): void {
  const table = root.querySelector<HTMLTableElement>("table[data-scf-table]");
  const body = table?.querySelector("tbody");
  if (!table || !body) return;
  if (table.dataset["scfSort"] === "js") return;

  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
  if (headers.length === 0) return;

  headers.forEach((header, index) => {
    const type = header.getAttribute("data-sort-type") ?? "number";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "scf-sort";
    button.textContent = header.textContent ?? "";
    // The title carries the column's explanation, which was on the <th>. Moving
    // it onto the control keeps it reachable by keyboard.
    const title = header.getAttribute("title");
    if (title) {
      button.title = title;
      header.removeAttribute("title");
    }
    header.textContent = "";
    header.appendChild(button);
    // The server marks the column its rows arrive sorted by; the rest start
    // unsorted.
    if (!header.hasAttribute("aria-sort")) header.setAttribute("aria-sort", "none");

    button.addEventListener("click", () => {
      // Numbers open descending (most points allowed first, which is the
      // softest matchup and what the reader is looking for); text opens
      // ascending. A second press on the same column turns it round.
      const now = header.getAttribute("aria-sort");
      const descending =
        now === "descending" ? false : now === "ascending" ? true : type === "number";

      const rows = Array.from(body.querySelectorAll("tr"));
      rows.sort((a, b) => {
        const left = cellValue(a.cells[index] as HTMLTableCellElement, type);
        const right = cellValue(b.cells[index] as HTMLTableCellElement, type);
        if (typeof left === "number" && typeof right === "number") {
          return descending ? right - left : left - right;
        }
        return descending
          ? compareText(String(right), String(left))
          : compareText(String(left), String(right));
      });

      for (const row of rows) body.appendChild(row);

      for (const other of headers) other.setAttribute("aria-sort", "none");
      header.setAttribute("aria-sort", descending ? "descending" : "ascending");
    });
  });

  table.dataset["scfSort"] = "js";
}

/*
 * The four blocks a format or view change rewrites.
 *
 * Not the whole root: the legend, the season link, the FAQ and its schema
 * island are the same in all six combinations, and replacing them would throw
 * away any <details> the reader had opened. The controls are in the list
 * because the pressed states live there.
 */
const SWAPPABLE = [".scf-controls", ".scf-mode", ".scf-scroll"] as const;

const FORMATS = ["standard", "half", "ppr"];
const VIEWS = ["raw", "adjusted"];

interface Combo {
  format: string;
  view: string;
}

/** The combination a control selects, or null if it is not one. */
function selection(el: Element | null, root: HTMLElement): Combo | null {
  const opt = el?.closest<HTMLButtonElement>("button.scf-opt");
  if (!opt || !root.contains(opt)) return null;
  const format = opt.dataset["scfFormat"];
  const view = opt.dataset["scfView"];
  if (format === undefined && view === undefined) return null;
  return {
    format: format ?? root.dataset["format"] ?? "ppr",
    view: view ?? root.dataset["view"] ?? "raw",
  };
}

/**
 * Fetch one combination and put it on screen.
 *
 * Whatever the server sends is what is rendered - the numbers, the ranks, the
 * tints and the caption. None of it is recomputed here.
 *
 * The season goes along on an archive page (WEB-025): the endpoint's default
 * is the CURRENT season, so a Half-PPR click on /2025/ without it swapped the
 * 2026 table in under the 2025 heading. The live page sends no season, so its
 * six combinations keep the proxy cache keys they always had.
 *
 * `current` is asked after the response lands: a reader who clicked again
 * while this one was on the wire wants the newer one, and a slower response
 * must not paint over it.
 */
async function swapTo(root: HTMLElement, combo: Combo, current: () => boolean): Promise<boolean> {
  const endpoint = root.dataset["scfEndpoint"];
  if (!endpoint) return false;

  const url = new URL(endpoint, document.baseURI);
  url.searchParams.set("format", combo.format);
  url.searchParams.set("view", combo.view);
  if (root.dataset["kind"] === "archive" && root.dataset["season"]) {
    url.searchParams.set("season", root.dataset["season"]);
  }

  let markup: string;
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "text/html" },
      // Same-origin, not omit: on this origin's own pages the key cookie
      // (lib/embed-key.ts) must ride along. Cross-origin it sends nothing.
      credentials: "same-origin",
    });
    // A 404 is the honest answer from a deployment with nothing ingested, and
    // an offline reader throws. Both land on the caller's fallback.
    if (!res.ok) return false;
    markup = await res.text();
  } catch {
    return false;
  }

  const next = new DOMParser()
    .parseFromString(markup, "text/html")
    .querySelector<HTMLElement>(ROOT_SELECTOR);
  if (!next) return false;
  // Never paint one season's table under another's heading.
  if (next.dataset["season"] !== root.dataset["season"]) return false;
  if (!current()) return true;

  for (const selector of SWAPPABLE) {
    const live = root.querySelector(selector);
    const fresh = next.querySelector(selector);
    if (live && fresh) live.replaceWith(fresh);
  }

  root.dataset["format"] = next.dataset["format"] ?? combo.format;
  root.dataset["view"] = next.dataset["view"] ?? combo.view;

  // The sort controls were built onto headers that have just been replaced.
  wireSortableTable(root);
  wireFrameHeight(root);
  return true;
}

/* ------------------------------------------------------------ the address */

/**
 * The combination an address asks for. The fragment (`#format=half&view=
 * adjusted`) is what this bundle writes; the query (`?format=&view=`) is the
 * old spelling, still in bookmarks and still rendered by the server (the
 * plugin reads it, statchasers_fpa_args()). A fragment that is not one -
 * `#scf-faq` - names a place on the page and is left alone. Unknown values
 * fall back to the page's defaults, as the server's own parser does.
 */
interface Wanted extends Combo {
  from: "hash" | "query" | "none";
}

function isComboHash(hash: string): boolean {
  return /^#(?:format|view)=/.test(hash);
}

function comboParams(params: URLSearchParams, defaults: Combo): Combo | null {
  if (!params.has("format") && !params.has("view")) return null;
  const format = (params.get("format") ?? "").trim().toLowerCase();
  const view = (params.get("view") ?? "").trim().toLowerCase();
  return {
    format: FORMATS.includes(format) ? format : defaults.format,
    view: VIEWS.includes(view) ? view : defaults.view,
  };
}

function defaultsOf(root: HTMLElement | null): Combo {
  const format = root?.dataset["defaultFormat"] ?? "ppr";
  return { format: FORMATS.includes(format) ? format : "ppr", view: "raw" };
}

function wantedCombo(defaults: Combo): Wanted {
  const hash = window.location.hash;
  if (isComboHash(hash)) {
    const c = comboParams(new URLSearchParams(hash.slice(1)), defaults);
    if (c) return { ...c, from: "hash" };
  }
  const q = comboParams(new URLSearchParams(window.location.search), defaults);
  if (q) return { ...q, from: "query" };
  return { ...defaults, from: "none" };
}

/** `#format=half&view=adjusted`, minus the defaults; "" for the default table. */
function comboHash(combo: Combo, defaults: Combo): string {
  const parts: string[] = [];
  if (combo.format !== defaults.format) parts.push(`format=${combo.format}`);
  if (combo.view !== defaults.view) parts.push(`view=${combo.view}`);
  return parts.length ? `#${parts.join("&")}` : "";
}

/**
 * The combination into the address, as a fragment. The path is untouched, so
 * /2025/ stays /2025/; the old query spelling is dropped, so a reload asks the
 * server for the clean page (the one cached copy every visitor shares) and
 * this bundle fetches the combination. A push for a reader's choice, so Back
 * returns to the table before it; a replace when the address is only being
 * rewritten to say what is already on screen.
 */
function writeAddress(combo: Combo, defaults: Combo, push: boolean): void {
  const u = new URL(window.location.href);
  u.searchParams.delete("format");
  u.searchParams.delete("view");
  const hash = comboHash(combo, defaults);
  // A place-on-the-page fragment survives only while the table is the
  // default; any other combination needs the fragment for itself.
  u.hash = hash || (isComboHash(u.hash) ? "" : u.hash);
  let href = u.href;
  if (href.endsWith("#")) href = href.slice(0, -1);
  if (href === window.location.href) return;
  const data = { scf: combo };
  if (push) window.history.pushState(data, "", href);
  else window.history.replaceState(data, "", href);
}

/** The old query spelling, for a combination the endpoint could not serve. */
function queryHref(combo: Combo, defaults: Combo): string {
  const u = new URL(window.location.href);
  u.hash = "";
  u.searchParams.delete("format");
  u.searchParams.delete("view");
  if (combo.format !== defaults.format) u.searchParams.set("format", combo.format);
  if (combo.view !== defaults.view) u.searchParams.set("view", combo.view);
  return u.href;
}

/* ------------------------------------------------------------ the controls */

/**
 * The control a keyboard reader pressed is replaced along with the controls
 * block; the new block's matching button takes the focus back, so Tab carries
 * on from where it was and the reader hears it announced as pressed.
 */
function focusKey(el: Element | null, root: HTMLElement): string | null {
  if (!(el instanceof HTMLButtonElement) || !root.contains(el) || !el.classList.contains("scf-opt")) return null;
  const format = el.dataset["scfFormat"];
  if (format) return `button.scf-opt[data-scf-format="${format}"]`;
  const view = el.dataset["scfView"];
  return view ? `button.scf-opt[data-scf-view="${view}"]` : null;
}

/** The latest combination asked for, per table: a slower fetch cannot land over a newer one. */
const pending = new WeakMap<HTMLElement, number>();

type Shown = "ok" | "failed" | "stale";

async function show(root: HTMLElement, combo: Combo): Promise<Shown> {
  const token = (pending.get(root) ?? 0) + 1;
  pending.set(root, token);
  const focus = focusKey(document.activeElement, root);
  root.setAttribute("aria-busy", "true");
  const ok = await swapTo(root, combo, () => pending.get(root) === token);
  if (pending.get(root) !== token) return "stale";
  root.removeAttribute("aria-busy");
  if (!ok) return "failed";
  if (focus) root.querySelector<HTMLElement>(focus)?.focus();
  return "ok";
}

/**
 * Delegated from the root rather than bound to each button, because the
 * buttons are among the elements a swap replaces. Buttons: Enter and Space
 * click them, so the keyboard needs nothing more.
 */
function wireControls(root: HTMLElement): void {
  if (!root.dataset["scfEndpoint"]) return;
  const defaults = defaultsOf(root);

  root.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const picked = selection(event.target as Element | null, root);
    if (!picked) return;
    if (picked.format === root.dataset["format"] && picked.view === root.dataset["view"]) return;

    void show(root, picked).then((shown) => {
      if (shown === "ok") writeAddress(picked, defaults, true);
      // The fetch failed: the server still prints any combination from the
      // old query, so the reader gets it with a page load instead of nothing.
      else if (shown === "failed") window.location.href = queryHref(picked, defaults);
    });
  });
}

/**
 * Bring each table in line with the address: on load (a shared fragment, or
 * an old query the server has already printed), and on Back/Forward or a
 * fragment typed into the bar.
 */
function syncFromAddress(initial: boolean): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR)).filter(
    (root) => root.dataset["scfEndpoint"] && !root.dataset["empty"],
  );
  if (roots.length === 0) return;
  const defaults = defaultsOf(roots[0] ?? null);
  const wanted = wantedCombo(defaults);
  // Rewriting the old query would drop a place-on-the-page fragment.
  const placeHash = window.location.hash !== "" && !isComboHash(window.location.hash);
  const rewrite = initial && wanted.from === "query" && !placeHash;

  for (const root of roots) {
    const combo: Combo = { format: wanted.format, view: wanted.view };
    if (combo.format === root.dataset["format"] && combo.view === root.dataset["view"]) {
      if (rewrite) writeAddress(combo, defaults, false);
      continue;
    }
    void show(root, combo).then((shown) => {
      if (shown === "ok" && rewrite) writeAddress(combo, defaults, false);
    });
  }
}

let historyWired = false;

function wireHistory(): void {
  if (historyWired) return;
  historyWired = true;
  // Back/Forward between pushed entries fires popstate; a fragment edited by
  // hand fires hashchange (and, between fragment entries, both). Either way
  // the address is read again, and a table already showing it is left be.
  window.addEventListener("popstate", () => syncFromAddress(false));
  window.addEventListener("hashchange", () => syncFromAddress(false));
}

function boot(): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR));
  for (const root of roots) {
    wireSortableTable(root);
    wireControls(root);
    wireFrameHeight(root);
  }
  if (roots.length) {
    wireHistory();
    syncFromAddress(true);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
