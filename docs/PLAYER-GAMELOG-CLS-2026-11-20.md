# Player Game Log: layout shift on phones (and desktop)

Branch `player-mobile-gamelog-cls-2026-11-20`, from production `2e7df5e`
(= `761124e`, the desktop header fix `989c7bd` rebased on the reference-pages
release; published 2026-11-20 17:20 UTC and verified live by its
`scp-host-header` marker). WordPress plugin 1.10.60. Not deployed.

## Root cause (measured on the live page, Gibbs Game Log)

| Width | CLS live (throttled phone) | with the player script blocked |
|---|---|---|
| 360 / 390 / 430 | 0.311 / 0.311 / 0.308 | 0.003 at 390 |
| 768 / 820 | 0.001 / 0.000 | |

One shift, at the moment the player script runs (`boot` -> `wireProfile`),
made of two things:

1. **The week details fold after paint.** The server sent every week's
   detail row OPEN (so a page without script was complete), and
   `wireExpandableLog` then set `data-scp-expand="js"`, which hides them. On
   Gibbs at 390 px that took the table body from 3,124 px to 378 px under the
   reader. In the same pass `wireSortableLog` and `wireExpandableLog` built the
   header sort buttons and the week toggles, which widened header cells (the
   columns slid 30 px). This happens at every width. At 768/820 the table
   starts mostly below the first screen, so Chrome did not count it there;
   at 1280/1440 it did (0.19-0.36 in the replay).
2. **The hero dropped 8 px on phones.** In the <=560px block of player.css,
   `.scp.scp.is-embed > .scp-search[hidden] + .scp-phead { margin-top: 0 }`
   zeroed the hero's 8 px top margin while the search box was still `hidden`.
   Since 761124e the hidden box keeps its place (HOST_HEADER_STYLE), so when
   the script revealed it, the rule stopped matching and the whole page moved
   8 px.

Not the cause: delayed CSS, fonts, images, tab navigation, column-width
calculation (the script measures nothing), or a responsive table rewrite.

## The fix (no redesign, no second table, no placeholders, no delay)

- `src/lib/player/gamelog-premium.ts`: the table ships in its final shape.
  - The header cells carry their `button.scp-sort` and `aria-sort`, and every
    week with a detail carries its `button.scp-expand` (same markup and
    accessible names the script used to build).
  - The table carries `data-scp-sort="js" data-scp-expand="js"`, so the
    details arrive folded.
  - Every detail row is still in the HTML. Without script, player.css shows
    them all and hides the toggle arrow under `@media (scripting: none)`.
    That is a media query, not a `<noscript><style>`: the season swap parses
    the next page with DOMParser, where noscript content is live. The first
    version used noscript and would have opened every detail after a season
    change; the functional check caught it.
- `src/client/player.ts`: `wireSortableLog` and `wireExpandableLog` reuse the
  buttons that are there and only attach the clicks. A table that arrives
  without them (the Stats career table) still gets them built, as before.
- `public/player.css`: the hidden-search selector is removed from the phone
  margin rule, so the hero has its 8 px from the start.
- `tests/player.test.mjs`: two new tests.
  1. The log ships folded with its buttons, ids, aria attributes and noscript
     fallback in player.css (no noscript in the fragment), and the week cells
     still read as the week number.
  2. The table's markup is identical before and after the real bundle runs
     (so nothing can move), a week opens and closes, a header sorts, and no
     button is built twice.

## Results (replayed live WordPress pages; only the player fragment and its CSS/JS differ)

CLS, production code -> fix, "narrow" mode (Chrome counts every shift):

| Game Log | 360 | 390 | 430 | 768 | 820 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|
| Gibbs (RB) | 0.325->0.004 | 0.310->0.007 | 0.316->0.009 | 0.002->0.004 | 0.015->0.003 | 0.273->0.001 | 0.193->0.002 |
| Allen (QB) | 0.279->0.002 | 0.281->0.003 | 0.286->0.009 | 0.004->0.002 | 0.011->0.012 | 0.360->0.006 | 0.199->0.017 |
| Chase (WR) | 0.284->0.001 | 0.281->0.005 | 0.290->0.011 | 0.003->0.003 | 0.010->0.003 | 0.243->0.003 | 0.295->0.125* |
| McBride (TE) | 0.021->0.002 | 0.290->0.004 | 0.290->0.013 | 0.003->0.003 | 0.003->0.004 | 0.245->0.014 | 0.191->0.001 |
| Aubrey (K) | 0.225->0.003 | 0.218->0.001 | 0.223->0.007 | 0.011->0.001 | 0.012->0.001 | 0.248->0.002 | 0.193->0.001 |

