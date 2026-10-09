# CLS on the embedded tool pages (statchasers.com)

Written 2026-10-07 after Search Console flagged the tool pages for poor
Cumulative Layout Shift. Everything below was measured against the live site
with `scripts/cls-probe.mjs` (headless Chromium, DevTools protocol) and checked
against the page source. Numbers are single lab runs; Google's figure is the
75th percentile of real Chrome visits over 28 days, which is why the lab has to
be read for *causes* rather than for the score itself.

## Summary

1. **One cause explains the poor grade on every tool page: Divi's Critical
   CSS defers the mobile header's own styles.** On phones the Theme Builder
   header first paints with Divi's default section and row padding and with
   the hidden mobile-menu section laid out, then collapses by about 320 px
   when the deferred stylesheet lands. Everything on the page moves up with
   it. Measured shift: 0.35 to 0.61 per page. Google's "poor" threshold is
   0.25. Desktop is unaffected (0.0001). The fix is a Divi setting; it does
   not touch our code.
2. **The depth chart page has a second, equal-sized shift of its own:** the
   client script fills a one-line "Loading depth charts…" placeholder with the
   whole app, pushing the 32 team links below it off the screen (0.45).
3. Everything in our own markup is small: lazy-loaded peer-rail photos on
   player pages (about 0.03 across a full scroll), the team hero's text
   fitting (0.01), web font swaps (under 0.002 measured). Worth tidying after
   the two above, not before.
4. Side finding: **the live Strength of Schedule page prints `[statchasers_sos]`
   as literal text.** The shortcode is not being expanded, so the tool is not
   on that page at all.

## What Google is measuring

Search Console's Core Web Vitals report uses CrUX field data: real visits,
mostly on phones, scored across the whole visit (scrolls, tab clicks, lazy
loads), not the first five seconds of a synthetic load. Two consequences
mattered here:

- A throttled lab run (slow 4G, 4x CPU) scored the Eagles hub at **0.00**,
  because under throttling the deferred stylesheet happened to arrive before
  first paint. An unthrottled run of the same page scored 0.106. Real phones
  on real networks land on both sides of that race, and the 75th percentile
  catches the bad side.
- Chrome ignores shifts within 500 ms of user input. Scrolling is **not**
  input, so anything that resizes while a reader scrolls (lazy images, sticky
  bars that grow) counts in full.

Note for anyone re-measuring with device emulation: Chrome flags shifts in the
first half-second of an emulated mobile document as "had recent input" because
the viewport resize counts as input, so Lighthouse-style mobile runs can hide
exactly the shift described below. The probe's `narrow` mode (a 412 px window
without mobile emulation) avoids this; a synthetic test page confirmed the same
shift is flagged under emulation and counted without it.

## Finding 1: the deferred mobile header (every page)

### What happens

On a phone, the first paint of any page lays out the Theme Builder header like
this (all values from the probe, 412 px viewport):

| Element | First paint | After deferred CSS |
|---|---|---|
| Header row `.et_pb_row_1_tb_header` (logo bar) | y 50, height 132 | y 0, height 72 |
| Section `.et_pb_section_2_tb_header` (hidden menu overlay) | y 232, height 161 to 190 | y 72, height 1 |
| `#et-main-area` (the page) | starts at y 393 | starts at y 73 |

The logo bar itself is already 72 px tall at first paint (its styles are
inline in the Code module), so the 60 px of extra height on the row is Divi's
default row padding (30 px top and bottom), and the 50 px above it is Divi's
default section padding. The menu section is a `position: fixed` overlay that
takes no space, so its 161 to 190 px is the same default paddings around an
otherwise empty section.

The rules that remove all of that are:

```
.et_pb_section_2_tb_header,.et_pb_row_2_tb_header,.et_pb_code_1_tb_header{display:none!important}
.et_pb_section_1_tb_header.et_pb_section{padding-top:0px;padding-bottom:0px;...}
.et_pb_row_1_tb_header.et_pb_row{padding:0!important;margin:0!important;...}
```

