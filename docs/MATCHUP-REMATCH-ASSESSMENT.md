# Rematch links: technical and SEO assessment

Team Pages Phase 6 follow-up, 2026-11-20. Assessment only: no canonical,
redirect, sitemap, link or plugin change has been made. Measured on the
release build (8c949c7) and on the live site.

## The problem

A season meeting that has not been played has no page of its own. Every link
to it is the pair's page, `/nfl/<a>-vs-<b>/`, and the pair's page leads with
this season's latest finished meeting until the rematch is within six days
(PREVIEW_WINDOW_MS in matchup/pair.ts, the 2026-10-10 ownership rule). So a
reader who clicks an upcoming rematch more than six days out lands on the
earlier game's box score.

Today that is **32 games, 64 team-schedule links** (each game sits on both
clubs' schedules; the earlier "66" estimate counted team rows before the
deduplication). All 32 are divisional rematches; no non-divisional pair meets
twice in the regular season. By week: 12 in Week 18, 4 in 17, 4 in 16, 3 in
15, 3 in 14, 1 in 13, 5 in 12. The Week 12 ones fall inside the six-day window
from about Nov 24-27 and correct themselves; the Week 18 ones stay wrong for
six more weeks.

Example: Seattle's Next Game (Week 12 at San Francisco) opens
`/nfl/san-francisco-49ers-vs-seattle-seahawks/`, titled "49ers vs Seahawks
Player Stats, Box Score & Highlights | 2026": the Week 5 game.

## Current URLs and canonical relationships (verified live)

| URL | Status | Canonical | Robots | Sitemap |
|---|---|---|---|---|
| Pair page `/nfl/sf-vs-sea/` (496 pairs) | 200 | self | index | page-sitemap1 (all 496) |
| Earlier meeting `/2026-week-5/` (owned by the pair page) | 200 | up to the pair page | index | not listed |
| Upcoming meeting `/2026-week-12/` | **404** | self (printed on the 404) | index (printed on the 404) | not listed |
| A finished game the pair page has let go | 200 | self | index | game-sitemap (9 such 2026 pages today) |
| Every 2025 game | 200 | self | index | game-sitemap / game-sitemap2 |

Ownership over a rematch's life (G1 played, G2 upcoming):

1. G2 more than 6 days out: pair page = G1 recap; G1 dated = canonical up;
   G2 dated = 404. **This is the gap.**
2. G2 within 6 days: pair page = G2 preview; G1 dated = own page, enters
   game-sitemap; G2 dated = 404.
3. G2 played: pair page = G2 recap; G2 dated = canonical up; G1 dated stays
   its own page.

## Internal links

| Where | Builder | Today for an upcoming rematch |
|---|---|---|
| Schedule tab rows, next / last cards, rail | gameMatchupHref (team-render.ts) | pair page |
| Matchups tab rows | gameMatchupHref | pair page |
| Overview Last Game | gameMatchupHref | correct (finished game) |
| Overview Next Game card | matchupHref, pair only (overview.ts:147) | pair page |
| Usage "next game" link | matchupHref, pair only (team-render.ts:2469) | pair page |
| Matchups "vs Every Team" index | matchupHref | pair page (correct: it names the pair, not a game) |
| League schedule tool | its own matchupHref (schedule-render.ts:467) | pair page |
| Player Breakdown | deps.matchupHref (breakdown-premium.ts:185) | pair page |

Finished games already link correctly: the 505 game links audited in Phase 6
all resolve to the right game.

## Options

### A. Upcoming meetings get their dated page now, noindex until owned (recommended)

- `/nfl/<pair>/2026-week-N/` for an unplayed meeting answers 200 with that
  game's preview (the same preview the pair page shows in its six-day window)
  instead of 404.
- Stage 1 (more than 6 days out): `noindex, follow`, canonical self, not in any
  sitemap. Stages 2 and 3: canonical up to the pair page, exactly as an owned
  final does today. The URL is never independently indexed in season, so the
  pair page keeps every bit of authority it has now.
- Links: gameMatchupHref returns the dated URL for an upcoming meeting only
  in stage 1, otherwise the pair URL (unchanged). The Overview Next Game card,
  the Usage next link, the league schedule tool and the player Breakdown move to
  the same helper, so every surface agrees.
- Also fixes the stray tags: a game URL that is a real 404 prints `noindex`
  and no self-canonical.

**Indexed URLs changed: none.** No redirects. Sitemaps unchanged. The only
URLs whose answer changes are 32 that are 404 today (they become 200 noindex,
then canonical up). Needs one API change (pinned upcoming meeting renders a
preview; new state header) and one plugin change (new state = noindex, the
404 tags), so it ships as an app publish plus a plugin upload.

Risks: a short-lived noindex page per rematch (crawl cost is 32 URLs); link
targets change when the window opens (already true for finals); preview
content on two URLs during stage 2 is covered by the canonical. Low.

### B. The pair page switches to the rematch as soon as it is the next game

No new URLs: drop the six-day window for rematches. But it flips 32 indexed
pair pages from recap to preview for up to 13 weeks, flips the 32 earlier
dated pages from canonical-up to self-canonical and into the sitemap all at
once, and takes "<A> vs <B> box score" content off the URL that ranks for it.
**Medium-high SEO risk**; it is a canonical-strategy change.

### C. Links only

