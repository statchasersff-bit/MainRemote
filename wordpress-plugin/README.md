# StatChasers WordPress plugin

Mounts the StatChasers news tool, the NFL team hubs, the player pages and the
Fantasy Points Allowed table **directly into WordPress pages** — no iframe.

## Why

The tool was previously embedded as a cross-origin `<iframe>`. Readers saw it
fine, but the WordPress page's own HTML contained a frame and nothing else: the
headlines, player names and timestamps belonged to the app's origin, not to the
`statchasers.com` URL, and they only existed after the frame loaded and ran its
own JavaScript.

This plugin instead:

1. asks the API for a **server-rendered fragment** of the current tool state,
2. prints that markup into the page body, and
3. loads the tool's **compiled JS/CSS** through `wp_enqueue_script()` /
   `wp_enqueue_style()` so the client enhances markup that's already there.

Readers and crawlers get identical content. There is no bot-only text and
nothing is hidden behind a click.

## Install

1. Copy `statchasers-news/` into `wp-content/plugins/` and activate it.
2. Point it at the news API in `wp-config.php`:

   ```php
   define( 'STATCHASERS_NEWS_ORIGIN', 'https://your-news-app.example.com' );
   ```

   Alternatively set the `statchasers_news_origin` option, or filter
   `statchasers_news_origin`.

3. Add a shortcode to a page:

   ```
   [statchasers_news]     the player news tool
   [statchasers_team]     an NFL team hub
   [statchasers_player]   an NFL player page
   [statchasers_fpa]      the Fantasy Points Allowed table
   [statchasers_rankings] the redraft rankings board
   [statchasers_schedule] the NFL schedule
   ```

## The team hubs — `[statchasers_team]`

One shortcode per team page, at `/nfl/teams/<slug>/`. It mounts the same team
hub the API serves at `/team/<slug>`: team stats with NFL ranks, season history,
the offensive depth chart, the schedule, the fantasy outlook and the team's news
archive — all server-rendered into your page's HTML.

| Attribute | Default          | Meaning |
|-----------|------------------|---------|
| `slug`    | the page's slug  | Which team to render, e.g. `philadelphia-eagles`. |

**`slug` is usually unnecessary.** It defaults to the WordPress page's own slug,
and the API's team slugs are the same strings, so all 32 pages can carry one
identical shortcode:

```
[statchasers_team]
```

Set it explicitly only where the page slug isn't the team slug:

```
[statchasers_team slug="philadelphia-eagles"]
```

### Why this shortcode is what makes team pages rank

The API serves every team page with `noindex, indexifembedded`. That is
deliberate — the bare app URL should not compete with `statchasers.com` — but it
has a consequence worth stating plainly: **until a page embeds a team hub, that
hub is invisible to search.** `indexifembedded` with no embed is just `noindex`.
This shortcode is the embed. Without it the content exists and ranks nowhere.

The fragment carries no `<h1>`, `<title>`, canonical or robots directive; the
WordPress page owns all of those, exactly as with the news tool. The hub's tab
strip is `:target`-based, so all five tabs are in the HTML on first response and
the only URL state it can produce is a `#hash` — not a separate URL.

### The H1

The plugin supplies it, through `the_title` — so it is the theme that prints the
heading and the page has exactly one. `statchasers_team_heading()` builds it
from team + section + season, mirroring `teamSectionHeading()` in the API's
`src/lib/team-render.ts`:

| URL | H1 |
|-----|-----|
| `/nfl/teams/new-england-patriots/` | New England Patriots Team Hub 2026 |
| `…/outlook/` | New England Patriots Fantasy Football Outlook 2026 |
| `…/stats/` | New England Patriots Stats 2026 |
| `…/schedule/` | New England Patriots Schedule 2026 |
| `…/depth-chart/` | New England Patriots Depth Chart 2026 |
| `…/matchups/` | New England Patriots Matchups 2026 |

Nothing is stored and no page is edited: the heading is computed per request, so
all 32 pages and all 160 addresses are covered the moment the plugin is active,
and a season rollover is the same one-line edit as the titles
(`STATCHASERS_TEAM_SEASON`). The stored `post_title` stays `<Team> Team Page`,
which is what the admin list and any nav menu want — a menu item is its own post
with its own id, and the filter only rewrites the queried page's own title.

**A per-section H1 needs the section URLs below.** A tab is a `#hash` on one
address, and a hash cannot change server-rendered HTML or give a crawler a
second URL. With the section URLs off, every team page's H1 is the hub's.

Override or disable it with `statchasers_team_page_heading`; return the fourth
argument to hand the heading back to the stored title.

If your template prints no page title at all — a Divi full-width or Theme
Builder layout with no Post Title module — there is nothing for that filter to
rewrite and the page's top heading is the fragment's hero `<h2>`. Check with:

```sh
curl -s https://statchasers.com/nfl/teams/new-england-patriots/ \
  | grep -o '<h1[^>]*>[^<]*'
```

