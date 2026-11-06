/**
 * Team hub enhancement bundle.
 *
 * The page is complete before this file runs - every headline, player, fixture
 * and link is in the HTML the server sent, and the team switcher, the "view
 * more" disclosures and the section tabs all work with JavaScript disabled.
 * Nothing here fetches anything and nothing here renders anything.
 *
 * It adds five things:
 *   1. tab behavior for the section bar - switching in place instead of
 *      navigating to an anchor, plus the ARIA roles and arrow keys that CSS
 *      `:target` cannot supply on its own;
 *   2. outside-click and Escape closing for the team switcher;
 *   3. relative timestamps ("3 hours ago") on stamps the server rendered as
 *      absolute - the server cannot know "now" without breaking its own render
 *      cache, so the absolute form is what ships and this upgrades it;
 *   4. sortable column headers on the matchup page's stat tables;
   5. height reporting to a parent frame, for the legacy iframe mount.
 */

const ROOT_SELECTOR = "[data-sct-root]";

/* -------------------------------------------------------------- tabs ---- */

/**
 * Prefetch a link's page the first time the reader shows intent - a hover, a
 * focus, or the start of a touch - so the navigation it leads to lands fast.
 *
 * `<link rel="prefetch">` rather than a fetch(): it is a hint the browser
 * schedules at idle priority and keeps in its HTTP cache, which is exactly
 * what the following full-page load reads from. Same-origin only - on
 * statchasers.com the section links are same-origin; on the bare tool they
 * are too. Once per link, whichever event fires first.
 */
function prefetchOnIntent(link: HTMLAnchorElement): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    let url: URL;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    if (url.pathname + url.search === location.pathname + location.search) return;
    if (document.querySelector(`link[rel="prefetch"][href="${url.pathname + url.search}"]`)) return;
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url.pathname + url.search;
    document.head.appendChild(hint);
  };
  link.addEventListener("mouseenter", go, { once: true, passive: true });
  link.addEventListener("focus", go, { once: true, passive: true });
  link.addEventListener("touchstart", go, { once: true, passive: true });
}