and they live **only** in the deferred file
`wp-content/et-cache/<page>/et-core-unified-tb-268-tb-269-deferred-<page>.min.css`,
loaded as `<link rel="preload" as="style" onload="this.rel='stylesheet'">`.
The inline `#et-critical-inline-css` block (2.8 KB) contains none of them
(checked by grepping both for every header class). Divi's default paddings,
by contrast, are in the blocking CSS, so the browser paints the defaults first
and the overrides later.

### Measured on the live site (mobile, 412 px)

| Page | Header shift | Other shifts at load |
|---|---|---|
| Team hub (Eagles) | 0.106 | 0 |
| Player page (Hurts) | 0.352 | 0.002 |
| NFL schedule | 0.400 | 0.019 |
| Player stats | 0.000 (CSS won the race this run) | 0 |
| Fantasy Points Allowed | 0.437 | 0.017 |
| ROS rankings | 0.349 | 0 |
| RB handcuffs | 0.106 | 0.018 |
| Rookie hit rates | 0.400 | 0 |
| Strength of Schedule | 0.613 | 0.016 (page is otherwise empty, see side finding) |
| NFL depth charts | 0.400 | 0.019, then 0.451 (finding 2) |
| Matchup pair (NYG at PHI) | 0.349 | 0.007 |
| Team hub, desktop 1366 px | 0.000 | 0.0001 |

The 0.106 pages are the ones whose first content block is taller than the
viewport, so Chrome scores the header rows only; the 0.35 to 0.44 pages score
the whole content area moving. The additional 0.016 to 0.019 entries are the
same mechanism one level down: Divi's default section padding on the page's
first content section, overridden 25 px later by the deferred file.

### Proof that fixing the stylesheet fixes the shift

A saved copy of the live Eagles page was served locally (assets still from
statchasers.com) in three variants, two runs each, `narrow` mode:

| Variant | CLS run 1 | CLS run 2 |
|---|---|---|
| Baseline (as live) | 0.349 | 0.0004 (CSS won the race) |
| Deferred link turned into a normal `<link rel="stylesheet">` | 0.0004 | 0.0004 |
| Critical CSS kept, header rules added inline in `<head>` | 0.0025 | 0.0025 |

### The fix (WordPress side, no code in this repo)

**Recommended: Divi → Theme Options → General → Performance → turn
"Critical CSS" off.** Keep "Dynamic CSS" on. The deferred file this site is
splitting off is about 2 KB per page, so making it render-blocking costs
nothing measurable, and it removes the race entirely. After saving, clear
Divi's static CSS (Theme Options → Builder → Advanced → Static CSS File
Generation → Clear) and WP Rocket's cache so the `et-cache` files regenerate.

Alternatives, if Critical CSS must stay on:

- Raise **"Critical Threshold Height"** to High. Elegant Themes documents this
  as the knob for CLS from deferred styles. It is not guaranteed to pull the
  header rules into the critical block, so re-measure after changing it.
- Add the three rules above (wrapped in `@media (max-width: 980px)`) to Divi
  → Theme Options → Custom CSS, which prints inline in the head. This works
  (0.0025 in the test) but hard-codes generated class names such as
  `et_pb_section_2_tb_header`, which change if the header template is
  rebuilt. The Code module that already carries the `.sc-mobile-header-bar`
  styles inline is a more robust place for the same rules.

WP Rocket is not part of this: it is not using "Remove Unused CSS" or "Load
CSS asynchronously" on these pages (no `wpr-usedcss` block), its lazy-load
keeps width and height on every one of the 369 images on a team page, and
"Add missing image dimensions" has nothing left to add.

### Expected result

Header-caused CLS on these pages goes from 0.35 to 0.61 to under 0.01. Field
data lags: CrUX is a 28-day window, so Search Console's "Validate fix" will
take roughly a month to turn green. Re-check locally with:

```
node scripts/cls-probe.mjs https://statchasers.com/nfl/teams/philadelphia-eagles/ narrow 7000 --reload
node scripts/cls-probe.mjs https://statchasers.com/nfl/players/jalen-hurts/ mobile-fast 7000 --reload --walk
```

A run whose `excludedByInput` is large while `cls` is 0 is the emulation flag
described above, not a clean page; use `narrow` to confirm.

## Finding 2: the depth chart page builds itself after first paint

`[statchasers_depth_charts]` prints breadcrumbs, heading, intro and summary
server-side, then a `.scdc-root` containing only "Loading depth charts…", then
the crawlable 32-team link grid. `assets/js/frontend.js` boots with
`root.innerHTML = ""` and renders controls plus the chart grid into that root.
On mobile the link grid is on screen at first paint (467 px tall, starting at
y 448) and is pushed below the fold when the app arrives: **0.451**, plus
0.017 as the grid columns settle.

Fix options, in order of effort:

1. Give `.scdc-root` a `min-height` on phones that approximates the rendered
   app (the controls and first team card come to roughly 600 px at 412 px
   wide; measure once with the probe and set it, as Elegant Themes' own CLS
   guide recommends for Divi sections).
2. Move the team-links grid above the root, or render it only after the app
   so nothing visible sits below the placeholder.
3. Server-render the controls and the first view (the TS half of the tool was
   never ported; see the depth charts memory). This also fixes the "Loading"
   flash for crawlers and readers alike.

## Finding 3: small shifts in our own markup

Each of these is well under Google's 0.1 "good" line on its own and only
worth doing once the two above are in.

- **Player page peer rails** (fixed 2026-10-08: now `height="109"`). `.scp-peer-img` was emitted as
  `width="150" height="98"`, but Sleeper's thumbnails are 350 x 254 (ratio
  1.38, not 1.53). The well is a fixed 98 px on desktop, but the full-width
  `.scp-peer.is-current` card on phones grows 10 to 11 px when WP Rocket's
  lazy-load swaps the real image in. One rail per tab tail, seven on a page:
  0.002 to 0.007 each, about 0.03 over a full scroll, all counted because
  scrolling is not input. Fix: emit `width="150" height="109"` (the real
  ratio) or give the mobile well a fixed height too.
- **Team hub hero fitting.** `fit()` in `src/client/team.ts` toggles
  `data-sct-lead` and the fact-chip abbreviation stages after measuring, and
  again when fonts finish. The local harness recorded 0.0105 at load; live
  desktop recorded 0.0001 (chips moving a few pixels). Serving the final
  state, or fitting with CSS (`text-wrap: balance`, container queries) rather
  than after paint, would remove it.
- **Web fonts.** Inter, Barlow and Barlow Condensed (ours), Archivo (player
  header), DM Sans and Space Grotesk (schedule), Poppins and Abril Fatface
  (theme) all load with `font-display: swap` and no metric-matched fallback.
  OMGF already serves them from the site's own host, which is the biggest
  win; measured swap shifts were under 0.002. If they show up after the header
  fix, add `size-adjust` / `ascent-override` fallbacks (Fontaine or Capsize
  generate them) or switch the display faces to `font-display: optional`.
- **News tool background refresh.** `main.ts` replaces the whole card list
  from `/api/news` every two minutes and on tab refocus when the signature
  differs. That is a layout shift with no input whenever the SSR copy (cached
  in WordPress for minutes) differs from the API. No indexed page in the
  sitemap mounts `[statchasers_news]` today, so it is not behind the Search
  Console report, but it should not be reintroduced without reserving the
  list height.
- **API-down fallback.** Every shortcode prints an empty root when the API is
  unreachable and no backup transient exists, and the bundle then renders the
  whole tool client-side. That is a full-page shift for those visitors; the
  day-long backup transients are what keep it rare.

## Side finding: the live SOS page is empty

