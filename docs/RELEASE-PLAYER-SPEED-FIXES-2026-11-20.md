# Release: Player page speed and correctness fixes (2026-11-20)

Branch `player-speed-fixes-2026-11-20`, from production `bfb90ab` (the
published Phase 6 team release: 8c949c7 code plus Replit's empty publish
commit). The player-page design is unchanged: the Phase 2 redesign
(`phase2-player-redesign`) is shelved and none of it is in this release.

| Commit | Content |
|---|---|
| 6a85254 | Data build caches: one Intl formatter per zone and memoized Eastern conversions in the schedule; sorted position tables cached per game-log snapshot. Server-Timing header on player fragments. |
| d28afe9 | Correctness fixes: one target-share definition on the Overview gauge; kicker recap stat line FG/XP; "St. Brown" surname particle; Outlook passer guard. |
| c2f480d | A tab's own URL builds only that tab (the profile still builds every panel). |
| 0505ba8 | Stats tab: target and snap share use the shared definition and rank in the card's own qualified pool. |
| f71b0e9 | Kicker recaps: kicks counted for the sentence, never as a "Volume boost". |
| ed0ce4b | Overview on phones (560px and below): Season Stats and Weekly Performance cards lose their extra air. Added at mak's decision; written uncommitted in the shared workspace at 14:02 by another session, moved here byte-identical. |

Files: public/player.css (+66 lines, one 560px media block, from ed0ce4b) and
11 TypeScript files under artifacts/api-server/src: player-render.ts,
player-ssr.ts, routes/player.ts, schedule/schedule-data.ts,
player/{player-data, overview-data, stats-tab, stats-tab-data,
news-tab-data, outlook-tab, bio-tab-data}.ts. No other CSS or public
assets, no data files, no tests, no WordPress plugin, no configuration or
secrets, no new startup task or data migration.

## Target share: the definition and the rank

- Value: his targets / his clubs' targets, summed over the games he played
  (a target or an offensive snap), every club (team/usage-share.ts, already
  in production for the team hubs). Recomputed independently from
  data/team/usage_2026.json: St. Brown 91 / 301 = 30.2%.
- Rank: among the Stats card's qualified WRs, the same pool and footnote as
  every other row in the card ("112 qualified WRs (15+ targets, 4+ games and
  a 25%+ snap share)"). St. Brown: 6th of 112.
- Before: the Stats row measured targets / team pass attempts (St. Brown
  also 30.2% by coincidence, 3rd of 112); the Overview gauge divided by
  log-summed club targets. Under the shared definition five qualified
  receivers are above him (Smith-Njigba 37.1, Nacua 36.0, DeVonta Smith
  32.8, Lamb 32.1, Jefferson 30.8 against his 30.2), so 6th; three of them
  were below him under the pass-attempt figure. Bowers: 25.4%, 3rd of 47 TEs, on
  both the gauge and the Stats row (was 21.0% / 25.6%). Harrison Jr.: 9.8%
  over both clubs.
- The "6th of 175 WRs with 4+ games" figure from the first draft (the shared
  module's own league rank) is not used on player pages: it ranked against a
  different pool from the rest of the card.

## Verification (on f71b0e9, against 8c949c7 = production code)

- Every line of every route's HTML, 156 players x 7 routes (1,106 pages):
  307 pages differ, every changed hunk is one of the fixes (target/snap share
  1,532 hunks incl. derived sentences and gauge, kicker recap 460, passer
  guard 8, surname 2); 0 unclassified. 0 changes to titles, page-data
  islands or JSON-LD. Class set identical on every page; element counts
  identical except 3 players' Outlook/profile, which lose the false "A new
  quarterback" risk (Casey Washington, now CAR, was told Penix threw most of
  the passes).
- Scoring, finishes, injury statuses and game-log totals: no change anywhere
  in the 1,106 pages; the data-accuracy suite is identical.
- Screenshots, 5 players x 7 routes x 390 / 1280: no layout change; the
  differing pixels sit on the changed text (two Pacheco Outlook shots are
  36 px shorter, the removed false risk).
- Full suite (85 files, serially): candidate 1,717 tests, 1,702 pass,
  14 fail, 1 skipped; production code the same counts, same failing tests by
  name (matchup 1, player-outlook-title 1, player 3, schedule 3,
  table-armour 2, team-coaching 1, team-depth-chart 2, team 1).
- Server time (warm, median): profile 76 -> 39 ms, tab URLs 79 -> 24 ms.
  First request after a server start 3.8 s -> 1.1 s.

- ed0ce4b (phone Overview): only the 390px profile changes height (42-124 px
  shorter on 5 players); 768 and 1280 heights identical. Full suite on
  ed0ce4b: see the release report.

## Deploy (after mak's approval)

1. Confirm no other session is working in /home/runner/workspace.
2. In /home/runner/workspace, `git switch player-speed-fixes-2026-11-20`
   (the modified espn-layer-2026.json is a runtime cache; it carries over).
3. `pnpm --filter @workspace/api-server run build`, restart the preview
   (scripts/dev-restart.sh), smoke-check /player/amon-ra-st-brown/stats/
   (Target share 30.2%, 6th of 112), /player/brock-bowers/ (gauge 25.4%),
   /player/tyler-bass/news/ (FG/XP line), /team/detroit-lions/.
4. mak presses Publish. No secret changes.
5. Verify production BEFORE any purge: news.statchasers.com/dist/version.json
   shows the new build; a cache-busted statchasers.com player Stats page
   (?x=...) shows the new target-share rank.
6. Then purge: WP Rocket (`wp eval "rocket_clean_domain(); rocket_clean_minify();"`),
   then the Rocket.net edge (`wp cdn purge`); check cf-cache-status MISS with
   a desktop and an iPhone user agent.

## Rollback

- API only: in /home/runner/workspace `git switch release/team-hubs-p6-2026-11-20`
  (bfb90ab, the current production build), build, Publish, then purge as in
  step 6. Replit's deployment history can also restore the previous
  deployment directly.
- WordPress plugin: untouched by this release (stays on its current version);
  nothing to roll back there.
