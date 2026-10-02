# Coaching tab — verification checklist

Generated 2026-10-01 from `data/team/coaching_staff_2026.json` (research pass of 2026-10-01).

Every number on the coaching tab is computed from nflverse play-by-play and player
stats — those need no checking. What needs a human pass is the **researched layer**
below: if a career stop's seasons are wrong, real stats get attributed to the wrong
coach, and the reliability rating (HIGH/MEDIUM/LOW) keys off *prior seasons as caller*
and *same scheme family*. The ⚠ items are gaps the research pass itself flagged.

**To sign a team off:** tick its boxes here, then set `"verified": true` on that team
in `coaching_staff_2026.json` and rerun `node scripts/team/buildCoaching.mjs 2026 --force <abbr>`
(the flag passes through to the published entry and survives the daily rebuild).

## Arizona Cardinals (`ari`) — ✅ signed off

- [ ] **Play-caller:** Mike LaFleur (Head coach) — basis: confirmed · _LaFleur will call Arizona's offensive plays. Nathaniel Hackett will assist with the game plan/offensive foundation and provide an experienced sounding board. This is LaFleur's first NFL play-calling role since serving as Jets OC in 2021–22._
- [ ] **Staff names:** HC Mike LaFleur · OC Nathaniel Hackett · DC Nick Rallis
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): Saint Joseph's (IN) OC 2011-12 (college); Davidson OC 2013 (college); NYJ OC 2021-22; ARI HC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Drew Petzing
- [ ] **OC card:** calls plays: no · has called before: yes · _Hackett called plays with Buffalo (2013–14), Jacksonville (mid-2016 through Nov. 2018), Denver (first nine games of 2022) and the Jets (2023 through Week 5 of 2024)_
- [ ] **DC scheme note:** _Multiple-front, disguise-heavy defense featuring split-safety structures and frequent post-snap rotations; Nick Rallis retains continuity from the Jonathan Gannon era_
- [ ] **Coaching tree:** Kyle Shanahan tree
- [ ] ⚠ sameSchemeFamily=true is a broad taxonomy choice rather than a documented equivalence: Petzing comes from the Stefanski/Kubiak wide-zone branch, while LaFleur comes directly through Shanahan/McVay.
- Sources: <https://en.wikipedia.org/wiki/2026_Arizona_Cardinals_season> · <https://en.wikipedia.org/wiki/Mike_LaFleur> · <https://www.thescore.com/nfl/news/3481342/cardinals-la-fleur-wanted-hackett-and-nobody-else-for-oc-role> · <https://www.matchquarters.com/p/arizona-cardinals-defense-disguise-rallis-schematic-survival-build-a-3-4>

## Atlanta Falcons (`atl`) — ✅ signed off

- [ ] **Play-caller:** Tommy Rees (Offensive coordinator) — basis: confirmed · _Kevin Stefanski announced that Rees will call Atlanta's offensive plays in 2026. It continues the arrangement Cleveland used beginning in Week 10 of 2025, when Rees took over play-calling from Stefanski._
- [ ] **Staff names:** HC Kevin Stefanski · OC Tommy Rees · DC Jeff Ulbrich
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): Notre Dame OC 2020-22 (college); Alabama OC 2023 (college); CLE OC 2025 (play-caller Wk 10 on); ATL OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Zac Robinson
- [ ] **OC card:** calls plays: yes · has called before: yes · _Four college seasons as a primary offensive play-caller — Notre Dame 2020–22 and Alabama 2023 — plus Cleveland from Week 10 through the end of 2025_
- [ ] **DC scheme note:** _Aggressive, blitz-heavy defense featuring varied pressure presentations and mixed coverages — Atlanta finished second in the NFL in blitz rate in 2025; Jeff Ulbrich was retained for 2026_
- [ ] **Coaching tree:** Stefanski / Browns, broadly within the Kubiak-Shanahan wide-zone family
- [ ] ⚠ sameSchemeFamily=true is a broad-family judgment: Zac Robinson comes from the McVay/Rams branch, while Rees' current NFL system was built with Stefanski in Cleveland. They share wide-zone/Shanahan-family roots but should not be treated as identical systems.
- [ ] ⚠ Rees was Cleveland's OC for all of 2025 but only called plays beginning in Week 10; the CLE 2025 stop carries fromWeek:10, so its page rows (dossier ppg/rank, finishes, distribution, backfield) are computed over Weeks 10+ only, ranked against the league over the same span.
- Sources: <https://en.wikipedia.org/wiki/2026_Atlanta_Falcons_season> · <https://www.atlantafalcons.com/news/tommy-rees-offensive-play-caller-kevin-stefanski> · <https://en.wikipedia.org/wiki/Tommy_Rees_(American_football)>

## Baltimore Ravens (`bal`) — ✅ signed off

- [ ] **Play-caller:** Declan Doyle (Offensive coordinator) — basis: confirmed · _Baltimore hired Doyle with play-calling responsibility after Ben Johnson handled those duties while Doyle was Chicago's OC in 2025. Doyle is calling from the booth and 2026 is his first primary game-day play-calling job, at 29._
- [ ] **Staff names:** HC Jesse Minter · OC Declan Doyle · DC Anthony Weaver
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): BAL OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Todd Monken
- [ ] **OC card:** calls plays: yes · has called before: no · _2026 is Doyle's first primary game-day play-calling job; Baltimore described his preseason opener as his play-calling debut_
- [ ] **DC scheme note:** _Minter calls the defensive plays in his multiple, disguise-heavy system. Weaver serves as the non-play-calling defensive coordinator, bringing extensive front-seven/D-line expertise while contributing to the entire defensive plan_
- [ ] **Coaching tree:** Sean Payton lineage / Ben Johnson influence
- [ ] ⚠ sameSchemeFamily=false is a classification judgment: Doyle comes primarily from the Payton offense with a season under Ben Johnson, while Monken's background and Baltimore system represent a different offensive lineage.
- Sources: <https://en.wikipedia.org/wiki/2026_Baltimore_Ravens_season> · <https://en.wikipedia.org/wiki/Declan_Doyle> · <https://www.baltimoreravens.com/news/declan-doyle-ravens-offense-vision-lamar-jackson-play-caller>

## Buffalo Bills (`buf`) — ✅ signed off

- [ ] **Play-caller:** Joe Brady (Head coach) — basis: confirmed · _Promoted from offensive coordinator to head coach and explicitly said he plans to continue calling Buffalo's offensive plays from the sideline._
- [ ] **Staff names:** HC Joe Brady · OC Pete Carmichael Jr. · DC Jim Leonhard
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): LSU Pass-game coordinator 2019 (college); CAR OC 2020-21; BUF interim OC 2023 (play-caller Wk 11 on); BUF OC 2024-25; BUF HC 2026
- [ ] **Reliability inputs:** 2 prior season(s) as caller here · same scheme family: yes · 2025 caller: Joe Brady
- [ ] **OC card:** calls plays: no · has called before: yes · _Saints OC 2009–23; primary play-caller after Sean Payton's 2011 injury, throughout Payton's 2012 suspension, for much of 2016, in spot duty during Payton's 2021 absence, and as the primary caller under Dennis Allen in 2022–23_
- [ ] **DC scheme note:** _Aggressive, pressure-oriented 3-4 with multiple fronts, flexible safety deployment and disguise; Leonhard has emphasized an attacking identity_
- [ ] **Coaching tree:** Saints / Sean Payton lineage
- [ ] ⚠ priorSeasonsAsCaller=2 counts full seasons (2024, 2025); the partial 2023 interim stretch is carried separately as a windowed stop (fromWeek 11, final nine games incl. playoffs per the Bills' bio).
- [ ] ⚠ Carmichael's 2016 was 'the majority of plays' per Payton and his 2021 was spot duty during Payton's absence — neither is a clean full-season calling year.
- Sources: <https://en.wikipedia.org/wiki/2026_Buffalo_Bills_season>

## Carolina Panthers (`car`) — ✅ signed off

- [ ] **Play-caller:** Brad Idzik (Offensive coordinator) — basis: confirmed · _Dave Canales handed Idzik play-calling duties in February 2026 so Canales could devote more attention to the entire team. This is Idzik's first primary regular-season play-calling role, though he had previously called preseason games — and he has worked alongside Canales since 2019, spanning Seattle, Tampa Bay and Carolina._
- [ ] **Staff names:** HC Dave Canales · OC Brad Idzik · DC Ejiro Evero
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): CAR OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Dave Canales
- [ ] **OC card:** calls plays: yes · has called before: no · _2026 is Idzik's first primary regular-season calling role (he had previously called preseason games), age 34; he and Canales have worked together continuously since 2019 across Seattle, Tampa Bay and Carolina_
- [ ] **DC scheme note:** _Fangio-tree, multiple 3-4 defense using varied safety structures, zone-match concepts and disguised pressure; Carolina still identifies Evero's defense as a 3-4 in 2026_
- [ ] **Coaching tree:** Pete Carroll/Seattle → Dave Canales
- [ ] ⚠ The broad Evero 3-4/Fangio structure is confirmed for 2026; finer coverage and pressure labels are schematic classifications based on his established system and recent Carolina usage rather than a published 2026 tendency breakdown.
- [ ] ⚠ ocHasCalledPlaysBefore=false uses the primary/regular-season convention: Idzik had called preseason games before 2026, noted in the ocNote.
- Sources: <https://en.wikipedia.org/wiki/2026_Carolina_Panthers_season> · <https://wtop.com/nfl/2026/02/panthers-coach-dave-canales-hands-over-offensive-play-calling-duties-to-coordinator-brad-idzik/> · <https://en.wikipedia.org/wiki/Brad_Idzik>

