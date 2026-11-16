# INP audit - 2026-11-15

Search Console: ~11,500 URLs in one group, group INP 238 ms ("Needs
improvement", mobile and desktop). Goal: under 200 ms, ideally 150 ms.

This file is the record of what was measured, what was changed, and what is
left for settings outside this repo. Re-measure with `scripts/inp-probe.mjs`
(usage at the top of the file).

## How it was measured

- `scripts/inp-probe.mjs` drives headless Chromium over CDP against the LIVE
  site: real touch/mouse input on named controls, Event Timing entries split
  into input delay / processing / presentation, Long Animation Frame script
  attribution, an optional devtools trace, and a second metric - main-thread
  time from the event to just after the next frame (`raf`) - because headless
  software compositing sometimes withholds presentation for seconds (see
  "Lab caveats").
- Mobile = 412x915 emulation, touch, 4x CPU throttle. Desktop = 1366x768,
  mouse, no throttle. Absolute lab numbers are slower than a mid-range phone;
  compare runs, not against the 200 ms line.
- Before/after on production markup without deploying: `--serve=<url part>=
  <local file>` swaps a live bundle or stylesheet for the local build;
  `--nodelay` undoes WP Rocket's Delay JS in the live HTML; `--undelay=<kw>`
  undoes it only for scripts containing a keyword; `--after=<js>` checks the
  page did the right thing after the clicks.
- Every change below was checked for identical end state (row order, active
  panel, URL/hash, title, H1, focus, scroll, analytics events), not just time.

## What runs where

| Layer | What | Where |
|---|---|---|
| WordPress + Divi (Theme Builder header/footer) | jQuery 3.7 + migrate, Divi `scripts.min.js`, `sticky-elements.js` (with `et_pb_sticky_elements = []`), `fitvids`, `et-core-common` | every page |
| Header Code module (inline) | mobile menu (2 small vanilla scripts), scroll reveal for `.sc-section` (passive), 13.6 KB ROS Google-Sheets loader (exits early without `#ros`) | every page |
| Google Site Kit | gtag.js (GT-KDTSMLR9) + content-events provider | every page |
| WP Rocket | page cache, minify, LazyLoad, Preload Links (touch/hover handler), **Delay JavaScript execution** | every cached page |
| WordPress core 6.8 | `speculationrules` prefetch | every page |
| Asset CleanUp (wpacu) | per-page unloading | uncached renders show its markers |
| Our bundles (news.statchasers.com/dist) | one per tool, no dependencies, deferred, 2-38 KB | only on pages with that tool |

Our bundles were already split per tool (build.mjs); no tool's code loads on
another tool's page. Cloudflare Rocket Loader and the CF beacon are not on
the page.

## Findings, worst first

1. **WP Rocket "Delay JavaScript execution" (sitewide, every cached page).**
   Every script, including the mobile menu's inline scripts and our tool
   bundles, waits for the first tap, then everything downloads and runs at
   once and the tap is replayed. First tap on the mobile menu, live:
   homepage 1,009-1,138 ms, player hub 1,551-1,721 ms to open; with nothing
   delayed 92-180 ms. Un-delaying only the menu scripts did not help
   (1,139-1,918 ms): Rocket holds the first tap while ANY script is delayed.
   A first FAQ tap on SOS recorded Event Timing 1,176 ms behind the burst
   (Divi 235 ms, gtag 221 ms, timers 210 ms). Field INP under-reports the
   replayed tap, but the burst blocks whatever the reader does next.
   Not fixable from the repo; see Recommendation 1.

2. **Matchup tab switch** (`team.ts` wireMatchupTabs; every matchup and game
   page). Mobile 144-568 ms. The handler revealed the panel and then read its
   layout (`scrollWidth`, `getBoundingClientRect`): 291 ms of forced
   style/layout for Box Score (~1,200 elements; container queries make it
   expensive), then called `gtag()` synchronously - 100-190 ms of the tap
   (blocking GTM cut processing 436 -> 244 ms).

3. **Team hub in-place tabs** (`team.ts` wireTabs; Draft, Contracts).
   Mobile Draft 242-334 ms, Contracts 504-640 ms: panel reveal +
   `panel.focus()` (forced layout) + GA4's pushState hook in one task.

4. **Table sorts.** Handcuffs: 421 ms main thread per sort (mobile).
   SOS: 360-536 ms. `localeCompare` with no locale built a collator per
   comparison (68-83 ms of a name sort's handler). SOS also pays 140-230 ms
   to render ANY frame - two 32-team boards (~6,000 elements: the original
   and the premium comparison board).

5. **Injury figure** (`player.ts` renderFigure; player hub + injury pages).
   One 122-175 ms task when the base image loads. On Rocket-cached hubs the
   image `src` is LazyLoad's 0x0 SVG placeholder, so the task recolored an
   empty image and **the figure painted blank** (0 opaque pixels, live).

6. **Player search, first keystroke** (every player page): 104-176 ms; the
   roster parse (~30 KB island) ran inside the first `input` event.

7. **Load-time main thread** (all pages, mobile 4x): gtag 218-317 ms + a
   171-206 ms timer, Divi `scripts.min.js` 183-270 ms, jQuery 65-150 ms,
   `sticky-elements.js` 55-69 ms. A tap during load waits behind these.

8. **Mobile menu, later opens** 40-48 ms; first open 120-240 ms (paint of a
   full-screen overlay). Acceptable; not changed.

9. Not problems: plain taps (16-56 ms), FAQ toggles off SOS (48-80 ms),
   the scroll-reveal listener (passive), the ROS loader (exits early).

## Changes (in this repo)

| File | Change | Pages |
|---|---|---|
| `src/client/schedule-work.ts` (new) | `afterNextPaint`, `yieldToMain`, `sliceClock`, `compareText` (one cached `Intl.Collator`) | all bundles that import it |
| `src/client/team.ts` | Matchup tabs and hub tabs switch in two frames: the tab state paints inside the tap; panel, hash/URL, heading, focus, scroll-to-scoreboard follow after that frame; latest tap wins. `recap_tab_view` sent after paint (same event, same params). Contracts + stat-table sorts: header in the tap, rows after paint, read at that moment so tie-breaks are unchanged; fragment append. Fantasy "show more" re-mark queued behind the re-sort. | matchup/game pages, team hubs |
| `src/client/sos.ts` | Two-frame sort; fragment append; card scroll queued behind the re-sort | SOS (6 URLs) |
| `src/client/rb-handcuffs.ts` | Two-frame header sort (`sortFromTap`); weight sliders still re-sort at once | handcuffs |
| `src/client/player.ts` | Figure pixel loops time-sliced (8 ms slices, same pixels); reads `data-lazy-src` when `src` is a placeholder | player hubs, injury pages |
| `src/client/player-search.ts` | Roster parsed in a task after focus paints | every player page, team pages |
| `src/client/{fpa,player-stats}.ts` | `compareText` in sorts | FPA, advanced stats |
| `public/sos.css` | `content-visibility: auto` on the premium board's table shell and the FAQ (both below the fold everywhere; nothing in them draws outside their box - the board's popovers live outside the shell) | SOS |
| `tests/{matchup,team,rb-handcuffs}.test.mjs` | Wait one frame after a tab/sort click before asserting the panel/rows; assert the tab/header changes at once | - |
| `scripts/inp-probe.mjs` (new) | the probe | - |
| `wordpress-plugin/.../statchasers-perf.php` (new), plugin 1.10.55 | Every `/dist/statchasers-*.js` bundle excluded from Delay JS and minify/combine (team.js has been since 1.10.52). Shortens the burst and makes the tools' controls exist from load; does NOT remove the first-tap wait (finding 1). Smoke tests added. | every tool page |

No server code, HTML, titles, meta, canonicals, JSON-LD, headings, links or
copy changed. SEO content is untouched by construction: every change is in a
client bundle that runs after the server's complete HTML, or in CSS.

## Before / after (live markup, local bundles swapped in)

Mobile, 4x CPU. "ET" = Event Timing duration (INP's number); "raf" = main
thread to next frame.

| Interaction | Before | After | Evidence |
|---|---|---|---|
| Matchup tab, worst of 5 | ET 440-504 ms | ET 128 ms | 2 runs each |
| Matchup tab, others | ET 128-472 ms | ET 24-80 ms | |
| Team hub Contracts tab | ET 504-640 ms | ET 24-48 ms | 2 runs each |
| Team hub Draft tab | ET 242-334 ms | ET <=56 ms | |
| Handcuffs sort | raf 421 ms | raf 121-127 ms (floor ~105) | identical final DOM (md5) |
| SOS sort (JS only) | ET 360-536 ms | ET 152-400 ms | identical row order |
| SOS sort (+ sos.css) | frame 140-150 ms | frame 61-77 ms | |
| Injury figure load task | 169-175 ms | slices < 30 ms | identical pixels (hash) |
| Player hub figure | blank (0 px) | painted (same hash as injury page) | |

Desktop, no throttle: matchup tabs 40-120 ms -> 0-16 ms; hub tabs up to
152 ms -> at most 32 ms.

`sos.css` was compared viewport by viewport (412 and 1366 px, popovers open
and closed): identical except whole-pixel rounding (the premium table and
the FAQ rows sit 1 px differently in places). A full-page capture shows the
contained sections blank only because they are off screen when captured;
that is what content-visibility does and what a reader never sees.

### Lab caveats

- Event Timing on the handcuffs page reports 1.6-9 s of "presentation"
  after a sort before AND after the change, with an idle main thread and no
  raster work: headless software compositing withholding the frame. The
  `raf` metric is the one to read there; confirm on a real phone (Chrome
  DevTools > Performance, "Interactions" track).
- `disabled-by-default-devtools.timeline` tracing inflates paint and
  Layerize several-fold; read trace splits as relative only.
- CrUX (Search Console) is a 28-day rolling window: expect movement 2-4
  weeks after deploy, and only if Recommendation 1 is acted on for the
  pages where Delay JS dominates.

## To deploy

1. Publish the API (bundles + `sos.css` ship from news.statchasers.com).
2. Upload plugin 1.10.55 (`wordpress-plugin/dist/statchasers-news.zip`).
3. WP Rocket: Clear cache (mobile cache too), then Rocket.net edge purge.
   Check with an iPhone UA that `statchasers-player.js` now carries
   `nowprocket` and no `rocketlazyloadscript` on a player hub.

## Recommendations outside the repo, by impact

1. **WP Rocket > File Optimization > JavaScript > "Delay JavaScript
   execution": turn it OFF; keep "Load JavaScript deferred" ON.** Measured
   effect on the first tap: 1.0-1.9 s -> 0.1-0.2 s. Cost: gtag, Divi and
   jQuery (roughly 0.5-0.8 s of 4x-throttled main thread) run at load
   instead of on the first tap, so Lighthouse TBT rises; LCP is not
   expected to move (scripts are deferred and the content is server-rendered)
   but watch PageSpeed for a week. Keyword exclusions do NOT work (tested:
   excluding the menu scripts alone changed nothing), and an exclusion list
   that leaves gtag delayed would leave the first tap waiting on gtag.
   Clear WP Rocket + Rocket.net after the change.
2. **WP Rocket > Preload > "Enable link preloading": OFF.** WordPress 6.8
   already prints native `speculationrules` prefetch for the same links; the
   Rocket version adds a JS hover/touch handler (31-59 ms on a first touch).
3. **Divi unused scripts** (Asset CleanUp is installed): every sampled page
   prints `et_pb_sticky_elements = []`, yet loads `sticky-elements.js`
   (55-69 ms at load on mobile). Unload `et-builder-modules-script-sticky`
   sitewide after confirming the header has no sticky setting; unload
   `fitvids` where there is no video embed. Divi > Theme Options >
   Performance: keep Dynamic JavaScript Libraries ON.
4. **Move the ROS Google-Sheets script** out of the header Code module onto
   the one page with `#ros` (13.6 KB parsed on every page; exits early, so
   small, but it does not belong sitewide).
5. **Cloudflare / Rocket.net:** leave Rocket Loader OFF (it would fight WP
   Rocket's script handling). CDN settings do not move INP; nothing to change.
6. **Field attribution (next step, not shipped):** the existing vitals
   bundle (`statchasers-vitals.js`, web-vitals) only loads for the news
   shortcode with an endpoint, and none is configured. Lowest-cost option:
   load web-vitals' attribution build lazily after `load` in the tool
   bundles and send INP > 200 ms to GA4 as one event (`inp_slow`: value,
   interaction target selector, input delay / processing / presentation, page
   template). No personal data; needs two GA4 custom dimensions. Ask before
   adding.
7. **SOS's premium comparison board** doubles that page's rendering cost.
   When it is approved or dropped (memory: not approved yet), the page halves.
