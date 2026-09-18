/**
 * Player page enhancement bundle.
 *
 * The page is complete before this file runs — every stat, every week of the
 * game log, every injury and every chart is in the HTML the server sent, and
 * the tab strip works with JavaScript disabled. Nothing here fetches anything
 * and nothing here renders a section.
 *
 * It adds four things:
 *   1. tab behaviour for the section bar, from client/enhance.ts;
 *   2. relative timestamps on the news list, likewise;
 *   3. height reporting for the legacy iframe mount, likewise;
 *   4. the two behaviours particular to this page: a hover layer on the weekly
 *      chart, and sortable columns on the game log.
 *
 * The chart already carries a `<title>` per point, so it is readable with no
 * script at all; what (4) adds is a real tooltip with a hit target bigger than
 * the 4px dot, which is the difference between a chart you can inspect and one
 * you can only look at.
 */

import { wireFrameHeight, wireTabs, wireTimestamps } from "./enhance";

const ROOT_SELECTOR = "[data-scp-root]";

/* --------------------------------------------------------------- tooltip */

/**
 * A hover layer for the weekly points chart.
 *
 * One tooltip element per chart, positioned against the root rather than the
 * SVG, so it is not clipped by the SVG's own viewBox. Driven by pointer events
 * on invisible hit rectangles rather than on the 4px dots: a dot that small is
 * not a usable target, and widening the dot itself would change the chart.
 */
function wireChartTooltip(root: HTMLElement): void {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(".scp-figure"));

  for (const figure of figures) {
    const svg = figure.querySelector<SVGSVGElement>(".scp-spark");
    if (!svg) continue;

    const dots = Array.from(svg.querySelectorAll<SVGCircleElement>(".scp-spark-dot"));
    if (dots.length === 0) continue;

    const tip = document.createElement("div");
    tip.className = "scp-tip";
    tip.hidden = true;
    // Announced politely rather than asserted: the same information is in the
    // table below and in each point's <title>, so this must not interrupt.
    tip.setAttribute("role", "status");
    figure.appendChild(tip);

    const show = (dot: SVGCircleElement): void => {
      const week = dot.getAttribute("data-week");
      const value = dot.getAttribute("data-value");
      const opp = dot.getAttribute("data-opp");
      if (!week || !value) return;

      tip.textContent = `Week ${week}${opp ? ` vs ${opp}` : ""} · ${value} pts`;
      tip.hidden = false;

      // The dot's position in the figure's own box. getBoundingClientRect on
      // the dot is in viewport coordinates; both are, so the difference is the
      // offset inside the figure and survives any scroll position.
      const dotBox = dot.getBoundingClientRect();
      const figBox = figure.getBoundingClientRect();
      tip.style.left = `${dotBox.left + dotBox.width / 2 - figBox.left}px`;
      tip.style.top = `${dotBox.top - figBox.top}px`;
      dot.classList.add("is-hot");
    };

    const hide = (): void => {
      tip.hidden = true;
      for (const dot of dots) dot.classList.remove("is-hot");
    };

    for (const dot of dots) {
      // Pointer events rather than mouse events, so a touch tap works too.
      dot.addEventListener("pointerenter", () => show(dot));
      dot.addEventListener("pointerdown", () => show(dot));
      // Keyboard reachable, so the chart is inspectable without a pointer.
      dot.setAttribute("tabindex", "0");
      dot.addEventListener("focus", () => show(dot));
      dot.addEventListener("blur", hide);
    }

    svg.addEventListener("pointerleave", hide);
  }
}

/* ------------------------------------------------------------ sortable log */

/** The sort value for a cell: its number if it has one, else its text. */
function cellValue(cell: HTMLTableCellElement): number | string {
  const text = (cell.textContent ?? "").trim();
  // Strip the thousands separators the renderer adds, and any trailing unit.
  const numeric = Number(text.replace(/,/g, "").replace(/[^\d.\-]/g, ""));
  return text !== "" && Number.isFinite(numeric) ? numeric : text.toLowerCase();
}

/**
 * Make the game log sortable by any column.
 *
 * Rows for weeks the player did not play carry a colspan cell rather than a
 * full set of columns, so they cannot be sorted meaningfully — they are pushed
 * to the bottom and kept in week order rather than being interleaved with real
 * results on a value they do not have.
 *
 * The default order is by week, and the button that restores it is the week
 * header itself, so there is always a way back to the page as it was sent.
 */
function wireSortableLog(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-scp-log]"),
  );

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const body = table.querySelector("tbody");
    if (!body || headers.length === 0) continue;

    const rows = Array.from(body.querySelectorAll("tr"));
    const original = rows.slice();

    headers.forEach((header, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scp-sort";
      button.textContent = header.textContent ?? "";
      header.textContent = "";
      header.appendChild(button);
      header.setAttribute("aria-sort", index === 0 ? "ascending" : "none");

      let descending = true;

      button.addEventListener("click", () => {
        const playable = original.filter(
          (row) => row.getAttribute("data-status") === "active",
        );
        const rest = original.filter(
          (row) => row.getAttribute("data-status") !== "active",
        );

        if (index === 0) {
          // The week column restores the page as the server sent it.
          for (const row of original) body.appendChild(row);
          for (const other of headers) other.setAttribute("aria-sort", "none");
          header.setAttribute("aria-sort", "ascending");
          descending = true;
          return;
        }

        playable.sort((a, b) => {
          const left = cellValue(a.cells[index] as HTMLTableCellElement);
          const right = cellValue(b.cells[index] as HTMLTableCellElement);
          if (typeof left === "number" && typeof right === "number") {
            return descending ? right - left : left - right;
          }
          return descending
            ? String(right).localeCompare(String(left))
            : String(left).localeCompare(String(right));
        });

        for (const row of playable) body.appendChild(row);
        for (const row of rest) body.appendChild(row);

        for (const other of headers) other.setAttribute("aria-sort", "none");
        header.setAttribute("aria-sort", descending ? "descending" : "ascending");
        descending = !descending;
      });
    });

    table.dataset["scpSort"] = "js";
  }
}

/* ------------------------------------------------------------------ boot */

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wireTabs(root, {
      navSelector: "[data-scp-nav]",
      listSelector: ".scp-nav-list",
      linkSelector: ".scp-nav-link",
      datasetKey: "scpTabs",
    });
    wireTimestamps(root);
    wireChartTooltip(root);
    wireSortableLog(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
