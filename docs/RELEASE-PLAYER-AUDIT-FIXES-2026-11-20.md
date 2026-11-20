# Release: player audit fixes (2026-11-20)

Branch `release/player-audit-fixes-2026-11-20` (= `player-audit-2026-11-20`), from production d4d63e2 (publish
468f99a). Approved by mak in principle on 2026-11-20, subject to the verification below. Not published, merged or purged.
Design unchanged: no CSS, client script, public asset, data file, plugin or configuration change.

## Content

| Commit | Fix | Pages affected |
|---|---|---|
| 824a429 | Game Log: each game credited to the club he played for that week (per-game target share, result, W-L record; News recap share) | 90+ players with a 2026 roster change on their club; 14 traded players |
| ed83bcc | No Stats link where the player has no Stats tab | 63 players (34 kickers, 29 with no NFL game) + 32 team defenses, 628 links |
| 3ac34f4 | QB FAQ: "completing 201 of 320 passes" | every QB Stats FAQ |
| fa457ee | Sitemap: Stats and Game Log join `emptySections` | 92 sitemap URLs dropped (63 /stats/, 29 /game-log/) |
| b6ff460 | No `dateModified` from another season's schedule | 24 players, 94 fragments (59 had future dates) |
| ea92984 | Outlook "through Week N" = the club's completed week | Outlook FAQ + starting-QB lines, Thursday to Monday |
| 902e7c9, 028c733 | "1 yard", "1 catch", "1 time" | News recap line, Game Log FAQ |
| 06a01e1, c9f84bc | Tests | 13 new tests |
| 3cb40fd + this file | Docs | none at runtime |

## Verification (against the production code, same data)

1. **Baseline**: production still d4d63e2 (publish 468f99a, nothing published since 20:29 UTC); plugin 1.10.60.
2. **Scope**: `git diff d4d63e2..HEAD` = 9 source files under src/lib/player*, src/routes/player.ts, 5 test files, 2 docs.
   Zero CSS, client, public, data, plugin or config files.
3. **HTML and SEO, every page**: 681 slugs x 7 routes (4,767 pages). 0 changes to status, title, meta description,
   canonical, robots, Open Graph, H1, JSON-LD types or FAQ questions on any page. FAQPage == visible FAQ on every branch
   page (0 mismatches). Every changed page is one of the fixes; the numbers on changed pages are unchanged apart from the
   intended target shares, traded-game scores and W-L records.
4. **22 News pages** whose team headlines differed: identical when both servers are read at the same moment (feed
   timing, not code).
5. **Sitemap** (simulated from the live sitemap and both APIs' roster lists, with the plugin's own skip rule): 3,682
   section URLs today, 3,590 after; exactly 92 removed, 0 added. Every removed URL 302s to its player's profile on
   production and on the branch, and that profile stays in the sitemap. All 3,590 kept section URLs answer 200.
   **Internal links**: all 8,711 internal player links on the branch pages answer 200 (no redirects, no 404s).
6. **dateModified** (the embed page-data `modified` WordPress turns into JSON-LD, all 4,767 fragments): 94 changes, all
   removals (no date replaced by another), 24 players whose newest game is from an earlier season; 0 future dates and
   0 malformed dates after (format YYYY-MM-DD, the Eastern calendar day of his latest game's kickoff, never the render
   or deploy time). Players with 2026 games keep their date unchanged (2,682 fragments). The live page carries no other
   modification date (no og:updated_time or article:modified_time); the sitemap lastmod is the WordPress page date
   (separate finding SEO-10, not in scope).
7. **Source data**: all 3,969 active 2026 game-log rows recomputed independently from the raw logs and the scores file:
   0 target-share and 0 result mismatches (14 traded players included). Completed-week rule tested for a club yet to
   play, a Thursday game, a bye week, Monday night pending, and before Week 1.
8. **Full suite** (90 files, serially): production 1,771 pass / 14 fail / 1 skipped; release 1,784 / 14 / 1. Same failing
   test names in every file (known data-drift set).
9. **Design**: no stylesheet or client file changed; class sets unchanged on every page (only text and the removed
   links differ).

## Deploy (after mak's go, inside the 14:00-16:00 UTC window, docs/RELEASE-WINDOW.md)

1. Ask the other sessions whether /home/runner/workspace is free (workspace-f2 has a team branch touching
   outlook-tab.ts; release this first and tell it the commit).
2. In /home/runner/workspace: `git switch release/player-audit-fixes-2026-11-20` (no uncommitted work there first).
3. `pnpm --filter @workspace/api-server run build`, restart the preview, smoke-check on 8080:
   /player/josh-downs/game-log/ (Week 3 31.4%, Week 10 W 35-13), /player/brandon-aubrey/ (no /stats/ link),
   /embed/players.json (emptySections has stats/game-log), /player/josh-allen/outlook/.
4. mak presses Publish. No secrets.
5. Verify production before any purge: /api/status build commit = the release; `/embed/assets.json` shows the new
   build, and a fresh render prints the new `ver=`; then wait 5 more minutes.
6. Purge through purge-and-warm (WP Rocket desktop and mobile first, then the Rocket.net edge), warm phones first.
7. Sitemap: updates when the plugin's roster transient (6 h) expires; to apply at once, delete `sc_player_roster`
   (a WordPress write: mak's OK). Then fetch page-sitemap1.xml and confirm the 92 URLs are gone.

## Rollback

Switch /home/runner/workspace back to d4d63e2 (`player-faq-week-2026-11-20`, publish 468f99a), build, Publish, purge
as in step 6. No data, plugin or WordPress state to undo; the sitemap regains the 92 URLs at the next roster refresh.
No destructive git commands needed.
