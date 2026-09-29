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
    // The href is the section's own address now, so it no longer names the
    // panel. `data-sct-panel-id` does. The hash is still read as a fallback so
    // a cached page from before this change keeps working.
    const id =
      link.dataset["sctPanelId"] ?? link.getAttribute("href")?.replace(/^#/, "");
    if (!id) continue;
    const panel = document.getElementById(id);
    if (!panel) continue;
    tabs.push({ id, link, panel });
  }
  // Below two there is nothing to switch between, and taking over would only
  // mean hiding the one panel there is.
  //
  // This is also what makes a SECTION page behave correctly without a second
  // code path. It carries the same strip but only its own panel, so exactly one
  // link resolves here, the takeover is declined, and every tab stays an
  // ordinary link that loads the page it names.
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
   * The page's H1 and standfirst, which this fragment does not own.
   *
   * The HOST's, strictly: the plugin marks its own with these attributes, and
   * the fallback is the first H1 in the document FROM OUTSIDE this root. A tab
   * click rewrites the title of the page the hub is mounted in, since that
   * title names the address the click just pushed — it does not touch the hero,
   * which says the club's name on every tab and is not a caption for whichever
   * panel is open. On the standalone page the only H1 is the hero's, so there
   * is nothing here to rewrite and nothing is invented: a page that chose not
   * to print a heading of its own does not get one from a tab click.
   */
  const headingEl =
    document.querySelector<HTMLElement>("[data-sct-page-title]") ??
    Array.from(document.querySelectorAll<HTMLElement>("h1")).find(
      (el) => !root.contains(el),
    ) ??
    null;
  const leadEl = document.querySelector<HTMLElement>("[data-sct-page-lead]");

  // What the page said when it loaded, so Back can put it back. Captured rather
  // than sent by the server, because this is the heading of whatever address
  // the reader actually arrived at.
  const landedUrl = location.pathname + location.search;
  const landedHeading = headingEl?.textContent ?? "";
  const landedLead = leadEl?.textContent ?? "";
  const landedTitle = document.title;

  // The document title with the heading, and before the URL is pushed: GA4
  // records a history change as a page view under the title it reads then.
  function setHeading(heading: string, lead: string, title = ""): void {
    if (headingEl && heading) headingEl.textContent = heading;
    if (leadEl && lead) leadEl.textContent = lead;
    document.title = title || landedTitle;
  }

  /**
   * Put the section's own address in the address bar.
   *
   * The panel switched in place, so nothing loaded — but the reader is now
   * looking at the Depth Chart, and the URL should say so. It is the same
   * address the link would have loaded, and the server renders that page
   * standalone, so a reload, a share or a bookmark all land on what is on
   * screen.
   *
   * `push` for a click, so Back steps through the tabs the reader opened;
   * `replace` for the arrow keys, because holding Right through five tabs
   * should not bury the page they arrived from under five history entries.
   */
  function writeUrl(url: string, mode: "push" | "replace"): void {
    try {
      const current = location.pathname + location.search;
      if (url === current) return;
      if (mode === "push") history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    } catch {
      // Some embeddings disallow history writes (a sandboxed frame). The tab
      // still switches; only the address bar stays behind.
    }
  }

  /** The tab whose address this path is, or null for the page we landed on. */
  function fromPath(path: string): string | null {
    for (const tab of tabs) {
      const href = tab.link.getAttribute("href");
      if (!href) continue;
      // Compared as paths rather than by string equality: the href may be
      // relative and the location is always absolute.
      // The trailing slash is dropped from both: the Outlook tab links to the
      // hub as `/team/<slug>/`, and the hub's own address has none.
      const resolved = new URL(href, location.origin).pathname;
      if (resolved.replace(/\/+$/, "") === path.replace(/\/+$/, "")) return tab.id;
    }
    return null;
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
      setHeading(
        link.dataset["sctHeading"] ?? "",
        link.dataset["sctLead"] ?? "",
        link.dataset["scTitle"] ?? "",
      );
      writeUrl(new URL(link.href, location.origin).pathname, "push");
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
    setHeading(
      tab.link.dataset["sctHeading"] ?? "",
      tab.link.dataset["sctLead"] ?? "",
      tab.link.dataset["scTitle"] ?? "",
    );
    writeUrl(new URL(tab.link.href, location.origin).pathname, "replace");
  });

  /**
   * Back and forward through the tabs.
   *
   * Without this the address bar would walk back through the sections while the
   * page kept showing the last one clicked — the failure that makes people
   * distrust a URL that changed without a load. A path that belongs to no tab
   * is the address the reader landed on, which restores the first panel and the
   * heading captured at load.
   */
  window.addEventListener("popstate", () => {
    const path = location.pathname;
    const id = fromPath(path);

    if (id) {
      active = id;
      select(id, false);
      const link = tabs.find((tab) => tab.id === id)!.link;
      setHeading(
        link.dataset["sctHeading"] ?? "",
        link.dataset["sctLead"] ?? "",
        link.dataset["scTitle"] ?? "",
      );
      return;
    }

    if (path + location.search === landedUrl) {
      active = tabs[0]!.id;
      select(active, false);
      setHeading(landedHeading, landedLead);
    }
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

/* ------------------------------------------------------ scoring switch ---- */

type ScoringFormat = "ppr" | "half" | "std";
const SCORING_KEY = "sct-scoring";
const SCORING_OPTIONS: Array<[ScoringFormat, string]> = [
  ["ppr", "PPR"],
  ["half", "Half PPR"],
  ["std", "Standard"],
];
/** The leaders strip's unit line, per format. */
const POINTS_UNIT: Record<ScoringFormat, string> = { ppr: "PPR pts", half: "Half PPR pts", std: "Std pts" };
let scoringGroups = 0;

/**
 * PPR / Half PPR / Standard for the matchup page's fantasy figures.
 *
 * The server prints PPR and carries all three on each figure as data-fmt-*
 * (the stat tables) or data-ppr/-half/-std (the leaders strip), so switching
 * is a swap of text already on the page — nothing is fetched or recomputed.
 * The switch is built here, not sent in the HTML: without this bundle there is
 * nothing for it to switch, and the page reads as PPR.
 *
 * A table sorted by one of the swapped columns is re-sorted on the new values,
 * so the order still matches the numbers. The choice is remembered per viewer.
 */
function wireScoring(root: HTMLElement): void {
  const slot = root.querySelector<HTMLElement>("[data-sct-scoring-slot]");
  if (!slot) return;

  const name = `sct-scoring-${(scoringGroups += 1)}`;
  const group = document.createElement("fieldset");
  group.className = "sct-mu-scoring";
  const legend = document.createElement("legend");
  legend.className = "sct-mu-scoring-legend";
  legend.textContent = "Scoring";
  group.appendChild(legend);
  for (const [value, label] of SCORING_OPTIONS) {
    const option = document.createElement("label");
    option.className = "sct-mu-scoring-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = value === "ppr";
    const text = document.createElement("span");
    text.textContent = label;
    option.append(input, text);
    group.appendChild(option);
  }
  slot.appendChild(group);

  const apply = (format: ScoringFormat): void => {
    for (const cell of Array.from(root.querySelectorAll<HTMLElement>(`td[data-fmt-${format}]`))) {
      cell.textContent = cell.getAttribute(`data-fmt-${format}`) ?? "";
      cell.setAttribute("data-sort", cell.getAttribute(`data-fmt-sort-${format}`) ?? "");
    }
    for (const header of Array.from(root.querySelectorAll<HTMLElement>(`th[data-fmt-${format}]`))) {
      const target = header.querySelector<HTMLElement>("button.sct-sort") ?? header;
      target.textContent = header.getAttribute(`data-fmt-${format}`) ?? "";
    }
    for (const number of Array.from(root.querySelectorAll<HTMLElement>(".sct-ls-num[data-ppr]"))) {
      number.textContent = number.getAttribute(`data-${format}`) ?? number.textContent;
      const unit = number.parentElement?.querySelector(".sct-ls-unit");
      if (unit) unit.textContent = POINTS_UNIT[format];
    }
    // Re-sort a table whose active sort is a swapped column: two clicks run the
    // same direction again on the new values.
    for (const table of Array.from(root.querySelectorAll<HTMLTableElement>("table[data-sct-sortable]"))) {
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
      const active = headers.find((h) => (h.getAttribute("aria-sort") ?? "none") !== "none");
      if (!active) continue;
      const index = headers.indexOf(active);
      const swapped = table.querySelector(`tbody tr td:nth-child(${index + 1})[data-fmt-ppr]`);
      const button = active.querySelector<HTMLButtonElement>("button.sct-sort");
      if (swapped && button) {
        button.click();
        button.click();
      }
    }
  };

  group.addEventListener("change", (event) => {
    const value = (event.target as HTMLInputElement).value as ScoringFormat;
    apply(value);
    try {
      window.localStorage.setItem(SCORING_KEY, value);
    } catch {
      // Private mode or blocked storage: the switch still works, it is just not remembered.
    }
  });

  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(SCORING_KEY);
  } catch {
    saved = null;
  }
  if (saved === "half" || saved === "std") {
    const input = group.querySelector<HTMLInputElement>(`input[value="${saved}"]`);
    if (input) input.checked = true;
    apply(saved);
  }
}

/* ------------------------------------------------ recap: format switch ---- */

/**
 * The recap's PPR / Half PPR / Standard switch.
 *
 * The radios are in the server's HTML (recap fantasy-section.ts), and so is
 * every value: each points figure carries data-ppr, data-half and data-std,
 * and this swaps the text in place — the widths are tabular, so nothing moves.
 * Then each fantasy table is re-sorted by its rows' data-sort-<format>, the
 * top-scorer marker moves to the new first row, and the +/- cells are
 * recoloured by their new sign. The choice is shared with the matchup page's
 * own switch through the same storage key.
 */
function wireFantasyFormat(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("[data-fp-root]");
  if (!section) return;
  const radios = Array.from(section.querySelectorAll<HTMLInputElement>('input[name="sct-fp-format"]'));
  if (radios.length === 0) return;

  const apply = (format: ScoringFormat): void => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-ppr][data-half][data-std]"))) {
      el.textContent = el.getAttribute(`data-${format}`) ?? el.textContent;
      if (el.classList.contains("sct-fp-diff")) {
        const text = el.textContent ?? "";
        el.classList.toggle("is-pos", text.startsWith("+"));
        el.classList.toggle("is-neg", text.startsWith("\u2212"));
      }
    }
    for (const unit of Array.from(root.querySelectorAll<HTMLElement>(".sct-ls-unit"))) {
      unit.textContent = POINTS_UNIT[format];
    }
    for (const table of Array.from(section.querySelectorAll<HTMLTableElement>("table[data-fp-table]"))) {
      const body = table.tBodies[0];
      if (!body) continue;
      const rows = Array.from(body.rows);
      const value = (row: HTMLTableRowElement): number =>
        Number.parseFloat(row.getAttribute(`data-sort-${format}`) ?? "0") || 0;
      rows.sort((a, b) => value(b) - value(a));
      for (const row of rows) body.appendChild(row);
      if (table.hasAttribute("data-fp-notop")) continue;
      const top = rows.length ? value(rows[0]!) : 0;
      for (const row of rows) {
        row.querySelector(".sct-fp-pts")?.classList.toggle("is-top", top > 0 && value(row) === top);
      }
    }
  };

  section.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== "sct-fp-format") return;
    const value = target.value as ScoringFormat;
    apply(value);
    try {
      window.localStorage.setItem(SCORING_KEY, value);
    } catch {
      // Blocked storage: the switch still works, it is just not remembered.
    }
  });

  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(SCORING_KEY);
  } catch {
    saved = null;
  }
  if (saved === "half" || saved === "std") {
    const input = radios.find((r) => r.value === saved);
    if (input) input.checked = true;
    apply(saved);
  }
}

