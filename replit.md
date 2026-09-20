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
- `pnpm --filter @workspace/api-server run ingest-fpa` — rebuild Fantasy Points
  Allowed from nflverse. Weekly in season; idempotent. Nothing renders at `/fpa`
  until this has run once.
- Required env: `DATABASE_URL` — Postgres connection string (the news archive),
  `DYNASTY_NEWS_API_URL` — upstream feed. **Both must be set on the deployment,
  not just the workspace**: `.replit`'s `[userenv.shared]` configures the
  workspace only, and a missing feed URL makes `runIngest()` throw at startup
  where nothing but the log shows it.
- `DYNASTY_NEWS_API_URL` accepts a **comma-separated list** of feed URLs, tried
  in order until one works. A dead entry costs one failed request, not an outage,
  which is what makes an unverified origin hostname safe to put first.
  `/api/status` reports `feedHosts` and which one last worked (`lastSource`).
- `POST /api/ingest` also takes **push mode**: send `{"items":[...]}` and the
  server stores them without any outbound call, so it works even when the feed is
  unreachable from the deployment. Requires `INGEST_SECRET`. `scripts/ingest.mjs`
  drives it when `FEED_URL` is set.
- Optional env: `DYNASTY_NEWS_API_KEY` — shared secret sent to the feed as
  `X-SC-Ingest-Key`. Inert when unset. It is what gets the ingest past Dynasty
  Command's origin lock on `dynasty-command.replit.app`, whose exception is
  scoped to `GET`/`HEAD` on `/api/news` only. **Not a Cloudflare rule and not a
  general API credential** — see the architecture note below and
  `docs/ingest-cloudflare.md` before assuming it reaches anything else. Must match
  `SC_INGEST_KEY` on the Dynasty Command deployment. A newly added Replit secret
  needs a full **Stop → Start**; a publish keeps the environment it booted with.
  `/api/status` reports `feedKeyConfigured` so you can tell "never arrived" from
  "wrong value".
- Monitoring env: `INGEST_ALERT_MAX_FAILURES` (default 3) and
  `INGEST_ALERT_MAX_AGE_MS` (default 1h) set when `GET /api/ingest/health` starts
  answering 503. Point an uptime checker at it — see below
- **Seeing the team pages in the Replit preview.** The workflow serves the
  whole app on port 8080, so the preview URL already carries them. It opens at
  `/`, which is the news tool and links nowhere else (it is the embedded
  product; adding navigation to it would change what WordPress prints) — so in
  development a **preview switcher** is pinned to the top of every standalone
  page instead. See `artifacts/api-server/src/lib/devbar.ts`. Without
  leaving the preview it gives you:
  - the two shortcodes — `[statchasers_news]` and `[statchasers_team]`;
  - a **team picker**, all 32 grouped by division, which changes the team
    without changing which view you are in;
  - the four **mounts**: *Page* (this app's own shell), *Embed* (`?embed=1`,
    the markup stripped for a host page), **Shortcode** and *Raw*. The news
    tool has no Embed button: `?embed=1` does nothing on `/`, and offering it
    there was the bar claiming a variant that does not exist;
  - the shortcode producing what is on screen, printed on the right.

  **Shortcode** is the mount to use when comparing the two tools as published.
  The fragment endpoints ship bare markup with no stylesheet and no script,
  because on a real page WordPress enqueues those separately — so opening
  `/embed/ssr.html` in a browser is an unstyled wall of HTML you cannot judge
  anything by. `/preview/news` and `/preview/team/:slug`
  (`artifacts/api-server/src/routes/preview.ts`) assemble what WordPress
  assembles: the same fragment from the same renderer, wrapped in a mock host
  page carrying the stylesheet and bundle the plugin registers. Because the
  mount travels with the tool switch, picking *Shortcode* once and then
  clicking News / Team Hub **alternates between the two shortcode pages**,
  which is what the bar is really for.

  *Raw* shows the literal bytes as source, at `/preview/raw/news` and
  `/preview/raw/team/:slug`. It used to link straight at the fragment endpoint
  and therefore had to open a new tab — the bar is never injected into a
  fragment, so that link stranded you in bare markup with no way back. A new
  tab is the wrong answer inside a preview pane. **Nothing in the bar opens a
  new tab now**; every control is an in-place navigation, so the whole thing
  works in one frame.

  The harness is development-only and 404s in production — it is a second way
  to assemble the same markup, and two differently-assembled copies of a tool
  on the public internet is the duplicate-content problem the canonical work
  exists to avoid. The guard is scoped to `/preview`; a bare
  `router.use(guard)` 404s the whole app, which is a mistake that has already
  been made once and is covered by a test.

  The **DEV** chip on the left collapses the bar to a corner chip and remembers
  it, for when you want the full height of the pane back.

  It is `position: fixed` at the top and pads the body by its own measured
  height rather than a hard-coded one, because it wraps to two or three rows in
  a narrow pane. On a team page it also sets `--sct-nav-offset` on the hub root
  to that height — the property the hub already exposes for "a host page with
  its own sticky header" — so the section nav parks underneath it instead of
  colliding with it. The whole thing is guarded by the same
  `NODE_ENV === "development"` check that arms live reload, so it cannot reach a
  production response.

  Direct addresses still work: **`/team`** for an index of all 32, or
  `/team/new-england-patriots`. The dev server injects the same live-reload
  snippet the news page gets, so editing `public/team.css` or `public/team.html`
  refreshes the preview; editing anything under `src/` still needs a rebuild.
  In development the team routes answer `no-store` and skip the conditional
  `304`: the render fingerprint covers the DATA, not the shell, so a warm
  validator would otherwise keep serving the markup from before your last edit.