If that prints nothing, have the shortcode print the H1 itself instead:

```php
add_filter( 'statchasers_team_shortcode_h1', '__return_true' );
```

Turn it on only in that case: with a title-printing template it gives the page
two H1s.

### Section URLs (off by default)

The hub answers five different questions at one address, and one address gets
one title tag. `/nfl/teams/<slug>/schedule/` and friends give four of them a
title, a description and a canonical of their own:

```
/nfl/teams/new-england-patriots/               the hub
/nfl/teams/new-england-patriots/outlook/       New England Patriots Fantasy Football Outlook 2026
/nfl/teams/new-england-patriots/stats/         … Stats 2026: Offense, Defense & NFL Rankings
/nfl/teams/new-england-patriots/schedule/      … Schedule 2026: Dates, Opponents & Results
/nfl/teams/new-england-patriots/depth-chart/   … Depth Chart 2026: Starters & Backups
```

Turn them on with:

```php
add_filter( 'statchasers_team_section_urls', '__return_true' );
```

Then flush permalinks once (Settings → Permalinks → Save).

**No pages are created.** A rewrite rule points the section URL at the team's
existing page and sets `sc_section`, which the shortcode reads — so the same 32
pages serve all 160 addresses, and a section is opened or closed by editing
`STATCHASERS_TEAM_SECTIONS` rather than by minting rows in `wp_posts`. Identical
in shape to `statchasers_player_section_urls`.

A section page is the hero, that section, a strip of real links to the hub and
its sibling sections, and the resources block; it does not repeat the other
four panels, or the five addresses would be one page under five URLs. Its
title, description, self-referencing canonical and `og:url` are generated from
team + section + season by `statchasers_team_section_meta()`, which mirrors
`sectionMeta()` in the API's `src/lib/team-seo.ts` — change one and change the
other. The pretty path is the only public spelling: `?section=` is what the
plugin fetches the fragment with, and the API 301s it to the pretty path.

**Discovery.** The hub's tab strip is `#hash` navigation, which a crawler
follows nowhere, and neither the hub nor a section page prints a strip of
anchors to the section pages. Their discovery rests on the sitemap below and on
the site's own navigation — so the flag and the sitemap must move together.

**Sitemap.** With the flag on, the four section URLs of every published hub
page are appended to Rank Math's page sitemap through
`rank_math/sitemap/page_content`. Off, they are not, so the sitemap can never
advertise the URLs before the rewrite serves them. That filter name is the one
piece of the Rank Math integration not confirmed against an installed build —
if the page sitemap does not list them after enabling, check it first.

**Unknown sections 404.** The rewrite matches the four ids and nothing else, so
`/nfl/teams/<slug>/anything-else/` falls to WordPress's own resolution and
404s rather than serving the hub under a second name. The API's
`/team/<slug>/<section>/` does the same, and treats `news` and any case variant
(`/Stats/`) the same way.

**`news` is deliberately not in the list.** Some teams' archives are two stories
and a standalone URL for those is a thin page. The hub still carries the tab.
Roster and Injuries are candidates later, once the data is dense enough.

The 32 hub pages keep their **stored** Rank Math fields: this plugin never
silently overwrites a field an editor may have rewritten, so only the virtual
section URLs — which have no row to store anything in — are generated. Pages
created before the current hub wording (`<team> <season>: Record, Schedule,
Stats & Fantasy Football`) keep the old one until you move them: **Tools →
StatChasers Team Pages → Hub titles** shows a dry run first (`N eligible · N
custom titles left alone`) and the button updates only pages whose stored title
is empty or is exactly the old generated template, in any season. Anything else
was typed by a person and is kept, and is listed by slug so you can see which.
Descriptions are not migrated: the generated wording did not change.

### Matchup pages (off by default)

One evergreen page for every pair of teams — 32 × 31 / 2 = 496 — at:

```
/nfl/new-england-patriots-vs-philadelphia-eagles/
```

Not two. The pair is put in one order — the two slugs alphabetically — by
`canonicalizeMatchupPair()` on the API (`src/lib/matchup/pair.ts`), and every
URL in the app is built from that. Which team's hub the reader came from cannot
reach the address. `/nfl/philadelphia-eagles-vs-new-england-patriots/`,
`/nfl/phi-vs-ne/` and `/nfl/eagles-vs-patriots/` are all 301s to the one above;
a fake team, a team against itself, or anything else under `/nfl/` that is not
two different real teams is a true 404, never a hub.

**No pages are created for pairs.** A rewrite rule sends every pair URL to one
holder page, `/nfl/matchup/`, which carries `[statchasers_matchup]` and is
noindex at its own address. The shortcode reads `sc_matchup`, fetches
`/embed/matchup/<a>-vs-<b>` and prints it; the plugin mirrors just enough of the
pair rule to 301 the reversed spelling before fetching. Create the holder from
**Tools → StatChasers Team Pages → Matchup pages**, then:

```php
add_filter( 'statchasers_matchup_urls', '__return_true' );
```

