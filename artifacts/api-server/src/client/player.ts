/**
 * Player page enhancement bundle.
 *
 * The page is complete before this file runs - every stat, every week of the
 * game log, every injury and every chart is in the HTML the server sent, and
 * the tab strip works with JavaScript disabled.
 *
 * It adds six things:
 *   1. tab behavior for the section bar, from client/enhance.ts;
 *   2. relative timestamps on the news list, likewise;
 *   3. height reporting for the legacy iframe mount, likewise;
 *   4. the player search above the header, from client/player-search.ts -
 *      the one control on the page that does not exist until this file runs,
 *      because a search box with no script behind it swallows typing and
 *      answers nothing;
 *   5. the behaviors particular to this page: a hover layer on the weekly
 *      chart, sortable columns on the game log and the career table, the
 *      per-week detail the game log folds away behind each week number, the
 *      header's fallback silhouette and its per-tab subtitle, and centering the
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
import { compareText, sliceClock } from "./schedule-work";

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
      // The game log ships its sort buttons (gamelog-premium.ts), so wiring
      // them changes nothing on screen; other tables still get them built.
      let button = header.querySelector<HTMLButtonElement>(":scope > button.scp-sort");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "scp-sort";
        button.textContent = header.textContent ?? "";
        header.textContent = "";
        header.appendChild(button);
      }
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
            ? compareText(String(right), String(left))
            : compareText(String(left), String(right));
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

      // The game log ships this toggle (and its table folded), so nothing
      // moves when it is wired (gamelog-premium.ts, 2026-11-20). A table that
      // arrives without it still gets it built, the old way.
      let button = head.querySelector<HTMLButtonElement>(":scope > button.scp-expand");
      if (!button) {
        const week = (head.textContent ?? "").trim();
        button = document.createElement("button");
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
      }
      const toggle = button;

      toggle.addEventListener("click", () => {
        const open = detail.classList.toggle("is-open");
        row.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
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
/**
 * Keep the open tab inside the tab strip's visible width when the strip
 * scrolls sideways (the phone, mak's mobile brief 2026-11-05). scrollLeft on
 * the strip itself rather than scrollIntoView, which would also scroll the
 * page; leaves a sliver of the previous tab showing so the overflow reads.
 */
function revealTab(root: HTMLElement, link: HTMLElement | null): void {
  const nav = root.querySelector<HTMLElement>("[data-scp-nav]");
  if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
  const left = link.offsetLeft - nav.offsetLeft;
  const right = left + link.offsetWidth;
  if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
    nav.scrollLeft = Math.max(0, left - 24);
  }
}

function headerTab(root: HTMLElement, link: HTMLAnchorElement, id: string): void {
  revealTab(root, link);
  const kind = link.dataset["scpKind"] ?? "";
  const heading = root.querySelector<HTMLElement>(".scp-phead-h1");
  let line = root.querySelector<HTMLElement>(".scp-phead-kind");
  // The profile's heading is the bare name and carries no line (mak's entity
  // brief, 2026-11-03), so the span is made on the first switch to a section
  // and taken out again on the way back - the heading's text is then exactly
  // what the server would print for the open tab.
  if (kind) {
    if (!line && heading) {
      line = document.createElement("span");
      line.className = "scp-phead-kind";
      heading.append(" ", line);
    }
    if (line) line.textContent = kind;
  } else if (line) {
    if (line.previousSibling?.nodeType === Node.TEXT_NODE) line.previousSibling.remove();
    line.remove();
  }
  const tab = id.replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const cta of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-cta]"))) {
    cta.setAttribute("data-cta", `${cta.dataset["scpCta"]}-${tab}`);
  }
}

/* ------------------------------------------------------------ peers rail */