- **Team hub link configuration.** `/team/:slug` links out to the real
  StatChasers tools, and every destination is an environment variable with a
  best-guess default that this server cannot verify — see the header of
  `artifacts/api-server/src/lib/team/links.ts`. Only `SC_TEAM_HUB_URL_TEMPLATE`,
  `SC_SOS_URL`, `SC_TOOLS_URL` and `SC_PLAYER_STATS_URL` have any evidence
  behind them — the last two were given by the site's owner. Check the rest
  against the live site and correct them here; setting one to an empty string
  removes that link everywhere rather than pointing it at a 404:
  `SC_SITE_ORIGIN` (default `https://statchasers.com`),
  `SC_TEAM_HUB_URL_TEMPLATE`, `SC_DEPTH_CHART_URL_TEMPLATE`,
  `SC_TEAM_SCHEDULE_URL_TEMPLATE`,
  `SC_TOOLS_URL` (the "Explore StatChasers" tool index),
  `SC_PLAYER_STATS_URL` (league-wide, not team-filtered — it replaced a
  guessed `SC_TEAM_PLAYERS_URL_TEMPLATE`, which no longer exists),
  `SC_PLAYER_PROFILE_URL_TEMPLATE` (default `/nfl/players/outlook/{player}/`;
  `{player}` is filled from the player dictionary's own slug, NOT slugified
  from the name — the site spells A.J. Brown `aj-brown` and slugify gives
  `a-j-brown`. A name the dictionary does not index gets no link rather than
  one to a page that may not exist; set this to an empty string to switch every
  player link off), `SC_SOS_URL`, `SC_FPA_URL`, `SC_NEWS_URL`.
- **Section-scoped team URLs.** `/team/:slug/<section>/` is the public
  address — one panel as the whole page: hero, that section, a strip of real
  resources — with a title, description,
  self-referencing canonical, `og:url` and FAQ written for that section alone.
  Public sections are `PUBLIC_SECTIONS` in `team-render.ts` (`outlook`,
  `stats`, `schedule`, `depth-chart`, `matchups`); any other segment, including
  `news` and case variants, is a true 404 so no path can mint a copy of the
  hub. Three tabs carry questions: Outlook, Stats and Depth Chart, built by
  `team/outlook-faq.ts`, `team/stats-faq.ts` and `team/depth-faq.ts` — every
  answer restates something its own tab printed. The depth chart's are present
  tense and name no season, because a depth chart is the roster as it stands
  rather than a claim about a year; the outlook's carry one for the opposite
  reason, and that is what keeps "who is the starting running back" from
  reading as the same question twice.

  Both the chart and its FAQ read `sidelinedBehind()` (`team/roster.ts`) for
  the players Sleeper has demoted out of view. Sleeper moves an injured player
  down its own depth chart rather than removing him, so a genuine WR1 on IR
  lands at WR6 and falls off the four-deep preview — the column then promotes
  everyone behind him with nothing saying why. Those players are appended to
  their column after the numbered rows, carrying their designation badge and no
  slot number, and named in the answers above.

  **`matchups` has a public URL but is not a tab** (`hubTab: false` on its
  Section): it listed the same fixtures the Schedule tab does, and every
  Schedule row now carries its own "View matchup" link, so carrying both was
  the same list twice. The page still renders and is still indexed — it is just
  no longer linked from the hub, which leaves it orphaned by design.
  `?section=<id>` is the internal spelling: `/embed/team/:slug?section=` is
  what the WordPress plugin fetches, and on `/team/:slug` it 301s to the pretty
  path (`news` alone renders scoped there, having no public address). Neither
  the hub nor a section page prints a strip of links to the section pages;
  their discovery rests on the plugin's sitemap entries. The plugin mirrors the
  list as `STATCHASERS_TEAM_SECTIONS` — keep the two together.
- **Matchup pages.** `src/lib/matchup/` is its own family beside `team/`:
  `pair.ts` (the ONE place two teams become a URL — alphabetical by slug, 496
  pairs, aliases resolved, same-team and unknown refused), `matchup-data.ts`
  (both teams' TeamPageData plus meetings from the current and five prior
  regular-season schedules; decides `upcoming` / `recently_completed` /
  `historical` once), `matchup-render.ts` (built from team-render's exported
  scoreboard, game, stat-row and injury components), `matchup-seo.ts`,
  `matchup-ssr.ts`. Routes: `/nfl/<a>-vs-<b>/` (non-canonical order or alias →
  301; anything else → 404, never a hub) and `/embed/matchup/<a>-vs-<b>`, which
  returns `X-Matchup-State` / `X-Matchup-Season` / `X-Matchup-Score` for the
  plugin's title and description.
  `SC_MATCHUP_PATH_PREFIX` (default `/nfl/`) is where hub links point. Each hub
  has a `matchups` public section listing every game with a link to the pair.
