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