and flush permalinks once. The 496 pair URLs join Rank Math's page sitemap
under the same flag.

**The pair's page follows its state.** The API decides once, in
`matchup-data.ts`, whether the two have an upcoming meeting, one just played
(within two weeks), or neither, and the fragment returns that in an
`X-Matchup-State` header. The page leads with the next game, the score, or the
head-to-head accordingly, and the title says so — `… 2026: Where to Watch,
Stats, Injuries & History` / `… 2026: Score, Player Stats & Fantasy Recap` /
`…: Head-to-Head Record, Stats & History`. `statchasers_matchup_meta()` mirrors
`matchupPageMeta()` in `src/lib/matchup/matchup-seo.ts`; change one and change
the other.

### One address per meeting

Two weeks after kickoff the pair's page lets a game go: the recap layout gives
way to the evergreen head-to-head, and the game moves to an address of its own.

```
/nfl/new-england-patriots-vs-seattle-seahawks/              the pair
/nfl/new-england-patriots-vs-seattle-seahawks/2026-week-1/  one meeting
```

The dated page is always a recap — hero score line, quarter-by-quarter scoring,
leaders, every player-stat table, the takeaways and the snap counts — headed
`New England Patriots vs Seattle Seahawks, Week 1 2026` so it cannot compete
with the pair's own page for the pair's own query. It is its own canonical.

**It exists only once the pair has let go.** Inside the two-week window the
dated URL 301s up to the pair, on this origin and in the plugin both, so the
recap has exactly one address at any moment and the two are never near
duplicates of each other. The API answers which case a request is in through
`X-Matchup-Game: current | archived`, and the plugin mirrors the redirect rather
than trying to work out the window for itself. A week the two did not play, or
one that never finished, is a 404 — and so is a near-miss spelling like
`2026-week-01`, which no page links to and nothing generates.

**Discovery is the meetings list.** Every archived meeting on the pair's page
carries a real `Recap →` link to its own address; the game the page is still
leading with does not, because that link would point into a redirect. Those
links are the only route to a dated URL, so they are in the server's markup, not
added by the bundle. The dated URLs are **not** in the sitemap: the plugin has
no schedule of its own and will not advertise an address it cannot confirm
exists.

`statchasers_matchup_game_meta()` mirrors the `data.pinned` branch of
`matchupPageMeta()`; change one and change the other. The rewrite rule rides the
same `statchasers_matchup_urls` filter as the pair URLs, so enabling one enables
both — flush permalinks once after.

A finished game also returns `X-Matchup-Score` — the result in one clause,
`Seahawks won 13-10.`, written by `matchupScoreLine()`. The postgame
description leads with it, so the snippet carries the number the search asked
for. An empty header simply drops the clause.

**Nothing is invented.** Where to Watch appears only for an upcoming game and
carries only what ESPN's schedule has — date, kickoff, TV network, venue. There
is no streaming line, because there is no streaming data. Head-to-head is the
regular-season meetings in the current and five prior seasons. A section with
no data is absent, not padded.

**Each team hub gains a Matchups section** at `/nfl/teams/<slug>/matchups/` —
its next opponent up top and every scheduled game as a row with the result and
a link to the pair's page. A divisional opponent is two rows and one page.

The hub no longer carries it as a tab. It duplicated the Schedule tab, whose
rows and upcoming cards each now carry their own "View matchup" link into the
same pair pages. The rewrite, the sitemap entry and the page itself are
unchanged — only the tab is gone.

### Server-side configuration

Set `SC_TEAM_PATH_PREFIX` on the **API deployment** to the public path of these
pages:

```
SC_TEAM_PATH_PREFIX=/nfl/teams/
```

The hub's team switcher links all 32 teams. Left unset it points them at the
API's own `/team/<slug>`, so a reader clicking a team inside your page leaves
the site for the bare tool. Setting it also drops the `?embed=1` the switcher
appends for the local mount — which matters, because `embed` is a reserved
WordPress query var and `/nfl/teams/dallas-cowboys/?embed=1` serves WordPress's
oEmbed template instead of the page. (`SC_TEAM_LINK_QUERY` overrides that query
if a mount needs something else.)

### Creating the 32 pages, and the Divi template

Two companion files live beside this plugin. Neither is required — the
shortcode works without them — but together they are what turns `[statchasers_team]`
into 32 finished pages rather than 32 pages you build by hand.

- **`scripts/create-team-pages.sh`** — a WP-CLI script that creates
  `/nfl/teams/<slug>/` for all 32 teams with the shortcode as post content, the
  Rank Math title/description/robots, and the team crest as the featured image.
  Idempotent: it never overwrites content, and fills Rank Math fields only where
  they are empty. `--dry-run` first, `--force` to refresh meta after a season
  rollover.