- **The postgame matchup page.** A pair whose meeting was just played renders a
  different page, not the fixture page with a score in it. `data-postgame="1"`
  on the root marks it, and `isPostgame()` in `matchup-render.ts` is the one
  place that decides. The hero IS the scoreboard — crest, nickname, score at
  display size, record, venue, and the quarter-by-quarter line — and there is
  no separate "Final" card under it. Then: **Why the \<winner\> Won** (the box
  score as one comparison, with a sentence composed from the rows themselves),
  **Game Leaders** (four cards with headshots), **Player Stats** (passing,
  rushing, receiving and a Fantasy table carrying PPR/half/standard and the
  week's positional finish), **Fantasy Takeaways**, **Fantasy Usage**,
  **Injuries & Fallout**, **What This Changed**, **Season Form**, and
  Head-to-Head last. Pregame the order and the old headings are unchanged.
  A pair with no current meeting but an old one (`historical`) keeps the
  rivalry page — head-to-head first, then that meeting's detail — and is given
  the box score and the stat tables but NOT the takeaways or the usage table,
  which are advice about the coming week.
- **Fantasy Usage is charts, not a sixth table.** One panel per team, the same
  metrics in the same place on both sides. Snap share is ranked bars — five
  players can each be on the field for 80% of the same snaps, so those shares
  are not a distribution and must not be drawn as one — then target share and
  carry share as SVG rings. `usageByTeam()` in `matchup/game-stats.ts` decides
  both populations and both denominators: the bars follow the table and leave
  quarterbacks out, the rings include them because a quarterback's carries are
  a real part of a backfield. Five named slices at most, the tail pooled into a
  grey "Other", nothing drawn for a player who did not record the stat, and a
  zero denominator prints "Target share data unavailable" rather than an empty
  ring. Every name, percentage and raw count is text beside the chart: the SVG
  is `aria-hidden` and carries only tooltips. No chart dependency — a ring is
  one dashed `<circle>` per slice. The table itself is unchanged and still
  sortable, one copy of it, inside a closed `<details>` under the panels.
- **Where the postgame data comes from, and what is missing.** Three sources,
  each allowed to fail on its own:
  - `matchup/boxscore.ts` — ESPN's `summary?event=<id>`, keyed by the event id
    now carried on every `ScheduleGame` (`espnEventId`). It is the ONLY source
    of the quarter line and the team figures; no box score means those two
    blocks are absent, never estimated.
  - `matchup/game-stats.ts` — the Sleeper weekly logs the player pages already
    read, joined once per page in `matchup/appearances.ts`. Everything about
    players comes from here: the stat tables, the fantasy scorings, snaps and
    share, and the takeaways.
  - `matchup/fpa-delta.ts` — `fantasy_points_allowed_games`, re-ranked at two
    cutoffs (weeks before the game, weeks through it) to give each defense a
    before and an after. Week 1 has no before, and the block renames itself
    rather than drawing an arrow from nothing. The FPA ingest clears its cache.

  **Sorting.** The five player tables (the four stat tables and the usage
  table) carry `data-sct-sortable`; `wireSortableTables()` in
  `src/client/team.ts` turns each header into a button, the same contract the
  FPA table and the player pages' game log use — `data-sort` on every cell
  (because the cell's text and its sort value disagree: "16/22", "90%", "WR6"),
  `data-sort-type` declared by the header, numeric columns opening descending.
  Two things are specific to these tables: `data-sort-default` marks the column
  the SERVER already ordered by, so the table announces the sort it has rather
  than "none"; and a cell with an empty `data-sort` is a missing value, held at
  the bottom in BOTH directions rather than treated as a zero. The buttons are
  built in the browser — a control that cannot work does not ship in the HTML.

  **Routes run are not available** from any free source and there is no routes
  column. **Who left the game injured** is not available either: ESPN's
  per-game `injuries` block is the current report, not in-game exits, so
  Injuries & Fallout says what it is rather than claiming a Q3 exit.
- **`SC_TEAM_PATH_PREFIX` must be set for the WordPress mount** (default
  `/team/`). It is where the team switcher's 32 links point inside
  `/embed/team/:slug`, so left at the default a reader clicking a team on
  statchasers.com is sent to the bare tool on this origin. Set it to
  `/nfl/teams/`. The `?embed=1` the switcher appends is derived from it rather
  than fixed — kept while the prefix is local, dropped once it points off-origin,
  because `embed` is a reserved WordPress query var and
  `/nfl/teams/dallas-cowboys/?embed=1` serves WordPress's oEmbed template
  instead of the page. `SC_TEAM_LINK_QUERY` overrides it either way.
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
- `artifacts/api-server/src/lib/x/` — the X (Twitter) reporter integration.
  `types.ts` is the provider interface every other file talks to;
  `public-provider.ts` / `official-provider.ts` are the two implementations;
  `accounts.ts` is the monitored list and the claim-by-UPDATE that serves as the
  polling queue; `post-shape.ts` is the pure "is this reporting, and what is its
  headline" half; `ingest.ts` hands the result to the SAME `storeItems()` the
  wire and the club feeds use. Off unless `X_NEWS_INGESTION_ENABLED=true`.
- `artifacts/api-server/src/lib/news-category.ts` — injury / transaction /
  practice / depth-chart / rumor / fantasy, derived at read time for every row
  and never stored. Improving the rules re-reads the whole archive with no
  backfill.
- `artifacts/api-server/public/admin-x.html` — the monitored-account manager at
  `/admin/x`. Self-contained; adding a reporter is a row, not a deploy.
- `docs/x-ingestion.md` — how the X integration is wired, every environment
  variable it reads, and the measured limits of the free public provider.
- `docs/INGEST-FIX-CHECKLIST.md` — the do-this-now steps for pointing the ingest
  at the API origin. Background and alternatives are in the runbook below.
- `docs/ingest-cloudflare.md` — runbook for the Cloudflare challenge that blocks
  the deployment from the upstream feed. Start there when `/api/status` shows a
  403 whose body says "Just a moment...".
- `wordpress-plugin/statchasers-news/` — the WordPress plugin that mounts all
  six tools into a page: `statchasers-news.php` is the plugin and the news
  shortcode, `statchasers-team.php` the hubs, `statchasers-player.php` the player
  pages, `statchasers-fpa.php` the Fantasy Points Allowed table,
  `statchasers-rankings.php` the redraft rankings, `statchasers-schedule.php` the
  NFL schedule. See `wordpress-plugin/README.md`.

### NFL Team Hub (`/team/:slug`)

A second tool in the same app, sharing the news pipeline, the player→team map
and the deployment. It does not touch the news page.

- `src/lib/team/teams.ts` — **the canonical 32-team table**. One row per
  franchise: id, slug, names, division, colours, ESPN ids. Nothing else may
  carry a team mapping. `getTeamBySlug`, `getTeamByAbbreviation` and
  `normalizeTeamName` are the only ways to turn a string into a team;
  `normalizeTeamName` also accepts nicknames, ESPN codes and retired ones
  (`OAK`, `SD`, `STL`, `WFT`).
- `src/lib/team/links.ts` — every statchasers.com URL these pages emit, in one
  place, env-configurable. See the note under Run & Operate.
- `src/lib/team/roster.ts` — depth chart, fantasy cornerstones and injury
  designations, indexed per team from Sleeper's player dictionary. Fed by
  `lib/teams.ts` out of the fetch that already happens for the news cards.
- `src/lib/team/cache.ts` — the stale-while-revalidate keyed cache every
  provider uses, plus `TEAM_USER_AGENT`.
- `src/lib/team/schedule.ts` / `profile.ts` / `snapshot.ts` — ESPN providers:
  the regular-season fixture list (bye week derived from the gap), record and
  head coach, and the four Team Snapshot rates with their NFL ranks.
- `src/lib/team/nfl-state.ts` — season, week and season type from Sleeper.
  Gates the record and picks which season the snapshot describes.
- `src/lib/team/team-data.ts` — composes one `TeamPageData` from all of the
  above with `Promise.allSettled`, and fingerprints it for the render cache.
- `src/lib/team-render.ts` — **all team-page markup**. Server-only (unlike
  `lib/render.ts`), because nothing on this page is re-rendered in the browser.
- `src/lib/team-ssr.ts`, `src/lib/team-seo.ts` — page assembly, fragment cache
  and head metadata. `public/team.html` is the shell.
- `src/routes/team.ts` — `/team`, `/team/:slug`, `/team/:slug?embed=1` and
  `/embed/team/:slug` (the bare fragment for the WordPress mount). The consumer
  of that last one is `[statchasers_team]` in
  `wordpress-plugin/statchasers-news/statchasers-team.php` — and it is the only
  thing that makes these pages indexable at all, since every team route ships
  `noindex, indexifembedded` and an `indexifembedded` page nobody embeds is
  simply noindexed.
- `src/client/team.ts` → `public/dist/statchasers-team.js` — enhancement only:
  sticky-nav highlighting, switcher dismissal, relative timestamps, iframe
  height. `public/team.css` is its stylesheet.
- `tests/team.test.mjs` — the crawler's-eye regression suite for these pages.

### NFL Player Pages (`/player/:slug`)

The third tool in the same app, ported from the standalone
`statchasers-player-pages` repo. It shares the deployment, the canonical team
table and the news archive; it does not touch the news page or the hubs.

The port changed the architecture, not the content. That app was an Express +
React SPA whose 3,200-line profile component built every section in the browser,
plus a self-contained WordPress plugin that bundled 12MB of JSON, registered its
own rewrite rules and owned its own SEO. Here the server renders the profile and
`[statchasers_player]` prints it into a statchasers.com page, exactly as the news
tool and the hubs work — and Rank Math keeps the SEO.

- `data/player/*.json` — **the whole dataset, committed**. ~13MB across the
  player dictionary, three seasons of game logs, game scores, bios, dynasty
  rankings, injury history, season production, Sleeper roster percentages, the
  2026 outlook and the advanced stats tables. This is what makes a player page
  cheap: assembling one is arithmetic over objects already in memory, with no
  upstream in the request path at all. Rebuilt by `scripts/player/` — see its
  README for the order.

  **`roster_pct.json` is the one file that ages.** It is how widely Sleeper's
  leagues rostered each player in ONE week, not a record of a finished season,
  and it carries that season and week inside it. Sleeper publishes two cuts of
  the research endpoint and neither is filtered by how many quarterbacks a
  league starts: the default (673 players) and `league_type=2`, the dynasty one
  (1662). The default is what the header reads and the figure is labelled
  "Sleeper redraft", not "1QB", because that is the claim the source supports —
  the same week had Jacoby Brissett at 11.8% in the default cut and 71.8% in
  the dynasty one.
- `src/lib/player/data.ts` — every read of that directory, in one place. Each
  file is optional (a missing one drops the section it feeds, never 500s) and
  parsed at most once. `dataStamp()` fingerprints the files and is what the
  render cache keys on.
- `src/lib/player/ranks.ts` — weekly positional ranks, opponent ranks, team
  target share and the padding that makes a season show its byes and absences as
  rows. All derived at read time, which is what lets one dataset answer for
  Standard, Half-PPR and PPR. The per-season league tables are cached per
  (season, format), because a weekly rank is a statement about every player in
  the league that week.
- `src/lib/player/metrics.ts` — the numbers, as pure functions. **Note the two
  tier scales**: weekly finishes bucket uniformly (1-12 / 13-24 / 25-36 / bust),
  the season and career aggregates bucket per position (QB and TE bust outside
  18, WR outside 36). That inconsistency came across from the original
  deliberately — both numbers are published, and unifying them would silently
  restate every percentage on every profile.
- `src/lib/player/benchmarks.ts` — efficiency percentiles within the position,
  with the volume threshold that decides both who is in the distribution and
  whether the player gets percentiles at all.
- `src/lib/player/advanced.ts`, `injury.ts` — the Advanced Stats and Injury tabs.
  The advanced tables are self-describing (columns + rows), so a rebuilt table
  with new metrics renders with no code change.
- `src/lib/player/player-data.ts` — composes one `PlayerPageData` and
  fingerprints it. The only asynchronous sources are this app's own archive and
  the roster snapshot, which together are what the News tab is made of — see
  below.
- `src/lib/player-render.ts` — **all player-page markup**. Server-only, like
  `team-render.ts`. Carries the rule the other two tools do not need: nothing on
  this page predicts. Every label is a restatement of a number printed beside it,
  and the one forward-looking block (the 2026 outlook) is quoted and attributed
  rather than spoken in the page's voice.
- `src/lib/player-ssr.ts`, `src/lib/player-seo.ts` — page assembly, fragment
  cache and head metadata. `public/player.html` is the shell. The canonical
  always points at the bare slug: three scoring formats are three renderings of
  one page, not three pages.
- `src/routes/player.ts` — `/player`, `/player/:slug`, `/embed/player/:slug` (the
  fragment the shortcode reads) and `/embed/players.json` (the roster manifest
  `scripts/create-player-pages.sh` builds the WordPress pages from). No alias
  redirects, unlike the hubs — a team has a few well-known aliases, a player slug
  has thousands of near-misses.
- `src/client/player.ts` → `public/dist/statchasers-player.js` — enhancement
  only: tabs, relative timestamps, a hover layer on the weekly chart, sortable
  game-log columns. `public/player.css` is its stylesheet.
- `src/client/enhance.ts` — the tab/timestamp/iframe-height behaviours shared
  with the hubs. `client/team.ts` still carries its own copies; it predates this
  module and folding it in is a follow-up, not something to do while adding a
  third tool.
- `tests/player.test.mjs` — the crawler's-eye regression suite. Picks its fixture
  player from `/embed/players.json` at runtime rather than hard-coding one, so a
  trade does not fail the suite. It also carries the first tests that run a
  server in **development** mode: the preview switcher and the `/preview/*`
  harness are guarded by `NODE_ENV`, so every other suite could only ever assert
  they are absent — and the player pages shipped with routes, a shortcode and
  tests while being missing from the switcher entirely. `startServer()` now
  takes a `NODE_ENV` override for that.
- The switcher (`lib/devbar.ts`) and the harness (`routes/preview.ts`) both
  carry a player entry: `/preview/player/:slug` for the shortcode view,
  `/preview/raw/player/:slug` for the source view, and a roster picker that is
  injected only on player pages — six hundred `<option>`s is ~40KB and has no
  business on the news tool.

**The News tab is a superset of the one it replaces.** The standalone app's
version had two lazily-fetched views behind a toggle — articles and the club's
injury report — scraped from eight club websites, which meant the other
twenty-four teams saw an empty tab. Here it is three stacked blocks, all in the
first response and all covering 32 teams:

1. the **current injury designation** (status, body part, practice
   participation) from the roster snapshot `lib/team/roster.ts` already keeps
   for the hubs' Injury Watch, stamped with when that snapshot was read;
2. the **player's own news**, from `listNews()`;
3. their **team's news**, from `listNewsForTeam()` — the same club feeds the
   hubs read — deduped by row id against (2), with a link through to the hub.

No toggle, because nothing is fetched: hiding half the tab behind a button only
made sense when the other half cost a request. And no impact tags or generated
blurbs: the original had them, this app does not produce them, and inventing a
"high impact" label would be the page asserting an editorial judgement nobody
made.

The designation card renders **only when a designation exists**. There is no
"Healthy" state and deliberately no styling for one — the snapshot reports what
clubs have filed, and "nothing filed" is not the same claim as "fit".
`tests/player.test.mjs` asserts that in both directions.

**The charts are specified, not styled.** The four finish tiers are an *ordinal*
scale, so they take one hue in four monotone lightness steps (OKLCH L 0.359 /
0.500 / 0.628 / 0.754, palest still ≥2:1 on white) rather than four hues — the
order is visible in the colour, and every tier is labelled in text as well. The
weekly chart's two series were validated as a pair (ΔE 23.7 under protanopia).
Those values are in `public/player.css` with the reasoning beside them; changing
them means re-validating, not re-eyeballing.

### Fantasy Points Allowed (`/fpa`)

The fourth tool, ported from the standalone `FPA` repo. Unlike the player pages
it is database-backed: an ingest writes to Postgres and the page reads 96 rows.

The port changed the WordPress half, not the football. That repo's plugin
cached the JSON in WordPress and drew the table in the browser — "WordPress is
the control panel, Replit is the data engine" — which leaves the page's own HTML
an empty container. Here the API renders the table and `[statchasers_fpa]`
prints it, like the other three.

- `lib/db/src/schema/fpa.ts` — two tables. `fantasy_points_allowed_games` is the
  granular record (season, week, defence, position, format) and exists so a
  served figure can be traced to the weeks that made it;
  `fantasy_points_allowed_snapshots` is the one-row-per-(defence, format) figure
  the page serves.
- `src/lib/fpa/nflverse.ts` — fetch, RFC-4180 CSV parse, and the scoring formula
  for all three formats. Written out rather than read off upstream's own
  `fantasy_points` columns, because a rule on the page is checkable and a column
  taken on trust is not — and Half-PPR is not published at all. `scoreRow` is
  pure and the tests check it against those columns.
- `src/lib/fpa/blend.ts` — **the two halves of one decision**:
  `currentSeasonWeight` is the weight the ingest applies, `describeDataMode` is
  the sentence the page prints about it. Deliberately free of any database
  import, which is what lets the tests assert the prose against the arithmetic
  without a Postgres connection.
- `src/lib/fpa/ingest.ts` — aggregation, the strength-of-schedule adjustment,
  and the blend. Replaces rather than accumulates, in one transaction.
- `src/lib/fpa/fpa-data.ts` — the read: one query, ranked. **Rank 1 is the
  softest defence** (the industry convention, and the one that matches how the
  table is read); the page says so in words and `tests/fpa.test.mjs` asserts the
  direction off the rendered HTML.
- `src/lib/fpa-render.ts` / `fpa-ssr.ts` / `fpa-seo.ts` — markup, fragment cache
  and head metadata. `public/fpa.html` is the shell, `public/fpa.css` the
  stylesheet. The canonical always points at the bare path: six combinations of
  format and view are one page.
- `src/routes/fpa.ts` — `/fpa`, `/fpa/download.csv` (built from the same query
  the page renders, so the file and the screen cannot disagree) and `/embed/fpa`.
- `scripts/ingest-fpa.mjs` — `pnpm --filter @workspace/api-server run ingest-fpa`.
  Schedule it weekly in season.

**The number says what it is a mix of.** Early in a season the figure is mostly
last season's, so the data-mode note sits ABOVE the table rather than under it —
a caveat a reader meets after forming an opinion has not done its job. For the
same reason the games column is headed with the season (`2026 G`) rather than
"Games Played": at week 2 most teams show 1, beside a number that is still 60%
last season.

**A cold database does not block a request.** The first request that finds no
snapshots kicks off one background ingest and returns the honest empty state
immediately; concurrent requests share the in-flight promise, and a failure
backs off for a minute. Scheduled ingest is still the intended path — this is
the safety net under it, not the mechanism.

**The colour scale is diverging, not ordinal.** Rank 1 is softest, 32 toughest,
league average in the middle, so it takes two hues either side of a neutral
rather than one ramp. The poles were validated as a pair (ΔE 19.1 under
protanopia, both above 6:1 on white) and the arms are lightness-symmetric. Every
tinted cell prints its rank.

### Redraft Rankings (`/rankings`)

The fifth tool, ported from the standalone `Redraft-Rankings-table` repo. The
lightest of them: the rankings are a CSV somebody publishes, so there is no
ingest, no database and nothing to compute — the work is reading a file and
deciding what the tiers are.

The port changed the WordPress half, not the football. That repo prerendered the
board at BUILD time and hydrated it with React, which has two consequences: the
page was only as fresh as the last deploy, and the four position panels nobody
had clicked lived in component state rather than in the markup — so to a crawler
they were not on the page. Here the API renders all five panels per request and
`[statchasers_rankings]` prints them, like the other four.

- `data/rankings/redraft-<season>.csv` — the published board,
  `Position,Final Rank,Player`. Ranks are **positional**: QB1 and RB1 are both
  rank 1. An optional `redraft-<season>.meta.json` beside it carries the
  "updated" line. Adding a 2027 file is a data drop, not a code change — the
  loader discovers seasons by filename and serves the newest.
- `src/lib/rankings/rankings-data.ts` — the read, and the domain. `TIER_RULES`
  is where a tier boundary moves; it is **editorial**, not computed, because the
  cliff between QB5 and QB6 is a judgement about the position. `POSITION_LIMITS`
  is how deep each board goes (40/50/100/40) — the source file runs to 713
  players and the page has no business printing all of them.
- Team abbreviations and player links come from `data/player/players.json`, the
  dictionary the player pages already load, rather than the 700 kB Sleeper map
  the standalone app shipped. It places all 230 displayed players; 224 of them
  also have a player page. **A player it cannot place keeps his row and loses
  his link** rather than pointing at a 404.
- `src/lib/rankings-render.ts` / `rankings-ssr.ts` / `rankings-seo.ts` — markup,
  fragment cache and head metadata. `public/rankings.html` is the shell,
  `public/rankings.css` the stylesheet. The canonical always points at the bare
  path: five boards of one set of rankings are one page.
- `src/routes/rankings.ts` — `/rankings`, `/rankings/download.csv` (built from
  the same load the page renders, and carrying the derived tier and team columns
  the source file does not have) and `/embed/rankings`.
- `src/client/rankings.ts` — tab behaviour only. Deliberately no sorting: a
  tiered board has one meaningful order, the one it is published in, and letting
  a reader sort it alphabetically would only take the tiers apart.

**The side-by-side board must not read as an overall board.** Four columns
aligned by rank invites "QB7 and RB7 go at the same pick", which is not what it
says. The caption states the positional reading explicitly, and
`tests/rankings.test.mjs` asserts that it does.

**The tier scale is nominal, not ordinal.** Tier 3 is not "more" than tier 2, it
is a different group, so the tints are seven distinct hues at one lightness
rather than a ramp. All of them sit near 95% lightness, which keeps the name at
full contrast; the rank column and the tier column carry the same information in
text, so nothing is encoded in colour alone.

### NFL Schedule (`/schedule`)

The sixth tool, ported from the standalone `nfl-schedule` repo. There the
browser fetched a JSON season and React drew the board from it; here it is a
server module and the board arrives as markup. The normalization boundary is
unchanged, deliberately — nflverse publishes a compact machine feed, and
normalizing once is what keeps the weekly board, the team lens and the season
matrix from each growing their own special cases.

It is the only tool here whose data can change while somebody is reading it,
and most of what is distinctive about it follows from that.

- `src/lib/schedule/schedule-data.ts` — the normalized slate, and **two
  upstreams on two clocks**. nflverse (`nfldata/games.csv`) is authoritative for
  who plays whom, where, and at what posted line; it barely moves, so it is
  cached six hours. ESPN's public scoreboard supplies the live layer — TV
  network and in-progress score — and is cached apart on a 30-second clock while
  a game is live. ESPN is **best-effort in the strong sense**: a game whose
  broadcast we cannot learn ships `network: null` and renders TBD, and a
  scoreboard that refuses us entirely leaves the slate intact. That is not
  hypothetical on this host, where ESPN's endpoints already 403 us.
- **It does not invent a kickoff.** A flexed future week has an empty `gameday`
  and `gametime` in the feed, and those stay null all the way to the renderer,
  which prints TBD. Filling them with a plausible Sunday afternoon would make
  the page confidently wrong about the one thing a schedule is for.
- The bye week is **derived**, not read: it is not a row in the feed. Every team
  playing 17 games and taking exactly one bye is what `tests/schedule.test.mjs`
  asserts, because that is the assertion a normalization bug fails.
- `src/lib/schedule-render.ts` / `schedule-ssr.ts` / `schedule-seo.ts` — markup,
  fragment cache and head metadata. `public/schedule.html` is the shell,
  `public/schedule.css` the stylesheet. The canonical points at a path and never
  at a parameter, and that matters more here than anywhere else: view, team and
  filter combine into several hundred URLs, every one of them a near-duplicate.
  The description does vary by view, because the three views are genuinely about
  different things.
- **A week is a page; everything else is a parameter.** `/schedule/week-2` is
  week 2 — a different slate of games, with its own title, its own description
  and its own canonical — where `?view=`, `?team=` and `?filter=` are ways of
  looking at one board and never change the canonical. `/schedule` itself is the
  way in rather than a nineteenth page: it renders the week the season is on and
  points its canonical at that week's address, so the two spellings of one board
  resolve to one page. `?week=` is answered with a 301 to the path; a week the
  season does not have (`week-0`, `week-19`, `week-02`) is a 404 rather than a
  second spelling of a week it does have.
- `src/routes/schedule.ts` — `/schedule`, `/schedule/week-:week`,
  `/schedule/download.csv`, `/schedule/schedule.ics` and `/embed/schedule`. Both
  exports are built from the same `getSchedule` the page renders, so the file
  and the screen cannot disagree — the standalone app generated its CSV from a
  second formatter in the browser, which is how they drift. The fragment still
  takes its week as a query argument, because there it is an argument to a
  render rather than an address; the WordPress plugin owns the address.
- `src/client/schedule.ts` — kickoffs relabelled into the reader's own time zone
  (the server says ET because it has no idea where the reader is), the week
  strip scrolled to where you are, and a team picker that submits itself. That
  is all; the board is complete before it runs.
- **Two test seams**, both also operationally useful. `SC_SCHEDULE_CSV_URL`
  redirects the slate, which is how `tests/schedule.test.mjs` serves the real
  2024 season from `tests/fixtures/` over loopback instead of asserting against
  whatever nflverse published this morning. `SC_SCHEDULE_ESPN=0` drops the live
  layer — worth setting on a host ESPN refuses, where eighteen doomed requests
  per cold season are eighteen six-second timeouts spent learning nothing.
- `SC_SCHEDULE_SEASON` pins the season, for the weeks either side of a new
  league year when nflverse has published next season's slate and the site still
  wants to show the one being played.

**The visual design is the source repo's, and this tool is the one exception to
the house look.** Team, player, FPA, rankings and matchup all share one
hand-written design system; the schedule does not, because it is the tool
readers already know from the standalone app and it was asked to arrive looking
like it (reversing the call made on 2026-09-19). `public/schedule.css` is
therefore a transcription of `artifacts/nfl-schedule/src/styles/app.css` and the
Tailwind utility strings in its `App.tsx`: DM Sans for text and Space Grotesk
for the display face, the source's HSL token set (navy `220 56% 19%`, gold
`43 83% 49%`), square cards and controls throughout, the source's container
queries on the board, and its class-activated dark theme.

Two things about that theme are worth knowing. It is opt-in by class
(`scs-dark` on the wrapper or on `<body>`), never `prefers-color-scheme`,
because this mounts inside a WordPress theme with its own opinion and a tool
that went dark on its own would be the only dark thing on the page — the source
is class-activated too. And in dark, `--scs-primary` becomes the **gold**, not a
lighter navy: navy on navy disappears, so the source promotes the accent into
the primary slot and everything that was navy text becomes gold text.

What did NOT come across is structure, which stays server-rendered: the three
views, the When/Matchup/TV grid, the market coverage floor, the centred sidebar
cards, the team lens's extra result and TV columns, and the rule that home and
away are always stated in words and never carried by position alone.

**The fragment answers 503, not an empty shell, when the feed is down.** That is
what lets the WordPress plugin tell "down right now" from "nothing to show", and
it caches the two very differently: the last good board is kept seven days,
because a schedule a few hours stale is still almost entirely correct.

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

- **Caches expire on their own as well as on invalidation.** The freshness
  snapshot (`lib/freshness.ts`) keys the ETag *and* the rendered-fragment cache
  in `lib/ssr.ts`, and it used to drop only when `invalidateFreshness()` fired —
  which happens only for an ingest **in this process** that **succeeded** and
  **changed something**. Every other case left it warm forever, so a deployment
  whose ingest failed every time served byte-identical HTML with an unmoving
  ETag no matter what was in the database: a cache whose only invalidation path
  was the very thing that was broken. It also missed any other writer — the
  scheduled deployment POSTing `/api/ingest` to a different instance, a second
  instance, a manual import. The snapshot now also expires after
  `FRESHNESS_MAX_AGE_MS` (default 60s, matching the `max-age=60` already on the
  page and the embed fragment, so it adds no staleness HTTP did not already
  allow). Invalidation is still what makes a local ingest show up instantly; the
  bound is the floor under it. `tests/freshness.test.mjs` starts a server with a
  deliberately broken ingest, writes a row from outside the process, and asserts
  the page and `/embed/ssr` both pick it up.

- **`/api/status` reports the ingest; `/api/healthz` only reports the process.**
  healthz answers `ok` as soon as the server is listening, which says nothing
  about the thing that has actually broken in production twice. `/api/status`
  reports whether the feed URL reached this environment at all, when an ingest
  last ran and succeeded, the last error, and the archive's item count and newest
  content — enough to tell "upstream is quiet" from "this deployment has never
  once fetched the feed" from outside the box. It carries no secrets (never the
  feed URL or the connection string) and is `no-store`. **Check it first when
  production looks stale**: `curl https://<deployment>/api/status`.
  `feedConfigured: false` means the deployment's environment is missing
  `DYNASTY_NEWS_API_URL` — see the env note under Run & Operate, `.replit`'s
  `[userenv.shared]` configures the workspace only. `feedHost` reports which
  feed *this* instance actually got, because that is the thing the two
  environments can silently disagree about, and `lastError` carries the first
  200 characters of the upstream response body: the status alone cannot tell a
  retired URL from a blocked one (both are "403: Forbidden"), but the body can —
  `dynasty-command.replit.app` answers `{"error":"forbidden"}` — its origin lock
  refusing a request that carried no valid key — while a WAF answers an HTML
  challenge page ("Just a moment..."), and a stopped Replit deployment answers
  "This app isn't live yet". `feedHosts` is a list, `lastSource` names the route
  that actually served the feed, and `feedKeyConfigured` says whether
  `DYNASTY_NEWS_API_KEY` reached this environment at all.