/**
 * Center the "You are here" card in the positional peers rail.
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
    const current = rail.querySelector<HTMLElement>(".scp-pr-card.is-current");
    if (!current) continue;
    // A rail that fits has nothing to center, and every card is already in
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
 * The Game Log's season buttons (chips, and the phone's dropdown).
 *
 * They were links to `?log=<year>` until the 2026-11-26 audit (WEB-020):
 * every Game Log printed one per season, so every player-season was a
 * crawlable address (Gibbs' hub six, a long career dozens), and each click
 * fetched a whole WordPress page that nothing had cached. Now a click
 * fetches this player's fragment for that season (data-scp-log-src: the
 * embed endpoint through the WordPress proxy, keyed by season in every
 * cache on the way) and puts its root in place of this one. The page's
 * address keeps its path and writes the season as `#log=<year>` (cleared
 * for the default season), which a reload, a bookmark or a shared link
 * reopens; old `?log=` links 301 to that form (the plugin).
 *
 * On the standalone page there is no data-scp-log-src and the fetch is
 * this page's own address with `?log=`, which the app still renders.
 */
const SWAP_BUTTON_SELECTOR = "button.scp-season-opt[data-season]";

/** The chip group, used to find the pressed button again after a swap. */
const SWAP_GROUP_SELECTOR = ".scp-seasons";

/** Where the season attributes live (the chip strip and the phone menu). */
const LOG_ATTRS_SELECTOR = "[data-scp-log-default]";

/**
 * Per page, the id of the latest season request and the fetch it started.
 * Every request takes the next id and aborts the one before it, and an
 * answer whose id is no longer the latest is dropped, so an older season
 * can never land on top of a newer choice.
 */
let swapToken = 0;
let swapController: AbortController | null = null;

/** The `#log=` fragment's season, or null when the hash is something else. */
function hashSeason(): string | null {
  const match = /^#log=(\d{4})$/.exec(location.hash);
  return match ? match[1]! : null;
}

