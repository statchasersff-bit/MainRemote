/**
 * The compact news rail's client (lib/news-rail.ts): a few kilobytes, so a
 * page that shows only the rail never downloads the full feed's bundle.
 *
 * Two jobs:
 *   - relative times ("12 min ago") from each row's data-ts, kept current
 *     every minute. The server prints an absolute time, because the page the
 *     rail sits on can be served from the edge for days;
 *   - paging: Prev / Next step through the pages the server already printed
 *     (every row is in the HTML; rows off the shown page carry `hidden`),
 *     and Next past the last of them loads the next stories from /api/news
 *     on demand, as far back as the feed goes (RAIL_FEED_MAX);
 *   - the rows themselves, refreshed from the same /api/news the full feed
 *     polls, on the same ten-minute rhythm and on returning to the tab. A
 *     copy rendered more than ten minutes ago refreshes once on load, so an
 *     edge-cached homepage does not open on yesterday's stories.
 */

import { RAIL_FEED_MAX, railPageCount, railRelativeLabel, railSignature, renderRailItems, renderRailPager, renderNewsRail } from "../lib/news-rail";
import type { NewsItem } from "../lib/render";

const REFRESH_MS = 10 * 60 * 1000;
const REFOCUS_MIN_GAP_MS = 60 * 1000;
const TICK_MS = 60 * 1000;

function updateTimes(root: ParentNode): void {
  const now = Date.now();
  root.querySelectorAll<HTMLTimeElement>("time.sc-rail-time[data-ts]").forEach((el) => {
    const ts = Number(el.dataset["ts"]);
    if (!Number.isFinite(ts)) return;
    if (!el.dataset["abs"]) el.dataset["abs"] = el.textContent ?? "";
    const label = railRelativeLabel(ts, now);
    el.textContent = label ?? el.dataset["abs"] ?? "";
    // The server's title already carries the full timestamp ("Nov 5, 2026 3:20 PM ET").
  });
}

class Rail {
  private root: HTMLElement;
  private lastRefresh = 0;
  private page = 1;
  private loading = false;

  /** Whether the feed may hold stories older than the printed rows. */
  private get more(): boolean {
    return this.root.dataset["scMore"] === "1";
  }
  private set more(value: boolean) {
    this.root.dataset["scMore"] = value ? "1" : "0";
  }

  private get rowCount(): number {
    return this.root.querySelectorAll(".sc-rail-item").length;
  }

