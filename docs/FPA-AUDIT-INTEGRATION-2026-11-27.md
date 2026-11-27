# FPA page audit: integration (2026-11-27)

Branch `integ/fpa-audit-2026-11-27` (worktree .local/fpa1127/integ), base main 773bb934 (production: API 3032dccf, plugin 1.10.74).
Plugin 1.10.76 (1.10.75 = SOS audit candidate; whichever ships second carries the other).
Zip `.local/fpa1127/statchasers-news-1.10.76.zip`, sha256 a7ab9731e94cba48dff6996820bdab7b76581a988f72679ecd8f282f8bad9952.
Nothing pushed, published, installed or purged.

| Item | Branch @ commit | Detail doc | Status |
|---|---|---|---|
| 1 WEB-033 ranks | fix/fpa-web033-ranks-2026-11-27 @ 6f066a0a | FPA-AUDIT-WEB-033-2026-11-27.md | Root cause verified in production (fix live since 1.10.74); band-word consolidation + 9 tests verified locally |
| 2 WEB-003 cache | fix/fpa-web003-cache-2026-11-27 @ b1c98e70 | FPA-AUDIT-WEB-003-2026-11-27.md | Verified on the replay bench; pending release |
| 3+4 WEB-020/025/049/050/023 | fix/fpa-web020-mobile-2026-11-27 @ 9c0cc18e | FPA-AUDIT-WEB-020-049-2026-11-27.md | Verified locally (Divi CSS loaded last, news host up and blocked); pending release |
| 5+6 WEB-030/021 | fix/fpa-web030-021-2026-11-27 @ 5b358364 | FPA-AUDIT-WEB-030-021-2026-11-27.md | Verified locally; og:image already correct in production; pending release |

Merges: no conflicts. Version bump a9fafde5.

## Tests (integrated head)

- `tsc` (server + client): clean.
- Full API suite: 2,051 tests, 2,047 pass, 3 fail, 1 skipped. The 3 failures are the same three as main (matchup Wild Card H1, rb-handcuffs player card fragment, schedule-game-status warm cache); none new. The two player tests that dropped connections under memory pressure on the item 1 branch pass here.
- Targeted: fpa 41, fpa-version 4, fpa-math 8, fpa-step 6, fpa-refresh 9, web-033-opp-ranks 17, reference-pages 28, data-accuracy 79, sos 28, table-armour 20, hygiene 8, edge-prefetch 6: all pass.
- Plugin: php -l clean; `php tests/smoke.php` all passed; smoke-local-assets all passed; build-zip.sh lint + version + loader checks passed.
- Runtime cache files rewritten by the suite reverted.

## Release order (needs mak's go)

1. Replit Publish of this head; confirm /api/status commit before step 2 (a Publish pressed before main moves builds the old HEAD).
2. scp zip, back up current plugin folder to ~/tmp, `wp plugin install ~/tmp/statchasers-news-1.10.76.zip --force`, `wp eval 'statchasers_news_run_upgrade_now();'`.
3. `wp eval 'print_r( statchasers_fpa_publish_check( true ) );'` (first run republishes both seasons, 36 edge paths), `wp option get statchasers_fpa_published`, `wp cron event list | grep statchasers_fpa`.
4. Remove the FPA rules from the WordPress-side `sc28-a11y` inline style.
5. WP Rocket clean (mobile included), then Rocket.net edge purge.
6. Checks: desktop + iPhone UA on `/`, `/2025/`, `?format=half`: title/week vs origin, no `format=`/`view=` hrefs, `/2025/` link present, assets from statchasers.com, `node scripts/fpa-faq-schema-check.mjs <both URLs>` (5 and 3 Q, matching), JSON-LD Org/WebSite/WebPage per route.

## Open decisions for mak

- Partial-week rolling window: one Week 12 game switched the live table to 2026 weeks 3-12 (2025 share 0); ranks swung (BUF 12 -> 20, CAR 1 -> 7) while the label says "through Week 11". Count complete weeks only, or reword?
- Matchup FAQ `snapshotNote` says "Neither defense is soft" at ranks 11-12, which the FPA page calls Soft (FAQ text, needs OK).
- Restored crawlable `/2025/` link under the current table (partly reverses 11-04).
- Difficulty is color-only on screen (rank visually hidden per 10-08); a visible cue needs a decision.
- Team logos still load from news.statchasers.com (decorative). SOS rail card keeps a `?tab=player` link (SOS session).

## mak's decisions (2026-11-27) and release

Decisions: (1) only complete weeks count; (2) no link from the current table to /2025/; (3) a visible difficulty cue: yes; (4) change the matchup "not soft" wording; (5) release after these. Built in ebb0c4d6 (see its message); main fast-forwarded, published (build ebb0c4d6), plugin 1.10.76 (zip sha256 82c6e81c223b9aec9a333cedeca44593b5890299b754adb93b787a4293f5635d) installed 05:35Z.

### After release (production, 2026-11-27 05:45-05:55 UTC)

| Check | Result |
|---|---|
| /api/status build | ebb0c4d6; fpa week_11 (re-ingest 05:33Z replaced the partial week_12 table) |
| Forced publish check | changed [2025, 2026], WP Rocket cleaned both URLs, edge_state ok, 0 pending; cron every 5 min; one more 2026 publish at 05:38 (version settling after the API start), unchanged at 05:43 |
| `/`, desktop + iPhone, fetched twice | MISS then HIT; title "2026 (Weeks 1-11)"; X-SC-FPA-Cache edge-ttl=21600; 32 rows identical to origin (WP proxy) incl. games played |
| `?format=half&view=adjusted` bookmark | renders Half-PPR adjusted, identical to origin; canonical = base page |
| `/2025/`, desktop + iPhone | "2025 (Full Season)", 2025 rows identical to origin, edge-ttl=2592000, link back to current |
| Raw HTML | 0 `format=`/`view=` hrefs on all routes; 0 news.statchasers.com css/js; no current->2025 link |
| FAQ/schema (scripts/fpa-faq-schema-check.mjs) | current 5 Q, /2025/ 3 Q, every Q/A identical to visible text, in the route's own #webpage |
| Graph | Organization, WebSite, BreadcrumbList, page entity (FAQPage) at the route's #webpage, ImageObject; one og:image |
| og:image | https://statchasers.com/wp-content/uploads/2026/11/statchasers-og-default-1200x630-1.png: 200 image/png 1200x630 |
| Gibbs game log | 11/11 opponents' RB ranks = live FPA PPR table (ARI 13, BUF 12, CAR 1, CHI 23, GB 7, MIA 6, MIN 29, NE 15, NO 3, NYJ 8, TB 32), "through Week 11" |
| Code Snippets #28 | FPA tap-target rules removed; its 12px label rule kept (fpa.css still sets those labels at 11px; fold it into fpa.css later, and it covers only the base route, not /2025/) |
| Purge | purge-and-warm 05:42Z, MISS desktop + phone; warm crawl running |

Not rechecked live: Lighthouse score and CLS (local lab: CLS 0, sort 96-224 ms). SOS candidate 1.10.75 must now be rebased on 1.10.76.