- **`/api/ingest/health` is for machines; `/api/status` is for people.**
  `/api/status` always answers 200 and describes everything, which is right for
  diagnosis and useless for alerting — nothing pages on a 200. The health endpoint
  answers **503** once the ingest is failing (`INGEST_ALERT_MAX_FAILURES`
  consecutive failures) or has been quiet too long (`INGEST_ALERT_MAX_AGE_MS`),
  with `reasons` and `lastError` in the body so the alert explains itself. Before
  a process's first success the age is measured from process start, so an instance
  that has *never* ingested alerts instead of looking healthy forever — that was
  production's actual state for 17 hours. Deliberately not folded into
  `/api/healthz`: that is the platform liveness probe, and failing it would have
  Replit restart a healthy process, which fixes nothing about a feed refusing us.

- **A feed response of `200` with no items is a failure, not a quiet success.**
  `storeItems([])` returns `{inserted: 0, updated: 0}` happily, so an upstream that
  started answering with an empty list would freeze the archive while
  `/api/status` reported `lastError: null` — the same "signal says fine, data says
  otherwise" shape as the outage itself. The throw lives in `fetchFeedFrom()` so an
  empty route falls through to the next URL like any other bad one. The feed is
  never legitimately empty; it carries a rolling ~25 items.

- **The ingest identifies itself to the feed.** Node's `fetch` otherwise sends
  `user-agent: node`, which is what bot management scores as anonymous
  automation — and `api.statchasers.com` is behind Cloudflare. A named
  `User-Agent` is both good manners toward our own API and the difference
  between a WAF rule that can allow this caller and one that cannot see who it
  is. If the feed ever 403s only from the deployment while the workspace
  succeeds, suspect IP reputation or a bot rule, not the code — the two run
  identical requests from different egress addresses.

