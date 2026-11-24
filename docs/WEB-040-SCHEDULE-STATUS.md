# WEB-040: NFL schedule game status and freshness

Branch `fix/web-040-schedule-status` (from `main` 1911958). Local only: not
pushed, published, uploaded or purged.

## The report

2026-11-19, Week 11: Colts at Texans ended Texans 26, Colts 3. The weekly
board (`/nfl/nfl-schedule/week-11/`) printed the correct 3-26 score beside
"12:04 - 4TH" after the game was final. The dated matchup page already had the
final.

## One game, source to HTML

| Step | Where | What happened to IND @ HOU |
| --- | --- | --- |
| 1. Source | `fetchEspnWeek()`, schedule-data.ts | ESPN's scoreboard read the game `state: "in"`, `shortDetail: "12:04 - 4th"`. That entry is the layer's last word on the game if no later sweep reaches ESPN. ESPN refuses this host for hours at a time (see the module's backoff notes), and a failed sweep keeps the old entries and backs off 60 minutes. |
| 2. Second source | nflverse games.csv | Posts `away_score 3, home_score 26` hours after the whistle. |
| 3. Normalization (**where they diverge**) | `normalize()`, schedule-data.ts | `status` became `"final"` from the feed's score (`finalFromFeed`), but `statusDetail` was copied from the layer for every non-scheduled status: `live?.detail` = "12:04 - 4th". The score came from the feed (the layer was not final), so the score was right and the words were the old clock. |
| 4. Generation | `statusText()`, schedule-render.ts | A final printed `(statusDetail ?? "Final").toUpperCase()`, so "12:04 - 4TH". The screen-reader line said the same. |
| 5. Caching | fragment LRU (schedule-ssr.ts), ETag, WP transient, WP Rocket + edge | Every layer keyed on or held the wrong text faithfully. The fingerprint carries `status` and `statusDetail`, so the API's own caches were consistent with the bad render. They did not cause it. |
| 6. Matchup page | matchup-render.ts | Builds its game with `statusDetail: null` and reads the box score, so it printed the final. That is why the two pages disagreed. |

No shared game-status helper existed on this branch or on the open matchup
branches (`release/matchup-candidate-2026-11-24`, `fix/web-037-*`,
`fix/web-039-*`, `fix/web-044-*`). None of them touch the schedule files.

From here I could not reconstruct the exact production window: there are no
production logs, and the committed layer snapshots only show the game "in" at
1:28 of the 1st (cff40da) and "Final" from 15:25 UTC on 11-20 (1383a15). The
replay below is the one path through the code that produces the reported
output exactly. On `main` it prints `12:04 - 4TH`.

## The fix

**`src/lib/schedule/game-status.ts` (new).** It decides the status and its
words together. It has no I/O, and `normalize()` uses it, so the weekly board,
the season grid and the team hubs all read one answer.

- Final from either source prints **Final**, or **Final/OT** when ESPN's final
  word ("Final/OT"), its period (5+), or nflverse's `overtime` column says so.
  It never prints a clock, whatever period and clock the payload still carries.
- **Postponed** and **Canceled** come from ESPN's status names. **Delayed**
  comes from `STATUS_DELAYED` / `STATUS_RAIN_DELAY` before kickoff. These used
  to print a kickoff time.
- In progress prints ESPN's detail (a clock, "Halftime", "Delayed") only while
  the read is under 10 minutes old (`LIVE_STALE_MS`). The layer refreshes every
  30 s while live, so 10 minutes means about 20 missed sweeps. After that the
  game prints **Status pending**, with no clock, no live dot and no stale score.
  `data-status="pending"` keeps the red live styling off it.
- A scheduled game prints its kickoff until 20 minutes after it
  (`KICKOFF_GRACE_MS`, above the 15-minute idle refresh). After that, with no
  source saying the game started, it prints **Status pending**.
- The `GameStatus` values did not change. Matchup code branches on them, and
  the new `statusConfirmed` / `statusObservedAtMs` fields are optional, so
  games built elsewhere read as confirmed.

**schedule-data.ts.** ESPN entries now record `period` and `seenAtMs` (when
this host read them), plus the delay status names. The slate reads nflverse
`overtime`. `normalize()` calls the helper. The fingerprint includes the
pending flag and the live read time. `ScheduleSeason.volatile` is true while
any game is live or pending. `SC_SCHEDULE_ESPN_LIVE_TTL_MS` is a test-only
seam (100 ms to 30 s, default 30 s).

**schedule-render.ts.** `statusText()` reads `gameStatusLabel()`.
`data-kickoff`, the only hook the browser bundle rewrites, now sits only on a
cell that really shows a kickoff. Before, a pending game would have had its
"Status pending" overwritten with a local kickoff time. The week head prints
**Updated h:mm PM ET** only while a game is confirmed live. The time is when
the **oldest** live clock on the board was read from ESPN, so the stamp never
claims more freshness than the board has. A final-only week gets no stamp: no
source supplies a timestamp for those, and our own fetch time is not one.

**routes/schedule.ts.** Both schedule routes (`/schedule`, `/schedule/week-N`
and `/embed/schedule`) send `X-SC-Schedule-Volatile: 1|0` and use the 30 s
max-age while volatile.

**statchasers-schedule.php.** The fetch stores the header as `volatile`. The
outage backup always counts as volatile, because it may have been saved
mid-game. On `template_redirect` (before output) and again in the shortcode,
a volatile render sets `DONOTCACHEPAGE` and sends `nocache_headers()`, the
same pair the player pages use. WP Rocket and the edge then never store a live
clock or a backup. The first view after the last game goes final is the one
they keep.

## Browser side

`src/client/schedule.ts` fetches nothing and polls nothing. Its only change to
a game is relabeling `[data-kickoff]` cells into local time. Before this fix
that attribute was already absent on live and final cells, so the browser
could not restore an old clock. It is now also absent on pending and
postponed cells. Browser caching is `max-age=0` on the WordPress pages.

## Live to final with a warm cache (in-process)

The fragment LRU is keyed on the season fingerprint, and the fingerprint
carries status, detail, score and now the live read time. A game going final
changes the version, which re-renders the page and moves the ETag. The test
renders week 11 with CIN @ WAS live, keeps the ETags, flips the scoreboard to
`Final/OT`, and checks both routes: a 200 (not 304) for the old ETag, a new
ETag, `FINAL/OT`, no clock, no dot, no Updated stamp, volatile 0 and max-age
300.

## Tests

- `artifacts/api-server/tests/schedule-game-status.test.mjs` (new, 9 tests).
  It includes unit cases for every branch of the helper. It replays
  nflverse's real Week 11 rows (`tests/fixtures/schedule-2026-week11.csv`)
  against an ESPN scoreboard that still carries IND @ HOU at 12:04 of the 4th
  (period 4, clock 724) with 3-26 scores, plus a genuinely live CIN @ WAS in
  the 4th. Both schedule routes are checked, plus the season hub, plus the
  warm-cache transition.
- On `main` the same file fails 8 of 9. The key failure is `actual:
  '12:04 - 4TH', expected: 'FINAL'`.
- `wordpress-plugin/tests/smoke-schedule-cache.php` adds two process groups to
  smoke.php. `schedlive` checks that a volatile render sets `DONOTCACHEPAGE`.
  `schedfinal` checks that a settled one does not.

- Full API suite on this branch: 1,894 tests, 14 failed. One was this
  change's new `.scs-updated` rule missing `--scs-ff` (the font-armour check).
  That is fixed, and the schedule, team-schedule and new files now pass apart
  from the three ESPN-sweep tests that also fail on `main`. The other 10
  failures (player, matchup Wild Card, team fragment assets, rb-handcuffs,
  team.css) fail the same way on `main`; matchup.test and team.test were rerun
  side by side and match exactly. That leaves 13 failures, all pre-existing,
  in line with the 13 recorded for the matchup candidate.
- Plugin: `php tests/smoke.php` passes in full, including the new groups.

### Before and after, IND @ HOU, both routes (`/schedule/week-11`, `/embed/schedule?view=week&week=11`)

```
BEFORE (main 1911958)
  <p class="scs-visually-hidden">Indianapolis Colts at Houston Texans, 3 to 26, Thu, Nov 19, 12:04 - 4TH</p>
  <span class="scs-game-status">12:04 - 4TH</span>
AFTER
  <p class="scs-visually-hidden">Indianapolis Colts at Houston Texans, 3 to 26, Thu, Nov 19, FINAL</p>
  <span class="scs-game-status">FINAL</span>
```

## Production cache behavior still to verify (release coordination)

Observed on 2026-11-24 at 04:18 UTC: `/nfl/nfl-schedule/week-11/` answers
`cache-control: public, max-age=0, s-maxage=2592000` with
`cf-cache-status: HIT`. The edge may keep a week page for 30 days, and nothing
purges it when a game ends. The live page shows IND @ HOU as FINAL today
because it was rebuilt after the layer caught up.

1. **Pages cached before kickoff.** No PHP runs on a cache hit, so this change
   cannot touch them. They show the kickoff (or a live clock cached before this
   release) until purged. This needs a decision: purge `/nfl/nfl-schedule/` and
   `/nfl/nfl-schedule/week-*/` after each game window, or exclude them from
   WP Rocket, or give them a short lifespan.
2. **Does the edge honor `nocache_headers()`** sent from `template_redirect`?
   During a live window after deploy, request a week page twice with a browser
   UA. Expect no `s-maxage` and a non-HIT `cf-cache-status`. WP Rocket
   honoring `DONOTCACHEPAGE` is the established pattern from the player pages.
3. **Load while live.** Week pages are uncached at the page layer during a
   game. Each view is a WordPress render (see the TTFB profile, 1.5-3 s), and
   the API fragment stays transient-cached for 30 s.
4. **Release purge.** Clear WP Rocket (mobile cache too) first, then the
   Rocket.net edge. Check with an iPhone UA.
5. **Plugin version.** Not bumped. The matchup candidate holds 1.10.62. Assign
   a version at integration so the upgrade sweep clears the old transients.
6. The API change does not depend on the plugin. Deployed alone, it fixes the
   words on the next render. The plugin only changes how long page caches keep
   a live render.

## Shared code

- `normalize()` feeds the team hubs (`team/schedule.ts`). Their effects: a
  nflverse overtime final now carries "Final/OT", so the Overview prints
  "Overtime" for it. A stale live game has no detail badge, and its score is
  hidden until a source confirms it. The hub's "Live Now" wording for a stale
  game is unchanged. It is out of scope here; `statusConfirmed` is available
  if wanted.
- Matchup code reads only `status === "final"` and the result. Neither changed
  for a final. No matchup files were edited.
