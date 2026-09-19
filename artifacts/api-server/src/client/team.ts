/**
 * Team hub enhancement bundle.
 *
 * The page is complete before this file runs — every headline, player, fixture
 * and link is in the HTML the server sent, and the team switcher, the "view
 * more" disclosures and the section tabs all work with JavaScript disabled.
 * Nothing here fetches anything and nothing here renders anything.
 *
 * It adds five things:
 *   1. tab behaviour for the section bar — switching in place instead of
 *      navigating to an anchor, plus the ARIA roles and arrow keys that CSS
 *      `:target` cannot supply on its own;
 *   2. outside-click and Escape closing for the team switcher;
 *   3. relative timestamps ("3 hours ago") on stamps the server rendered as
 *      absolute — the server cannot know "now" without breaking its own render
 *      cache, so the absolute form is what ships and this upgrades it;
 *   4. sortable column headers on the matchup page's stat tables;
   5. height reporting to a parent frame, for the legacy iframe mount.
 */

const ROOT_SELECTOR = "[data-sct-root]";

/* -------------------------------------------------------------- tabs ---- */

/**
 * Turn the section bar into a tab strip.
 *
 * The panels are already one-at-a-time before this runs — CSS `:target` does
 * that, and the page is usable with scripting off. What this adds is the part a
 * selector cannot: switching without navigating (no jump to the anchor, no
 * scroll position lost), the ARIA roles, and arrow-key movement between tabs.
 *
 * The roles are added here rather than server-side on purpose. `role="tab"`
 * promises arrow-key navigation and a roving tabindex; promising that in static
 * HTML and only delivering it if a bundle loads is worse for a screen-reader
 * user than the plain list of links the server sends, which behaves exactly as
 * announced.
 */
function wireTabs(root: HTMLElement): void {
  const nav = root.querySelector<HTMLElement>("[data-sct-nav]");
  if (!nav) return;

  const list = nav.querySelector<HTMLElement>(".sct-nav-list");
  const links = Array.from(
    nav.querySelectorAll<HTMLAnchorElement>(".sct-nav-link"),
  );
  if (links.length === 0) return;

  const tabs: Array<{ id: string; link: HTMLAnchorElement; panel: HTMLElement }> =
    [];
  for (const link of links) {
    const id = link.getAttribute("href")?.replace(/^#/, "");
    if (!id) continue;
    const panel = document.getElementById(id);
    if (!panel) continue;
    tabs.push({ id, link, panel });
  }
  // Below two there is nothing to switch between, and taking over would only
  // mean hiding the one panel there is.
  if (tabs.length < 2) return;

  list?.setAttribute("role", "tablist");
  for (const { id, link, panel } of tabs) {
    link.setAttribute("role", "tab");
    link.setAttribute("aria-controls", id);
    panel.setAttribute("role", "tabpanel");
    // Focusable so the reader who just chose a tab lands on its content, and so
    // a panel that scrolls can be scrolled from the keyboard.
    panel.setAttribute("tabindex", "0");
    const item = link.closest("li");
    if (item) item.setAttribute("role", "presentation");
  }

  function select(id: string, focusPanel: boolean): void {
    for (const tab of tabs) {
      const on = tab.id === id;
      tab.panel.classList.toggle("is-active", on);
      tab.link.classList.toggle("is-active", on);
      tab.link.setAttribute("aria-selected", on ? "true" : "false");
      // Roving tabindex: one stop for the whole strip, arrows move within it.
      tab.link.tabIndex = on ? 0 : -1;
    }
    if (focusPanel) {
      const current = tabs.find((tab) => tab.id === id);
      current?.panel.focus({ preventScroll: true });
    }
  }

  /** The tab the URL asks for, or the first one. */
  function fromHash(): string {
    const id = location.hash.replace(/^#/, "");
    return tabs.some((tab) => tab.id === id) ? id : tabs[0]!.id;
  }

  /**
   * Take the hash OUT of the address bar.
   *
   * The tabs used to write themselves into the URL — #depth-chart and so on —
   * so a tab could be reloaded or shared. That is still true of a link INTO
   * the page: fromHash() honours an arriving hash, and every tab link keeps
   * its href, so a middle-click or a copied link still opens on the right
   * panel. What changed is that clicking a tab no longer rewrites the URL of
   * the page the reader is already on. The address bar shows the page, and
   * only the page.
   *
   * Clearing rather than leaving alone, because a reader who arrived at
   * #depth-chart and then clicked Stats would otherwise be looking at the
   * stats under a URL that says depth chart.
   */
  function clearHash(): void {
    if (!location.hash) return;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      // Some embeddings disallow history writes (a sandboxed frame). The tab
      // still switches; only the stale hash stays.
    }
  }

  // State is settled BEFORE the CSS is handed over, so there is no frame where
  // :target has been switched off and .is-active still names the server's guess
  // — which on a deep link (#depth-chart) would flash the Outlook panel.
  let active = fromHash();
  select(active, false);
  root.dataset["sctTabs"] = "js";

  for (const { id, link } of tabs) {
    link.addEventListener("click", (event) => {
      // Let the browser handle anything that is not a plain left click — a
      // middle click or ctrl-click on these links opens the hub at that tab,
      // which is a genuinely useful thing to be able to do.
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      active = id;
      select(id, true);
      clearHash();
    });
  }

  // A hash arriving from outside — an in-page link, an edit to the address bar,
  // or the back button after some other navigation wrote one.
  window.addEventListener("hashchange", () => {
    const id = fromHash();
    if (id === active) return;
    active = id;
    select(id, false);
  });

  // Arrow keys move between tabs, which is what role="tab" above promised.
  list?.addEventListener("keydown", (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.link === document.activeElement);
    if (index < 0) return;

    let next = index;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index - 1 + tabs.length) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }

    event.preventDefault();
    const tab = tabs[next]!;
    active = tab.id;
    select(tab.id, false);
    tab.link.focus();
    clearHash();
  });
}