/** Write the shown season into the address bar, or clear it for the default. */
function writeHashSeason(season: string, defaultSeason: string): void {
  const base = location.pathname + location.search;
  try {
    if (season === defaultSeason) {
      if (/^#log=/.test(location.hash)) history.replaceState(history.state, "", base);
    } else {
      history.replaceState(history.state, "", `${base}#log=${season}`);
    }
  } catch {
    // A sandboxed frame may refuse; the log on screen is still right.
  }
}

/** The fetch address for one season of this root's log. */
function seasonTarget(attrs: HTMLElement, season: string): string {
  const src = attrs.dataset["scpLogSrc"] ?? "";
  const isDefault = season === (attrs.dataset["scpLogDefault"] ?? "");
  const url = src ? new URL(src, location.href) : new URL(location.pathname + location.search, location.href);
  url.hash = "";
  if (isDefault) url.searchParams.delete("log");
  else url.searchParams.set("log", season);
  return url.toString();
}

/**
 * Reopen the tab the reader was on.
 *
 * wireTabs settles the fresh root on the tab the URL names. Clicking the
 * link goes through wireTabs' own handler, so the heading and the address
 * bar stay in step with the panel exactly as they do for a real click.
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
 * Fetch one season's log and put it on screen in place.
 *
 * The answer is the player's whole fragment; all that is taken from it is
 * the profile root, the unit every behavior here is wired against. On any
 * failure the log on screen stays as it was (the buttons are not links, so
 * there is no navigation to hand the browser instead).
 */
async function swapSeason(root: HTMLElement, season: string, button: HTMLElement | null): Promise<void> {
  const attrs = root.querySelector<HTMLElement>(LOG_ATTRS_SELECTOR);
  if (!attrs) return;
  const defaultSeason = attrs.dataset["scpLogDefault"] ?? "";
  if (season === (attrs.dataset["scpLogShown"] ?? "")) {
    writeHashSeason(season, defaultSeason);
    return;
  }

  swapController?.abort();
  const token = ++swapToken;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  swapController = controller;
  root.setAttribute("aria-busy", "true");

  // Measured before the fetch: a render that is taller or shorter above
  // the control must not slide it out from under the pointer.
  const anchorTop = button ? button.getBoundingClientRect().top : null;
  const openTab =
    root.querySelector<HTMLElement>(".scp-nav-link.is-active")?.dataset["scpPanelId"] ?? "";

  let next: HTMLElement | null = null;
  try {
    const response = await fetch(seasonTarget(attrs, season), {
      // Same-origin: the proxy is this site; cross-origin it sends nothing.
      credentials: "same-origin",
      headers: { Accept: "text/html", "X-Requested-With": "statchasers-player" },
      signal: controller?.signal,
    });
    if (token !== swapToken) return;
    if (response.ok) {
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      next = doc.querySelector<HTMLElement>(ROOT_SELECTOR);
    }
  } catch {
    next = null;
  }

  // A later click already owns the page. Its own answer will land.
  if (token !== swapToken) return;
  swapController = null;

  const shown = next?.querySelector<HTMLElement>(LOG_ATTRS_SELECTOR)?.dataset["scpLogShown"];
  if (!next || !root.isConnected || shown !== season) {
    root.removeAttribute("aria-busy");
    // A season this player has no log for (an edited `#log=`): say nothing,
    // keep the default, and drop the fragment so a reload does not retry it.
    if (next && shown !== season) writeHashSeason(defaultSeason, defaultSeason);
    return;
  }

  const fresh = document.importNode(next, true);
  root.replaceWith(fresh);
  writeHashSeason(season, defaultSeason);

  wireProfile(fresh);
  restoreTab(fresh, openTab);

  const group = fresh.querySelector<HTMLElement>(SWAP_GROUP_SELECTOR);
  const moved = group?.querySelector<HTMLElement>(`${SWAP_BUTTON_SELECTOR}[data-season="${season}"]`) ?? null;
  if (moved && anchorTop !== null) {
    const drift = moved.getBoundingClientRect().top - anchorTop;
    if (drift) window.scrollBy(0, drift);
  }
  // The reader's focus was on a button that no longer exists. Without this
  // it falls back to <body> and the next Tab starts again from the top.
  if (moved && button) moved.focus({ preventScroll: true });
}

/** The season the address bar asks for, if it is one this log offers. */
function requestedSeason(root: HTMLElement): string | null {
  const season = hashSeason();
  if (!season) return null;
  return root.querySelector(`${SWAP_BUTTON_SELECTOR}[data-season="${season}"]`) ? season : null;
}

/**
 * Wire the season buttons, and honor a `#log=<year>` the page arrived with
 * (a bookmark, a shared link, or an old `?log=` link the plugin 301'd).
 */
function wireStateSwap(root: HTMLElement): void {
  if (!root.querySelector(SWAP_BUTTON_SELECTOR)) return;

  root.addEventListener("click", (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(SWAP_BUTTON_SELECTOR);
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    const menu = button.closest<HTMLDetailsElement>("details[data-scp-yr]");
    if (menu) menu.open = false;
    void swapSeason(root, button.dataset["season"] ?? "", button);
  });

  // Once per page, not per root: a swapped-in root is wired again and must
  // not stack listeners. The live root is looked up when the hash moves.
  if (!hashListening) {
    hashListening = true;
    window.addEventListener("hashchange", () => {
      const live = document.querySelector<HTMLElement>(ROOT_SELECTOR);
      if (!live) return;
      const attrs = live.querySelector<HTMLElement>(LOG_ATTRS_SELECTOR);
      if (!attrs) return;
      const wanted = requestedSeason(live) ?? (/^#log=/.test(location.hash) ? null : attrs.dataset["scpLogDefault"] ?? null);
      if (wanted && wanted !== attrs.dataset["scpLogShown"]) void swapSeason(live, wanted, null);
    });
    const arrived = requestedSeason(root);
    if (arrived) void swapSeason(root, arrived, null);
    else if (/^#log=/.test(location.hash)) {
      const attrs = root.querySelector<HTMLElement>(LOG_ATTRS_SELECTOR);
      if (attrs) writeHashSeason(attrs.dataset["scpLogDefault"] ?? "", attrs.dataset["scpLogDefault"] ?? "");
    }
  }
}

let hashListening = false;

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
        // The story cards (the team pages' News design, 2026-11-06); a match
        // in the folded cards opens the fold.
        for (const item of Array.from(scope.querySelectorAll<HTMLElement>("[data-scp-news-item]"))) {
          const ok = f === "all" || item.dataset.type === f || (item.dataset.group ?? "") === f;
          item.hidden = !ok;
          if (ok) shown += 1;
        }
        const fold = scope.querySelector<HTMLDetailsElement>(".scp-nwp-fold");
        if (fold && f !== "all" && fold.querySelector("[data-scp-news-item]:not([hidden])")) fold.open = true;
        const empty = scope.querySelector<HTMLElement>("#scp-nw-empty");
        if (empty) empty.hidden = shown > 0;
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
 * The career table's column switch (2026-11-04): NFL stats or fantasy
 * stats. Both sets are served; the table's data-scp-view says which one
 * shows, and the stylesheet hides the other.
 */
function wireCareerView(root: HTMLElement): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-view-seg]"))) {
    const section = group.closest("section") ?? root;
    const table = section.querySelector<HTMLElement>("table[data-scp-view]");
    if (!table) continue;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button[data-view]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        table.dataset.scpView = button.dataset.view ?? "nfl";
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
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

/**
 * The career chart's tap detail (2026-11-06).
 *
 * Each bar carries its season's detail (team, games, PPG, points, rank) in
 * data-scp-cp-tip. A tap, hover or focus prints it in one line under the
 * bars (never over them or the heading), and a second tap clears it. The
 * labels under the bars keep only the year and the rank.
 */
function wireCareerTips(root: HTMLElement): void {
  for (const figure of Array.from(root.querySelectorAll<HTMLElement>(".scp-cp-chart"))) {
    const cols = Array.from(figure.querySelectorAll<HTMLElement>("[data-scp-cp-tip]"));
    const scroller = figure.querySelector<HTMLElement>("[data-scp-arc]");
    if (cols.length === 0 || !scroller) continue;
    const tip = document.createElement("p");
    tip.className = "scp-cp-tip";
    tip.hidden = true;
    tip.setAttribute("role", "status");
    scroller.insertAdjacentElement("afterend", tip);
    let open: HTMLElement | null = null;
    const show = (col: HTMLElement): void => {
      tip.textContent = col.getAttribute("data-scp-cp-tip") ?? "";
      tip.hidden = false;
      for (const other of cols) other.classList.toggle("is-hot", other === col);
      open = col;
    };
    const hide = (): void => {
      tip.hidden = true;
      for (const other of cols) other.classList.remove("is-hot");
      open = null;
    };
    for (const col of cols) {
      col.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") show(col);
      });
      col.addEventListener("click", () => (open === col ? hide() : show(col)));
      col.addEventListener("focus", () => show(col));
    }
    figure.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") hide();
    });
  }
}