## Chicago Bears (`chi`) — ✅ signed off

- [ ] **Play-caller:** Ben Johnson (Head coach) — basis: confirmed · _Johnson remains Chicago's offensive play-caller in 2026. Press Taylor was promoted to OC as Johnson's organizational and game-planning extension after Declan Doyle left for Baltimore for a role that added play-calling responsibility._
- [ ] **Staff names:** HC Ben Johnson · OC Press Taylor · DC Dennis Allen
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): DET OC 2022-24; CHI HC 2025-26
- [ ] **Reliability inputs:** 1 prior season(s) as caller here · same scheme family: yes · 2025 caller: Ben Johnson
- [ ] **OC card:** calls plays: no · has called before: yes · _Taylor called second halves for Jacksonville in 2022, became the full-time primary caller in 2023 and retained the role entering 2024 under Doug Pederson_
- [ ] **DC scheme note:** _Aggressive, multiple-front defense featuring frequent nickel personnel, man/match-zone concepts and varied pressure packages; broadly carries Allen's New Orleans defensive DNA_
- [ ] **Coaching tree:** Dan Campbell / Lions lineage, with earlier Miami roots; his own motion- and formation-heavy system
- [ ] ⚠ 2021 is not attributed to Johnson as a play-calling season: Dan Campbell took over Detroit's play-calling mid-season while Johnson was elevated to pass-game coordinator. Detroit promoted him to OC in February 2022.
- Sources: <https://en.wikipedia.org/wiki/2026_Chicago_Bears_season> · <https://www.chicagobears.com/news/press-taylor-excited-for-new-opportunity-as-bears-offensive-coordinator> · <https://amp.nfl.com/news/jaguars-oc-press-taylor-to-debut-as-new-full-time-play-caller-in-2023>

## Cincinnati Bengals (`cin`) — ✅ signed off

- [ ] **Play-caller:** Zac Taylor (Head coach) — basis: confirmed · _Taylor retained Cincinnati's offensive play-calling duties in 2026. Offensive coordinator Dan Pitcher received a preseason play-calling opportunity against Chicago on Aug. 22, but Taylor remains the primary regular-season caller._
- [ ] **Staff names:** HC Zac Taylor · OC Dan Pitcher · DC Al Golden
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): CIN HC 2019-26
- [ ] **Reliability inputs:** 7 prior season(s) as caller here · same scheme family: yes · 2025 caller: Zac Taylor
- [ ] **OC card:** calls plays: no · has called before: no · _11th season on Cincinnati's staff and third as OC; no primary regular-season play-calling experience, but he called the Aug. 22, 2026 preseason game against Chicago_
- [ ] **DC scheme note:** _Multiple-front defense with a pressure-oriented philosophy. Cincinnati finished last in NFL blitz rate in 2025 at 16.6%, but Golden expanded blitzes, simulated pressures and line movement after the bye and indicated that late-season aggression would be a baseline going forward_
- [ ] **Coaching tree:** Sean McVay / Rams tree
- [ ] ⚠ Taylor's 2019-25 continuity is well supported by career-long reporting (primary caller since becoming HC in 2019), though no single source enumerates all seven prior seasons.
- [ ] ⚠ ocHasCalledPlaysBefore=false uses the primary/regular-season convention (as with CAR/Idzik): Pitcher's Aug. 22, 2026 preseason call is noted in the ocNote.
- Sources: <https://en.wikipedia.org/wiki/2026_Cincinnati_Bengals_season> · <https://digital-dev.nbc4i.com/sports/sports-illustrated/arena-nfl/si-cincinnati-bengals-nfl/2f72b96f/bengals-coach-zac-taylor-clarifies-play-calling-comment-about-o-c-dan-pitcher-and-being-open-to-it> · <https://fantasynerds.com/news/story/2026/08/24/bengals-oc-dan-pitcher-calls-plays-in-preseason-earning-praise-from-zac-taylor-1604447>

## Cleveland Browns (`cle`) — ✅ signed off

- [ ] **Play-caller:** Todd Monken (Head coach) — basis: confirmed · _Monken calls Cleveland's offensive plays as head coach after three seasons as Baltimore's offensive coordinator/play-caller. Travis Switzer serves as OC in a supporting role after working as Baltimore's run-game coordinator from 2023–25._
- [ ] **Staff names:** HC Todd Monken · OC Travis Switzer · DC Mike Rutenberg
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): Southern Miss HC 2013-14 (college); TB OC 2018; Georgia OC 2020-22 (college); BAL OC 2023-25; CLE HC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Kevin Stefanski (Wks 1-9), then Tommy Rees from Week 10
- [ ] **OC card:** calls plays: no · has called before: no · _Spent nine seasons on Baltimore's staff, including 2023–25 as run-game coordinator, when the Ravens led the NFL in rushing yards per game and yards per carry. Cleveland is his first OC job, and no primary play-calling experience is documented_
- [ ] **DC scheme note:** _Attacking four-down front retaining core Jim Schwartz principles while adding more secondary disguise, coverage variation and pressure multiplicity; Rutenberg is a first-time NFL defensive coordinator_
- [ ] **Coaching tree:** Spread/Air Raid-influenced offensive background, adapted through Georgia and Baltimore into a multiple NFL system
- [ ] ⚠ Monken was Tampa Bay OC from 2016–18, but Dirk Koetter retained play-calling in 2016–17. Monken was the primary caller in 2018 except for a one-game interruption when Koetter briefly reclaimed the role (Week 10 vs Washington, Nov. 11).
- [ ] ⚠ Southern Miss 2015 is excluded from the calling stops: Monken was still head coach but delegated offensive play-calling to OC Chip Lindsey.
- [ ] ⚠ Monken was Cleveland's OC in 2019, but Freddie Kitchens called the plays, so 2019 is not a calling season.
- [ ] ⚠ sameSchemeFamily=false is a classification judgment contrasting the Stefanski/Rees wide-zone lineage with Monken's spread/Air Raid-influenced system.
- Sources: <https://en.wikipedia.org/wiki/2026_Cleveland_Browns_season> · <https://digital-dev.nbc4i.com/sports/sports-illustrated/arena-nfl/si-cleveland-browns-nfl/17c61e50/browns-head-coach-todd-monken-reveals-who-will-be-calling-plays-on-offense> · <https://wtop.com/baltimore-ravens/2026/02/browns-tab-travis-switzer-as-oc-mike-rutenberg-as-dc-and-byron-storer-as-special-teams-coordinator/> · <https://www.clevelandbrowns.com/news/browns-name-coordinators-for-the-2026-coaching-staff> · <https://www.clevelandbrowns.com/news/denzel-boston-excels-with-big-receiving-day-against-the-buccaneers-players-of-the-game> · <https://www.clevelandbrowns.com/team/coaches-roster/travis-switzer> · <https://www.clevelandbrowns.com/team/coaches-roster/mike-rutenberg> · <https://www.clevelandbrowns.com/news/browns-defense-looking-to-build-on-turnover-focused-mindset-in-2026> · <https://www.clevelandbrowns.com/news/browns-complete-2nd-head-coach-interview-with-ravens-offensive-coordinator-todd-monken> · <https://www.si.com/college/2015/11/03/lsu-tigers-defensive-end-lewis-neal-steps-big-way> · <https://georgiadogs.com/sports/football/roster/coaches/todd-monken/3089> · <https://www.nfl.com/news/dirk-koetter-i-have-my-own-reasons-for-calling-plays-0ap3000000987020> · <https://www.buccaneers.com/news/koetter-contemplates-play-calling-options-18384135> · <https://www.nfl.com/news/freddie-kitchens-not-considering-giving-up-play-calling-0ap3000001058415>

## Dallas Cowboys (`dal`) — ✅ signed off

