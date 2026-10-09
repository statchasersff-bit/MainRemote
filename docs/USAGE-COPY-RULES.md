# Usage tab: the rules that write the sentences

Every sentence on a team hub's Usage tab is written by a rule in
`artifacts/api-server/src/lib/team/usage-copy.ts` (signal picks and tiers in
`usage.ts`, fixed captions in `usage-render.ts`). There is no model call and no
per-team text: each rule checks the team's numbers against a threshold and
fills a template, so all 32 pages rewrite themselves when the data rebuilds.
The numbers come from `scripts/team/buildUsage.mjs`, whose header defines each
one.

Placeholders below are in `{braces}`. "RB1" is the back with the most weighted
opportunities (carries + 2 x targets); "the room" is every back on the roster.

## What kind of claim each sentence makes

| Type | Meaning | Safe when |
|---|---|---|
| **Data** | Restates a number we measured | The number is right and labeled with its real definition |
| **Derived** | A threshold or arithmetic on our numbers ("drops to 33% (49% overall)") | The comparison is like-for-like and the sample is stated |
| **Model** | A StatChasers projection | It says it is a projection |
| **Opinion** | Fantasy advice ("Trade for him this week") | The reader can tell it is our take |

## Why the four errors happened

All four were the same mistake: a template attached a **mechanism** to a
number that cannot carry it.

| Error | The number | What the sentence claimed | Why that does not follow |
|---|---|---|---|
| "buy signal, not a warning" | FPOE below 0 | Production will catch up | FPOE says production ran below expectation, not why. It can be variance, QB play, drops or the player |
| "no one takes the hurry-up snaps from him" | Share of the backs' carries + targets when trailing by 7+ | Who is on the field in the hurry-up | Opportunity is not snaps (participation data arrives after the season), and trailing is not hurry-up |
| aDOT "puts him in the 16% deep slice" | Average target depth | His targets are deep | An average says nothing about the distribution: 18.4 can be zero deep targets |
| "pocket passer ... points have to come through the air" | Designed-run rate and in-10 carries | He does not run | Scrambles are rushing yards too: Maye had 82 |

The test for every rule below: **does the number measure exactly what the
sentence says?** If the sentence needs a second number to be true, the rule
must check that number or say less.

## The rules every template follows

1. **Scope stays put inside a sentence.** Team metric, team conclusion. Player
   metric, player conclusion. Opportunity metric (carries, targets), opportunity
   conclusion. Snap metric, playing-time conclusion. A team red-zone pass rate
   cannot say who runs it in; a trailing split of carries + targets cannot say
   who was on the field.
2. **Averages stay averages.** aDOT describes average target depth only. It
   cannot say what share of targets were deep, short or anything else; that
   needs the player's own count (we store `deepTargets`, 20+ air yards). The
   same goes for YPC, average target share and average snaps.
3. **Description does not turn into cause or forecast.** These words need a
   second measured variable or outside validation before a template may use
   them: because, causes, leads to, will, catches up, regresses, predicts,
   best, engine, plan, designed for, earning, talent, floor holds.