- **`divi/statchasers-divi-teams.php`** — an mu-plugin exposing each page's team
  to a single Divi Theme Builder template: `sc-team-<slug>` body classes,
  `--sc-team-primary`/`--sc-team-accent`/`--sc-team-logo` custom properties, a
  `[sc_team field=…]` shortcode, and the measured `--sct-nav-offset` that keeps
  the hub's sticky section bar out from under a Divi fixed header.

Two things that bite on a Divi site specifically:

1. **A Theme Builder body template must contain a Post Content module.** Without
   it the page renders your template and nothing else — the shortcode never runs,
   and every one of these pages ships empty. It is the exact failure the
   `indexifembedded` posture cannot survive.
2. **Divi swaps the global post while it renders a Theme Builder layout**, so
   `[statchasers_team]` placed *inside the template* defaults its slug from the
   layout, not the page. Keep the hub in page content (what the script writes), or
   use `[sc_team_hub]` from the mu-plugin, which reads `get_queried_object()` and
   is correct either way.

## The player pages — `[statchasers_player]`

One shortcode per player page, at `/nfl/players/<slug>/`. It mounts the same
profile the API serves at `/player/<slug>`: the season summary, the weekly
finish distribution and trend, the full game log, career totals, advanced
metrics with league percentiles, a generated bio, injury history, and a News &
Analysis tab carrying the player's current injury designation, their own news
and their team's — all server-rendered into your page's HTML.

| Attribute | Default          | Meaning |
|-----------|------------------|---------|
| `slug`    | the page's slug  | Which player to render, e.g. `kyler-murray`. |
| `format`  | `ppr`            | Scoring format: `standard`, `half` or `ppr`. |

**`slug` is usually unnecessary.** It defaults to the WordPress page's own slug,
and the API's player slugs are the same strings, so every page can carry one
identical shortcode:

```
[statchasers_player]
```

Set it explicitly only where the page slug isn't the player slug:

```
[statchasers_player slug="kyler-murray"]
```

`format` changes every number in the profile — points per game, the weekly
finishes, the tier rates, the volatility. Set it once per site if your league
isn't PPR:

```
[statchasers_player format="half"]
```

#### Two things the reader sets, not you

The scoring toggle and the Game Log's season selector are rendered by the API as
real links, and the shortcode reads what they set back out of the URL:

| Parameter | Meaning |
|-----------|---------|
| `?format=` | `standard`, `half` or `ppr`. Overridden by a `format` attribute. |
| `?log=`    | The season the **Game Log** tab shows, e.g. `?log=2024`. |

Both are cached separately, and both carry `rel="nofollow"` on every link that
is not the current one — one game log per player is the page that ranks, and a
pinned season is a rendering of it rather than a second address competing with
it. Nothing else on the page moves when `?log=` is set: the injury history, the
outlook and the advanced metrics all stay on the player's active season, because
the reader re-scoped a tab and not the profile.

### Why this shortcode is what makes player pages rank

Exactly the team hubs' story. The API serves every player route with
`noindex, indexifembedded`, so **until a page embeds a profile, that profile is
invisible to search** — `indexifembedded` with no embed is just `noindex`. This
shortcode is the embed.

The fragment carries no `<h1>`, `<title>`, canonical or robots directive; the
WordPress page owns all of those. The tab strip is `:target`-based, so all six
tabs are in the HTML on first response and the only URL state it can produce is
a `#hash` — not a separate URL.

### Server-side configuration

Set `SC_PLAYER_PATH_PREFIX` on the **API deployment** to the public path of
these pages:

```
SC_PLAYER_PATH_PREFIX=/nfl/players/
```

Left unset, links inside the profile point at the API's own `/player/<slug>`,
so a reader clicking through from inside your page leaves the site for the bare
tool. Setting it also drops the `?embed=1` those links carry for the local
mount — which matters for the same reason it does on the team hubs: `embed` is a
reserved WordPress query var, and `/nfl/players/kyler-murray/?embed=1` serves
WordPress's oEmbed template instead of the page. (`SC_PLAYER_LINK_QUERY`
overrides that query if a mount needs something else.)

Set `SC_TEAM_PATH_PREFIX` too if you have the team hubs: the profile's hero
links to the player's team, and it uses the same prefix the hubs do.

### Creating the pages

**`scripts/create-player-pages.sh`** is the companion to
`create-team-pages.sh` — a WP-CLI script that creates `/nfl/players/<slug>/` for
every indexed player with the shortcode as post content and the Rank Math
title/description/robots. Idempotent: it never overwrites content, and fills
Rank Math fields only where they are empty.

```bash
ORIGIN=https://your-api.example.com bash scripts/create-player-pages.sh --dry-run
ORIGIN=https://your-api.example.com LIMIT=5 bash scripts/create-player-pages.sh
ORIGIN=https://your-api.example.com bash scripts/create-player-pages.sh
```

Three differences from the team script, all of them consequences of there being
about six hundred of these rather than 32:

- **The player list comes from the API**, at `/embed/players.json`, not from a
  table inside the script. The roster moves every offseason and a pasted copy
  would be wrong by the time anyone ran it. `ORIGIN` is therefore required.