- [ ] **Play-caller:** Brian Schottenheimer (Head coach) — basis: confirmed · _Schottenheimer remains Dallas' offensive play-caller in 2026 after handling the role throughout 2025. Klayton Adams assists with weekly game-plan construction rather than calling plays._
- [ ] **Staff names:** HC Brian Schottenheimer · OC Klayton Adams · DC Christian Parker
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): NYJ OC 2006-11; STL OC 2012-14; Georgia OC 2015 (college); SEA OC 2018-20; JAX Pass-game coordinator 2021 (play-caller Wks 16-18); DAL HC 2025-26
- [ ] **Reliability inputs:** 1 prior season(s) as caller here · same scheme family: yes · 2025 caller: Brian Schottenheimer
- [ ] **OC card:** calls plays: no · has called before: no · _OL/run-game-heavy background; Colorado co-OC in 2018, but Darrin Chiaverini handled play-calling. Dallas is Adams' first NFL OC job, with Schottenheimer retaining the headset_
- [ ] **DC scheme note:** _Multiple Fangio-tree defense: 3-4 by nature, with 4-3 spacing, 4-2-5 nickel packages and varied front/coverage structures; Parker is a first-time defensive coordinator_
- [ ] **Coaching tree:** Schottenheimer family; run-game/play-action-oriented pro-style offense with West Coast influences
- [ ] ⚠ Schottenheimer also called Jacksonville's final three games of 2021 (Weeks 16-18, after Urban Meyer's firing, under interim HC Darrell Bevell); the JAX 2021 stop carries fromWeek:16, so its page rows are computed over Weeks 16+ only, separate from his full-season coordinator stops.
- Sources: <https://en.wikipedia.org/wiki/2026_Dallas_Cowboys_season> · <https://www.dallascowboys.com/news/no-8-how-does-schotty-evolve-in-year-2> · <https://www.dmagazine.com/sports/2025/02/brian-schottenheimer-playcaller-cowboys-offense/> · <https://www.dallascowboys.com/news/klayton-adams-opens-up-on-working-with-schottenheimer-offensive-identity-more> · <https://www.dallascowboys.com/news/klayton-adams-looking-to-seek-the-edge-for-cowboys-offense> · <https://www.dallascowboys.com/news/brian-schottenheimer-candid-on-cowboys-offensive-plan-blueprint-in-2025-and-beyond> · <https://www.dallascowboys.com/news/christian-parker-outlines-vision-for-cowboys-defense-in-2026-and-beyond> · <https://www.dallascowboys.com/news/official-2026-cowboys-defensive-coordinator-candidate-tracker> · <https://www.jaguars.com/news/bevell-on-monday-schottenheimer-to-call-plays> · <https://www.espn.com/nfl/story/_/id/32911473/jacksonville-jaguars-interim-head-coach-darrell-bevell-hands-play-calling-responsibilities-brian-schottenheimer> · <https://cubuffs.com/news/2017/12/5/football-klayton-adams-promoted-to-co-coordinator> · <https://cubuffs.com/news/2018/8/30/football-buffs-aim-for-fast-start-to-2018-in-opener-against-rams> · <https://www.seahawks.com/news/friday-round-up-brian-schottenheimer-reviews-the-seahawks-offense> · <https://georgiadogs.com/news/2015/9/24/UGA_QB_Most_Demanding_Role_In_the_State> · <https://www.nfl.com/news/schottenheimer-under-pressure-to-ignite-rams-offense-0ap2000000356419> · <https://www.espn.com/nfl/story/_/id/46137832/nfl-playcallers-32-teams-mike-mcdaniel-sean-mcvay-brian-schottenheimer>

## Denver Broncos (`den`) — ✅ signed off

- [ ] **Play-caller:** Davis Webb (Offensive coordinator) — basis: confirmed · _Sean Payton announced at the 2026 NFL Combine that Webb would become Denver's primary offensive play-caller — an unusual handoff after Payton called plays himself for most of his head-coaching career. Payton remains heavily involved in the offense and said he may still call some plays._
- [ ] **Staff names:** HC Sean Payton · OC Davis Webb · DC Vance Joseph
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): DEN OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Sean Payton
- [ ] **OC card:** calls plays: yes · has called before: no · _2026 is Webb's first primary regular-season calling role (he called a Denver preseason game in 2025), age 31 at his promotion; spent his first three coaching seasons entirely under Payton and played a major role in Bo Nix's development_
- [ ] **DC scheme note:** _Aggressive 3-4 pressure defense featuring mugged fronts, double-A-gap looks, simulated pressures and coverage disguise. Joseph still blitzes at an above-average rate, but Denver increasingly generates pressure with four; the Broncos recorded 68 sacks in 2025_
- [ ] **Coaching tree:** Sean Payton tree — Webb's entire coaching career has been spent in Payton's Denver offense
- [ ] ⚠ The Webb handoff is an unusual departure from Payton's normal practice of calling his own offense, but no source establishes it as the first-ever full-time delegation of Payton's head-coaching career, so the page does not claim that.
- [ ] ⚠ ocHasCalledPlaysBefore=false uses the primary/regular-season convention (as with CAR/Idzik and CIN/Pitcher): Webb's 2025 preseason game is noted in the ocNote.
- [ ] ⚠ No explicit in-season confirmation that Webb still holds play-calling, but no reporting of any change was found.
- Sources: <https://en.wikipedia.org/wiki/2026_Denver_Broncos_season> · <https://amp.nfl.com/news/broncos-coach-sean-payton-handing-play-calling-duties-to-new-oc-davis-webb> · <https://wtop.com/nfl/2026/02/a-rare-handoff-for-sean-payton-as-davis-webb-takes-over-broncos-play-calling/> · <https://www.denverbroncos.com/news/i-wouldn-t-do-it-if-i-didn-t-think-it-was-going-to-help-our-team-win-hc-sean-payton-announces-oc-davis-webb-to-call-plays-for-broncos-offense> · <https://www.nfl.com/news/broncos-coach-sean-payton-handing-play-calling-duties-to-new-oc-davis-webb> · <https://www.denverbroncos.com/news/broncos-announce-updates-to-2026-coaching-staff> · <https://www.denverbroncos.com/team/coaches-roster/davis-webb> · <https://www.denverbroncos.com/news/davis-webb-blessed-and-thankful-to-have-hc-sean-payton-as-resource-entering-first-season-as-broncos-oc> · <https://www.nfl.com/news/2026-nfl-head-coach-hiring-cycle-24-young-candidates-to-know> · <https://www.nfl.com/news/scariest-nfl-defenders-to-block-in-2025-ranking-the-top-five-right-now> · <https://www.denverbroncos.com/news/i-ve-been-proud-to-watch-them-play-broncos-look-to-carry-early-season-defensive-success-into-week-4-matchup-vs-jets> · <https://www.nfl.com/news/zach-allen-expects-broncos-to-break-team-record-for-sacks-in-2026>

## Detroit Lions (`det`) — ✅ signed off

- [ ] **Play-caller:** Drew Petzing (Offensive coordinator) — basis: confirmed · _Detroit hired Petzing as its new offensive coordinator and play-caller after Dan Campbell handled play-calling from Week 10 onward in 2025. Campbell handed Petzing control of the offense for 2026._
- [ ] **Staff names:** HC Dan Campbell · OC Drew Petzing · DC Kelvin Sheppard
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): ARI OC 2023-25; DET OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: John Morton (Wks 1-9), then Dan Campbell from Week 10
- [ ] **OC card:** calls plays: yes · has called before: yes · _Arizona's primary offensive play-caller 2023-25, building one of the NFL's strongest rushing attacks (5.3 yards per carry in 2024); third Lions OC in three years_
- [ ] **DC scheme note:** _Historically man-heavy and physical against the run, but more multiple in 2026: Detroit expanded its nickel packages after leading the NFL in base-defense usage in 2025 and has opened 2026 playing 76.9% zone, a significant shift aimed at limiting explosive plays_
- [ ] **Coaching tree:** Stefanski / Kubiak-Shanahan wide-zone family
- [ ] ⚠ sameSchemeFamily=false is a classification judgment: Petzing comes from the Stefanski/Kubiak-Shanahan branch, while Detroit's 2025 offense retained the Ben Johnson/Campbell system even after Campbell assumed play-calling.
- Sources: <https://en.wikipedia.org/wiki/2026_Detroit_Lions_season> · <https://www.espn.com/nfl/story/_/id/47662766/sources-lions-finalizing-deal-hire-drew-petzing-new-oc> · <https://en.wikipedia.org/wiki/Drew_Petzing> · <https://www.detroitlions.com/news/lions-announce-2026-coaching-staff> · <https://www.detroitlions.com/news/lions-hire-drew-petzing-as-offensive-coordinator> · <https://www.detroitlions.com/team/coaches-roster/drew-petzing> · <https://www.detroitlions.com/news/goff-on-working-with-new-oc-petzing-it-s-been-awesome> · <https://www.detroitlions.com/news/goff-talks-new-offense-under-petzing-williams-development-more> · <https://www.detroitlions.com/news/notebook-campbell-calls-plays-in-lions-win-over-commanders> · <https://www.detroitlions.com/news/2025-position-breakdown-quarterbacks-goff-allen> · <https://www.detroitlions.com/news/5-things-to-watch-2026-detroit-lions-otas-petzing-miller-sewell> · <https://www.azcardinals.com/news/kyler-murray-is-job-one-for-offensive-coordinator-drew-petzing> · <https://www.azcardinals.com/news/offensive-coordinator-drew-petzing-does-some-self-analysis> · <https://www.azcardinals.com/news/cardinals-offense-can-sense-benefits-of-continuity-during-otas> · <https://www.azcardinals.com/news/colt-mccoy-gaining-comfort-in-new-playbook> · <https://www.detroitlions.com/news/5-takeaways-detroit-lions-dc-kelvin-sheppard-media-session-wonnum-mcneill-> · <https://www.detroitlions.com/news/lions-looking-to-make-defense-more-versatile-adaptable> · <https://www.detroitlions.com/news/10-takeaways-from-petzing-sheppard-fipp-scruggs-rakestraw-saylors-vaki> · <https://www.detroitlions.com/news/5-things-to-watch-2026-detroit-lions-training-camp-goff-miller-rolder-joseph-reed-moore>

