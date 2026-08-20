/**
 * Browser bundle for the StatChasers news tool.
 *
 * This is an *enhancement* layer, not the renderer of record. The list arrives
 * fully rendered from the server (see lib/ssr.ts) with every item already in
 * the DOM; this script only:
 *
 *   - turns the complete list into a paged view (show/hide — never fetch),
 *   - upgrades absolute timestamps to relative "3 hours ago" labels,
 *   - swaps broken headshots for the initial badge,
 *   - refreshes in the background using the same shared renderer,
 *   - reports height to the parent when running inside the legacy iframe.
 *
 * It works against both mount styles: same-origin (the standalone app / iframe)
 * and cross-origin (the WordPress plugin, which passes data-sc-origin).
 */

import {
  renderList,
  renderPager,
  itemsSignature,
  formatAbsoluteDate,
  searchKey,
  TEAM_NAMES,
  DEFAULT_PAGE_SIZE,
  type NewsItem,
  type LinkTemplates,
} from "../lib/render";

const REFRESH_MS = 2 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/** A relative label for recent items; older ones keep the server's absolute text. */
function relativeLabel(ts: number): string | null {
  const diff = Date.now() - ts;
  if (diff < 0 || diff >= TWO_DAYS_MS) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

class NewsWidget {
  private readonly root: HTMLElement;
  private readonly origin: string;
  private readonly pageSize: number;
  private readonly limit: number;
  private readonly links: LinkTemplates;
  private currentPage = 0;
  private refreshTimer: number | null = null;
  /** Signature of the data currently rendered; guards needless re-renders. */
  private signature: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // Same-origin when the attribute is absent (standalone app / iframe).
    this.origin = (root.dataset["scOrigin"] ?? "").replace(/\/+$/, "");

    const declaredPageSize = Number(root.dataset["scPageSize"]);
    this.pageSize =
      Number.isFinite(declaredPageSize) && declaredPageSize > 0
        ? declaredPageSize
        : DEFAULT_PAGE_SIZE;

    // Match the item count the server rendered with, so a refresh doesn't
    // quietly replace a limit="30" page with the full feed.
    const declaredLimit = Number(root.dataset["scLimit"]);
    this.limit =
      Number.isFinite(declaredLimit) && declaredLimit > 0 ? declaredLimit : 250;

    // Carried in the markup by renderFragment so a re-render reproduces the
    // same player/team anchors the server rendered.
    const playerUrl = root.dataset["scPlayerUrl"];
    const teamUrl = root.dataset["scTeamUrl"];
    this.links = {
      ...(playerUrl ? { playerUrl } : {}),
      ...(teamUrl ? { teamUrl } : {}),
    };
  }

  private get list(): HTMLOListElement | null {
    return this.root.querySelector<HTMLOListElement>(".news-list");
  }

  private get pager(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(".sc-pager");
  }

  /**
   * Items grouped by page, computed once per render rather than per click.
   *
   * Re-querying the DOM and walking every item on each interaction is the kind
   * of work that shows up in INP: with a full archive that's hundreds of nodes
   * touched to change four of them. The grouping is rebuilt only when the list
   * markup is replaced.
   */
  private pages: HTMLElement[][] = [];

  /** Every card in the list, in document order — the set the filters run over. */
  private allItems: HTMLElement[] = [];

  /**
   * Filter state, held here and nowhere else.
   *
   * Not in the URL, deliberately: `?team=PHI&player=hurts` would hand crawlers
   * an unbounded space of near-identical URLs and undo the canonical work. The
   * cards are all on the page already, so this is a view of the DOM, not an
   * address.
   */
  private teamFilter = "";
  private playerQuery = "";

  private indexPages(): void {
    this.allItems = Array.from(
      this.root.querySelectorAll<HTMLElement>(".sc-card-item"),
    );
    this.repaginate();
  }

  /** True when the card survives both filters. Empty filter matches everything. */
  private matches(item: HTMLElement): boolean {
    if (this.teamFilter && item.dataset["team"] !== this.teamFilter) return false;
    if (
      this.playerQuery &&
      !(item.dataset["player"] ?? "").includes(this.playerQuery)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Group the cards that pass the filters into pages of pageSize.
   *
   * Pages are built from the FILTERED set rather than read off the server's
   * `data-page`, so narrowing to three cards gives one full page rather than
   * five pages with holes in them. `data-page` still drives the server's
   * initial CSS hiding; from the first client render on, the inline styles
   * written here are the authority.
   */
  private repaginate(): void {
    const groups: HTMLElement[][] = [];
    for (const item of this.allItems) {
      if (!this.matches(item)) continue;
      const last = groups[groups.length - 1];
      if (!last || last.length >= this.pageSize) groups.push([item]);
      else last.push(item);
    }
    this.pages = groups;
  }

  /**
   * Re-run the filters and repaint.
   *
   * @param resetPage Send the reader back to page 1. True when they changed a
   *   filter — the page they were on no longer means anything. False for a
   *   background refresh, which must not yank someone off page 3 every two
   *   minutes just because a new item arrived.
   */
  private applyFilters(resetPage = true): void {
    this.repaginate();

    // Cards the filters excluded are hidden once, here; the page loop in
    // goToPage only ever touches cards that passed.
    const included = new Set<HTMLElement>();
    for (const group of this.pages) for (const item of group) included.add(item);
    for (const item of this.allItems) {
      if (!included.has(item)) item.style.display = "none";
    }

    const target = resetPage
      ? 0
      : Math.min(this.currentPage, this.totalPages() - 1);
    this.currentPage = target;
    this.goToPage(target, true);
    this.paintFilterState(included.size);
  }

  /** Result count, empty state and pager visibility for the current filters. */
  private paintFilterState(count: number): void {
    const filtering = this.teamFilter !== "" || this.playerQuery !== "";

    const status = this.root.querySelector<HTMLElement>(".sc-filter-status");
    if (status) {
      // Silent until the reader actually filters — a permanent "122 of 122" is
      // noise, and it would make the live region announce on every render.
      status.textContent = filtering
        ? `${count} of ${this.allItems.length} updates`
        : "";
    }

    const empty = this.root.querySelector<HTMLElement>(".sc-no-matches");
    if (empty) empty.hidden = count > 0;

    // The list reserves the height of a full page, which would otherwise hold a
    // blank gap open above the "no matches" line.
    const list = this.list;
    if (list) list.style.display = count === 0 ? "none" : "";

    const pager = this.pager;
    // Server ships the pager hidden so a no-JS visitor isn't stranded behind a
    // dead button. Now that we're running, pagination is real — but only while
    // there is more than one page left to move between.
    if (pager) pager.hidden = this.pages.length <= 1;
  }

  /**
   * Bind the toolbar. Called once from init(), not from enhance(): a refresh
   * replaces only the list and pager, so the controls (and whatever the reader
   * has typed into them) outlive it — re-binding per render would stack
   * duplicate listeners on the same two elements.
   */
  private wireFilters(): void {
    const filters = this.root.querySelector<HTMLElement>(".sc-filters");
    if (!filters) return;
    // Shipped hidden because without this script they cannot filter anything.
    filters.hidden = false;

    filters.addEventListener("input", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.id !== "scFilterPlayer") return;
      // Normalised the same way the cards were, so "jamarr" matches "Ja'Marr".
      this.playerQuery = searchKey((target as HTMLInputElement).value);
      this.applyFilters();
    });

    filters.addEventListener("change", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.id !== "scFilterTeam") return;
      this.teamFilter = (target as HTMLSelectElement).value;
      this.applyFilters();
    });
  }

  /**
   * Keep the dropdown honest after a refresh brought different teams into the
   * feed. Options are rebuilt only when the set actually changed, so typing
   * through a background poll doesn't lose the open dropdown for no reason.
   */
  private syncTeamOptions(): void {
    const select = this.root.querySelector<HTMLSelectElement>("#scFilterTeam");
    if (!select) return;

    const present = Array.from(
      new Set(
        this.allItems.map((item) => item.dataset["team"] ?? "").filter(Boolean),
      ),
    );
    const listed = Array.from(select.options)
      .slice(1)
      .map((option) => option.value);
    const unchanged =
      present.length === listed.length &&
      present.every((code) => listed.includes(code));
    if (unchanged) return;

    const chosen = select.value;
    const labelled = present
      .map((code) => ({ code, name: TEAM_NAMES[code] ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Index 0 is "All teams" and always stays.
    select.length = 1;
    for (const team of labelled) select.add(new Option(team.name, team.code));

    // If the selected team dropped out of the feed entirely, fall back to all
    // teams rather than leaving a selection that can only show an empty list.
    select.value = present.includes(chosen) ? chosen : "";
    this.teamFilter = select.value;
  }

  private totalPages(): number {
    return Math.max(1, this.pages.length);
  }

  private apiUrl(path: string): string {
    return `${this.origin}${path}`;
  }

  init(): void {
    // If server rendering was unavailable, fall back to building the list here.
    if (!this.list) {
      void this.refresh();
    } else {
      this.enhance();
    }

    this.wireFilters();
    this.startAutoRefresh();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.refresh();
    });

    // Delegated so it survives a re-render replacing the pager element.
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>(".sc-pager-btn");
      if (!btn || btn.disabled || !this.root.contains(btn)) return;
      const delta = btn.dataset["dir"] === "next" ? 1 : -1;
      this.goToPage(this.currentPage + delta);
      // Cosmetic, and not universally available — never let it break paging.
      this.list?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  /** Apply every enhancement to the current markup. Safe to re-run. */
  private enhance(): void {
    // Adopt the signature the server stamped on the list, so the first
    // background poll recognises unchanged data and skips the rebuild instead
    // of redrawing markup the server produced moments earlier.
    const sig = this.list?.dataset["sig"];
    if (sig !== undefined) this.signature = sig;

    this.indexPages();
    this.upgradeTimestamps();
    this.wireImageFallbacks();
    this.syncTeamOptions();
    // Re-applies whatever the reader has filtered to, so a background refresh
    // cannot quietly widen the list back out — and keeps them on their page.
    this.applyFilters(false);
  }

  /**
   * Show one page.
   *
   * Only the outgoing and incoming pages are touched — a handful of style
   * writes — rather than every item in the archive. Keeping the interaction's
   * work proportional to what actually changed is what keeps INP low as the
   * archive grows.
   */
  private goToPage(page: number, force = false): void {
    const pages = this.totalPages();
    const target = Math.max(0, Math.min(page, pages - 1));
    const previous = this.currentPage;
    if (target === previous && !force) return;
    this.currentPage = target;

    // SHOW must write a real value, never "". Assigning the empty string
    // REMOVES the inline declaration, which hands the element back to the
    // stylesheet — and the stylesheet says
    // `.news-list[data-paged] .sc-card-item:not([data-page="0"]) { display: none }`.
    // Clearing the inline style on any page but the first therefore hides the
    // page it was meant to reveal. SHOW matches `.sc-card-item`'s own rule.
    const SHOW = "block";
    const HIDE = "none";

    if (force) {
      // First run: the server hid everything after page 0 via CSS. Make every
      // page's state explicit rather than leaving any of it to the stylesheet,
      // so a re-render that lands on a later page (a background refresh while
      // the reader is on page 3) shows that page instead of blanking it.
      for (let i = 0; i < this.pages.length; i++) {
        const display = i === target ? SHOW : HIDE;
        for (const item of this.pages[i]!) item.style.display = display;
      }
    } else {
      for (const item of this.pages[previous] ?? []) item.style.display = HIDE;
      for (const item of this.pages[target] ?? []) item.style.display = SHOW;
    }

    // Before the pager work, not after it: what just changed is how tall the
    // list is, and a list short enough to need no pager (or filtered down to
    // one page) would otherwise leave the frame sized for the old content.
    this.postHeight();

    const pager = this.pager;
    if (!pager) return;

    const status = pager.querySelector(".sc-pager-status");
    if (status) {
      status.innerHTML = `${target + 1} <span>of</span> ${pages}`;
    }
    const prev = pager.querySelector<HTMLButtonElement>('[data-dir="prev"]');
    const next = pager.querySelector<HTMLButtonElement>('[data-dir="next"]');
    if (prev) prev.disabled = target === 0;
    if (next) next.disabled = target >= pages - 1;
  }

  private upgradeTimestamps(): void {
    for (const el of Array.from(
      this.root.querySelectorAll<HTMLTimeElement>("time[data-ts]"),
    )) {
      const ts = Number(el.dataset["ts"]);
      if (!Number.isFinite(ts)) continue;
      const relative = relativeLabel(ts);
      if (relative) {
        // Keep the precise value reachable even once the text goes fuzzy.
        el.title = formatAbsoluteDate(ts);
        el.textContent = relative;
      }
    }
  }

  private wireImageFallbacks(): void {
    for (const img of Array.from(
      this.root.querySelectorAll<HTMLImageElement>(".sc-card-photo"),
    )) {
      if (img.dataset["scFallbackWired"]) continue;
      img.dataset["scFallbackWired"] = "1";
      // Same badge the server renders for a player who has no headshot at all
      // (see renderCard) — the StatChasers mark, painted by styles.css. A photo
      // that 404s and a photo that never existed should not look different.
      const swap = (): void => {
        const span = document.createElement("span");
        span.className = "sc-card-photo-fallback";
        span.setAttribute("aria-hidden", "true");
        img.replaceWith(span);
      };
      img.addEventListener("error", swap);
      if (img.complete && img.naturalWidth === 0) swap();
    }
  }

  /**
   * Background refresh. Re-renders through the SAME module the server used, so
   * the replacement markup matches what SSR would have produced.
   */
  private async refresh(): Promise<void> {
    try {
      const res = await fetch(this.apiUrl(`/api/news?limit=${this.limit}`), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: NewsItem[] };
      const items = data.items ?? [];
      if (items.length === 0) return;

      // Rebuilding the list means parsing and laying out every card — easily
      // the longest task this script can run, and it fires every two minutes
      // whether or not anything changed. Most polls return identical data, so
      // compare a cheap signature first and do nothing when it matches. This
      // keeps a background refresh from landing in the middle of someone's
      // interaction and blowing INP.
      const signature = itemsSignature(items);
      if (signature === this.signature) return;
      this.signature = signature;

      const existing = this.list;
      const html = renderList(items, {
        pageSize: this.pageSize,
        links: this.links,
      });

      if (existing) {
        // Replace list + pager together; renderList emits both.
        const pager = this.pager;
        existing.insertAdjacentHTML("beforebegin", html);
        existing.remove();
        pager?.remove();
      } else {
        // No server-rendered list to replace (SSR unavailable) — build it.
        // Anchor below the toolbar when there is one, so the controls stay
        // above the cards they filter.
        const anchor =
          this.root.querySelector(".sc-toolbar") ??
          this.root.querySelector(".sc-filters") ??
          this.root.querySelector(".sc-section-heading");
        const empty = this.root.querySelector(".sc-empty:not(.sc-no-matches)");
        empty?.remove();
        if (anchor) anchor.insertAdjacentHTML("afterend", html);
        else this.root.insertAdjacentHTML("beforeend", html);
      }

      this.currentPage = Math.min(this.currentPage, this.totalPages() - 1);
      this.enhance();
    } catch {
      // Keep whatever is on screen; the server-rendered list is still valid.
    }
  }

  private startAutoRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, REFRESH_MS);
  }

  // --- legacy iframe support -------------------------------------------------
  //
  // Only relevant when the tool is still embedded cross-origin. The WordPress
  // plugin mounts it directly, where the parent sizes itself and none of this
  // runs.

  /**
   * Stop the framed document scrolling on its own.
   *
   * Only ever called in response to the parent confirming it has applied a
   * height (see embed.js): at that point the frame is exactly as tall as this
   * document, so an inner scrollbar can only scroll nothing — it is the nested
   * scroll area readers get stuck in, not a way to reach anything. Until that
   * confirmation arrives the document stays scrollable, so a frame left at its
   * placeholder height because the parent script never ran still gives access
   * to everything below the fold.
   */
  private scrollLocked = false;

  private lockScrolling(): void {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    // Both elements: which one owns the viewport scrollbar varies by browser.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  private postHeight(): void {
    if (window.parent === window) return;
    // Measure the wrapper's BOTTOM EDGE in document coordinates, not its
    // height: anything rendered above `.page` shifts the content down without
    // making the wrapper any taller, and a height-only measurement then
    // under-reports by exactly that offset — enough for the frame to keep a
    // scrollbar. `.page` carries `display: flow-root` (styles.css) so
    // descendant margins stay inside that box instead of collapsing through it
    // and adding height the wrapper never accounts for.
    //
    // Deliberately NOT max()-ed with documentElement.scrollHeight: that value is
    // floored at the viewport height, so once the parent applies a height the
    // measurement can only ever grow. The frame would never shrink back from the
    // placeholder to a shorter real content height, leaving a blank gap instead.
    const page = document.querySelector(".page");
    const height = Math.ceil(
      page
        ? page.getBoundingClientRect().bottom + window.scrollY
        : document.body.scrollHeight,
    );
    window.parent.postMessage({ type: "statchasers:height", height }, "*");
  }

  wireIframeHeight(): void {
    if (window.parent === window) return;

    if ("ResizeObserver" in window) {
      const page = document.querySelector(".page") ?? document.body;
      new ResizeObserver(() => this.postHeight()).observe(page);
    }
    window.addEventListener("load", () => this.postHeight());
    window.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string } | null;
      if (!data) return;
      if (data.type === "statchasers:request-height") this.postHeight();
      if (data.type === "statchasers:height-applied") this.lockScrolling();
    });
    // The parent's listener often loads late (performance plugins delay JS
    // until first interaction), so re-broadcast a few times after load.
    for (const ms of [250, 1000, 2500, 5000]) {
      window.setTimeout(() => this.postHeight(), ms);
    }
  }
}

function boot(): void {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sc-root]"),
  );
  for (const root of roots) {
    const widget = new NewsWidget(root);
    widget.init();
    widget.wireIframeHeight();
    maybeLoadVitals(root);
  }
}

/**
 * Pull in the Core Web Vitals bundle — but only if this site asked for it.
 *
 * A separate `async` script rather than part of this bundle: monitoring is
 * optional, so sites that haven't configured an endpoint should never pay to
 * download it, and those that have shouldn't have it delay the tool.
 */
function maybeLoadVitals(root: HTMLElement): void {
  if (!(root.dataset["scVitalsEndpoint"] ?? "").trim()) return;
  if (document.querySelector("script[data-sc-vitals]")) return;

  const origin = (root.dataset["scOrigin"] ?? "").replace(/\/+$/, "");
  const script = document.createElement("script");
  script.src = `${origin}/dist/statchasers-vitals.js`;
  script.async = true;
  script.dataset["scVitals"] = "1";
  document.head.appendChild(script);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
