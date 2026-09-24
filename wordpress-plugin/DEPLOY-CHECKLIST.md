# Post-deploy verification

The automated suite (`pnpm --filter @workspace/api-server test`) proves the tool
serves crawlable content and still works interactively. It cannot prove how
Google actually treats the live page. These steps close that gap and need
someone with access to the live site and Search Console — they can't be done
from the build.

## 1. Confirm Google sees the content

Search Console → **URL Inspection** → paste the live tool page URL →
**Test Live URL** → **View Tested Page** → **HTML**.

In the rendered HTML, confirm you can find:

- [ ] the `<h1>`
- [ ] several real headlines and player names — **not just the H1 and intro
      paragraph**. If only the heading and surrounding copy are there, the tool
      is rendering client-side again and the SSR path has regressed.
- [ ] items from beyond the first page (search for a headline you know is on
      page 3)
- [ ] the `<link rel="canonical">`, and only one of them
- [ ] the player/team internal links, if you've configured those templates

Also check the **Screenshot** tab: the tool should be visible, not an empty box.

### On a team page, additionally

Team hubs are `noindex, indexifembedded` at the API's own URL, so the embed is
the only thing that makes them indexable. Verify on one team page before
building all 32:

- [ ] content from **every tab** is in the rendered HTML, not just the Outlook.
      Search for `Season History`, a depth-chart player name, and an opponent
      from the schedule. All five panels ship on the first response; if only one
      is there, the `:target` tab CSS or the fragment has regressed.
- [ ] the page's own robots directive is **indexable** — the fragment carries no
      robots meta, so what Rank Math emits is what applies. A team page that
      inherited `noindex` from a template is the one failure mode that makes all
      of this pointless.
- [ ] the team switcher's 32 links point at `/nfl/teams/<slug>/` with **no
      `?embed=1`**. If they carry it, `SC_TEAM_PATH_PREFIX` is unset on the API
      deployment — and because `embed` is a reserved WordPress query var, every
      one of those links serves the oEmbed template instead of the page.
- [ ] the fragment is present for a **logged-out** visitor. The admin-only
      diagnostics ("no team slug", "the API returned nothing") render as an
      empty string for everyone else, so a broken mount looks like a missing
      section rather than an error.

### Page headings

The plugin measures this itself now — **Tools → StatChasers Pages → Page
headings** — and the panel says what it found. Confirm the measurement matches
the page:

- [ ] the panel reports either "the theme prints the page heading as the H1" or
      "the theme prints no H1, so the shortcodes print the heading themselves".
      A warning about an H1 that is not the page's heading is a theme printing
      the site name in one, and it is fixed in the theme — the plugin will not
      add a second.
- [ ] on a published team page, `curl -s <url> | grep -o '<h1[^>]*>[^<]*'`
      returns **exactly one**, and it names the team.
- [ ] the same on a player profile and on a matchup pair URL. The probe measures
      a team hub and applies the verdict to all three, which is right for a
      normal theme and can be wrong for a Theme Builder setup that templates
      them differently. If one of the three differs, the panel's **Always
      print** / **Never print** settings are the way out.
- [ ] after switching themes, the panel says the check needs running again
      rather than showing the old verdict.
- [ ] **if the mode is Replace**, the page has exactly one H1 and it is the
      hero's. `curl -s <url> | grep -c '<h1'` counts **elements**, so it returns
      2 while the emptied husk is still in the markup — that is expected, and
      what matters is that only one of them has text in it and that the husk is
      hidden. If the husk is visible, the theme pads its title with whitespace
      and `:empty` cannot match it; add `h1.entry-title{display:none}` scoped to
      those pages.
- [ ] **if the plugin is printing the heading**, the hero CSS is site-wide
      (Divi → Theme Options → Custom CSS), not inline in one page's Code
      module. Generated headings carry the `sc-lo-hero` classes; with the CSS
      still inline they render as unstyled text — correct markup, no gold rule.
      Compare a generated heading against a hand-written one side by side.