/* ----------------------------------------------------------- switcher ---- */

function wireSwitcher(root: HTMLElement): void {
  const details = root.querySelector<HTMLDetailsElement>("[data-sct-switch]");
  if (!details) return;

  const summary = details.querySelector("summary");

  document.addEventListener("click", (event) => {
    if (!details.open) return;
    const target = event.target;
    if (target instanceof Node && details.contains(target)) return;
    details.open = false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !details.open) return;
    details.open = false;
    // Focus goes back to the control that opened the panel — otherwise Escape
    // strands keyboard focus inside a panel that is no longer visible.
    if (summary instanceof HTMLElement) summary.focus();
  });
}

/* ---------------------------------------------------------- timestamps ---- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * @param compact Abbreviated units — "43m ago" rather than "43 min ago".
 *   Asked for by `data-ts-compact`, and used where the stamp is a footnote in a
 *   narrow card rather than a line of its own under a headline.
 */
function relativeLabel(ms: number, now: number, compact = false): string | null {
  const delta = now - ms;
  if (delta < 0) return null;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE);
    return compact ? `${minutes}m ago` : `${minutes} min ago`;
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    if (compact) return `${hours}h ago`;
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (delta < 7 * DAY) {
    const days = Math.floor(delta / DAY);
    if (compact) return `${days}d ago`;
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  // Older than a week: the absolute date the server already rendered is more
  // useful than "37 days ago", so leave it alone.
  return null;
}

function wireTimestamps(root: HTMLElement): void {
  const stamps = Array.from(
    root.querySelectorAll<HTMLTimeElement>("time[data-ts]"),
  );
  if (stamps.length === 0) return;

  const apply = (): void => {
    const now = Date.now();
    for (const stamp of stamps) {
      const ts = Number(stamp.getAttribute("data-ts"));
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const label = relativeLabel(ts, now, stamp.hasAttribute("data-ts-compact"));
      if (!label) continue;
      // The absolute form moves into the tooltip rather than being discarded —
      // "3 hours ago" is easier to read, the exact time is still available, and
      // the machine-readable datetime attribute is untouched either way.
      if (!stamp.title) stamp.title = stamp.textContent?.trim() ?? "";
      stamp.textContent = label;
    }
  };

  apply();
  // Cheap and infrequent: a stamp that says "59 min ago" should become
  // "1 hour ago" without a reload, and nothing else on the page moves.
  window.setInterval(apply, 60_000);
}

/* ------------------------------------------------------ sortable tables ---- */

/**
 * The value a cell sorts on, or null when it has none.
 *
 * Read from `data-sort` rather than parsed out of the text, the way the FPA
 * table's sorting does, because these cells and their values disagree on
 * purpose: "16/22" is two numbers, "90%" is a string, "WR6" is a position and a
 * rank, and the name cell's text is the name, the position and the team code
 * run together. The header declares the type, so a column of digits cannot be
 * mistaken for a number one week and a string the next.
 *
 * An EMPTY `data-sort` is a missing value, not a zero — a player with no passer
 * rating and one with a rating of 0.0 are different things, and only the second
 * belongs at the bottom of the rating column.
 */
function sortValue(
  cell: HTMLTableCellElement | undefined,
  type: string,
): number | string | null {
  if (!cell) return null;
  const raw = cell.getAttribute("data-sort");
  if (raw !== null && raw.trim() === "") return null;
  if (type === "number") {
    const n = Number(raw ?? cell.textContent);
    return Number.isFinite(n) ? n : null;
  }
  return (raw ?? cell.textContent ?? "").trim().toLowerCase();
}

