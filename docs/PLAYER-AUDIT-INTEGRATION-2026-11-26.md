# Player-page audit: integration of items 1-6 (2026-11-26)

Branch `integ/player-audit-2026-11-26` in `/home/runner/pa1126/integ`, based on main 4cb49ac (main had not moved).
Nothing pushed, published, purged or written to WordPress. Plugin 1.10.74.

Status words: verified locally / verified in production (read-only) / pending <named action>.
Per-item detail lives in the item docs merged here:
docs/WEB-033-PLAYER-2026-11-26.md, docs/WEB-036-PLAYER-2026-11-26.md, docs/WEB-039-PLAYER-2026-11-26.md,
docs/WEB-035-030-034-PLAYER-2026-11-26.md, docs/WEB-044-PLAYER-2026-11-26.md,
docs/WEB-012-005-020-008-017-025-029-022-PLAYER-2026-11-26.md.

## Commits

| Order | Commit | What |
|---|---|---|
| 1 | ccf69f94 | merge pa1126/i1: 0f2afcb WEB-033 ranks, aaf24c2 FPA page opens in PPR |
| 2 | f5237341 | merge pa1126/i2: 1608f46 WEB-036 career scoring note |
| 3 | 19e971f6 | merge pa1126/i3: b8fa72a WEB-039 durability card / games missed |
| 4 | 8a29df12 | merge pa1126/i45: 4ed672c WEB-035/030/034, ca80da2 WEB-044 hub trim |
| 5 | 6e42c75e | merge pa1126/i6: 863603e, 81698b6, fc6e716, e6112db, 41a7f82, 8fca664 |
| 6 | 8eeec0c4 | integration fix: one start/sit button on the phone Overview |
| 7 | f5110ed5 | plugin 1.10.74 version bump |
| 8 | 8204b917 | mak 11-26 decision 1: Overview meters restored |
| 9 | 30cd9bc0 | mak 11-26 decision 3: career table week-range label |
| 10 | 22346f37 | plugin smoke: retitle dry run touches titles only; explicit `?log=2025` case |

### Merge conflicts and resolutions

Merges 1-4 applied without conflict (git auto-merged player-render.ts, player-data.ts, types.ts, outlook-tab.ts,
stats-tab*.ts, faq-pools.ts, smoke.php and the tests). Merge 5 conflicted twice:

1. `public/player.css`, end of file: item 4+5's "Readable labels" 12px floor and item 6's "Game Log season buttons"
   reset were both appended at the same spot. Kept both (labels first); they touch different selectors.
2. `src/lib/player/overview.ts` imports: item 4+5 added `publishedRank`, item 6 removed `redraftPlayerUrl` (its
   Overview link is gone). Kept `publishedRank`, dropped `redraftPlayerUrl` (no caller left in the file).

No item's change was reverted or narrowed except where mak decided otherwise on 11-26 (decision 1 below).

## mak's decisions of 2026-11-26, as applied

1. **Overview meters restored** (8204b917). RB: Yards per carry, Yards per touch, Target share, PPR points per
   opportunity. QB: Completion rate, Yards per attempt, TD rate, PPR points per play (not EPA per play). WR:
   Target share, Yards per target, Catch rate, PPR points per target. A meter the Stats card also prints keeps the
   card's figure and percentile; target share keeps the shared usage field (WEB-035 alignment). The card carries no
   yards per carry, yards per touch or points per play, so those keep the game logs' pool, and the footnote names
   both, e.g. Gibbs: "Percentile among the 80 qualified RBs on his Stats tab (13+ carries, 4+ games and a 10%+ snap
   share); target share among the 66 RBs with 6+ games and 5+ weighted opportunities per team game; yards per carry
   and yards per touch among the 53 RBs with at least 66 carries and targets in 2026." Gibbs reads 4.9 / 5.6 / 17.6% /
   1.00, the same figures production shows. Tests: tests/player-share-field.test.mjs pins the labels and footnote for
   RB (Gibbs), QB (Goff) and WR (Burden). Status: verified locally.
