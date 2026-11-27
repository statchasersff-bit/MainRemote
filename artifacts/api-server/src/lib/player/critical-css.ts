import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "../data-dir";

/**
 * The player header's critical CSS, printed inline at the top of an embedded
 * player fragment (2026-11-27, docs/MOBILE-PERF-PLAYER-2026-11-27.md).
 *
 * On statchasers.com WP Rocket loads player.css asynchronously. Until it
 * lands, the header used to be laid out by Rocket's own critical CSS for the
 * template, which is stale and has no phone hero (the name column got 0px,
 * the hero ran ~1,000px tall), and collapsed when player.css applied: 0.18
 * CLS on the Gibbs hub, ~0.7 on a thin profile. This block is the subset of
 * player.css that styles the search box, the header and the tab strip, so
 * those paint at their final size before player.css arrives, and first paint
 * does not wait for player.css.
 *
 * Generated, never edited: scripts/player/critical-css.mjs selects every rule
 * of the built player.css that matches those elements on real hub fragments
 * (in player.css order; selectors that also match the page body are scoped to
 * the header with :where(), so they cannot reorder anything below it) and
 * writes public/player-critical.css. tests/player-critical-css.test.mjs fails
 * when that file is not what the generator would write today.
 *
 * Printed after Rocket's critical CSS (that one is in <head>), so at equal
 * specificity these rules win; player.css, when it lands, applies the same
 * rules again, so nothing in the header moves.
 */

let cached: string | null = null;

/** The `<style>` element, or "" when the generated file is missing. */
export function playerCriticalStyle(): string {
  if (cached !== null) return cached;
  try {
    const css = readFileSync(path.resolve(DATA_ROOT, "..", "public", "player-critical.css"), "utf8")
      .replace(/^\/\*[\s\S]*?\*\/\s*/, "")
      .trim();
    // `</style` cannot occur in CSS the generator writes, but never let a
    // stylesheet end the element early.
    cached = css && !/<\/style/i.test(css) ? `<style id="scp-critical">${css}</style>` : "";
  } catch {
    cached = "";
  }
  return cached;
}
