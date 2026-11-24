# WEB-044: Team tabs - one table per dataset, player links, roster in one tap

Branch `fix/web-044-team-tabs-2026-11-24`, based on the published commit
`7c3e646` (production as of 2026-11-23). Local only, not deployed. Scope:
Coaching, Stats and Usage on all 32 team pages, and the way to the roster
(the Depth Chart tab) from the hub and those three tabs.

## What the audit's Detroit examples look like today (before this branch)

| Audit observation | Still reproduces on 7c3e646? |
|---|---|
| Coaching "Season by Season" and "Fantasy Finishes" twice in the HTML | **Yes, as data.** Each heading prints once now, but both datasets render twice: the table plus a phone `<details>` list (`.sct-csp`, `.sct-cfp`) hidden by CSS at the other widths. |
| Snap-count names in several forms | **Yes.** Every name in the Usage snap / target / rushing tables printed three times: full, "J. Goff" and a visually hidden full name (`innerText` read "Jared Goff Jared Goff"). The finishes table printed surnames ("Brown" for Amon-Ra St. Brown) and its phone copy full names. |
| Coaching and Stats mention Goff, Gibbs, St. Brown, LaPorta with no links | **Coaching: yes** (0 player links). **Stats: no**, already fixed: the Leaders line links all three leaders by Sleeper id (`/team/detroit-lions/stats/`, `.sct-sp-leaders a`, team-render.ts statsDash). |
| Roster hard to find from these tabs | **Partly.** The Depth Chart tab is in the strip on every tab and points at the right club, but on phones it is the 8th of 9 tabs and sits off screen (x=483 at 390px). |

## Changes

1. **Coaching, Season by Season**: the phone list is gone; phones get the
   table, scrolling inside its own region (`.sct-cs-scroll`, tabindex 0,
   role region) with the existing sticky Season column.
2. **Coaching, Fantasy Finishes**: one table. Each finish prints the
   player's full name once (`name-forms.ts`); phones paint the surname from
   it, so the table fits a 390px phone with every position in view (mak's
   11-15 "no sideways scroll" rule). Linked by club + position + season
   (`playerProfileUrl` with the season's game logs): 680 of 900 stored
   finishes link, every one confirmed by a game-log row for that club and
   season; the other 220 are players with no published profile.
3. **Usage tables**: each name once, the short form painted by CSS
   (`.sct-nm-r` hidden, "." via `::after`); the link's `aria-label` is the
   full name. Links now resolve like the hub's rows (`playerProfileUrl` +
   `usageRef`, by Sleeper/GSIS id) instead of linking the builder's raw slug:
   48 links to unpublished profiles (free agents such as Daniel Jones, Najee
   Harris, Brandin Cooks) are now plain text; no published player lost a
   link; 3 gained one.
4. **Usage copy**: the first mention of each player in a situational card or
   FAQ answer links to him (`prose-links.ts`), only for the club's own
   id-resolved rows and full names; questions and the FAQPage schema are
   unchanged.
5. **Roster link**: `Lions roster & depth chart` under the header facts,
   the Depth Chart tab's own href (so the embed's `/nfl/teams/` prefix
   applies), shown only where the header is under 680px wide (where the strip
   cuts that tab off), never on the Depth Chart tab itself.
6. **Page overflow**: Coaching widened the page to 702px at a 600px window
   (pre-existing): the tables' 1px screen-reader words escaped the scroll
   region. The three Coaching scroll regions are now positioned.

## Detroit, before and after (390 / 768 / 1280, true widths via CDP emulation)

| Tab | Tables (rows) | Copies in HTML | Player links | Page width |
|---|---|---|---|---|
| Coaching | 3 (11 / 4 / 4), headers and pills identical | 2 -> 0 | 0 -> 15 at every width | 390/753/1265 both (600: 702 -> 585) |
| Stats | 2 (6 / 5) unchanged | 0 -> 0 | 3 -> 3 (unchanged) | unchanged |
| Usage | 4 (16 / 9 / 6 / 20) identical; Season / Last 3 / week / position controls give the same rows and values | 3 names per row -> 1 | 39 -> 39 table/card links (same targets) + 33 copy links | unchanged |

Snap table screenshots before/after are pixel-identical at 390 and 1280 apart
from headshot load timing. Show all on New England: 5 -> 21 seasons and
5 -> 10 finishes, same on both builds. Keyboard: the roster link, the three
Coaching scroll regions and every new link take focus with a visible ring.

## All 32 teams (new build vs 7c3e646, served HTML)

- Every table on Coaching, Stats and Usage: same count, rows, column labels
  and rank pills; no `.sct-csp`, `.sct-cfp` or triple-name markup left.
- Hub + three tabs: the roster link's href equals the Depth Chart tab's,
  `/team/{slug}/depth-chart/` (32 x 4); every Depth Chart page returns 200
  and carries no link to itself.
- Player links: Coaching 0 -> 490 (490 of the 660 finish names the 32
  pages render; the other 170 have no published profile), Usage
  1,428 -> 2,465 (1,091 of them copy links), Stats and hub unchanged. Every link goes to a published slug
  for the player named (11 nickname pairs such as Josh/Joshua Palmer,
  Matt/Matthew Stafford are the same player).

## Not changed, on purpose or out of scope

- Usage Situational takeaways render twice (paragraph cards above 560px,
  `.sct-us-pa` dashboard below). Not a table; mak's 11-21 call (phone
  dashboard at every width) is already on the held WIP `24ba9d7`.
- Coaching career chart prints three SVGs (desktop, two phone sizes) and two
  KPI stacks. Charts, not tables.
- Depth Chart tab names print full + brief forms (`briefName`). Same pattern
  as the Usage names, outside the three tabs.