/**
 * The highlights box: a thumbnail button until pressed, then the player. The
 * iframe is never in the HTML, so nothing from YouTube loads for a reader who
 * does not ask for it. A thumbnail that fails leaves the team-colour ground.
 */
function wireHighlights(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[data-hl-thumb]"))) {
    if (img.complete && img.naturalWidth === 0) img.remove();
    else img.addEventListener("error", () => img.remove(), { once: true });
  }
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button.sct-hl-play[data-yt]"))) {
    button.addEventListener(
      "click",
      () => {
        const id = button.getAttribute("data-yt") ?? "";
        if (!/^[\w-]{6,20}$/.test(id)) return;
        const frame = document.createElement("iframe");
        frame.className = "sct-hl-frame";
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
        frame.title = button.getAttribute("data-yt-title") ?? "Game highlights";
        frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        frame.allowFullscreen = true;
        frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        button.replaceWith(frame);
        frame.focus();
      },
      { once: true },
    );
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

/* ------------------------------------------------------------- hero facts */

/**
 * Shorten the hero's fact chips, a rung at a time, rather than let them wrap.
 *
 * Five chips need between 555px (Washington) and 617px (Minnesota) on one
 * line — the spread is the coach's name, mostly — and under that the Bye chip
 * drops to a row of its own with the rest of the line left empty. Two of the
 * chips carry a shorter spelling of themselves for that, and they are spent in
 * the order a reader can most afford:
 *
 *   short — "2nd in AFC East" → "2nd", about 60px. The division it drops is
 *           the chip two to its left, so nothing leaves the row.
 *   tight — "Week 11" → "W11", about 35px, under a label that reads BYE.
 *   drop  — the Bye chip off the row entirely, which is the whole of it.
 *
 * The row stops at the first rung that fits, so most widths spend nothing and
 * a narrow one spends only what it has to.
 *
 * The last rung is a chip rather than a spelling because by then there is no
 * spelling left: "W11" is the shortest true form of the fact, and a row that
 * still does not fit it has only the two endings. One is what this did before
 * — the chip alone on a second line, one short word with an empty line beside
 * it, which mak asked to stop seeing. The other is no chip, and it is the
 * cheaper of the two here: the bye is the one fact in this row the hub also
 * states in full a tab away, on the Schedule tab's season table and in the
 * summary beside it. The chip comes back the moment the room does, because
 * every rung is re-decided from the full forms on each resize.
 *
 * Measured rather than written as breakpoints because the width where five
 * chips stop fitting is a different width for all 32 clubs — the same reason
 * the switcher beside them wraps on its content (see .sct-hero-head in
 * team.css). A single number would take the division off half the league while
 * it still fits, and leave the other half wrapping before it was spent.
 *
 * Each rung is decided from the state above it, starting at the full forms: the
 * attribute comes off, the row is measured, and a rung is spent only if it is
 * still wrapping. Measuring in the short form would answer a different
 * question — "does the short form fit", which stays true long after the full
 * one stopped fitting — and the row would never climb back.
 */