- **The ingest calls the feed's Replit address, not its public domain.**
  `api.statchasers.com` is behind Cloudflare, and Cloudflare challenged this
  deployment's egress IP with the "Just a moment..." JS interstitial — which a
  server cannot solve, so the ingest 403'd for 17 hours. (`deploymentTarget = "gce"`
  means the deployment egresses from a Google Cloud address; the workspace does
  not, which is why identical code succeeded there and failed published. If the
  feed ever 403s only from the deployment, suspect IP reputation, not the code.)
  Bot Fight Mode is zone-wide on the Free plan and cannot be skipped by a WAF rule,
  and punching a hole in the edge for one caller was rejected as worse than
  avoiding it — so `DYNASTY_NEWS_API_URL` lists `dynasty-command.replit.app`
  first (not proxied, Cloudflare never sees it) and `api.statchasers.com` last as
  the degrade-don't-go-dark fallback.

- **The feed key is scoped to `/api/news`, read-only, and is not an API
  credential.** Dynasty Command refuses anything that did not come through
  Cloudflare: its edge injects `X-Edge-Secret`, the origin compares it against
  `EDGE_SECRET` timing-safe, and a request without it is dropped *before* routing
  (hence a 403, not a 404, on paths that do not exist). The exception granted to
  this app is `X-SC-Ingest-Key` vs `SC_INGEST_KEY` — timing-safe, `GET`/`HEAD`
  only, `/api/news` prefix-exact, inert when unset. It is scoped that tightly
  *because* the key lives here, outside the system it opens, so a leak on this
  side exposes public NFL headlines and nothing more. Do not widen it, do not
  assume it reaches another path, and never ask for `EDGE_SECRET`. Sending the
  header is all this app does: see `FEED_KEY_HEADER` in `src/routes/news.ts`.

