# Player pages on phones: layout shift, blocking time, DOM size (2026-11-27)

Branch `fix/player-mob-2026-11-27` (base main 401e3618 = production build ebb0c4d6 plus a docs commit; plugin 1.10.76 live).
Item 4 of the player-page audit re-check (WEB-044 / WEB-048 / WEB-052 / WEB-030).
Status words: "verified in production (read-only)" or "verified locally (production shell)". Nothing was deployed, pushed, purged or written to WordPress. The plugin version is not bumped.

## Summary

- **Cause of the phone CLS (measured, production):** WP Rocket's "Load CSS asynchronously" rewrites `news.statchasers.com/player.css` into `<link rel=preload ... onload="this.rel='stylesheet'">`. Until it applies, the player header is laid out by Rocket's inline critical CSS for the template, which carries the desktop three-column hero grid (`minmax(220px,20%) minmax(0,1fr) minmax(300px,27%)`) and not the phone override. At 390px that squeezes `.scp-pid` (name, tags, spec) to a **0px column** and makes the hero 930-1,010px tall. When player.css lands the hero collapses to 162-263px and everything under it moves up: `.scp-pid`, `.scp-pp-cards`, the tab strip and `section#overview` are the shifted nodes. **0.18 on the Gibbs hub, 0.68-0.70 on a thin profile, every load measured on production today.**
- **Second, small shift (0.008, every phone load):** the same critical CSS is stale: it still has `.scp.scp.is-embed>.scp-search[hidden]+.scp-phead{margin-top:0!important}`, which player.css dropped on 11-20. Inline in `<head>` it outlives player.css, so the header sits 8px high until the player script reveals the search box, then the page drops 8px.
- **Fix:** player.css and the player bundle load from the WordPress origin with the WEB-023 local-asset pattern, excluded from Rocket's async rewrite, so the header paints once, in its final layout; the asset-host fallback is excluded from the async rewrite too. The fragment's inline `#scp-host-header` style restates the 8px phone margin over the stale critical rule.
- **Result (production shell, 3 runs each, same conditions):** CLS 0 on every run for both players (worst 0.002 counting emulation-flagged shifts). TBT median Gibbs 689 -> 327 ms, Large 170 -> 117 ms. **Cost: first paint is later** (FCP median 688 -> 1,668 ms Gibbs, 572 -> 1,668 ms Large under slow 4G), because the page now waits for player.css; Gibbs LCP is unchanged (2,068 -> 2,060), Large LCP 824 -> 2,000 ms because its "before" LCP was the giant jersey number painted in the broken state. A decision for mak (see Open).
- **Duplicates:** no table, card or FAQ is printed twice for desktop and mobile on the hub or any tab. The header has phone and desktop variants of its identity lines and start/sit link (about 23 phone-only elements); left as they are (reasons below). DOM unchanged by this branch: Gibbs 5,066 elements live (6,589 before the 11-26 trim, so that trim is live), Large 870.

## Environment (every number below)

- Headless Chromium 155 over raw CDP (`/repl/tools/bin/chromium`); no Lighthouse or Puppeteer in node_modules, so **TBT is computed from `longtask` entries**: sum of (duration - 50 ms) for tasks starting after FCP, until load + 6 s. LCP from `largest-contentful-paint`, CLS from `layout-shift` entries with sources (session windows: 1 s gap, 5 s cap), DOM = `document.getElementsByTagName('*').length` at the end.
- Phone: 390x844, DPR 2, `mobile: true`, iPhone Safari 17.5 UA, **no touch emulation** (with it, Chrome flags every shift as `hadRecentInput` and hides them; first run showed 0.70 flagged, 0.0016 counted). Throttle: 4x CPU, 150 ms RTT, 1.6 Mbps down / 750 kbps up (Lighthouse "slow 4G"). Cold cache: a fresh profile per run, HTTP cache disabled. Settle: load + 6 s, no scrolling, no input.
- "CLS" = Chrome-counted. "CLS all" also counts shifts Chrome flagged `hadRecentInput`; there is no real input in these runs, so a flag is the emulated viewport, and the field would count them. Both are reported.
- Scripts (outside the repo): `/home/runner/workspace/.local/pa1127/shots/mob/lab.mjs` (runs), `shell.py` (shell builder), `cls.py` (CLS with/without the flag), `domaudit.mjs` (width-exclusive markup), `a11y.mjs` (rendering, overflow, keyboard). JSON per run and screenshots in `.local/pa1127/shots/mob/final/`.
- Live page loads were spaced at least 3 s apart (each run takes ~10 s): 9 direct loads per player in total today.

