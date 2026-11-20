# Release: Team Pages Phase 4 + Phase 5 (2026-11-20)

Branch `release/team-hubs-p4-p5-2026-11-20`, from production `1983d9e`
(865f637 code + Replit's publish commits, which only touched the ESPN
schedule cache; production assets c3df86836e7f).

| Commit | Content |
|---|---|
| 09b6c93 | Phase 4 (net of team-hubs-phase4-usage @f0f0854) |
| 6f6aa9a | Phase 5 (net of team-hubs-phase5-roster @dcf9a81) |
| 4248816 | Header Pending pill; validateDepthSnapshot.mjs; manual depth procedure |

## Included

- Shared availability rule: post-game Sleeper designations stand (marked not
  yet official) when they differ from the previous official report; the same
  status expires (Vaki). Player pages, team hubs, Depth Chart, Injury Watch,
  matchup previews.
- Usage: official rush attempts as carries (Lawrence 106 rush yds, Wentz +1),
  usage_2026.json rebuilt with the same snapshot (Week 10, 18376:11093).
- One share definition (games played) for per-player shares on the hub;
  "Club share" on the distribution boards; four definition lines.
- Player pages: status for players off the roster index (fullbacks, kickers,
  deep reserves); pending headline and header pill say Pending.
- Manual depth-chart validator and procedure (docs/DEPTH-CHART-MANUAL-UPDATE.md).

## Excluded

- The Phase 4 Usage layout (rejected by mak 2026-11-20).
- Player-page target-share adoption and header redesign (phase2-player-redesign,
  not approved): Brock Bowers' player page still prints 21.0% / 25.6% / 25.8%
  while the hub prints 25.4% until that ships.
- Depth-chart push, daily chain, any schedule: unchanged (off).
- WordPress plugin: no change; production stays on 1.10.58.

## Deploy (after mak's approval)

1. Confirm no other session is working in /home/runner/workspace.
2. `git worktree remove .local/release-p4p5`, then in /home/runner/workspace
   `git switch release/team-hubs-p4-p5-2026-11-20`. (The modified
   espn-layer-2026.json is a runtime cache; it carries over untouched.)
3. `pnpm --filter @workspace/api-server run build`, restart the preview
   (scripts/dev-restart.sh), smoke-check /team/new-york-jets/news/,
   /team/las-vegas-raiders/usage/, /player/josh-jacobs.
4. mak presses Publish. No secret changes (SC_SCORING_TOTALS=house stays).
5. Verify production BEFORE any cache purge: news.statchasers.com
   /dist/version.json shows the new asset version; cache-busted
   statchasers.com pages (?x=...) show Geno Smith Questionable in the Jets'
   Injury Watch, "Pending" in Josh Jacobs' header, "Club share" on a Usage tab.
6. Then purge: WP Rocket (`wp eval "rocket_clean_domain(); rocket_clean_minify();"`),
   then the Rocket.net edge (`wp cdn purge`); check cf-cache-status MISS with a
   desktop and an iPhone user agent.

## Rollback

- API: in /home/runner/workspace `git switch team-hubs-integration-2026-11-19`
  (1983d9e, the current production build), build, Publish, purge as in 6.
- Plugin: unchanged by this release. Backups on the server:
  ~/tmp/statchasers-news-1.10.58-backup-20261120 (current) and
  ~/tmp/statchasers-news-1.10.57-backup-20261119 (previous).
