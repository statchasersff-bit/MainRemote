# Release window: batch publishes, purge once, warm after

Adopted 2026-11-20 from the SEO investigation's defect list, approved by mak.

## Why

**November's release pattern kept the site cold for search crawlers.**

- November had 2-8 Replit publishes a day, and most were followed by a site-wide purge.
- **A purge throws away every cached page,** including what the server's boot-time warm crawl had just filled.
- **Until something asks for a page again, it is a cold render.** On 2026-11-20, after a purge:

  | Measure (169 live URLs) | Time |
  |---|---|
  | Median | 1.56 s |
  | p90 | 4.3 s |
  | Worst | 18 s |
  | A cached copy | 0.07-0.1 s |

- **Phones have their own copy of every page.** WP Rocket's mobile cache and the Rocket.net edge both keep one. Googlebot crawls as a smartphone, so a desktop-only warm leaves the copy Google indexes cold.

**What this cost:**

- Googlebot met slow first renders after every release, several times a day.
- Template-wide changes went live in many small steps. That gave Google a moving target: titles, H1s and structure changed on Nov 3, 4, 5, 6 and 11.

## The window

1. **One publish per day, at most, in one window: 14:00-16:00 UTC (9-11 AM ET).**
   - That is after the overnight data refresh and before the US afternoon peak.
   - **Never during a game window** (November times, EST = UTC-5):
     - Thursday night: Friday 00:00-04:00 UTC
     - Sunday: 17:00 UTC Sunday to 04:00 UTC Monday
     - Monday night: Tuesday 00:00-04:00 UTC
     - Saturday 17:00 UTC to Sunday 04:00 UTC when December Saturday games are on
2. **Everything for that day goes into one release branch.**
   - Changes from different sessions ride together, merged and tested once.
   - The release session announces the window to the other sessions before it starts.
3. **Data refreshes are not releases.** A data rebuild that needs no publish does not trigger a purge. The plugin's per-player sibling purge already handles changed player data.
4. **Plugin uploads ride the same window.** Deploy the plugin first when the release needs it (see each release note), then the app.
5. **SEO-surface changes need their own release, and are kept rare.** This covers titles, meta descriptions, H1s, structured data, index rules, and moving content between URLs.
   - At most one such change per page family per 3-4 weeks.
   - None during a Google core update rollout.
   - Each one is logged here with its date, so Search Console reads can be lined up against it.
6. **Urgent fixes** (an outage, wrong data on the page) may go outside the window. They still follow steps 7-8.

## After the publish

7. **Wait for production to report the new build.** Check `https://news.statchasers.com/api/status` (`datasets.build.commit`) and the plugin's `?ver=` on a fresh render.
   - The server's own boot warm starts by itself (`[live-warm]` in the deployment logs). Since 2026-11-20 it runs a phone pass, then a desktop pass.
8. **Purge only through the script, so the purge is always followed by a warm:**

   ```
   cd artifacts/api-server
   nohup pnpm purge-and-warm > ~/purge-and-warm.log 2>&1 &
   ```

   - It clears WP Rocket (desktop and mobile), then the Rocket.net edge.
   - It checks that a probe page is no longer a HIT for both a desktop and a phone user agent.
   - It warms every sitemap page as a phone, then team pages and player hubs as a desktop.
   - It takes about 2.5 h at the site's 1.6 s rate limit. `--quick` warms teams and hubs only (~50 min).
   - **If mak purged by hand from the Rocket.net dashboard, run it with `--no-purge`** so the warm still happens.
9. **Verify:** sample a few pages with a desktop and an iPhone user agent (`curl -sI`, look for `cf-cache-status: HIT` and a sub-second TTFB) once the phone pass has reached them.

## Reserved slots

