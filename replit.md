# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server test` — build, then run the SEO
  regression + rendered-browser suites (see `artifacts/api-server/tests/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (the news archive),
  `DYNASTY_NEWS_API_URL` — upstream feed. **Both must be set on the deployment,
  not just the workspace**: `.replit`'s `[userenv.shared]` configures the
  workspace only, and a missing feed URL makes `runIngest()` throw at startup
  where nothing but the log shows it.
- `node ./scripts/import-sqlite-archive.mjs` (from `artifacts/api-server`) —
  one-time import of the legacy SQLite archive
- `INGEST_URL=https://<deployment>/api/ingest node ./scripts/ingest.mjs` — force a
  refresh from outside. Point a Replit Scheduled Deployment at this (every 10
  minutes) so the archive keeps moving even with no visitors; add
  `INGEST_SECRET` on both sides if the endpoint should not be open

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/lib/render.ts` — **source of truth for the tool's
  markup**. Compiled into both the server bundle and the browser bundle. Must
  stay free of Node APIs, DOM APIs, and non-determinism (`Date.now()`, locale
  defaults); the two tsconfigs enforce that from opposite directions.
- `artifacts/api-server/src/lib/ssr.ts` — renders the page and the embeddable
  fragment server-side.
- `artifacts/api-server/src/client/main.ts` — browser entry, compiled to
  `public/dist/statchasers-news.js` by `build.mjs`. Enhancement only.
- `artifacts/api-server/src/lib/db.ts` — data access. Re-exports the Drizzle
  client and the `news_items` table from `@workspace/db`, plus `newsDedupeKey`.
  The table itself is defined in `lib/db/src/schema/news.ts`.
- `artifacts/api-server/scripts/import-sqlite-archive.mjs` — one-time, idempotent
  import of the old SQLite archive into Postgres.
- `artifacts/api-server/src/routes/embed.ts` — `/embed` setup page, `/embed/ssr`
  fragment endpoint, `/embed/assets.json`, `/embed/schema.json`, legacy iframe
  snippet.
- `artifacts/api-server/src/lib/freshness.ts` — when the content last really
  changed; drives the "Last updated" stamp, ETags, and the render cache key.
- `artifacts/api-server/public/statchasers-logo-on-{dark,light}.png` — the mark
  shown in place of a missing player headshot, named for the surface it belongs
  on rather than for its own colour. The thumbnail tile is dark for every team,
  so the card uses the on-dark (white) file; the on-light (navy) one is its
  counterpart for a light surface. Referenced only from `styles.css`, so both
  resolve against the tool origin in either mount. Regenerate from the sources in
  `attached_assets/` — trim the transparent margin, resize to 192px wide and
  quantize, which is what takes them from ~110KB to under 2KB.
- `artifacts/api-server/src/client/vitals.ts` — Core Web Vitals reporting, built
  as its own bundle and fetched only when an endpoint is configured.
- `artifacts/api-server/tests/` — `seo.test.mjs` (crawler's view, no JS) and
  `rendered.test.mjs` (reader's view, real bundle in jsdom).
- `wordpress-plugin/statchasers-news/` — the WordPress plugin that mounts the
  tool into a page. See `wordpress-plugin/README.md`.

## Architecture decisions

- **Refreshes are driven by traffic, not only by a timer.** `index.ts` still runs
  an ingest every 10 minutes, but that `setInterval` only fires while a process
  is alive and this deployment idles between requests — observed in production,
  where an ingest ran at 17:28 and the next never happened while upstream moved
  on. So a middleware in `app.ts` calls `refreshIfStale()` on every response's
  `finish` event. It is throttled to one ingest per `REFRESH_MIN_GAP_MS`
  (10 minutes; `INGEST_MIN_GAP_MS` overrides it, which is how the test exercises
  the throttle) and never runs two at once, so traffic volume cannot turn into
  feed load. It is hung off `finish` so it can never add latency to a response.
  For refreshes that continue through a stretch with no visitors at all, run
  `scripts/ingest.mjs` on a schedule — it POSTs `/api/ingest`, which both
  refreshes the data and wakes an idle instance.

- **The archive lives in Postgres, not a file.** `deploymentTarget = "gce"`
  rebuilds the filesystem on every publish, so a SQLite file in `data/` was
  never a store of record — it reset to whatever snapshot was in the image, which
  is how production came to serve "No player news has been archived yet". The
  upstream feed only returns its latest ~25 items, so a reset archive cannot be
  rebuilt from it; each item's `firstSeenAt` and any generated summary would be
  gone for good. Postgres outlives the deployment. The SQLite files are no longer
  committed (they churned megabytes of binary WAL per publish and risked
  restoring stale rows over live data) — `better-sqlite3` remains only as a
  devDependency for the import script.
- **Reads are async; the ETag path is not.** Moving off better-sqlite3 made every
  query a promise, but `contentVersion()` runs mid-response while an ETag and a
  render-cache key are being assembled. Rather than thread awaits through those
  callers, `lib/freshness.ts` keeps a memoised snapshot: `ensureFreshness()` is
  awaited once per content version at the top of a request path, and
  `freshness()`/`contentVersion()` read it synchronously afterwards.

- **Server-rendered, then hydrated.** The page ships the complete news list in
  its HTML; the client bundle only paginates, relabels timestamps, and
  refreshes. Previously the page was an empty div and everything came from a
  client fetch, which meant crawlers saw no content.
- **One renderer, two bundles.** `src/lib/render.ts` is shared rather than
  duplicated so SSR output and client re-renders can't drift. This is why that
  file has hard purity constraints — see above.
- **Filtering is a view of the DOM, not an address.** The team dropdown and
  player search (`renderFilters` in `src/lib/render.ts`) narrow cards that are
  already on the page — no fetch, no `<form>` (one Enter would submit to the
  current URL and mint a duplicate), and nothing written to the URL. Filter state
  lives in the widget instance. Pages are rebuilt from the *filtered* set, so
  narrowing to three cards gives one page rather than five with holes; the
  server's `data-page` only drives the pre-hydration CSS hiding. Matching runs
  against `data-player`/`data-team` on each `<li>`, both sides folded through
  `searchKey()` so "jamarr" finds "Ja'Marr".
- **Every item is in the HTML; pagination only hides.** Pages after the first
  are hidden by CSS (`.news-list[data-paged]`) and revealed by the client. No
  click ever triggers a fetch, so primary content is never gated behind an
  interaction. A `<noscript>` block reveals all pages when JS is off.
- **Direct WordPress mount over iframe.** The plugin prints the fragment into
  the page and enqueues the bundles, so the content belongs to the
  statchasers.com URL. The legacy iframe still works and the framed app is
  served `noindex, indexifembedded`, but it leaves the parent page's HTML empty.
- **Player→team map moved to the server** (`src/lib/teams.ts`). SSR needs team
  colours at render time, and it removes a multi-megabyte Sleeper fetch that
  every visitor used to make. `team` now rides along on each `/api/news` item.
- **Metadata is server-rendered and JS never touches it.** Title, description,
  canonical and OG tags come from `src/lib/seo.ts` and are injected at the
  `<!--SSR-HEAD-->` marker. Title, H1 and og:title are derived from one pair of
  strings so they cannot drift apart.
- **The canonical is built from the path only** (`src/lib/request.ts`), so tool
  state in the query string can never produce a second canonical. The tool also
  never writes to the URL: pagination is DOM-only, with no `pushState` and no
  `?page=`, and every control is a `<button>` rather than a crawlable
  `<a href="?...">`.
- **Unknown paths 404.** The old SPA fallback returned a byte-identical 200 for
  every URL on the host, which is an unbounded duplicate URL space. The app is
  one page and lives at `/`.
- **The host page's SEO plugin stays the authority.** The WordPress plugin emits
  no canonical/title/description/og/robots/breadcrumbs. Its only structured data
  is one `SoftwareApplication`+`WebApplication` node injected into Rank Math's
  graph via `rank_math/json_ld` (`src/lib/schema.ts` is the equivalent for
  non-WordPress hosts, served at `/embed/schema.json`). No `aggregateRating` or
  `review` — we have no real rating data and won't invent any.
- **The card names the player once.** Every headline opens with the player's
  name, so the byline carries the team alone — printing the name again directly
  beside it said the same thing twice per card. The feed's own name is not
  printed either; `source` is still stored and still returned by `/api/news`,
  it just isn't shown. The player's name is still in `data-player` (the search
  filter reads it) and in the headshot's alt text.
- **Entity links are opt-in.** `TEAM_PAGE_URL_TEMPLATE` (or the plugin's
  `team_url`) turns the team name already on the card into an internal link.
  Empty by default because this server can't verify those pages exist; a player
  with no team gets no team link rather than a fabricated one.
  `PLAYER_PROFILE_URL_TEMPLATE` / the plugin's `player_url` are **currently
  inert** — the plumbing still carries them so the installed plugin keeps
  working, but no player name is rendered for them to link.
- **The framed tool stops scrolling only once the parent proves it is sizing
  it.** embed.js answers an applied height with `statchasers:height-applied`, and
  only then does the frame set `overflow: hidden` on itself. Locking
  unconditionally (or with `scrolling="no"` on the iframe) would clip everything
  below the fold on any page where the resize script is deferred or blocked and
  the frame is stuck at its placeholder height.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `pnpm run build` builds **two** bundles: the Node server and the browser
  client. `public/dist/` is generated — never edit it, and never re-add a
  hand-written `public/app.js`.
- `public/index.html` must keep its `<!--SSR-->` marker; without it the page
  falls back to a client-only render (logged as a warning).
- Anything added to `src/lib/render.ts` runs in both Node and the browser.
  `pnpm --filter @workspace/api-server run typecheck` runs both tsconfigs and is
  what catches a stray `document.` or `process.` there.
- The standalone page renders **no heading at all** — no H1, and `heading: false`
  suppresses the tool's H2. It is only ever read inside a StatChasers page, which
  supplies the header; anything here restates it, and in the WordPress mount an
  H1 here would be a second H1 in the composed page. The phrase still lives in
  `<title>`/`og:title` (`lib/seo.ts`) and in the `SoftwareApplication` name.
  `index.html` no longer has an `<!--SSR-H1-->` marker; don't re-add one.
- `.sc-filters` needs its own `[hidden]` rule for the same reason the pager does
  — `display: flex` beats the UA `[hidden]` rule, and a no-JS visitor would get
  controls that cannot filter anything. The toolbar is rendered by
  `renderFragment`, *outside* `renderList`, because a background refresh replaces
  the list and pager wholesale and must not wipe out a half-typed search.
- The pager relies on `.sc-pager[hidden]` in `styles.css`; without that rule the
  `display: flex` beats the UA `[hidden]` rule and a dead pager shows for
  no-JS visitors.
- Showing a page must assign a real `display` value, never `""`. The empty string
  removes the inline declaration and hands the card back to
  `.news-list[data-paged] .sc-card-item:not([data-page="0"])`, which hides it —
  so every page after the first renders blank while its inline style looks fine.
  Inline-style assertions cannot see this; `tests/rendered.test.mjs` loads the
  real stylesheet and checks computed styles for exactly that reason.
- `public/index.html` needs all three markers: `<!--SSR-HEAD-->`, `<!--SSR-H1-->`
  and `<!--SSR-->`. A missing one is logged as a warning, not an error.
- Don't add filter/sort UI as `<a href="?...">`. Use `<button>` and keep the
  state in the DOM — anchors here would create a crawlable duplicate URL space
  and undo the canonical work. Links to *other pages* are fine and wanted; it's
  parameterised self-links that cause the problem. Set `PUBLIC_CANONICAL_URL` if
  the app is served behind a different public URL than it sees.
- `.sc-card-player` must stay above the headline's stretched `::after` overlay
  (z-index 3 vs 2) or the player/team links become unclickable for readers while
  still being followable by crawlers — a silent, easy-to-miss regression.
- Don't add schema types to the plugin because the data happens to be there.
  Article/ItemList/Dataset/FAQPage on this page would be inaccurate, and ratings
  must never be synthesised.
- **Run `pnpm --filter @workspace/api-server test` before shipping any change to
  rendering, the plugin, or the build.** It is specifically there to catch a
  change that makes the tool invisible to crawlers again.
- Anything rendered into the root element's attributes must be added to
  `cacheKey()` in `src/lib/ssr.ts`, or requests differing only in that option
  will be served each other's cached HTML.
- The "Last updated" stamp must only move on a real content change. An ingest
  that re-sees the same items calls `invalidateFreshness(false)` — it drops
  caches without moving the date. Never bump it per request.
- **Ingest matches on the id AND the fingerprint.** Upstream reuses an item's
  id and edits its headline. The fingerprint is derived from the title, so a
  reworded story stops matching on fingerprint, looks new, and its insert
  collides with the id already stored — a primary-key violation that aborts the
  whole batch, so ONE reworded headline stops the archive dead. It did exactly
  that in production. `runIngest` therefore looks rows up by either key and
  moves the fingerprint onto the existing row when the title changed.
  `tests/ingest.test.mjs` covers it.
- `tests/ingest.test.mjs` is the only suite that writes rows, and it cleans up
  its own `test:`-prefixed row afterwards. Its stub feed serves an empty list for
  the throttle tests precisely so they cannot touch real data.
- Two Postgres behaviours differ from the SQLite they replaced, and both are
  load-bearing: `LIKE` is case-sensitive here (search uses `ilike`), and `DESC`
  sorts NULLs **first** (ordering is spelled `desc nulls last`, or an item with an
  unparseable pubDate jumps to the top of the page).
- Values from a Postgres **aggregate** arrive as strings from the pg driver —
  including `max()` over a `timestamptz`, which does *not* come back as a `Date`
  the way a plain column selection does. `lib/freshness.ts` reduces everything to
  epoch ms in SQL and converts with `Number()` for exactly this reason.
- Tests run against the **live** `DATABASE_URL`, and the server they spawn ingests
  on startup. There is no test database.
- Tests spawn the built server; drain **both** its stdio pipes. pino logs every
  request, and an unread stdout pipe blocks the server process — which presents
  as a mysteriously hung test suite.
- An inner scrollbar in the legacy iframe means the auto-resize did not land,
  and every way it fails is silent. Two rules keep it working: `.page` must keep
  `display: flow-root` (without it descendant margins collapse out of the box
  the child measures, so the frame is set a few pixels short), and `/embed.js`
  must go on trusting the frame's own `src` origin rather than only the origin
  baked in at serve time — a snippet older than the current domain otherwise has
  every height message rejected. `tests/embed.test.mjs` guards both.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
