/**
 * Player page enhancement bundle.
 *
 * The page is complete before this file runs - every stat, every week of the
 * game log, every injury and every chart is in the HTML the server sent, and
 * the tab strip works with JavaScript disabled.
 *
 * It adds six things:
 *   1. tab behaviour for the section bar, from client/enhance.ts;
 *   2. relative timestamps on the news list, likewise;
 *   3. height reporting for the legacy iframe mount, likewise;
 *   4. the player search above the header, from client/player-search.ts -
 *      the one control on the page that does not exist until this file runs,
 *      because a search box with no script behind it swallows typing and
 *      answers nothing;
 *   5. the behaviours particular to this page: a hover layer on the weekly
 *      chart, sortable columns on the game log and the career table, the
 *      per-week detail the game log folds away behind each week number, the
 *      header's fallback silhouette and its per-tab subtitle, and centring the
 *      peers rail on the card the reader is standing on;
 *   6. the state swap: the two season selectors change the page WITHOUT
 *      changing its address. See wireStateSwap.
 *
 * (6) is the one thing here that fetches, and it is still an enhancement: the
 * controls are real links to real URLs, the server still renders every
 * one of them, and with scripting off they navigate exactly as they always
 * did. What the fetch buys is the reader keeping their place - and the address
 * bar keeping the one URL this page is supposed to have.
 *
 * The chart already carries a `<title>` per point, so it is readable with no
 * script at all; what (5) adds is a real tooltip with a hit target bigger than
 * the 4px dot, which is the difference between a chart you can inspect and one
 * you can only look at.
 */

import { wireFrameHeight, wireTabs, wireTimestamps } from "./enhance";
import { wirePlayerDirectory } from "./player-index";
import { wirePlayerSearch } from "./player-search";

const ROOT_SELECTOR = "[data-scp-root]";

/**
 * The index of every profile - /player, and the fragment the container page at
 * /nfl/players/ mounts. A different root from the one above and deliberately
 * so: none of the profile's wiring (tabs, chart, sortable log, header)
 * has anything to do on a page with no player on it.
 */
const INDEX_SELECTOR = "[data-scp-index]";

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
 * same way - you arrive in chronological order and re-sort to find the best or
 * worst of something.
 *
 * Rows that carry a colspan cell rather than a full set of columns - a week the
 * player did not play - cannot be sorted meaningfully, so they are pushed to
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
 * row it follows - left to itself it has no sortable cells, sinks to the
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
    // headers, and those cells are not columns - treating them as sort buttons
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
 * toggle is built here for the same reason - a control that cannot work should
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

/* ---------------------------------------------------------------- header */

/**
 * The header's two jobs for script: a headshot that failed, and the tab.
 *
 * A Sleeper thumbnail that 404s is a broken-image glyph in the middle of the
 * photo well. The well already carries a silhouette under the photo, hidden
 * while the photo stands; marking the well `is-missing` swaps them without the
 * well changing size. `complete && naturalWidth === 0` catches the failure
 * that happened before this ran.
 */
function wireHeader(root: HTMLElement): void {
  const well = root.querySelector<HTMLElement>("[data-scp-pwell]");
  const img = well?.querySelector<HTMLImageElement>("img");
  if (!well || !img) return;
  const missing = (): void => well.classList.add("is-missing");
  if (img.complete && img.naturalWidth === 0) missing();
  else img.addEventListener("error", missing, { once: true });
}

/**
 * The tab the reader switched to, reflected in the header.
 *
 * The H1's second line names the open tab, and both buttons' analytics tags
 * name it too - `startsit-header-gamelog` - so a click from the Game Log is
 * not reported as a click from whichever tab the page loaded on. The nav link
 * carries the line; the tag is the button's stem plus the tab.
 */
function headerTab(root: HTMLElement, link: HTMLAnchorElement, id: string): void {
  const kind = link.dataset["scpKind"];
  const line = root.querySelector<HTMLElement>(".scp-phead-kind");
  if (line && kind) line.textContent = kind;
  const tab = id.replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const cta of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-cta]"))) {
    cta.setAttribute("data-cta", `${cta.dataset["scpCta"]}-${tab}`);
  }
}

/* ------------------------------------------------------------ peers rail */

