# Player pages: fantasy-profile links and Game Log filters (re-check, 2026-11-27, item 5)

Branch `fix/player-lnk-2026-11-27` (worktree `.local/pa1127/lnk`), based on main `401e3618`. Production at the time
of the checks: plugin 1.10.76 + API build `ebb0c4d6` (this base minus a docs commit). Findings re-checked: WEB-017 /
WEB-025 (Redraft player-shell links) and WEB-020 (`?log=` Game Log variants), plus the 4927/4929 duplicate-page
regression check. Background: `docs/WEB-012-005-020-008-017-025-029-022-PLAYER-2026-11-26.md` sections 2-4,
`docs/PLAYER-AUDIT-INTEGRATION-2026-11-26.md`.

Environment labels used below:

- **live**: read-only requests to production on 2026-11-27 between 12:15 and 12:45 UTC, browser UA, at least 3 s
  apart (curl), or headless Chromium (post-JS DOM; one page load at a time).
- **local**: this branch, `node ./build.mjs`, standalone app on port 8094 or the test helper's server.
- **source**: `statchasersff-bit/redraft-command` at `d1cf265` (2026-11-27 06:57 -0500), shallow clone, read only.

Nothing was published, pushed, purged or written to WordPress. No plugin version bump.

## 1. Fantasy-profile links (WEB-017, WEB-025)

### Original evidence (11-26)

The Gibbs hub linked nine times to `https://statchasers.com/redraft-command/players/9221`, which answered 200 with
`X-Robots-Tag: noindex, follow` and rendered as an empty app shell. Released 11-26 (1.10.74): the nine links were
replaced by the start/sit page `https://statchasers.com/redraft-command/who-should-i-start/<our slug>` or removed.

### How the ids map (source + code)

- Our player record carries the Sleeper id (`players.json` `id`, e.g. Gibbs `9221`). Redraft's app profile route is
  `/players/:playerId` (client/src/App.tsx), the Sleeper id, rendered client-side inside the Command Center shell
  (`PlayerPage embedded`). `shared/publicPages.ts`: every `/redraft-command/*` route is noindex by design; the
  generated public player pages (`/fantasy-football/players/`) are switched off (`PLAYER_PAGES_INDEXED = false`).
- The start/sit route is `/who-should-i-start/:slug`; the slug is `slugifyPlayerName(Sleeper full_name)`
  (shared/playerSlug.ts), with `-<sleeperId>` appended for ambiguous names. Our API builds the link from our own slug
  (`STARTSIT_BASE` + slug in `header.ts`, `faq-pools.ts`, `injury-tab.ts`). All 676 player slugs in Redraft's
  start/sit sitemap are our slugs, spelled identically (live, 12:15 UTC).
- Which start/sit URLs exist (source, shared/startSitIndexPolicy.ts and startSitShellData.ts): Apache serves a
  prerendered shell for every player Sleeper has on a roster; anything else is a 404. Of those, the indexable set
  (projected this week, bye, ruled out, or search evidence) is exactly the sitemap; the rest are 200
  `noindex,follow` pages for "a deep reserve whose page can only say updating".
- `redraftPlayerUrl()` (`src/lib/player/redraft-link.ts`) still exists; its only caller is the Injury tab model's
  unused `rc` field, which renders nowhere (unchanged).

### What reproduces now (live, 2026-11-27)

| URL | Status | Robots | Canonical | Identity / content |
|---|---|---|---|---|
| `/redraft-command/players/9221` (Gibbs) | 200, 10,439 B shell | header `X-Robots-Tag: noindex, follow`; raw meta `index,follow`; post-JS meta `noindex,follow` | post-JS self | Post-JS (Chromium, 15 s budget): **populated** - Jahmyr Gibbs, RB DET, value 9.7k, #1 / RB1, Week 12 vs CHI, game log, ratings, ROS schedule, injury history, trades. Raw HTML title "Fantasy Football Decision Intelligence", no player content. |
| `/redraft-command/players/13302` (Adam Randall, less prominent) | 200 | same | self | Post-JS: identity + matchup; value/rank all "-" (thin). |
| `/redraft-command/players/96` (Aaron Rodgers) | 200 | same | self | Post-JS: populated, but "QB - Free Agent"; its own "Should I start Rodgers week 12?" button points to a 404 (below). |
| `/redraft-command/players/99999999` (no such player) | 200 | header noindex | self | Post-JS: only "Return" - a soft 404. |
| `/redraft-command/who-should-i-start/jahmyr-gibbs` | 200 | `index,follow` | self | "Should I Start Jahmyr Gibbs in Week 12?", START, 25.6 proj vs CHI (shell data id 9221). |
| `/redraft-command/who-should-i-start/adam-randall` | 200 | `index,follow` | self | Adam Randall (13302), SIT, 0.3 proj @ HOU. |
| `/redraft-command/who-should-i-start/aaron-rodgers` | **404** | `noindex,follow` | - | "Page Not Found". Our Rodgers hub printed **6** links to it. |
| `/redraft-command/who-should-i-start/tyson-bagent` | 200 | **`noindex,follow`** | self | Bagent (11256), no projection. Hub printed 6 links. |
| `/redraft-command/who-should-i-start/myles-white` | 200 | **`noindex,follow`** | self | Myles White (3050), no projection. |
| `.../justin-fields`, `.../cedric-tillman`, `.../odell-beckham-jr` | 200 | **`noindex,follow`** | self | no projection |