- **It creates pages for the *indexed* players only** — the fantasy-relevant
  ones. The dictionary holds every player in the league and most have no game
  log, no advanced row and no bio; a page each would be several thousand thin
  pages, which is the opposite of what these are for.
- **No featured image by default.** Six hundred headshot sideloads is a large
  media library and a long run for an image the profile renders itself.
  `--with-images` turns it on for a template that needs one.

`LIMIT=5` on the first run against a live site is worth the thirty seconds: it
creates five pages you can check before committing to the rest.

The Divi notes on the team hubs apply here unchanged — a Theme Builder body
template **must** contain a Post Content module or every one of these pages
ships empty, and the plugin takes Divi's full-width column for the same reason
it does on a hub.

## Fantasy Points Allowed — `[statchasers_fpa]`

One page, at `/nfl/fantasy-points-allowed/`. It mounts the table the API serves
at `/fpa`: how many fantasy points each of the 32 defences gives up per game to
QBs, RBs, WRs and TEs, with ranks, three scoring formats, raw and
schedule-adjusted views, and a CSV export.

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `format`  | `half`  | Scoring: `standard`, `half` or `ppr`. |
| `view`    | `raw`   | `raw` (as measured) or `adjusted` (corrected for strength of schedule). |
| `season`  | current | Pin a season. Leave it off — see below. |

```
[statchasers_fpa]
[statchasers_fpa format="ppr" view="adjusted"]
```

**Leave `season` off.** The API serves whatever it is configured to treat as
current, so an unpinned page rolls over by itself; a hard-coded season is a page
that quietly shows last year's table next September.

### Migrating from "StatChasers Data Tools"

The FPA tool shipped with its own plugin, which worked the other way round:
WordPress cached the JSON, exposed it at `/wp-json/statchasers/v1/fpa`, and a
browser bundle drew the table from it. That is fine for a reader and no good for
search — the page's own HTML was an empty container, which is the problem this
whole plugin exists to solve.

The shortcode tag is **deliberately the same**, so:

1. Update this plugin.
2. **Deactivate StatChasers Data Tools.** Both plugins registering
   `statchasers_fpa` is a collision, and WordPress keeps whichever registered
   last — so leaving both active makes which table you get depend on plugin
   load order.
3. The page itself needs no edit.

The old plugin's admin refresh button and its `FPA_ADMIN_SECRET` endpoint have
no counterpart here, by design: the data is rebuilt by a scheduled ingest on the
API side (`pnpm --filter @workspace/api-server run ingest-fpa`), not by a button
in wp-admin. One less secret to share between two systems.

### Running the ingest

The table is built from nflverse's weekly player stats. Nothing renders until
the ingest has run at least once:

```bash
pnpm --filter @workspace/api-server run ingest-fpa
```

Schedule it weekly in season. It is idempotent — running it twice leaves exactly
what running it once does — and it replaces the stored figures in one
transaction, so a reader never sees half of one ingest and half of the last.

If the table is empty the API answers `/embed/fpa` with a 404 and the shortcode
prints **nothing**, leaving the rest of your page intact. An administrator
viewing the page sees a note saying what to run; a reader sees no hole.

### Server-side configuration

```
SC_FPA_PATH=/nfl/fantasy-points-allowed/
```

The table's own format and view controls are ordinary links. Left unset they
point at the API's own `/fpa`, so a reader changing scoring format inside your
page would leave the site for the bare tool.

`SC_TEAM_PATH_PREFIX` matters here too: every row's defence name links to that
team's hub.

### What the colours mean

The cells are tinted on a **diverging** scale — rank 1 is the softest defence,
rank 32 the toughest, league average in the middle — so it takes two hues either
side of a neutral rather than one ramp. Blue is the exploitable pole, red the
one to avoid. Every tinted cell also prints its rank, so the tint is a second
reading rather than the only one, and the legend names each band in words.

## News shortcode attributes

| Attribute      | Default | Meaning |
|----------------|---------|---------|
| `limit`        | `250`   | Maximum items to render (1–250). |
| `page_size`    | `4`     | Cards per page once JS paginates (1–50). |
| `heading`      | `1`     | `0` omits the tool's `<h2>` if the page already has one above it. |
| `heading_text` | —       | Overrides the `<h2>` wording so it agrees with the page's H1/title. |
| `player_url`   | —       | URL template making player names internal links, e.g. `/nfl/players/{slug}`. |
| `team_url`     | —       | URL template making team names internal links, e.g. `/nfl/teams/{slug}`. |
| `related`      | —       | `Label\|/url` pairs separated by `;` — crawlable links to other tools. |

Example:

```
[statchasers_news
  page_size="6"
  heading_text="2026 Fantasy Football Player News"
  player_url="/nfl/players/{slug}"
  team_url="/nfl/teams/{slug}"
  related="Fantasy Football Strength of Schedule|/nfl/fantasy-football-strength-of-schedule/"]
```

