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
| 11 | d19e4a21 | integration doc (first round) |
| 12 | 7cba0163 | second round D: one availability predicate for IR matchup advice |
| 13 | b9fbaed7 | second round A: verified alias slugs 301 in one hop |
| 14 | f1f3b47a | second round B/C: release slot reserved, baseline script + baseline/candidate JSON |

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

## Second-round decisions (mak, 2026-11-26), as applied

### A. Verified alias slugs (b9fbaed7)

**Verification of the reported pair.**
- Data: `data/player/player_slugs.json` (the API's slug ledger, keyed by stable Sleeper id) has
  `"11068": {"slug": "mitch-tinsley", "previous": ["mitchell-tinsley"]}`; `players.json` has no other player at
  `mitchell-tinsley`; `mitch-tinsley` is in `indexed_players.json`. One stable id, both addresses.
- WordPress (read-only MCP): page 7028 `mitchell-tinsley`, "Mitchell Tinsley (WR)", created 2026-10-05, parent 1139,
  `[statchasers_player]`; page 4977 `mitch-tinsley`, same title and content sha, created 2026-09-20.
- Production (read-only, 11-26, the baseline below): `/nfl/players/mitch-tinsley/` 200, `index, follow`, canonical
  self; `/nfl/players/mitchell-tinsley/` 200, `noindex, follow`, no canonical, the same player's page. No Rank Math
  redirect mentions tinsley; no post content links to `players/mitchell-tinsley` (only Optimization Detective URL
  metrics rows).
Status: verified in production (read-only) and in the data.

**The rule** (plugin `statchasers_player_verified_alias()` + the URL normalizer, template_redirect priority 1):
an alias is VERIFIED when exactly one roster player lists it in `previousSlugs` (same stable id), it is no roster
player's current slug, and the destination is a published roster profile (indexed, self-canonical). Then every
spelling 301s to the roster slug in one hop with the tab kept: `/nfl/players/mitchell-tinsley/game-log/` ->
`/nfl/players/mitch-tinsley/game-log/`, `/nfl/players/Mitchell-Tinsley//Stats/` -> `/nfl/players/mitch-tinsley/stats/`,
`?log=2025` -> `/game-log/#log=2025`, `/overview/` -> the profile, a tab the destination has no content for -> the
profile; an invalid tab stays a 404. Anything else is ambiguous and keeps today's behavior (noindex by the
left-roster rule, no redirect). Sitemaps: alias pages are off the roster, so they were already left out (baseline:
0 `mitchell-tinsley` and 0 `chris-brazzell` rows); internal links are built from roster slugs (no alias slug in
any generated link; WordPress content has none). Tests: smoke-player-builder "verified alias slugs" (hub, valid
tab, case/double slash, overview, `?log=`, query kept, empty tab -> profile, invalid tab 404, two ambiguous cases,
left-roster/sitemap) - all pass. Status: verified locally.

**Inventory** (every ledger entry, 83, plus the two name-variant pairs WordPress holds):