/**
 * Turn the section bar into a tab strip.
 *
 * The panels are already one-at-a-time before this runs - CSS `:target` does
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
  // A link with no panel in this document is a tab to another address: on the
  // hub, the sections that own a URL of their own (Usage, Stats, News, Depth
  // Chart) are printed only there - see ownsAddress() in team-render.ts. The
  // link stays exactly what the server sent, a link, and loads the page it
  // names. What this adds is a prefetch of that page the moment the reader
  // shows intent, so the load it leads to is a warm one.
  for (const link of links) {
    if (!tabs.some((tab) => tab.link === link)) prefetchOnIntent(link);
  }

  // Below two there is nothing to switch between, and taking over would only
  // mean hiding the one panel there is.
  //
  // This is also what makes a SECTION page behave correctly without a second
  // code path. It carries the same strip but only its own panel, so exactly one
  // link resolves here, the takeover is declined, and every tab stays an
  // ordinary link that loads the page it names.
  if (tabs.length < 2) return;

  // The roles only when every link in the strip is a tab. `role="tablist"`
  // promises that its children are tabs that switch panels in this document,
  // and the hub's strip also holds links that load another page - a tablist
  // with ordinary links in it tells a screen reader the wrong thing about
  // half of them. On a mixed strip the panel-backed links switch in place
  // just the same, and the current one says so with aria-current instead.
  const mixed = tabs.length < links.length;
  if (!mixed) list?.setAttribute("role", "tablist");
  for (const { id, link, panel } of tabs) {
    if (!mixed) {
      link.setAttribute("role", "tab");
      link.setAttribute("aria-controls", id);
      panel.setAttribute("role", "tabpanel");
      const item = link.closest("li");
      if (item) item.setAttribute("role", "presentation");
    }
    // Focusable so the reader who just chose a tab lands on its content, and so
    // a panel that scrolls can be scrolled from the keyboard.
    panel.setAttribute("tabindex", "0");
  }

  function select(id: string, focusPanel: boolean): void {
    for (const tab of tabs) {
      const on = tab.id === id;
      tab.panel.classList.toggle("is-active", on);
      tab.link.classList.toggle("is-active", on);
      if (mixed) {
        if (on) tab.link.setAttribute("aria-current", "true");
        else tab.link.removeAttribute("aria-current");
      } else {
        tab.link.setAttribute("aria-selected", on ? "true" : "false");
        // Roving tabindex: one stop for the whole strip, arrows move within it.
        tab.link.tabIndex = on ? 0 : -1;
      }
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
   * title names the address the click just pushed - it does not touch the hero,
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
   * The panel switched in place, so nothing loaded - but the reader is now
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
      // The hash counts: the Usage tab's address is the hub plus `#usage`, so
      // leaving it for the Outlook is the same path with the hash dropped.
      const current = location.pathname + location.search + location.hash;
      if (url === current) return;
      if (mode === "push") history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    } catch {
      // Some embeddings disallow history writes (a sandboxed frame). The tab
      // still switches; only the address bar stays behind.
    }
  }

  /** Where a tab lives: its path, plus the hash for a hub-only panel. */
  function tabUrl(link: HTMLAnchorElement): string {
    const url = new URL(link.href, location.origin);
    return url.pathname + url.hash;
  }

  /** The tab whose address this path is, or null for the page we landed on. */
  function fromPath(path: string): string | null {
    for (const tab of tabs) {
      const href = tab.link.getAttribute("href");
      if (!href) continue;
      // A hub panel with no address of its own (`#usage`) is found by its hash.
      if (href.includes("#")) continue;
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
  // - which on a deep link (#depth-chart) would flash the Outlook panel.
  let active = fromHash();
  select(active, false);
  root.dataset["sctTabs"] = "js";

  // One listener on the root, in the CAPTURE phase, rather than one per link.
  // The host theme (Divi) binds its own click handler to every same-page
  // anchor - `a[href*="#"]` whose path is the page's - and animates the
  // window to the element the hash names. The hub-only tabs (#draft,
  // #contracts) are exactly that, so with a handler on
  // the link itself the panel switched AND the page scrolled to it (mak,
  // 2026-11-05: "it aligns my screen to the page"). A capture listener on an
  // ancestor runs before any listener on the link, whatever order they were
  // bound in, and stopping propagation there means the click never reaches
  // the theme's handler. The tab switches in place and the window stays
  // where the reader left it.
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const link = target?.closest<HTMLAnchorElement>("a.sct-nav-link") ?? null;
      const tab = link ? tabs.find((t) => t.link === link) : undefined;
      if (!link || !tab) return;
      // Let the browser handle anything that is not a plain left click - a
      // middle click or ctrl-click on these links opens the hub at that tab,
      // which is a genuinely useful thing to be able to do.
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      active = tab.id;
      select(tab.id, true);
      setHeading(
        link.dataset["sctHeading"] ?? "",
        link.dataset["sctLead"] ?? "",
        link.dataset["scTitle"] ?? "",
      );
      writeUrl(tabUrl(link), "push");
    },
    true,
  );

  // A hash arriving from outside - an in-page link, an edit to the address bar,
  // or the back button after some other navigation wrote one.
  window.addEventListener("hashchange", () => {
    const id = fromHash();
    if (id === active) return;
    active = id;
    select(id, false);
  });

  // Arrow keys move between tabs, which is what role="tab" above promised -
  // and only where it was promised: a mixed strip is a list of links, and
  // links do not move focus on arrow keys.
  list?.addEventListener("keydown", (event: KeyboardEvent) => {
    if (mixed) return;
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
    writeUrl(tabUrl(tab.link), "replace");
  });

  /**
   * Back and forward through the tabs.
   *
   * Without this the address bar would walk back through the sections while the
   * page kept showing the last one clicked - the failure that makes people
   * distrust a URL that changed without a load. A path that belongs to no tab
   * is the address the reader landed on, which restores the first panel and the
   * heading captured at load.
   */
  window.addEventListener("popstate", () => {
    const path = location.pathname;
    const hashed = location.hash.replace(/^#/, "");
    const id = tabs.some((tab) => tab.id === hashed) ? hashed : fromPath(path);

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

/* ------------------------------------------------------ matchup tabs ---- */

/**
 * A completed game's tabs: Recap, Fantasy, Game flow, Head-to-head, Betting.
 *
 * The standard tablist: buttons with aria-selected, arrow keys, Home and End,
 * Enter and Space. Each tab has a hash (#recap, #fantasy, #game-flow,
 * #head-to-head, #betting), written with replaceState so switching adds no
 * history. A hash that names something INSIDE a panel (#verdicts, #wp) opens
 * that panel and scrolls to it. With scripting off nothing here runs: the bar
 * stays hidden and every panel shows, stacked in order.
 */
function wireMatchupTabs(root: HTMLElement): void {
  const found = root.querySelector<HTMLElement>("[data-mu-tabbar]");
  if (!found) return;
  const bar: HTMLElement = found;
  const tabs = Array.from(bar.querySelectorAll<HTMLButtonElement>("[data-mu-tab-link]"));
  const ids = tabs.map((tab) => tab.dataset["muTabLink"]!);
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-mu-tab]"));
  const list = bar.querySelector<HTMLElement>(".sct-mu-tabs-list");
  if (tabs.length === 0) return;

  let active = "recap";
  function select(id: string): void {
    active = id;
    // For the CSS: the sidebar shows on Recap and Fantasy only.
    root.dataset["muActive"] = id;
    for (const panel of panels) {
      const on = panel.dataset["muTab"] === id;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    }
    for (const tab of tabs) {
      const on = tab.dataset["muTabLink"] === id;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    reveal();
    score();
  }

  /** Keep the chosen tab in view where the list scrolls (phones). */
  function reveal(): void {
    const tab = tabs.find((t) => t.dataset["muTabLink"] === active);
    if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
    const box = list.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < box.left) list.scrollLeft -= box.left - r.left;
    else if (r.right > box.right) list.scrollLeft += r.right - box.right;
  }
  void document.fonts?.ready.then(reveal);

  const barHeight = (): number => bar.getBoundingClientRect().height;

  const stickyTop = (): number => Number.parseFloat(getComputedStyle(bar).top) || 0;

  // The scoreboard, above the bar and the panels, shown on every tab.
  const hero = root.querySelector<HTMLElement>(".sct-sbh");

  /**
   * After a switch: bring the scoreboard (or, without one, the panel's top)
   * just under the bar, only if the panel's top is off screen.
   */
  function toPanelTop(id: string): void {
    const panel = panels.find((p) => p.dataset["muTab"] === id);
    if (!panel) return;
    const panelTop = panel.getBoundingClientRect().top;
    const offset = stickyTop() + barHeight();
    if (panelTop >= offset && panelTop <= window.innerHeight) return;
    // The scoreboard sits above the bar, so it goes to the bar's sticky top.
    const top = hero ? hero.getBoundingClientRect().top - stickyTop() : panelTop - offset;
    window.scrollTo({ top: Math.max(0, window.scrollY + top - 16) });
  }

  /** The tab a hash belongs to, and the element to scroll to inside it. */
  function resolve(hash: string): { tab: string; target: HTMLElement | null } | null {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) return null;
    if (ids.includes(id)) return { tab: id, target: null };
    const el = document.getElementById(id);
    const panel = el?.closest<HTMLElement>("[data-mu-tab]");
    if (!el || !root.contains(el)) return null;
    // A section below the panels (FAQ, Keep exploring) is on every tab.
    return { tab: panel ? panel.dataset["muTab"]! : active, target: el };
  }

  function writeHash(id: string): void {
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
    } catch {
      // A sandboxed frame may refuse history writes; the tab still switches.
    }
  }

  function track(id: string): void {
    const label = tabs.find((t) => t.dataset["muTabLink"] === id)?.textContent ?? id;
    const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
    try {
      if (typeof w.gtag === "function") w.gtag("event", "recap_tab_view", { tab_name: label });
      else if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: "recap_tab_view", tab_name: label });
      root.dispatchEvent(new CustomEvent("recap_tab_view", { bubbles: true, detail: { tab: label } }));
    } catch {
      // Analytics must never break the tabs.
    }
  }

  function activate(id: string, focus = false): void {
    if (id === active) return;
    select(id);
    writeHash(id);
    toPanelTop(id);
    track(id);
    if (focus) tabs.find((t) => t.dataset["muTabLink"] === id)?.focus();
  }

  // The score line: shown while the scoreboard, which is on every tab, is
  // off screen.
  const scoreLine = bar.querySelector<HTMLElement>("[data-mu-score]");
  let heroVisible = true;
  function score(): void {
    scoreLine?.classList.toggle("is-shown", !heroVisible);
  }
  if (hero && scoreLine && typeof IntersectionObserver === "function") {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) heroVisible = e.isIntersecting;
        score();
      },
      { rootMargin: `-${Math.round(barHeight())}px 0px 0px 0px` },
    ).observe(hero);
  } else {
    heroVisible = false;
  }

  // A shadow under the bar once the page has scrolled.
  const shade = (): void => {
    bar.classList.toggle("is-scrolled", window.scrollY > 0);
  };
  window.addEventListener("scroll", shade, { passive: true });
  shade();

  // Settle before the CSS hides anything, so a deep link never flashes Recap.
  const landed = resolve(location.hash);
  select(landed?.tab ?? "recap");
  root.dataset["muTabs"] = "js";
  if (landed?.target) landed.target.scrollIntoView();
  else if (landed && landed.tab !== "recap") {
    // A tab's hash is also an anchor at its panel's top, and the browser's own
    // jump to it would scroll the scoreboard away: start at the scoreboard
    // instead, now and again once the page has loaded and jumped.
    const tab = landed.tab;
    const settle = (): void => {
      if (hero) window.scrollTo({ top: Math.max(0, window.scrollY + hero.getBoundingClientRect().top - stickyTop() - 16) });
      else toPanelTop(tab);
    };
    settle();
    if (document.readyState !== "complete") window.addEventListener("load", settle, { once: true });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset["muTabLink"]!));
  }

  list?.addEventListener("keydown", (event: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t === document.activeElement);
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
    activate(ids[next]!, true);
  });

  // In-page links to a tab or to a section inside one (#verdicts, #fantasy).
  root.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const hit = resolve(link.getAttribute("href") ?? "");
    if (!hit) return;
    event.preventDefault();
    if (hit.tab !== active) {
      select(hit.tab);
      track(hit.tab);
    }
    writeHash(hit.target ? decodeURIComponent(link.hash.slice(1)) : hit.tab);
    if (hit.target) hit.target.scrollIntoView();
    else toPanelTop(hit.tab);
  });
  window.addEventListener("hashchange", () => {
    const hit = resolve(location.hash);
    if (!hit) return;
    if (hit.tab !== active) select(hit.tab);
    if (hit.target) hit.target.scrollIntoView();
  });
}