/**
 * Centre the "You are here" card in the positional peers rail.
 *
 * The rail is complete and readable without this - it simply starts at its
 * best-ranked end, which is a reasonable place to begin reading - but the card
 * the reader is standing on is the anchor the other six are arranged around,
 * and on a phone it starts three cards off the left edge.
 *
 * Measured with rects rather than offsetLeft, which is relative to whatever
 * the nearest positioned ancestor happens to be and would silently change
 * meaning the day something above the rail gains `position: relative`. And
 * only the RAIL scrolls: the page must not jump to the bottom on load.
 */
function wirePeerRail(root: HTMLElement): void {
  for (const rail of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-peers]"))) {
    const current = rail.querySelector<HTMLElement>(".scp-peer.is-current");
    if (!current) continue;
    // A rail that fits has nothing to centre, and every card is already in
    // view - which is the desktop case.
    if (rail.scrollWidth <= rail.clientWidth) continue;

    const railBox = rail.getBoundingClientRect();
    const cardBox = current.getBoundingClientRect();
    rail.scrollLeft +=
      cardBox.left - railBox.left - (rail.clientWidth - cardBox.width) / 2;
  }
}

/* ------------------------------------------------------------ state swap */

/**
 * The controls that re-render the page in another state.
 *
 * Two of them now: the game log's season chips and the advanced table's season
 * chips (both .scp-season-opt). They are one family because they are one thing
 * - a link to THIS page rendered from different state - and the server builds
 * them from pageUrl().
 *
 * The scoring toggle used to be the third and the first. It is gone from the
 * control bar, and with it the
 * only control that ever changed `?format=`; the parameter is still a real
 * address the server renders, and a reader who follows one gets a whole page
 * rather than a swap, which is what a link from outside the page should do.
 */
const SWAP_LINK_SELECTOR = ".scp-season-opt";

/** The groups those links live in, used to find a control again after a swap. */
const SWAP_GROUP_SELECTOR = ".scp-seasons";

/**
 * The URL the content on screen was rendered from.
 *
 * Not `location`, which is deliberately left alone: the whole point of the swap
 * is that `/nfl/players/ashton-jeanty/` stays `/nfl/players/ashton-jeanty/`
 * whatever scoring the reader picks. Read at parse time rather than at boot,
 * because wireTabs rewrites the address bar as soon as a tab is clicked.
 */
let renderedUrl = location.pathname + location.search;

/** The swap in flight. A second click makes the first one's answer stale. */
let swapToken = 0;

/**
 * A URL reduced to the state it names, for comparing two of them.
 *
 * The trailing slash and the parameter order are the server's business and
 * differ between the link (`/nfl/players/x?format=half`) and the address the
 * reader landed on (`/nfl/players/x/`); neither difference is a different page.
 * The hash is dropped outright - nothing navigates, so there is nothing for
 * `#game-log` to scroll to that is not already open.
 */
function stateKey(url: URL): string {
  const params = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  return url.pathname.replace(/\/+$/, "") + (query ? `?${query}` : "");
}

/**
 * Where a control sits among the page's state controls.
 *
 * Group index plus link index, because the identity that matters is positional:
 * the same three scoring options and the same season chips come back in the
 * same order in every render of the page, whatever state it is rendered from.
 * Anything subtler (the href, the label) changes with the state, which is the
 * one thing this must survive.
 */
function controlAddress(root: HTMLElement, link: HTMLAnchorElement): string | null {
  const group = link.closest<HTMLElement>(SWAP_GROUP_SELECTOR);
  if (!group || !root.contains(group)) return null;
  const groups = Array.from(root.querySelectorAll<HTMLElement>(SWAP_GROUP_SELECTOR));
  const links = Array.from(group.querySelectorAll<HTMLAnchorElement>(SWAP_LINK_SELECTOR));
  return `${groups.indexOf(group)}:${links.indexOf(link)}`;
}

/** The same control in a freshly rendered root, if the render still has one. */
function controlAt(root: HTMLElement, address: string | null): HTMLAnchorElement | null {
  if (!address) return null;
  const [groupIndex, linkIndex] = address.split(":").map(Number);
  const group = Array.from(root.querySelectorAll<HTMLElement>(SWAP_GROUP_SELECTOR))[
    groupIndex!
  ];
  if (!group) return null;
  return (
    Array.from(group.querySelectorAll<HTMLAnchorElement>(SWAP_LINK_SELECTOR))[
      linkIndex!
    ] ?? null
  );
}

