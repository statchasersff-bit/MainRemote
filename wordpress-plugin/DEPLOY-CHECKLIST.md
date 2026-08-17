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