`https://statchasers.com/nfl/fantasy-football-strength-of-schedule/` contains
the hero and then the literal text `[statchasers_sos]` inside a Divi Code
module. No `sos.css`, no `statchasers-sos.js`, no `.scsos` markup. The
shortcode is not registered on the live site, or the merged plugin version
there predates it (the standalone SOS plugin collision in memory is the
likely history). Its CLS of 0.61 is the header shift against a page that is
only a hero and a footer; fixing the header fixes the number, but the page
needs the tool back regardless.

## Sources

- Google, "Optimize Cumulative Layout Shift": https://web.dev/articles/optimize-cls
- Google, "CSS for Web Vitals": https://web.dev/articles/css-web-vitals
- Elegant Themes, "How to fix Cumulative Layout Shift (CLS) in Divi": https://help.elegantthemes.com/en/articles/5120638-how-to-fix-cumulative-layout-shift-cls-in-divi
- Elegant Themes, "Using the Divi Theme Options" (Performance tab, Critical CSS and Critical Threshold Height): https://help.elegantthemes.com/en/articles/8626158-using-the-divi-theme-options
- WP Rocket, "Add missing image dimensions": https://docs.wp-rocket.me/article/1366-add-missing-image-dimensions
- DebugBear, "How to fix web font layout shifts": https://debugbear.com/blog/web-font-layout-shift
- Chrome Developers, "Framework tools for font fallbacks" (size-adjust, ascent-override): https://developer.chrome.com/blog/framework-tools-font-fallback
- MetricSpot, "Field Cumulative Layout Shift" (why field CLS exceeds lab CLS): https://metricspot.com/docs/field-cumulative-layout-shift/

## Fixes shipped 2026-10-07 (afternoon)

Three fixes went into the repo the same day, from a second report that
reached the same conclusions by a different route:

1. **Mobile header held still from `<head>`** (news plugin 1.10.24,
   `statchasers-assets.php`). A `<style id="statchasers-header">` block printed
   at `wp_head` priority 1 on every page repeats the header rules Divi defers:
   zero padding on the logo bar's section and row, zero padding on the section
   holding the menu overlay, and the overlay itself hidden until `.is-open`.
   Selectors use the row's custom class `sc-mobile-header-row-single` and the
   overlay's id through `:has()`, not Divi's generated numbers. Filter
   `statchasers_header_css` ('' disables). Verified on the saved Eagles page:
   0.349 became 0.0025 and 0.0004 in two runs. The Divi Critical CSS
   recommendation above still stands; this makes the pages stable either way,
   including the home and blog pages the plugin does not otherwise touch.
2. **Depth chart index reserves its height** (depth charts plugin 1.6.5).
   `.scdc-page:not(.scdc-page-team) .scdc-root { min-height: 100vh }` keeps
   the 32 team links below the fold while the browser-built grid drops in
   above them, and every image the script creates now carries width and
   height (team logos 40, chip logos 20, suggestion headshots 28, badges 14).
   Verified on the saved live index: 0.429 became 0.021 and 0.070. What
   remains is Divi's deferred padding on the page's own first section (0.019)
   and row (0.051 in one run), which only the Critical CSS setting removes.
3. **Stat leader photos sized and eager** (API, `player-stats-render.ts`).
   The three leader headshots at the top of the player stats page now carry
   `width="36" height="36"` to match the box the stylesheet already draws,
   and no longer use `loading="lazy"`, since they are in the first screen.
   They also carry `class="skip-lazy"` and `data-no-lazy="1"` so WP Rocket
   leaves them alone instead of swapping in its empty-SVG placeholder.

### Incident noticed while testing: WP Rocket served a broken stylesheet