/**
 * The tab bar's height, as --mu-bar-h, so anchors land below the sticky bar.
 * The sidebar itself scrolls with the page.
 */
function wireBarHeight(root: HTMLElement): void {
  const bar = root.querySelector<HTMLElement>("[data-mu-tabbar]");
  if (!bar) return;
  const fit = (): void => {
    root.style.setProperty("--mu-bar-h", `${Math.round(bar.getBoundingClientRect().height)}px`);
  };
  fit();
  window.addEventListener("resize", fit);
  void document.fonts?.ready.then(fit);
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
    // Focus goes back to the control that opened the panel - otherwise Escape
    // strands keyboard focus inside a panel that is no longer visible.
    if (summary instanceof HTMLElement) summary.focus();
  });
}

/* ---------------------------------------------------------- timestamps ---- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * @param compact Abbreviated units - "43m ago" rather than "43 min ago".
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
      // The absolute form moves into the tooltip rather than being discarded -
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
 * An EMPTY `data-sort` is a missing value, not a zero - a player with no passer
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
 * Same behavior as the game log on the player pages and the FPA table: the
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
 * ascending by a column where half the rows read "-" would otherwise open with
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
      // An action column (Start/Sit) has nothing to sort on.
      if (header.hasAttribute("data-no-sort")) return;
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

      // Numbers open descending - the top of a stat column is what a reader
      // clicking it is after. Names open ascending, which is A to Z.
      let descending = type === "number";
      if (sorted === "descending") descending = false;

      button.addEventListener("click", () => {
        const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
        // The server's order, to fall back on for rows with nothing to compare
        // and to break ties with - otherwise a column of equal values
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

/**
 * Player Stats' long table: the rows past the top scorers wait behind "Show
 * all players". The button is in the HTML but hidden, and the rows only hide
 * once this has run, so without the bundle every row shows and no dead
 * button does. Sorting the table opens it, since a sort can lift a hidden row.
 */