### Section URLs

On by default since 1.7.0, with the flush done on activation. Take one team end
to end — `/nfl/teams/new-england-patriots/` and its `/outlook/`, `/stats/`,
`/schedule/`, `/depth-chart/`, `/matchups/` and `/news/` — and on **every one of
the six** confirm:

- [ ] HTTP **200**.
- [ ] the H1 is the page's phrase: the team name on the hub, "New England
      Patriots Schedule 2026" and so on below it. Exactly one H1, and no `<h2>`
      inside the panel repeating it.
- [ ] `<title>` matches the H1's phrase and differs across the five.
- [ ] the meta description is present, unique to the page, and there is one.
- [ ] `<link rel="canonical">` is the page's own **pretty** path with a trailing
      slash — never the hub on a section page, never `?section=` anywhere. One
      canonical, not two: a second one means the plugin's filter and the theme
      are both printing.
- [ ] `og:url` equals the canonical.
- [ ] robots is `index, follow`. The fragment carries no robots meta; Rank Math's
      is the one that counts.
- [ ] a section page shows **its panel and nothing else**: no tab strip, no
      content from the other panels. All five panels means `sc_section` is not
      reaching the shortcode and the URL is the hub wearing a second address.
- [ ] at most one `FAQPage` node in the page, and it holds only that page's
      questions. The Schedule page has none — that is correct, not a gap.
- [ ] the URL is in the **page sitemap**. If the six section URLs are absent,
      the `rank_math/sitemap/page_content` filter name is the first thing to
      check — it is the one Rank Math hook not confirmed against a live build.

Then the edges:

- [ ] the bare hub still serves as before.
- [ ] `/nfl/teams/<slug>/not-a-real-section/` is a **404**, not the hub.
- [ ] on the API origin, `/team/ne/schedule/` and `/team/ne?section=schedule`
      both 301 to `/team/new-england-patriots/schedule/`; `/team/nowhere/stats/`
      is a 404.
- [ ] with `add_filter( 'statchasers_team_section_urls', '__return_false' )`:
      the section URLs 404 and the sitemap lists none of them. Off must be
      genuinely off.

Once all of that holds on one team, submit the page sitemap in Search Console.

### Player pages

After a build finishes — **Tools → StatChasers Pages → Player pages** — on one
profile, say `/nfl/players/kyler-murray/`:

- [ ] HTTP **200**, and the count on the panel matches what the API lists.
      A build that stopped early leaves the rest 404ing, and the panel says
      "Continue from N" rather than "every profile has a page".
- [ ] exactly one H1, and it is the player's name — **not** `Kyler Murray (QB)`.
      The position is in the stored title so six hundred rows are legible in the
      admin list; the heading filter takes it back off.
- [ ] a section URL — `/nfl/players/kyler-murray/game-log/` — is 200, shows that
      panel only, and its H1 names the section (`… Game Log 2026`). The six
      addresses sharing one heading is what that filter exists to prevent.
- [ ] robots is `index, follow`, the canonical is the page's own pretty path,
      and the Rank Math title is `Kyler Murray Fantasy Football Stats &
      Analysis | StatChasers`.
- [ ] the container at `/nfl/players/` lists the roster grouped by team. An
      empty container page is a thin page that still sits in the sitemap.
- [ ] re-run the build: it reports everything as existing and changes nothing.

### Width

- [ ] a team hub and a player page are the **same width**, and both are the
      width of an ordinary page on the site. They carry the same stylesheet, so
      a difference is the host column, not the tool: Divi widens the content
      container on a page that has been through the Divi Builder, which is what
      `statchasers_team_content_width()` caps. If they match each other but not
      the rest of the site, that number is wrong — filter
      `statchasers_content_width`.

### Matchup pages