4. **Projections say what they are.** Three tiers, each worded differently on
   the page:
   - arithmetic on the current rate: "a 51-catch pace", "if the usage holds";
   - our model: "Our contingency model ... projecting";
   - fantasy advice: the Buy low / Sell high / Watch cards (no on-page
     disclaimer since 2026-10-03, at mak's request).
5. **Small samples carry their count.** A gap or zone efficiency figure always
   prints its attempts, and adds "a small sample" under 20. A concentration
   claim ("concentrated inside", "leaned left") needs 20+ team designed runs.

The guard: `tests/team-usage.test.mjs` ("no generated sentence claims more
than its number measures") renders all 32 Usage tabs and fails on any phrasing
an audit has already caught (engine, the plan, buy signal, regresses, floor
holds, talent question, hurry-up, when he's out there, sweet spot, travel
nowhere, designed for him, "best stat" claims and the rest). Mak's intro is
hand-written and skipped. Add a pattern there whenever a new one is caught.

## Team environment cards

| Card | Rule | Sentence | Type |
|---|---|---|---|
| Pass rate over expected | PROE >= +3% | "Throws more than game situations call for - more pass attempts to share among the pass-catchers" | Derived |
| | +1% to +3% | "Slightly pass-leaning relative to situation - the target tree, not the play-calling, decides who eats" | Derived |
| | -1% to +1% | "Throws about as much as situations call for - ..." | Derived |
| | -3% to -1% | "Slightly run-leaning relative to situation - target concentration matters more than raw pass volume here" | Derived |
| | <= -3% | "Runs more than game situations call for - fewer pass attempts to share among the pass-catchers" | Derived |
| Red-zone pass rate | Rank 1-10 | "Throws inside the 20 - {player}'s {n} end-zone targets lead the team" | Data |
| | Rank 23-32 | "Run-heavy inside the 20 - passing on {x}% of red-zone plays limits the red-zone targets available to the receivers" | Derived |
| | Rank 11-22 | "Balanced inside the 20 - {leader} leads the team with {n} red-zone opportunities" | Data |
| Neutral pace | Rank 1-10 | "... faster neutral pace creates more potential play volume when drives are sustained" | Derived |
| | Rank 23-32 | "... slower neutral pace caps the potential play volume" | Derived |
| Qualifying plays / game | Rank 1-10 / 23-32 / else | "Dropbacks and runs a game, kneels and spikes excluded - more plays to share among the starters" / "fewer plays to go around, so shares matter more" / "league-average volume, so shares decide it" | Data + derived |
| Team xFP / game | Rank 1-8 | "Combined expected fantasy production generated by the offense - high overall opportunity value gives more than one starter room to pay off" | Derived |
| | Rank 25-32 | "... - low overall opportunity value puts more pressure on players to command large individual shares" | Derived |

## Backfield

**Chips** (always shown when the number exists):

- "{RB1} weighted opps / active game - RB{rank} in the NFL" (Data; rank only for
  backs who qualify)
- "{RB1} high-value touches (in-10 carries + receptions), season" (Data)
- "{RB2} weighted opps / active game" (Data)
- "{RB1} wOpp per active game vs. last season" + "role grew, not just
  efficiency" (+1.5 or more) / "a smaller role than last season" (-1.5 or
  less) / "the same role as last season" (Derived)

**Takeaway 1: who owns passing downs.** Uses third down when the room has 8+
third-down carries + targets, otherwise the room's targets.

| Rule | Sentence | Type |
|---|---|---|
| Another back has 40%+ of that work | "Why {RB1}'s reception count stays capped: {owner} has {x}% of the backs' third-down carries + targets [and {y}% of the two-minute carries + targets, if 40%+ on 5+ plays]. {RB1}'s current receiving role is the smaller one: {n} catches through {g} games is a {pace}-catch pace. While {owner} holds most of the passing-down work, {RB1}'s receptions have to come on other downs." | Data + derived |
| RB1 owns it | "{RB1}'s receiving role: His third-down involvement ({x}% of the backs' third-down carries + targets) gives him a receiving path even when rushing volume falls; {n} catches through {g} games is a {pace}-catch pace." | Data + derived |
| ...and the room has 6+ trailing-by-7 plays, RB1's trailing share is at least 3/4 of his overall share | "Trailing by 7+, {RB1} still receives {x}% of the RB room's carries + targets, so his opportunity has not disappeared in negative game scripts." | Derived |
| ...trailing share under 3/4 of overall | "Trailing by 7+, his share of the RB room's carries + targets drops to {x}% ({y}% overall), so negative game scripts cut into his work." | Derived |

Catch pace = receptions / RB1's games x 17.

**Takeaway 2: the handcuff.** Shown when RB2 has 5%+ of weighted
opportunities.

- Weight = each back's share of the early-down + red-zone carries + targets
  behind RB1. Projected RB2 = RB2's wOpp per active game + RB1's x RB2's
  weight. Projected share uses season totals. Grade = where the projection
  would rank among qualified backs: top 12 "a top-12 weekly RB by volume",
  13-24 "an RB2 by volume", else "flex volume at best".
- Role claim: "early-down" only if the room has 10+ early-down plays and RB2
  has 15%+; "red-zone" only if the room has 8+ red-zone plays and RB2 has 15%+.
- Sentence: "{RB2} backs up the {roles} role (the valuable one). Our
  contingency model reallocates {RB1}'s carries + targets to the backs behind
  him ({RB2} {w}%, {RB3} {w}%, by their shares of the early-down and red-zone
  carries + targets behind him), projecting {RB2} for ~{x}% of backfield
  weighted opportunities (~{y} per active game) if {RB1} is inactive - {grade}"
  + " - and why he's a STASH, not a cut." (top-24 and tiered Stash) / " - worth
  a bench spot in deeper leagues." (top-24 otherwise). Type: **Model**, labeled.
- No back at 5%: "No clear handcuff behind {RB1}: ... a {RB1} absence would be
  settled on the waiver wire, not by a stash on your bench." (Opinion)

**Fixed caption:** "Who gets the backfield's work - weighted opportunities
count a target as two carries, a better view of RB opportunity than raw
touches alone." (Derived from the formula itself.)

## Run direction

Designed runs only, and descriptive only: the split says where the runs went,
not what the play-caller wanted. The gold gap = highest YPC among gaps with at
least 5 attempts and 8% of designed runs.

1. Always: "{x}% of designed runs have gone up the middle, {y}% to the left
   (tackle + end) and {z}% to the right." (Data)
2. With 20+ team designed runs: middle 55%+ "The run game has been
   concentrated inside so far."; a side 40%+ "The run game has leaned {side}
   so far." (Derived)
3. Always: "{Gap} runs have produced the highest YPC so far: {ypc} on {n}
   attempts[, a small sample, under 20]." (Data)
4. When the gold gap is on a side and two of RB1's three longest runs went
   that side: "Two (All three) of {RB1}'s three longest runs came off the
   {side} side." (Data)

## Pass map ("Where {QB} Attacks")

The primary passer's own attempts only (most dropbacks). Deep = 20+ air yards.
Gold zone = best YPA among zones with 10%+ of his attempts.

- Best short zone (5+ attempts): "The {zone} has been the {Team}' most
  efficient sub-20-yard area at {ypa} YPA on {n} attempts[, {receiver}'s
  territory]." Territory = one receiver has 35%+ of the zone's targets and 4+
  targets. (Data)
- "{QB} keeps {x}% of his throws under 20 air yards" (Data) + ", with the {deep
  zone} his most explosive zone ({ypa} YPA on {n} attempts)" only when that deep
  zone has 2+ attempts and out-gains every short zone. (Data)