- **Do not diagnose an ingest failure from Dynasty Command's request log.** Its
  origin lock answers and drops a refused request 109 lines before its request
  logger runs, so a 403 from that gate leaves no log line. During this incident
  that log showed a tidy 10-minute cadence of `GET /api/news/nfl 200` — the
  Dynasty site's own ticker arriving via browsers — which read as this archiver
  working. `/api/status` here is the authoritative signal; Dynasty's startup
  posture line (`news archiver origin exception ... ON | INERT`) is the
  authoritative signal for whether the key reached that side.
  See `docs/ingest-cloudflare.md`.

- **The team hub reuses the news pipeline rather than duplicating it.**
  `listNewsForTeam()` in `lib/news-query.ts` is the same table, the same
  ordering and the same row→item mapping as `listNews()`; the only thing it adds
  is the filter. The filter has to run in memory because `team` is not a column
  — it is derived per row from the player behind the headshot — so the read is
  bounded to the newest `TEAM_SCAN_LIMIT` rows rather than the whole table.
  Rows with no headshot now fall back to matching the player's NAME against the
  same Sleeper index, because the archive genuinely contains imageless rows that
  would otherwise belong to no team at all. Names that appear on more than one
  roster are dropped from that index rather than resolved first-wins: an
  ambiguous name costs one unattributed story, a wrong guess costs a story on
  the wrong team's page.

