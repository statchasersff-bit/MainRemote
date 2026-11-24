/*
 * StatChasers Rookie Hit Rates — embed auto-resize helper.
 * Runs INSIDE the iframe and reports the app's rendered height to the parent
 * WordPress page so the shortcode can size the iframe to its content (no inner
 * scrollbar, no fixed guess). Communicates via postMessage, so it is safe even
 * if the parent is on a different origin.
 */
(function () {
  function currentHeight() {
    // Measure the app's CONTENT height, not documentElement's. For the root
    // element, scrollHeight/offsetHeight are clamped to the viewport (i.e. the
    // iframe height the parent already set), so they can never report *less*
    // than the current iframe height — that ratchets the embed to the tallest
    // tab visited and leaves a gap under shorter tabs. The app root (.scff-app)
    // or, failing that, <body> gives the true content height that can shrink.
    var app = document.querySelector(".scff-app");
    var body = document.body;
    if (app) {
      var rect = app.getBoundingClientRect();
      var top = rect.top + (window.pageYOffset || window.scrollY || 0);
      return Math.ceil(top + rect.height);
    }
    return body ? body.scrollHeight : 0;
  }

  var lastSent = 0;
  function send() {
    var h = currentHeight();
    // Avoid spamming the parent with sub-pixel jitter.
    if (Math.abs(h - lastSent) < 2) return;
    lastSent = h;
    try {
      parent.postMessage({ __rhr: true, type: "rhr-height", height: h }, "*");
    } catch (e) {
      /* no-op */
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // rAF is throttled to zero in an offscreen iframe, so it cannot be the only
    // path that clears `scheduled` — one dropped frame would latch this closed
    // and no height would ever be posted. Race it against a timer and let
    // whichever fires first do the work.
    var ran = false;
    function run() {
      if (ran) return;
      ran = true;
      scheduled = false;
      send();
    }
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    setTimeout(run, 32);
  }

  window.addEventListener("load", schedule);
  window.addEventListener("resize", schedule);
  // `load` waits on every font and logo; report as soon as the app has mounted.
  document.addEventListener("DOMContentLoaded", schedule);
  // Coming back from a background tab is a chance to correct a stale height.
  document.addEventListener("visibilitychange", schedule);

  if (window.ResizeObserver) {
    try {
      new ResizeObserver(schedule).observe(document.documentElement);
    } catch (e) { /* no-op */ }
  }

  if (window.MutationObserver) {
    try {
      new MutationObserver(schedule).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } catch (e) { /* no-op */ }
  }

  // Charts, web fonts and tab switches can settle after the initial paint.
  // Poll briefly so a late layout shift still gets reported.
  var ticks = 0;
  var interval = setInterval(function () {
    schedule();
    if (++ticks > 30) clearInterval(interval);
  }, 400);
})();