| Class | Count | Pairs |
|---|---|---|
| Verified (redirects once released) | 51 | aaron-jones -> aaron-jones-sr; anthony-richardson -> anthony-richardson-sr; anthony-tyus -> anthony-tyus-iii; antonio-williams-13301 -> antonio-williams; brandon-johnson-8756 -> brandon-johnson; brian-robinson -> brian-robinson-jr; brian-thomas -> brian-thomas-jr; calvin-austin -> calvin-austin-iii; carlos-washington -> carlos-washington-jr; chris-brazzell -> chris-brazzell-ii; chris-godwin -> chris-godwin-jr; chris-rodriguez -> chris-rodriguez-jr; deebo-samuel -> deebo-samuel-sr; donte-thornton -> donte-thornton-jr; efton-chism -> efton-chism-iii; emmanuel-henderson -> emmanuel-henderson-jr; erick-all -> erick-all-jr; frank-gore-11573 -> frank-gore-jr; gardner-minshew -> gardner-minshew-ii; gregory-desrosiers -> gregory-desrosiers-jr; harold-fannin -> harold-fannin-jr; harrison-wallace -> harrison-wallace-iii; irv-charles -> irvin-charles; james-cook -> james-cook-iii; jimmy-horn -> jimmy-horn-jr; john-metchie -> john-metchie-iii; kc-concepcion -> kc-concepcion-jr; kenneth-walker-8151 -> kenneth-walker-iii; kevin-coleman -> kevin-coleman-jr; kyle-pitts -> kyle-pitts-sr; kyle-williams-12547 -> kyle-williams; lequint-allen -> lequint-allen-jr; luther-burden -> luther-burden-iii; marvin-harrison -> marvin-harrison-jr; marvin-mims -> marvin-mims-jr; michael-penix -> michael-penix-jr; michael-pittman -> michael-pittman-jr; mike-washington -> mike-washington-jr; mitchell-tinsley -> mitch-tinsley; montorie-foster -> montorie-foster-jr; myles-white-3050 -> myles-white; odell-beckham -> odell-beckham-jr; ollie-gordon -> ollie-gordon-ii; omar-cooper -> omar-cooper-jr; pierre-strong -> pierre-strong-jr; robert-henry -> robert-henry-jr; stetson-bennett -> stetson-bennett-iv; ted-hurst -> ted-hurst-iii; travis-etienne -> travis-etienne-jr; tyrone-tracy -> tyrone-tracy-jr; velus-jones -> velus-jones-jr |
| No destination (the current slug has no indexed profile, so no redirect) | 32 | antwane-wells -> antwane-wells-jr; chris-harper-2721 -> chris-harper; david-johnson-2391 -> david-johnson; david-sills -> david-sills-v; dean-patterson -> dean-patterson-iv; duplicate-player-5282 -> duplicate-player; eric-rivers -> eric-rivers-jr; ervin-philips-5407 -> ervin-philips; frank-gore-232 -> frank-gore; jalen-moreno-cropper -> jalen-cropper; james-butler-5785 -> james-butler; james-proche -> james-proche-ii; jj-jones-12913 -> jj-jones; joseph-manjack -> joseph-manjack-iv; kenneth-walker-4634 -> kenneth-walker; kenny-fletcher -> kenny-fletcher-jr; kevin-austin -> kevin-austin-jr; mecole-hardman -> mecole-hardman-jr; mike-williams-4068 -> mike-williams; phillip-dorsett-ii -> phillip-dorsett; player-invalid-9485 -> player-invalid; quincy-skinner -> quincy-skinner-jr; ricky-white -> ricky-white-iii; robert-burns-11260 -> robert-burns; rodney-smith-2892 -> rodney-smith; ronnie-brown-11413 -> ronnie-brown; sean-ryan-11387 -> sean-ryan; theo-wease -> theo-wease-jr; thomas-fidone -> thomas-fidone-ii; tyler-davis-7131 -> tyler-davis; vinny-anthony -> vinny-anthony-ii; zach-miller-749 -> zach-miller |
| Ambiguous: different stable ids (two people), never redirect | 2 | kenneth-walker (id 4634, WP 5136, noindex) vs kenneth-walker-iii (8151, WP 7247); frank-gore (232, WP 4886, noindex) vs frank-gore-jr (11573, WP 7231) |

WordPress pages that exist at a verified alias (read-only REST, parent 1139): 7028 `mitchell-tinsley` (-> 4977) and
4909 `chris-brazzell` (-> 4910 `chris-brazzell-ii`). The other 49 verified aliases have no WordPress page; the rule
answers them too. Live action: none required. Leave 7028 and 4909 in place (the plugin's 301 runs before WordPress
serves them); no Rank Math redirect is needed. Approved by mak 2026-11-26 ("yes"): trash 7028 and 4909
after the release, once the 301s are confirmed live (live action 6).

Finding, not changed: 21 dynasty_rankings.json records and 45 bio_wikipedia.json records are keyed by an alias
slug (e.g. `luther-burden`, `michael-pittman`), so those players' pages miss that data under the current slug. A
data-key fix for the builders, listed as a follow-up.

### B. Release slot (f1f3b47a)

Reserved in docs/RELEASE-WINDOW.md ("Reserved slots"): **2026-12-15 (Tuesday) 14:00-16:00 UTC**.
- Why: the player family's last SEO-surface change shipped 2026-11-24 19:45 (injury meta wording; before it the
  2026-11-20 FAQ/dateModified/sitemap release). At most one per family per 3-4 weeks puts the earliest at 12-15.
  Tuesday's window is clear of every game window.
- Core update: Google's November 2026 core update began 2026-11-10 (Search Status Dashboard; "up to two weeks",
  outlets project ~11-24, completion not confirmed in coverage found 11-26). Re-check the dashboard shows it
  complete, and no new rollout, before the slot.