### Production shell (before/after comparable)

Live HTML of `/nfl/players/jahmyr-gibbs/` and `/nfl/players/hayden-large/` fetched once each (iPhone UA). The navigation request is answered with that HTML with the player root (from `<style id="scp-host-header">` to the root `</div>`) replaced by the local fragment `/embed/player/<slug>?h1=1` from port 8093; everything else (Divi, theme, customizer, Rocket critical CSS, fonts, images) loads from production. Through CDP `Fetch.fulfillRequest`, with fixed delays standing in for the network (fulfilled responses bypass the throttle): document 300 ms, player.css 1,100 ms, player bundle 600 ms, **identical for before and after**. 1,100 ms matches the live runs (player.css finished 1.1-1.6 s after it was requested; a same-origin file of similar size, the 48 KB Inter woff2, took 1.1 s), so the after FCP is not flattered by a faster stylesheet.

- **before**: root = fragment from the base build (same version hash f536c12442fa as production; player.css and bundle byte-identical to `news.statchasers.com/player.css?ver=f536c12442fa`), head unchanged (Rocket's async preload of player.css).
- **after**: root = this branch's fragment; the async preload replaced by `<link rel='stylesheet' href='https://statchasers.com/wp-content/plugins/statchasers-news/assets/api/player.css?...'>` and the bundle URL pointed at `assets/api/dist/`, which is what the plugin change prints when the bundled copy is current.
- Caveats: the local fragment's headshot uses a relative image path that does not load in the shell (its box is sized; alt text shows in the screenshots), and Rocket's lazyload rewrite of below-the-fold images is absent from the local fragment, hence 4,746 vs 5,066 elements. Both apply to before and after alike.

## Before / after (phone 390, slow 4G, 4x CPU, cold)

### Jahmyr Gibbs hub (high volume)

| Run | CLS | CLS all | FCP ms | LCP ms (element) | TBT ms | DOM |
|---|---|---|---|---|---|---|
| Live 1 | 0.1845 | 0.1845 | 548 | 2,420 (h2 weekly) | 334 | 5,066 |
| Live 2 | 0.1845 | 0.1845 | 672 | 2,760 (h2 weekly) | 634 | 5,066 |
| Live 3 | 0.1845 | 0.1845 | 696 | 2,524 (h2 weekly) | 497 | 5,066 |
| **Live median / worst** | **0.18 / 0.18** | 0.18 / 0.18 | 672 / 696 | 2,524 / 2,760 | **497 / 634** | |
| Shell before 1 | 0 | 0.8258 | 688 | 2,108 (chart caption) | 689 | 4,746 |
| Shell before 2 | 0.3195 | 0.3195 | 776 | 2,068 (h2 weekly) | 361 | 4,746 |
| Shell before 3 | 0 | 0.8258 | 652 | 2,020 (chart caption) | 920 | 4,746 |
| **Before median / worst** | **0 / 0.32** | **0.83 / 0.83** | 688 / 776 | 2,068 / 2,108 | **689 / 920** | |
| Shell after 1 | 0 | 0 | 1,656 | 2,060 (h2 weekly) | 344 | 4,746 |
| Shell after 2 | 0 | 0 | 1,668 | 2,016 (h2 weekly) | 327 | 4,746 |
| Shell after 3 | 0 | 0.0020 | 1,728 | 2,176 (h2 weekly) | 270 | 4,746 |
| **After median / worst** | **0 / 0** | **0 / 0.002** | 1,668 / 1,728 | 2,060 / 2,176 | **327 / 344** | |

### Hayden Large (thin profile)

Chosen because he is the thinnest profile that has a page: rookie TE on IR, no games, 870 elements live (Gibbs 5,066), no Game Log table or weekly chart data; also measured on 11-26, so the two docs compare. A backup TE as the brief suggested.

| Run | CLS | CLS all | FCP ms | LCP ms (element) | TBT ms | DOM |
|---|---|---|---|---|---|---|
| Live 1 | 0.6791 | 0.6968 | 468 | 676 (jersey number) | 173 | 870 |
| Live 2 | 0.6977 | 0.6977 | 796 | 1,324 (jersey number) | 548 | 870 |
| Live 3 | 0.6791 | 0.6968 | 496 | 704 (jersey number) | 200 | 870 |
| **Live median / worst** | **0.68 / 0.70** | 0.70 / 0.70 | 496 / 796 | 704 / 1,324 | 200 / 548 | |
| Shell before 1-3 | 0.7757 x3 | 0.7757 x3 | 572 / 788 / 560 | 824 / 944 / 764 (jersey number) | 172 / 129 / 170 | 865 |
| **Before median / worst** | **0.78 / 0.78** | 0.78 / 0.78 | 572 / 788 | 824 / 944 | 170 / 172 | |
| Shell after 1-3 | 0 x3 | 0 x3 | 1,848 / 1,668 / 1,624 | 2,160 / 2,000 / 1,936 (h2 weekly) | 117 / 287 / 105 | 865 |
| **After median / worst** | **0 / 0** | 0 / 0 | 1,668 / 1,848 | 2,000 / 2,160 | 117 / 287 | |

Earlier runs today with an rAF sampler in the page (used to find the cause, below) gave Gibbs live 0.0079-0.1855 and Large live 0.0079-0.049; the sampler forced a layout per frame, which shifted the race and inflated TBT (up to 2,862 ms), so those runs are not in the tables. Whether a given load shifts is a race between first paint and player.css; on today's production it shifted on 6 of 6 sampler-free loads.

Target CLS <= 0.10 on every run: met by the after build on all 6 runs (worst 0.002 counting flagged shifts). The before shell's Gibbs runs 1 and 3 show 0 "counted" only because Chrome flagged the big early shift as input-adjacent (emulated viewport); a real phone counts it.

## Trace findings (what moves, what arrived before)

Gibbs, production, per-frame sample of `.scp-pid` and the hero (sampler run `live/gibbs-f1.json`):

| t (ms) | `.scp-pid` [x, y, w, h] | hero height | player.css applied | event |
|---|---|---|---|---|
| 783 | 249, 114, **0**, 855 | 994 | no | first paint with Rocket critical CSS; family "Open Sans" |
| 1,964 | | | | `news.statchasers.com/player.css` response end (requested at 389) |
| 1,981 | 249, 114, 0, 874 | 1,013 | no | Inter woff2 in (1,899): text reflows in the 0px column |
| 2,374 | 150, 142, 224, 39 | 263 | **yes** | onload swapped rel to stylesheet; shift **0.175**: `.scp-pid`, `ul.scp-pp-cards`, `.scp-phead-last`, tab strip `li`s |
| 2,525 | 150, 150, 224, 39 | 263 | yes | player bundle ran (2,035 in), search box revealed; shift **0.008**: hero 113 -> 121, `section#overview` 432 -> 440 |
| 2,714 | | | | Archivo woff2 in (requested 2,585, i.e. when player.css first used the face); 0.0016 swap shift on `.scp-pspec-i` and the board numerals |

With player.css blocked entirely (`live/gibbs-nocss.png`) the page is unusable (the 0px column, the silhouette at full width), which confirms Rocket's critical CSS does not cover the phone header.

The 8px: at 2,525 `.scp-search` loses `hidden`; `.scp-phead` margin-top goes 0 -> 8px (computed). The only rule that zeroes it is the stale critical one quoted above (position 77,920 of the live HTML); player.css no longer has it (11-20, docs/PLAYER-GAMELOG-CLS-2026-11-20.md).

Rocket critical CSS vs current player.css: 321 `.scp` rules in the critical block, 16 with selectors no longer in player.css, four of them `!important` (the margin rule, `.scp .scp-ptag-team{color:inherit}`, `.scp .scp-phead a.scp-ptag-team{color:#fff;...}`, `#news .scp-up-dek{display:none}`). Only the margin one moves anything.

Long tasks (after shell, Gibbs, CDP trace, sampler off): HTML parse 60 + 131 ms, the player bundle's evaluation 190 ms (4x CPU) plus a 149 ms layout after it, and style/layout passes of 80-120 ms each. The async swap's second full style recalc and layout of ~4,700 elements is gone after the fix, which is the TBT drop. What remains is mostly parse and layout of the six hidden tab panels the hub ships (11-26's pending product call, not changed here).

## What changed

1. `wordpress-plugin/statchasers-news/statchasers-local-assets.php`: `statchasers_player_asset_urls()` (same shape as the FPA/SOS/team functions, filter `statchasers_player_local_assets`), `/player.css` added to `statchasers_local_asset_stylesheets()`, so the bundled copy is excluded from Rocket minify, async CSS and RUCSS. Lockstep rule unchanged: the copy is used only when it is the API's current build or byte-identical to the live file, else the asset host.
2. `wordpress-plugin/statchasers-news/statchasers-player.php`: the player handle registers `$urls['css']` / `$urls['js']`; deps (Inter + Archivo), defer, inline styles unchanged. New `statchasers_player_async_css_exclusion()` adds `<asset host>/player.css` to `rocket_exclude_async_css` so the fallback (an API deploy that changed player.css after the zip was built) is not async either.
3. `wordpress-plugin/scripts/build-zip.sh`: copies `css/player.css` and `statchasers-player.js` into `assets/api/`, names them in the manifest, checks them in the zip by sha256.
4. `wordpress-plugin/tests/smoke-local-assets.php`: a player group (four-file manifest stays remote, six-file manifest goes local, filter off, changed-css fallback, Rocket exclusions name `/assets/api/player.css`, bundle tag keeps defer + nowprocket, player.php registers the URLs and the fallback exclusion).
5. `artifacts/api-server/src/lib/player-render.ts`: `HOST_HEADER_STYLE` gains `@media (max-width:560px){.scp.scp.is-embed>.scp-search[hidden]+.scp-phead{margin-top:8px!important}}` (+100 bytes per fragment). No markup, text, H1, title, meta, JSON-LD or FAQ change.

player.css and the bundle are byte-identical to production; the header keeps its compact phone layout (hero 263px at 390, 267 at 320), no space reserved.

## Duplicate markup (step 3)

Method: `domaudit.mjs` renders the hub (production shell) at 390 and 1280 and lists elements inside the player root rendered at one width and not the other; plus a table census of the hub and all six tab fragments.

- Tables: hub 3 (career, Game Log weeks, Bio key facts), Stats 1, Game Log 2; all different data, none width-gated. FAQ: one block per page. No card or table has a desktop and a mobile copy.
- Width-exclusive markup on the hub: 23 phone-only and 105 desktop-only elements of 4,401 in the root. Phone-only: `.scp-pm-meta-1/2/3` ("Lions · RB · Active", "24 yrs · 5'9" · 202 lbs", "Alabama"), `a.scp-pm-fp` ("Should I start Gibbs?"), `.scp-pm-season`, a team mark. Their desktop counterparts (`.scp-ptags`, `.scp-pspec`, `.scp-pp-actions`) carry more (full team name, season count, draft, the outlook link), so they are not equal copies. Desktop-only otherwise: decoration (stripes, icons, banner art), the next-matchup strip and the fantasy board (both removed on phones by mak's 11-05 brief), the chart's in-plot values.
- **Not changed:** merging the identity lines would restyle mak's header (11-15 "leave the header as is") for about 20 elements, and the start/sit link pair belongs to item 5. Nothing removed; DOM change from this branch 0 (Gibbs 4,746 -> 4,746, Large 865 -> 865 in the shell).

## Rendering, accessibility, overflow (after shell, Gibbs)

- 390 / 320 / 1280: document width = viewport at each (390 / 320 / 1280), no horizontal overflow. Phone header margin 8px at 390 and 320, 16px at 1280 (unchanged from player.css). Screenshots: `final/a11y-gibbs-after-390.png`, `-320.png`, `-1280.png`, `-390-stats-tab.png`.
- Keyboard at 390: Tab order skip link, logo, menu, search, team link, start/sit link, then the tab strip (one stop, the active Overview tab: roving tablist); ArrowRight moves to "Stats" (`role=tab`, 3px solid focus outline plus 2px ring); Enter shows the Stats panel and updates the URL. Every focus stop inside the player root showed a visible focus style. The seven tabs are real links.
- Server-rendered content, headings, links and tables unchanged (fragment differs only in the inline style).

## Tests (verified locally)

- `tests/player.test.mjs` 153/153, `player-header` 23/23, `player-entity-seo` 9/9, `player-faq-schema` 4/4 (`env -u INGEST_SECRET node --test --test-concurrency=1`). `tsc --noEmit` clean.
- PHP 8.4 (php-with-extensions): `tests/smoke-local-assets.php` all passed (new player group), `tests/smoke.php` all passed; `php -l` clean on both edited plugin files. `build-zip.sh` not run (it would stage assets; `bash -n` clean).
- `data/schedule/espn-layer-2026.json` rewritten by the tests was reverted.

## For the plugin owner (mak): shared asset move

- **Asset move:** player.css (384,005 B, ~63 KB gzipped) and `dist/statchasers-player.js` (32,008 B) will be served from `wp-content/plugins/statchasers-news/assets/api/` on every player page (profile, every tab, the player index) once a zip built by this `build-zip.sh` is installed. Same lockstep and fallback as team/FPA. Before release: build the API from the deployed commit, build the zip, purge WP Rocket (mobile too) then Rocket.net edge, and read one player page with an iPhone UA: the player.css tag should be `rel='stylesheet'` with an `assets/api/` URL and no `data-rocket-async`.
- **Unverified on production:** that Rocket honors the host-path pattern `news.statchasers.com/player.css` in `rocket_exclude_async_css` for the fallback (the local `/assets/api/` pattern is the one team/FPA already rely on). Check the fallback once after an API deploy that changes player.css.
- **Merge note:** `statchasers-local-assets.php`, `build-zip.sh` and `smoke-local-assets.php` are also edited by the SOS (`fix/sos-web023-assets-2026-11-27`) and depth-chart WEB-023 branches; the hunks merge by union (add each tool's files to the lists).

## Open

1. **mak: the FCP trade.** Render-blocking player.css moves first paint from ~0.6 s to ~1.7 s in this lab (slow 4G), in exchange for CLS 0.18-0.78 -> 0 and lower TBT; Gibbs LCP unchanged, thin-profile LCP 0.8 -> 2.0 s (its old LCP was the broken first paint). In the field the same-origin copy should arrive sooner than the 1.1 s modeled (no second connection). A follow-up that would recover most of the FCP: the API emits its own small critical stylesheet for the header and tab strip, printed inline by the plugin, with player.css async again; not built here.
2. **mak (WordPress, not done):** regenerate WP Rocket's critical CSS for the player template (WP Rocket -> File Optimization -> Regenerate critical path CSS). It is older than 11-20 and goes stale with every player.css change; once player.css is blocking it only matters through its `!important` rules (the margin, two team-tag colors, the News dek).
3. Hidden tab panels on the hub (~3,400 of Gibbs' elements) are the remaining TBT and DOM lever: 11-26's pending product decision.
4. Production lab run after release with this same script and settings.