Only once the holder page exists **at `/nfl/matchup/`** — **Tools → StatChasers
Pages → Matchup pages** creates it there, or moves one an older release built at
`/nfl/teams/matchup/`, and rebuilds the permalinks. The pair URLs are live from
that point. Check the path, not just that a holder exists: a holder one level
deep resolves to nothing and WordPress's 404 guess quietly redirects every pair
URL to it, which reads as "View matchup goes to a blank page". Then on
`/nfl/new-england-patriots-vs-philadelphia-eagles/`:

- [ ] HTTP **200**; H1 is `New England Patriots vs Philadelphia Eagles`, and a
      **second** pair URL has a different one. 496 addresses share one holder
      page, so an H1 that is the same on both means `the_title` is not being
      rewritten and every pair page is headed with the holder's name.
- [ ] `<title>` carries the state's phrase (Where to Watch… / Score… /
      Head-to-Head Record…) and `<link rel="canonical">` and `og:url` are this
      exact pretty URL. One of each.
- [ ] robots is `index, follow` here, and `/nfl/matchup/` itself is **noindex**.
- [ ] `/nfl/philadelphia-eagles-vs-new-england-patriots/` and `/nfl/phi-vs-ne/`
      **301** to the URL above. Not 200, not 302.
- [ ] `/nfl/new-england-patriots-vs-fake-team/` and
      `/nfl/new-england-patriots-vs-new-england-patriots/` are **404**, not the
      holder, not a hub.
- [ ] the block under the hero matches the state. An upcoming pair leads with
      **Where to Watch** (date, kickoff, TV, venue — no "check local listings")
      and carries no "Up Next" card: the hero already names the fixture, and the
      card was the same four facts a second time,
      Final with the score, or Last Meeting. Nothing from a different state.
- [ ] the page links both hubs and both `/matchups/` sections.
- [ ] the page sitemap lists the pair URLs (496 entries).
- [ ] with the flag **off**: pair URLs 404 and the sitemap lists none.

- [ ] the hub uses the **full content column** — open the page at a desktop
      width above 1100px, not just on a phone. Divi splits the row 79/21 for a
      sidebar unless the layout is full width, and an empty widget area leaves
      that 21% blank. The plugin forces `et_full_width_page` on any page that
      mounts the shortcode; if a band of white is still there, confirm the body
      tag carries that class and not `et_right_sidebar`. Below 980px Divi
      collapses the split by itself, which is why this only shows on desktop.

### Fantasy Points Allowed

Unlike the hubs and the profiles there is no page to build: this is one page
that already exists at `/nfl/fantasy-points-allowed-by-position/`. What is being
replaced is the tool inside it, so the checks are about what the page's own HTML
now contains.

**Before touching WordPress**, on the API deployment:

- [ ] `SC_FPA_PATH=/nfl/fantasy-points-allowed-by-position/` is set **on the
      deployment**, not only the workspace. Left unset the table's own Scoring
      and View controls point at the API's own `/fpa`, so a middle-click — or
      any click before the bundle loads — takes the reader off the site to the
      bare tool.
- [ ] `SC_TEAM_PATH_PREFIX=/nfl/teams/` is set, or every defence name in the
      table links to the bare tool instead of to its hub.
- [ ] the ingest has run against the production database:
      `pnpm --filter @workspace/api-server run ingest-fpa`. **Nothing renders
      until it has.** Confirm with `curl -sI https://<api-origin>/embed/fpa` —
      200 means there is data, 404 means there is not, and the shortcode's
      answer to 404 is to print an empty string and leave the rest of your page
      intact. A reader sees a page with no table; only an administrator sees why.

Then on the live page, reading the **source**, not the screen — the whole point
of the port is that the markup is in the page rather than fetched into it:

- [ ] all 32 defence rows are in `view-source:`. The old build shipped an empty
      container and drew the table in the browser; if the rows are not in the
      source, the old plugin is still the one answering.
- [ ] the FAQ's questions are in the source too, all of them.
- [ ] `scf-faq-data` does **not** appear anywhere in the printed source. That is
      the inert payload the plugin lifts into Rank Math's graph and strips; if
      it is still there, the strip is not running and every answer is in the
      page twice.