function wirePlayerStatsMore(root: HTMLElement): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-ps-more]"))) {
    const block = button.closest<HTMLElement>(".sct-mu-ps-block");
    if (!block) continue;
    const set = (open: boolean): void => {
      block.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      button.textContent = (open ? button.dataset["less"] : button.dataset["more"]) ?? "";
    };
    block.dataset["ps"] = "js";
    button.hidden = false;
    button.addEventListener("click", () => set(!block.classList.contains("is-open")));
    block.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest?.("thead .sct-sort")) set(true);
    });
  }
}

/**
 * Fantasy Points vs Expected: the detail columns (routes, attempts, carries,
 * targets and their shares) wait behind "Show detailed usage". They are in the
 * HTML either way; they only hide once this has run.
 */
function wireUsageDetail(root: HTMLElement): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-fp-detail]"))) {
    const block = button.closest<HTMLElement>(".sct-fp-usage");
    if (!block) continue;
    block.dataset["fu"] = "js";
    button.hidden = false;
    button.addEventListener("click", () => {
      const open = !block.classList.contains("is-open");
      block.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      button.textContent = (open ? button.dataset["less"] : button.dataset["more"]) ?? "";
    });
  }
}

/**
 * The Usage report's + / − profile toggles.
 *
 * Every profile row is in the HTML with `hidden`, and team.css shows them all
 * until this has run (`data-sct-usage="js"`), so with scripting off the table
 * reads fully expanded and the buttons are hidden. A button owns the row its
 * aria-controls names.
 */
function wireUsageProfiles(root: HTMLElement): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".sct-us-toggle"));
  if (buttons.length === 0) return;
  for (const button of buttons) {
    const id = button.getAttribute("aria-controls");
    const row = id ? document.getElementById(id) : null;
    if (!row) continue;
    const glyph = button.querySelector("span");
    const label = button.getAttribute("aria-label") ?? "";
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      row.hidden = !open;
      if (glyph) glyph.textContent = open ? "\u2212" : "+";
      button.setAttribute("aria-label", open ? label.replace(/^Show/, "Hide") : label.replace(/^Hide/, "Show"));
    });
  }
  root.dataset["sctUsage"] = "js";
}

/**
 * The Snap Counts & Playing Time table's Season / Last 3 / Week switch and
 * position filter (team/usage-render.ts, 2026-11-05).
 *
 * Every view is already on each row as `data-v-<key>="snaps|share|change"`
 * (season, last3, w1…wN), so switching rewrites three cells, hides the rows
 * with no snaps in that window, and re-sorts by share. Nothing is fetched.
 * The controls ship `hidden` and only show once this has run, so with
 * scripting off the season view is simply the table.
 */
