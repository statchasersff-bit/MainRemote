=== StatChasers ===
Contributors: statchasers
Requires at least: 6.3
Requires PHP: 7.4
Stable tag: 1.10.25
License: GPL-2.0-or-later

Mounts the StatChasers NFL news tool, the 32 team hubs, the player pages, the Fantasy Points Allowed table, the rest-of-season rankings, the NFL schedule, the advanced player stats, the RB handcuff rankings, the fantasy football strength of schedule and the dynasty rookie hit rates into WordPress pages.

== Why this file exists ==

WordPress reads the plugin version from the PHP header, and PHP files execute
rather than serve - so from outside the server there is no way to tell which
version is actually on disk. This file is served as-is, so

    https://<site>/wp-content/plugins/statchasers-news/readme.txt

answers that question directly, with a Last-Modified header that says when the
upload landed. Keep "Stable tag" in step with the Version header.

== Changelog ==

= 1.10.25 =
* Webfonts: one loader per family, each a dependency of the one stylesheet that names it, never an enqueue of its own. Inter (handle statchasers-font) is the dependency of every tool stylesheet, as before, now at five weights, 400 to 800; every font-weight: 900 in the served stylesheets became 800 (86 declarations, 61 of them in team.css), so the heaviest file is no longer downloaded for nothing. Barlow and Barlow Condensed (new handle statchasers-display-font, filter statchasers_matchup_font_url unchanged) are a dependency of team.css instead of being enqueued by hand in both the hub and the matchup code, so they print exactly where a hub or a matchup mounts. Archivo stays a dependency of player.css only. DM Sans and Space Grotesk, the NFL schedule's type, move out of an @import at the top of schedule.css - which went straight to Google on every schedule page, past the enqueue system and past OMGF - into a dependency of schedule.css (handle statchasers-schedule-font, filter statchasers_schedule_font_url). Needs the matching API deploy for the stylesheet changes.
* No preconnect to fonts.googleapis.com or fonts.gstatic.com from this plugin any more (the matchup pages used to print one): OMGF self-hosts the fonts, so there was nothing at those hosts to connect to.

= 1.10.24 =
* Prints the mobile header's layout rules in <head> on every page (style id statchasers-header, filter statchasers_header_css): zero padding on the logo bar's section and row and on the section holding the menu overlay, and the overlay hidden until it opens. Divi's Critical CSS defers those rules, so phones painted the header about 320px too tall and the page jumped when the deferred file landed, 0.35 to 0.61 CLS on the tool pages. Selectors use the row's custom class and the overlay's id, not Divi's generated class names. See docs/CLS-ANALYSIS.md.

= 1.10.23 =
* Player section URLs with nothing behind them now redirect (302) to the profile: a healthy player's /injury/ and a kicker's /outlook/ used to serve the whole profile under the section's title and canonical, about 340 duplicate pages. The API flags such a fragment with {"missing":true} in its page-data island, and the sitemap leaves those addresses out (the roster's new emptySections field). Needs the matching API deploy.
* Player section titles no longer end in " | StatChasers" (approved by mak): with it, every section but News ran 66 to 95 characters. Wording unchanged; the profile's stored title keeps the suffix.
* Profiles whose player has left the indexed roster are kept, as before, but now noindex, follow (profile and section URLs) and out of the page sitemap. An unreachable API (empty roster) changes nothing.
* The sitemap index no longer lists /sitemap-players.xml, which 404s. It is added by something outside this plugin; stripped at the last priority of rank_math/sitemap/index.

= 1.10.22 =
* New shortcode: [statchasers_rookie_hit_rates], the dynasty rookie hit rate tool, ported from the standalone Rookie-Hit-Rate app. The API renders the default view (Superflex, PPR, Top-12, every class, 8-game minimum) with all four tabs in the page's HTML: the hit rate heatmap and Pick Lens, the pick-range breakdown, the trend and time-to-breakout charts, the patience and remaining-odds tables, and the player explorer. Every other filter combination is computed in the browser from the same dataset with the same model. No attributes and no query string; the canonical is the bare page. The fragment carries the page's title, H1 and meta description, applied through Rank Math and core; no schema node is added. The page words are pending approval.
* The browser proxy forwards a sixth path, embed/rookie-hit-rates/data, for the tool's dataset.
* Needs the matching API deploy.

= 1.10.21 =
* House style: every em dash removed from the plugin (comments, admin copy, tests). No behaviour change. The upcoming matchup pages' new decision layer (betting strip, Start/Sit, leverage, FAQ) ships in the API fragment; its title, meta description and FAQ island ride the existing X-Matchup-* headers and faq-data island, so no plugin code changed for it.

= 1.10.20 =
* Team hubs get a seventh section address, /nfl/teams/<team>/usage/ - the Usage & Opportunity Report (approved): its own H1 ("<Team> Usage & Opportunity Report <season>"), title ("<Team> Target Share & Snap Counts <season>: Usage Report"), meta description, breadcrumb and sitemap entry, mirroring the API. The team rewrite now remembers its rule signature, so this upgrade flushes permalinks by itself. Needs the matching API deploy.

