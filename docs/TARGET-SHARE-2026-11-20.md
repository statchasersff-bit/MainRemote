# Target share and snap share: one definition per audience (2026-11-20)

mak's decision: player pages use the games-played share; the team /usage/
distribution boards keep the club season share, labeled as such.

| Where | Definition |
|---|---|
| Player Overview meter, Stats card, Outlook tiles, read, drivers and ranks | His targets (snaps) over his clubs' targets (snaps) in the games he played, every club summed (team/usage-share.ts playedSeasonRow) |
| Outlook points per game | The player header's figure (Sleeper logs, every game, every club) |
| /usage/ fantasy table share, its Opportunity percentile (WR/TE) and Snap % | Games he played for THIS club (playedShareAt); the percentile ranks that figure against every WR/TE club row over the games played there, qualified at 1.5 targets a game (playedTargetSharePercentile) |
| /usage/ Target and Rushing Distribution boards, Snap Counts "Season" | Club season share: the club's whole season, games he missed included. Labeled "Club season share" |
| /usage/ FAQ | One definition per sentence; counts, denominator and percentage cover the same games |

## Known limitations (left as is, mak 2026-11-20)

1. **First-read share and air-yards share** have no weekly counts in
   data/team/usage_<season>.json, so they cannot be cut to games played. For a
   traded player the Outlook shows each club's whole-season figure, averaged
   and weighted by his games at each club. Affects 6 traded WR/TE in 2026.
   A games-played version needs scripts/team/buildUsage.mjs to store weekly
   first-read and air-yards counts.
2. **Traded running backs: the backfield sentence.** outlook-tab.ts
   opportunityParagraph prints "{Last} handles X% of the {current club}
   backfield's weighted opportunities". For a traded back, X (woppShare) is
   averaged across his clubs, weighted by games, so the sentence attributes a
   multi-club figure to the current club's backfield. The "lead role" support
   line (woppShare >= 50) has the same source. 2026 cases: Emari Demercado
   (HOU -> DAL), Audric Estime (CLE -> NO), Kaytron Allen (MIA -> WAS); all have
   small shares (2-8%), none reaches the 50% lead-role line. Fix when wanted:
   name the clubs ("across Houston and Dallas") or use the current club's
   games-played backfield share.