- **One Sleeper download feeds both tools.** The player dictionary is ~14MB and
  `lib/teams.ts` was already pulling it to colour news cards. The team pages'
  depth chart, injuries and headshots are a second pass over that same payload
  (`lib/team/roster.ts`), not a second fetch. Its refresh dropped from 24h to
  12h when injuries moved onto it — a designation a day old is exactly the
  stale-shown-as-current problem these pages must not have — and Injury Watch
  stamps the snapshot time so it never claims to be fresher than it is.

- **Every team-page section is allowed to be absent.** Four upstreams
  (Sleeper x2, ESPN site + core) each settle independently, a failure leaves its
  field null, and the renderer drops the section AND its entry in the section
  navigation. There is no "N/A" anywhere on the page and `tests/team.test.mjs`
  asserts there never is. The corollary: **the record is withheld until the
  regular season is under way**, because ESPN's team document reports the
  PRESEASON record in August and printing it under a heading that says 2026
  would be a plain falsehood. The Team Snapshot reads the last completed season
  in that window and says so on the card.

- **Team data is stale-while-revalidate, not fetched per request.**
  `lib/team/cache.ts`: a cold key is awaited under a timeout, a warm key returns
  instantly, a stale key returns instantly and refreshes behind the response,
  and a failure keeps the last good value and backs off. Only the first visitor
  for a team ever waits — a warm team page renders in single-digit milliseconds
  — and one unreachable upstream cannot turn into a request-rate amplifier
  against it.

