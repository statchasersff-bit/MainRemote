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
 *   4. the behaviours particular to this page: a hover layer on the weekly
 *      chart, sortable columns on the game log and the career table, and the
 *      per-week detail the game log folds away behind each week number.
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
 * Make a marked table sortable by any column.
 *
 * Two tables opt in: the weekly game log and the career table on the Stats tab.
 * Both are "one row per period, sorted by that period" and both are read the
 * same way — you arrive in chronological order and re-sort to find the best or
 * worst of something.
 *
 * Rows that carry a colspan cell rather than a full set of columns — a week the
 * player did not play — cannot be sorted meaningfully, so they are pushed to
 * the bottom and kept in their original order rather than interleaved with real
 * results on a value they do not have.
 *
 * A <tfoot> is untouched: the career total belongs under the table however it
 * is sorted, not somewhere in the middle of it.
 *
 * The default order is the one the server sent, and the button that restores it
 * is the first column's header, so there is always a way back.
 */
interface RowGroup {
  row: HTMLTableRowElement;
  /** The expandable detail that belongs under it, when there is one. */
  detail: HTMLTableRowElement | null;
}

/**
 * The body's rows, with each detail row absorbed into the row above it.
 *
 * Sorting moves rows with appendChild, and a detail row is only a detail of the
 * row it follows — left to itself it has no sortable cells, sinks to the
 * bottom, and ends up describing a week it is nowhere near. So the pair moves
 * as one thing.
 */
function rowGroups(body: Element): RowGroup[] {
  const groups: RowGroup[] = [];

  for (const child of Array.from(body.children)) {
    const row = child as HTMLTableRowElement;
    const last = groups[groups.length - 1];
    if (row.classList.contains("scp-detail") && last && !last.detail) {
      last.detail = row;
      continue;
    }
    groups.push({ row, detail: null });
  }

  return groups;
}

function wireSortableLog(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-scp-sortable]"),
  );

  for (const table of tables) {
    // The LAST header row. The career table puts a column-group row above its
    // headers, and those cells are not columns — treating them as sort buttons
    // would map every click to the wrong index.
    const headerRow = table.querySelector<HTMLTableRowElement>("thead tr:last-child");
    const headers = headerRow
      ? Array.from(headerRow.querySelectorAll<HTMLTableCellElement>("th"))
      : [];
    const body = table.querySelector("tbody");
    if (!body || headers.length === 0) continue;

    const original = rowGroups(body);

    /** Re-append in this order, each detail following its own row. */
    const place = (groups: RowGroup[]): void => {
      for (const group of groups) {
        body.appendChild(group.row);
        if (group.detail) body.appendChild(group.detail);
      }
    };

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
          (group) => group.row.getAttribute("data-status") === "active",
        );
        const rest = original.filter(
          (group) => group.row.getAttribute("data-status") !== "active",
        );

        if (index === 0) {
          // The week column restores the page as the server sent it.
          place(original);
          for (const other of headers) other.setAttribute("aria-sort", "none");
          header.setAttribute("aria-sort", "ascending");
          descending = true;
          return;
        }

        playable.sort((a, b) => {
          const left = cellValue(a.row.cells[index] as HTMLTableCellElement);
          const right = cellValue(b.row.cells[index] as HTMLTableCellElement);
          if (typeof left === "number" && typeof right === "number") {
            return descending ? right - left : left - right;
          }
          return descending
            ? String(right).localeCompare(String(left))
            : String(left).localeCompare(String(right));
        });

        place(playable);
        place(rest);

        for (const other of headers) other.setAttribute("aria-sort", "none");
        header.setAttribute("aria-sort", descending ? "descending" : "ascending");
        descending = !descending;
      });
    });

    table.dataset["scpSort"] = "js";
  }
}

/* ---------------------------------------------------------- expandable log */

/**
 * Fold the game log's per-week detail away behind its week number.
 *
 * The server sends those rows EXPANDED and this collapses them, which is the
 * way round it has to be: the stylesheet hides them only under
 * `[data-scp-expand="js"]`, so a page whose script never runs keeps every fact
 * visible instead of hiding content behind a button that does nothing. The
 * toggle is built here for the same reason — a control that cannot work should
 * not be in the HTML.
 */
function wireExpandableLog(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-scp-expandable]"),
  );

  for (const table of tables) {
    const rows = Array.from(
      table.querySelectorAll<HTMLTableRowElement>("tr[data-detail]"),
    );
    if (rows.length === 0) continue;

    for (const row of rows) {
      const id = row.getAttribute("data-detail");
      if (!id) continue;
      const detail = table.querySelector<HTMLTableRowElement>(`tr[id="${id}"]`);
      const head = row.querySelector("th");
      if (!detail || !head) continue;

      const week = (head.textContent ?? "").trim();

      const button = document.createElement("button");
      button.type = "button";
      button.className = "scp-expand";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", id);
      // The visible label is the week number; the accessible name says what
      // pressing it does, which "7" on its own does not.
      button.setAttribute("aria-label", `Week ${week} detail`);
      button.textContent = week;

      const icon = document.createElement("span");
      icon.className = "scp-expand-icon";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);

      head.textContent = "";
      head.appendChild(button);

      button.addEventListener("click", () => {
        const open = detail.classList.toggle("is-open");
        row.classList.toggle("is-open", open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    table.dataset["scpExpand"] = "js";
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
    wireExpandableLog(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
