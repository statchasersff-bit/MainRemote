/**
 * Entry point for the separately-built Core Web Vitals bundle.
 *
 * Loaded on demand by main.ts, and only when a reporting endpoint is
 * configured — see src/client/vitals.ts for why it is kept out of the main
 * bundle.
 */

import { startVitals } from "./vitals";

for (const root of Array.from(
  document.querySelectorAll<HTMLElement>("[data-sc-root]"),
)) {
  startVitals(root);
}