= 1.10.19 =
* Team hubs load Barlow Condensed (the matchup pages' face, same handle and URL) for the new Usage & Opportunity Report's numbers. The report itself ships in the API's hub fragment; this release only adds the font. Without it the numbers fall back to Arial Narrow.

= 1.10.18 =
* New shortcode: [statchasers_strength_of_schedule], the fantasy football strength of schedule, ported from the standalone Strength-of-Schedule-SOS app. That app's own plugin ([statchasers_sos]) shipped a June data snapshot inside itself and drew the board in a Shadow DOM over a server-rendered copy; now the API computes the board from the live FPA table and the season's schedule and the shortcode prints it, like the other tools. Team SOS and Player SOS, QB/RB/WR/TE, PPR/Half-PPR/Standard: every weekly opponent, aFPA and rank is in the page's HTML. The view is shareable as ?tab=&pos=&scoring= on the page, read back only on the page that mounts the board and only from those lists; the canonical stays the bare page. The fragment carries the page's title, H1 and meta description (approved), applied through Rank Math and core; no schema node is added.
* The browser proxy forwards a fifth path, embed/sos, for the board's tab, position and scoring switch.
* To switch over: replace [statchasers_sos] with [statchasers_strength_of_schedule] on /nfl/fantasy-football-strength-of-schedule/, then deactivate and delete the old "StatChasers Strength of Schedule" plugin, whose title, description, canonical and schema filters would otherwise fight these. Needs the matching API deploy.

= 1.10.17 =
* The RB handcuffs board is held to the site's content width. It was the one tool that never loaded the width cap, so on a builder page it ran the width of the window and grew wider as the page was zoomed out. The page also drops the sidebar column, like every other tool page.

= 1.10.16 =
* Matchup recap pages get a share card. The app draws a 1200×630 image for each completed game (/og/<away>-vs-<home>-<season>-<round>.png on the app's origin, served without the embed key so social crawlers can fetch it), and the plugin adds it as og:image and twitter:image with its alt text, a large Twitter card and og:type article, through Rank Math's Open Graph hooks, or printed directly when Rank Math is not active.
* The recap's meta description is the app's own (the result, the venue, and what the page holds) when the app sends one.
* The highlights video is added to the schema graph as a VideoObject, lifted from the fragment like the SportsEvent and the FAQ.

= 1.10.15 =
* The schedule shortcode no longer accepts view="team" or sends team (the API dropped that view), and sends filter only to the weekly board.

= 1.10.14 =
* The StatChasers app can be locked so that only this site can read it. Set the same secret as `STATCHASERS_EMBED_KEY` in wp-config.php and `SC_EMBED_KEY` on the app, and the app refuses fragment, data and standalone-page requests that do not carry it; the plugin adds it to every request it makes to the app. Without the constant nothing changes.
* New proxy at /wp-json/statchasers/v1/p/ for the four widgets that fetch from the reader's browser (Player Stats table, FPA, RB Handcuffs cards, news refresh). It forwards only those four paths, adds the key, and caches each answer for five minutes. The app points the widgets at it once `SC_BROWSER_PROXY` is set on the app. Rollout order is in README.md, "Locking the app to WordPress".

= 1.10.13 =
* Player pages load two more webfonts, for the redesigned profile header and the Overview tab's new lower sections: Archivo with its width axis (the header's name and figures are set condensed) and Source Serif 4 (the Overview's written read). Registered as dependencies of the player stylesheet, so they load only where a player page or the index mounts. Return '' from the `statchasers_player_header_font_url` filter to serve them yourself or not at all.
* Matchup pages: the scoreboard hero loads its own webfonts (Barlow and Barlow Condensed, `statchasers_matchup_font_url` filter) with preconnect hints; the hero's heading can be promoted to the page's H1; the featured game is added to Rank Math's graph as a SportsEvent, with the recap's FAQ as a FAQPage node, and printed on their own when no schema plugin is present; and the page title picks the most descriptive candidate that fits in 70 characters, mirroring the API.

= 1.10.12 =
* A player link is printed only when this site has published that player's page. The API links a name as soon as the player joins its index (14:00 UTC and at each boot), and the page builder runs at 15:00 UTC, so a new signing's name in recaps, hubs and rankings pointed at a 404 until then. A crawl on 2026-09-28 found five in game recaps. Every [statchasers_*] shortcode, the Divi hub module and the self-mounting /nfl/players/ and /nfl/teams/ pages now print such a name as plain text, and it becomes a link again when the page is published. Links to other hosts and to the retired /nfl/players/<section>/<slug>/ layout are left alone, and so is every link when no player page is published at all.

= 1.10.11 =
* Postseason matchup games have pages on WordPress. The API links each pair's playoff meetings as /nfl/<a>-vs-<b>/2025-wild-card/, -divisional/, -conference-championship/, -super-bowl/ (and 2025-postseason-week-N/ for a round with no name), but the plugin's rewrite only knew 2026-week-1, so every one of those links was a 404. They now resolve, are headed and titled by the round ("…, Super Bowl 2025"), and are passed to the API as spelled. Near misses such as 2026-week-01 or 2025-superbowl are still 404s. The rule flushes itself into the permalink table; no Settings > Permalinks save is needed.
* A matchup's breadcrumb no longer ends at /nfl/matchup/, the noindex holder page every pair is served from. It is now Home › NFL › the pair, and the game after it on a dated address.
* The season chips in a player's Advanced section work. The API links them as ?adv=2024, and the plugin read ?log= but not ?adv=, so every chip reloaded the latest season. ?adv= is now read, range-checked and cached exactly like ?log=. The canonical still drops it.
* "Clear cached renders", the team build and wp eval 'statchasers_news_flush();' keep the day-long backup copies. They used to delete them with the fresh copies, so an API outage straight after a flush left every tool empty. Deactivating the plugin still removes everything, backups included.
* The RB handcuffs board is the mainEntity of the page's WebPage node only. It was hung on the first node whose type contained "Page", which could be the FAQPage, replacing its questions. A mainEntity another filter already set is no longer overwritten.
* A schedule week's breadcrumb ends at the week. On /nfl/nfl-schedule/week-4/ the trail ended at the schedule page; it now ends "Week 4" at the week's own URL. Schedule page only, and only for a week the season has.
* The schedule's week URLs no longer need a Settings > Permalinks save after an upgrade. The rule flushes itself, as the rankings and player stats positions do.
* The page sitemap lists player section URLs only under pages that carry [statchasers_player], and team section URLs only under hubs that carry [statchasers_team]. Any other page parked under /nfl/players/ got six section URLs it does not serve.
* The asset-version fallback (used as the CSS/JS ver= when the API's assets.json can't be read) is the plugin's own version. It was stuck at 1.7.0. The build script now refuses to package a release where it and the Version header disagree.
* Hub titles: the retitle tool recognises the current generated title ("<Team> 2026: Record, Schedule, Stats & Fantasy Football") as well as the old one, for any season, so after the season constant moves on it can bring all 32 hubs forward. Custom titles are still left alone. create-team-pages.sh and sc-build-pages.php now write the same title the Tools screen does.
* scripts/sc-build-pages.php no longer carries an access token. It reads SC_BUILD_PAGES_TOKEN from wp-config.php (or the environment) and answers 403 until one is set. The token that was in the file should be treated as public.

= 1.10.10 =
* New players get their pages on their own. Once a day, an hour after the API rebuilds its player index, WP-cron runs the same batches as the "Build player pages" button: new signings get a page, renamed players' pages move (with their redirects), and nothing is touched on a day the roster did not change. A long build continues a minute later rather than hitting the host's time limit. The button still works for an immediate build. Needs the matching API deploy for the daily index rebuild.

= 1.10.9 =
* A slow or down API no longer stalls every page view. When a fetch failed and a saved copy existed, the saved copy was served but nothing remembered the failure, so every view, and every caller within a view (Rank Math's title, the schema, the shortcode), asked the API again and waited out the timeout: up to 3 × 6s on the rest-of-season board, 2 × 12s on the schedule, 4 or more on a matchup. The saved copy is now also held for a minute, on every tool. The news tool, which had no failure memory at all, gains the same minute.
* The player list behind player-page headings is no longer fetched on every view while the API is down. It was read from the page title with a 20-second timeout and never remembered a failure. A failure is now remembered for five minutes, a copy of the last good list is kept for a week and used meanwhile, and a reader's page view waits at most 8 seconds (the admin builder keeps 20).
* ?season= on the player stats page accepts 1999 to the current year and "all", instead of any four digits. Each value was its own cached copy and its own API request, so a crawler could fill the options table one URL at a time.
* ?sc_sched_week= only means something on the schedule page. On any other URL it retitled the page "…: Week N", pointed its canonical at the schedule week, and an out-of-range value made the page a 404 - the bug the rankings and player stats pages already had fixed.
* ?sc_section=overview on a player page and ?sc_section=outlook on a team hub no longer redirect to themselves forever.

= 1.10.8 =
* The player-page builder works from the API's current player list. It kept the list for six hours and never refreshed it on demand, so a build run right after an API deploy used the list from before: players the deploy added (Deebo Samuel, Stefon Diggs and 70 others) got no page and still 404ed, and the screen said "602 of 575" with every profile present. A build that starts from the top now fetches the list fresh, "Clear cached renders" clears it too, and a fetch that fails falls back to the list it had rather than to none. Plugin only.

= 1.10.7 =
* Player section URLs are pages of their own to Google. /nfl/players/<player>/stats/, /game-log/, /outlook/, /injury/, /news/ and /bio/ are rewrites onto the profile page, and Rank Math gave all six the profile's title, description and canonical, which told Google they were one page. Each now gets its own title and description (written by the API, shipped with the fragment), a self-referencing canonical and og:url, index,follow stated outright, and a last breadcrumb naming the section. Needs the matching API deploy for the titles and descriptions; the canonical, robots and breadcrumb work with the plugin alone.
* The page sitemap lists the six player section URLs for every published profile (not /overview/, which redirects). Team section URLs gain the same last breadcrumb.
* The URLs the tools append to the page sitemap (player and team sections, schedule weeks, rankings and stats positions, matchups) are listed once, on the first page of the page sitemap. With several hundred player pages the page sitemap paginates, and each file was listing every appended URL again.
* The retired /nfl/players/<section>/<player>/ pages are dropped from the sitemap. They redirect since 1.10.6, and only final URLs belong in a sitemap.
* An old player slug's /overview/ now goes straight to the profile in one hop, instead of through the new slug's /overview/ first.
* API side, needs the API deploy: every internal player and team link ends in a slash, the URL WordPress serves, so no link goes through WordPress's slash redirect first. Two in-page anchors that were dead on section pages ("full injury history" on News, "Career Context" into Stats) link to the section URLs, and "All <Team> news" goes to the team's News section. The team hub's depth chart link goes to /nfl/nfl-depth-charts/fantasy/<team>/ and its "View full NFL schedule" link to /nfl/nfl-schedule/; both defaults pointed at pages that do not exist. A tab switch sets the document title to the tab's own before it changes the address, so GA4's history page views carry the right title.

= 1.10.6 =
* Every player and team URL has an H1 of its own. On a player's profile the H1 was the Overview panel's "2026 Fantasy Snapshot" (the 1.10.4 entry below made it the bare name), which named nobody or repeated the hero. It is now "Josh Allen Fantasy Football Stats & Analysis". The section pages keep their phrase ("Josh Allen Stats 2026", "Josh Allen Game Log 2026"), and the Outlook gains its year: "Josh Allen Fantasy Outlook 2026". The hero still shows the name.
* A team hub's H1 was the Outlook panel's "2026 Fantasy Outlook": no team in it, the same on all 32 hubs, and word for word the H1 of the hub's own /outlook/ page. It is now "New England Patriots Fantasy Football Outlook & Stats 2026". The section pages' H1s now use the same words as their titles ("New England Patriots Stats 2026" instead of "Patriots Team Stats 2026").
* /nfl/players/<player>/overview/ now 301s to the profile, and /nfl/teams/<team>/outlook/ now 301s to the hub. Each pair served the same page at two self-canonical addresses. The tab now links to the profile or hub, and /outlook/ is no longer in the sitemap. The query string is kept through the redirect.
* Retired player addresses 301 to the profile. /nfl/players/outlook/<player>/ was an older layout whose pages still resolved with a stale implementation; it now goes to /nfl/players/<player>/outlook/, and the rest of that layout (/nfl/players/stats/<player>/, /game-log/, /injury/, /news/, /bio/) goes to the same section in the current one. The redraft-era /fantasy-football/players/<player>/ (404 today, still in Google's index) goes to the profile, keeping a section if the URL had one. Only a player with a profile today is redirected; the rest are left as they are, rather than sent to a 404.
* API side: the team hubs linked every player name to the old /nfl/players/outlook/<player>/ address, which is how Google kept finding it. They now link to /nfl/players/<player>/.
* Needs the matching API deploy for the headings and the tab links. The redirects and the sitemap change work with the plugin alone.

= 1.10.5 =
* No more SoftwareApplication schema. The plugin added a SoftwareApplication / WebApplication node to every page that mounts the news tool or a team hub, which covers every team URL including /nfl/teams/<team>/schedule/. Search Console held it to the software-app rich result's rules (offers.price plus an aggregateRating or review) and flagged each page. These are pages, not applications, and there is no genuine rating to give, so the node is gone. With Rank Math present, the page's WebPage and BreadcrumbList are Rank Math's and the plugin adds nothing to them. Without an SEO plugin it prints a plain WebPage.
* A team's Schedule page now adds an ItemList of SportsEvents to Rank Math's graph, one per game: both teams, kickoff, venue, and the final score once a game is played. Games with no kickoff or venue yet are left out, because an Event without those is its own Search Console error. The list is only on the Schedule page. The hub and the other sections are unchanged.
* The rankings pages (redraft and rest-of-season) add an ItemList of their players to Rank Math's graph: one per position the page shows, so four on the All board and one on a position page such as /rb/. Each entry is the player at their positional rank, linked to their page on the site. There are four lists rather than one merged list because ranks are positional, and QB7 and RB7 are not the same pick.
* Needs the matching API deploy for the schedule and rankings lists. The removal works with the plugin alone.

= 1.10.4 =
* Player pages have a populated H1 in the page source. An SEO audit of /nfl/players/josh-allen/ found `<h1 class="entry-title main_title"></h1>` in View Source. In "Let the tool supply the heading" (the site's mode) the plugin empties Divi's page title, and a title filter can't remove the element, so a blank H1 was left in the HTML. A CSS rule hid it on screen but not from crawlers. The plugin now removes that emptied element from the output, so it never reaches the page. The buffer is scoped to the few hundred bytes page.php prints between the loop starting and the content. It only applies on pages that mount a tool, and only when the title has been emptied.
* API side, needs the matching API deploy: on a player's main profile, the tool's H1 was the Overview panel's heading, "2026 Fantasy Snapshot". That heading names no player and was identical on every profile. The H1 is now the player's name in the hero ("Josh Allen"), the same H1 the standalone page carries. The hero looks the same, measured in a simulated Divi page at 1440px and 500px. Section pages are unchanged; they already promote their own phrase ("Josh Allen Stats 2026").

= 1.10.3 =
* The page heading lines up with the tool beneath it on a page built with the Divi Builder. 1.10.2 capped each tool at the site's content width and centred it, but the heading the plugin prints (the "Let the tool supply the heading" hero) sits just outside the tool, so it kept the full width of the window and started at its left edge while the table sat centred beneath it. The heading now takes the same cap. Measured on a builder page at 1780px: the H1 moved from 0px to 343px, level with the table. Plain pages were already aligned and are unchanged. This also covers the schedule's heading. Plugin only; no API deploy needed.

= 1.10.2 =
Launch prep for the rest-of-season rankings and the advanced player stats, checked against every problem the team hubs, player pages, FPA and schedule hit on the live site. Needs the matching API deploy.

* Both tools now fit the site's content column on every kind of Divi page. On a page built with the Divi Builder (or a Theme Builder body layout) Divi prints no #left-area, so the width cap there applied to nothing and a tool ran the full width of the window. That is the ~1800px the team hubs showed. The cap is now also on each tool's own root, which is present on every page shape. On a phone, a shortcode inside a Divi row was held to the row's 80% width (about 40px of margin a side on a 390px screen); the row that holds a tool now takes the full width, with the same 4px gutter as everywhere else. Measured in a simulated Divi page on all four page shapes: 1080px on desktop, 4px gutters on a phone. This rule is shared, so it also covers the hubs, player pages, FPA and the schedule.
* Both tools' headings work with every "Page headings" mode. In "Let the tool supply the heading" (the site's mode), the theme's title is emptied and each tool prints the site's own hero, as the schedule does, so each page has exactly one H1. Before, neither tool was on the list the heading modes check. On a template with no Post Title module the pages would have had no H1, and on any other the heading could not follow the page's address. The rankings H1 now names the board (for example "2026 Rest of Season Fantasy Football RB Rankings" on /rb/) and changes when a tab switches boards in place. Its title, H1 and description now come from the API, the way the player stats page's do. In "auto" neither tool prints a heading, so the theme's heading is left alone.
* The rankings board's four position URLs are added to Rank Math's page sitemap, as the player stats page's three already were.
* The position query vars mean something only on their own pages. Before, `?sc_stats_pos=rb` or `?sc_rank_pos=rb` on any article renamed that article and pointed its canonical at the stats or rankings page, and `?sc_stats_pos=qb` redirected it.
* The old /fantasy-football/redraft-rankings/ 301 now runs before WordPress's own 404 guesser. That guesser would otherwise send the old address to any post whose slug starts with "redraft-rankings". The old board's `?pos=rb` now lands on the RB board.
* API side: rankings.css and player-stats.css now hold up against Divi's own rules. The tables had picked up Divi's 1px frame and 15px margin (Divi's selector is `.entry-content table:not(.variations)`, which beat both files' existing armour). Header labels turned grey on the navy bands, rankings player names turned grey and bold, the new position tabs took the link blue, and the stats section headings and the rankings FAQ heading rendered at 50px from `#left-area h2`. Each tool was diffed in a simulated Divi page against the bare tool, and the remaining differences are zero.

= 1.10.1 =
* The advanced player stats page is now titled for what people search for: "<season> NFL Player Stats & Fantasy Football Stats" on /nfl/nfl-player-stats/, and "<season> NFL Wide Receiver Stats & Fantasy Football Stats" (and so on) on the position addresses. The title, H1 and meta description now come from the API, which ships them with the table, so the season in them is always the one being shown and this plugin keeps no copy of the words. The bare page's title is now set this way too, replacing whatever the page was titled in WordPress.
* The table's FAQ ("NFL Player Stats FAQ", twelve questions) reaches the page's structured data: it is lifted into Rank Math's graph as a FAQPage node (or printed alone on a site with no schema plugin), and the data it travels in is stripped from the page, as on the other tools. Needs the matching API deploy.

= 1.10.0 =
* The RB handcuff rankings carry a FAQ: fifteen questions under the board, with the answers that can go stale (who the best handcuffs are, the model's weights, when the board was updated) read off the current rankings. The fragment ships them as a JSON island; the plugin adds them to Rank Math's graph as a FAQPage node (or prints that node alone on a site with no schema plugin) and strips the island from the page. The board also gains a one-line standfirst and a "Best RB Handcuffs for <season>" top-10 list. The copy ships from the API; the schema needs this plugin.
* New shortcode: [statchasers_rb_handcuffs], the RB handcuff rankings, ported from the standalone Redraft-RB-Handcuff-Rankings app. That app's own plugin (statchasers-handcuffs, [statchasers_handcuffs]) printed a snapshot table and then had its React bundle clear it and draw its own; now the API renders the board once and the shortcode prints it, like the other tools. Every backup, the starter he backs up, his score, tier, handcuff type and the reasons behind his rank are in the page's HTML. The weight sliders, Re-rank, sorting, the expandable rows, compare (up to three) and the player card work in the browser on top of that markup; the card is fetched from the API the first time it is opened. The tool's CreativeWork schema node and the "Related tools" links carry over.
* To switch over: replace [statchasers_handcuffs] with [statchasers_rb_handcuffs] on /rb-handcuff-rankings/, then deactivate and delete the statchasers-handcuffs plugin. Both add a schema node for the tool, so do not leave both on the page. Needs the matching API deploy.
* New shortcode: [statchasers_player_stats], the advanced player stats table, ported from the standalone NFL-Advanced-Player-Stats app. That app was mounted at /nfl/nfl-player-stats/ by its own plugin (statchasers-analytics) as an iframe, so the page's HTML was an empty frame and not one player or number on it reached a crawler. The API now renders the table and the shortcode prints it into the page, like the other tools: every player in the open table is in the HTML, with the StatChasers grades, the five grade-leader cards, the column groups and the default qualifiers the app had. Sorting, the filter bar, the section pills and switching season work in the browser on top of that markup, without reloading the page.
* Each position keeps its own address, as in the app: /nfl/nfl-player-stats/ is the quarterbacks, /rb/, /wr/ and /te/ the other three, each with its own title, description and canonical, and listed in Rank Math's page sitemap once the page carries the new shortcode. /qb/ redirects to the bare page. The rewrite rule checks itself into the permalink table, so updating by zip is enough; no Settings > Permalinks save needed.
* To switch over: replace [statchasers_analytics] with [statchasers_player_stats] on the page, then deactivate and delete the statchasers-analytics plugin and remove the block it wrote into .htaccess. Needs the matching API deploy.
* The rankings page moves to /fantasy-football/rest-of-season-rankings/, and each board gets an address of its own beneath it: /qb/, /rb/, /wr/ and /te/. One page still serves all five - a rewrite rule points each position URL at it - and each has its own title, description and canonical in Rank Math. The tabs switch in place and push the board's address, so a reload or a shared link opens the board that was on screen. The old /fantasy-football/redraft-rankings/ answers with a 301 once the page has moved. To switch over: change the page's slug to rest-of-season-rankings in WordPress and set SC_RANKINGS_PATH=/fantasy-football/rest-of-season-rankings/ on the API. Needs the matching API deploy; the permalinks rebuild themselves on the first request after the upload.

= 1.9.4 =
* The schedule's heading now lines up with the board on desktop. 1.9.3 had it print the site's hero in the "Let the tool supply the heading" mode, but the rule that holds a generated hero flush with the tool beneath it - undoing the hand-built hero's side padding and its centred, max-width inner shell - was still printed only in the modes where the plugin normally prints a heading. So on a wide screen the heading sat inset from the board, and a Custom CSS override on the padding alone could not reach the centring. Plugin only.

= 1.9.3 =
* The NFL schedule's heading now wears the site's own hero - the serif H1, the gold rule and the standfirst - in the "Let the tool supply the heading" mode. That mode empties the theme's title and asks each tool for its heading; the team hubs and player pages answer with a section heading already in the site's style, but the schedule answered with its source repo's Space Grotesk title, which read as a second design at the top of the page. It now prints the same `sc-lo-hero` markup the plugin prints in the other modes, and never asks the API for `?h1=1`. The standfirst carries the season again ("View the full 2026 NFL schedule…"), read off the board, so it says what the API's own page says. Plugin only; no API deploy needed.

= 1.9.2 =
* The NFL schedule's questions now reach the page's structured data. The fragment has carried them as an inert payload since the weekly board got a FAQ, and this file was the one of the six tools with nothing to lift it - so the answers shipped as visible prose and as a dead JSON island, and never as a FAQPage node. They are lifted into Rank Math's graph and stripped before printing now, the same arrangement the team hubs, the rankings board and the FPA table already use. Unlike those three, which question set gets described depends on what the page mounts: the shortcode's own attributes are read off the post before the head is built, so the bare schedule page is described by the season grid's questions and `/nfl/nfl-schedule/week-7/` by week 7's. Needs the matching API deploy.
* Every game on the weekly board now has a link to the two clubs' own matchup page, in a column of its own at the end of the row. A game the pair's page has stopped leading with is linked at its dated address rather than at the pair, so a reader opening Week 3 in December lands on Week 3's game. `SC_MATCHUP_PATH_PREFIX` on the API deployment decides where those links point; its default is already this plugin's `/nfl/<a>-vs-<b>/`. API side.
* The season grid gets its own FAQ and its own heading. The board is titled "2026 NFL Schedule Grid - All 32 Teams, Weeks 1–18" with a sentence under it saying what it is, and the questions below it answer what the grid is asked: how to read a row, what the @ means, where the byes are, how many weeks and games the season holds. Every number in them is counted off the slate rather than written in, and the count questions are withheld entirely when the feed is only part loaded. API side.

= 1.9.1 =
* The 4px side gutter a phone reads the tools through now reaches the team hubs, which were still running edge to edge after 1.9.0 shipped it. The gutter was on `.container`, and a page that has been through the Divi Builder does not have one: Divi's page.php prints the `.container` / `#content-area` / `#left-area` wrappers only when the builder is unused, so on the hubs every rule naming those elements was addressed to nothing. It is on `#main-content` now - the one wrapper a plain page, a builder page and a Theme Builder body layout all print - and `.container` gives its own gutter up rather than adding a second one on the pages that do have both. Measured on the real hub fragment under both page shapes: 4px a side on each, at every width below 981px, with no change above it.

= 1.9.0 =
* Changing scoring format or view on the Fantasy Points Allowed table no longer changes the page's address. The Scoring and View controls are still ordinary links - a crawler follows them, a middle-click still opens the combination that was asked for - but the bundle now intercepts the click, fetches that combination and swaps the table in place, writing nothing to the URL and pushing nothing onto the history stack. Six renderings of one table are one page, which is what the canonical has always said. The legend and the FAQ are left alone by a swap, so a question a reader has opened stays open.
* The same controls now work with scripting off, which they did not. The links carry the combination in a query string, and the shortcode read only its own attributes - so a reader who clicked PPR inside a WordPress page was sent to a URL that rendered the DEFAULT table, a control that appears to work and does not. `?format=` and `?view=` are now read off the URL, validated against the three formats and two views and dropped rather than corrected if they are anything else. An attribute you write still outranks them: a page carrying format="ppr" has decided what it shows.
* The Fantasy Points Allowed FAQ is rewritten around the questions people actually search - "which teams allow the most fantasy points to RBs", "what does FPA mean in fantasy football", "is a higher number better" - and the page now carries a FAQPage node built from the same list it renders, so the questions are not merely on the page but described to a crawler. On a WordPress mount the questions arrive as an inert payload that the plugin lifts into Rank Math's graph and strips before printing, so what ships is one <script> holding one graph, the same arrangement the team hubs and the rankings board already use. Needs the matching API deploy.

= 1.8.2 =
* Every tool sits in the site's own content column. `#left-area { width: 100% }` takes back the column Divi reserves for a sidebar nobody filled - but Divi also widens the content container on any page that has been opened in the Divi Builder, so that a full-width section can bleed to the window. A tool is not a section, it is page content, so on those pages "the whole column" meant the whole screen: the team hubs rendered around 1800px wide while the player pages, carrying the same stylesheet on pages that had not been through the builder, sat in the ordinary column. The width is now capped at the site's own content width, read from Divi's Customizer setting rather than written down, so the tools line up with every hand-built row on the site. Override with the `statchasers_content_width` filter on a theme that cannot be asked.
* The matchup holder page is built where the pair URLs actually look for it. It was created under the team hubs' container, at /nfl/teams/matchup/, while every rewrite rule and every filter in the plugin addresses it as /nfl/matchup/ - so all 496 pair URLs resolved to no page, and WordPress's own 404 guess then matched the stray page by its slug and sent the reader to it. What that looked like from the front end: "View matchup" on a team hub landed on a page saying it was the holder and rendered nothing. The Tools screen could not see the problem either, because the builder looked under one parent and the panel under the other, so pressing "Create the holder page" reported success and changed nothing. The screen now detects a holder at the wrong address and offers to move it, an admin notice says so from any screen, and the build rebuilds the permalinks itself.

= 1.8.1 =
* "Let the tool supply the heading" now covers team hubs as well as player pages. A hub section address printed its phrase twice the same way - the theme's page title above, the panel's own heading with the gold rule below it - and the hub answers to it on the same terms: the theme's title is emptied and the panel the page opens on has its heading promoted to the page's H1. A hub panel carries several headings and only the one it opens with is promoted, so a section page and the whole hub both carry exactly one H1. Needs the matching API deploy.

= 1.8.0 =
* New heading mode: "Let the tool supply the heading". A player section page printed its phrase twice - once as the theme's page title in its own serif, once as the tool's section heading with the gold rule under it, saying the same words a few hundred pixels apart. This mode empties the theme's title and asks the API for the promoted markup, so the heading a reader can see IS the page's H1, in the tool's own type. Exactly one panel is promoted, so a section page and the all-tabs page both carry a single H1. Player pages only; the other tools are unaffected. Needs the matching API deploy.

= 1.7.7 =
* A page builder's wrapper is no longer mistaken for somebody's own arrangement. Opening the generated container body in Divi wraps the same words in [et_pb_section] and friends, and the "does this page carry a shortcode" test read that packaging as intent - so /nfl/teams/ reported as a hand-written page and was left alone. The same wrapper is why the grid printed below everything else: the_content appends after the closing [/et_pb_section], outside every section the builder laid out. Builder tags are now told apart from real mounts, the rebuild removes the wrapper along with the body it holds, and the Index pages panel names the shortcodes it found instead of only saying there were some.

= 1.7.6 =
* The container pages are recognised after a block editor has been near them. Recognition counted only root-relative, double-quoted links (`href="/nfl/teams/`), which is how the build writes them and not how they come back from WonderBlocks, Gutenberg or Divi - those rewrite them to absolute URLs on save, the count fell to zero, and /nfl/teams/ reported as a hand-written page and was left alone through two releases while the theme printed its wall of links and the plugin appended the real grid underneath. Absolute and single-quoted links now count, a bracket in prose is no longer mistaken for a shortcode, and the Index pages panel prints what it looked at whenever it declines to touch a container.

= 1.7.5 =
* Tools -> StatChasers Pages gains an "Index pages" panel with a rebuild button. Mounting the grid on the two container pages at /nfl/teams/ and /nfl/players/ was only ever done at the end of a page build, and the build button is only offered while pages are missing - so on a site where all 32 hubs already existed the screen said "Nothing to do" and a container still carrying the old list of 32 links had no way left to be fixed. The panel now names the state of each container and writes only the two it should: an empty body, or the generated stub. A page you have edited yourself is never touched.

= 1.7.4 =
* The "print a heading only when the theme prints none" check is now taken per page type. It was one measurement, taken on a team hub and applied to player and matchup pages as well, so a site whose hub title comes from a builder layout and whose player pages get their title from the theme's template printed two H1s on every player page - the theme's plain one and the tool's designed one - on the one setting meant to prevent exactly that. A page type with no measurement of its own now prints nothing rather than borrowing the hub's answer. Re-run the check on Tools -> StatChasers Pages after updating.

= 1.7.3 =
* The team index page at /nfl/teams/ prints the grid of 32 hubs even when nothing on the page mounts it, and loads the hub stylesheet while doing it. Exactly the 1.7.2 fix, on the other container: a page built in a page builder is neither empty nor the old stub, so the build left it alone and the parent of the 32 hubs shipped as a paragraph and 32 bullets in the theme's list styling.

= 1.7.2 =
* The player index page at /nfl/players/ prints the roster even when nothing on the page mounts it. The build only writes the shortcode into a container that is empty or still carrying the old stub, so a container built in a page builder kept its heading and its paragraph and showed no players at all.

= 1.7.1 =
* The generated page heading lines up with the tool beneath it. It sat in the hero module's centred shell while the embedded fragment ran flush to the container, so on a layout wider than the site's content width the H1 started well to the right of the tool it heads.

= 1.7.0 =
* Tools -> StatChasers Pages now builds the player profile pages as well, in resumable batches of 25, and the matchup holder page beside them.
* Page headings: the plugin fetches one published page and counts its H1 elements, then prints its own heading only on a template that prints none. Re-checked on a theme switch; overridable from the same screen.
* An H1 on every matchup URL. One holder page serves 496 addresses and they all used to share the holder's heading.
* Team section URLs, player section URLs and matchup pair URLs are on by default, with the permalink flush done on activation instead of by hand.
* The team News tab has a public address, /nfl/teams/<team>/news/, like the other five.

= 1.6.0 =
* [statchasers_rankings]: the rest-of-season rankings board, ported from the standalone Redraft-Rankings-table app. All five position panels are server-rendered into the page, not filled in by React after load.

= 1.3.1 =
* Renamed from "StatChasers News" to "StatChasers" - the plugin has carried the team hubs as well as the news tool since 1.0.0, and the old name sent people looking for a second plugin that does not exist.

= 1.3.0 =
* Tools -> StatChasers Team Pages: one button creates all 32 team hub pages.
* Admin notice while pages are missing.

= 1.2.0 =
* Force Divi's full-width layout on pages mounting the team hub.

= 1.1.0 =
* Same, first attempt (body class only; not sufficient on its own).

= 1.0.0 =
* Initial release.