/**
 * Info buttons (2026-11-06): each opens the definition named by its
 * aria-controls, in place, and closes it on a second tap.
 */
function wireInfoButtons(root: HTMLElement): void {
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-scp-info]"))) {
    const id = btn.getAttribute("aria-controls");
    const panel = id ? root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
    if (!panel) continue;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opening = panel.hidden;
      panel.hidden = !opening;
      btn.setAttribute("aria-expanded", String(opening));
    });
  }
}

/* ------------------------------------------------------------------ boot */

/**
 * Everything a profile root needs, in one place.
 *
 * Called again on the root a swap puts on screen, so a page the reader has
 * re-rendered behaves exactly like the one they arrived on.
 */
/* ------------------------------------------------------------ durability */

/**
 * The Durability Profile card (lib/player/injury-durability.ts): the figure
 * dressed in the club's kit, and one selected region shared by the figure's
 * markers, the pills, the grid's outlined weeks and the open record.
 *
 * The page arrives complete: the worst region is open and its weeks outlined
 * server-side. This makes the other regions reachable.
 */
function wireDurability(root: HTMLElement): void {
  for (const card of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-durability]"))) {
    const figure = card.querySelector<HTMLElement>("[data-scp-figure]");
    if (figure) void paintFigure(figure);

    const boxes = Array.from(card.querySelectorAll<HTMLElement>(".scp-in-ab.is-r[data-s]"));
    const select = (key: string | null): void => {
      for (const el of Array.from(card.querySelectorAll<HTMLElement>("[data-region]"))) {
        const on = key !== null && el.getAttribute("data-region") === key;
        el.classList.toggle("is-on", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
      figure?.classList.toggle("has-sel", key !== null);
      let lost: Record<string, number[]> = {};
      // The map panel's "selected location" box, one per region.
      for (const panel of Array.from(card.querySelectorAll<HTMLElement>("[data-region-panel]"))) {
        panel.hidden = key === null || panel.getAttribute("data-region-panel") !== key;
      }
      for (const panel of Array.from(card.querySelectorAll<HTMLElement>("[data-region-detail]"))) {
        const mine = key !== null && panel.getAttribute("data-region-detail") === key;
        panel.hidden = !mine;
        if (mine) {
          try {
            lost = JSON.parse(panel.getAttribute("data-lost") ?? "{}") as Record<string, number[]>;
          } catch {
            lost = {};
          }
        }
      }
      for (const box of boxes) {
        const weeks = lost[box.getAttribute("data-s") ?? ""];
        box.classList.toggle("is-mark", !!weeks && weeks.includes(Number(box.getAttribute("data-w"))));
      }
    };

    card.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // The phone fold on the availability matrix: the five most recent
      // seasons open, the rest behind "View full career".
      const more = target.closest<HTMLButtonElement>("[data-scp-avail-more]");
      if (more) {
        const grid = more.closest<HTMLElement>("[data-scp-avail]");
        if (!grid) return;
        const open = grid.classList.toggle("is-open");
        more.setAttribute("aria-expanded", String(open));
        more.textContent = open ? "Show recent seasons only" : (more.getAttribute("data-label") ?? more.textContent);
        return;
      }
      if (target.closest("[data-region-close]")) {
        select(null);
        return;
      }
      const control = target.closest<HTMLElement>("[data-region]");
      if (!control || !card.contains(control)) return;
      const key = control.getAttribute("data-region");
      select(control.classList.contains("is-on") ? null : key);
    });
  }
}