2. **In-place tab switching kept.** The hub still ships all seven panels; the rail and FAQ print once (Overview's),
   FAQ schema matches the visible FAQ (player-faq-schema 4/4). No change made. Status: verified locally.
3. **Career totals keep the full regular season.** Weeks 1-17 on the NFL Player Stats leaderboards is intended: the
   user's rule of 2026-09-23 (memory advanced-stats-source-repo: served tables are built from the weeks 1-18
   snapshot minus Week 18; scripts/player-stats/buildWeeks.mjs). The leaderboard already prints "Weeks 1-17" beside
   its table (player-stats-render.ts meta row and caption). The player Stats tab's career table now says beside it
   (30cd9bc0): "Season rows count the full regular season, Week 18 included. The NFL Player Stats leaderboards count
   Weeks 1-17, the fantasy season." St. Brown 2024: 302.5 through Week 17 + 13.7 in Week 18 = 316.2, asserted in
   tests/career-scoring.test.mjs (7/7). Status: verified locally.
4. **PPR FPA default kept and checked** (local server, same data):

   | Request | data-format | Caption | ETag | Body | Softest RB defense |
   |---|---|---|---|---|---|
   | /embed/fpa | ppr | PPR | `2026-ppr-raw-...-4yikbt` | e91b37dd | Carolina 27.8 |
   | ?format=ppr | ppr | PPR | same | same | same |
   | ?format=half | half | Half-PPR | `2026-half-raw-...` | b9ea28b0 | Dallas 25.3 |
   | ?format=standard | standard | Standard | `2026-standard-raw-...` | dbc90e3e | Dallas 23.1 |
   | ?format=bogus | ppr | PPR | ppr ETag | same as bare | Carolina 27.8 |

   Plugin cache keys: smoke-fpa (in smoke.php, all passed) checks bare and `?format=ppr` share one transient and
   half/standard stay separate, the invalid value falls back to PPR, and the `?season=` 301 drops the default.
   Player-page links: on a PPR page every FPA link is the bare URL (`/fpa?embed=1` locally; the WordPress URL in
   production) next to "PPR" rank labels; on `?format=half` the links carry `format=half` beside "Half-PPR" labels;
   `?format=standard` likewise. Checked on Gibbs hub, Game Log and Outlook and St. Brown. Status: verified locally.
5. **Mobile measurement** - see "Season Stats height" below.
6. **Bookmark, duplicates, retitle** - see the item 6 section below.
7. **Live actions** - see "Production actions" below.

## Cross-item checks

