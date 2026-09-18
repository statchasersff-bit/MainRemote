# StatChasers WordPress plugin

Mounts the StatChasers news tool, the NFL team hubs and the player pages
**directly into WordPress pages** — no iframe.

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

## Caching

- Rendered fragments are cached in a transient for 5 minutes — news, team hubs
  and player pages alike, each cached under its own key (a player's key includes
  the scoring format, so three formats are three entries rather than one that
  flip-flops).
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