- [ ] exactly **one** `FAQPage` in the page, inside Rank Math's graph rather
      than as a second `ld+json` block. Rich Results Test, same as section 2.
- [ ] the page's own robots directive is **indexable**. The fragment carries no
      robots meta — the API serves its copy `noindex, indexifembedded`, so the
      embed is the only thing that makes any of this rank.

Then the controls, which is where this tool differs from the others:

- [ ] click **PPR**: the address bar does **not** change, and the numbers do.
      Check a WR or RB column — the QB column is identical in all three scoring
      formats, because quarterbacks do not catch passes, so a QB cell that
      stays put is correct and proves nothing.
- [ ] the browser's Back button still leaves the page. Nothing is pushed onto
      the history stack, so Back goes wherever the reader came from; a Back that
      steps through scoring formats means something is calling `pushState`.
- [ ] **with JavaScript disabled**, clicking PPR reloads and shows the PPR
      table. Before 1.9.0 it reloaded and showed the default one.
- [ ] the swap works at all from the live origin. It is a cross-origin fetch
      from statchasers.com to the API, which is new surface: if whatever sits in
      front of that origin challenges or blocks it, the click falls back to
      following the link and the address changes. That fallback is honest, but
      it is not what was shipped — confirm in a real browser rather than assume.
- [ ] the CSV link downloads the combination currently on screen, not the one
      the page loaded with.

And the heading, which this tool does not manage for you:

- [ ] the page has exactly one `<h1>` and it is the page's own title.
      `statchasers_h1_mounts_a_tool()` knows the team, player, matchup,
      schedule, rankings and player stats shortcodes, but not this one, so the
      **Page headings** machinery does not cover this page. On a theme that
      prints the page title this is already right and there is nothing to do.
      On a Divi Theme Builder layout with **no Post Title module** this page
      would carry no H1 at all, and the fix is in the template or a heading
      module above the shortcode, not in the plugin.

### Rest-of-season rankings and advanced player stats (1.10.2)

Order matters: the API first, then the plugin, then the pages.

**On the API deployment**, before touching WordPress:

- [ ] `SC_RANKINGS_PATH=/fantasy-football/rest-of-season-rankings/` is set **on
      the deployment**, with the trailing slash. Unset, the position tabs point
      at `/rest-of-season-rankings/rb?embed=1`, which is a 404 on WordPress, and
      because the tabs push their address, a reload lands on that 404. If it was set
      to the old `/fantasy-football/redraft-rankings/` path, change it.
- [ ] `SC_PLAYER_PATH_PREFIX=/nfl/players/` is still set. Both tools link
      players through it.
- [ ] `curl -sI https://<api-origin>/embed/rankings` and
      `/embed/player-stats` both answer 200.
- [ ] `curl -s https://<api-origin>/embed/rankings | grep -c scr-page-data`
      is 1. Zero means the API is older than this plugin, and the rankings H1
      falls back to the page title plus the board.

**Then upload the plugin zip**, and on the two pages:

- [ ] `/fantasy-football/rest-of-season-rankings/` carries `[statchasers_rankings]`
      (slug changed from `redraft-rankings`), and `/nfl/nfl-player-stats/` carries
      `[statchasers_player_stats]` in place of `[statchasers_analytics]`.
- [ ] **Delete any hand-written hero from both pages.** In the "Let the tool
      supply the heading" mode each tool prints the site's hero itself, which is
      what the schedule does. A hand-built one left above the shortcode is a
      second H1, and it is the doubled heading the schedule had
      (attached_assets/H1DESIGN2.png).
- [ ] Deactivate and delete `statchasers-analytics`, and remove its block from
      `.htaccess`.

**On each page and one position URL of each** (`/rb/`):

- [ ] exactly one H1. On the rankings, it names the board: "2026 Rest of Season
      Fantasy Football RB Rankings" on `/rb/`. Click the WR tab: the H1 and the
      address both change, and the page does not reload.