Hub counts (live): Gibbs hub 6 hrefs to his start/sit page, 0 to `/redraft-command/players/`; Rodgers hub 6 hrefs to
the 404 start/sit page; Gibbs `/game-log/` 2.

Scale (live sitemaps vs repo data): of the 648 player profiles in Rank Math's page sitemaps, about 556 are rostered
and not on IR/PUP/NFI/suspended (the header's own gates); 51 of them were not in Redraft's start/sit sitemap, i.e.
linked to a 404 or a noindex "updating" page (list in the commit's test notes: aaron-rodgers, tyson-bagent,
justin-fields, myles-white, nick-williams, brandon-johnson, odell-beckham-jr, ...).

### Decision

- **A populated per-player app profile does exist now** (it did not render on 11-26): Gibbs is rich, a deep reserve
  is thin, an unknown id is a soft 404, and the page is noindex by design, client-rendered only (raw HTML has no
  player content). It is not linked back: 11-26 chose the start/sit page as the fantasy CTA (one weekly decision,
  indexable, server-rendered), and reintroducing a link to a noindex app page is a product call for mak, not a
  fix. If mak wants it, the id is already on every record (`player.id`); a stored list of ids Redraft knows would be
  needed because unknown ids answer 200.
- **Start/sit links now require a populated page, from stored data.** `data/player/startsit_pages.json` (676
  slugs) is built by `scripts/player/buildStartSitPages.mjs` from Redraft's own sitemap (one request; `--file` for a
  saved copy), committed, and read once per process. No request at render. Every start/sit link on a player page
  goes through `startSitPageUrl()` in `header.ts`, which returns "" when the slug is not on the list:
  header gold button (desktop + phone), Stats card, Outlook card, Bio card, Overview FAQ "Should I start X in Week
  N?" link, Injury FAQ "Should you start him?" link. The FAQ question and answer stay; only the link drops.
- **No week to start him in** (unchanged and verified local): IR/PUP/NFI/suspended, no team, no upcoming game or
  before Week 1 -> `startSitHref()` returns "" (header button, Stats/Outlook/Bio cards omitted). Bye: the header
  shows "Week N: bye. Then ..." and keeps the button; Redraft's bye page is indexable and says bye, so the link
  is correct. An IR player on the list (e.g. Gardner Minshew II, local) keeps only the Overview FAQ link
  "Get the start/sit call", whose answer already says he is on IR, pointing at an indexable page that says so.
- The list goes stale weekly (projections, byes and rosters move). Rerun the builder with the weekly refresh after
  Redraft's snapshot publishes (documented in `scripts/player/README.md`, step 14). A player missing from a stale
  list just loses the link for a week; a player cut after the build could 404 until the next run.

### Sample (local render after the fix; live destinations above)

| Player | Sleeper id | Redraft profile (live) | Start/sit page (live) | Start/sit links on our page before -> after (local) |
|---|---|---|---|---|
| Jahmyr Gibbs | 9221 | populated, noindex | 200 index | hub 6 -> 6; stats 3; injury 3 |
| Adam Randall (less prominent) | 13302 | thin, noindex | 200 index | hub 4 (on list, kept) |
| Aaron Rodgers | 96 | populated, "Free Agent" | **404** | hub 6 -> **0** |
| Tyson Bagent | 11256 | n/c | 200 **noindex** | hub 6 -> **0** |
| Kenneth Walker (WR, FA) | 4634 | n/c | n/c | 0 -> 0 (no team) |
| Gardner Minshew II (IR) | - | n/c | on list | header 0 (IR); FAQ 1 |

## 2. Game Log filters (WEB-020)

### Inventory of query parameters on WordPress player URLs (code: `statchasers-player.php`, `statchasers-player-pages.php`, API `routes/player.ts`)

