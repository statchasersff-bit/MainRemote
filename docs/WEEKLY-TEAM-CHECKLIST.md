# Team hubs - weekly checklist

About 10 minutes, every **Tuesday** in season (after Monday night, before nflverse posts the week on Wednesday). Production refreshes the data by itself every day; this checklist covers the part nothing can refresh: who is coaching and calling plays.

## What runs by itself (nothing to do)

| What | When | Source |
|---|---|---|
| Record, standing, head coach in the hero | live, cached up to 3 hours | ESPN (standings table, tiebreakers applied) |
| Usage tab | daily 11:00 UTC (7am ET) | nflverse play-by-play, FTN charting |
| Coaching tab numbers and prose, all 32 teams | daily, right after Usage | nflverse + `data/team/coaching_staff_2026.json` |
| **Team page check** | daily, right after Coaching | games file, ESPN standings, ESPN coaches, the data files |

The Coaching tab's prose is templated from the numbers, so it re-derives every day. The **researched facts** (who calls plays, career stops, scheme notes, season counts) come only from `coaching_staff_2026.json`, and change only when someone edits it.

## 1. Read the daily check (2 minutes)

Open the app's `/api/status` and find `playerStats.daily.steps` → **`team page check`**.

- `ok: true` - nothing on the team hubs is wrong by any rule we check. Go to step 2.
- `ok: false` - the `error` lists each problem. What each kind means:

| FAIL says | Meaning | Do |
|---|---|---|
| `ESPN lists head coach X, research file says Y` | A head coach changed | Step 3 |
| `coaching says "through Week N" but the club's last finished game is Week M` | A page claims a week the team has not played | Tell Claude; the builder's per-team week has regressed |
| `coaching copy "..." - ...` | A sentence the 2026-10-03 audit removed is back | Tell Claude; a template regressed |
| `current dossier row ...` | The current scoring line mixes seasons | Tell Claude |
| `"straight season" on a play-caller with N stints here` | A returning coach reads as an unbroken run | Tell Claude |
| `standings: ... no playoffSeed` / `seeds repeat` | ESPN's standings table changed shape; the Standing chip may be wrong | Tell Claude |
| `no coaching entry` / `no usage entry` | A tab will not render for that team | Check the `team coaching` / `team usage` steps above it for their error |

Also glance at the `team usage` and `team coaching` steps. If either failed, the pages are serving the previous day's data, which is stale but not wrong.

To see the full report, including **WARN** lines (stale data, an upstream that did not answer), run it in the workspace:

```
cd artifacts/api-server
node scripts/team/checkTeamPages.mjs 2026
```

The workspace's data files are only as new as your last refresh there; the head coach and standings checks always read ESPN live.

## 2. Scan for staff news (5 minutes)

The check catches **head coach** changes only. No feed reports coordinators or who calls plays, so search for the week's news:

- `NFL offensive coordinator fired` / `NFL defensive coordinator fired`
- `NFL play-calling duties` / `will call plays` / `taking over play-calling`
- `interim head coach NFL`

Note any team where the **head coach, offensive coordinator, defensive coordinator or offensive play-caller** changed. Reports like "X will have more input on the game plan" are not a change; only who calls the plays counts.

## 3. Record a change (10 minutes per team)

Edit the team's entry in `artifacts/api-server/data/team/coaching_staff_2026.json`. Which fields change depends on the change:

| Change | Fields |
|---|---|
| Head coach fired | `hc` (the interim). If the HC called plays, also everything in the next row. |
| Offensive play-caller changes | `playCaller` (`name`, `title`, `basis`, `note` with the source), `priorSeasonsAsCaller` (the new caller's seasons calling plays **for this team** before 2026), `callingStops` (add the new caller's stops), `careerPath`, `tree`, `inSeasonChange2026` (the ledger line, e.g. `"Smith called Weeks 1-6; Jones from Week 7"`), `sources` |
| OC changes, play-caller does not | `oc`, `ocIsCaller`, `ocHasCalledPlaysBefore`, `ocNote` |
| DC changes | `dc`, `dcSchemeNote` |

Then:

1. Set `"verified": false` on the team until mak has fact-checked the new entry. The check warns about unsigned entries; the page still renders.
2. Rebuild that team and run the check:
   ```
   node scripts/team/buildCoaching.mjs 2026 --force <abbr>
   node scripts/team/checkTeamPages.mjs 2026
   ```
3. Read the team's Coaching tab in the preview.
4. When signed off, set `"verified": true` and rebuild again.
5. **Republish.** Production's daily rebuild reads the research file that shipped with the app, so an edit reaches the live site only with a publish.

**Known limit - a mid-season play-caller change.** The builder computes 2026 tendencies over every 2026 game. After a change, the 2026 column mixes both callers until the new one has most of the season's games. `inSeasonChange2026` puts the split on the page in the ledger, but the numbers do not split. If that matters for a team, ask Claude to add a current-season week window (the builder already has windows for past seasons, e.g. McDaniels' 2023 Weeks 1-8).

## 4. Things this does not cover

- **Team outlooks** are written by hand ("Written before Week 1") and never refresh. Revisit one when its premise breaks (a season-ending injury, a trade, a QB change).
- **The Usage tab's copy rules** are in `docs/USAGE-COPY-RULES.md`, and its own test (`tests/team-usage.test.mjs`) checks for overclaims.
- **Coordinator history facts** (season counts, stints) were verified once, team by team, on 2026-10-02. See `docs/COACHING-VERIFICATION.md`.
