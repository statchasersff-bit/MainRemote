/**
 * Main-thread scheduling helpers for interaction handlers (INP audit,
 * 2026-11-15, docs/INP-AUDIT.md).
 *
 * Interaction to Next Paint is the time from a tap to the next frame the
 * browser shows. A handler that does everything at once - marks the tab,
 * reveals a 1,200-element panel, reads its layout, calls analytics - makes the
 * reader wait for all of it before the tap visibly lands. The pattern used
 * across the bundles is two-phase: the control's own state (the tab that is
 * now chosen, the column that is now sorted) changes inside the handler and
 * paints at once; the expensive part runs in a task after that frame. Nothing
 * is skipped and nothing changes what ends up on screen - the panel or the
 * re-ordered rows arrive one frame after the control says so.
 *
 * Each bundle is built on its own (build.mjs), so this module is inlined into
 * every bundle that imports it; it holds no state that two bundles on one page
 * would need to share.
 */

/**
 * Run `fn` after the browser has produced the next frame.
 *
 * requestAnimationFrame fires just BEFORE the frame is rendered; a task posted
 * from inside it runs after that frame's style, layout and paint. In a hidden
 * document animation frames do not fire at all, so there it is just a task.
 */
export function afterNextPaint(fn: () => void): void {
  const task = (): void => {
    setTimeout(fn, 0);
  };
  if (
    typeof requestAnimationFrame !== "function" ||
    (typeof document !== "undefined" && document.visibilityState === "hidden")
  ) {
    task();
    return;
  }
  requestAnimationFrame(task);
}

interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

/**
 * Give the main thread back to the browser for a moment, so a tap that arrived
 * during a long computation is handled before the computation resumes.
 * `scheduler.yield()` where it exists (it keeps this work's place at the front
 * of the queue); a zero-delay task elsewhere.
 */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  if (s && typeof s.yield === "function") return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A time-sliced loop's clock: `due()` is true once the current slice has run
 * for `budgetMs`, and `next()` yields and starts a new slice. Loops check it
 * every few thousand iterations, so the check itself costs nothing.
 */
export function sliceClock(budgetMs = 8): { due: () => boolean; next: () => Promise<void> } {
  let start = performance.now();
  return {
    due: () => performance.now() - start >= budgetMs,
    next: async () => {
      await yieldToMain();
      start = performance.now();
    },
  };
}

/**
 * String comparison for table sorts. `a.localeCompare(b)` with no locale
 * builds a collator on every call; this one is built once. With no arguments
 * the two are defined to be the same comparison (ECMA-402: localeCompare
 * constructs `new Intl.Collator(undefined, undefined)`), so every sort orders
 * exactly as it did - it just stops paying for a collator per comparison,
 * which was most of a name sort's handler time on a phone.
 */
const collator =
  typeof Intl !== "undefined" && typeof Intl.Collator === "function" ? new Intl.Collator() : null;

export function compareText(a: string, b: string): number {
  return collator ? collator.compare(a, b) : a.localeCompare(b);
}