Between roughly 16:05 and 16:25 UTC the minified copy of the player stylesheet,
`wp-content/cache/min/1/player.css?ver=1791041946`, answered HTTP 200,
`text/css`, with a 21-byte body reading `Internal Server Error`, with
`cache-control: max-age=31536000` and `cf-cache-status: HIT`. Every player page
was unstyled for that window (screenshot in the session: raw search panel,
400 px SVG icons). The API itself was serving `player.css` normally at the
same time, so WP Rocket's minifier caught a transient error from the origin
(or from its own fetch), wrote it out as the file, and Cloudflare cached it for
a year. By 16:28 the minify cache had been regenerated and the file was back
to 137 KB.

Two things follow:

- **When CSS looks wrong on the live site, check the `cache/min/1/*.css`
  body first.** The remedy is WP Rocket → Clear cache (which regenerates the
  minified files) plus a Cloudflare purge of the old URL.
- **The `?ver=` on those files is WP Rocket's, not the API's.** An API deploy
  with new CSS is not seen by WordPress until WP Rocket's cache is cleared,
  because the minified copy keeps its own version stamp. Excluding the API
  origin from "Minify CSS files" (File Optimization → Excluded CSS Files, or
  the `rocket_exclude_css` filter) removes both problems, at the cost of about
  15 to 20 KB more CSS per page over the wire unless the API starts minifying
  its own stylesheets (team.css is 461 KB raw, 200 KB minified, roughly 50 KB
  against 33 KB gzipped). That is a trade-off for mak to call; nothing was
  changed.

## Fix shipped 2026-10-08: the headshot is no longer lazy-loaded

A follow-up report put the player pages at 0.117 with `.scp-pid` (position,
team and name under the headshot) as the shifting element, and blamed WP
Rocket's LazyLoad on the headshot: the live tag came out as
`<img class="scp-pwell-img" src="data:image/svg+xml,..." data-lazy-src="..."
fetchpriority="high">`, so the high-priority fetch could not start until
Rocket's script ran. That rewrite was confirmed on the live Josh Allen page.

What was shipped:

1. **API** (`src/lib/player/header.ts`): the headshot prints
   `loading="eager"` and `data-no-lazy="1"`. Rocket's LazyLoad skips a tag
   carrying either by default, as do the other lazy-load plugins that honor
   `data-no-lazy`.
2. **API** (`public/player.css`): `.scp-pwell-img` gets
   `aspect-ratio: 350 / 254` with `object-fit: contain` anchored to the
   bottom, so the box is the attributes' ratio whatever file or placeholder
   is in it. The well itself already had a `min-height` (236 px, 180 on
   phones) and both figure and jersey number are absolutely positioned, so
   nothing in the well can push `.scp-pid` in the first place.
3. **News plugin 1.10.29** (`statchasers-player.php`): the
   `rocket_lazyload_excluded_attributes` filter adds `class="scp-pwell-img"`
   and `fetchpriority="high"` to Rocket's skip list, which covers fragments
   cached before the API change and any other above-the-fold image the tools
   mark high priority. Purge Rocket after installing.
4. **API** (`src/lib/player-render.ts`): the peer-rail photos declare
   `width="150" height="109"`, the derivatives' real 350x254 ratio, instead
   of the well's 98 px height (Finding 3, first bullet). Same deploy as 1
   and 2.

What the lab says: `cls-probe.mjs` on the live page before the change, in
`narrow` mode and in throttled `mobile` mode, found no shift on `.scp-pid`
or on the well at all. `narrow` recorded 0.021 (0.0165 of it the
`#content-area` Divi shift from Finding 1, 0.0048 the Archivo swap on the
jersey number and name); `mobile` recorded 0.0048 (the swap only). The
0.117 is therefore most likely the field figure, which is a 28-day window
and still carries the header shift that 1.10.24 fixed on 10-07. The
lazy-load fix is right on its own merits (the LCP image should never wait
for a script) but is not expected to move the field number by itself; the
field number should fall as the window rolls past 10-07.

Side observation: the bare dev page (`/player/<slug>` on the API, no
WordPress) shows a 0.056 shift of `.scp-phead` moving down 68 px at font
load time, identical before and after this change. It does not appear on the
live page and was left alone.