\* Chase at 1440: the remaining shift is Divi's desktop site header
(`.sc-desktop-header` row 58 -> 0, `#et-main-area` 253 -> 76), present in
production too and intermittent (re-runs: 0.123, 0.125, 0.014). It is not
the Game Log, whose own shift (0.17) is gone in every run. The 981-1280+
navigation work in the player-page session owns it.

Throttled phone (slow 4G, 4x CPU) at 390: Gibbs 0.307 -> 0.002, Allen
0.277 -> 0.000.

Every Gibbs tab at 390 / 820 / 1280 / 1440:
- Overview, Stats, Injury, News and Bio: 0.000-0.016 before and after (the
  hero 8 px fix also takes Overview at 390 from 0.044 to 0.008).
- Outlook: unchanged at 0.095 at 1280 and about 0.03-0.04 at 390, before and
  after. **That is pre-existing and not part of this change; worth its own
  look.**

Final page heights are identical on every tab and width, so nothing was
hidden to win the score. The Overview and News differences were the two
local servers' news caches: confirmed identical with fresh servers.

## SEO and content (35 pages: 5 players x 7 tabs)

- Title, meta description, canonical, robots, H1 and JSON-LD: identical on
  35 of 35.
- Embed fragments: byte-identical on 35 of 35 once the four intended changes
  are reversed (sort buttons, week toggles, the two table attributes, the
  noscript block). No player data, scoring, injury or other content changes.

## Performance

- Game Log HTML: +2.6-2.7 KB raw, about +270-300 bytes gzipped (about 1%),
  for buttons the script used to build.
- Player script: +118 bytes, and it does less at startup (no DOM building or
  table rewrite).
- Player CSS: -49 bytes.

## Tests (production 2e7df5e vs this branch, by test name)

19 player-related files (player*, gamelog-sections, asset-version,
edge-prefetch, hygiene, table-armour, team): identical pass counts and the
same failing tests, by name. The failures are the long-standing data-drift
ones, also on production. player.test.mjs: 143 -> 145 passing (the 2 new
tests), same 3 failures.

## Accessibility and no-JS

- Same buttons, labels (`aria-label="Week N detail"`, `aria-controls`,
  `aria-expanded`), `aria-sort` and keyboard behavior as before. They now
  exist from the first paint rather than after the script.
- Without JavaScript (checked in Chromium with script execution disabled):
  all 9 of Gibbs's details are visible and the arrows are hidden. The
  buttons are present but inert there (they were absent before), which is
  the one trade-off.

## Deploy

1. App: Publish this branch, which ships the CSS and JS with a new client
   asset version (2c23921e0e93, was d0f4b3aede6b). No plugin change.
2. WordPress picks up the new asset version within 15 minutes. Cached pages
   keep the old fragment and old CSS/JS until purged: clear WP Rocket, then
   purge the Rocket.net edge, in that order (coordinate with the other
   sessions first).
3. Verify on live: Gibbs Game Log at 360/390/430/768/820/1280 with
   scripts/cls-probe.mjs or the replay (.local/glcls): CLS < 0.02 on the log.
   `table.scp-glp-table[data-scp-expand="js"]` and the buttons should be in the
   uncached HTML.

**Rollback:** republish production (`2e7df5e` / branch
`player-desktop-cls-2026-11-20`), then purge as above.

Mixed states during a rollout or rollback are safe in both directions, so a
cached page never breaks:
- **New script, old fragment:** the new script builds the buttons when they
  are missing, the old way.
- **Old script, new fragment:** the old script empties each cell before adding
  its button (`textContent = ""`), so it replaces the server's button rather
  than adding a second one.

The purge only makes the improvement (or the rollback) take effect sooner.