## Green Bay Packers (`gb`) — ✅ signed off

- [ ] **Play-caller:** Matt LaFleur (Head coach) — basis: confirmed · _LaFleur remains Green Bay's offensive play-caller in 2026. Adam Stenavich continues in a non-play-calling coordinator/support role._
- [ ] **Staff names:** HC Matt LaFleur · OC Adam Stenavich · DC Jonathan Gannon
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): TEN OC 2018; GB HC 2019-26
- [ ] **Reliability inputs:** 7 prior season(s) as caller here · same scheme family: yes · 2025 caller: Matt LaFleur
- [ ] **OC card:** calls plays: no · has called before: no · _Green Bay's OC since 2022 after rising from offensive line and run-game roles; supports offensive planning and coordination but has no documented primary game-day play-calling experience_
- [ ] **DC scheme note:** _New, personnel-driven Gannon system for 2026: 3-4 base principles with significant nickel/three-safety usage, extensive coverage disguise and varied pressure looks, emphasizing speed, physicality and takeaways_
- [ ] **Coaching tree:** Shanahan / McVay tree
- [ ] ⚠ priorSeasonsAsCaller=7 is well supported by LaFleur's continuous Green Bay tenure and current 2026 identification as the offensive play-caller, even though no single source enumerates all seven prior seasons individually.
- Sources: <https://en.wikipedia.org/wiki/2026_Green_Bay_Packers_season> · <https://www.acmepackingcompany.com/green-bay-packers-news/80992/green-bay-packers-officially-announce-full-2026-coaching-staff> · <https://www.packers.com/news/jonathan-gannon-building-new-system-for-packers-defense-2026> · <https://www.packers.com/news/5-things-learned-from-matt-lafleur-at-the-2026-nfl-annual-meeting-march-30> · <https://www.packers.com/team/coaches-roster/> · <https://www.packers.com/team/coaches-roster/matt-lafleur> · <https://www.packers.com/team/coaches-roster/adam-stenavich> · <https://www.packers.com/news/packers-promote-adam-stenavich-to-offensive-coordinator> · <https://www.packers.com/news/jeff-hafley-is-forever-grateful-for-matt-lafleur-s-faith-in-him-april-6-2026> · <https://www.packers.com/news/5-things-to-know-about-new-packers-defensive-coordinator-jonathan-gannon-2-2-2026> · <https://www.packers.com/news/pre-draft-picture-it-s-a-new-day-on-packers-defensive-line-april-20-2026> · <https://www.packers.com/news/5-things-learned-at-packers-training-camp-july-30-2026> · <https://www.packers.com/news/5-things-learned-at-packers-training-camp-aug-4-2026> · <https://www.nfl.com/news/aaron-rodgers-matt-lafleur-navigating-new-packers-partnership-0ap3000001033990>

## Houston Texans (`hou`) — ✅ signed off

- [ ] **Play-caller:** Nick Caley (Offensive coordinator) — basis: confirmed · _Caley returned as Houston's offensive play-caller for 2026 after his first season in the role in 2025. Houston retained him to build on the progress made during Year 1 rather than install another new offense._
- [ ] **Staff names:** HC DeMeco Ryans · OC Nick Caley · DC Matt Burke
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): HOU OC 2025-26
- [ ] **Reliability inputs:** 1 prior season(s) as caller here · same scheme family: yes · 2025 caller: Nick Caley
- [ ] **OC card:** calls plays: yes · has called before: yes · _Houston is his only primary play-calling stop; 2026 is his second season as a caller after assistant/coordinator roles with New England and the Rams_
- [ ] **DC scheme note:** _Burke calls the defense within DeMeco Ryans' established system. Houston finished 1st in total defense and 2nd in scoring defense in 2025, while ranking 4th against the run, 6th against the pass and tied for 3rd in takeaways_
- [ ] **Coaching tree:** Patriots/McDaniels roots with recent McVay/Rams influence
- [ ] ⚠ Burke took over defensive play-calling from Ryans beginning in Week 4 of 2025; the underlying defensive scheme/philosophy remained largely continuous.
- Sources: <https://en.wikipedia.org/wiki/2026_Houston_Texans_season> · <https://gmg-kprc-prod.cdn.arcpublishing.com/sports/2026/01/21/why-texans-offensive-coodinator-nick-caley-is-returning-as-play-caller-team-saw-growth-progress> · <https://en.wikipedia.org/wiki/Nick_Caley> · <https://www.houstontexans.com/news/houston-texans-announce-2026-coaching-staff> · <https://www.houstontexans.com/team/coaches-roster/nick-caley> · <https://www.houstontexans.com/team/coaches-roster/matt-burke> · <https://www.houstonchronicle.com/sports/texans/article/houston-matt-burke-calling-plays-21080360.php> · <https://www.houstonchronicle.com/sports/texans/article/matt-burke-playcalling-demeco-ryans-21072659.php> · <https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/nick-caserio-anticipates-nick-caley-returning-as-texans-offensive-coordinator> · <https://abc13.com/post/cj-stroud-confident-ahead-biggest-season-life/19801607/>

## Indianapolis Colts (`ind`) — ✅ signed off

- [ ] **Play-caller:** Shane Steichen (Head coach) — basis: confirmed · _Steichen remains Indianapolis' offensive play-caller in 2026; Colts coverage at the 2026 Combine explicitly describes him as continuing to develop as a head coach and play caller._
- [ ] **Staff names:** HC Shane Steichen · OC Jim Bob Cooter · DC Lou Anarumo
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): LAC OC 2019 (play-caller Wk 9 on); LAC OC 2020; PHI OC 2021 (play-caller Wk 8 on); PHI OC 2022; IND HC 2023-26
- [ ] **Reliability inputs:** 3 prior season(s) as caller here · same scheme family: yes · 2025 caller: Shane Steichen
- [ ] **OC card:** calls plays: no · has called before: yes · _Became Detroit's offensive coordinator/play-caller during the 2015 season and remained the primary caller through 2018; interviewed for Philadelphia's vacant OC job in January 2026 but remained with Indianapolis_
- [ ] **DC scheme note:** _Multiple, disguise-heavy defense with varied coverage structures, a DB-oriented foundation and moderate, matchup-dependent blitz usage (28.6% of dropbacks with the Bengals 2019-24, 18th in the NFL); Anarumo spent six seasons as Cincinnati's DC before joining Indianapolis in 2025_
- [ ] **Coaching tree:** Norv Turner / Sirianni lineage
- [ ] ⚠ Steichen's 2019 Chargers and 2021 Eagles play-calling seasons were partial-season takeovers. LAC 2019 carries fromWeek:9 (first called game: vs Green Bay, Nov. 3, after Whisenhunt's firing); PHI 2021 carries fromWeek:8 (Gannon: the switch came after the Week 7 loss at Las Vegas). Their page rows are computed over those weeks only.
- [ ] ⚠ The PHI 2021 start week rests on Jonathan Gannon's 2023 recollection; Eagles sources only say 'midseason'.
- Sources: <https://en.wikipedia.org/wiki/2026_Indianapolis_Colts_season> · <https://1075thefan.com/539352/shane-steichen-will-continue-to-call-colts-play/> · <https://en.wikipedia.org/wiki/Shane_Steichen> · <https://www.colts.com/video/one-on-one-with-shane-steichen-at-the-2026-nfl-combine-daniel-jones-alec-pierce-anthony-richardson-riley-leonard-lou-anarumo> · <https://www.colts.com/team/coaches-roster/shane-steichen> · <https://www.chargers.com/news/shane-steichen-assumes-offensive-play-calling-qb-coach> · <https://www.chargers.com/news/los-angeles-chargers-announce-changes-additions-to-coaching-staff> · <https://www.philadelphiaeagles.com/news/shane-steichen-playcalling-duties-aj-brown-jalen-hurts> · <https://www.philadelphiaeagles.com/audio/episode-351-shane-steichen-calling-plays-in-2022> · <https://www.philadelphiaeagles.com/news/shane-steichen-named-colts-head-coach> · <https://www.colts.com/team/coaches-roster/jim-bob-cooter> · <https://www.nfl.com/news/stafford-goes-gaga-over-jim-bob-cooter-s-play-calling-0ap3000000589136> · <https://www.detroitlions.com/news/cooter-always-looking-for-ways-to-improve-offense-20698959> · <https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle> · <https://www.colts.com/team/coaches-roster/lou-anarumo> · <https://www.colts.com/news/lou-anarumo-blitzes-coverage-schemes-tackling-fixes-new-defensive-coordinator-cincinnati-bengals> · <https://www.colts.com/news/10-colts-things-daniel-jones-colts-offense-seeking-consistency-and-explosiveness-tyler-warren-makes-strong-impression-before-rookie-year-lou-anarumo-s-defense-comes-into-focus-laiatu-latu-showing-signs-of-year-2-jump> · <https://www.colts.com/news/5-colts-things-alec-pierce-s-return-blitzing-lamar-jackson-a-double-edged-sword-snap-counts-from-week-1-loss-to-ravens> · <https://www.nbcsportsphiladelphia.com/nfl/philadelphia-eagles/gannon-says-he-suggested-sirianni-give-up-play-calling-in-2021/534748/>