- Deep-target receiver: a WR/TE under 15% target share with 2+ deep targets
  whose deep-target rate is at least double the QB's deep share: "{name}'s
  fantasy problem, mapped: {n} of his {t} targets ({x}%) have come 20+ yards
  downfield, the slice that is only {y}% of {QB}'s throws." Only when the gold
  zone is a short one. (Data)

## Player profiles (the + button)

Every profile ends "Bars show percentile vs. all NFL {position}s." Most add the
**FPOE line**:

| FPOE / game | Sentence | Type |
|---|---|---|
| within 0.05 | "Production is running right at expected, so this is volume, not a hot streak." | Derived |
| within 1.5 | "Production is running {+x} over/against expected, so this is volume, not a hot streak." | Derived |
| +1.5 or more | "He's scoring {+x} points a game over expected - efficiency that may not repeat; his {xfp} xFP a game is the opportunity underneath it." | Derived |
| -1.5 or less | "Production is running {x} points a game below the value of his opportunities - a potential regression signal if the role holds." | Derived |

**QB** (first match wins):

| Rule | Thesis | Sentence | Type |
|---|---|---|---|
| 3+ in-10 carries | "The goal-line QB." | "{n} carries inside the 10, a {x}% designed-run rate and {yds} rushing yards through {g} games: his rushing role adds goal-line touchdown equity on top of the passing (QB{rank} in expected points)." | Data + derived |
| 8%+ designed-run rate | "The rushing floor." | "{n} carries inside the 10, a {x}% designed-run rate and {yds} rushing yards through {g} games: designed runs add a rushing floor beyond scrambles (QB{rank} in expected points)." | Data + derived |
| 15+ rushing yards a game or 6%+ scramble rate | "Limited designed runs, real scramble yards." | "{QB}'s designed rushing role is limited, but scrambling still adds meaningful floor: {yds} rushing yards through {g} games. With only {n} carry inside the 10, however, most of his touchdown equity still comes through the passing game (QB{rank} in expected points)." | Data |
| otherwise | "A pocket passer's profile." | "{yds} rushing yards through {g} games and {n} carries inside the 10: his points come mostly through the air, so his weekly range follows the pass volume." | Data |

**RB:**

| Rule | Thesis | Sentence | Type |
|---|---|---|---|
| Tier Stash | "Contingent value, quantified." | "The {x}% touch share is standalone-flex-in-a-pinch at best; the real number is what it becomes if {RB1} misses time - see The Backfield Split above." | Opinion |
| 65%+ of weighted opps | "The locked-in workhorse." | "{x}% of the backfield's weighted opportunities, {y}% of the backs' red-zone carries + targets and {n} carries inside the 10." | Data |
| otherwise | "A shared backfield." | "{x}% of the weighted opportunities means another back takes a real cut every week, so his weekly volume depends on how that split breaks." | Derived |

**WR / TE** (first match wins):