- Rides: 648 hub titles + tab titles held to 60; FAQ/FAQPage reductions; one-hop 301s incl. verified aliases;
  sitemap cleanup; FPA PPR default; then the retitle pass and the 4927/4929 trash. Unrelated releases stay out.
- Not in the slot: the team candidate (plugin 1.10.73, integ/team1125). Note: the WEB-001 game-canonical "12-02
  hold" in the memory index is stale; the log shows it released 2026-11-24 19:45 with the hold lifted.

### C. Pre-release baseline

Script: `scripts/player-audit-release-check.mjs` (`live` = production read-only, browser UA, 1.6 s apart;
`candidate` = this checkout's API; `compare a.json b.json`). Output: docs/PLAYER-AUDIT-BASELINE-2026-11-26.json
(production, 11-26) and docs/PLAYER-AUDIT-CANDIDATE-2026-11-26.json (candidate; its `expected` block holds the
plugin-side expectations: redirects, canonical, robots, sitemap). After the release: run `live` again and
`compare` it with the baseline.

| Read | Production 11-26 | Candidate |
|---|---|---|
| Gibbs hub title | Jahmyr Gibbs Stats, News, Bio & Fantasy Outlook \| StatChasers | Jahmyr Gibbs NFL Stats & News \| StatChasers |
| Gibbs hub FAQ (visible, first section / FAQPage) | 8 / 64 (seven panel FAQs 8+12+11+10+7+2+14) | 8 / 8 |
| Gibbs /stats/, /game-log/ FAQ | 12/12, 11/11 | 10/10, 10/10 |
| Gyllenborg hub title (long name) | John Michael Gyllenborg Stats, News, Bio & Fantasy Outlook (brand dropped) | John Michael Gyllenborg NFL Stats & News \| StatChasers |
| Bo Nix hub FAQ | 8 / 60 | 8 / 8 |
| Hayden Large hub FAQ | 2 / 18 | 1 / 1 |
| Pacheco hub / outlook FAQ | 3 / 39, 6 / 6 | 2 / 2, 4 / 4 |
| mitchell-tinsley | 200, noindex, no canonical | 301 -> /nfl/players/mitch-tinsley/ (tab kept) |
| kenneth-walker (ambiguous) | 200, noindex | unchanged |
| `/jahmyr-gibbs/?log=2025` | 200 (own page) | 301 -> /game-log/#log=2025 |
| `//jahmyr-gibbs/stats/` | 200 (copy) | 301 -> /stats/ |
| Page sitemaps | 4 files, 4,575 rows, 4,575 unique, 0 duplicates; tyson-bagent 7, dandre-swift 7, aliases 0 | same, 0 duplicates |
| FPA bare | Half-PPR, DAL RB 25.3 (1), CAR 25.3 (2) | PPR, DAL 27.5 (2), CAR 27.8 (1) |
| FPA ?format=ppr / half / standard | PPR 27.5(2)/27.8(1); Half 25.3(1)/25.3(2); Std 23.1(1)/22.7(3) | identical per format |

Note: item 6's 11-26 03:00 read found 12 duplicate sitemap rows (Bagent/Swift tabs twice) over 5 files; this
11-26 read (cache-busted) finds 0 duplicates over 4 files. The sitemap had been regenerated in between; the
plugin's dedupe keeps it that way after the trash step.

### D. IR Outlook: one availability predicate (7cba0163)

`season-phase.ts matchupAdviceOff(data)`: true on a reserve list (IR, PUP, NFI) or a suspension, read from the
shared `currentStatus` (kind "reserve") or the designation it feeds. While it holds, the Outlook prints no
tough-matchup risk, soft-schedule upside, schedule tag, schedule read in "What could change", schedule or playoff
verdict; the card, the visible FAQ and the FAQ schema read this one predicate (the Overview matchup FAQ and
paragraph too). The Upcoming Matchups section keeps the games as facts with "He is on injured reserve, so these
matchups matter only once he is activated." Rendered before (d19e4a21) and after, same data
(/home/runner/pa1126/shots/ir-outlook/before-*.html, after-*.html):

| Player | Before | After |
|---|---|---|
| Isiah Pacheco (IR, back) - risk card | "Injury: He's on injured reserve, back. **Tough matchups: The Bears in Week 12 (23rd) and the Vikings in Week 15 (29th) are among the stingiest defenses against RBs.** Weak efficiency ..." | "Injury: He's on injured reserve, back. Weak efficiency 1.60 yards after contact per carry, 71st of 95 RBs in 2025." |
| Pacheco - FAQ (visible and schema) | "Isiah Pacheco's risks: he is on injured reserve, back, **the Bears in Week 12 (23rd) and the Vikings in Week 15 (29th) are tough matchups** and his efficiency ... limits his scoring." ("tough matchups" twice in the HTML: FAQ + schema data) | "Isiah Pacheco's risks: he is on injured reserve, back and his efficiency (1.60 yards after contact per carry, 71st of 95 RBs in 2025) limits his scoring." (0 occurrences) |
| Hayden Large (IR, no games) | "Risk: Injury - He's on injured reserve, undisclosed."; FAQ "Hayden Large's risks: he is on injured reserve, undisclosed." | unchanged (he had no matchup advice; item 4's gates already applied) |
| Jahmyr Gibbs (active, Week 12 vs CHI 23rd, tough) | Risk "Tough matchups: The Bears in Week 12 (23rd) and the Vikings in Week 15 (29th) ..."; tag "Tough upcoming schedule"; FAQ "How difficult is Jahmyr Gibbs' remaining fantasy schedule? Difficult: ..." | identical: the advice stays for an active player |

Test: player-outlook-tab "on IR after playing: one predicate ..." checks card, visible FAQ, schema island and the
uncapped FAQ pool, with an active control; it fails with the predicate switched off (2 failures). Status: verified
locally.

## Tests

Full API suite, `env -u INGEST_SECRET node --test --test-concurrency=1 tests/*.test.mjs`, one run at a time
(logs in /home/runner/pa1126/logs):

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Baseline main 4cb49ac (base45) | 1,989 | 1,985 | 3 | 1 |
| integ after the merges (f5110ed5) | 2,030 | 2,026 | 3 | 1 |
| integ after mak's first-round decisions (22346f37) | 2,034 | 2,030 | 3 | 1 |
| integ final (f1f3b47a, after the second round) | 2,035 | 2,031 | 3 | 1 |

The three failures are the same tests on baseline and integ, so none is new:
- tests/matchup.test.mjs:1963 "the Wild Card: one H1 in the hero, scores, table and JSON-LD in the source" (known, documented 11-24b)
- tests/rb-handcuffs.test.mjs:540 "a player card is its own fragment, and an unknown one is a 404"
- tests/schedule-game-status.test.mjs:380 "warm cache: live to final replaces the clock on both routes; the week is recent, then settles"

Runtime cache files the suite rewrote (data/schedule/espn-layer-2026.json, data/matchup/lines/2026.json,
data/schedule/espn-layer-2024.json) were reverted before every commit.

Plugin smoke: `php tests/smoke.php` (runs every smoke-*.php group) - integ final: all passed, 3,571 ok
(3,542 after the merges; 3,554 after the retitle scenario and the `?log=2025` case; +17 alias cases); baseline main:
all passed, 3,474 ok.
Standalone files smoke-local-assets (33/33) and smoke-rhr-embed (36/36) pass on both; every other smoke-*.php runs
only through smoke.php; cache-integration.php needs a throwaway WordPress (SC_WP_PATH) and was not run on either.
`build-zip.sh` parse, load, version, loader and rhr smoke checks ok.

Typecheck: `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json` clean.

## Zip

`wordpress-plugin/dist/statchasers-news.zip` (copy: /home/runner/pa1126/statchasers-news-1.10.74.zip), version
1.10.74, sha256 `560e9588d969e581212301ea047e9a8863e0e2673b8c6446ca40cafc6f2872b0` (api assets 975b115efeb8), built
from the final tree after the second round (it carries the alias redirect). Earlier builds (f5110ed5 message,
e7bcadc5...) are superseded; the zip embeds build timestamps.

1.10.73 is taken by the unreleased team candidate integ/team1125: whichever ships second must merge the other
first and keep the higher number.

## Production actions (need mak; in this order, in the reserved slot 2026-12-15 14:00-16:00 UTC)

1. **Release: API publish, then plugin 1.10.74 upload.** Publish the API (Replit) first, wait for
   `https://news.statchasers.com/api/status` to report the new build, then upload the zip and run
   `wp eval 'statchasers_news_run_upgrade_now();'`. The Game Log season buttons, the proxy path and the API ship together.
   Verify (browser UA, curl -sI): `/nfl/players/jahmyr-gibbs/?log=2025` -> one 301 to `/game-log/#log=2025`;
   `/nfl/players/mitchell-tinsley/game-log/` -> one 301 to `/nfl/players/mitch-tinsley/game-log/`;
   `/nfl/players/kenneth-walker/` still 200 noindex; `/wp-json/statchasers/v1/p/embed/player/jahmyr-gibbs?section=game-log&h1=1&log=2025`
   -> 200 with "in 2025 (Weeks 1-17)"; the plugin version in WP admin reads 1.10.74.
2. **Targeted FPA purges, then the general purge-and-warm.** WP Rocket (desktop and mobile) then the Rocket.net edge
   for /nfl/fantasy-points-allowed-by-position/ and /nfl/fantasy-points-allowed-by-position/2025/. Then
   `pnpm purge-and-warm` (WP Rocket incl. mobile, Rocket.net edge, then the phone and desktop warm; the edge holds
   200 copies of the case / double-slash / `?log=` / alias variants for up to 30 days).
   Verify: `node scripts/player-audit-release-check.mjs live after.json` then
   `compare docs/PLAYER-AUDIT-BASELINE-2026-11-26.json after.json`: FPA bare = PPR (DAL 27.5 (2), CAR 27.8 (1)) and
   equal to `?format=ppr`, half/standard unchanged; hub titles "{Name} NFL Stats & News | StatChasers"; hub FAQ
   visible == FAQPage (Gibbs 8/8); every redirect row as in the candidate's `expected`; sitemaps 0 duplicates and 0
   alias rows; with an iPhone UA the Gibbs hub shows one "Should I start Gibbs?" and the meters Yards per carry /
   Yards per touch; Pacheco's Outlook has no "Tough matchups".
3. **Trash WP pages 4927 and 4929** (keepers 4926, 4928). Dry run first
   (`wp eval 'print_r( statchasers_player_duplicate_plan() );'` must list keep 4926 retire [4927], keep 4928 retire
   [4929], differences empty), then `statchasers_player_duplicate_apply( array( 4927, 4929 ) )` (trash only).
   Verify: both URLs still resolve with `page-id-4926` / `page-id-4928`; page sitemaps list each of their URLs once.
4. **Stored-title update (retitle pass).** Review
   `wp eval 'echo wp_json_encode( statchasers_player_retitle_report(), JSON_PRETTY_PRINT );'` (counts, over-60 before
   and after, every old => new; rows carry titles only), then the Tools-screen retitle button.
   Verify: a sample of hubs (Gibbs, Gyllenborg, Bo Nix, Bagent, Swift) stores `rank_math_title` = "{Name} NFL Stats &
   News | StatChasers"; slugs and canonicals unchanged (re-run the check script).
5. **After deploy:** production lab run on the Gibbs hub (same settings as 11-25); Pacheco Durability grid shows 10
   missed.
6. **Alias pages (approved by mak 2026-11-26):** once `/nfl/players/mitchell-tinsley/` and `/nfl/players/chris-brazzell/`
   (hub and a tab each) answer a single 301 to mitch-tinsley / chris-brazzell-ii on live, trash (not force-delete) WP
   pages 7028 and 4909. Verify: both alias URLs still 301 in one hop after the trash (the plugin answers them, no WP
   page needed), the destinations stay 200 + self-canonical, and neither alias appears in page-sitemap*.xml.

Visible follow-ups (not part of this release):
- Standalone /injury-impact tool: gridiron.json rebuild (research pipeline, then buildData.mjs +
  buildUnscoredSeasons.mjs); it still shows Pacheco's 2026 as 5 missed.
- Injury check between Friday's final report and kickoff for a Sunday Week 12/13 player: header, Outlook, Injury tab
  and preview agree; the history row reads "Game not played yet"; the 2026 grid ends at the last completed week.
- buildInjuryHistory.mjs still writes "played through" before the game (corrected at render).
- dynasty_rankings.json (21) and bio_wikipedia.json (45) records keyed by an alias slug (builders).

## Open decisions for mak

Settled 11-26: meters restored, in-place tabs kept, career totals full season with labeled ranges, FPA PPR default,
verified aliases 301 (ambiguous ones stay noindex), the IR matchup advice gated, the release slot reserved
(2026-12-15). Still open:

- The hub title change ("{Name} Stats, News, Bio & Fantasy Outlook" live, "{Name} Fantasy Football 2026: Stats,
  Outlook & News" stored -> "{Name} NFL Stats & News | StatChasers", 648 hubs) rides the reserved SEO slot with the
  other SEO surfaces (mak 2026-11-26: keep them together).