  /** Fetch the newest `total` stories (rail photos filled), or null on any failure. */
  private async fetchItems(total: number): Promise<NewsItem[] | null> {
    try {
      const res = await fetch(this.apiUrl(`/api/news?limit=${total}&photos=1`), { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = (await res.json()) as { items?: NewsItem[] };
      return (data.items ?? []).slice(0, total);
    } catch {
      return null;
    }
  }

  /** Next past the printed pages: load one more page of stories, then show it. */
  private async loadMore(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const next = this.root.querySelector<HTMLButtonElement>(".sc-rail-next");
    if (next) {
      next.disabled = true;
      next.setAttribute("aria-busy", "true");
    }
    const total = Math.min(RAIL_FEED_MAX, (this.pageCount + 1) * this.limit);
    const items = await this.fetchItems(total);
    this.loading = false;
    if (items && items.length > this.rowCount) {
      const list = this.root.querySelector(".sc-rail-list");
      if (list) {
        list.innerHTML = renderRailItems(items, this.origin, this.limit, this.page);
        this.root.dataset["scSig"] = railSignature(items);
      }
      this.more = items.length >= total && total < RAIL_FEED_MAX;
      this.show(this.page + 1, 1);
      updateTimes(this.root);
      return;
    }
    // Nothing older (or the request failed): the end of the feed for now.
    if (items) this.more = false;
    this.show(this.page, 1);
  }

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private get origin(): string {
    return (this.root.dataset["scOrigin"] ?? "").replace(/\/+$/, "");
  }

  private apiUrl(path: string): string {
    const api = (this.root.dataset["scApi"] ?? "").replace(/\/+$/, "");
    return `${api || this.origin}${path}`;
  }

  private get limit(): number {
    const n = Number(this.root.dataset["scLimit"]);
    return Number.isFinite(n) && n > 0 ? n : 6;
  }

  private get pagesWanted(): number {
    const n = Number(this.root.dataset["scPages"]);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  /** Pages the printed rows actually fill. */
  private get pageCount(): number {
    const rows = this.root.querySelectorAll(".sc-rail-item").length;
    return railPageCount(rows, this.limit);
  }

  /** Show one page: unhide its rows, hide the rest, redraw the pager. */
  private show(page: number, focus: false | number = false): void {
    const pages = this.pageCount;
    this.page = Math.min(Math.max(1, page), pages);
    this.root.querySelectorAll<HTMLElement>(".sc-rail-item").forEach((li) => {
      li.hidden = Number(li.dataset["page"]) !== this.page;
    });
    const old = this.root.querySelector(".sc-rail-pager");
    const html = renderRailPager(this.page, pages, this.more);
    if (old) old.outerHTML = html;
    else if (html) this.root.querySelector(".sc-rail-list")?.insertAdjacentHTML("afterend", html);
    if (focus) {
      // Keep keyboard focus on the control that was pressed (or its partner when it just disabled).
      const want = this.root.querySelector<HTMLButtonElement>(`.sc-rail-pager button[data-dir="${focus}"]:not([disabled])`) ??
        this.root.querySelector<HTMLButtonElement>(".sc-rail-pager button:not([disabled])");
      want?.focus();
    }
  }

  private wirePager(): void {
    this.root.addEventListener("click", (event) => {
      const btn = (event.target as Element | null)?.closest<HTMLButtonElement>(".sc-rail-pager button[data-dir]");
      if (!btn || btn.disabled) return;
      const dir = Number(btn.dataset["dir"]);
      if (dir > 0 && this.page >= this.pageCount) {
        void this.loadMore();
        return;
      }
      this.show(this.page + dir, dir);
      updateTimes(this.root);
    });
  }

  async refresh(): Promise<void> {
    this.lastRefresh = Date.now();
    try {
      // Everything already loaded, so a reader deep in the list keeps it.
      const total = Math.min(RAIL_FEED_MAX, Math.max(this.limit * this.pagesWanted, this.rowCount));
      const items = await this.fetchItems(total);
      if (!items || !items.length) return;
      const sig = railSignature(items);
      if (sig === this.root.dataset["scSig"]) return;

      // A mount the server could not fill (the plugin's fallback) becomes the whole rail.
      if (this.root.dataset["scRailMount"] === "1") {
        const html = renderNewsRail(items, {
          limit: this.limit,
          pages: this.pagesWanted,
          origin: this.origin,
          ...(this.root.dataset["scApi"] ? { apiBase: this.root.dataset["scApi"] } : {}),
          ...(this.root.dataset["scHeading"] ? { heading: this.root.dataset["scHeading"] } : {}),
          renderedMs: Date.now(),
        });
        const holder = document.createElement("div");
        holder.innerHTML = html;
        const rail = holder.firstElementChild as HTMLElement | null;
        if (!rail) return;
        this.root.replaceWith(rail);
        this.root = rail;
        this.root.dataset["scRailReady"] = "1";
        this.wirePager();
        this.page = 1;
      } else {
        const list = this.root.querySelector(".sc-rail-list");
        if (!list) return;
        // The reader stays on the page they were reading.
        list.innerHTML = renderRailItems(items, this.origin, this.limit, this.page);
        this.root.dataset["scSig"] = sig;
        this.more = items.length >= total && total < RAIL_FEED_MAX;
        this.show(this.page);
      }
      updateTimes(this.root);
    } catch {
      // Keep what is on the page; the next tick tries again.
    }
  }

  init(): void {
    this.wirePager();
    updateTimes(this.root);
    const rendered = Number(this.root.dataset["scRendered"]);
    const stale = !Number.isFinite(rendered) || Date.now() - rendered > REFRESH_MS;
    if (this.root.dataset["scRailMount"] === "1" || stale) void this.refresh();
    else this.lastRefresh = rendered;

    window.setInterval(() => updateTimes(this.root), TICK_MS);
    window.setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      updateTimes(this.root);
      if (Date.now() - this.lastRefresh > Math.max(REFOCUS_MIN_GAP_MS, REFRESH_MS / 2)) void this.refresh();
    });
  }
}

function boot(): void {
  document.querySelectorAll<HTMLElement>("[data-sc-rail], [data-sc-rail-mount]").forEach((root) => {
    if (root.dataset["scRailReady"] === "1") return;
    root.dataset["scRailReady"] = "1";
    new Rail(root).init();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