Point upcoming rematch links at the pair page with an anchor or label ("next
meeting Dec 27"). Nothing to open: the pair page has no preview of a game more
than six days out. Does not meet "each link opens the correct game".

## Recommendation

Option A. It answers "open the specific game" for all 64 links, leaves every
indexed URL, canonical and sitemap entry as it is, and reuses the one
ownership rule (pair.ts) rather than adding a second. Build it on a branch,
verify the 32 cases plus the stage changes with a pinned clock, and bring the
plugin diff for review before anything ships.

## Inventory (2026-11-20)

| Week | Pair URL (today's link for both teams) | Earlier meeting | Pair page shows today |
|---|---|---|---|
| 12 | /nfl/carolina-panthers-vs-tampa-bay-buccaneers/ | Week 7 (/2026-week-7/: 200, canonical up to pair) | Week 7 box score |
| 12 | /nfl/dallas-cowboys-vs-philadelphia-eagles/ | Week 7 (/2026-week-7/: 200, canonical up to pair) | Week 7 box score |
| 12 | /nfl/jacksonville-jaguars-vs-tennessee-titans/ | Week 10 (/2026-week-10/: 200, canonical up to pair) | Week 10 box score |
| 12 | /nfl/miami-dolphins-vs-new-york-jets/ | Week 7 (/2026-week-7/: 200, canonical up to pair) | Week 7 box score |
| 12 | /nfl/san-francisco-49ers-vs-seattle-seahawks/ | Week 5 (/2026-week-5/: 200, canonical up to pair) | Week 5 box score |
| 13 | /nfl/buffalo-bills-vs-new-england-patriots/ | Week 4 (/2026-week-4/: 200, canonical up to pair) | Week 4 box score |
| 14 | /nfl/carolina-panthers-vs-new-orleans-saints/ | Week 10 (/2026-week-10/: 200, canonical up to pair) | Week 10 box score |
| 14 | /nfl/las-vegas-raiders-vs-los-angeles-chargers/ | Week 2 (/2026-week-2/: 200, canonical up to pair) | Week 2 box score |
| 14 | /nfl/los-angeles-rams-vs-san-francisco-49ers/ | Week 1 (/2026-week-1/: 200, canonical up to pair) | Week 1 box score |
| 15 | /nfl/detroit-lions-vs-minnesota-vikings/ | Week 8 (/2026-week-8/: 200, canonical up to pair) | Week 8 box score |
| 15 | /nfl/houston-texans-vs-jacksonville-jaguars/ | Week 6 (/2026-week-6/: 200, canonical up to pair) | Week 6 box score |
| 15 | /nfl/indianapolis-colts-vs-tennessee-titans/ | Week 6 (/2026-week-6/: 200, canonical up to pair) | Week 6 box score |
| 16 | /nfl/atlanta-falcons-vs-tampa-bay-buccaneers/ | Week 8 (/2026-week-8/: 200, canonical up to pair) | Week 8 box score |
| 16 | /nfl/baltimore-ravens-vs-cleveland-browns/ | Week 6 (/2026-week-6/: 200, canonical up to pair) | Week 6 box score |
| 16 | /nfl/chicago-bears-vs-green-bay-packers/ | Week 5 (/2026-week-5/: 200, canonical up to pair) | Week 5 box score |
| 16 | /nfl/new-england-patriots-vs-new-york-jets/ | Week 6 (/2026-week-6/: 200, canonical up to pair) | Week 6 box score |
| 17 | /nfl/atlanta-falcons-vs-new-orleans-saints/ | Week 4 (/2026-week-4/: 200, canonical up to pair) | Week 4 box score |
| 17 | /nfl/baltimore-ravens-vs-cincinnati-bengals/ | Week 7 (/2026-week-7/: 200, canonical up to pair) | Week 7 box score |
| 17 | /nfl/dallas-cowboys-vs-new-york-giants/ | Week 1 (/2026-week-1/: 200, canonical up to pair) | Week 1 box score |
| 17 | /nfl/kansas-city-chiefs-vs-los-angeles-chargers/ | Week 6 (/2026-week-6/: 200, canonical up to pair) | Week 6 box score |
| 18 | /nfl/arizona-cardinals-vs-san-francisco-49ers/ | Week 3 (/2026-week-3/: 200, canonical up to pair) | Week 3 box score |
| 18 | /nfl/atlanta-falcons-vs-carolina-panthers/ | Week 2 (/2026-week-2/: 200, canonical up to pair) | Week 2 box score |
| 18 | /nfl/buffalo-bills-vs-new-york-jets/ | Week 10 (/2026-week-10/: 200, canonical up to pair) | Week 10 box score |
| 18 | /nfl/chicago-bears-vs-minnesota-vikings/ | Week 2 (/2026-week-2/: 200, canonical up to pair) | Week 2 box score |
| 18 | /nfl/dallas-cowboys-vs-washington-commanders/ | Week 2 (/2026-week-2/: 200, canonical up to pair) | Week 2 box score |
| 18 | /nfl/denver-broncos-vs-los-angeles-chargers/ | Week 5 (/2026-week-5/: 200, canonical up to pair) | Week 5 box score |
| 18 | /nfl/detroit-lions-vs-green-bay-packers/ | Week 7 (/2026-week-7/: 200, canonical up to pair) | Week 7 box score |
| 18 | /nfl/houston-texans-vs-tennessee-titans/ | Week 5 (/2026-week-5/: 200, canonical up to pair) | Week 5 box score |
| 18 | /nfl/indianapolis-colts-vs-jacksonville-jaguars/ | Week 8 (/2026-week-8/: 200, canonical up to pair) | Week 8 box score |
| 18 | /nfl/kansas-city-chiefs-vs-las-vegas-raiders/ | Week 4 (/2026-week-4/: 200, canonical up to pair) | Week 4 box score |
| 18 | /nfl/miami-dolphins-vs-new-england-patriots/ | Week 8 (/2026-week-8/: 200, canonical up to pair) | Week 8 box score |
| 18 | /nfl/new-york-giants-vs-philadelphia-eagles/ | Week 9 (/2026-week-9/: 200, canonical up to pair) | Week 9 box score |
