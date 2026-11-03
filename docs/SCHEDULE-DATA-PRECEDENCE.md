# Team schedule data: sources, precedence and statuses

Every schedule view on the site - the NFL schedule tool, the 32 team hubs,
their `/schedule/` pages, the player pages' upcoming blocks and the matchup
pages - reads one normalized season from `lib/schedule/schedule-data.ts`.
A team's schedule (`lib/team/schedule.ts`) is that season filtered to one
club. Nothing downstream fetches schedule facts of its own.

This file records which source wins for which fact, and what each status
means. Written 2026-11-03 after the Colts schedule page was found printing
nflverse's placeholder "Sunday 1:00 PM" for Week 16 and Week 18 games the
NFL lists as TBD, and counting the London game as a road game.

## Sources

| Rank | Source | What it is trusted for |
| --- | --- | --- |
| 1 | The game itself | A game that is final or in progress happened; its kickoff is confirmed by the fact. |
| 2 | ESPN scoreboard (`site.api.espn.com`, per open week) | `timeValid` (the league's TBD flag), the kickoff instant, `neutralSite`, the venue and its city, network, live score and status (postponed, canceled). Refreshed every 15 minutes for the active week, every 6 hours for every open week, persisted to `data/schedule/espn-layer-<season>.json` so a restart does not forget what it learned. |
| 3 | nflverse `games.csv` (the slate) | Who plays whom, in which week, at which stadium, divisional flag, the market lines, final scores once posted. Fetched every 6 hours; `data/schedule/games.csv` is the stored fallback. |
| 4 | Nothing | TBD. |

The official NFL and club schedules are what ESPN's `timeValid` mirrors; the
site does not fetch nfl.com or the club sites directly (the NFL API needs a
token, and the club pages are HTML).

## The kickoff rule (`resolveKickoff`)

1. Final or live: ESPN's instant if present, else the slate's. Confirmed.
2. ESPN has the game and `timeValid` is true: ESPN's instant. Confirmed.
3. ESPN has the game and `timeValid` is false: no date, no time. **TBD.**
   The slate's "Sunday 13:00" for that row is a filing convention, not a
   fact, and is never shown or put in structured data.
4. ESPN has never seen the game (layer unreachable and no stored entry):
   the slate's kickoff stands for an ordinary week and is refused for the
   final regular-season week, which the league never schedules in advance.
5. Postponed: TBD until ESPN says the time is valid again. Canceled: TBD.

A game carries `timeConfirmed`, `dateConfirmed` and `kickoffSource`
("live" | "slate" | "none"). `kickoffMs` is null unless both halves are
confirmed. `tentativeDate` keeps the filing Sunday for ordering only.

## Site

`neutralSite` is true when nflverse files the game as "Neutral" OR ESPN
marks the competition `neutralSite`. A team's game then has
`site: "neutral"`, and the counts, the season path, the snapshot, the FAQ and
the division slate all treat it as neither home nor away. `homeAway` still
names the designated host side because the matchup addresses and the box
score are keyed on it.

## Statuses

| Status | Meaning |
| --- | --- |
| `scheduled` | Not yet played. May be TBD (see above). |
| `live` | ESPN reports it in progress. The next-game card says "Live Now". |
| `final` | Completed. Has a result. Moves to the Results board. |
| `postponed` | ESPN `STATUS_POSTPONED`. Shown as such; kickoff TBD. |
| `canceled` | ESPN `STATUS_CANCELED`. Shown as such; left out of structured data. |

## Networks

ESPN's broadcaster strings are normalized once (`normalizeNetwork`): "Fox"
and "FOX" are FOX, "NFL Net" is NFL Network, "Prime Video" and "Amazon" are
Prime Video, simulcasts keep both halves ("ESPN / ABC"). A local call sign
that is not an exact match is left as sent.

## Freshness

`TeamSchedule.version` fingerprints every rendered fact (dates, flags,
scores, networks, statuses, venues). The team page cache keys on it, so a
score or a flex that lands in the live layer re-renders the page without
waiting for the slate's six-hour clock. `updatedAtMs` is the later of the
slate fetch and the live layer's last successful sweep, and is what the page
prints as "Updated" - never the request time.

## Structured data

Only a game with a confirmed kickoff and a venue becomes a `SportsEvent`.
TBD games are left out; postponed games carry `EventPostponed`; canceled
games are left out.

## What the hub carries vs `/schedule/`

The hub's Schedule tab is a preview: last game, next game, the two after,
and a link to the page. The full boards, the season snapshot, the division
slate, the pair index and the schedule FAQ live only at `/schedule/`.