## Jacksonville Jaguars (`jax`) — ✅ signed off

- [ ] **Play-caller:** Liam Coen (Head coach) — basis: confirmed · _Coen remains Jacksonville's regular-season offensive play-caller in 2026. Grant Udinski handled the first two preseason games as a developmental opportunity, but Jacksonville explicitly identified regular-season play-calling as Coen's role._
- [ ] **Staff names:** HC Liam Coen · OC Grant Udinski · DC Anthony Campanile
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): Maine OC 2016-17 (college); Kentucky OC 2021, 2023 (college); TB OC 2024; JAX HC 2025-26
- [ ] **Reliability inputs:** 1 prior season(s) as caller here · same scheme family: yes · 2025 caller: Liam Coen
- [ ] **OC card:** calls plays: no · has called before: no · _Udinski, 30, has no regular-season primary play-calling experience. He called Jacksonville's first two 2026 preseason games; Coen and other offensive assistants (Spencer Whipple, John Van Dam) divided the preseason finale_
- [ ] **DC scheme note:** _Multiple, aggressive defense emphasizing physical run play, a zone-oriented secondary and varied coverage shells/pressure packages. Campanile's system shows significant Hafley/Green Bay influence with Flores-style mugged and split-field pressures; Jacksonville led the NFL in run defense and produced 31 takeaways in 2025_
- [ ] **Coaching tree:** McVay tree
- [ ] ⚠ Udinski's preseason play-calling (Preseason Weeks 1-2, 2026) is not a regular-season caller change; Coen remains Jacksonville's primary offensive caller.
- [ ] ⚠ ocHasCalledPlaysBefore=false uses the primary/regular-season convention (as with CAR/Idzik, CIN/Pitcher, DEN/Webb): the preseason games are noted in the ocNote.
- [ ] ⚠ Rams 2022 is deliberately omitted from calling stops: Sean McVay retained regular-season play-calling; Coen's preseason calling there does not count.
- Sources: <https://en.wikipedia.org/wiki/2026_Jacksonville_Jaguars_season> · <https://www.radiobigboy.com/content/2026-07-31-jags-oc-to-call-plays-during-preseason/> · <https://en.wikipedia.org/wiki/Liam_Coen> · <https://www.jaguars.com/news/five-storylines-from-jaguars-2026-preseason-week-1-victory-over-saints> · <https://www.jaguars.com/news/camp-wrap-day-19-defense-continually-elevating> · <https://www.jaguars.com/news/k000589-official-campanile-udinski-to-stay> · <https://www.jaguars.com/team/coaches-roster/liam-coen> · <https://www.jaguars.com/news/k000151-5-things-to-know-about-new-head-coach-liam-coen> · <https://www.jaguars.com/news/k000156-jacksonville-jaguars-agree-to-terms-with-grant-udinski-as-offensive-coordinator> · <https://www.jaguars.com/team/coaches-roster/anthony-campanile> · <https://www.jaguars.com/news/k000147-new-dc-anthony-campanile-ready-for-the-task-ahead-to-lead-jaguars-defense> · <https://www.jaguars.com/news/k000376-jaguars-ready-for-2025-preseason-week-1-starters-playing-new-head-coach-saturday-night-football> · <https://www.matchquarters.com/p/campanile-jaguars-g-read-pressure-broncos> · <https://ukathletics.com/news/2023/01/10/liam-coen-returns-as-uks-offensive-coordinator-quarterbacks-coach/> · <https://www.buccaneers.com/news/bucs-liam-coen-agree-terms-contract-offensive-coordinator-job>

## Kansas City Chiefs (`kc`) — ✅ signed off

- [ ] **Play-caller:** Andy Reid (Head coach) — basis: confirmed · _Reid retained primary offensive play-calling when Eric Bieniemy returned as OC in 2026, saying he still enjoys calling plays while emphasizing collaborative staff input and occasional delegation._
- [ ] **Staff names:** HC Andy Reid · OC Eric Bieniemy · DC Steve Spagnuolo
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): PHI HC 1999-2005; PHI HC 2006 (play-caller Wks 1-8); KC HC 2013-16; KC HC 2017 (play-caller Wks 1-12); KC HC 2018-26
- [ ] **Reliability inputs:** 13 prior season(s) as caller here · same scheme family: yes · 2025 caller: Andy Reid
- [ ] **OC card:** calls plays: no · has called before: yes · _Primary play-caller for Washington in 2023 and UCLA's offensive play-caller in 2024. During his prior Kansas City OC tenure (2018-22) Reid retained primary play-calling; that arrangement resumes in 2026_
- [ ] **DC scheme note:** _Highly multiple, blitz-heavy 4-3-based defense featuring exotic pressure packages, simulated pressures and creative DB involvement from nickel/dime and split-safety structures_
- [ ] **Coaching tree:** West Coast — Walsh/Holmgren tree
- [ ] ⚠ Philadelphia: Reid handed primary play-calling to Marty Mornhinweg after the Week 8 2006 loss to Jacksonville, and Mornhinweg remained heavily involved thereafter. The PHI stops therefore cover 1999-2005 plus 2006 Weeks 1-8 (toWeek:8); 2007-12 are not attributed to Reid as caller.
- [ ] ⚠ Kansas City 2017: Reid called the first 12 weeks, then Matt Nagy called the final six games from Week 13 at the Jets (Dec. 3), including the Wild Card game. The KC 2017 stop carries toWeek:12; priorSeasonsAsCaller stays 13 (seasons with play-calling responsibility), qualified on the page by priorSeasonsNote.
- Sources: <https://en.wikipedia.org/wiki/2026_Kansas_City_Chiefs_season> · <https://atozsports.com/nfl/kansas-city-chiefs-news/chiefs-andy-reid-confirms-suspicions-about-whether-new-offensive-coordinator-eric-bieniemy-will-call-plays-in-2026/> · <https://www.washingtontimes.com/news/2026/jan/23/eric-bieniemy-returns-kansas-city-chiefs-offensive-coordinator/> · <https://www.espn.com/nfl/story/_/id/47770717/kansas-city-chiefs-eric-bieniemy-returns> · <https://www.chiefs.com/team/coaches-roster/> · <https://www.chiefs.com/team/coaches-roster/eric-bieniemy> · <https://www.commanders.com/news/five-things-to-know-about-eric-bieniemy> · <https://uclabruins.com/postgame-quotes-indiana-42-ucla-13> · <https://www.chiefs.com/news/chiefs-oc-matt-nagy-passing-the-test-of-recent-play-calling-duties-20037004> · <https://www.nfl.com/news/andy-reid-gives-chiefs-play-calling-role-to-matt-nagy-0ap3000000886304> · <https://www.nfl.com/news/chiefs-promote-eric-bieniemy-to-offensive-coordinator-0ap3000000904902> · <https://www.nfl.com/_amp/eagles-splash-past-redskins-27-3-09000d5d800580d8> · <https://www.philadelphiaeagles.com/news/offensive-coordinator-marty-mornhinweg-3574296> · <https://www.nfl.com/news/chiefs-have-mastered-art-of-winning-plus-nfl-s-top-five-rivalries-and-chargers-striking-defensive-rebirth> · <https://www.nfl.com/news/the-coverage-that-turned-the-seahawks-into-super-bowl-winners-and-is-taking-the-nfl-by-storm>

## Los Angeles Chargers (`lac`) — ✅ signed off