function wireSnapTables(root: HTMLElement): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>("[data-sct-snaps]"))) {
    const controls = block.querySelector<HTMLElement>(".sct-us-snap-controls");
    const body = block.querySelector<HTMLTableSectionElement>("tbody");
    if (!controls || !body) continue;
    const buttons = Array.from(controls.querySelectorAll<HTMLButtonElement>("[data-snap-view]"));
    const week = controls.querySelector<HTMLSelectElement>("[data-snap-week]");
    const pos = controls.querySelector<HTMLSelectElement>("[data-snap-pos]");
    const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
    const weekWrap = week?.closest<HTMLElement>(".sct-us-switch-select") ?? null;
    let view = "season";

    const parse = (row: HTMLTableRowElement, key: string): [number, number | null, number | null] | null => {
      const raw = row.getAttribute(`data-v-${key}`);
      if (raw == null) return null;
      const [snaps, share, change] = raw.split("|");
      return [Number(snaps ?? 0), share ? Number(share) : null, change ? Number(change) : null];
    };

    const render = (): void => {
      const wanted = pos?.value ?? "";
      const ranked = rows
        .map((row) => ({ row, v: parse(row, view) }))
        .sort((a, b) => (b.v?.[1] ?? -1) - (a.v?.[1] ?? -1) || (b.v?.[0] ?? 0) - (a.v?.[0] ?? 0));
      for (const { row, v } of ranked) {
        const shown = !!v && v[0] > 0 && (!wanted || row.dataset["pos"] === wanted);
        row.hidden = !shown;
        if (!v) continue;
        const n = row.querySelector<HTMLElement>(".sct-us-snap-n");
        const fill = row.querySelector<HTMLElement>(".sct-us-gbar > span");
        const val = row.querySelector<HTMLElement>(".sct-us-share-val");
        const chg = row.querySelector<HTMLElement>(".sct-us-snap-chg");
        if (n) n.textContent = String(v[0]);
        const share = v[1] ?? 0;
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, share))}%`;
        if (val) val.textContent = `${share}%`;
        if (chg) {
          const c = v[2];
          chg.innerHTML = "";
          const span = document.createElement("span");
          span.className = `sct-us-delta is-${c == null ? "none" : c === 0 ? "flat" : c > 0 ? "up" : "down"}`;
          span.textContent = c == null ? "\u2013" : c === 0 ? "0%" : `${c > 0 ? "+" : "\u2212"}${Math.abs(c)}%`;
          chg.appendChild(span);
        }
        body.appendChild(row);
      }
      for (const b of buttons) {
        const on = b.dataset["snapView"] === view;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      }
      if (weekWrap) weekWrap.classList.toggle("is-on", view.startsWith("w"));
    };

    for (const b of buttons) {
      b.addEventListener("click", () => {
        view = b.dataset["snapView"] ?? "season";
        if (week) week.value = "";
        render();
      });
    }
    week?.addEventListener("change", () => {
      if (week.value) view = week.value;
      else view = "season";
      render();
    });
    pos?.addEventListener("change", render);
    controls.hidden = false;
    block.dataset["sctSnaps"] = "js";
  }
}

/**
 * The Depth Chart tab's Fantasy / Offense / Defense / Special Teams switch.
 *
 * All four views are in the HTML, and team.css shows them stacked under their
 * own headings until this has run (`data-sct-dc="js"`), with the buttons
 * hidden - so with scripting off nothing is out of reach. Here the panels
 * other than the pressed one are hidden and the headings drop to the screen
 * reader, since the pressed button already names the view.
 */
/* ------------------------------------------------------- cut scenario ---- */

/**
 * The Contracts tab's cut scenario (team/contracts-render.ts). Every row
 * carries the cap freed and the dead money left by a release before and
 * after June 1; ticking rows sums them against the club's cap space and dead
 * money, which the block carries as data attributes. Nothing is fetched.
 * Without scripting the pick column and the bar stay hidden (team.css keys
 * off data-sct-ct="js").
 */
function wireCutScenario(root: HTMLElement): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>("[data-sct-ct]"))) {
    // Marked first, whatever else the block has: team.css hides the tail of
    // the table and the inert controls off this flag.
    block.dataset["sctCt"] = "js";

    // On a phone the sheet shows Player, Cap hit, Worth and Cut saves per
    // row and keeps the rest behind a tap on the row (team.css lays the row
    // out as a card below 700px). A tap on the name, the pick box or a
    // button is left to them.
    // (Guarded: jsdom has no matchMedia, and a test must still run the rest.)
    const narrow = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 700px)") : null;
    for (const tr of Array.from(block.querySelectorAll<HTMLElement>("[data-sct-ct-row]"))) {
      tr.addEventListener("click", (event) => {
        if (!narrow?.matches) return;
        if ((event.target as HTMLElement | null)?.closest("a, input, button")) return;
        tr.classList.toggle("is-open");
      });
    }

    wireContractSort(block);

    const bar = block.querySelector<HTMLElement>("[data-sct-ct-scen]");
    const picks = Array.from(block.querySelectorAll<HTMLInputElement>("[data-sct-ct-pick]"));
    if (!bar || picks.length === 0) continue;
    const baseSpace = Number(block.dataset["capSpace"] ?? "0");
    const baseDead = Number(block.dataset["deadTotal"] ?? "0");
    const timings = Array.from(bar.querySelectorAll<HTMLButtonElement>("[data-sct-ct-timing]"));
    const reset = bar.querySelector<HTMLButtonElement>("[data-sct-ct-reset]");
    const out = (key: string): HTMLElement | null =>
      block.querySelector<HTMLElement>(`[data-sct-ct-out="${key}"]`);
    const money = (m: number): string => {
      if (!Number.isFinite(m) || Math.abs(m) < 0.0005) return "$0";
      const sign = m < 0 ? "-" : "";
      const abs = Math.abs(m);
      return abs >= 1 ? `${sign}$${abs.toFixed(1)}M` : `${sign}$${Math.round(abs * 1000)}K`;
    };
    let timing: "pre" | "post" = "pre";
    // The sheet's per-row release figures that follow the timing (the
    // premium comparison's Net if cut and Dead cells print both and show
    // one off the block's data-timing; their sort keys follow here).
    const timed = Array.from(block.querySelectorAll<HTMLElement>("[data-sct-ct-col]"));
    const applyTiming = (): void => {
      block.dataset["timing"] = timing;
      for (const cell of timed) {
        const row = cell.closest<HTMLElement>("[data-sct-ct-row]");
        const col = cell.dataset["sctCtCol"] === "dead" ? "Dead" : "Save";
        cell.dataset["sort"] = row?.dataset[`${timing}${col}`] ?? "";
      }
      for (const label of Array.from(block.querySelectorAll<HTMLElement>("[data-sct-ct-timing-word]"))) {
        label.textContent = timing === "post" ? "after June 1" : "before June 1";
      }
    };
    const pickFor = (id: string | undefined): HTMLInputElement | null =>
      id ? block.querySelector<HTMLInputElement>(`[data-sct-ct-row][data-sct-ct-id="${id}"] [data-sct-ct-pick]`) : null;
    // The release panel's cards are a second handle on the row's pick box.
    const cards = Array.from(block.querySelectorAll<HTMLElement>("[data-sct-ct-cut]"));

    const update = (): void => {
      let count = 0;
      let freed = 0;
      let added = 0;
      let altFreed = 0;
      let altAdded = 0;
      const other = timing === "pre" ? "post" : "pre";
      for (const pick of picks) {
        const row = pick.closest<HTMLElement>("[data-sct-ct-row]");
        row?.classList.toggle("is-picked", pick.checked);
        if (!pick.checked || !row) continue;
        count += 1;
        freed += Number(row.dataset[`${timing}Save`] ?? "0");
        added += Number(row.dataset[`${timing}Dead`] ?? "0");
        altFreed += Number(row.dataset[`${other}Save`] ?? "0");
        altAdded += Number(row.dataset[`${other}Dead`] ?? "0");
      }
      for (const card of cards) {
        const on = pickFor(card.dataset["sctCtCut"])?.checked === true;
        card.classList.toggle("is-picked", on);
        card.querySelector("[data-sct-ct-cut-tick]")?.setAttribute("aria-pressed", String(on));
      }
      // What the other timing would do with the same picks: the reason the
      // toggle exists, shown beside it once there is something to compare.
      const altOut = out("alt");
      if (altOut) {
        altOut.hidden = count === 0;
        altOut.textContent =
          count === 0
            ? ""
            : `${other === "post" ? "After" : "Before"} June 1 the same cuts would free ${money(altFreed)} and leave ${money(altAdded)} dead.`;
      }
      const countOut = out("count");
      if (countOut) countOut.textContent = String(count);
      const freedOut = out("freed");
      if (freedOut) {
        freedOut.textContent = money(freed);
        freedOut.classList.toggle("is-cost", freed < 0);
      }
      const addedOut = out("added");
      if (addedOut) addedOut.textContent = money(added);
      const after = baseSpace + freed;
      const afterOut = out("after");
      if (afterOut) {
        afterOut.textContent = money(after);
        afterOut.classList.toggle("is-cost", after < 0);
      }
      // The strip's cap-space and dead-money tiles follow the scenario too,
      // so the top of the tab reads as the club after the cuts.
      const spaceTile = out("space");
      if (spaceTile) spaceTile.textContent = money(after);
      const deadTile = out("dead");
      if (deadTile) deadTile.textContent = money(baseDead + added);
      bar.classList.toggle("is-active", count > 0);
      if (reset) reset.hidden = count === 0;
    };

    for (const pick of picks) pick.addEventListener("change", update);
    for (const button of timings) {
      button.addEventListener("click", () => {
        timing = button.dataset["sctCtTiming"] === "post" ? "post" : "pre";
        for (const b of timings) b.setAttribute("aria-pressed", String(b === button));
        applyTiming();
        update();
      });
    }
    reset?.addEventListener("click", () => {
      for (const pick of picks) pick.checked = false;
      update();
    });
    const toggle = (id: string | undefined, force?: boolean): void => {
      const pick = pickFor(id);
      if (!pick) return;
      pick.checked = force ?? !pick.checked;
      update();
    };
    // A tap on a card ticks its row; the name link keeps its own job.
    for (const card of cards) {
      card.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("a")) return;
        toggle(card.dataset["sctCtCut"]);
      });
    }
    // The empty bar's "Try <name>" ticks the release that frees the most.
    block.querySelector<HTMLButtonElement>("[data-sct-ct-try]")?.addEventListener("click", (event) => {
      toggle((event.currentTarget as HTMLElement).dataset["sctCtTry"], true);
    });
    update();
  }
}

/**
 * The contracts sheet's sortable heads (mak, 2026-11-02). Every body cell
 * carries its column's value in data-sort; a head button sorts the rows by
 * it, a numeric column largest first and a text column A to Z, and a second
 * press flips the direction. Empty values (unpriced Worth, no APY) stay at
 * the bottom either way, and ties keep the sheet's order. The rows move in
 * the DOM, so the cut scenario, which reads each row's own attributes, is
 * unaffected.
 */
function wireContractSort(block: HTMLElement): void {
  const table = block.querySelector<HTMLTableElement>(".sct-ct-table, [data-sct-ct-table]");
  const tbody = table?.tBodies[0];
  if (!table || !tbody) return;
  const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
  for (const th of heads) {
    const button = th.querySelector<HTMLButtonElement>("[data-sct-ct-sort]");
    if (!button) continue;
    button.addEventListener("click", () => {
      const index = heads.indexOf(th);
      const numeric = button.dataset["sortType"] === "num";
      const was = th.getAttribute("aria-sort");
      const dir =
        was === "descending" ? "ascending" : was === "ascending" ? "descending" : numeric ? "descending" : "ascending";
      for (const h of heads) {
        h.removeAttribute("aria-sort");
        h.classList.remove("is-sorted");
      }
      th.setAttribute("aria-sort", dir);
      th.classList.add("is-sorted");
      const sign = dir === "descending" ? -1 : 1;
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-sct-ct-row]")).map((tr, i) => ({
        tr,
        i,
        v: tr.cells[index]?.dataset["sort"] ?? "",
      }));
      rows.sort((a, b) => {
        if (a.v === "" || b.v === "") return a.v === b.v ? a.i - b.i : a.v === "" ? 1 : -1;
        const cmp = numeric ? Number(a.v) - Number(b.v) : a.v.localeCompare(b.v);
        return cmp === 0 ? a.i - b.i : cmp * sign;
      });
      for (const { tr } of rows) tbody.appendChild(tr);
    });
  }
}

/**
 * The view switch on any `[data-sct-dc]` block: the Depth Chart tab's four
 * views. (The Draft tab borrowed it from 2026-10-23 to 2026-10-29; its two
 * panels now stack in one view.)
 */
function wireDepthViews(root: HTMLElement): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>("[data-sct-dc]"))) {
    const buttons = Array.from(block.querySelectorAll<HTMLButtonElement>("[data-sct-dc-view]"));
    const panels = Array.from(block.querySelectorAll<HTMLElement>("[data-sct-dc-panel]"));
    const notes = Array.from(block.querySelectorAll<HTMLElement>("[data-sct-dc-note]"));
    if (buttons.length === 0 || panels.length === 0) continue;
    const show = (key: string): void => {
      for (const button of buttons) {
        button.setAttribute("aria-pressed", String(button.dataset["sctDcView"] === key));
      }
      for (const panel of panels) panel.hidden = panel.dataset["sctDcPanel"] !== key;
      for (const note of notes) note.hidden = note.dataset["sctDcNote"] !== key;
    };
    for (const button of buttons) {
      button.addEventListener("click", () => show(button.dataset["sctDcView"] ?? ""));
    }
    show(buttons.find((b) => b.getAttribute("aria-pressed") === "true")?.dataset["sctDcView"] ?? "");
    block.dataset["sctDc"] = "js";
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
 * is a swap of text already on the page - nothing is fetched or recomputed.
 * The switch is built here, not sent in the HTML: without this bundle there is
 * nothing for it to switch, and the page reads as PPR.
 *
 * A table sorted by one of the swapped columns is re-sorted on the new values,
 * so the order still matches the numbers. The choice is remembered per viewer.
 */
function wireScoring(root: HTMLElement): void {
  const slots = Array.from(root.querySelectorAll<HTMLElement>("[data-sct-scoring-slot]"));
  if (slots.length === 0) return;

  // One switch per slot (the stat tables, the preview's starters block), all
  // showing the same choice.
  const groups = slots.map((slot) => {
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
    return group;
  });
  const check = (format: ScoringFormat): void => {
    for (const group of groups) {
      const input = group.querySelector<HTMLInputElement>(`input[value="${format}"]`);
      if (input) input.checked = true;
    }
  };

  const apply = (format: ScoringFormat): void => {
    // The preview page (mak, 2026-11-02): every region marked data-pv-fmt -
    // the defense cards and starters, Matchup Leverage, the Team Matchup's
    // points-allowed rows, the last meeting's scorers - carries each figure in
    // all three scorings. Text swaps from data-<fmt>, a rank tier from
    // data-tier-<fmt>, a bar width from data-w-<fmt>, a row's advantage from
    // data-adv-<fmt> and a leverage call from data-lev-<fmt>.
    for (const region of Array.from(root.querySelectorAll<HTMLElement>("[data-pv-fmt]"))) {
      for (const el of Array.from(region.querySelectorAll<HTMLElement>(`[data-${format}]`))) {
        el.textContent = el.getAttribute(`data-${format}`) ?? el.textContent;
      }
      for (const el of Array.from(region.querySelectorAll<HTMLElement>(`[data-tier-${format}]`))) {
        el.setAttribute("data-tier", el.getAttribute(`data-tier-${format}`) ?? "");
      }
      for (const el of Array.from(region.querySelectorAll<HTMLElement>(`[data-w-${format}]`))) {
        el.style.width = `${el.getAttribute(`data-w-${format}`) ?? "0"}%`;
      }
      for (const el of Array.from(region.querySelectorAll<HTMLElement>(`[data-adv-${format}]`))) {
        el.setAttribute("data-adv", el.getAttribute(`data-adv-${format}`) ?? "even");
      }
      for (const el of Array.from(region.querySelectorAll<HTMLElement>(`[data-lev-${format}]`))) {
        const lev = el.getAttribute(`data-lev-${format}`) ?? "neutral";
        if (el.classList.contains("sct-pv-lb-dot")) {
          el.className = `sct-pv-lb-dot is-${lev}`;
        } else {
          el.setAttribute("data-lev", lev);
        }
      }
      // A ranked list re-orders by its swapped figure (the last meeting's
      // scorers), so the order means the same thing in every scoring.
      for (const list of Array.from(region.querySelectorAll<HTMLElement>("[data-pv-sort]"))) {
        const selector = list.getAttribute("data-pv-sort") ?? "";
        const items = Array.from(list.children) as HTMLElement[];
        const value = (item: HTMLElement): number => parseFloat(item.querySelector(selector)?.textContent ?? "") || 0;
        items
          .map((item, index) => ({ item, index, value: value(item) }))
          .sort((a, b) => b.value - a.value || a.index - b.index)
          .forEach(({ item }) => list.appendChild(item));
      }
    }
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
    // The Fantasy tab's verdict cards carry their points the same way.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-fp-notes] [data-ppr][data-half][data-std]"))) {
      el.textContent = el.getAttribute(`data-${format}`) ?? el.textContent;
      if (el.classList.contains("sct-fp-diff")) {
        const text = el.textContent ?? "";
        el.classList.toggle("is-pos", text.startsWith("+"));
        el.classList.toggle("is-neg", text.startsWith("\u2212"));
      }
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

  for (const group of groups) {
    group.addEventListener("change", (event) => {
      const value = (event.target as HTMLInputElement).value as ScoringFormat;
      check(value);
      apply(value);
      try {
        window.localStorage.setItem(SCORING_KEY, value);
      } catch {
        // Private mode or blocked storage: the switch still works, it is just not remembered.
      }
    });
  }

  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(SCORING_KEY);
  } catch {
    saved = null;
  }
  if (saved === "half" || saved === "std") {
    check(saved);
    apply(saved);
  }
}

/* ------------------------------------------------ recap: format switch ---- */

/**
 * The recap's PPR / Half PPR / Standard switch.
 *
 * The radios are in the server's HTML (recap fantasy-section.ts), and so is
 * every value: each points figure carries data-ppr, data-half and data-std,
 * and this swaps the text in place - the widths are tabular, so nothing moves.
 * Then each fantasy table is re-sorted by its rows' data-sort-<format>, the
 * top-scorer marker moves to the new first row, and the +/- cells are
 * recolored by their new sign. The choice is shared with the matchup page's
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
 * The highlights box: a thumbnail over the link to YouTube. A thumbnail that
 * fails leaves the team-color ground. (Until 2026-11-02 a press swapped the
 * box for a youtube-nocookie player; the video now opens on YouTube.)
 */
function wireHighlights(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[data-hl-thumb]"))) {
    if (img.complete && img.naturalWidth === 0) img.remove();
    else img.addEventListener("error", () => img.remove(), { once: true });
  }
}

/* -------------------------------------------------------- iframe height ---- */

/**
 * Report content height to a parent frame.
 *
 * Mirrors the news tool's behavior (src/client/main.ts) so a page embedded the
 * legacy way resizes instead of scrolling inside its own box. Measures the
 * root's bottom edge in document coordinates rather than its height, because
 * anything rendered above it shifts content down without making it taller -
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

/* -------------------------------------------------------- hero standfirst */

/**
 * The hero's standfirst, dropped rather than wrapped.
 *
 * "New England Patriots fantasy football hub" is the club's own name and four
 * words, so where it stops fitting on one line is a different width for all 32
 * - measured: it takes a second line at 470px for Washington and at 360px for
 * Buffalo. That 110px spread is why this is measured and not a media query,
 * the same argument the chips ladder above makes at greater length.
 *
 * And the second line is what mak asked to stop seeing, which is the right
 * call on the content as well as the layout: the line repeats what the <h1>
 * directly above it and the eyebrow above that have already said between them
 * - the club, and that this is its hub - so the two rows it takes on a phone
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
 *     standfirst can change the name block's own width - it is a flex item
 *     sized by its content above 720px - and an observer on a box this
 *     function can resize is an observer that feeds itself. The hero's width
 *     is the page's to decide.
 */
function wireHeroLead(root: HTMLElement): void {
  const lead = root.querySelector<HTMLElement>(".sct-tpb [data-sct-lead]");
  const hero = root.querySelector<HTMLElement>(".sct-tpb-inner");
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
    // No layout to read - no rects, no height, an engine with neither - is
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

/**
 * Small in-card tabs (the matchup page's Team Comparison, 2026-11-06):
 * [data-sct-seg-tabs] holding role="tab" buttons that control role="tabpanel"
 * elements by id. Click, arrow keys, Home and End; no hash, no fetch, the
 * panels already in the page.
 */
function wireSegTabs(root: HTMLElement): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-sct-seg-tabs]"))) {
    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (tabs.length < 2) continue;
    const select = (tab: HTMLButtonElement, focus: boolean): void => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
        if (panel) panel.hidden = !on;
      }
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (event) => {
        const n = tabs.length;
        const next =
          event.key === "ArrowRight" ? tabs[(i + 1) % n] : event.key === "ArrowLeft" ? tabs[(i - 1 + n) % n] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[n - 1] : null;
        if (!next) return;
        event.preventDefault();
        select(next, true);
      });
    });
  }
}

/**
 * Row filters over a table (the matchup page's All Starter Outlooks,
 * 2026-11-06): [data-sct-row-filter] holds buttons with data-filter (the row
 * attribute, e.g. "team") and data-value ("all" or a value); the next
 * table[data-filterable] shows the rows matching every chosen value.
 */
function wireRowFilters(root: HTMLElement): void {
  for (const box of Array.from(root.querySelectorAll<HTMLElement>("[data-sct-row-filter]"))) {
    const table = box.parentElement?.querySelector<HTMLTableElement>("table[data-filterable]");
    if (!table) continue;
    const buttons = Array.from(box.querySelectorAll<HTMLButtonElement>("button[data-filter]"));
    const chosen: Record<string, string> = {};
    for (const b of buttons) if (b.getAttribute("aria-pressed") === "true") chosen[b.dataset["filter"]!] = b.dataset["value"]!;
    const apply = (): void => {
      for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
        row.hidden = Object.entries(chosen).some(([key, value]) => value !== "all" && row.dataset[key] !== value);
      }
    };
    for (const b of buttons) {
      b.addEventListener("click", () => {
        const key = b.dataset["filter"]!;
        chosen[key] = b.dataset["value"]!;
        for (const other of buttons) if (other.dataset["filter"] === key) other.setAttribute("aria-pressed", other === b ? "true" : "false");
        apply();
      });
    }
  }
}

function boot(): void {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR),
  );
  for (const root of roots) {
    wireTabs(root);
    wireMatchupTabs(root);
    wireSegTabs(root);
    wireRowFilters(root);
    wireSwitcher(root);
    wireHeroLead(root);
    wireTimestamps(root);
    wireSortableTables(root);
    // After the sort buttons exist, so the relabeled header is the button.
    wireScoring(root);
    wireFantasyFormat(root);
    wireHighlights(root);
    wirePlayerStatsMore(root);
    wireUsageDetail(root);
    wireUsageProfiles(root);
    wireSnapTables(root);
    wireDepthViews(root);
    wireCutScenario(root);
    wireBarHeight(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
