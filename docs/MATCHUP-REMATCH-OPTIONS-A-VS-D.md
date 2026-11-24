# Rematch URLs: Option A vs Option D

Read-only investigation, 2026-11-20, after the Phase 6 release (8c949c7,
live and verified). Nothing has been changed: no URL, canonical, sitemap,
redirect, link, plugin or production setting. Builds on
docs/MATCHUP-REMATCH-ASSESSMENT.md (the problem and the 32-game inventory).

- **Option A**: keep today's model (the pair page owns this season's latest
  game). Give an upcoming meeting its dated URL now as a `noindex` preview, and
  switch it to canonical-up once the pair page takes the game over (six days
  out).
- **Option D**: every game has one stable, self-canonical URL for its whole
  life (preview, then live, then recap). The pair URL always serves the
  head-to-head series history.

## Evidence gathered

**Traffic.** Search Console is connected but returns no rows (Rank Math:
`keywords: []`), so there is no ranking data. The November origin access log
(Rocket.net, through 20 Nov 12:15 UTC) is the best available evidence. It
undercounts readers, because edge cache hits never reach the origin, but it
shows where Google sends people and what it crawls.

| Matchup URLs, November at origin | Pair pages | Dated game pages |
|---|---|---|
| Google referrals, all | 326 | 322 (2026: 139, 2025: 37, 2024: 35, 2023: 47, 2022: 27, 2021: 37) |
| Google referrals, the 32 rematch pairs | 57 | 38 to 2026 dated pages (plus 61 to 2021-2025 ones) |
| Googlebot fetches | 1,551 | 3,013 (about 520 per archived season, 373 for 2026) |

The telling number is the 139: Google sends readers to 2026 dated pages that
mostly declare themselves copies (canonical up to the pair page). The top one
is `/nfl/new-york-giants-vs-philadelphia-eagles/2026-week-9/` (9 referrals),
owned by the pair page while the Week 18 rematch is pending. Google appears to
treat game-specific URLs as the answer to game-specific searches whatever the
canonical says. That favors D in the long run.

**Pages each option touches** (2026 regular season: 272 games in 224 pairs;
48 pairs meet twice, all divisional; 272 of the 496 pairs do not meet).

| | Option A | Option D |
|---|---|---|
| Pair pages whose content changes | 0 | 224 (every pair that meets in 2026): recap or preview becomes series history |
| Pair titles / H1 / description changed | 0 | 224 ("Bills vs Vikings Player Stats, Box Score & Highlights \| 2026" becomes "... Head-to-Head History") |
| Dated URLs: canonical up becomes self | 0 | ~142 (every 2026 final the pair page owns today) |
| Dated URLs: 404 becomes 200 | 32 (noindex) | ~122 (every unplayed 2026 game, indexable) |
| Game-sitemap entries added | 0 | ~263 (every 2026 game not already listed) |
| Redirects | none | none |

