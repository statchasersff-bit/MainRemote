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

### Section URLs

Only once `statchasers_team_section_urls` is on. Flush permalinks first
(Settings → Permalinks → Save) or every section URL 404s. Then take one team
end to end — `/nfl/teams/new-england-patriots/` and its `/outlook/`, `/stats/`,
`/schedule/` and `/depth-chart/` — and on **every one of the five** confirm:

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
- [ ] the URL is in the **page sitemap**. If the four section URLs are absent,
      the `rank_math/sitemap/page_content` filter name is the first thing to
      check — it is the one Rank Math hook not confirmed against a live build.

Then the edges:

- [ ] the bare hub still serves as before.
- [ ] `/nfl/teams/<slug>/not-a-real-section/` is a **404**, not the hub.
- [ ] on the API origin, `/team/ne/schedule/` and `/team/ne?section=schedule`
      both 301 to `/team/new-england-patriots/schedule/`; `/team/nowhere/stats/`
      is a 404.
- [ ] with the flag **off**: the section URLs 404 and the sitemap lists no
      section URLs. Off must be genuinely off.

Once all of that holds on one team, submit the page sitemap in Search Console.
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