/**
 * The rungs, in the order they are spent.
 *
 * The first two are `data-sct-spend` on a chip that has two spellings; the
 * last is `data-sct-drop` on the one chip that may leave. Both are read by
 * team.css off `data-sct-facts-form`, which is the list of rungs spent.
 */
const FACT_STAGES = ["short", "tight", "drop"];
function wireFacts(root: HTMLElement): void {
  const facts = root.querySelector<HTMLElement>("[data-sct-facts]");
  if (!facts) return;
  const chips = Array.from(facts.children) as HTMLElement[];
  if (chips.length < 2) return;
  // The box whose width is the row's available width. It is `flex: 1 0 100%`,
  // so the swap below cannot change it — which is what makes it safe to watch.
  const column = facts.parentElement;
  if (!column) return;

  const wrapped = (): boolean => {
    const top = chips[0]!.offsetTop;
    return chips.some((chip) => chip.offsetTop > top);
  };

  let lastWidth = -1;
  const fit = (): void => {
    const width = Math.round(column.getBoundingClientRect().width);
    // Height changes are this function's own doing; only a width change can
    // change its answer, and ignoring the rest is what stops the observer
    // below from feeding itself.
    if (width === lastWidth) return;
    lastWidth = width;

    facts.removeAttribute("data-sct-facts-form");
    // Below 720px the chips are a two-column grid where every chip after the
    // first two is legitimately on another row, so "did it wrap" means nothing
    // and the full spellings fit their columns anyway.
    if (getComputedStyle(facts).display !== "flex") return;

    const spent: string[] = [];
    for (const stage of FACT_STAGES) {
      if (!wrapped()) break;
      spent.push(stage);
      // Applied before the next pass measures, so each rung is judged on what
      // the one above it actually bought.
      facts.setAttribute("data-sct-facts-form", spent.join(" "));
    }
  };

  fit();
  // `typeof`, not `"ResizeObserver" in window`: the `in` form narrows `window`
  // itself, and the else branch then has no `window` left to listen on.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => fit()).observe(column);
  } else {
    window.addEventListener("resize", fit);
  }
  // Web fonts land after this runs and change every one of these widths.
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      lastWidth = -1;
      fit();
    });
  }
}

