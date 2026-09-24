/**
 * Redraft rankings enhancement bundle.
 *
 * The boards are complete before this runs — all five panels, 230 players,
 * every tier header and every team badge are in the HTML the server sent, and
 * the position strip works with scripting disabled because CSS `:target`
 * switches the panels. Nothing here fetches anything and nothing here renders a
 * row.
 *
 * It adds two things:
 *   1. real tab behaviour for the position strip, from client/enhance.ts — the
 *      ARIA roles, arrow keys, and switching without a reload. Each tab is the
 *      position's own address (`/rest-of-season-rankings/te`), so choosing
 *      "TE" pushes that address, and Back walks back through the tabs;
 *   2. height reporting for the legacy iframe mount, likewise.
 *
 * The one thing it deliberately does NOT add is sorting. The FPA table sorts
 * because "who is softest against tight ends" is a real question of that data;
 * a tiered rankings board has exactly one meaningful order, which is the one it
 * is published in, and letting a reader sort it alphabetically would only take
 * the tiers apart.
 */

import { wireFrameHeight, wireTabs } from "./enhance";

const ROOT_SELECTOR = "[data-scr-root]";

function boot(): void {
  for (const root of Array.from(
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR),
  )) {
    wireTabs(root, {
      navSelector: "[data-scr-nav]",
      listSelector: ".scr-nav-list",
      linkSelector: ".scr-nav-link",
      datasetKey: "scrTabs",
      panelKey: "scrPanelId",
      // The host page's H1 follows the board, as the address does.
      headingKey: "scrHeading",
    });
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