/**
 * Reopen the tab the reader was on.
 *
 * wireTabs settles the fresh root on the tab the URL names, which after a swap
 * is the tab the page LOADED on rather than the one the reader walked to - the
 * address bar has been left behind on purpose, so it can no longer be asked.
 * Clicking the link goes through wireTabs' own handler, so the heading and the
 * address bar stay in step with the panel exactly as they do for a real click.
 */
function restoreTab(root: HTMLElement, panelId: string): void {
  if (!panelId) return;
  const link = root.querySelector<HTMLAnchorElement>(
    `.scp-nav-link[data-scp-panel-id="${panelId}"]`,
  );
  if (!link || link.classList.contains("is-active")) return;
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/**
 * Fetch this page in another state and put it on screen in place.
 *
 * The response is the whole page - the WordPress mount wraps the fragment in a
 * theme - and all that is taken from it is the profile root, which is the unit
 * the server renders and the unit every behaviour here is wired against.
 *
 * When anything goes wrong the browser is handed the navigation it was about to
 * make. A reader who clicks "Half" must end up looking at half-PPR; a dirty URL
 * is the complaint this function exists to answer, not a reason to show them
 * the wrong numbers.
 */
async function swapState(
  root: HTMLElement,
  target: string,
  link: HTMLAnchorElement,
): Promise<void> {
  const token = ++swapToken;
  root.setAttribute("aria-busy", "true");

  // Measured before the fetch, because the control the reader clicked is the
  // one thing on screen they are certainly looking at: a render that is taller
  // or shorter above it must not slide it out from under the pointer.
  const anchorTop = link.getBoundingClientRect().top;
  const address = controlAddress(root, link);
  const openTab =
    root.querySelector<HTMLElement>(".scp-nav-link.is-active")?.dataset["scpPanelId"] ?? "";

  let next: HTMLElement | null = null;
  try {
    const response = await fetch(target, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "statchasers-player" },
    });
    if (response.ok) {
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      next = doc.querySelector<HTMLElement>(ROOT_SELECTOR);
    }
  } catch {
    next = null;
  }

  // A later click already owns the page. Its own answer will land.
  if (token !== swapToken) return;

  if (!next || !root.isConnected) {
    location.assign(target);
    return;
  }

  const fresh = document.importNode(next, true);
  root.replaceWith(fresh);
  renderedUrl = target;

  wireProfile(fresh);
  restoreTab(fresh, openTab);

  const moved = controlAt(fresh, address);
  if (moved) {
    const drift = moved.getBoundingClientRect().top - anchorTop;
    if (drift) window.scrollBy(0, drift);
    // The reader's focus was on a link that no longer exists. Without this it
    // falls back to <body> and the next Tab starts again from the top.
    moved.focus({ preventScroll: true });
  }
}

/**
 * Let the state controls change the page without changing its address.
 *
 * `?format=half` is a real address that the server renders and the canonical
 * points away from - it has to be, or the toggle would not work with scripting
 * off. What it should not be is the address a reader is left holding after
 * pressing a button on the page they are already on: one page, one URL, and
 * the scoring a reader chose is state, not a different document.
 *
 * Delegated from the root so it keeps working on content this same handler put
 * there, and declined for every click the browser should handle itself -
 * anything with a modifier key, which is how a reader deliberately opens one of
 * these in a new tab.
 */
function wireStateSwap(root: HTMLElement): void {
  root.addEventListener("click", (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>(SWAP_LINK_SELECTOR);
    if (!link || !root.contains(link)) return;
    if (link.target && link.target !== "_self") return;

    let url: URL;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return;
    }
    // Another origin is somebody else's page, and fetching it would be pointless
    // even where CORS allowed it.
    if (url.origin !== location.origin) return;

    event.preventDefault();

    const next = stateKey(url);
    // The lit scoring option, and the lit season chip on the advanced table,
    // both link to the state already on screen. Swallow the click rather than
    // spend a fetch re-rendering what is there. (The game log's lit chip links
    // to the state that CLEARS it, which is a different key and does swap.)
    if (next === stateKey(new URL(renderedUrl, location.href))) return;

    void swapState(root, next, link);
  });
}

/* ------------------------------------------------------- stats toggle */

/**
 * The Stats tab's Season totals / Per game switch.
 *
 * The server prints both figures on every counting stat (data-total, data-pg)
 * and the totals as text, so without this the totals simply stand. Rates and
 * ranks carry neither attribute and never change.
 */