- **The team is an accent, never a repaint.** Three custom properties
  (`--team-primary`, `--team-secondary`, `--team-logo`) are set on the root
  element and nothing else in `team.css` knows which team it is drawing. They
  reach a hairline above the hero, a blurred aura behind the crest, a 6%
  watermark and a heavily-whitened wash behind player photos. The tint
  percentages are set by the worst case rather than the average: navy at 22%
  is a tasteful wash, Kansas City red at 22% is pink.

- **The team hub's interactive parts are HTML, not JavaScript.** The team
  switcher, "view more news" and the full-season schedule are all `<details>`,
  and the section nav is anchor links. They work with the bundle blocked, the
  switcher is 32 crawlable internal links rather than a scripted menu, and
  `src/client/team.ts` (2.5KB) only adds highlighting, dismissal, relative
  timestamps and iframe height.

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

- **Never write a bare-element reset inside `.sct` without `:where()`.**
  `.sct p { margin: 0 }` is specificity (0,1,1) — heavier than the single class
  `.sct-subtitle` that is supposed to set that paragraph's margin — so a reset
  meant as a floor beats every component rule in the file and collapses the
  whole page's spacing. It did exactly that once. The reset in `team.css` is
  written `:where(.sct) :where(p, ul, ...)` so it weighs zero.
- **ESPN 403s a User-Agent containing a URL scheme.** The conventional
  `(+https://example.com)` form — which the news ingest uses and which the team
  providers were first written with — is rejected outright on every request.
  `TEAM_USER_AGENT` in `lib/team/cache.ts` is `(+statchasers.com)` for that
  reason. Do not "fix" it back to a full URL without re-testing.
- **Conditional-request tests must not use `fetch()`.** undici attaches its own
  cache directives, which is enough to stop a 304 ever happening; both
  `seo.test.mjs` and `team.test.mjs` carry a raw `http.request` helper for this.
- The team page's sticky section nav parks at `--sct-nav-offset` (default 0). A
  WordPress theme with its own sticky header sets `.sct { --sct-nav-offset: 72px }`
  so the two do not overlap; this server cannot know what is above it.
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