/* -------------------------------------------------------- hero standfirst */

/**
 * The hero's standfirst, dropped rather than wrapped.
 *
 * "New England Patriots fantasy football hub" is the club's own name and four
 * words, so where it stops fitting on one line is a different width for all 32
 * — measured: it takes a second line at 470px for Washington and at 360px for
 * Buffalo. That 110px spread is why this is measured and not a media query,
 * the same argument the chips ladder above makes at greater length.
 *
 * And the second line is what mak asked to stop seeing, which is the right
 * call on the content as well as the layout: the line repeats what the <h1>
 * directly above it and the eyebrow above that have already said between them
 * — the club, and that this is its hub — so the two rows it takes on a phone
 * are two rows of repetition in the one part of the page with no rows to
 * spare. Dropped, the hero loses nothing a reader did not already have.
 *
 * It is never dropped from the DOCUMENT: the server prints it at every width
 * and this only sets an attribute, so the line is in the HTML a crawler reads
 * whatever the viewport was.
 *
 * Three things worth knowing about the measurement:
 *
 *   - A Range over the contents, not the element. `getClientRects()` on a
 *     block <p> returns ONE rect for the block however many lines are in it;
 *     the range returns one per line box, which is the actual question.
 *   - Decided from the undropped state, like every rung of the chips ladder:
 *     the attribute comes off, the line is measured, and it goes back on only
 *     if it wrapped. Measuring while hidden would answer nothing at all.
 *   - Watched on the hero, not on the column the line sits in. A hidden
 *     standfirst can change the name block's own width — it is a flex item
 *     sized by its content above 720px — and an observer on a box this
 *     function can resize is an observer that feeds itself. The hero's width
 *     is the page's to decide.
 */