- [ ] **Play-caller:** Mike McDaniel (Offensive coordinator) — basis: confirmed · _The Chargers hired McDaniel as their offensive play-caller after parting ways with Greg Roman on Jan. 13, 2026. McDaniel previously called Miami's offense throughout his four seasons as Dolphins head coach._
- [ ] **Staff names:** HC Jim Harbaugh · OC Mike McDaniel · DC Chris O'Leary
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): MIA HC 2022-25; LAC OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Greg Roman
- [ ] **OC card:** calls plays: yes · has called before: yes · _Four prior full seasons as Miami's primary offensive play-caller (2022-25); he was 49ers OC in 2021, but Kyle Shanahan retained play-calling_
- [ ] **DC scheme note:** _Minter-derived, multiple defense emphasizing disguise, flexibility and pass-rush packages. O'Leary intends to preserve the existing foundation while evolving it around personnel, including getting multiple pass rushers on the field together. He takes over a unit that ranked 6th in defensive EPA/play and 3rd in points allowed across 2024-25, returning after serving as Chargers safeties coach in 2024 and Western Michigan DC/play-caller in 2025_
- [ ] **Coaching tree:** Kyle Shanahan tree
- [ ] ⚠ sameSchemeFamily=false is a classification judgment: Roman comes from a power/gap-heavy run-game lineage, while McDaniel comes directly from the Shanahan wide-zone/motion tree.
- [ ] ⚠ O'Leary is not technically an internal promotion: he coached for the Chargers in 2024, left for Western Michigan in 2025, then returned as DC in 2026.
- [ ] ⚠ SF 2021 is deliberately omitted from calling stops: McDaniel was 49ers OC but Kyle Shanahan called the plays.
- Sources: <https://en.wikipedia.org/wiki/2026_Los_Angeles_Chargers_season> · <https://wtop.com/nfl/2026/01/mike-mcdaniel-joins-harbaugh-herbert-as-chargers-offensive-coordinator-after-dolphins-firing/> · <https://www.chargers.com/news/mike-mcdaniel-chris-oleary-new-coordinator-2026>

## Los Angeles Rams (`lar`) — ✅ signed off

- [ ] **Play-caller:** Sean McVay (Head coach) — basis: confirmed · _McVay continues as Los Angeles' primary offensive play-caller in 2026, as he has since becoming head coach in 2017. Nate Scheelhaase's promotion to offensive coordinator did not change that arrangement._
- [ ] **Staff names:** HC Sean McVay · OC Nate Scheelhaase · DC Chris Shula
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): LAR HC 2017-26
- [ ] **Reliability inputs:** 9 prior season(s) as caller here · same scheme family: yes · 2025 caller: Sean McVay
- [ ] **OC card:** calls plays: no · has called before: yes · _Called Iowa State's offense in 2023; promoted to Rams OC in 2026 after two seasons on McVay's staff, and has received NFL preseason play-calling opportunities with the Rams, including the 2026 opener against Kansas City. McVay retains regular-season duties_
- [ ] **DC scheme note:** _Highly multiple, adaptable defense featuring extensive dime personnel (32.4% in 2025, the NFL's highest dime rate since the 2023 Cowboys), simulated pressures, stunts and coverage disguise. Shula varies fronts and coverages by opponent while simplifying individual assignments to let players play fast_
- [ ] **Coaching tree:** Head of the Sean McVay tree, with Shanahan/Gruden roots
- [ ] ⚠ priorSeasonsAsCaller=9 assumes uninterrupted primary regular-season calling from 2017-25. That is strongly supported by Rams reporting across McVay's tenure; no regular-season play-calling handoff breaks the sequence.
- [ ] ⚠ Scheelhaase's preseason opportunities demonstrate prior calling experience but are not evidence that McVay is preparing to surrender regular-season duties.
- Sources: <https://www.clickondetroit.com/sports/2026/02/20/rams-promote-nate-scheelhaase-to-offensive-coordinator-ap-source-says/> · <https://abc7.com/post/calls-plays-every-nfl-team-2026-what-know/19783946/> · <https://en.wikipedia.org/wiki/Sean_McVay> · <https://www.therams.com/news/top-takeaways-from-sean-mcvay-s-post-2026-nfl-combine-press-conference-finalized-coaching-staff-pending-free-agents-and-more> · <https://www.therams.com/news/rams-2026-coaching-staff-set> · <https://www.therams.com/team/coaches-roster/> · <https://www.therams.com/video/mcvay-i-will-call-plays-fit-scheme-to-skill-set-of-best-players-18440999> · <https://www.therams.com/news/mcvay-named-pfwa-coach-of-the-year-20269122> · <https://www.therams.com/news/mcvay-kevin-oconnell-has-huge-say-huge-influence-on-how-we-want-to-operate> · <https://www.therams.com/news/rams-stetson-bennett-iv-to-start-2026-preseason-opener-at-chiefs-ty-simpson-will-also-play> · <https://www.therams.com/news/rams-head-coach-sean-mcvay-quarterback-ty-simpson-running-back-dean-connors-win-over-chiefs-in-first-preseason-game-press-conference> · <https://www.therams.com/team/coaches-roster/nate-scheelhaase> · <https://www.therams.com/news/digest-instruct-adapt-rams-dc-chris-shula-took-from-mentors-raheem-morris-brandon-staley-giff-smith-wade-phillips-creating-unique-defensive-structure> · <https://www.therams.com/news/5-interesting-stats-from-the-rams-2025-defense-kobie-turner-elevates-pass-rush-early-success-against-the-run-leads-to-advantageous-third-down-scenarios> · <https://cyclones.com/sports/football/roster/coaches/nate--scheelhaase/1996>

## Las Vegas Raiders (`lv`)

- [ ] **Play-caller:** Klint Kubiak (Head coach) — basis: reported · _Said at his introductory press conference he plans to keep calling plays; ESPN's 2026 play-caller preview lists him as the caller._
- [ ] **Staff names:** HC Klint Kubiak · OC Andrew Janocko · DC Rob Leonard
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): MIN OC 2021; DEN Interim caller 2022 (late); NO OC 2024; SEA OC 2025; LV HC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Chip Kelly (fired in-season 2025; Greg Olson finished)
- [ ] **OC card:** calls plays: no · has called before: no · _Janocko, 37, hired from Seahawks QB coach; first NFL coordinator job, longtime Kubiak lieutenant_
- [ ] **Coaching tree:** Gary Kubiak / Shanahan wide-zone family
- [ ] ⚠ The DEN 2022 stop is a partial-season takeover (from Nov 20), so that season's full Broncos numbers are not his.
- [ ] ⚠ No sourced scheme descriptor for DC Rob Leonard (promoted from DL/run game coordinator).
- Sources: <https://www.clickondetroit.com/sports/2026/02/10/raiders-officially-hire-klint-kubiak-head-coach-after-his-super-bowl-win-with-seahawks/> · <https://en.wikipedia.org/wiki/Klint_Kubiak> · <https://abc7.com/post/calls-plays-every-nfl-team-2026-what-know/19783946/>

## Miami Dolphins (`mia`)

- [ ] **Play-caller:** Bobby Slowik (Offensive coordinator) — basis: reported · _ESPN's 2026 play-caller preview lists Slowik as Miami's caller; Hafley is defense-minded and calls the defense himself._
- [ ] **Staff names:** HC Jeff Hafley · OC Bobby Slowik · DC Sean Duggan
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): HOU OC 2023-24; MIA OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Mike McDaniel
- [ ] **OC card:** calls plays: yes · has called before: yes · _Last called plays as Texans OC 2023-24; scheme is predominantly West Coast, run-heavy_
- [ ] **DC scheme note:** _'Multiple' front — base 4-3 with 3-4 looks mixed in; the scheme is Hafley's and the HC calls the defensive plays_
- [ ] **Coaching tree:** Kyle Shanahan tree (West Coast)
- [ ] ⚠ McDaniel as Miami's 2025 primary caller was not explicitly re-confirmed; treated as the standing arrangement.
- Sources: <https://en.wikipedia.org/wiki/2026_Miami_Dolphins_season> · <https://abc7.com/post/calls-plays-every-nfl-team-2026-what-know/19783946/> · <https://www.local10.com/sports/local/2026/01/24/dolphins-promote-bobby-slowik-to-offensive-coordinator/>

## Minnesota Vikings (`min`)

