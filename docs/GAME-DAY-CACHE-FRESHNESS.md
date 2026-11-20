# Game-day cache freshness: layers, manual purge procedure, narrow policy options

Team Pages Phase 6 follow-up, 2026-11-20. Documentation and assessment only:
no cache lifetime, rule or automation has been changed, and nothing below runs
by itself.

## The layers between a final whistle and a reader

| Layer | What it holds | Lifetime (verified) |
|---|---|---|
| App data | league slate (nflverse) | shared 10 min |
| App data | ESPN live layer: scores, live state, kickoff times | 30 s during games, 15 min idle |
| App pages | team page HTML / fragment | max-age 60 s / 300 s, ETag |
| WordPress plugin | team page fragment (`sc_team_ssr_*`) | 1 hour (1 day backup) |
| WordPress plugin | matchup fragment (`sc_matchup_ssr_*`) | 5 min (1 day backup) |
| WP Rocket | full page HTML, desktop and mobile | 24 hours, then the cron clears the whole domain |
| Rocket.net edge (Cloudflare) | full page HTML | `s-maxage=2592000` (30 days), observed `cf-cache-status: HIT` |

The edge is purged by the Rocket.net mu-plugin (cdn-cache-management 1.1.14)
whenever WP Rocket clears the domain (`after_rocket_clean_domain` purges the
whole edge) or clears one post (`after_rocket_clean_post` purges that post's
URLs). So in practice:

- **Worst case a team page lags its data by about 25 hours**: up to 24 h in
  WP Rocket plus up to 1 h in the plugin's team fragment cache. That is the
  window in which a finished game can still read Live or upcoming, or an expired
  status can linger.
- **Matchup pages lag by up to 24 h** for the same WP Rocket reason; their
  plugin cache is only 5 min.
- **Every 24 h the whole site goes cold at once**: WP Rocket's lifespan cron
  clears the domain and that purges the entire edge. That is the stampede
  shape behind earlier post-publish stalls and wp_options lock storms, and it
  happens today regardless of anything below.

## Manual game-day purge procedure (safe)

Run once per slate: after Thursday night, after the last Sunday game, after
Monday night. Never during games.

1. **Wait 65 minutes after the last final whistle.** The plugin's team fragment
   cache lives 1 hour; purging earlier lets WordPress rebuild the page from the
   old fragment and cache it for another 24 hours.
2. **Confirm the data is final at the origin** (no cache in the way):
   `https://news.statchasers.com/team/<slug>/schedule/` for two clubs that
   played shows the final score and "View recap"; `/api/status` answers ok.
   If ESPN is blocked and a final is missing, stop: purging would only re-cache
   the old state.
3. **Purge in the documented order**, off-peak (late night ET), from SSH:
   `wp eval "rocket_clean_domain(); rocket_clean_minify();"` then
   `wp cdn purge`.
4. **Re-check** one team Schedule page and one pair page with an iPhone user
   agent: final score present, no Live badge, `cf-cache-status` MISS then HIT.
5. Do not purge again for the same slate. Each purge is a cold start for the
   whole site.

## Narrowly scoped options (need approval; none implemented)

1. **Targeted purge instead of the whole domain (recommended next step).**
   WP Rocket has `rocket_clean_files( $urls )`, and the Rocket.net plugin has a
   per-URL edge purge (`CDN_Clear_Cache_Api::cache_api_call( $paths, 'purge' )`,
   the call it uses for single posts). A manual script could purge only the
   clubs that played (their hub, /schedule/, /matchups/, /news/ pages) plus the
   pair pages of those games: about 150 URLs on a Sunday instead of the whole
   site. Origin load is a fraction of a domain purge and nothing else goes
   cold. It still runs by hand. To verify first, with approval: that the
   edge call takes paths or URLs, on one test URL.
2. **Shorter WP Rocket lifespan for team and matchup URLs only.** WP Rocket's
   lifespan is global; per-URL lifespans would need a small filter in our
   plugin. Not recommended now: more frequent regeneration is origin load, and
   it does not purge the edge on its own.
3. **Leave the 24 h lifespan alone.** Shortening it sitewide multiplies the
   daily cold start. Lengthening it (or turning off the lifespan cron and
   relying on purges) would remove the daily stampede but needs its own
   assessment: it is the main thing that eventually corrects a missed purge.

Nothing here touches the 30-day edge `s-maxage`; changing it is a Rocket.net
dashboard rule and outside this phase.
