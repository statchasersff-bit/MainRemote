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

### Matchup pages

Only once the holder page exists — **Tools → StatChasers Pages → Matchup
pages** creates it, and the pair URLs are live from that point. Then on
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
