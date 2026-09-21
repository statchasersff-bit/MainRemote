/**
 * The enhancement behaviours the tool pages share.
 *
 * Three of the four things client/team.ts does are not about team hubs at all:
 * turning a `:target` section bar into a real tab strip, upgrading absolute
 * timestamps to relative ones, and reporting height to a parent frame. The
 * player pages need the same three, so they live here parameterised by
 * selector rather than copied.
 *
 * Everything here obeys the same contract as the bundles that call it: the page
 * is COMPLETE before any of this runs. Nothing fetches, nothing renders, and
 * every behaviour below degrades to the markup the server already sent.
 *
 * client/team.ts still carries its own copies. It predates this module and is
 * shipped; folding it in is a worthwhile follow-up, not something to do in the
 * same change as adding a third tool.
 */

export interface TabOptions {
  /** e.g. "[data-scp-nav]" — the element holding the tab links. */
  navSelector: string;
  /** e.g. ".scp-nav-list" — the <ul> that becomes the tablist. */
  listSelector: string;
  /** e.g. ".scp-nav-link" — the links themselves. */
  linkSelector: string;
  /** dataset key set on the root once JS owns the tabs, e.g. "scpTabs". */
  datasetKey: string;
  /**
   * The dataset key naming the panel, e.g. "scpPanelId".
   *
   * Its presence is what tells this function the strip links to ADDRESSES
   * rather than to anchors, and switches on the address behaviour: the URL is
   * pushed instead of the hash cleared, and the page's heading is rewritten
   * from the link. Left unset — the rankings board, whose sections have no URLs
   * of their own — everything below behaves exactly as it did.
   */
  panelKey?: string;
  /** The dataset key holding the H1 text for a tab, e.g. "scpHeading". */
  headingKey?: string;
  /** The dataset key holding the standfirst for a tab, e.g. "scpLead". */
  leadKey?: string;
}

/**
 * Turn a section bar into a tab strip.
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
export function wireTabs(root: HTMLElement, options: TabOptions): void {
  const nav = root.querySelector<HTMLElement>(options.navSelector);
  if (!nav) return;

  const list = nav.querySelector<HTMLElement>(options.listSelector);
  const links = Array.from(
    nav.querySelectorAll<HTMLAnchorElement>(options.linkSelector),
  );
  if (links.length === 0) return;

  const tabs: Array<{ id: string; link: HTMLAnchorElement; panel: HTMLElement }> = [];
  for (const link of links) {
    // The href is the section's own address when `panelKey` is in play, so it
    // no longer names the panel; the dataset does. The hash is still read as a
    // fallback, which is both the rankings board's normal path and what keeps a
    // cached page from before the change working.
    const id =
      (options.panelKey ? link.dataset[options.panelKey] : undefined) ??
      link.getAttribute("href")?.replace(/^#/, "");
    if (!id) continue;
    const panel = document.getElementById(id);
    if (!panel) continue;
    tabs.push({ id, link, panel });
  }
  // Below two there is nothing to switch between, and taking over would only
  // mean hiding the one panel there is.
  //
  // It is also what makes a SECTION page behave correctly with no second code
  // path: it carries the same strip but only its own panel, so one link
  // resolves, the takeover is declined, and every tab stays an ordinary link
  // that loads the page it names.
  if (tabs.length < 2) return;

  list?.setAttribute("role", "tablist");
  for (const { id, link, panel } of tabs) {
    link.setAttribute("role", "tab");
    link.setAttribute("aria-controls", id);
    panel.setAttribute("role", "tabpanel");
    // Focusable so the reader who just chose a tab lands on its content, and so
    // a panel that scrolls can be scrolled from the keyboard.
    panel.setAttribute("tabindex", "0");
    link.closest("li")?.setAttribute("role", "presentation");
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
      tabs.find((tab) => tab.id === id)?.panel.focus({ preventScroll: true });
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
   * The HOST's, strictly: the plugin marks its own, and the fallback is the
   * document's first H1 FROM OUTSIDE this root. A tab click rewrites the title
   * of the page the fragment is mounted in, because that title names the
   * address the click just pushed — it does not touch the hero, which says the
   * player's or the team's name on every tab and is not a caption for whichever
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

  // What the page said on arrival, so Back can put it back.
  const landedUrl = location.pathname + location.search;
  const landedHeading = headingEl?.textContent ?? "";
  const landedLead = leadEl?.textContent ?? "";

  function setHeading(link: HTMLAnchorElement): void {
    const heading = options.headingKey ? link.dataset[options.headingKey] : "";
    const lead = options.leadKey ? link.dataset[options.leadKey] : "";
    if (headingEl && heading) headingEl.textContent = heading;
    if (leadEl && lead) leadEl.textContent = lead;
  }

  /**
   * Put the section's own address in the address bar.
   *
   * Nothing loaded, but the reader is looking at the Game Log and the URL
   * should say so. It is the address the link would have loaded and the server
   * renders that page standalone, so a reload, a share or a bookmark all land
   * on what is on screen.
   *
   * `push` for a click, so Back steps through the tabs the reader opened;
   * `replace` for the arrow keys, because holding Right through seven tabs
   * should not bury the page they arrived from under seven entries.
   */
  function writeUrl(link: HTMLAnchorElement, mode: "push" | "replace"): void {
    try {
      const url = new URL(link.href, location.origin);
      const next = url.pathname + url.search;
      if (next === location.pathname + location.search) return;
      if (mode === "push") history.pushState(null, "", next);
      else history.replaceState(null, "", next);
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
      if (new URL(href, location.origin).pathname === path) return tab.id;
    }
    return null;
  }

  /**
   * Take the hash OUT of the address bar.
   *
   * A link INTO the page still works: fromHash() honours an arriving hash and
   * every tab link keeps its href, so a middle-click or a copied link opens on
   * the right panel. What this prevents is clicking a tab rewriting the URL of
   * the page the reader is already on — and a reader who arrived at #injury and
   * then clicked Overview looking at the overview under a URL that says injury.
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
  // — which on a deep link would flash the first panel.
  let active = fromHash();
  select(active, false);
  root.dataset[options.datasetKey] = "js";

  for (const { id, link } of tabs) {
    link.addEventListener("click", (event) => {
      // Let the browser handle anything that is not a plain left click — a
      // middle click or ctrl-click opens the page at that tab, which is a
      // genuinely useful thing to be able to do.
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
      event.preventDefault();
      active = id;
      select(id, true);
      if (options.panelKey) {
        setHeading(link);
        writeUrl(link, "push");
      } else {
        clearHash();
      }
    });
  }

  /**
   * Back and forward through the tabs.
   *
   * Without it the address bar would walk back through the sections while the
   * page kept showing the last one clicked — the failure that makes people
   * distrust a URL that changed without a load. A path belonging to no tab is
   * the address the reader landed on, which restores the first panel and the
   * heading captured at load.
   */
  if (options.panelKey) {
    window.addEventListener("popstate", () => {
      // A root the page has replaced — see wireStateSwap in client/player.ts —
      // is still wired, and its heading element is the container page's, shared
      // with the root that took its place. Leave the live one to answer.
      if (!root.isConnected) return;
      const id = fromPath(location.pathname);

      if (id) {
        active = id;
        select(id, false);
        setHeading(tabs.find((tab) => tab.id === id)!.link);
        return;
      }

      if (location.pathname + location.search === landedUrl) {
        active = tabs[0]!.id;
        select(active, false);
        if (headingEl && landedHeading) headingEl.textContent = landedHeading;
        if (leadEl && landedLead) leadEl.textContent = landedLead;
      }
    });
  }

  // A hash arriving from outside — an in-page link, an edit to the address bar,
  // or the back button after some other navigation wrote one.
  window.addEventListener("hashchange", () => {
    if (!root.isConnected) return;
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
    if (options.panelKey) {
      setHeading(tab.link);
      writeUrl(tab.link, "replace");
    } else {
      clearHash();
    }
  });
}