| Check | Result | Status |
|---|---|---|
| No `/redraft-command/players/` link on any tab | 0 on every fragment of Gibbs, St. Brown, Stafford, Nate Carter, Hayden Large, Pacheco, Goff, Burden (hub + 6 tabs each). The only remaining `redraftPlayerUrl` caller is the Injury tab model's unused `rc` field (renders nowhere). | verified locally |
| No duplicate start/sit button | Found one: on phones the Overview printed its own "Should I start {Last}?" (`.scp-ox-startsit`, mak 11-05, from when the header's phone button opened the Redraft shell) a few hundred px under the header's button, which item 6 turned into the same link. Fixed in 8eeec0c4: the header keeps it; test in player-overview.test.mjs fails without the fix. Per tab now: header button + at most one body link. | verified locally |
| Visible FAQ == FAQPage schema, hub <= 10 | player-faq-schema 4/4 on the merged tree. Item 2 wording on St. Brown/Goff Stats tabs intact; item 3 wording (Pacheco "missed 10 games to injury this season") intact. | verified locally |
| Game Log labels + season buttons | 0 `?log=` in Game Log fragments; buttons carry `data-scp-log-src=.../embed/player/<slug>?section=game-log&h1=1`. The `log=2025` fragment prints "final rank ... in 2025 (Weeks 1-17), as on the Fantasy Points Allowed archive"; `log=2024` "in 2024 (full season)"; current season "through Week 11 ... today's rank for every row". The proxy allowlists `embed/player/<slug>` and passes `section`, `h1`, `log`, `format`. | verified locally |
| Item 3 durability vs item 4+5 IR outlook | Pacheco: Injury tab "2026 games missed 10", latest injury 10, region 10, FAQ 10; Outlook "has not played in 2026. On IR (back). He has missed 10 games to injury this season"; Overview "Pacheco cannot be started until he is activated". Hayden Large has no Injury tab; every surface says IR (undisclosed), not played in 2026, no schedule/playoff FAQs. Agree. | verified locally |
| Titles (item 6) vs title/H1 assertions (items 4+5) | All player suites pass on the merged tree. Hub title `Jahmyr Gibbs NFL Stats & News | StatChasers`. | verified locally |

Follow-up noted, not changed (item 4+5 area): Pacheco's Outlook risk card and "What could hurt ... fantasy value?"
FAQ still name tough matchups for a player on IR (the upside/schedule side was gated, the risk side was not).

## Season Stats height (the audit's 3.6 phone screens) - item 5 close-out

Method: the live Gibbs hub and /stats/ HTML were fetched once each from production (browser UA). The "live" control
is that HTML; the "candidate" is the same HTML with the player root swapped for the integrated branch's fragment
(`/embed/player/jahmyr-gibbs?h1=1`, the plugin's hub mode, same 11-25 data) and player.css / player.js pointed at
the integrated build. Every other stylesheet (Divi, theme, customizer, fonts) is production's, loaded from
statchasers.com. Headless Chromium, 390x844, iPhone UA, DPR 2 (script: /home/runner/pa1126/shots/measure.mjs,
composer: compose.py). The control matches a direct load of the production URL exactly (Season Stats 438-600 px both
ways), which justifies the equivalence. The candidate's player headshot does not load from a file page (relative
image path); its box is sized, so no layout effect.

| Page (390 px) | Section (visible heading) | Top | Bottom | Height | Next major heading (top) | Gap |
|---|---|---|---|---|---|---|
| Live hub | "Jahmyr Gibbs 2026 Season Stats" | 438 | 600 | 163 (0.19 screen) | "Weekly Performance & Upcoming Schedule" (633) | 33 |
| Candidate hub | "Jahmyr Gibbs 2026 Season Stats" | 438 | 644 | 206 (0.24 screen) | same (677) | 33 |
| Live hub, player.css not applied | "2026 Season Stats" | 5,070 | 6,275 | 1,205 (1.43) | same (6,665) | 390 |

The 206 vs 163 is the "Full Jahmyr Gibbs stats" link, now visible on phones (it was hidden). Elements: live 6,589,
candidate 4,598.

**What the audit measured.** No Season Stats block approaches 3.6 screens styled or unstyled (1.43 unstyled, so the
"player.css not applied" hypothesis does not explain it either). The figure matches the distance from the
"2026 Season Stats" heading to the next heading the FAQ starts with: live 453 -> 3,497 = 3,044 px = 3.61 screens at
844 px. That stretch is the whole Overview body (heading to heading on the candidate: weekly chart 679 px, Outlook &
Efficiency 804, News 310, Career & Background 603, peers rail 397), not one block. Item 5's local test measured the Season Stats block itself (163 px).
Candidate: 453 -> 3,470 = 3,017 px = 3.57 screens. The largest single block on the candidate Overview is Outlook &
Efficiency at 804 px (0.95 screen); no block exceeds one screen, so no further compaction was made. Shrinking the
whole Overview body is decision (b) territory (what the hub prints), not a tall block.

Stats tab for reference (live vs candidate, 390): "2026 Stats" 451 -> "Career Stats by Season" 1,120 / 1,172;
"Fantasy Football Stats" starts 1,928 / 2,057; FAQ 4,027 / 4,029.

Screenshots (/home/runner/pa1126/shots): gibbs-production-direct-390.png (direct production load),
gibbs-live-390.png (control), gibbs-candidate-in-live-shell-390.png (candidate), gibbs-live-no-playercss-390.png,
gibbs-stats-production-direct-390.png, gibbs-stats-live-390.png, gibbs-stats-candidate-in-live-shell-390.png; the
measurements beside them as .json. Status: verified in production (read-only) for live; verified locally for the
candidate in the production shell.

## Per item

### 1. WEB-033 difficulty ranks + FPA page in PPR
- Root cause: the audit's "FPA" ranks were the FPA page's Half-PPR default; player pages are PPR. Two latent cache paths fixed.
- Changed: one rank rule (`rankFpaValues`), labeled Difficulty note/panel/strip, archive/fallback labels, FPA default PPR.
- Fixture: Gibbs game log vs /fpa PPR RB ranks 14/14; `log=2025` 17/17 vs the archive.
- Evidence: web-033-opp-ranks 8/8, fpa 38/38, smoke-fpa; decision 4 table above.
- Status: verified locally; pending release actions 1-2 below.

### 2. WEB-036 career scoring note
- Finding: St. Brown 2024 316.2 is right; 4.28 is a Week 4 TD pass with no column on a WR row.
- Changed: `careerSeasonTotals` extras + one note under the career table; plus (decision 3) the week-range note.
- Fixture: St. Brown /stats/, Goff /stats/.
- Evidence: career-scoring 7/7; rendered notes on the merged tree (SC_SCORING_TOTALS=house, as deployed).
- Status: verified locally; pending API publish.

### 3. WEB-039 durability card / games missed
- Root cause: the Durability grid and career availability read the stale gridiron.json pack (through Week 6).
- Changed: current season from the page's own record; "game not played yet" wording; report body part.
- Fixture: Pacheco (10 everywhere, grid XXXXXBXXXXX), Jennings, Shaheed, Lock, Bo Melton.
- Evidence: player-injury-tab 33/33, data-accuracy 79/79.
- Status: verified locally; pending API publish; follow-ups listed below.

### 4. WEB-035/030/034 ranks, share field, labels, IR outlook
- Root cause: four pools for one share figure; total-points fallback labeled "per game"; bare "TD"; IR outlook printed preseason/schedule advice.
- Changed: `publishedRank` basis words, one usage field for share ranks, precise TD labels, IR gates. Overview meter metrics restored per decision 1.
- Fixture: Burden (25th of 114 everywhere), Nate Carter (RB134 by total points), St. Brown (52 receiving TD), Hayden Large.
- Evidence: player-overview 28, player-outlook-tab 41, ppg-rank-consistency 11, player-share-field 4.
- Status: verified locally; pending API publish.

### 5. WEB-044 hub trim
- Finding: the hub printed seven rails and seven FAQs (64 questions).
- Changed: rail + FAQ once, FAQ cap 10, Bio duplicates dropped, 12 px label floor, "Full {Name} stats" on phones. In-place tabs kept (decision 2).
- Evidence: player-faq-schema 4/4, player 153; mobile measurement above.
- Status: verified locally (candidate in the production shell); pending production lab run after release.

### 6. WEB-012/005/020/008/017/025/029/022
- Finding: two same-slug WP pairs from a 09-20 builder race; `?log=` links; nine Redraft shell links; hub titles over 60.
- Changed: post-insert slug settlement + dry-run/apply tools, sitemap dedupe, one-hop 301 normalizer, season buttons + `#log=` + proxy path, start/sit links, 60-character title ladder.
- **Old `?log=2025` bookmark**: the plugin's normalizer sends `/nfl/players/<slug>/?log=2025` to
  `/nfl/players/<slug>/game-log/#log=2025` in one 301 (smoke-player-builder, case added explicitly). Rendered in
  Chromium (390) on `/player/jahmyr-gibbs/game-log/#log=2025`: after the redirect `data-scp-log-shown="2025"`, the
  2025 button pressed, 2025 Game Log heading and "final rank ... in 2025 (Weeks 1-17)" note; after a reload, the same;
  the bare URL opens 2026. Screenshots gibbs-log2025-after-redirect-390.png, -after-refresh-390.png, -bare-390.png.
  Status: verified locally; pending live re-check after deploy (the 301 needs the plugin).
- **Duplicate dry run**: `statchasers_player_duplicate_plan()` keeps the lowest ID per slug - the page WordPress
  serves (production shows `page-id-4926` for /tyson-bagent/ and `page-id-4928` for /dandre-swift/, verified in
  production read-only by item 6). The smoke scenario seeded with the live IDs returns
  `[tyson-bagent, keep 4926, retire [4927]]`, `[dandre-swift, keep 4928, retire [4929]]`, differences empty, nothing
  written; apply trashes only authorized retirees, never the keeper. Status: verified locally.
- **Retitle dry run**: new smoke scenario (22346f37). Sample row:
  `{"601":{"old":"Josh Allen Fantasy Football 2026: Stats, Outlook & News","new":"Josh Allen NFL Stats & News | StatChasers","len":41}}`.
  Asserted: a row holds only `old`, `new`, `len`; the dry run writes nothing; apply writes only `rank_math_title`;
  every `post_name` unchanged; the stored `rank_math_canonical_url` unchanged; a hand-written title left alone.
  Status: verified locally; the live dry run is production action 4.

## Tests

Full API suite, `env -u INGEST_SECRET node --test --test-concurrency=1 tests/*.test.mjs`, one run at a time
(logs in /home/runner/pa1126/logs):

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Baseline main 4cb49ac (base45) | 1,989 | 1,985 | 3 | 1 |
| integ after the merges (f5110ed5) | 2,030 | 2,026 | 3 | 1 |
| integ final (22346f37, after mak's decisions) | 2,034 | 2,030 | 3 | 1 |

The three failures are the same tests on baseline and integ, so none is new:
- tests/matchup.test.mjs:1963 "the Wild Card: one H1 in the hero, scores, table and JSON-LD in the source" (known, documented 11-24b)
- tests/rb-handcuffs.test.mjs:540 "a player card is its own fragment, and an unknown one is a 404"
- tests/schedule-game-status.test.mjs:380 "warm cache: live to final replaces the clock on both routes; the week is recent, then settles"

Runtime cache files the suite rewrote (data/schedule/espn-layer-2026.json, data/matchup/lines/2026.json,
data/schedule/espn-layer-2024.json) were reverted before every commit.

Plugin smoke: `php tests/smoke.php` (runs every smoke-*.php group) - integ final: all passed, 3,554 ok
(3,542 after the merges; +12 from the retitle scenario and the `?log=2025` case); baseline main: all passed, 3,474 ok.
Standalone files smoke-local-assets (33/33) and smoke-rhr-embed (36/36) pass on both; every other smoke-*.php runs
only through smoke.php; cache-integration.php needs a throwaway WordPress (SC_WP_PATH) and was not run on either.
`build-zip.sh` parse, load, version, loader and rhr smoke checks ok.

Typecheck: `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json` clean.

## Zip

`wordpress-plugin/dist/statchasers-news.zip` (copy: /home/runner/pa1126/statchasers-news-1.10.74.zip), version
1.10.74, sha256 `e7bcadc59853f0562185c168ab3f8ba382b555480c5bf2286168c59f24246779` (api assets 975b115efeb8), built
from the final tree. The sha in the f5110ed5 commit message is from an earlier build of the same plugin source (the
zip embeds build timestamps); this one is the candidate.

1.10.73 is taken by the unreleased team candidate integ/team1125: whichever ships second must merge the other
first and keep the higher number.

## Production actions (need mak; in this order)

1. **Release: API publish + plugin 1.10.74 upload, in the release window.** Publish the API (Replit) first, then
   upload the zip, then `wp eval 'statchasers_news_run_upgrade_now();'`. The Game Log season buttons, the proxy path
   and the API ship together.
   Verify: `curl -sI` (browser UA) `/nfl/players/jahmyr-gibbs/?log=2025` -> 301 to `/game-log/#log=2025`;
   `/wp-json/statchasers/v1/p/embed/player/jahmyr-gibbs?section=game-log&h1=1&log=2025` -> 200 with "in 2025 (Weeks
   1-17)"; the Gibbs hub HTML has 0 `/redraft-command/players/` and 0 `?log=`; the plugin version in WP admin reads 1.10.74.
2. **Purges.** Targeted FPA first: WP Rocket (desktop and mobile) then the Rocket.net edge for
   /nfl/fantasy-points-allowed-by-position/ and /nfl/fantasy-points-allowed-by-position/2025/. Then the release's
   general purge-and-warm: WP Rocket (mobile included) for the player pages and page sitemaps, then the Rocket.net
   edge (it holds 200 copies of uppercase / double-slash / `?log=` variants for up to 30 days), then the live warm.
   Verify: bare FPA page shows "PPR scoring" and Carolina 27.8 for RBs, `?format=half` shows Half-PPR; with an
   iPhone UA the Gibbs hub shows one "Should I start Gibbs?" and the Overview meters Yards per carry / Yards per touch;
   page-sitemap*.xml with a cache-buster lists /dandre-swift/ and /tyson-bagent/ and each of their tabs once.
3. **Trash WP pages 4927 and 4929** (keepers 4926, 4928). Run the dry run first
   (`wp eval 'print_r( statchasers_player_duplicate_plan() );'`), then
   `statchasers_player_duplicate_apply( array( 4927, 4929 ) )` (trash only). Verify: both URLs still resolve with
   `page-id-4926` / `page-id-4928`; sitemaps unchanged (already deduped by step 1).
4. **Stored-title update (retitle pass).** Review
   `wp eval 'echo wp_json_encode( statchasers_player_retitle_report(), JSON_PRETTY_PRINT );'` (counts, over-60 before
   and after, every old => new), then the Tools-screen retitle button. Verify: a sample of hubs shows
   `rank_math_title` = "{Name} NFL Stats & News | StatChasers", slugs and canonicals unchanged. This is the SEO
   change under decision (e) and needs its own release slot (docs/RELEASE-WINDOW.md rule 5).
5. **Live checks after deploy:** production lab run on the Gibbs hub (same settings as 11-25); Pacheco Durability
   grid shows 10 missed.

Visible follow-ups (not part of this release):
- Standalone /injury-impact tool: gridiron.json rebuild (research pipeline, then buildData.mjs +
  buildUnscoredSeasons.mjs); it still shows Pacheco's 2026 as 5 missed.
- Injury check between Friday's final report and kickoff for a Sunday Week 12/13 player: header, Outlook, Injury tab
  and preview agree; the history row reads "Game not played yet"; the 2026 grid ends at the last completed week.
- buildInjuryHistory.mjs still writes "played through" before the game (corrected at render).

## Open decisions for mak

Settled 11-26: meters restored (1), in-place tabs kept (2), career totals full season with labeled ranges (3), FPA
PPR default (4). Still open:

c. Alias-slug pairs (mitchell-tinsley / mitch-tinsley, kenneth-walker / kenneth-walker-iii, frank-gore /
   frank-gore-jr, chris-brazzell / chris-brazzell-ii): keep noindex or 301 to the roster slug.
e. Hub title: the live island prints "{Name} Stats, News, Bio & Fantasy Outlook | StatChasers" (Gibbs, checked live
   11-26) and stored Rank Math titles read "{Name} Fantasy Football 2026: Stats, Outlook & News"; both become
   "{Name} NFL Stats & News | StatChasers" on 648 indexed hubs, dropping "Fantasy Football 2026" / "Fantasy Outlook".
   That is an SEO-surface change needing its own release slot per docs/RELEASE-WINDOW.md. This branch also carries
   other SEO surfaces (FAQ/FAQPage reductions, tab titles held to 60, 301s, sitemap dedupe, FPA default format), so
   mak decides whether 1.10.74 ships as one SEO release or the title ladder is split out.
f. Pacheco-type IR players: whether the Outlook risk card / FAQ should also drop tough matchups (noted above).