/**
 * Make the marked stat tables sortable by any column.
 *
 * Same behaviour as the game log on the player pages and the FPA table: the
 * header text becomes a button, numeric columns open descending and text
 * columns ascending, and a second click on the same column reverses it.
 *
 * The buttons are built HERE rather than sent in the HTML. A page whose bundle
 * never loads keeps a table it can read and no control that does nothing, which
 * is the rule every other enhancement in this app follows.
 *
 * Rows with no value in the column being sorted are held at the bottom in the
 * order the server sent them, in BOTH directions. That is the one place this
 * differs from the FPA table, which has no empty cells to worry about: sorting
 * ascending by a column where half the rows read "—" would otherwise open with
 * the players the column knows nothing about.
 */
function wireSortableTables(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-sct-sortable]"),
  );

  for (const table of tables) {
    const body = table.querySelector("tbody");
    const headers = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead th"),
    );
    if (!body || headers.length === 0) continue;

    headers.forEach((header, index) => {
      const type = header.getAttribute("data-sort-type") ?? "number";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "sct-sort";
      button.textContent = header.textContent ?? "";
      header.textContent = "";
      header.appendChild(button);

      // The server already ordered the rows by one column and says which, so
      // the table announces the sort it actually has rather than "none". The
      // next click on that column reverses it, as it would on any other.
      const sorted = header.getAttribute("data-sort-default");
      header.setAttribute("aria-sort", sorted ?? "none");

      // Numbers open descending — the top of a stat column is what a reader
      // clicking it is after. Names open ascending, which is A to Z.
      let descending = type === "number";
      if (sorted === "descending") descending = false;

      button.addEventListener("click", () => {
        const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
        // The server's order, to fall back on for rows with nothing to compare
        // and to break ties with — otherwise a column of equal values
        // reshuffles itself on every click.
        const original = new Map(rows.map((row, at) => [row, at]));

        const valued: HTMLTableRowElement[] = [];
        const empty: HTMLTableRowElement[] = [];
        for (const row of rows) {
          const value = sortValue(row.cells[index] as HTMLTableCellElement, type);
          (value === null ? empty : valued).push(row);
        }

        valued.sort((a, b) => {
          const left = sortValue(a.cells[index] as HTMLTableCellElement, type)!;
          const right = sortValue(b.cells[index] as HTMLTableCellElement, type)!;
          let order: number;
          if (typeof left === "number" && typeof right === "number") {
            order = descending ? right - left : left - right;
          } else {
            order = descending
              ? String(right).localeCompare(String(left))
              : String(left).localeCompare(String(right));
          }
          return order !== 0 ? order : (original.get(a) ?? 0) - (original.get(b) ?? 0);
        });

        empty.sort((a, b) => (original.get(a) ?? 0) - (original.get(b) ?? 0));

        for (const row of valued) body.appendChild(row);
        for (const row of empty) body.appendChild(row);

        for (const other of headers) other.setAttribute("aria-sort", "none");
        header.setAttribute("aria-sort", descending ? "descending" : "ascending");
        descending = !descending;
      });
    });

    table.dataset["sctSort"] = "js";
  }
}

/* -------------------------------------------------------- iframe height ---- */

/**
 * Report content height to a parent frame.
 *
 * Mirrors the news tool's behaviour (src/client/main.ts) so a page embedded the
 * legacy way resizes instead of scrolling inside its own box. Measures the
 * root's bottom edge in document coordinates rather than its height, because
 * anything rendered above it shifts content down without making it taller —
 * and a height-only measurement then under-reports by exactly that offset.
 */
function wireFrameHeight(root: HTMLElement): void {
  if (window.parent === window) return;

  let locked = false;
  const postHeight = (): void => {
    const height = Math.ceil(
      root.getBoundingClientRect().bottom + window.scrollY,
    );
    if (height > 0) {
      window.parent.postMessage({ type: "statchasers:height", height }, "*");
    }
  };

  if ("ResizeObserver" in window) {
    new ResizeObserver(() => postHeight()).observe(root);
  }
  window.addEventListener("load", () => postHeight());
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!data) return;
    if (data.type === "statchasers:request-height") postHeight();
    if (data.type === "statchasers:height-applied" && !locked) {
      // Only stop scrolling once the parent proves it is sizing the frame. If
      // the parent's script never runs, the frame is stuck at its placeholder
      // height and must stay scrollable or everything below the fold becomes
      // unreachable.
      locked = true;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }
  });
  // The parent's listener often loads late (performance plugins delay JS until
  // first interaction), so re-broadcast a few times after load.
  for (const ms of [250, 1000, 2500, 5000]) {
    window.setTimeout(postHeight, ms);
  }
}

/* ------------------------------------------------------------------ boot */

function boot(): void {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR),
  );
  for (const root of roots) {
    wireTabs(root);
    wireSwitcher(root);
    wireTimestamps(root);
    wireSortableTables(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