- [ ] **Play-caller:** Kevin O'Connell (Head coach) — basis: reported · _ESPN's 2026 preview lists O'Connell entering his fifth season calling plays. Phillips called a preseason game and offseason columns urged a handoff — recheck weekly._
- [ ] **Staff names:** HC Kevin O'Connell · OC Wes Phillips · DC Brian Flores
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): MIN HC 2022-26
- [ ] **Reliability inputs:** 4 prior season(s) as caller here · same scheme family: yes · 2025 caller: Kevin O'Connell
- [ ] **OC card:** calls plays: no · has called before: no · _OC since 2022 running the offense during the week without calling plays — the same job O'Connell had under McVay; called the 2026 preseason Broncos game_
- [ ] **DC scheme note:** _Hyper-aggressive pressure scheme: league-high blitz rate from double-mug and split-field looks, backed by heavy zone_
- [ ] **Coaching tree:** McVay / Shanahan tree
- [ ] ⚠ ESPN's preview says O'Connell still calls plays while a preseason mic'd-up piece shows Phillips calling; went with ESPN since preseason delegation is weak evidence, but a quiet handoff cannot be fully ruled out.
- Sources: <https://en.wikipedia.org/wiki/2026_Minnesota_Vikings_season> · <https://abc7.com/post/calls-plays-every-nfl-team-2026-what-know/19783946/> · <https://www.matchquarters.com/p/brian-flores-vikings-all-up-hawk-coverage>

## New England Patriots (`ne`)

- [ ] **Play-caller:** Josh McDaniels (Offensive coordinator) — basis: inferred · _Explicitly the caller in 2025 (2nd-best scoring offense; AP Assistant Coach of the Year) with no 2026 report of any change; Vrabel is a defensive-background HC._
- [ ] **Staff names:** HC Mike Vrabel · OC Josh McDaniels · DC Zak Kuhr
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): NE OC 2005-08; DEN HC 2009-10; NE OC 2012-21; LV HC 2022-23; NE OC 2025-26
- [ ] **Reliability inputs:** 15 prior season(s) as caller here · same scheme family: yes · 2025 caller: Josh McDaniels
- [ ] **OC card:** calls plays: yes · has called before: yes · _15 prior NE seasons as primary caller plus HC calling stints in Denver and Las Vegas_
- [ ] **DC scheme note:** _Vrabel protégé who took over defensive calls mid-2025 when Terrell Williams stepped away and ran a top-5 scoring defense through the Super Bowl LX run_
- [ ] **Coaching tree:** Belichick / Patriots (Erhardt-Perkins) tree
- [ ] ⚠ No 2026-dated article confirms McDaniels still calls plays this season (2025 is explicit).
- [ ] ⚠ 2005 counted as a calling season per his bio though his title that year was QB coach.
- Sources: <https://en.wikipedia.org/wiki/2026_New_England_Patriots_season> · <https://en.wikipedia.org/wiki/Josh_McDaniels> · <https://www.si.com/nfl/patriots-mike-vrabel-hiring-josh-mcdaniels-offensive-coordinator> · <https://www.bostonglobe.com/2026/02/17/sports/patriots-zak-kuhr-defensive-coordinator>

## New Orleans Saints (`no`)

- [ ] **Play-caller:** Kellen Moore (Head coach) — basis: inferred · _Hiring-era reporting: 'Moore will call the offensive plays, while Nussmeier takes on his first coordinator job.' No report of a handoff found; 2026 coverage still frames it as Moore's offense._
- [ ] **Staff names:** HC Kellen Moore · OC Doug Nussmeier · DC Brandon Staley
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): DAL OC 2019-22; LAC OC 2023; PHI OC 2024; NO HC 2025-26
- [ ] **Reliability inputs:** 1 prior season(s) as caller here · same scheme family: yes · 2025 caller: Kellen Moore
- [ ] **OC card:** calls plays: no · has called before: no · _First-time NFL coordinator who has never called NFL plays; college OC at Alabama, Michigan and Florida, and 7 prior seasons on Moore's staffs_
- [ ] **DC scheme note:** _Fangio-tree two-high, light-box system; Cover-3 zone-match principles with heavy disguise_
- [ ] **Coaching tree:** Garrett-era Cowboys staff; Coryell-family passing game
- [ ] ⚠ Moore's play-calling as Chargers OC (2023) and Eagles OC (2024) is inferred from context; explicit confirmation exists only for Dallas 2019-22 and the Saints job.
- Sources: <https://en.wikipedia.org/wiki/2026_New_Orleans_Saints_season> · <https://en.wikipedia.org/wiki/Kellen_Moore> · <https://amp.nfl.com/news/eagles-qb-coach-doug-nussmeier-rejoins-kellen-moore-as-saints-offensive-coordinator>

## New York Giants (`nyg`)

- [ ] **Play-caller:** Matt Nagy (Offensive coordinator) — basis: reported · _2026 reporting: 'Nagy will call the Giants' offensive plays throughout the year,' working from the booth. Harbaugh is a special-teams/defense-background HC._
- [ ] **Staff names:** HC John Harbaugh · OC Matt Nagy · DC Dennard Wilson
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): KC OC 2017 (Dec on); CHI HC 2018-19; NYG OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Mike Kafka (named caller by Brian Daboll; Daboll fired at 2-8, Kafka finished as interim HC)
- [ ] **OC card:** calls plays: yes · has called before: yes · _Prior primary calling in Chicago and late-2017 Kansas City; his Bears offenses ranked 22nd or worse in scoring in three of four years_
- [ ] **DC scheme note:** _Dean Pees-style Ravens system: multiple and pressure-based, physical press corners, heavy Cover 2/quarters_
- [ ] **Coaching tree:** Andy Reid West Coast tree
- [ ] ⚠ Sources conflict on Nagy's Bears calling years (2018-19 listed as the defensible core; he delegated to Bill Lazor 2019-21 per his bio).
- [ ] ⚠ The KC 2017 stop is partial-season (December on).
- Sources: <https://en.wikipedia.org/wiki/2026_New_York_Giants_season> · <https://en.wikipedia.org/wiki/Matt_Nagy> · <https://bigblueview.com/new-york-giants-news/153786/matt-nagy-hired-offensive-coordinator-john-harbaugh-andy-reid>

## New York Jets (`nyj`)

- [ ] **Play-caller:** Frank Reich (Offensive coordinator) — basis: reported · _Feb 2026: Glenn handed 'full control of the offense' to Reich and calls the defensive plays himself._
- [ ] **Staff names:** HC Aaron Glenn · OC Frank Reich · DC Brian Duker
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): SD OC 2014-15; IND HC 2018-22; CAR HC 2023; NYJ OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Tanner Engstrand (first-time caller, called all of 2025; departed after a push to demote him from play-calling)
- [ ] **OC card:** calls plays: yes · has called before: yes · _Long calling résumé (SD, IND, CAR); in Carolina 2023 he ceded calls after an 0-6 start, took them back three games later, and was fired in November_
- [ ] **DC scheme note:** _More 'multiple' in 2026 with increased 3-4 base looks — but HC Aaron Glenn calls the defensive plays; Duker is a first-time DC_
- [ ] **Coaching tree:** Reid/Pederson West Coast branch, evolved through his own Colts system
- [ ] ⚠ Eagles 2016-17 excluded from calling stops: sources do not settle whether Reich or Pederson called plays there.
- [ ] ⚠ The CAR 2023 stop includes a mid-season handoff and return, so that season's numbers are partly Thomas Brown's.
- Sources: <https://en.wikipedia.org/wiki/2026_New_York_Jets_season> · <https://en.wikipedia.org/wiki/Frank_Reich> · <https://www.click2houston.com/sports/2026/02/04/jets-hire-veteran-coach-frank-reich-as-offensive-coordinator/>

## Philadelphia Eagles (`phi`)