| Parameter | What it does now | Linked anywhere? |
|---|---|---|
| `log=YYYY` | Not read for rendering. The plugin normalizer 301s any `/nfl/players/<slug>/[tab/]?log=YYYY` (19xx/20xx) to `/game-log/#log=YYYY`; an unreadable value is dropped (301 to the clean URL). The fragment endpoint `wp-json/statchasers/v1/p/embed/player/<slug>?section=game-log&h1=1&log=YYYY` renders a season (`X-Robots-Tag: noindex`). | No (0 hrefs live) |
| `#log=YYYY` | Client state: opens that season, written with `replaceState`, cleared for the current season; an unknown season is ignored and cleared. Not sent to the server. | Matchup FAQ links use `game-log/#log=<season>` |
| `format=half|std` | Rendered (different numbers), canonical to the clean URL, robots index. `robots.txt` disallows `/nfl/*?format=`. | No (`data-format` attributes only) |
| `adv=YYYY` | Still read by the plugin and sent to the API, which ignores it since 2026-09-30 (Advanced section deleted). Same page, own cache key, canonical clean. | No |
| `section=` | Query fallback for the tab; closed list. | No |

### URL matrix (live, 12:19 UTC, `jahmyr-gibbs`)

| URL | Status | Location / canonical | Robots |
|---|---|---|---|
| `/nfl/players/jahmyr-gibbs/game-log/` (the indexable Game Log page) | 200 | canonical self | `index, follow`; in page-sitemap (1x) |
| `/nfl/players/jahmyr-gibbs/?log=2025` | 301 | `/game-log/#log=2025` (one hop) | - |
| `/nfl/players/jahmyr-gibbs/game-log/?log=2025` | 301 | `/game-log/#log=2025` | - |
| `/nfl/players/jahmyr-gibbs/game-log/#log=2025` | same request as the clean URL (fragment not sent); post-JS shows 2025 | canonical clean | index |
| `/nfl/players/jahmyr-gibbs/game-log/?log=abc` | 301 | `/game-log/` | - |
| `/nfl/players/jahmyr-gibbs/game-log/?log=1999` | 301 | `/game-log/#log=1999`; the client ignores and clears it (local + 11-26 JSDOM test) | - |
| `/nfl/players/jahmyr-gibbs/game-log/?format=half` | 200 | canonical `/game-log/` | index (robots.txt blocks crawl) |
| `/nfl/players/jahmyr-gibbs/game-log/?adv=2024` | 200 | canonical `/game-log/` | index |
| fragment endpoint `...embed/player/jahmyr-gibbs?section=game-log&h1=1&log=2025` | 200 | - | `X-Robots-Tag: noindex`; `data-scp-log-shown="2025"` |

Counts (live): `?log=` / `&log=` in the Gibbs hub HTML 0, in `/game-log/` 0, in Rodgers hub (18 seasons of buttons)
0; `<loc>` with `log=` or `?` in page-sitemap1-4: 0. Season controls are `<button data-season aria-pressed>`
(Gibbs hub 9 buttons, Rodgers 37). No crawlable filter combination is generated.

`robots.txt` (live) disallows `/nfl/*?log=` and `/nfl/*&log=`. That stops Googlebot fetching old `?log=` URLs, so it
never sees their 301 to the clean page; those URLs drop out on their own but pass no signals. **Needs mak:**
either keep (simplest) or lift the two `log=` lines so Google follows the 301s. Not changed.

### Keyboard and mobile (Chromium over CDP, real key events: Tab, Enter, Space)

| Where | Width | Result |
|---|---|---|
| live `/nfl/players/jahmyr-gibbs/game-log/` | 1280 | Tab x36 reaches the 2025 chip; Enter -> table re-renders (first row "GB ... L 13-27"), hash `#log=2025`, `aria-pressed` moves, focus stays on the 2025 chip. Tab x1 -> 2024, Space -> `#log=2024`. Reload -> 2024 restored. Navigate to `/stats/` then back -> `#log=2024`, 2024 shown. Space on 2026 -> hash cleared, 2026 shown. No horizontal scroll (1265/1265). 0 `log=` hrefs throughout. |
| live, same URL | 390 (mobile emulation) | Chips hidden, phone menu: Tab x14 to the menu's summary, Enter opens it, Tab x2 to 2025, Space -> `#log=2025`, menu closes, reload and back keep it, no horizontal scroll (390/390). **Defect: after a pick, focus fell to `<body>`**, so the next Tab restarted from the top of the page. |
| local (this branch), 1280 | 1280 | as live (Tab x14 on the standalone page). |
| local (this branch), 390 | 390 | after a Space or Enter pick, focus is on the menu's summary (`SUMMARY.scp-glp-yr-btn`), the new season's option is `aria-pressed="true"`, hash written; reload/back as live. |

Fix: `src/client/player.ts` `swapSeason()` - when the pick came from the phone menu, the scroll anchor and the
restored focus are the fresh root's menu summary (the option is hidden once the menu closes). Also the chip strip's
`<nav aria-label>` read "Game log seasons (new design)" (a comparison-era leftover announced by screen readers); now
"Game log seasons" (`gamelog-premium.ts`).

## 3. Regression check: duplicate WordPress pages 4927 and 4929 (live, 12:19-12:20 UTC)

