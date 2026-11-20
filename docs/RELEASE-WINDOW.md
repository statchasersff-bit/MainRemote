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

## Log

| Date (UTC) | Release | SEO-surface change? |
|---|---|---|
| 2026-11-20 | seo-defect-fixes-2026-11-20 (FAQ week, team hub preseason outlook, warm passes, coverage alert) | Content removal on the team hub (approved) |