function wireHeroLead(root: HTMLElement): void {
  const lead = root.querySelector<HTMLElement>(".sct-hero [data-sct-lead]");
  const hero = root.querySelector<HTMLElement>(".sct-hero-inner");
  if (!lead || !hero) return;

  const wrapped = (): boolean => {
    // One rect per line box, which is the direct answer. Wrapped in a check
    // rather than called outright: `Range.getClientRects` is standard in
    // browsers and absent in jsdom, which this file is exercised in, and an
    // uncaught TypeError in the hero would take the tabs and the switcher
    // down with it.
    const range = document.createRange();
    range.selectNodeContents(lead);
    if (typeof range.getClientRects === "function") {
      const rects = range.getClientRects();
      if (rects.length > 0) return rects.length > 1;
    }
    // The same question asked of the box: a paragraph half again as tall as
    // one of its lines is a paragraph on two of them. Second rather than
    // first because `line-height` can compute to "normal", which is not a
    // number and not resolvable from here.
    const height = lead.getBoundingClientRect().height;
    const line = Number.parseFloat(getComputedStyle(lead).lineHeight);
    // No layout to read — no rects, no height, an engine with neither — is
    // not a wrap. The line stays, which is the state the server shipped.
    if (!height || !Number.isFinite(line) || line <= 0) return false;
    return height > line * 1.5;
  };

  let lastWidth = -1;
  const fit = (): void => {
    const width = Math.round(hero.getBoundingClientRect().width);
    // Height changes are this function's own doing. Only a width change can
    // change its answer.
    if (width === lastWidth) return;
    lastWidth = width;

    // Undropped first, then measured, then dropped only if it wrapped
    // without the attribute on it.
    lead.setAttribute("data-sct-lead", "");
    if (wrapped()) lead.setAttribute("data-sct-lead", "off");
  };

  fit();
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => fit()).observe(hero);
  } else {
    window.addEventListener("resize", fit);
  }
  // Web fonts land after this runs and change the width of every word in it.
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      lastWidth = -1;
      fit();
    });
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
    wireFacts(root);
    wireHeroLead(root);
    wireTimestamps(root);
    wireSortableTables(root);
    // After the sort buttons exist, so the relabelled header is the button.
    wireScoring(root);
    wireFantasyFormat(root);
    wireHighlights(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