"Head-to-head history" already exists: it is what the 272 pairs with no 2026
meeting show today (Ravens-Seahawks: "Baltimore Ravens vs Seattle Seahawks:
Head-to-Head History", self-canonical). D extends that state to every pair; it
needs no new design.

## Comparison

| Criterion | Option A | Option D |
|---|---|---|
| **Indexed URLs and traffic risk** | Lowest. No indexed page changes content, title or canonical; 32 URLs that 404 today become noindex. The 57 + 38 November referrals on the rematch pairs are untouched. | Medium. 224 indexed pair pages lose their game content and box-score titles mid-season; the ~326 monthly pair referrals for box-score searches would have to move to dated URLs. Google already sends 139/month to 2026 dated pages, so it is not starting from zero, but a mid-season dip is likely while it re-evaluates 142 canonical flips. |
| **Canonical consistency** | Unchanged rule, but the rule itself shifts: a game's canonical moves (dated, then pair, then dated again when the rematch is played or the season rolls over). The 32 dated pages add one more state (noindex). | One URL per game forever, always self-canonical. Matches what 2021-2025 games already do. No ownership rule left to get wrong. |
| **Preview to recap continuity** | Broken by design: a rematch's preview lives at the dated URL, then at the pair URL, and its recap at the pair URL until the season rolls over, when it moves back to the dated URL. | Continuous: one URL carries a game's preview, live state and recap. Links, shares and bookmarks never go stale. |
| **Internal linking** | Every game link goes through gameMatchupHref, whose target changes with the clock (dated before the window, pair during it and after). The Overview Next Game card, the Usage link, the league schedule tool and the player Breakdown must move to that helper. | Every game link is the dated URL, unconditionally; the pair URL is used only for "vs Every Team" and series references. Simpler and stable. |
| **Sitemaps** | No change. | game-sitemap grows by ~263 2026 entries now and ~272 every season. Pair pages stay in page-sitemap1 (lastmod changes rarely). |
| **Structured data** | SportsEvent stays on whichever URL owns the game: the noindex dated page before the window, the pair page after. The event's URL changes during its life. | SportsEvent always on the game's own URL (as 2021-2025 pages do today). The pair page carries none (or a list of games); BreadcrumbList pair to game. Cleaner, and no event moves. |
| **Rematches across seasons** | At each season rollover every owned 2026 game flips from canonical-up to self-canonical at once (pairOwnsMeeting ignores past seasons). That flip happens every year in A and today's model. | No rollover flip: nothing changes at the season boundary except new game URLs appearing. |
| **Cache behavior** | Ownership changes on a timer (six days before kickoff), not on a data change, so caches cannot know: a cached dated page can keep `noindex` or a cached pair page keep the old recap for up to ~24 h (WP Rocket) after the switch, unless purged. Same weakness the pair page has today, extended to 32 more URLs. | A game URL changes only on data events (kickoff, final), which the game-day purge already targets. Pair pages become nearly static. Fewer surprises, fewer purges. |
| **API changes** | Pinned upcoming meeting renders its preview (today 404); a new game state header; gameMatchupHref returns the dated URL before the window; four link sites move to it; 404 game pages drop index and self-canonical. Small. | decide() in matchup-data.ts always returns the history state for the pair page (history gains a "this season" card linking each game); pinned pages handle upcoming and live; meetingHasOwnAddress always true for finals; game-index lists upcoming games; every link builder points at dated URLs; pair title/description move to the series template. Medium. |
| **WordPress plugin changes** | One new state: noindex robots for an unowned upcoming page; noindex + no self-canonical on game 404s. Plugin upload required. | The `current` (owned) branch goes away (4 call sites: lines 329, 1018, 1190 and the title filter); title and SportsEvent filters for the series pair page; game sitemap takes upcoming games. Plugin upload required. Larger diff, but it deletes more logic than it adds. |
| **Migration risk** | Very low. 32 URLs, all currently 404. | Medium if done mid-season (224 pages change at once during the season's peak search period). Low if done at the season boundary, when every owned 2026 game flips anyway and pair pages are least visited. |
| **Rollback** | Revert the app and the plugin: the 32 URLs go back to 404. Nothing indexed in between (noindex). | Revert the app and the plugin: URLs never change, so nothing 404s, but 142 canonicals flip back and Google re-evaluates twice. No redirects either way. |
| **Design** | Unchanged: the dated preview is the existing preview. | Unchanged: the pair page uses the existing head-to-head history layout, the dated page the existing preview and recap. |

## All 32 rematches, including the 12 in Week 18

Today all 32 pair pages show the earlier meeting's box score and the 32 dated
URLs 404 (inventory in MATCHUP-REMATCH-ASSESSMENT.md).

- **Weeks 12-17 (20 games).** A: the dated preview opens now as noindex; the
  pair page takes over 6 days before kickoff (Week 12's 5 games this coming
  week, so A's benefit for them is a few days). D: the dated preview is
  indexable now and stays the game's page through its recap.
- **Week 18 (12 games):** ARI-SF, ATL-CAR, BUF-NYJ, CHI-MIN, DAL-WAS, DEN-LAC,
  DET-GB, HOU-TEN, IND-JAX, KC-LV, MIA-NE, NYG-PHI. Their kickoff times are
  still TBD, and an undated fixture is never "within six days", so under A
  (and today) the pair page keeps the old recap until the league sets the
  Week 18 times (normally after Week 17, around Dec 28), then has about five
  days of preview. A's noindex preview would be the only route to the right
  game for about six weeks. Under D each has an indexable preview for those six
  weeks, including the TBD period (the preview already handles TBD times).
  For "<A> vs <B> week 18" searches, D is the only option that can rank.

## Recommendation

1. **Now (in season): Option A.** It fixes all 64 team links within days of
   approval, touches no indexed page, and rolls back cleanly.
2. **At the season boundary (after the Super Bowl, before 2027 Week 1):
   decide on Option D** with the post-season traffic in hand. The boundary is
   when the owned games flip anyway, so D's canonical changes coincide with
   one that is already happening, and pair pages are at their quietest.
   Building A first is not wasted: the dated preview rendering and the single
   link helper are both parts of D.

If you prefer to go straight to D, do it at the boundary, not mid-season.

## Data sources

Access log: `~/logs/*ssl_log-Nov-2026.gz` on Rocket.net (aggregated on the
server; no rows copied out). Page facts: live pages fetched 2026-11-20 12:40-
12:50 UTC. Counts: fresh nflverse games.csv and the release build.