/* The figure (Redraft Command's UniformFigure, 2026-10-23): one base render
   wears a solid orange uniform. Orange is easy to find by hue, and its
   brightness is the render's lighting, so recoloring a pixel is: keep how
   bright it is, swap what color it is. Helmet, jersey, socks and cleat trim
   take the club's primary color; pants and gloves its secondary. The flat
   backdrop is keyed out so the figure stands on the page. Rendered once per
   kit and number, then cached for the session. */
const FIG_W = 383;
const FIG_H = 753;
const CHEST = { cx: 197.5, cy: 234, w: 96, h: 80 };
const PANTS_TOP = 0.435;
const PANTS_BOTTOM = 0.72;
const BACKDROP_TOLERANCE = 3;
const EDGE_BLEND = 40;
const NUMBER_FONT = '800 100px Archivo, "Arial Black", Impact, sans-serif';
const figureCache = new Map<string, Promise<HTMLCanvasElement>>();

type Rgb = [number, number, number];
const hexRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
};
const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function isUniform(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx < 0.18 || (mx - mn) / mx <= 0.42) return false;
  let h = mx === r ? 60 * (((g - b) / (mx - mn)) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
  if (h < 0) h += 360;
  return h >= 8 && h <= 42;
}

/*
 * The pixel passes below are time-sliced (INP audit, 2026-11-15): together
 * they were one 120-170ms task on a throttled phone, run when the base image
 * loads - right when a reader is likely to tap. Each loop now checks a clock
 * every few thousand pixels and yields once its slice is spent, so a tap
 * waits at most a slice. Same operations, same order, same pixels.
 */
const SLICE_CHECK = 4096;

async function keyBackdrop(a: Uint8ClampedArray, W: number, H: number): Promise<void> {
  const clock = sliceClock();
  const corners = [0, W - 1, (H - 1) * W, H * W - 1].map((p) => p * 4);
  const bg = [0, 1, 2].map((k) => corners.reduce((sum, i) => sum + a[i + k]!, 0) / corners.length);
  const dist = (p: number): number => {
    const i = p * 4;
    return Math.max(Math.abs(a[i]! - bg[0]!), Math.abs(a[i + 1]! - bg[1]!), Math.abs(a[i + 2]! - bg[2]!));
  };
  const cleared = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x += 1) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 1) stack.push(y * W, y * W + W - 1);
  let steps = 0;
  while (stack.length) {
    if (++steps % SLICE_CHECK === 0 && clock.due()) await clock.next();
    const p = stack.pop()!;
    if (cleared[p] || dist(p) > BACKDROP_TOLERANCE) continue;
    cleared[p] = 1;
    a[p * 4 + 3] = 0;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  for (let p = 0; p < W * H; p += 1) {
    if (p % SLICE_CHECK === 0 && clock.due()) await clock.next();
    if (cleared[p]) continue;
    const x = p % W;
    const touches = (x > 0 && cleared[p - 1]) || (x < W - 1 && cleared[p + 1]) || (p >= W && cleared[p - W]) || (p < W * (H - 1) && cleared[p + W]);
    if (!touches) continue;
    const d = dist(p);
    if (d >= EDGE_BLEND) continue;
    const alpha = Math.max(0.05, (d - BACKDROP_TOLERANCE) / (EDGE_BLEND - BACKDROP_TOLERANCE));
    const i = p * 4;
    for (let k = 0; k < 3; k += 1) a[i + k] = (a[i + k]! - bg[k]! * (1 - alpha)) / alpha;
    a[i + 3] = Math.round(255 * alpha);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("figure base failed to load"));
    img.src = src;
  });
}

