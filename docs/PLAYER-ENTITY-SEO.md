# Player pages as player pages (mak's player-entity brief, 2026-11-03)

The main player page used to be framed as a fantasy page: title "{Name}
Fantasy Football 2026: Stats, Outlook & News", H1 "{Name} Fantasy Football"
promoted from a panel heading, with the hero's own name heading an H2 above
it. For the broad query "george pickens" the page ranked around #51 while it
ranked #29 for "george pickens stats". The brief makes the player the entity
and fantasy one layer under him. Everything below is template-level; nothing
is written per player.

## What changed, and where

| Piece | Before | After | Where |
| --- | --- | --- | --- |
| Hub title | `{Name} Fantasy Football 2026: Stats, Outlook & News` | `{Name} Stats, News, Bio & Fantasy Outlook \| StatChasers` (evergreen, brand dropped first for long names) | `src/lib/player-seo.ts` profileMeta(), brandedTitle() |
| Hub description | live rank/PPG/next-game sentence | `{Name}, {Club} {POS}: stats, game logs, news, injury updates, bio, career numbers and fantasy football outlook. Updated throughout the NFL season.` | same |
| Hub H1 | `{Name} Fantasy Football` (panel heading promoted; hero name was an H2 above it) | `{Name}` - the hero's own heading, first heading in the document | `src/lib/player/header.ts` renderHero(), `src/lib/player-render.ts` |
| Section titles | dated, fantasy-first | Stats: {season} & Career NFL Stats (the 11-04 stats-audit ladder; was "Stats & Career Statistics") / Game Log & Weekly Stats / Fantasy Outlook 2026: ROS Analysis (the 11-05 Outlook brief; Rankings & Projections off-season) / Injury Status & History / News & Latest Updates / Bio: Age, Height, College & Draft, each `\| StatChasers` where it fits | `player-seo.ts` sectionMeta() |
| Section H1s | the promoted panel heading (`{Name} 2026 Stats`, `Latest {Name} News & Updates`...) | `{Name} Stats`, `{Name} Game Log`, `{Name} 2026 Fantasy Outlook` (dated since the 11-05 Outlook brief), `{Name} Injury Status`, `{Name} News`, `{Name} Bio` - the hero's name plus the section word (`SECTION_KINDS`) | `header.ts`, `player-render.ts` sectionHeading() |
| Section page panel heading | the page's H1 | dropped on the section page (it would repeat the H1); kept on the hub where it names the panel | `player-render.ts` dropPanelHeading() |
| Hero | tags, name + long subtitle, Age / Height-weight / Experience / Drafted, fantasy board, strip | tags, name, Age / Height-weight / **College** / Experience / Drafted, **production line** (`2026 season, through Week 8 · Updated Nov 2, 2026 · REC 39 YDS 533 TD 2 Y/R 13.7`), fantasy board, strip | `header.ts` renderProductionLine(), `src/lib/player/season-line.ts` |
| Overview order | strip, read, game log, career, outlook+injury cards, FAQ | strip, **latest news** (4 items), **season stats table**, read + usage meters, recent games, outlook + injury cards, career, **About {Name}** facts, peers, FAQ | `src/lib/player/overview.ts` |
| Overview H2s | `{Name} 2026 game log`, `Career fantasy stats by season` | `{Name} Latest News`, `{Name} 2026 Season Stats`, `{Name} Recent Games`, `{Name} Career Stats`, `About {Name}` | `overview.ts` |
| Person schema | only with a sourced bio record | fallback minimal node (name, jobTitle, affiliation, image) for players without one | `player-seo.ts` hubPersonNode() |
| Target share on game-log cards | `2000.0%` (a percent multiplied by 100 again) | `20.0%`; sharePct() drops and logs any share outside 0-100 | `player-render.ts` |
| WordPress mirror | dated ladder, `{Name} Fantasy Football` heading | evergreen ladder, statchasers_branded_title(), bare-name heading, section fallback meta, empty-fragment handling, sibling purge | plugin 1.10.44, `statchasers-player-pages.php`, `statchasers-player.php` |

The hub still carries every tab's panel in the served HTML (the tabs hide
them with CSS), so the page stays the comprehensive player hub; the three new
Overview blocks are compact versions of the News, Stats and Bio tabs with a
link into each.

## Not changed on purpose

- URLs: `/nfl/players/{slug}/` and the six section addresses.
- Canonicals (self, PPR, no `?format=` or `?log=`), robots, the sitemap rules,
  the `?section=` fetch, `/overview/` 301.
- The FAQ system, the Person node's fields for players with a bio record,
  dateModified, the share image.
- Every fantasy block: the board, the read, the meters, the outlook, the peers
  rail, Redraft Command links.

## Freshness and the empty-shell bug

Each of a player's seven addresses is a separate page to WP Rocket and the
edge, each with its own lifetime, so after a refresh `/stats/` could show the
previous week for as long as its cached copy lived. The plugin now records
the fragment's ETag (the API's data fingerprint) per player and, when a fresh
fetch returns a new one, purges the player's seven URLs from WP Rocket
(`statchasers_player_purge_siblings`). The hero's production line carries
`Updated {date}` from the game-log file's own write time.

A fetch that timed out (6 s; cold renders after a publish run 8-16 s) printed
an empty page under the profile's stored title, and the page cache kept it.
Now an empty fragment is marked DONOTCACHEPAGE + no-cache, prints the page's
heading and the seven links, and a section URL gets its own fallback title and
description (`statchasers_player_fallback_meta`).

## Deploy

1. Upload `wordpress-plugin/dist/statchasers-news.zip` (1.10.44).
2. Tools -> StatChasers Pages -> Profile titles -> run the retitle so stored
   titles move to the evergreen wording (typed titles are left alone).
3. The H1 probe (statchasers-h1.php) expects the bare name on the profile now.
4. Purge Rocket + re-save a few player pages to clear the edge; re-request
   indexing for George Pickens in Search Console.

## Tests

`tests/player-entity-seo.test.mjs` (new): per position one H1 = name,
evergreen title, canonical, identity + production before the board, the
Overview order and links, section titles/H1s/canonicals/sibling links, edge
cases (rookie, listed, no draft record, kicker, team changer), no share or
rate outside 0-100%, hero = Overview table = Stats tab. Updated:
`player.test.mjs`, `player-header.test.mjs`, `player-overview.test.mjs`,
`player-seo-refresh.test.mjs`, `player-outlook-title.test.mjs`,
`wordpress-plugin/tests/smoke.php`.
