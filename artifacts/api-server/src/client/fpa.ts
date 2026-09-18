/**
 * Fantasy Points Allowed enhancement bundle.
 *
 * The table is complete before this runs — all 32 defenses, every figure, every
 * rank and the tints are in the HTML the server sent, sorted softest-first, and
 * the format and view controls are ordinary links that work with scripting
 * disabled. Nothing here fetches anything.
 *
 * It adds one thing the server cannot: sorting by any column without a round
 * trip. That is worth a bundle because it is the table's primary verb — "who is
 * softest against tight ends" is a click, not a page load.
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

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wireSortableTable(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