## Internal links

`player_url` and `team_url` turn names the tool **already displays** into real
links — this improves existing UI rather than adding SEO filler. `{slug}` is the
kebab-cased name (`devonta-smith`, `philadelphia-eagles`); `{team}` is the
lowercase abbreviation (`phi`). The anchor text is the entity's own name, which
is the descriptive, crawlable text a link should carry.

> **Both are empty by default, on purpose.** The plugin cannot verify that your
> player and team pages exist. Set these only for URL patterns that really
> resolve — otherwise you generate a few hundred internal links to 404s, which
> is worse than plain text. A player with no current team simply gets no team
> link rather than an invented one.

`related` renders a small "More fantasy football tools" block of ordinary
`<a href>` links below the list, so important pages like the Strength of
Schedule tool get real crawlable links with descriptive anchor text from a
relevant page — not JS-only navigation.

## Rank Math stays the SEO authority

The plugin does not compete with your SEO plugin. It emits **no** canonical, no
`<title>`, no meta description, no `og:*`, no robots directive and no
breadcrumbs — Rank Math already produces all of those, and a second set would be
a conflicting signal rather than a stronger one.

The one thing Rank Math cannot know about is the interactive tool embedded in
the page. So the plugin adds a single `SoftwareApplication` / `WebApplication`
node **into Rank Math's own graph** via the `rank_math/json_ld` filter. The page
ends up with one `<script type="application/ld+json">`, not two competing ones.
The node attaches to whichever page-level node Rank Math produced (`WebPage`,
`CollectionPage`, `ItemPage`, …) through `isPartOf`, and its description
defaults to Rank Math's own description for the page so the two can't disagree.

If Rank Math is not installed, the plugin prints that single node by itself. It
still does not invent `WebPage`, `BreadcrumbList` or `Organization` nodes — if
your site has no SEO plugin, that is a site-wide decision to make deliberately.

Using a different SEO plugin? Hook its graph filter (Yoast's is
`wpseo_schema_graph`) with the node from `statchasers_news_schema_node()`, and
return `true` from the `statchasers_news_graph_provider_present` filter so the
standalone fallback stays off.

### What the schema says — and what it deliberately doesn't

```jsonc
{
  "@type": ["SoftwareApplication", "WebApplication"],
  "applicationCategory": "SportsApplication",
  "operatingSystem": "Any",
  "browserRequirements": "...",
  "isAccessibleForFree": true,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "isPartOf": { "@id": "…#webpage" }
}
```

There is **no `aggregateRating` and no `review`**. Google's SoftwareApplication
rich result requires genuine rating data alongside the offer, and there is none
for this tool. Fabricating it would be a policy violation, so the node ships
without: it is accurate structured data describing the page, and it will qualify
for that rich result only once real review data exists to put in it.

Equally deliberately absent: `Article`, `NewsArticle`, `ItemList`, `Dataset`,
`FAQPage`, `Product`. Several would be easy to generate from the news items, but
they would not accurately describe the page, and irrelevant markup is a
liability rather than a ranking benefit.

Customise the node with the `statchasers_news_schema_node` filter.

## Headings, title and canonical

The plugin deliberately stays out of the page's head. It **never** emits an
`<h1>`, a `rel="canonical"`, a `<title>`, an `og:title` or a meta description —
WordPress (or your SEO plugin) already outputs those in the initial HTML, and a
second set would be a conflicting signal.

What the tool contributes is one `<h2>` and one `<h3>` per headline.

Google may derive the result title it displays from the `<title>`, the visible
H1, `og:title`, anchors, or prominent page text, so keep those in agreement.
The pattern that works:

- **SEO title:** `2026 Fantasy Football Player News & Injury Updates`
- **H1:** `2026 Fantasy Football Player News`
- **og:title:** same as the SEO title
- **Tool H2:** `heading_text="2026 Fantasy Football Player News"`

Set the title, H1 and og:title in WordPress; use `heading_text` to line the tool
up with them. Keep the meta description page-specific — Google usually builds
the snippet from page content, but a good unique description is used when it
fits the query better.

## Filter state and duplicate URLs

The tool never writes to the URL. Pagination shows and hides list items that are
already in the DOM: there is no `history.pushState`, no `?page=`, and no
`?filter=`. Every control is a `<button>`, never an `<a href="?...">`.

That is deliberate. Crawlable filter/sort links multiply into large duplicate
URL spaces, and Google calls sorting and filtering parameters a common source of
duplicate pages. Because the tool produces no such URLs, the page's canonical
stays the single indexable version of it with no parameter-handling rules or
extra `noindex` needed.

If you later add controls that *should* be indexed as their own landing pages,
make them real links to real server-rendered URLs with their own canonicals —
don't let tool state leak into the existing page's URL.

## Redraft rankings — `[statchasers_rankings]`