async function drawNumber(number: string, fill: string, outline: string): Promise<ImageData> {
  try {
    await Promise.race([document.fonts.load(NUMBER_FONT), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* the fallback fonts draw a fine number */
  }
  const c = document.createElement("canvas");
  c.width = FIG_W;
  c.height = FIG_H;
  const x = c.getContext("2d")!;
  x.font = NUMBER_FONT;
  x.textAlign = "center";
  x.textBaseline = "alphabetic";
  const m = x.measureText(number);
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const sy = CHEST.h / glyphH;
  const sx = Math.min(sy * 0.86, CHEST.w / m.width);
  x.translate(CHEST.cx, CHEST.cy + CHEST.h / 2 - m.actualBoundingBoxDescent * sy);
  x.scale(sx, sy);
  x.lineJoin = "miter";
  x.strokeStyle = "rgba(0,0,0,0.85)";
  x.lineWidth = 13 / sy;
  x.strokeText(number, 0, 0);
  x.strokeStyle = outline;
  x.lineWidth = 8 / sy;
  x.strokeText(number, 0, 0);
  x.fillStyle = fill;
  x.fillText(number, 0, 0);
  return x.getImageData(0, 0, FIG_W, FIG_H);
}

function renderFigure(src: string, primaryHex: string, secondaryHex: string, number: string): Promise<HTMLCanvasElement> {
  const key = `${primaryHex}|${secondaryHex}|${number}`;
  const hit = figureCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const img = await loadImage(src);
    const primary = hexRgb(primaryHex);
    const secondary = hexRgb(secondaryHex);
    // Light jersey -> dark numbers; otherwise white. Outline in the secondary
    // when it stands apart from both the number and the jersey.
    const darkNumbers = luma(primary) > 0.55;
    const numberFill = darkNumbers ? (luma(secondary) < 0.3 ? secondaryHex : "#111111") : "#ffffff";
    const fillL = luma(hexRgb(numberFill));
    const secondaryWorks = Math.abs(luma(secondary) - fillL) > 0.22 && Math.abs(luma(secondary) - luma(primary)) > 0.15;
    const numberOutline = secondaryWorks ? secondaryHex : darkNumbers ? "#ffffff" : "#111111";

    const c = document.createElement("canvas");
    c.width = FIG_W;
    c.height = FIG_H;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, FIG_W, FIG_H);
    const a = data.data;
    await keyBackdrop(a, FIG_W, FIG_H);
    const pantsTop = FIG_H * PANTS_TOP;
    const pantsBottom = FIG_H * PANTS_BOTTOM;
    const shadeAt = new Float32Array(FIG_W * FIG_H);
    const clock = sliceClock();
    for (let p = 0; p < FIG_W * FIG_H; p += 1) {
      if (p % SLICE_CHECK === 0 && clock.due()) await clock.next();
      const i = p * 4;
      const r = a[i]! / 255;
      const g = a[i + 1]! / 255;
      const b = a[i + 2]! / 255;
      if (!isUniform(r, g, b)) continue;
      const y = (p / FIG_W) | 0;
      const color = y > pantsTop && y < pantsBottom ? secondary : primary;
      const shade = Math.min(1.25, Math.max(r, g, b) / 0.93);
      shadeAt[p] = shade;
      const spec = Math.max(0, shade - 0.78) ** 2 * 1.6;
      for (let k = 0; k < 3; k += 1) a[i + k] = Math.min(255, 255 * (color[k]! * shade * 0.95 + 0.06 * shade + spec));
    }
    if (number) {
      const n = (await drawNumber(number, numberFill, numberOutline)).data;
      let sum = 0;
      let cnt = 0;
      for (let y = CHEST.cy - CHEST.h / 2; y < CHEST.cy + CHEST.h / 2; y += 1) {
        for (let xx = CHEST.cx - CHEST.w / 2; xx < CHEST.cx + CHEST.w / 2; xx += 1) {
          const s = shadeAt[(y | 0) * FIG_W + (xx | 0)]!;
          if (s) {
            sum += s;
            cnt += 1;
          }
        }
      }
      const mean = cnt ? sum / cnt : 1;
      for (let p = 0; p < FIG_W * FIG_H; p += 1) {
        if (p % SLICE_CHECK === 0 && clock.due()) await clock.next();
        const i = p * 4;
        const alpha = n[i + 3]! / 255;
        if (!alpha || !shadeAt[p]) continue;
        const light = Math.min(1.2, Math.max(0.55, shadeAt[p]! / mean));
        for (let k = 0; k < 3; k += 1) a[i + k] = a[i + k]! + (Math.min(255, n[i + k]! * light) - a[i + k]!) * alpha;
      }
    }
    x.putImageData(data, 0, 0);
    return c;
  })();
  job.catch(() => figureCache.delete(key));
  figureCache.set(key, job);
  return job;
}