| Rule | Thesis | Sentence | Type |
|---|---|---|---|
| Air-yards share 30%+ and target share 20%+ | "The alpha profile, fully formed." | "A {x}% air-yards share is an alpha-level share of downfield opportunity, a {y}% first-read share shows he's regularly the first option, and his targets have averaged {z} air yards." | Data |
| Target share up 4+ points, confirmed | "The role is arriving before the box score does." | "His target share has run {a} -> {b} -> {c} over the last 3 games[, with a {x}% first-read share showing he's increasingly being featured as the first option, if 20%+]. If the usage holds, his season totals understate his current role." | Data + derived |
| aDOT 13+ and target share under 15% | "Deep on average, small share." | "His targets have come far downfield on average ({x}-yard aDOT), but he has only {y}% of team targets; {n} of his {t} were 20+ yards downfield[, and a {z}% first-read share means he's rarely the first option, if under 12%]. The low target share limits the value of that downfield role." | Data + derived |
| aDOT 7 or under and air-yards share under 20% | "The ceiling problem in two numbers: ..." | aDOT under 6: "His targets are concentrated close to the line of scrimmage on average"; 6-7: "He is being used primarily in the short area, with a {x}-yard aDOT"; then ", so his yardage leans on what he gains after the catch[ - and the share itself is the one drifting down]." | Data + derived |
| Target share under 12% | "Not enough of the pie." | "A {x}% target share is a small slice of the team's targets, and a {y}% first-read share says he's rarely the first option. A role expansion or an injury to one of the team's higher-volume target earners is the clearest path to more targets." | Data + opinion |
| otherwise | "Volume you can set in the lineup." (20%+) / "A starter's share without the alpha tag." | "A {x}% target share and {y} expected points a game, with a {z}% first-read share and a {w}% air-yards share." | Data |

**Table captions:** WOPR = 1.5 x target share + 0.7 x air-yards share. WR:
0.60+ "elite", 0.45+ "strong - elite at 0.60", 0.30+ "flex range", else "below
startable". TE: 0.45 / 0.35 / 0.25 for "elite for TE" / "strong for TE" /
"streamer range". Tiers: WR/TE by target share 20 / 17 / 15%; RB1 by share of
weighted opps 65 / 50 / 40% (or 15 / 12 per active game); other backs 35%+
Volatile, else Stash; QB by xFP rank 8 / 16. These cut-offs are house
conventions, not measured breakpoints.

## Signal cards

No disclaimer line above the cards (removed 2026-10-03 at mak's request). QBs and Stash-tier players are
never picked. "Confirmed" = the latest week is within 1 point of the
best (or worst) earlier week in the last three. Deltas run from Week 1 through
Week 4, then from three games back.

| Card | Who | Sentence |
|---|---|---|
| Buy low (role) | Not Set & Forget; target share up 3+ (confirmed) or snaps up 10+ (confirmed), share not down 2+; biggest gain wins | "The role is arriving before the box score does. Trade for him this week - not after the two-touchdown game makes it obvious to your league." |
| Buy low (points), only if no role riser | FPOE -2 or worse per game on 9+ xFP per game | "The volume is there and the points aren't - yet. {xfp} expected points a game against {fp} actual is a gap worth investigating - if the role holds, it's a potential regression signal. Check why before you trade for him." |
| Sell high | WR/TE, not Set & Forget, share down 3+ (confirmed), and 12%+ share or +3 FPOE | "Season totals still read like a starter, but the share is drifting the wrong way three straight weeks / just fell to a season low / is moving the wrong way. Name value currently exceeds trajectory." |
| Watch | WR/TE under 12% whose share or snaps are falling (confirmed); lowest share wins | "Under {x}% target share on a shrinking/flat snap count. One more quiet week and he's droppable in 12-team leagues. A role expansion - or an injury to one of the team's higher-volume target earners - is the clearest path back to consistent targets." |

## Audit history

- 2026-10-03, first pass: "buy signal", "hurry-up snaps", aDOT as the deep
  slice, "pocket passer", plus PROE, plays-per-game, red-zone pass-rate and
  per-active-game labeling fixes.
- 2026-10-03, second pass (the eight that failed the test): red-zone card
  cause-and-effect, "isn't a talent question", the two "best stat" claims, the
  run-game "engine" and "plan", the rushing-QB line built from the team's in-10
  rate, the aDOT "sweet spot", the deep-decoy profile, "travel nowhere". Also
  caught on the way: PROE and plays-per-game notes naming players from team
  rates, "the xFP floor holds", "gets repriced the week it scores", "decides
  how much of that turns into yards", the "floor holds in PPR" heading, and
  "a 11%" grammar (now "an 11%").