- [ ] **Play-caller:** Sean Mannion (Offensive coordinator) — basis: reported · _Sirianni confirmed Mannion calls plays, from the booth, starting Week 1. First-time caller at any level — two total years of coaching._
- [ ] **Staff names:** HC Nick Sirianni · OC Sean Mannion · DC Vic Fangio
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): PHI OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Kevin Patullo
- [ ] **OC card:** calls plays: yes · has called before: no · _Zero play-calling experience at any level before 2026; hired to install a version of the Shanahan offense — the Eagles' fifth OC in five years_
- [ ] **DC scheme note:** _Fangio system, year 3: ~90% two-high shells with league-leading disguise rate, late safety rotations_
- [ ] **Coaching tree:** Shanahan / McVay tree (via Matt LaFleur's Packers)
- [ ] ⚠ Scheme-family call (false) rests on reporting that Mannion installs a Shanahan-family system while Patullo ran Sirianni's in-house offense.
- Sources: <https://en.wikipedia.org/wiki/2026_Philadelphia_Eagles_season> · <https://www.phillyvoice.com/upside-downside-sean-mannion-eagles-new-offensive-coordinator-josh-grizzard-nfl-coaching-analysis/> · <https://fantasynerds.com/news/story/2026/09/09/eagles-oc-sean-mannion-likely-to-call-plays-from-booth-in-week-1-1618485>

## Pittsburgh Steelers (`pit`)

- [ ] **Play-caller:** Mike McCarthy (Head coach) — basis: reported · _Said at his introductory press conference he will call plays and 'run the offense'; Angelichio holds the OC title without calling duties._
- [ ] **Staff names:** HC Mike McCarthy · OC Brian Angelichio · DC Patrick Graham
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): NO OC 2000-04; SF OC 2005; GB HC 2006-18; DAL HC 2023-24; PIT HC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: Arthur Smith (left for the Ohio State OC job after McCarthy's hire)
- [ ] **OC card:** calls plays: no · has called before: no · _Ex-Vikings passing-game coordinator/TE coach, with McCarthy in Green Bay 2016-18; no record of primary play-calling anywhere_
- [ ] **DC scheme note:** _Multiple-front 3-4 base, usually 2-4-5 in practice, dynamic blitz packages_
- [ ] **Coaching tree:** Holmgren / West Coast tree (Green Bay lineage)
- [ ] ⚠ GB tenure includes a part of 2015 delegated to Tom Clements (resumed that December).
- [ ] ⚠ McCarthy sat out 2025; Dallas 2020-22 excluded (Kellen Moore called those).
- Sources: <https://en.wikipedia.org/wiki/2026_Pittsburgh_Steelers_season> · <https://en.wikipedia.org/wiki/Mike_McCarthy_(American_football)> · <https://steelersnow.com/mike-mccarthy-outlines-steelers-oc-brian-angelichios-role/>

## Seattle Seahawks (`sea`)

- [ ] **Play-caller:** Brian Fleury (Offensive coordinator) — basis: reported · _First-time offensive caller at any level; Macdonald: 'All play callers have to be first-time play callers at some point.' Fleury kept the scheme that just won the Super Bowl (Kubiak left for the Raiders HC job)._
- [ ] **Staff names:** HC Mike Macdonald · OC Brian Fleury · DC Aden Durde
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): SEA OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Klint Kubiak
- [ ] **OC card:** calls plays: yes · has called before: no · _Has never called offensive plays at any level (his only calling experience was as an FCS defensive coordinator); Seattle's fourth OC in four seasons_
- [ ] **DC scheme note:** _Macdonald calls the defensive plays in his Ravens-style scheme — disguise, early-down dominance, takeaways; Durde runs the day-to-day_
- [ ] **Coaching tree:** Shanahan tree (49ers staff 2019-25)
- [ ] ⚠ That Kubiak called Seattle's plays in 2025 is inferred from his OC role and the first-time-caller framing around Fleury's hire.
- Sources: <https://en.wikipedia.org/wiki/2026_Seattle_Seahawks_season> · <https://www.nfl.com/news/seahawks-hiring-49ers-tight-ends-coach-brian-fleury-as-offensive-coordinator> · <https://www.fox13seattle.com/sports/macdonald-decision-trust-fleury-new-seahawks-coordinator>

## San Francisco 49ers (`sf`)

- [ ] **Play-caller:** Kyle Shanahan (Head coach) — basis: reported · _Retained play-calling when Klay Kubiak was promoted to OC; Sept 2026 game coverage still has Shanahan calling. Extension signed Sept 2026._
- [ ] **Staff names:** HC Kyle Shanahan · OC Klay Kubiak · DC Raheem Morris
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): HOU OC 2008-09; WAS OC 2010-13; CLE OC 2014; ATL OC 2015-16; SF HC 2017-26
- [ ] **Reliability inputs:** 9 prior season(s) as caller here · same scheme family: yes · 2025 caller: Kyle Shanahan
- [ ] **OC card:** calls plays: no · has called before: no · _On the 49ers staff since 2021, OC since 2025; never a primary regular-season caller — viewed as Shanahan's groomed successor_
- [ ] **DC scheme note:** _Morris (hired Feb 2026): hybrid odd/five-man front with aggressive blitzing and disguised coverages — a clear departure from the prior four-down, low-blitz scheme_
- [ ] **Coaching tree:** Shanahan tree — he is its head; wide-zone West Coast family
- [ ] ⚠ Each individual SF season's play-calling was not separately verified; endpoints are sourced.
- Sources: <https://en.wikipedia.org/wiki/2026_San_Francisco_49ers_season> · <https://en.wikipedia.org/wiki/Kyle_Shanahan> · <https://profootballrumors.com/2025/01/49ers-promote-klay-kubiak-to-oc-shanahan-still-calling-plays>

## Tampa Bay Buccaneers (`tb`)

- [ ] **Play-caller:** Zac Robinson (Offensive coordinator) — basis: inferred · _No explicit in-season statement found; Robinson spoke of 'bringing play-caller stability to the franchise' at his hiring, Bowles is a defensive HC, and AP frames TB's OCs as the succession of callers — the fifth OC in five years._
- [ ] **Staff names:** HC Todd Bowles · OC Zac Robinson · DC —
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): ATL OC 2024-25; TB OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Josh Grizzard (fired after one season)
- [ ] **OC card:** calls plays: yes · has called before: yes · _Two seasons running the Falcons offense before Tampa_
- [ ] **DC scheme note:** _No DC on the 2026 staff — the defense is Bowles' own, with George Edwards and Larry Foote splitting coordinator-level duties_
- [ ] **Coaching tree:** Shanahan / McVay tree (5 seasons on McVay's Rams staff)
- [ ] ⚠ No fetched source explicitly states Robinson holds 2026 play-calling duties; inferred as noted.
- [ ] ⚠ That Robinson personally called plays in Atlanta 2024-25 is inferred from OC-as-caller framing.
- Sources: <https://en.wikipedia.org/wiki/2026_Tampa_Bay_Buccaneers_season> · <https://baynews9.com/fl/tampa/sports/2026/01/27/zac-robinson-bucs-offensive-coordinator> · <https://www.nfl.com/news/buccaneers-fire-josh-grizzard-one-season-offensive-coordinator>

## Tennessee Titans (`ten`)

- [ ] **Play-caller:** Brian Daboll (Offensive coordinator) — basis: reported · _CBS calls him outright 'new Titans play caller Brian Daboll'; the Saleh-Daboll setup mirrors Saleh/Shanahan in San Francisco, each owning his side of the ball. Saleh calls the defense._
- [ ] **Staff names:** HC Robert Saleh · OC Brian Daboll · DC Gus Bradley
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): CLE OC 2009-10; MIA OC 2011; KC OC 2012; Alabama OC 2017 (college); BUF OC 2018-21; NYG HC 2024; TEN OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: no · 2025 caller: HC Brian Callahan (Wks 1-3), then QB coach Bo Hardegree from Week 4
- [ ] **OC card:** calls plays: yes · has called before: yes · _The franchise's most experienced OC hire — prior calling stops in Cleveland, Miami, Kansas City, Alabama, Buffalo and the 2024 Giants_
- [ ] **DC scheme note:** _Saleh calls the defensive plays with Bradley as DC — a 'fast and violent,' Seattle/Cover-3-tree pairing_
- [ ] **Coaching tree:** Belichick / Patriots (Erhardt-Perkins) tree, with an Alabama stop
- [ ] ⚠ Primary-caller status at the CLE/MIA/KC stops is presumed from the OC title under defensive head coaches.
- Sources: <https://en.wikipedia.org/wiki/2026_Tennessee_Titans_season> · <https://www.nfl.com/news/titans-hire-brian-daboll-offensive-coordinator> · <https://new.cbssports.com/fantasy/football/news/cam-wards-fantasy-stock-rises-under-new-titans-play-caller-brian-daboll/>

## Washington Commanders (`was`)

- [ ] **Play-caller:** David Blough (Offensive coordinator) — basis: reported · _AP: Blough, 'who never has called plays in the NFL, takes over the offense'; Quinn is publicly committed to riding out his young coordinators' growing pains._
- [ ] **Staff names:** HC Dan Quinn · OC David Blough · DC Daronte Jones
- [ ] **Calling stops & seasons** (drive dossier/finishes attribution): WAS OC 2026
- [ ] **Reliability inputs:** 0 prior season(s) as caller here · same scheme family: yes · 2025 caller: Kliff Kingsbury (parted ways after the 5-12 2025 season)
- [ ] **OC card:** calls plays: yes · has called before: no · _Never a primary play-caller anywhere before 2026 — his playing career ended only ~2 years before the promotion_
- [ ] **DC scheme note:** _Flores-influenced pressure scheme — 3-4 base with 3/4/5-man fronts, blitz and sim-pressure from all levels, zone behind it_
- [ ] **Coaching tree:** Kingsbury staff tree (internal promotion off Kingsbury's own offense)
- [ ] ⚠ sameSchemeFamily=true is a judgment call: internal promotion from Kingsbury's staff implies system continuity, but no source labels his scheme explicitly.
- Sources: <https://en.wikipedia.org/wiki/2026_Washington_Commanders_season> · <https://en.wikipedia.org/wiki/David_Blough> · <https://www.thebanner.com/sports/commanders-nfl/commanders-coordinators-growing-pains-M46ZN3NTXVCZ5H6ILJC2S6KAHY/>