/**
 * The News tab's filters (mak's News spec, 4.2). Without this script every
 * item stays visible, which is the no-JS fallback. A week group with nothing
 * left in it hides too, and the status note says when a filter matches none.
 * "moves" matches the items carrying data-group="moves".
 */
function wireNewsFilter(root: HTMLElement): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-news-filter]"))) {
    if (group.dataset.wired) continue;
    group.dataset.wired = "1";
    const scope = group.closest("section") ?? root;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button[data-f]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const f = button.dataset.f ?? "all";
        let shown = 0;
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
        for (const wk of Array.from(scope.querySelectorAll<HTMLElement>(".scp-nw-wk"))) {
          let any = false;
          for (const item of Array.from(wk.querySelectorAll<HTMLElement>(".scp-nw-item"))) {
            const ok = f === "all" || item.dataset.type === f || (item.dataset.group ?? "") === f;
            item.hidden = !ok;
            if (ok) {
              any = true;
              shown += 1;
            }
          }
          // A pending recap row counts as a game item.
          if (!any && (f === "all" || f === "game") && wk.querySelector(".scp-nw-pending")) any = true;
          wk.hidden = !any;
        }
        const empty = scope.querySelector<HTMLElement>("#scp-nw-empty");
        if (empty) empty.hidden = shown > 0;
        // A match folded into the older weeks opens them.
        const older = scope.querySelector<HTMLDetailsElement>(".scp-nw-older");
        if (older && f !== "all" && older.querySelector(".scp-nw-item:not([hidden])")) older.open = true;
      });
    }
  }
}

function wireStatsToggle(root: HTMLElement): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-seg]"))) {
    const section = group.closest("section") ?? root;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button[data-mode]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const perGame = button.dataset.mode === "pg";
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
        for (const cell of Array.from(section.querySelectorAll<HTMLElement>("[data-total]"))) {
          cell.textContent = (perGame ? cell.dataset.pg : cell.dataset.total) ?? cell.textContent;
        }
      });
    }
  }
}

/**
 * The career chart opens on its newest season.
 *
 * On a narrow screen a long career's chart scrolls, and left alone it opens on
 * the rookie year with the current season out of view.
 */
function wireCareerChart(root: HTMLElement): void {
  const scrollers = Array.from(root.querySelectorAll<HTMLElement>("[data-scp-arc]"));
  const toEnd = (el: HTMLElement): boolean => {
    if (el.clientWidth === 0) return false;
    el.scrollLeft = el.scrollWidth;
    return true;
  };
  // A chart in a hidden tab has no width yet: it scrolls the first time it
  // is shown, and never again, so a reader's own scrolling is left alone.
  const pending = scrollers.filter((el) => !toEnd(el));
  if (pending.length === 0 || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      if (toEnd(el)) observer.unobserve(el);
    }
  });
  for (const el of pending) observer.observe(el);
}

/* ------------------------------------------------------------------ boot */

/**
 * Everything a profile root needs, in one place.
 *
 * Called again on the root a swap puts on screen, so a page the reader has
 * re-rendered behaves exactly like the one they arrived on.
 */
function wireProfile(root: HTMLElement): void {
  wireTabs(root, {
    navSelector: "[data-scp-nav]",
    listSelector: ".scp-nav-list",
    linkSelector: ".scp-nav-link",
    datasetKey: "scpTabs",
    panelKey: "scpPanelId",
    headingKey: "scpHeading",
    leadKey: "scpLead",
    onSelect: (link, id) => headerTab(root, link, id),
  });
  wireTimestamps(root);
  wirePlayerSearch(root);
  wireChartTooltip(root);
  wireHeader(root);
  wireSortableLog(root);
  wireExpandableLog(root);
  wirePeerRail(root);
  wireStatsToggle(root);
  wireNewsFilter(root);
  wireCareerChart(root);
  wireStateSwap(root);
  wireFrameHeight(root);
}

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wireProfile(root);
  }

  for (const root of Array.from(document.querySelectorAll<HTMLElement>(INDEX_SELECTOR))) {
    // The same search widget the profile carries, so the box behaves the same
    // on both pages, plus the chips that are the index's own.
    wirePlayerSearch(root);
    wirePlayerDirectory(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