- [ ] `<title>`, meta description, canonical and `og:url` are that address's
      own. There is one of each, and none carries `?embed=1` or `?pos=`.
- [ ] `scr-page-data`, `scr-faq-data`, `sca-page-data` and `sca-faq-data` are
      **absent** from the source. There is one `FAQPage`, inside Rank Math's graph.
- [ ] `/fantasy-football/redraft-rankings/` and `/nfl/nfl-player-stats/qb/`
      both **301**. `/some-article/?sc_stats_pos=rb` is **not** retitled.
- [ ] the page sitemap lists `/rest-of-season-rankings/qb/` … `/te/` and
      `/nfl-player-stats/rb/` … `/te/`.
- [ ] **Look at it on desktop above 1100px and on a phone.** The tool is as wide
      as an ordinary page on the site, not the window, and has a hair of gutter
      on a phone rather than ~40px. The table headers are white on navy (not
      grey), player names are dark (not grey or blue), the RB/WR tabs are not
      link blue, and no section heading is enormous. Those are the Divi rules
      1.10.2 was measured against. If one shows up anyway, the site has a rule
      the simulation did not, and the fix goes in the tool's CSS (API deploy).

## 2. Validate the structured data

[Rich Results Test](https://search.google.com/test/rich-results) on the same URL.

- [ ] The `SoftwareApplication` / `WebApplication` node is detected.
- [ ] It sits in **one** graph with Rank Math's `WebPage` and `BreadcrumbList` —
      not a second, separate `ld+json` block.
- [ ] No errors. A warning that rating/review is missing is **expected and
      correct**: that rich result requires genuine review data, and we don't
      fabricate it. Do not "fix" this by inventing ratings.

## 3. Check the sitemap

Rank Math generates the sitemap, so this should already be right — but verify
rather than assume:

- [ ] The tool page's canonical URL appears in the XML sitemap.
- [ ] Its `<lastmod>` matches the "Last updated" stamp shown on the page.
- [ ] Load the page twice a few minutes apart with no new data ingested and
      confirm `<lastmod>` does **not** move. A timestamp that changes on every
      crawl is worse than none — once Google decides the signal is noise it
      stops using it.

If Rank Math is emitting a `lastmod` based on post-modified date rather than the
tool's data, either accept it or feed it the real value from
`GET /api/news` — don't bump the post date on a schedule to fake freshness.

## 4. Check robots access

Search Console → URL Inspection → **More info** → **Page resources**.

- [ ] `styles.css`, `dist/statchasers-news.js` and `api/news` all load.
- [ ] On a team page: `team.css` and `dist/statchasers-team.js` load. These are
      separate handles from the news tool's, so a page mounting one enqueues
      only that one.
- [ ] Nothing render-critical is listed as blocked.

The app serves its own permissive `robots.txt`; make sure the **WordPress**
site's `robots.txt` doesn't block the API origin's assets either.

## 5. Core Web Vitals

Field data takes ~28 days to populate, so this is a follow-up rather than a
launch-day check.

- [ ] Search Console → Core Web Vitals: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 at
      p75, on **both** mobile and desktop.
- [ ] If you configured the `vitals` endpoint, confirm reports are arriving and
      that `framed` is `false` (it should be, on the plugin mount — `true` means
      something is still loading the tool in an iframe, where the parent page's
      own RUM cannot see its CLS or INP).
- [ ] Watch INP specifically after any change to filtering or sorting. For an
      interactive tool the worst interaction sets the score.

## 6. If you keep the legacy iframe anywhere

- [ ] Instrument the framed app separately — CLS and INP happening inside the
      frame count toward the visitor's Core Web Vitals but the parent page's
      measurement script cannot observe them.
- [ ] Don't add `loading="lazy"` to a frame near the top of the page; it delays
      the thing the URL exists for.
- [ ] Remember the framed app is `noindex, indexifembedded`, so its content only
      helps the embedding page on Google, and the parent page's own HTML stays
      empty. Prefer the plugin.