One page, at `/fantasy-football/redraft-rankings/`. It mounts the board the API
serves at `/rankings`: tiered quarterback, running back, wide receiver and tight
end rankings, plus an all-positions view that aligns the four by positional
rank, and a CSV export.

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `pos`     | `all`   | Which panel opens first: `all`, `qb`, `rb`, `wr` or `te`. |
| `season`  | newest  | Pin a season. Leave it off — see below. |

```
[statchasers_rankings]
[statchasers_rankings pos="rb"]
```

**Leave `season` off.** The API serves the newest board it has, so an unpinned
page rolls over by itself when next year's file lands; a hard-coded season is a
page that quietly shows last year's rankings next August.

There is no `scoring` attribute. The rankings are published in PPR only, and the
board says so rather than offering two controls that do nothing.

### Migrating from the standalone rankings app

The rankings shipped as their own Vite app in a separate repository
(`statchasersff-bit/Redraft-Rankings-table`), mounted here through a
prerender-and-hydrate arrangement: a build step rendered the board to HTML,
WordPress served that, and a React bundle hydrated it. Better than an iframe,
and it had two problems this shortcode does not.

- **The board was only as fresh as the last build.** Updating a ranking meant
  re-running the prerender and redeploying that app. Here the rankings are a CSV
  the API reads per request, cached on its modification time — publishing a new
  one is a commit.
- **Four of the five boards were not really on the page.** Only the active
  position panel and the first fifty rows of the all-positions view were in the
  markup; the rest lived in React state, which is to say a crawler never saw
  them. The server now renders all five panels and every row.

To migrate: put `[statchasers_rankings]` on the page, remove the old app's mount
(its container div, block, or whatever its bundle looked for), and stop
deploying that app. Nothing collides — the tag is new, because the old mount was
not a WordPress shortcode.

### Publishing rankings

The board is built from `data/rankings/redraft-<season>.csv` in the API
repository — three columns, `Position,Final Rank,Player`:

```csv
Position,Final Rank,Player
QB,1,Josh Allen
RB,1,Bijan Robinson
```

Ranks are **positional**: QB1 and RB1 are both rank 1. The tiers are not in the
file — they are drawn from the rank by the tier rules in
`src/lib/rankings/rankings-data.ts`, which is where a tier boundary is moved.

Beside it, an optional `redraft-<season>.meta.json` supplies the "updated" line:

```json
{
  "season": 2026,
  "scoring": "PPR",
  "updatedAt": "August 31, 2026 9:33am ET",
  "updatedAtIso": "2026-08-31T09:33:00-04:00"
}
```

Without it the board still renders and simply does not claim a date.

Each board is capped — 40 QBs, 50 RBs, 100 WRs, 40 TEs — so the working file can
run as deep as you like without the page doing the same. If no rankings file
exists the API answers `/embed/rankings` with a 404 and the shortcode prints
**nothing**, leaving the rest of your page intact. An administrator viewing the
page sees a note saying what is missing; a reader sees no hole.

### Server-side configuration

```
SC_RANKINGS_PATH=/fantasy-football/redraft-rankings/
```

The board's CSV link is an ordinary link. Left unset it points at the API's own
`/rankings`, so a reader downloading from inside your page would leave the site
for the bare tool.

`SC_PLAYER_PATH_PREFIX` matters here too: every player's name links to his
player page. A player the API's dictionary cannot place — a free agent, usually
— keeps his row and his rank and is rendered as plain text rather than as a link
to a page that does not exist.

### What the colours mean

The all-positions board tints each cell by tier. That scale is **nominal**, not
ordered: tier 3 is not "more" than tier 2, it is a different group, so it is
seven distinct hues held at one lightness rather than a ramp. Every tint sits at
about 95% lightness, which keeps the player's name at full contrast against it —
the colour is doing grouping work only.

Colour is never the only encoding. Every tinted cell's row prints its rank, and
the per-position tables print the tier in a column of its own, so nothing is
lost to a colour-blind reader or to a monochrome print.

## NFL schedule — `[statchasers_schedule]`

One page, at `/nfl/nfl-schedule/`. It mounts the board the API serves at
`/schedule`: the full regular season by week, a team lens showing one team's
seventeen games and its bye, a 32-by-18 season grid, and CSV and calendar
exports.

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `view`    | `week`  | `week`, `team` or `matrix`. |
| `week`    | current | Pin a week, 1–18. Leave it off — see below. |
| `team`    | none    | With `view="team"`, whose season to show. `NE`, `patriots` and `new-england-patriots` all resolve. |
| `filter`  | `all`   | `all`, `division` or `international`. |
| `season`  | current | Pin a season. Leave it off. |

```
[statchasers_schedule]
[statchasers_schedule view="matrix"]
[statchasers_schedule view="team" team="NE"]
[statchasers_schedule week="12" filter="division"]
```

**Leave `week` off.** Unpinned, the board opens on the week the season is
actually on — it reads the slate to decide, so it rolls forward by itself. A
pinned week is a page that still says Week 1 in December.

### What the reader sees that the server cannot render

Two things, and both degrade cleanly with scripting off:

- **Kickoffs in their own time zone.** The server labels every kickoff ET,
  because that is the only honest thing it can do — it does not know where the
  reader is. The bundle relabels them, and leaves them alone for a reader who is
  already in Eastern.
- **A team picker that submits itself.** With no JavaScript it is an ordinary
  `<select>` and a Show button, and it works.

Nothing else is client-side. Every matchup, date, kickoff, TV mark, bye,
division game and posted line is in the HTML the server sent.

### Live scores and how long a page is cached

This is the only tool here whose data can change while somebody is reading it,
so it is the only one that does not pick a cache TTL and live with it. The
plugin reads `max-age` off the API's own response: **30 seconds** while a game
is being played, **5 minutes** otherwise. The API is the side that knows which
of those is true.

The scores and TV networks come from ESPN's public scoreboard, which is
best-effort by contract. A game whose broadcast cannot be learned renders as TBD
and a scoreboard that refuses entirely leaves the slate intact — the schedule
itself comes from nflverse and does not depend on it.

### Server-side configuration

```
SC_SCHEDULE_PATH=/nfl/nfl-schedule/
SC_SCHEDULE_SEASON=2026
SC_SCHEDULE_ESPN=0
```

`SC_SCHEDULE_PATH` is the WordPress page's own path, so the board's week and
team controls link back into your page rather than out to the bare tool. The
CSV and calendar links are the exception and are always given the API's origin
explicitly — WordPress has never heard of `/download.csv` under your page.

`SC_SCHEDULE_SEASON` pins the season. Worth setting only in the weeks either
side of a new league year, when nflverse has published next season's slate and
the site still wants to show the one being played.

`SC_SCHEDULE_ESPN=0` switches the live layer off. Set it on a host ESPN refuses:
the board still renders, TV shows as TBD, and scores come from nflverse — hours
behind, but never wrong.

`SC_TEAM_PATH_PREFIX` matters here too: every team name on the board links to
its hub.

### If the feed is down

The API answers `/embed/schedule` with a 503 rather than an empty shell,
precisely so the plugin can tell "down right now" from "nothing to show". The
last good board is kept for 7 days and served instead — a schedule a few hours
stale is still almost entirely correct, which is not true of the other tools and
is why this one falls back further.

## Caching

- Rendered fragments are cached in a transient for 5 minutes — news, team hubs
  and player pages alike, each cached under its own key (a player's key includes
  the scoring format, so three formats are three entries rather than one that
  flip-flops). The FPA table gets **15 minutes**: it is rebuilt by a weekly
  ingest, so a five-minute TTL would mean a hundred and twenty round trips a day
  to learn nothing had changed.
  The rankings board gets **an hour**, the longest fixed TTL here, for the same
  reason taken further: a rankings file moves when somebody publishes one, which
  is a handful of times a season. `statchasers_news_flush()` clears it, which is
  the path an editor who has just published takes.
  The schedule takes its TTL from the API's own `Cache-Control` — 30 seconds
  while a game is live, 5 minutes otherwise, clamped to that range at both ends.
  It is the one tool whose data changes while somebody is reading it, and a
  fixed number would be wrong all season or wrong every Sunday.
- The last successful render is kept for 24 hours and served if the API is slow
  or unreachable, so a hiccup shows stale news rather than an empty box. A team
  hub with no cached copy yet renders nothing rather than an empty shell: unlike
  the news tool there is no client-side render to fall back to, and the rest of
  the page — H1, copy, internal links — is left intact.
- The team endpoint gets an 8-second timeout rather than the news tool's 5. A
  hub assembles season stats, a depth chart, a schedule and the news archive, so
  a cold render is legitimately slower than a list of headlines. The player
  endpoint gets 6: it waits on nobody — every number in a profile is arithmetic
  over JSON the API already holds — so a slow answer there means the deployment
  is in trouble, not that an upstream is.
- Asset versions come from `/embed/assets.json` (cached 15 minutes) and are used
  as the enqueue `ver`, so a deploy busts browser caches automatically.

After a deploy you can force a refresh:

```bash
wp eval 'statchasers_news_flush();'
```

## Performance-plugin notes

Because there is no iframe and no `postMessage` resize handshake, the old
workarounds are gone: nothing breaks if WP Rocket / Perfmatters / LiteSpeed
delay JavaScript. The tool's content is in the HTML, so a delayed bundle only
delays pagination and relative timestamps — never the news itself.

Do **not** exclude the stylesheet from optimisation and then also defer it; the
markup ships styled-by-stylesheet and will flash unstyled if the CSS is pushed
to the footer.

## Still using the iframe?

The legacy snippet keeps working, and the framed app is now served with
`noindex, indexifembedded` so the bare tool URL won't rank on its own while
Google may still use its content for the embedding page. That's a Google-only
mitigation and it still leaves the parent page's HTML empty — prefer this
plugin, or fetch `/embed/ssr.html` and print it yourself. See `/embed` on the
API server for all three options.
