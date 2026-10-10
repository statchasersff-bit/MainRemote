/**
 * Fantasy Points Allowed enhancement bundle.
 *
 * The table is complete before this runs - all 32 defenses, every figure, every
 * rank and the tints are in the HTML the server sent, sorted softest-first, and
 * the format and view controls are ordinary links that work with scripting
 * disabled.
 *
 * It adds two things the server cannot:
 *
 * 1. **Sorting by any column without a round trip.** Worth a bundle because it
 *    is the table's primary verb - "who is softest against tight ends" is a
 *    click, not a page load.
 *
 * 2. **Changing scoring format or view without changing the URL.** The six
 *    combinations are one page - the canonical has always said so - so the
 *    address a reader is on should not move when they switch between them.
 *    The controls stay real links, and this intercepts the click, fetches the
 *    fragment for that combination and swaps it in. Nothing is written to
 *    `location` and nothing is pushed onto the history stack.
 *
 * The second is progressive enhancement in the strict sense: with scripting
 * off, or before this file arrives, every control is a link to a URL that
 * serves the same table - so the only thing lost is the address staying put.
 */

import { wireFrameHeight } from "./enhance";

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
    header.setAttribute("aria-sort", "none");

    // Numbers open descending (most points allowed first, which is the softest
    // matchup and what the reader is looking for); text opens ascending.
    let descending = type === "number";

    button.addEventListener("click", () => {
      const rows = Array.from(body.querySelectorAll("tr"));
      rows.sort((a, b) => {
        const left = cellValue(a.cells[index] as HTMLTableCellElement, type);
        const right = cellValue(b.cells[index] as HTMLTableCellElement, type);
        if (typeof left === "number" && typeof right === "number") {
          return descending ? right - left : left - right;
        }
        return descending
          ? String(right).localeCompare(String(left))
          : String(left).localeCompare(String(right));
      });

      for (const row of rows) body.appendChild(row);

      for (const other of headers) other.setAttribute("aria-sort", "none");
      header.setAttribute("aria-sort", descending ? "descending" : "ascending");
      descending = !descending;
    });
  });

  table.dataset["scfSort"] = "js";
}

/*
 * The four blocks a format or view change rewrites.
 *
 * Not the whole root: the legend, the Related links, the FAQ and its schema
 * island are the same in all six combinations, and replacing them would throw
 * away any <details> the reader had opened. The controls are in the list
 * because the active states and the CSV link live there; the answer sentence
 * because its figures are the view's.
 */
const SWAPPABLE = [".scf-answer", ".scf-controls", ".scf-mode", ".scf-scroll"] as const;

/** The combination a control selects, or null if it is not one. */
function selection(
  el: Element | null,
): { format?: string; view?: string } | null {
  const opt = el?.closest<HTMLElement>(".scf-opt");
  if (!opt) return null;
  const format = opt.dataset["scfFormat"];
  const view = opt.dataset["scfView"];
  if (format === undefined && view === undefined) return null;
  return { ...(format ? { format } : {}), ...(view ? { view } : {}) };
}

/**
 * Fetch one combination and put it on screen.
 *
 * Whatever the server sends is what is rendered - the numbers, the ranks, the
 * tints, the caption, the CSV href and the note above the table that says what
 * the figures are currently a mix of. None of it is recomputed here. That note
 * is the reason this is a fetch rather than six tables inlined into the page:
 * it is prose the server builds from the blend weights, and a client that
 * wrote its own copy would be a second place for it to be wrong.
 */
async function swapTo(root: HTMLElement, format: string, view: string): Promise<boolean> {
  const endpoint = root.dataset["scfEndpoint"];
  if (!endpoint) return false;

  const url = new URL(endpoint, document.baseURI);
  url.searchParams.set("format", format);
  url.searchParams.set("view", view);

  let markup: string;
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "text/html" },
      // Same-origin, not omit: on this origin's own pages the key cookie
      // (lib/embed-key.ts) must ride along. Cross-origin it sends nothing.
      credentials: "same-origin",
    });
    // A 404 is the honest answer from a deployment with nothing ingested, and
    // an offline reader throws. Both land on the caller's fallback, which is
    // the link the control already was.
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

  root.dataset["format"] = format;
  root.dataset["view"] = view;

  // The sort controls were built onto headers that have just been replaced.
  wireSortableTable(root);
  wireFrameHeight(root);
  return true;
}

/**
 * The controls, without the navigation.
 *
 * Delegated from the root rather than bound to each link, because the links
 * are among the elements a swap replaces - a listener per link would be a
 * listener on a detached node one click later.
 *
 * Modified clicks are left alone. Ctrl/cmd-click, middle-click and "open in
 * new tab" are a reader asking for the other URL in another tab, and that URL
 * is real and serves that exact table; taking it over would be the script
 * breaking a link it did not need to touch.
 */
function wireControls(root: HTMLElement): void {
  if (!root.dataset["scfEndpoint"]) return;

  root.addEventListener("click", (event) => {
    const mouse = event as MouseEvent;
    if (mouse.defaultPrevented) return;
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) {
      return;
    }

    const target = event.target as Element | null;
    const picked = selection(target);
    if (!picked) return;

    // One swap at a time. Clicking Standard then PPR before the first lands
    // would otherwise race, and whichever response was slower would win.
    if (root.getAttribute("aria-busy") === "true") {
      event.preventDefault();
      return;
    }

    const format = picked.format ?? root.dataset["format"] ?? "half";
    const view = picked.view ?? root.dataset["view"] ?? "raw";
    if (format === root.dataset["format"] && view === root.dataset["view"]) {
      // Already on it. Still ours to swallow - following the link would
      // reload the page to arrive where it already is.
      event.preventDefault();
      return;
    }

    event.preventDefault();
    root.setAttribute("aria-busy", "true");

    void swapTo(root, format, view)
      .then((ok) => {
        if (!ok) {
          // The link still works. Falling back to it is better than leaving a
          // control that silently does nothing.
          const href = target?.closest<HTMLAnchorElement>(".scf-opt")?.href;
          if (href) window.location.href = href;
          return;
        }
        // The control that was clicked has been replaced by its fresh copy,
        // so focus would otherwise land back on <body> - which is a keyboard
        // reader losing their place in the middle of the controls.
        root
          .querySelector<HTMLElement>(
            picked.view ? `.scf-opt[data-scf-view="${view}"]` : `.scf-opt[data-scf-format="${format}"]`,
          )
          ?.focus();
      })
      .finally(() => root.removeAttribute("aria-busy"));
  });
}

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wireSortableTable(root);
    wireControls(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