- Names in FAQ questions stay text (a link inside `<summary>` fights the
  toggle); later mentions in an answer stay text.

## Verification gaps (see the review below for what was closed)

- No physical phone yet: every check is headless Chromium (CDP emulation),
  some of it on the live Divi template (below).
- "Published" is the workspace's `indexed_players.json` (generated
  2026-11-23 05:37 UTC); the live sitemap matched it on 2026-11-24 (below).
- The held WIP `24ba9d7` edits the same files; see the integration
  requirement below.

## Tests

`tests/team-web044.test.mjs` (9 tests; the Stats leaders and Season History
guards pass on 7c3e646 too, the other 7 fail there).
`tests/team-coaching.test.mjs`: the phone-list test now asserts the single
table (it also pinned a rank that has since moved, QB4 -> QB8).

Full suite (`node --test tests/*.test.mjs`, `INGEST_SECRET` unset), rerun
after the review fixes: branch 1,827 pass / 12 fail, 7c3e646 1,817 pass / 13 fail. The 12 are the same
tests on both (embed player script, table-armour Usage prefixes for
`.sct-us-sit-short` / `.sct-us-pa`, ESPN sweep, Wild Card, bio and others:
data drift and earlier work, none in files this branch changes); the 13th
on 7c3e646 is the old finishes test.

## Review, 2026-11-24 (before release)

How each check ran: **C** = headless Chromium with CDP device emulation
against the local build; **D** = the live statchasers.com Detroit Coaching
page (real Divi template, header, fonts, WP Rocket) loaded in headless
Chromium with its team fragment and `team.css` swapped for the local
build's over CDP (the live fragment equals the 7c3e646 embed apart from the
FAQ data island the plugin strips); **P** = physical phone (none yet).

| Check | How | Result |
|---|---|---|
| Season by Season at 390, before/after, same data (no data diff 7c3e646..branch) | D | before: phone list with tap-to-open rows; after: the table, 860px inside a 348px region, page 390px |
| Sticky Season column when scrolled | C, D | **was broken on phones** (an 11-15 rule set it static at 560px and under, written while phones saw the list). Fixed: Season frozen at 0px, white, on top; Team/PPG/rank scroll |
| Fantasy Finishes at 390 | D | fits (348 in 348), in-season stop label wraps to 3 lines ("Through Week 10 · In-season"), Amon-Ra St. Brown shows "St. Brown" as a link |
| Roster link opens Detroit's depth chart | D (real mouse click) | landed on https://statchasers.com/nfl/teams/detroit-lions/depth-chart/, H1 "Detroit Lions Depth Chart", Depth Chart tab current |
| Header around the 680px breakpoint | D (600-1000px sweep, 10px steps) | no width where the Depth Chart tab is cut off and the link is missing; both show at 690-700 (tab fits from a 667px header). At 680-700 the link sat under the crest panel at the hero's edge; fixed (content column at 650-679px) |
| Page overflow 600-1000 | D | none |
| Accessible names | C (Accessibility.getPartialAXTree) | links: "Jared Goff", "Amon-Ra St. Brown" (Usage, painted "J. Goff" / "A. St. Brown"); finishes link "Amon-Ra St. Brown" (painted "St. Brown") |
| Copy of a painted short name | C (real clipboard: execCommand copy, clipboard.readText) | 7c3e646: "J. GoffJared Goff"; 4c6ed3d: "J Goff"; now "J. Goff", "A. St. Brown", and a whole-table copy keeps every "." |

The copy fix: the "." stays CSS `::after` (page text, aria-labels and
crawlers read the plain full name) and `client/team.ts wireNameCopy()` puts
it back into the copied plain text for painted short names. A "." in the
markup was tried first and reverted: it made the page text "Drake. Maye",
and eight existing tests that find rows by name failed on it.

Gap: a Usage name with no link (no published page) is announced as painted
("K. Latu" where the short form shows): `aria-label` on a plain span is not
reliably read. 48 Usage rows across the league are unlinked.

### Published-player lookup

`ids().indexed` in `src/lib/player/data.ts` reads
`data/player/indexed_players.json`, written by
`scripts/player/buildIndexedPlayers.js` (step 3 of the hand-run player
builders, scripts/player/README.md: Sleeper dictionary + Ourlads chart,
additive). The daily chain is off, so it moves when someone rebuilds; the
WordPress player pages are built from the same list by WP-Cron. The newest
manifest available is the live Rank Math page sitemaps (fetched
2026-11-24, newest lastmod 2026-11-23 22:52 UTC): 650 player hubs, all 650
in the local list (the list's other 32 entries are team defenses). No
unresolved identity resolves against it; all 4,534 player links on the hub,
Coaching, Stats and Usage of the 32 teams point at a slug in the live
sitemap.

### Integration requirement: wip/held-from-publish-2026-11-23

Keep that branch separate until WEB-044 is reviewed. When the two are
combined:

- **Stats Season History must render once at every width.** The held
  branch adds `historyPhone()` in `stats-premium.ts` (a `.sct-sph`
  `<details>` list beside the Season History table, mak 11-21). Merged as
  is it prints every season twice. Adapt the one table with CSS instead;
  `tests/team-web044.test.mjs` "Stats: Season History is one table at every
  width" fails while the list exists.
- Its container-query copies of the Coaching `.sct-csp` season-list rules
  (`@container coaching` up to 900px) target markup WEB-044 removed; drop
  them, and do not restore the lists (`.sct-csp`, `.sct-cfp`).
- Its "phone version at every width" Usage situational change (`.sct-us-pa`
  only) is compatible and removes the remaining duplicated takeaways.
- Rerun `tests/team-web044.test.mjs`, the 32-team check and the Divi
  preview after the merge.