/* ---------------------------------------------------------- timestamps ---- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relativeLabel(ms: number, now: number, compact: boolean): string | null {
  const delta = now - ms;
  if (delta < 0) return null;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE);
    return compact ? `${minutes}m ago` : `${minutes} min ago`;
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return compact ? `${hours}h ago` : `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (delta < 7 * DAY) {
    const days = Math.floor(delta / DAY);
    return compact ? `${days}d ago` : `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  // Older than a week: the absolute date the server already rendered is more
  // useful than "37 days ago", so leave it alone.
  return null;
}

/**
 * Upgrade the server's coarse stamps to live relative ones.
 *
 * The server cannot know "now" without breaking its own render cache, so it
 * ships a coarse form and this refines it from `data-ts`.
 */
export function wireTimestamps(root: HTMLElement): void {
  const stamps = Array.from(root.querySelectorAll<HTMLTimeElement>("time[data-ts]"));
  if (stamps.length === 0) return;

  const apply = (): void => {
    const now = Date.now();
    for (const stamp of stamps) {
      const ts = Number(stamp.getAttribute("data-ts"));
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const label = relativeLabel(ts, now, stamp.hasAttribute("data-ts-compact"));
      if (!label) continue;
      // The absolute form moves into the tooltip rather than being discarded.
      if (!stamp.title) stamp.title = stamp.textContent?.trim() ?? "";
      stamp.textContent = label;
    }
  };

  apply();
  window.setInterval(apply, 60_000);
}

/* -------------------------------------------------------- iframe height ---- */

/**
 * Report content height to a parent frame, for the legacy iframe mount.
 *
 * Measures the root's bottom edge in document coordinates rather than its
 * height, because anything rendered above it shifts content down without making
 * it taller — and a height-only measurement then under-reports by that offset.
 */
export function wireFrameHeight(root: HTMLElement): void {
  if (window.parent === window) return;

  let locked = false;
  const postHeight = (): void => {
    const height = Math.ceil(root.getBoundingClientRect().bottom + window.scrollY);
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