| Check | Result |
|---|---|
| `https://statchasers.com/?page_id=4927` | 404, "Page not found", `follow, noindex` |
| `https://statchasers.com/?page_id=4929` | 404, same |
| `page-sitemap1.xml` .. `page-sitemap4.xml` (4,556 `<loc>`) | 0 duplicate `<loc>`; `tyson-bagent` profile and each of its 6 tabs listed once; `dandre-swift` the same; no `-2` slugs, no `page_id`, no `log=` |

Pass. Alias-slug policy not touched.

## 4. Changes (commit on `fix/player-lnk-2026-11-27`)

| File | Change |
|---|---|
| `artifacts/api-server/scripts/player/buildStartSitPages.mjs` (new) | Builds the list from Redraft's start/sit sitemap; refuses to write fewer than 100 |
| `artifacts/api-server/data/player/startsit_pages.json` (new) | 676 slugs, from the live sitemap fetched 2026-11-27 12:15 UTC |
| `artifacts/api-server/src/lib/player/data.ts` | `hasStartSitPage()`; file joins `dataStamp()` so a rebuilt list invalidates the render cache |
| `artifacts/api-server/src/lib/player/player-data.ts` | `PlayerPageData.startSitPage` (absent in hand-built test states = not gated) |
| `artifacts/api-server/src/lib/player/header.ts` | `startSitPageUrl()`; `startSitHref()` uses it (function body only, no markup change) |
| `artifacts/api-server/src/lib/player/faq-pools.ts`, `injury-tab.ts` | FAQ start/sit links through `startSitPageUrl()`; one line each |
| `artifacts/api-server/src/client/player.ts` | phone-menu focus after a season swap |
| `artifacts/api-server/src/lib/player/gamelog-premium.ts` | `aria-label="Game log seasons"` |
| `artifacts/api-server/scripts/player/README.md` | step 14 + weekly rerun note |
| tests | `tests/player-startsit-pages.test.mjs` (new, 4), `tests/player-header.test.mjs` (+1), `tests/player.test.mjs` (+1 in "a state swap") |

No canonical, robots, sitemap, redirect, title or schema change. Removing links is not an SEO-tag change, but it
does change internal links on ~51 hubs: listed for mak's information.

## 5. Tests (local, `env -u INGEST_SECRET node --test --test-concurrency=1`)

| File | Tests | Pass | Fail |
|---|---|---|---|
| `tests/player-header.test.mjs` | 24 | 24 | 0 |
| `tests/player-startsit-pages.test.mjs` (new) | 4 | 4 | 0 |
| `tests/player-injury-tab.test.mjs` | 33 | 33 | 0 |
| `tests/player-overview.test.mjs` | 28 | 28 | 0 |
| `tests/player-outlook-tab.test.mjs` | 42 | 42 | 0 |
| `tests/player-stats-tab.test.mjs` | 29 | 29 | 0 |
| `tests/player-bio-tab.test.mjs` | 25 | 25 | 0 |
| `tests/player-faq-schema.test.mjs` | 4 | 4 | 0 |
| `tests/player-seo-refresh.test.mjs` | 7 | 7 | 0 |
| `tests/player.test.mjs` | 155 | 154 | 0 (1 skipped, pre-existing) |

`tsc` (server and client configs): clean. No PHP touched, so `smoke.php` was not run.

Proof the new tests bite: with `src/` at base, `/player/aaron-rodgers/` and `/player/tyson-bagent/` printed 6
start/sit links each (after: 0, Gibbs stays 6); the phone-menu focus test fails on the base client
("focus is on the menu's button").

## 6. Open items

- **mak (SEO, not changed):** `robots.txt` `Disallow: /nfl/*?log=` hides the 301s from Google (keep or lift).
  `?adv=` is a dead parameter that still creates cache variants with a clean canonical; a normalizer rule dropping
  it would be a redirect change.
- **mak (product):** relink the now-populated Redraft app profile (`/redraft-command/players/<id>`)? It is noindex and
  client-rendered; this branch keeps the 11-26 start/sit choice.
- **Redraft owner:** unknown ids on `/redraft-command/players/<id>` answer 200 with an empty shell (soft 404);
  the raw HTML of that route says `meta robots index,follow` while the header says noindex; the app profile of a
  player with no start/sit page (Rodgers, Sleeper "Free Agent") links its own 404 start/sit page.
- **Data drift:** our `players.json` (2026-11-25) has Rodgers on PIT; Redraft/Sleeper says free agent.
- **Weekly chain:** add `node scripts/player/buildStartSitPages.mjs` to the manual weekly refresh.
- **Not in scope, same root cause:** matchup pages build per-player start/sit links in
  `src/lib/matchup/matchup-render.ts` `startSitFor()` without the list; gating it with `hasStartSitPage()` is a
  one-line follow-up.