| Slot (UTC) | Family | Release | Why this slot | What rides (and nothing else) |
|---|---|---|---|---|
| ~~2026-12-15 (Tue) 14:00-16:00~~ RELEASED EARLY 2026-11-26 (mak: "push to production", chose "Right now" over the slot and today's window) | Player pages (`/nfl/players/...`) + the FPA page | integ/player-audit-2026-11-26, plugin 1.10.74 (reserved 2026-11-26 for mak) | The player family's last SEO-surface change shipped 2026-11-24 19:45 (injury meta wording, after the 2026-11-20 FAQ/dateModified/sitemap release), so three weeks puts the next one at 2026-12-15 at the earliest. Tuesday is clear of every game window (Monday night ends 04:00 UTC). The Google November 2026 core update began 2026-11-10 (Search Status Dashboard; up to two weeks, completion not confirmed as of 11-26): re-check the dashboard shows it complete before the slot, and move the slot if any core update is rolling out that day | 648 player hub titles ("{Name} NFL Stats & News \| StatChasers") and tab titles held to 60 characters; FAQ/FAQPage reductions (hub = Overview FAQ, 10 per page, Bio duplicates out, IR matchup FAQs out); one-hop 301s for case/slash/`/overview/`/`-N`/`?log=` variants and VERIFIED alias slugs (e.g. mitchell-tinsley -> mitch-tinsley); page-sitemap duplicate and alias rows out; FPA page default PPR; then the retitle pass and the trash of WP 4927/4929. Unrelated releases stay out of this slot. |

Pending elsewhere, not in this slot: team candidate plugin 1.10.73 (integ/team1125), its own release. Whichever of 1.10.73 / 1.10.74 ships second carries the other.

## Log

| Date (UTC) | Release | SEO-surface change? |
|---|---|---|
| 2026-11-20 | seo-defect-fixes-2026-11-20 (FAQ week, team hub preseason outlook, warm passes, coverage alert) | Content removal on the team hub (approved) |
| 2026-11-20 22:12 (outside the window, mak's call) | release/player-audit-fixes-2026-11-20 @db185d5, publish fdfdd0a: traded-player Game Log, dead Stats links, sitemap drops 92 redirecting section URLs, dateModified removed where taken from another season, Outlook "through Week N", FAQ wording | Yes (approved): FAQ/FAQPage text, ProfilePage/WebPage dateModified, sitemap entries |
| 2026-11-23 ~07:00 (outside the window, mak's call) | release/team-fixes-2026-11-20 @bdadaa4: week 11 Sunday data rebuild (12 of 13 games), recap scoring list gains safeties, return touchdowns and tries, 12 new recaps; unreviewed player/team design WIP held back on wip/held-from-publish-2026-11-23 | No (recap prose and data-driven week-11 titles only) |
| 2026-11-24 14:00-16:00 UTC (in the window) | release/2026-11-24 (main 54ce4e4 minus WEB-001, plugin 1.10.63 sha 070dd12b): WEB-044 team tables + player links + roster link, held 11-23 player/team design WIP, player section heads, WEB-037 recap accuracy, WEB-039 injury status, PPG rank, WEB-041/024 matchup trims + Divi late CSS, WEB-040 schedule status/cache, WEB-013 404 heads, WEB-021 schedule/SOS schema + share image, WEB-022 schedule titles, week 11 data. WEB-001 held for 12-02 | Yes (mak, "lets get this live"): schedule titles (WEB-022) and schedule/SOS schema (WEB-021), matchup FAQ trimmed to 5 (WEB-041), 404 heads noindex with no canonical (WEB-013) |
| 2026-11-24 19:45 (outside the window, mak's call) | integ/matchup-p1-p4-2026-11-24 @38d5199 (API) + plugin 1.10.65: WEB-001 game canonicals released (the 12-02 hold lifted), WEB-037/041/024 finish, WEB-040/003 live matchup pages, WEB-039 verify, injury designation wording | Yes (mak): game canonicals and sitemap, series page title/H1, injury meta wording |
| 2026-11-24 ~20:05 (plugin only, outside the window, mak's call) | plugin 1.10.66 (sha 53fe684e) on API 38d5199: team pages join page identity (Org/WebSite/WebPage, brand-card og:image), team descriptions <= 160 | Yes (mak): team og:image, schema graph, descriptions, hub breadcrumb name |
| 2026-11-25 14:18 (in the window) | main @19a20a3 (publish 10e8de0) + plugin 1.10.68 (sha 4e1769db, includes 1.10.67): team audit (WEB-044 finish, WEB-043 Coaching labels, Usage receiving reconciliation, hub FAQ 21 -> 5-6, 2025 results on the Schedule tab), NFL Player Stats audit (WEB-003/002/020/021), Rookie Hit Rates inside statchasers-news (standalone plugin deleted, backup ~/tmp/statchasers-rookie-hit-rates-1.0.0-backup-20261125). purge-and-warm 14:37 UTC | Yes (mak): hub FAQ/FAQPage, Coaching FAQ answers, player stats page identity + ?season= 301 |
| 2026-11-25 15:42 (in the window) | main @efbe131 + plugin 1.10.70 (sha 2ce36e94, includes 1.10.69): team share cards (/og/team/<slug>.png as og:image, twitter:image and primaryImageOfPage; AVIF crests no longer the schema image), 33 stored team hub/directory descriptions rewritten (backup option statchasers_team_desc_backup_20261125), ROS rankings WEB-028/029/021/006 (workspace-6d; redirects applied by 6d). purge-and-warm 15:50 UTC; ROS verify 115/0 | Yes (mak): team og:image, hub/directory descriptions, ROS page identity + redirects |
| 2026-11-25 16:16 (outside the window, mak's call) | main @f3c6dd7 + plugin 1.10.71 (sha 916680a5, depth charts 1.7.6): NFL Depth Charts audit (WEB-003 cache + timestamp, WEB-023 local assets, WEB-021 identity) by workspace-78, installed by workspace-f0. First publish check: 32 clubs published, edge ok, 8 staggered warms; second poll unchanged. One purge-and-warm 16:26 UTC (replaced the 15:50 run) | Yes (mak, via workspace-78): depth charts hub share image + schema |
| 2026-11-25 16:59 (outside the window, mak's call) | main @d7ebbe1 (publish built 16:48) + plugin 1.10.72 (sha 31582b65, includes 1.10.71) by workspace-78: edge purge retry (failed Rocket.net purges retried at 5/10/20/40/80 min, 6 attempts; depth hub, 32 Depth Chart tabs, NFL Player Stats, consumers) and depth snapshot consumers (Draft tab Pos + matchup Player Battles purged on a chart change). Backup ~/tmp/statchasers-news-1.10.71-backup-20261125. purge-and-warm 17:00 UTC. First checks: depth tabs unchanged, consumers baseline recorded, stats unchanged | No |
| 2026-11-26 (outside the window, mak's call: "push to production" / "Right now", 12-15 slot given up) | main @603cf835 (integ/player-audit-2026-11-26) + plugin 1.10.74 (sha 560e9588): player audit items 1-6 (WEB-033 difficulty ranks + FPA default PPR, WEB-036 career scoring note, WEB-039 durability card, WEB-035/030/034 rank labels + IR outlook, WEB-044 one FAQ/rail on the hub, WEB-012/005/020/008/017/025/029/022 duplicate builder race, sitemap dedupe, one-hop 301s incl. verified aliases, ?log= buttons, start/sit links, 60-char titles). Does NOT include team candidate 1.10.73 (integ/team1125). Release checks: scripts/player-audit-release-check.mjs vs docs/PLAYER-AUDIT-BASELINE-2026-11-26.json. LIVE: first publish 04:50 built old HEAD 4cb49ac9 (pressed before the fast-forward), second publish = build 3032dccf (05:34Z); plugin 1.10.74 installed 05:34Z over SSH (backup ~/tmp/statchasers-news-1.10.72-backup-20261126); purge-and-warm 05:55Z (MISS desktop+phone, phone warm of 4,493 pages running, log ~/purge-and-warm-20261126.log); FPA plain/ppr = PPR, half, standard verified desktop+iPhone; Gibbs hub new title, 8 FAQPage, 0 ?log= links, 0 /redraft-command/players/; after-read docs/PLAYER-AUDIT-AFTER-2026-11-26.json. WP: 4927/4929 had been set to draft at 03:51Z by a Claude MCP client (audit ids 1402/1403), trashed ~06:00Z; 729 stored hub titles retitled (backup ~/tmp/player-titles-backup-20261126.json, dry run ~/tmp/player-retitle-dryrun-20261126.json); alias pages 7028/4909 trashed, 301s still answer. Known: Rocket.net edge keys `//` paths as the single-slash URL (cached canonical copy, 301 only on a MISS); uppercase alias + `//` takes 2 hops (plugin follow-up). Rollback: reinstall the 1.10.72 backup + republish d7ebbe1 tree; titles from the backup JSON | Yes (mak): 648 hub + tab titles, FAQ/FAQPage reductions, redirects, sitemap, FPA default format |
| 2026-11-27 (outside the window, mak: "remove it" / "yes"; WordPress content edit, no publish or plugin) | Page 1319 /nfl/rookie-hit-rates/ content via MCP wp_replace_in_post (sha 87f3d1dc -> 9230b859): deleted the HTML comment naming Sleeper API / NFLfastR / PFR; FAQPage answer "Where does the data come from?" set to the visible answer wording (Sleeper API and Pro-Football-Reference removed). Saving the page cleared its caches; no purge script run | Yes (approved): FAQPage JSON-LD answer text on page 1319, now matches the visible FAQ |
| 2026-11-27 05:27-05:45 (outside the window, mak's call: "after these changes, do it") | main @ebb0c4d6 (integ/fpa-audit-2026-11-27, publish 5db6ddaa, build ebb0c4d6) + plugin 1.10.76 (sha 82c6e81c): FPA audit items 1-6 (WEB-033 band words + tests, WEB-003 FPA publish check, WEB-020/025 buttons + #state, WEB-049/050/023 24px targets + same-origin fpa.css/js, WEB-030 FAQ 19->5 and 3 on /2025/, WEB-021 FPA page identity) and mak's 11-27 decisions (complete weeks only, no current->2025 link, difficulty corner marks, matchup 'not soft' at the Soft band). Production FPA ingest re-run 05:33Z (week_12 partial -> week_11). Plugin installed 05:35Z over SSH (backup ~/tmp/statchasers-news-1.10.74-backup-20261127); forced publish check: both seasons, edge ok. Code Snippets #28 (sc28-a11y): FPA tap-target rules removed, 12px label rule kept (backup ~/tmp/snippet-28-backup-20261127.php). purge-and-warm 05:42Z (MISS desktop+phone; log .local/fpa1127/purge-and-warm-20261127.log). Does NOT include SOS candidate 1.10.75. Rollback: reinstall the 1.10.74 backup + republish 773bb934 tree, restore snippet 28 from backup, re-run FPA ingest | Yes (mak): FAQ/FAQPage on both FPA routes, FPA WebPage/WebSite/Organization graph, archive link removal, FAQ blend wording |
| 2026-11-27 14:53 (in the window; second publish today after the 05:45 FPA release, mak's call: "commit to main and get live on production") | main @1d67b832, app only (no plugin): upcoming-preview rail heads (Injury Watch / Offense vs Defense) match the card heads; Game Flow fallback (before a game's pbp is stored) as the rebuilt tab's section cards; week 12 early games' box scores + pbp (GB@LAR, CHI@DET, PHI@DAL, KC@BUF) and six checked recaps (4 new, JAX@NYG + NYJ@LAC re-stored). Other sessions (player audit, data audit) confirmed nothing to ride. Verified live desktop + iPhone on the KC@BUF game page and the NE@LAC preview; purge-and-warm 14:54Z (probe MISS desktop + phone, phone warm of 4,493 pages, log ~/purge-and-warm-20261127b.log) | No |