/**
 * Dress the figure. The painted canvas goes into the frame itself (a copy,
 * so two figures on one page share one render), no encode and decode in
 * between: the pixels the script finished are the pixels on screen.
 */
async function paintFigure(figure: HTMLElement): Promise<void> {
  const img = figure.querySelector<HTMLImageElement>("img");
  if (!img || figure.dataset["painted"]) return;
  figure.dataset["painted"] = "1";
  // A host image optimizer (WP Rocket's LazyLoad) can swap the base render's
  // src for a 0x0 SVG placeholder and park the real address in
  // data-lazy-src. Recoloring the placeholder painted an empty canvas over
  // the figure - and spent a long task on it - so read the real one.
  const src = img.getAttribute("src") ?? "";
  const lazy = img.getAttribute("data-lazy-src") ?? "";
  const base = lazy && (src === "" || src.startsWith("data:")) ? lazy : src;
  const primary = figure.getAttribute("data-primary") ?? "#4b5563";
  const secondary = figure.getAttribute("data-secondary") ?? "#9ca3af";
  const number = figure.getAttribute("data-number") ?? "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const painted = await renderFigure(base, primary, secondary, number);
      const copy = document.createElement("canvas");
      copy.width = painted.width;
      copy.height = painted.height;
      copy.className = "scp-in-fig-canvas";
      copy.setAttribute("aria-hidden", "true");
      copy.getContext("2d")!.drawImage(painted, 0, 0);
      figure.insertBefore(copy, img);
      figure.classList.add("is-ready");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  // Tainted canvas or a dropped download: show the base render rather than
  // nothing behind the markers.
  figure.classList.add("is-fallback");
}

/**
 * The phone's season dropdown on the Game Log heading (a <details>): close it
 * on a tap outside it and on Escape, as a menu does. Picking a season needs
 * nothing here, because its options are the season swap's buttons.
 */
function wireSeasonMenu(root: HTMLElement): void {
  const menus = Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-scp-yr]"));
  if (!menus.length) return;
  document.addEventListener("click", (event) => {
    for (const menu of menus) {
      if (menu.open && !(event.target instanceof Node && menu.contains(event.target))) menu.open = false;
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus();
    }
  });
}

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
  revealTab(root, root.querySelector<HTMLElement>(".scp-nav-link.is-active"));
  wireTimestamps(root);
  wirePlayerSearch(root);
  wireChartTooltip(root);
  wireHeader(root);
  wireSortableLog(root);
  wireExpandableLog(root);
  wirePeerRail(root);
  wireStatsToggle(root);
  wireCareerView(root);
  wireNewsFilter(root);
  wireCareerChart(root);
  wireCareerTips(root);
  wireInfoButtons(root);
  wireStateSwap(root);
  wireDurability(root);
  wireFrameHeight(root);
  wireSeasonMenu(root);
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
