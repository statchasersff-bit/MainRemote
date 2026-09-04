/**
 * The draft-season fantasy outlook for a team, written by hand.
 *
 * The only block on this page that is an opinion rather than a reading. Every
 * other section is a number some provider reported — a rank, a snap count, an
 * injury designation — and can be refreshed by asking again. This one is a
 * take: where the offence is going, and what that means on draft day. It is
 * kept in source, per team, because there is no feed for it and because a
 * take with nobody's name on it should at least be reviewable in a diff.
 *
 * Three consequences of that, and they are the whole shape of this module.
 *
 * First, a team with no entry renders no section — the same rule the fetched
 * blocks follow. Thirty-two half-written outlooks would be worse than one
 * finished one, so the table fills in as they are written and the page is
 * honest about the gap in the meantime.
 *
 * Second, every outlook carries the `season` it was written for and the month
 * it was last touched. A take goes stale in a way a stat line does not:
 * "A.J. Brown arrives" is true for one offseason and misleading forever after.
 * The renderer prints both, and the caller can drop an outlook that has been
 * overtaken rather than the page quietly presenting last year's draft advice
 * as this year's.
 *
 * Third, the players are grouped rather than listed. A flat run of seven cards
 * is a directory; two bands — the pieces that decide a draft and the ones that
 * fill it in — is a take about which is which, which is the thing a reader
 * came for. The bands are written per team, not derived, because "core" is a
 * judgement and there is no rank this module could compute it from.
 */

/**
 * One "what changed" fact — the kind no stats feed can report.
 *
 * `rank` exists so the value can stay short without the league context being
 * thrown away: "59.8 plays/g" is the reading and "24th" is what makes it mean
 * something, and at this size they cannot share one line at one weight.
 */
export interface OutlookFact {
  label: string;
  value: string;
  /** e.g. "24th". Null when the fact is not something 32 teams can be ranked on. */
  rank?: string;
}

/**
 * One player, with the fantasy call in front of the reasoning.
 *
 * The order of the fields is the order the card reads, and it is deliberate:
 * `tier` first because a reader scanning seven cards wants the classification
 * and nothing else; `thesis` next because a one-line claim is what makes the
 * paragraph optional; `stats` as the evidence for the claim; `note` last, for
 * the reader who has decided this player is worth the paragraph.
 *
 * This carried a market rank ("WR9") and a verdict chip ("Target", "Fade")
 * once. Those said where the market was and whether to beat it, which is a
 * different question from what the player is — and as two pills side by side
 * they read as a scorecard rather than as analysis. `tier` answers the
 * question the pills were being used to answer, in the reader's own language.
 */
export interface OutlookPlayer {
  name: string;
  /** Position chip, e.g. "QB". Drives the chip colour via .sct-slot. */
  position: string;
  /** The fantasy classification, e.g. "Elite QB1", "Deep sleeper". */
  tier: string;
  /** The card's headline claim, in one sentence. */
  thesis: string;
  /**
   * Three or so compact supporting facts, shown as a single scannable row.
   *
   * Numbers where the take has numbers and short phrases where it does not —
   * a player who arrived this offseason has no season line to quote, and
   * inventing one to make the row look uniform would be the page's one lie.
   * An empty array renders no row at all.
   */
  stats: string[];
  /** The case for and against, in two or three sentences. */
  note: string;
}

/**
 * A band of players — the curation, not just a bucket.
 *
 * `label` is what the band asserts ("Core fantasy pieces"), so it is written
 * out per team rather than drawn from a fixed vocabulary: a team whose whole
 * offence is one running back does not have four core pieces, and the heading
 * should be allowed to say so.
 */
export interface OutlookGroup {
  label: string;
  players: OutlookPlayer[];
}

export interface TeamOutlook {
  /** The season this take describes. Printed in the heading. */
  season: number;
  /** When it was last written, e.g. "August 2026". Printed in the meta line. */
  updated: string;
  /** Two or three sentences on where the offence stands. */
  summary: string;
  facts: OutlookFact[];
  groups: OutlookGroup[];
  /** The closing line — the one thing to remember about this offence. */
  bottomLine: string;
}

/**
 * Keyed by our canonical team id (Sleeper's lowercase code), the same key the
 * news pipeline and TEAM_COLORS use. Not every team is here; see the module
 * note above.
 */
export const TEAM_OUTLOOKS: Record<string, TeamOutlook> = {
  ne: {
    season: 2026,
    updated: "August 2026",
    summary:
      "The 14-3 season and the Super Bowl run were built on Drake Maye and a receiving corps with no true No. 1 in it. New England spent the offseason fixing the second half of that sentence, trading for A.J. Brown and paying Romeo Doubs while letting Stefon Diggs walk. Josh McDaniels now has an alpha to feed, which is the piece his offences have always used most.",
    facts: [
      { label: "Arrivals", value: "A.J. Brown, Romeo Doubs" },
      { label: "Departures", value: "Stefon Diggs, Austin Hooper" },
      { label: "Play caller", value: "Josh McDaniels" },
      { label: "Projected wins", value: "10–11" },
      { label: "Pace", value: "59.8 plays/g", rank: "24th" },
      { label: "Dropback rate", value: "60.8%", rank: "13th" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Drake Maye",
            position: "QB",
            tier: "Elite QB1",
            thesis:
              "The rushing floor keeps him safely inside QB1 territory.",
            stats: ["4,394 pass yds", "31 TD", "72% comp"],
            note:
              "The MVP runner-up threw for 4,394 yards and 31 touchdowns on an NFL-best 72% completion rate at 8.9 yards an attempt, and added the sixth-most rushing points at the position. He did all of it without a receiver who commanded a safety. The efficiency is the part that could regress; the volume and the legs are not going anywhere.",
          },
          {
            name: "A.J. Brown",
            position: "WR",
            tier: "High-end WR1",
            thesis:
              "McDaniels has an alpha again, and it is the best one Maye has thrown to.",
            stats: ["Offseason trade", "Contested catches", "YAC"],
            note:
              "McDaniels has historically funnelled a huge share of first-read targets to his alpha, and Brown is the best one Maye has thrown to. Contested catches and yards after the catch are exactly what this offence lacked. The risk is a slow start while a new quarterback and a new playbook settle.",
          },
          {
            name: "Rhamondre Stevenson",
            position: "RB",
            tier: "RB2 / FLEX",
            thesis:
              "Still the lead back, and the role holds up in any game script.",
            stats: ["232 touches", "5.9 yds/touch", "54 catches"],
            note:
              "The backfield is still his. He out-touched Henderson 232 to 193 across 18 games, doubled him 70 to 35 in the playoffs, and played 71% of postseason snaps. He also averaged 5.9 yards a touch — third among all backs — and caught 54 passes, so the role holds up whether New England is ahead or behind.",
          },
          {
            name: "TreVeyon Henderson",
            position: "RB",
            tier: "Upside RB2",
            thesis:
              "The ceiling is real, and almost all of it arrived while Stevenson was hurt.",
            stats: ["1,132 scrimmage yds", "10 TD", "34% snaps"],
            note:
              "1,132 scrimmage yards and 10 touchdowns as a rookie sharing a backfield, with an RB16-RB4-RB3 run in Weeks 9-11 that showed the ceiling. That run is also the problem: 29.2% of his season's fantasy points came in the two weeks Stevenson was out. With Stevenson healthy he averaged 8.1 points on 34% of snaps.",
          },
        ],
      },
      {
        label: "Secondary options",
        players: [
          {
            name: "Romeo Doubs",
            position: "WR",
            tier: "WR3 / FLEX",
            thesis:
              "Paid for the WR2 job, in a room that still rotates five deep.",
            stats: ["New contract", "WR2 job", "5-deep rotation"],
            note:
              "The new contract buys him the WR2 job, and he will see single coverage every week that Brown draws the safety. But New England rotated as many as five receivers in a given week last season, and a capped target share in a crowded tree makes him touchdown-dependent.",
          },
          {
            name: "Hunter Henry",
            position: "TE",
            tier: "TE1 / TE2",
            thesis:
              "Maye's red-zone security blanket, now that the room's spare volume has gone.",
            stats: ["768 yds", "7 TD", "22 RZ targets"],
            note:
              "A career-high 768 yards and 7 scores made him the TE13 in points per game, and he was third among tight ends with 22 red-zone targets — he is Maye's security blanket where it counts. Austin Hooper's 85 targets left for Atlanta, but so did the room's spare volume: Brown and Doubs now own the short and intermediate middle.",
          },
          {
            name: "Eli Raridon",
            position: "TE",
            tier: "Deep sleeper",
            thesis:
              "TE2 is an open audition and the rookie has the draft capital to win it.",
            stats: ["3rd-round rookie", "9.4 RAS", "66% inline"],
            note:
              "Julian Hill's season-ending injury turned TE2 into an open audition, and the third-round rookie is the front-runner on draft capital alone. A 9.4 RAS and 66% of his college snaps inline is the exact profile McDaniels wants for his 12-personnel packages, and blocking is what gets a rookie tight end on the field.",
          },
        ],
      },
    ],
    bottomLine:
      "The weapons finally match the quarterback. Maye is the reason to buy into this offence at every position, and the backfield split is the one thing left that can cost you a pick.",
  },
  buf: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Buffalo scored 28.3 points a game and led the NFL in rushing, and did it with a passing game that finished 13th in yards and produced no 750-yard receiver. Josh Allen ran for 14 touchdowns, nearly half of the team's 30 on the ground. Joe Brady takes over as head coach and DJ Moore arrives to fix the one part of this offence that was not working.",
    facts: [
      { label: "Head coach", value: "Joe Brady (first season)" },
      { label: "Arrivals", value: "DJ Moore" },
      { label: "Scoring", value: "28.3 pts/g", rank: "4th" },
      { label: "Rushing", value: "159.6 yds/g", rank: "1st" },
      { label: "Passing", value: "234.2 yds/g", rank: "13th" },
      { label: "Rushing TDs", value: "30" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Josh Allen",
            position: "QB",
            tier: "Elite QB1",
            thesis:
              "The passing line came down and it did not matter, because the touchdowns moved to his legs.",
            stats: ["3,668 pass yds", "25 pass TD", "14 rush TD"],
            note:
              "3,668 passing yards and 25 touchdowns is the quietest line of his prime, and he still finished as a top-two fantasy quarterback because 14 of Buffalo's 30 rushing scores were his own. That is the whole case: the rushing floor is not a bonus on top of the passing, it is the larger half of the total, and it does not depend on a receiver winning. A 69.3% completion rate at a 102.2 rating says the efficiency is intact — the volume simply went to the ground.",
          },
          {
            name: "James Cook",
            position: "RB",
            tier: "Top-five RB1",
            thesis:
              "A 1,621-yard season on 309 carries, in the league's best rushing offence.",
            stats: ["1,621 rush yds", "12 TD", "5.2 yds/carry"],
            note:
              "He carried it 309 times for 1,621 yards at 5.2 a pop and scored 12 times, behind a line that produced the most rushing yards per game in football. The workload is the appeal and also the only real worry — 342 touches is a lot to ask twice. The receiving work is the soft spot: 33 catches on 40 targets is a genuine role, but it is not the 60-reception floor that carries a back through a bad week.",
          },
          {
            name: "Khalil Shakir",
            position: "WR",
            tier: "WR3 with a safe floor",
            thesis:
              "Led the team in targets and receptions, and it took only 95 looks to do it.",
            stats: ["72 rec", "719 yds", "95 targets"],
            note:
              "Seventy-two catches on 95 targets is an outstanding catch rate and the most secure role in the receiving room. The problem is the number beside it: 719 yards led all Buffalo receivers, which says more about the offence than about him. He is Allen's outlet and the floor is real; at 10.0 yards a reception the ceiling needs touchdowns this role has never reliably produced.",
          },
          {
            name: "DJ Moore",
            position: "WR",
            tier: "Upside WR3",
            thesis:
              "The most accomplished route-runner Buffalo has ever handed Allen.",
            stats: ["Offseason arrival", "50 rec, 682 yds", "85 targets"],
            note:
              "Fifty catches for 682 yards and six scores in Chicago is not a WR1 line, and it is still better than anything this receiving room produced last season. He walks into a target tree with no established alpha, for a quarterback who has never had one. The caution is what the rankings imply: Buffalo threw for 234 yards a game and finished 13th doing it, so the volume that would make him a WR2 has to be created rather than inherited.",
          },
        ],
      },
      {
        label: "The rest of the passing game",
        players: [
          {
            name: "Dalton Kincaid",
            position: "TE",
            tier: "TE1 upside, TE2 risk",
            thesis:
              "The best yards per catch in the offence, in the fewest games.",
            stats: ["39 rec", "571 yds", "12 games"],
            note:
              "14.6 yards a reception is a field-stretching number from a tight end, and the 47.6 yards a game he managed across twelve appearances would have put him inside the position's top ten over a full season. He did not play a full season, and that is now three years running. Buy the per-game rate; do not pay for seventeen games of it.",
          },
          {
            name: "Keon Coleman",
            position: "WR",
            tier: "Late-round dart",
            thesis:
              "Two seasons in, the production has not caught up to the draft slot.",
            stats: ["38 rec", "404 yds", "13 games"],
            note:
              "404 yards on 59 targets in his second season is the kind of line that gets a receiver drafted a round later every year until it changes. The physical profile is still the reason to look, and DJ Moore's arrival makes the case harder rather than easier — the targets a breakout would have needed now have somewhere else to go.",
          },
          {
            name: "Ray Davis",
            position: "RB",
            tier: "Handcuff with standalone weeks",
            thesis:
              "The only back who matters if Cook's 342 touches catch up with him.",
            stats: ["275 rush yds", "4.7 yds/carry", "17 games"],
            note:
              "Fifty-eight carries at 4.7 a go and two receiving scores is a backup's line, and it was earned across all seventeen games behind a healthy starter. That is the point of him: the handcuff to a 300-carry back in the league's top rushing offence is worth a bench spot on its own, and no third back in the room is contesting it.",
          },
        ],
      },
    ],
    bottomLine:
      "Allen and Cook are the offence and both are priced like it. Everything after them is a bet on a passing game whose leading receiver managed 719 yards — DJ Moore is the reason to think that number moves, and a first-year head coach is the reason not to assume it.",
  },
  mia: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Miami tore the offence down to the studs. Tua Tagovailoa is in Atlanta, Jaylen Waddle is in Denver, Tyreek Hill is unsigned, and Jeff Hafley inherits a quarterback room of Kyle McCord and Malik Willis. What is left is De'Von Achane and a passing game that already ranked 25th in yards before it lost its three best players.",
    facts: [
      { label: "Head coach", value: "Jeff Hafley (first season)" },
      { label: "Departures", value: "Tua Tagovailoa, Jaylen Waddle, Tyreek Hill" },
      { label: "Scoring", value: "20.4 pts/g", rank: "25th" },
      { label: "Passing", value: "195.4 yds/g", rank: "25th" },
      { label: "Pace", value: "55.8 plays/g", rank: "31st" },
      { label: "Rushing", value: "120.2 yds/g", rank: "13th" },
    ],
    groups: [
      {
        label: "The one player who matters",
        players: [
          {
            name: "De'Von Achane",
            position: "RB",
            tier: "Volume-driven RB1",
            thesis:
              "The entire offence runs through him, which is both the reason to draft him and the reason to worry.",
            stats: ["1,350 rush yds", "67 rec, 488 yds", "12 total TD"],
            note:
              "238 carries for 1,350 yards at 5.7 a pop, plus 67 catches on 85 targets — 305 touches and 1,838 scrimmage yards in sixteen games, on a team that scored 20.4 points a game. The receiving work is what makes him matchup-proof: he does not need a lead to keep touching the ball. The cost is the scoring environment. A back this good on the 25th-ranked offence is a volume bet, not a touchdown bet, and Miami has fewer ways to reach the end zone now than it did last season.",
          },
        ],
      },
      {
        label: "Everything else is a dart",
        players: [
          {
            name: "Kyle McCord",
            position: "QB",
            tier: "Superflex only",
            thesis:
              "The job is open and nobody in the room has won an NFL game with it.",
            stats: ["No 2025 production", "Open competition", "Willis is the alternative"],
            note:
              "McCord has no meaningful NFL snaps and the competition is Malik Willis, whose 2025 was four efficient games in relief rather than a body of work. Hafley's first roster gives whoever wins it the 25th-ranked receiving corps minus its top two targets. There is a cheap dual-threat upside case in a Superflex league; in a one-quarterback format there is no case at all.",
          },
          {
            name: "Malik Washington",
            position: "WR",
            tier: "Deep sleeper",
            thesis:
              "Inherits the WR1 role by default, having gained 317 yards to earn it.",
            stats: ["46 rec, 317 yds", "3 TD", "110 rush yds"],
            note:
              "Forty-six catches on 65 targets is a real role and 317 yards is not a real WR1 season — but Hill and Waddle took their target share out of the building, and Washington is the man standing closest to it. Miami also handed him 17 carries, which says the staff will manufacture touches. The floor is nothing; the path to 100 targets is genuinely open.",
          },
          {
            name: "Jaylen Wright",
            position: "RB",
            tier: "Priority handcuff",
            thesis:
              "The only back who inherits a bell-cow role in a one-back offence.",
            stats: ["288 rush yds", "4.1 yds/carry", "10 games"],
            note:
              "Seventy carries at 4.1 behind a 300-touch starter is a backup's line, and it undersells the job. If Achane misses time, Wright inherits the majority of an offence that has no other way to move the ball, on a team that ran it more than it threw it well. That is the highest-leverage handcuff in the league on a per-snap basis.",
          },
          {
            name: "Greg Dulcich",
            position: "TE",
            tier: "Streaming TE",
            thesis:
              "12.9 yards a catch on a team with nobody left to take the targets.",
            stats: ["26 rec, 335 yds", "12.9 yds/rec", "10 games"],
            note:
              "Twenty-six catches on 33 targets across ten games is efficient work in a small role, and the role is about to get bigger by subtraction. The health record is the reason he keeps being available this late, and a quarterback room this unsettled caps what any pass-catcher here can be. Stream him in a bye week; do not roster him through one.",
          },
        ],
      },
    ],
    bottomLine:
      "Achane is a first-round talent attached to a bottom-five offence, and squaring those two things is the whole Miami draft decision. Everything behind him is a bet that somebody in a stripped-down passing game becomes startable — at these prices you can afford to find out, just not in a lineup you need to win with.",
  },
  nyj: {
    season: 2026,
    updated: "September 2026",
    summary:
      "The Jets threw for 163.8 yards a game — last in the NFL — gave the ball away nineteen more times than they took it, and allowed sixty sacks. Aaron Glenn's answer in year two is Geno Smith, who threw seventeen interceptions of his own last season. Breece Hall and a healthy Garrett Wilson are the reasons to look at this offence anyway, and neither of them is the reason it finished 29th in scoring.",
    facts: [
      { label: "Head coach", value: "Aaron Glenn (second season)" },
      { label: "Arrivals", value: "Geno Smith, Adonai Mitchell" },
      { label: "Departures", value: "Justin Fields" },
      { label: "Passing", value: "163.8 yds/g", rank: "32nd" },
      { label: "Scoring", value: "17.6 pts/g", rank: "29th" },
      { label: "Turnover margin", value: "-19", rank: "32nd" },
    ],
    groups: [
      {
        label: "Worth a real pick",
        players: [
          {
            name: "Breece Hall",
            position: "RB",
            tier: "Touch-dependent RB2",
            thesis:
              "279 touches and 1,415 yards, and only five trips to the end zone to show for it.",
            stats: ["1,065 rush yds", "36 rec, 350 yds", "5 total TD"],
            note:
              "The workload is not in question — 243 carries and 48 targets is a genuine three-down role, and 4.4 a carry behind a line that surrendered sixty sacks is respectable work. The touchdowns are the whole problem. Five scores on 279 touches is what happens when an offence scores 17.6 points a game, and no part of that maths improves because the quarterback changed. Draft the volume and price the scoring honestly.",
          },
          {
            name: "Garrett Wilson",
            position: "WR",
            tier: "Buy-low WR2",
            thesis:
              "56 yards a game in seven appearances, in the worst passing offence in football.",
            stats: ["36 rec, 395 yds", "4 TD", "7 games"],
            note:
              "Seven games is the headline and the opportunity: 5.1 catches and 56.4 yards a game is a WR2 rate, and he produced it while the team around him threw for the fewest yards in the league. Four touchdowns in seven games says the red-zone role is his whenever he is upright. He has now been the one functional part of three consecutive bad passing games, which is either a durability warning or the cheapest talent on the board.",
          },
        ],
      },
      {
        label: "The rest of a rebuilt passing game",
        players: [
          {
            name: "Geno Smith",
            position: "QB",
            tier: "Superflex QB2",
            thesis:
              "An upgrade on what the Jets had, which is a lower bar than it sounds.",
            stats: ["3,025 pass yds", "19 TD", "17 INT"],
            note:
              "A 67.4% completion rate is real and the 84.7 rating is not — nineteen touchdowns against seventeen interceptions is the line of a quarterback under pressure making the wrong choice. He now inherits an offence that allowed sixty sacks, which is precisely the condition that produced those interceptions. There is a floor here the Jets did not have; there is no ceiling worth a one-quarterback roster spot.",
          },
          {
            name: "Mason Taylor",
            position: "TE",
            tier: "TE2 with a path",
            thesis:
              "Caught 68% of his targets as a rookie on a team with nothing else working.",
            stats: ["44 rec, 369 yds", "65 targets", "13 games"],
            note:
              "Forty-four catches on 65 targets in thirteen rookie games is a real usage rate, and it came in the league's least productive passing game — the volume is there before anything improves. The yardage tells you what the role is: 8.4 a catch is a checkdown outlet, not a seam threat. If Geno Smith throws underneath as often as the sack numbers suggest he will have to, Taylor is the cheapest beneficiary on the roster.",
          },
          {
            name: "Adonai Mitchell",
            position: "WR",
            tier: "Late-round upside",
            thesis:
              "13.7 yards a catch, and he caught fewer than half of what came his way.",
            stats: ["33 rec, 453 yds", "74 targets", "2 TD"],
            note:
              "Seventy-four targets is the second-largest share on this roster and 33 receptions is a 45% catch rate, which is the kind of split that is either a bad quarterback or bad hands and is usually some of both. The 13.7 average says he is the only vertical element the Jets have. He is worth a last-round pick precisely because Garrett Wilson's availability is not guaranteed.",
          },
        ],
      },
    ],
    bottomLine:
      "This is a volume offence with no scoring attached to it, and every Jet is priced by which half of that sentence you believe. Hall and Wilson are startable on usage alone; nobody here should be on your roster because you expect touchdowns.",
  },
  bal: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Jesse Minter takes over an offence that finished 2nd in rushing and 27th in passing, and ran the fewest plays of anyone outside the bottom three. Derrick Henry turned 307 carries into 1,595 yards and sixteen touchdowns; Lamar Jackson missed four games and the passing game never replaced him. Zay Flowers is the only receiver here who commanded a defence.",
    facts: [
      { label: "Head coach", value: "Jesse Minter (first season)" },
      { label: "Rushing", value: "156.6 yds/g", rank: "2nd" },
      { label: "Passing", value: "192.8 yds/g", rank: "27th" },
      { label: "Scoring", value: "24.9 pts/g", rank: "11th" },
      { label: "Pace", value: "57.3 plays/g", rank: "29th" },
      { label: "TD split", value: "23 pass / 23 rush" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Derrick Henry",
            position: "RB",
            tier: "RB1, with an age asterisk",
            thesis:
              "307 carries, 5.2 a pop and sixteen scores — the volume never came down.",
            stats: ["1,595 rush yds", "16 TD", "5.2 yds/carry"],
            note:
              "This is the most valuable workload in fantasy football: a 300-carry back on the league's second-best rushing offence, in a scheme that ran twenty-three touchdowns into the end zone on the ground. He did it across all seventeen games without a per-carry decline. The reason he is not the first pick is the only reason — nobody has carried this load at this age and repeated it, and Baltimore has no incentive to find out gently.",
          },
          {
            name: "Lamar Jackson",
            position: "QB",
            tier: "Elite QB1 when upright",
            thesis:
              "A 103.8 rating and 5.2 yards a carry, in thirteen games rather than seventeen.",
            stats: ["2,549 pass yds", "21 TD, 7 INT", "349 rush yds"],
            note:
              "Per game he threw for 196 yards with 1.6 touchdowns and ran for another 27 — a top-three fantasy rate at the position, and the 21-to-7 ratio says the efficiency is entirely intact. He simply was not there for four of them. In a run-first offence that throws it 27th-most, his fantasy value is disproportionately his legs, and the legs are what the missed games were about.",
          },
          {
            name: "Zay Flowers",
            position: "WR",
            tier: "WR1",
            thesis:
              "118 targets and 1,211 yards on a team that threw for 192.8 a game.",
            stats: ["86 rec, 1,211 yds", "118 targets", "14.1 yds/rec"],
            note:
              "He is not the leading receiver on this team, he is the passing game. Eighty-six catches at 14.1 a go, on an offence ranked 27th in passing yards, means his target share is enormous and his efficiency is carrying it rather than the volume. Five touchdowns is the one soft number, and it is a symptom of Henry owning everything inside the ten. Everything else about the profile is a locked-in WR1.",
          },
        ],
      },
      {
        label: "Secondary options",
        players: [
          {
            name: "Mark Andrews",
            position: "TE",
            tier: "Touchdown-dependent TE2",
            thesis:
              "The yardage has gone and the red-zone role has not.",
            stats: ["48 rec, 422 yds", "5 TD", "8.8 yds/rec"],
            note:
              "Forty-eight catches for 422 yards is 8.8 a reception, a number that says he is being used as a short-area and goal-line target rather than a seam threat. The five touchdowns are the whole case, and they are real — this offence scores, and he is still the tight end it looks for when the field shortens. Roster him as a floor-less TE2 whose good weeks are entirely about where the drive ended.",
          },
          {
            name: "Rashod Bateman",
            position: "WR",
            tier: "Bench flier",
            thesis:
              "Thirty-eight targets, nineteen catches, and no clear reason it changes.",
            stats: ["19 rec, 224 yds", "38 targets", "13 games"],
            note:
              "A 50% catch rate on 38 looks is a marginal role executed badly, and it happened in a season where the WR2 job was genuinely open. Baltimore's passing volume is the ceiling on anyone who is not Flowers, and there is nothing in this line suggesting he is next in the queue. He is a bye-week name, not a bench stash.",
          },
          {
            name: "Justice Hill",
            position: "RB",
            tier: "Handcuff with pass-game value",
            thesis:
              "The receiving back behind a 307-carry workhorse who is 32 years old.",
            stats: ["21 rec, 169 yds", "5.2 yds/carry", "10 games"],
            note:
              "Twenty-one catches on 27 targets is a defined third-down role, and 5.2 a carry on his eighteen attempts matches what Henry averaged on 307 of them. That combination is the point: he already has the passing-down job, so an injury in front of him hands him a full workload rather than half of one. The most valuable handcuff on any roster whose starter carries this much.",
          },
        ],
      },
    ],
    bottomLine:
      "Henry and Flowers are the two most reliably used players on a team that does not spread the ball around, and that concentration is the appeal at every position here. The risk is uniform: this offence is 29th in pace, so there is one fewer chance per game for anyone outside the top three to matter.",
  },
  cin: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Joe Burrow played eight games and Cincinnati still finished 7th in passing yards and threw thirty-six touchdowns. Joe Flacco started most of the rest at a 79.2 rating, which is the control experiment: this offence produces WR1 volume regardless of who is upright. The run game finished 29th and nothing about the roster suggests that was an accident.",
    facts: [
      { label: "Head coach", value: "Zac Taylor (eighth season)" },
      { label: "Passing", value: "249.6 yds/g", rank: "7th" },
      { label: "Rushing", value: "93.6 yds/g", rank: "29th" },
      { label: "Scoring", value: "24.4 pts/g", rank: "12th" },
      { label: "Passing TDs", value: "36" },
      { label: "Burrow starts", value: "8 of 17" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Ja'Marr Chase",
            position: "WR",
            tier: "First-round WR1",
            thesis:
              "185 targets is the highest-usage receiving role in football, and it survived losing the quarterback.",
            stats: ["125 rec, 1,412 yds", "185 targets", "8 TD"],
            note:
              "One hundred and twenty-five catches on 185 targets is a share nobody else in the league commands, and he produced it with Joe Flacco throwing most of them. The 11.3 yards a reception is the one number that looks wrong, and it is the tell: those were checkdowns and manufactured touches from a backup, not the intermediate targets Burrow feeds him. The volume is already elite; a healthy quarterback is pure upside on the efficiency.",
          },
          {
            name: "Joe Burrow",
            position: "QB",
            tier: "Top-five QB1, health permitting",
            thesis:
              "Seventeen touchdowns and five picks in eight games — a 36-touchdown pace at a 100.7 rating.",
            stats: ["1,809 pass yds", "17 TD, 5 INT", "8 games"],
            note:
              "Per start he threw for 226 yards and 2.1 touchdowns, which over a full season is the best fantasy line at the position outside of the rushing quarterbacks. He has now missed significant time in three of the last four years, and he contributes nothing on the ground — 41 rushing yards all season — so a bad week is genuinely bad. Draft the ceiling and hold a real backup, not a streamer.",
          },
          {
            name: "Tee Higgins",
            position: "WR",
            tier: "WR2 with WR1 scoring",
            thesis:
              "Eleven touchdowns on 98 targets is the best red-zone rate of any receiver here.",
            stats: ["59 rec, 846 yds", "11 TD", "14.3 yds/rec"],
            note:
              "Eleven scores in fifteen games, on a third of Chase's target volume, is the entire argument — this offence throws it near the goal line and he is the one it looks for when Chase draws the double. The 14.3 average says the targets he does get are the valuable ones. The risk is the same one it has always been: his weeks without a touchdown are WR4 weeks, and there are more of them than the season total suggests.",
          },
          {
            name: "Chase Brown",
            position: "RB",
            tier: "Reception-fuelled RB2",
            thesis:
              "Eighty-eight targets is what makes him startable, because 4.4 a carry is not.",
            stats: ["1,019 rush yds", "69 rec, 437 yds", "11 total TD"],
            note:
              "Three hundred and one touches and eleven touchdowns is a genuine RB1 workload, and it was produced by the 29th-ranked rushing offence — the yardage per carry says the blocking is not helping him. What makes the profile hold up is the 69 receptions: in a pass-first offence that trails often enough, his floor comes from the passing game rather than from game script. Volume is the buy; efficiency is not coming.",
          },
        ],
      },
      {
        label: "Secondary options",
        players: [
          {
            name: "Andrei Iosivas",
            position: "WR",
            tier: "Bye-week fill",
            thesis:
              "The WR3 in a two-receiver offence, which is a smaller job than it sounds.",
            stats: ["33 rec, 435 yds", "58 targets", "13.2 yds/rec"],
            note:
              "Fifty-eight targets across seventeen games is roughly three a week, and 13.2 a catch says he is being used down the field rather than as a volume outlet. That is a fine profile for a fourth receiver on your bench and a poor one for a starter, because his best games require a Chase or Higgins absence. The upside is real only in the weeks the injury report creates it.",
          },
          {
            name: "Mike Gesicki",
            position: "TE",
            tier: "Streaming TE",
            thesis:
              "Forty-two targets in an offence with two receivers who take everything.",
            stats: ["28 rec, 307 yds", "42 targets", "13 games"],
            note:
              "Twenty-eight catches for 307 yards is a real but small role, and the ceiling is capped by arithmetic — Chase and Higgins accounted for 283 targets between them. He is on the field enough to catch a touchdown in any given week and not enough to be trusted for yardage. Stream him against a defence that struggles with tight ends; do not roster him weekly.",
          },
        ],
      },
    ],
    bottomLine:
      "This is the cleanest buy on the board if you believe in eight-game samples: Chase and Higgins are both underpriced by a season Burrow mostly missed. The run game is not fixed and is not going to be, so Chase Brown's value lives entirely in his 88 targets.",
  },
  cle: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Cleveland scored 16.4 points a game, threw for 184.8, gave up fifty-one sacks and put eighteen passes into the wrong hands. Todd Monken inherits that and a quarterback room where Shedeur Sanders and Dillon Gabriel split seventeen starts without either settling it. The one genuinely good thing that happened was a rookie tight end leading the team in targets, catches, yards and touchdowns.",
    facts: [
      { label: "Head coach", value: "Todd Monken (first season)" },
      { label: "Scoring", value: "16.4 pts/g", rank: "31st" },
      { label: "Passing", value: "184.8 yds/g", rank: "31st" },
      { label: "Third down", value: "33.6%", rank: "29th" },
      { label: "Sacks allowed", value: "51", rank: "26th" },
      { label: "Interceptions", value: "18" },
    ],
    groups: [
      {
        label: "The reasons to look here at all",
        players: [
          {
            name: "Harold Fannin",
            position: "TE",
            tier: "Top-eight TE",
            thesis:
              "Led the team in targets, receptions, yards and touchdowns — as a rookie tight end.",
            stats: ["72 rec, 731 yds", "107 targets", "6 TD"],
            note:
              "One hundred and seven targets is a number a tight end reaches only when he is the first read, and he reached it on the 31st-ranked passing offence in his first season. Seventy-two catches and six scores from that role is the kind of usage that survives a coaching change, because it was earned rather than schemed. The 10.2 yards a reception is the honest limit — this is volume in a bad offence, not a seam threat in a good one — but the volume is what the position pays for.",
          },
          {
            name: "Quinshon Judkins",
            position: "RB",
            tier: "Touchdown-reliant RB2",
            thesis:
              "230 carries and seven scores, at 3.6 a carry behind a line that allowed fifty-one sacks.",
            stats: ["827 rush yds", "3.6 yds/carry", "7 TD"],
            note:
              "The workload is unambiguous and the efficiency is alarming: 3.6 a carry over 230 attempts is bottom-of-the-league running, and it happened on an offence that gave defences no reason to respect the pass. Seven touchdowns on a team that scored 16.4 a game says the goal-line work is his, which is the entire fantasy case. If Monken's arrival moves the passing game at all, Judkins is the player it helps most.",
          },
        ],
      },
      {
        label: "Speculative at best",
        players: [
          {
            name: "Jerry Jeudy",
            position: "WR",
            tier: "Bench flier",
            thesis:
              "106 targets turned into 602 yards, which is the whole story of this passing game.",
            stats: ["50 rec, 602 yds", "106 targets", "2 TD"],
            note:
              "A 47% catch rate on 106 looks is the signature of quarterbacks completing 56.6% and 59.5% of their throws. The target volume says the role is real and the production says nothing came of it. He is worth a late pick only as a bet on Monken and a settled quarterback, and there is no evidence yet for either.",
          },
          {
            name: "Shedeur Sanders",
            position: "QB",
            tier: "Superflex dart",
            thesis:
              "A 68.1 rating in eight starts, with the legs that make it interesting anyway.",
            stats: ["1,400 pass yds", "7 TD, 10 INT", "169 rush yds"],
            note:
              "Seven touchdowns against ten interceptions at 56.6% completion is not an NFL starter's line, and Dillon Gabriel's 80.8 rating in ten games means the job is not his by default. The reason to keep the name is 8.0 yards a carry on 21 attempts — a rushing element that would raise his floor considerably if the job and the confidence to run ever arrive together. Superflex only, and only late.",
          },
          {
            name: "Dylan Sampson",
            position: "RB",
            tier: "PPR handcuff",
            thesis:
              "Forty targets is a defined passing-down role behind an inefficient starter.",
            stats: ["33 rec, 271 yds", "40 targets", "2.7 yds/carry"],
            note:
              "Thirty-three catches on forty targets is genuine third-down usage, and it matters more than his 2.7 yards a carry suggests — in an offence that trails as often as this one, the receiving back is on the field for the snaps that produce points. He is the handcuff to a 230-carry back whose efficiency invites a committee. In PPR he has standalone weeks; anywhere else he does not.",
          },
        ],
      },
    ],
    bottomLine:
      "Harold Fannin is a genuine asset who happens to play here, and he is the only player on this roster you should draft at his market price rather than below it. Everything else is a wager on Todd Monken fixing the 31st-ranked passing game in one offseason with the same quarterbacks.",
  },
  pit: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Mike McCarthy takes over an offence that was efficient without being productive: 4th in turnover margin, 28th in pace, 22nd in passing. Aaron Rodgers threw twenty-four touchdowns against seven interceptions at a 94.8 rating. The backfield is the problem — Rico Dowdle and Jaylen Warren finished within 120 yards and one touchdown of each other, and neither has taken the job.",
    facts: [
      { label: "Head coach", value: "Mike McCarthy" },
      { label: "Scoring", value: "23.4 pts/g", rank: "15th" },
      { label: "Passing", value: "213.6 yds/g", rank: "22nd" },
      { label: "Pace", value: "58.1 plays/g", rank: "28th" },
      { label: "Turnover margin", value: "+12", rank: "4th" },
      { label: "Backfield split", value: "236 / 211 carries" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "DK Metcalf",
            position: "WR",
            tier: "WR2",
            thesis:
              "14.4 a catch and six scores — the only player here who wins a route by himself.",
            stats: ["59 rec, 850 yds", "99 targets", "6 TD"],
            note:
              "Ninety-nine targets on an offence that runs 58.1 plays a game is a large share of a small pie, and 14.4 yards a reception is what separates him from the possession receiver lined up opposite. Fifteen games and six touchdowns is a fair reflection of the role. The cap on him is the pace: Pittsburgh does not throw enough for a receiver to reach WR1 volume, so he needs the efficiency to keep holding.",
          },
          {
            name: "Michael Pittman",
            position: "WR",
            tier: "PPR WR3",
            thesis:
              "111 targets and seven touchdowns, at 9.8 yards a catch.",
            stats: ["80 rec, 784 yds", "111 targets", "7 TD"],
            note:
              "He led the team in targets and receptions and finished with fewer yards than Metcalf, which tells you exactly what the job is — chains and the red zone, not field position. Eighty catches gives him a genuine PPR floor and seven scores says Rodgers trusts him inside the twenty. In a standard league the 9.8 average makes him a flex play rather than a starter.",
          },
          {
            name: "Aaron Rodgers",
            position: "QB",
            tier: "Low-end QB1",
            thesis:
              "Twenty-four touchdowns to seven picks, with nothing at all on the ground.",
            stats: ["3,322 pass yds", "24 TD, 7 INT", "94.8 rating"],
            note:
              "A 94.8 rating across sixteen games is genuinely good quarterbacking and a 24-to-7 ratio is the reason Pittsburgh finished 4th in turnover margin. For fantasy the ceiling is capped twice over: 61 rushing yards all season means no floor beneath the passing, and a 28th-ranked pace means fewer attempts than his rate deserves. A fine QB1 in a two-quarterback league, a streamer in one.",
          },
        ],
      },
      {
        label: "A split backfield and a safe tight end",
        players: [
          {
            name: "Rico Dowdle",
            position: "RB",
            tier: "Frustrating RB3",
            thesis:
              "1,373 yards from scrimmage, and a teammate who produced 1,291.",
            stats: ["1,076 rush yds", "39 rec, 297 yds", "7 total TD"],
            note:
              "Two hundred and thirty-six carries at 4.6 is a productive season by any individual measure, and it is worth less than it looks because Jaylen Warren took 211 of his own. Neither back has ever pulled clear, and McCarthy's arrival is as likely to reset the split as resolve it. Draft him as the marginally larger half of a committee, and price the touchdowns — seven on 275 touches — accordingly.",
          },
          {
            name: "Jaylen Warren",
            position: "RB",
            tier: "Frustrating RB3",
            thesis:
              "Fewer touches than Dowdle, more touchdowns, and better hands.",
            stats: ["958 rush yds", "40 rec, 333 yds", "8 total TD"],
            note:
              "Forty catches on 45 targets is a 89% catch rate and the most reliable passing-down role in the backfield, which in PPR closes the gap with Dowdle entirely. He scored eight times to Dowdle's seven on twenty-four fewer touches. There is a real argument he is the better player; there is no argument that either of them is startable with confidence while the split holds.",
          },
          {
            name: "Pat Freiermuth",
            position: "TE",
            tier: "Back-end TE1",
            thesis:
              "Seventy-six percent of his targets caught, in an offence that values the safe throw.",
            stats: ["41 rec, 486 yds", "54 targets", "4 TD"],
            note:
              "Forty-one catches on 54 targets is the kind of reliability Rodgers has always fed, and four touchdowns on a team that scored 23.4 a game is a fair share of the red-zone work. The yardage will never be exciting because the offence does not throw enough. He is the tight end you draft when you have skipped the position twice and want to stop thinking about it.",
          },
        ],
      },
    ],
    bottomLine:
      "Everything here is competent and nothing is a difference-maker, which is the McCarthy-and-Rodgers offence in one line. Metcalf is the only player worth reaching for; the backfield is the trap, and it will stay one until somebody wins it outright.",
  },
  hou: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Houston runs the sixth-fastest offence in football and finished 2nd in turnover margin, which is a good team that has not turned into a good scoring team — 23.8 points a game, 13th. C.J. Stroud missed three starts and threw nineteen touchdowns in the fourteen he made. Nico Collins is the only skill player here whose role is not shared with somebody.",
    facts: [
      { label: "Head coach", value: "DeMeco Ryans (fourth season)" },
      { label: "Pace", value: "64.0 plays/g", rank: "6th" },
      { label: "Turnover margin", value: "+17", rank: "2nd" },
      { label: "Scoring", value: "23.8 pts/g", rank: "13th" },
      { label: "Passing", value: "232.7 yds/g", rank: "14th" },
      { label: "Backfield split", value: "196 / 158 carries" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Nico Collins",
            position: "WR",
            tier: "WR1",
            thesis:
              "120 targets at 15.7 a catch — volume and efficiency in the same profile.",
            stats: ["71 rec, 1,117 yds", "120 targets", "6 TD"],
            note:
              "A thousand-yard season in fifteen games on the league's sixth-fastest offence, at 15.7 a reception, is the rare receiving line that does not depend on garbage time or a single explosive week. He is the first read and the deep threat at once. Six touchdowns is the only modest number and it is a function of a red zone that runs the ball; everything else here is a locked-in WR1.",
          },
          {
            name: "C.J. Stroud",
            position: "QB",
            tier: "Mid-range QB1",
            thesis:
              "A 92.9 rating in fourteen starts, with just enough rushing to matter.",
            stats: ["3,041 pass yds", "19 TD, 8 INT", "209 rush yds"],
            note:
              "Two hundred and seventeen passing yards and 1.4 touchdowns a start is a solid rather than a spectacular rate, and the 209 rushing yards add a floor that his early career did not have. The pace is what makes him startable — sixty-four plays a game means attempts, and attempts are most of quarterback scoring. The three missed starts and a run-heavy red zone are why he is not in the top five.",
          },
          {
            name: "Dalton Schultz",
            position: "TE",
            tier: "Back-end TE1",
            thesis:
              "106 targets and 82 catches, and almost none of it near the end zone.",
            stats: ["82 rec, 777 yds", "106 targets", "3 TD"],
            note:
              "One hundred and six targets is top-five volume at the position and 82 receptions gives him one of the safest PPR floors any tight end has. Then the ceiling: 9.5 yards a catch and three touchdowns across seventeen games. He will keep your Sunday from going wrong and will almost never win you a week, which at this position is worth more than it sounds.",
          },
        ],
      },
      {
        label: "A shared backfield and a crowded receiver room",
        players: [
          {
            name: "Woody Marks",
            position: "RB",
            tier: "Committee RB3",
            thesis:
              "The larger half of a split, at 3.6 yards a carry.",
            stats: ["703 rush yds", "196 carries", "5 total TD"],
            note:
              "One hundred and ninety-six carries is the biggest workload in the room and 3.6 a carry is the reason it never became a job. Twenty-four catches on 36 targets keeps him involved when Houston trails, which on this offence is less often than it used to be. He is a flex play whose value would double the week Montgomery is unavailable and not before.",
          },
          {
            name: "David Montgomery",
            position: "RB",
            tier: "Touchdown-dependent RB3",
            thesis:
              "Fewer carries, better yards, and every score that mattered.",
            stats: ["716 rush yds", "4.5 yds/carry", "8 TD"],
            note:
              "He out-gained Marks on 38 fewer attempts and scored eight times to Marks's two — this is the goal-line back on a team that ran nine touchdowns in. That concentration is the whole case and it is also the whole risk, because a back whose value is touchdowns in an offence ranked 22nd in rushing has weeks worth nothing at all. Start him in the matchups, not by default.",
          },
          {
            name: "Kayshon Boutte",
            position: "WR",
            tier: "Big-play WR4",
            thesis:
              "16.7 yards a catch and six touchdowns on forty-six targets.",
            stats: ["33 rec, 551 yds", "46 targets", "6 TD"],
            note:
              "Thirty-three receptions producing six scores is an extraordinary rate and forty-six targets is not enough volume to trust it repeating. Everything he did was downfield, which is the most week-to-week variable way for a receiver to score points. He belongs on a bench as the fourth receiver whose good weeks are genuinely good; he does not belong in a starting lineup on the strength of that touchdown rate.",
          },
          {
            name: "Jayden Higgins",
            position: "WR",
            tier: "Late-round upside",
            thesis:
              "Six touchdowns as a second-year receiver on 68 targets.",
            stats: ["41 rec, 525 yds", "68 targets", "6 TD"],
            note:
              "Forty-one catches at 12.8 a go with six scores is a real complementary season, and he did it while Collins took the coverage and Boutte took the deep shots. Sixty-eight targets in a room this crowded is the ceiling until somebody leaves. Draft him last and hold him as the most likely of Houston's secondary receivers to take a step.",
          },
        ],
      },
    ],
    bottomLine:
      "Nico Collins and the pace are the two things worth paying for; everything else in this offence is shared with somebody who is nearly as good. The backfield in particular is a genuine coin-flip, and Houston has shown no interest in resolving it.",
  },
  ind: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Indianapolis scored 27.4 points a game and ran twenty-seven touchdowns into the end zone, more than it threw. Jonathan Taylor took 369 touches for 1,963 yards and twenty scores, which is the largest single share of a good offence anyone had last season. Daniel Jones posted a 100.2 rating in thirteen starts and the receiving corps behind Taylor is four deep and evenly split.",
    facts: [
      { label: "Head coach", value: "Shane Steichen (fourth season)" },
      { label: "Scoring", value: "27.4 pts/g", rank: "8th" },
      { label: "Passing", value: "240.3 yds/g", rank: "8th" },
      { label: "Third down", value: "42.6%", rank: "8th" },
      { label: "Rushing TDs", value: "27" },
      { label: "Taylor's touches", value: "369" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Jonathan Taylor",
            position: "RB",
            tier: "The first pick",
            thesis:
              "1,963 yards and twenty touchdowns on 369 touches — there is no comparable workload.",
            stats: ["1,585 rush yds", "18 rush TD", "46 rec, 378 yds"],
            note:
              "Three hundred and twenty-three carries at 4.9 a pop, eighteen rushing scores, and 46 receptions on 55 targets across all seventeen games. The touchdown total is the part that will not fully repeat — twenty-seven team rushing scores is a historically high number to sit behind — but the volume and the receiving role mean he does not need it to. He is the only back in football with a top-five workload and a top-five offence attached to it.",
          },
          {
            name: "Daniel Jones",
            position: "QB",
            tier: "Streaming QB1",
            thesis:
              "A 100.2 rating and five rushing touchdowns, on an offence that scores without him.",
            stats: ["3,101 pass yds", "19 TD, 8 INT", "5 rush TD"],
            note:
              "Sixty-eight percent completion at a 100.2 rating is comfortably the best stretch of his career, and the five rushing touchdowns are worth more to a fantasy line than the 164 rushing yards suggest. The problem is the same one that makes Taylor great: Indianapolis runs it in from the two, so the passing touchdowns are capped. A fine QB1 in the weeks the matchup forces Indianapolis to throw.",
          },
          {
            name: "Tyler Warren",
            position: "TE",
            tier: "Top-six TE",
            thesis:
              "112 targets in a rookie season, second only to Keenan Allen on the roster.",
            stats: ["76 rec, 817 yds", "112 targets", "4 TD"],
            note:
              "Seventy-six catches for 817 yards from a first-year tight end is a genuine breakout, and the 112 targets say it was by design rather than by accident of injury. Four touchdowns is low and it is the same red-zone story every Colt has — Taylor takes those. The usage is already top-five at the position and the scoring is the part with room to grow.",
          },
        ],
      },
      {
        label: "A four-way receiver split",
        players: [
          {
            name: "Alec Pierce",
            position: "WR",
            tier: "Boom-or-bust WR3",
            thesis:
              "21.3 yards a reception — the most extreme deep-threat profile in the league.",
            stats: ["47 rec, 1,003 yds", "84 targets", "6 TD"],
            note:
              "A thousand yards on forty-seven catches is a season built entirely on explosive plays, and it is the single most volatile way to accumulate fantasy points. Eighty-four targets on a team with three other pass-catchers over 88 means the volume will not save a quiet week. He wins you matchups outright and loses you others without warning; roster him knowing which.",
          },
          {
            name: "Keenan Allen",
            position: "WR",
            tier: "PPR WR3",
            thesis:
              "Team-high 122 targets, at 9.6 yards a catch.",
            stats: ["81 rec, 777 yds", "122 targets", "4 TD"],
            note:
              "Eighty-one receptions across all seventeen games is a genuinely reliable PPR floor and the target share is the largest in the receiving corps. Everything about the yardage says short and intermediate — he is moving the chains while Pierce takes the top off. In a points-per-reception league he is a steady starter; in standard scoring 777 yards and four scores is a bench profile.",
          },
          {
            name: "Josh Downs",
            position: "WR",
            tier: "PPR flex",
            thesis:
              "Eighty-eight targets from the slot in a genuinely crowded room.",
            stats: ["58 rec, 566 yds", "88 targets", "4 TD"],
            note:
              "Fifty-eight catches on 88 targets is efficient slot work and the third-largest receiving role on a top-ten passing offence. The ceiling is arithmetic: Allen, Pierce and Warren took 318 targets between them, so the week where Downs is the difference requires one of them to be out. A useful PPR bench piece and an obvious beneficiary if the room thins.",
          },
        ],
      },
    ],
    bottomLine:
      "Take Jonathan Taylor and then be careful, because everything behind him is a genuine four-way split of a very good passing offence. Tyler Warren is the one piece of that split whose usage already justifies a real pick.",
  },
  jax: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Jacksonville scored 27.9 points a game, ran the fourth-fastest offence in football and finished 3rd in turnover margin. Trevor Lawrence threw for 4,007 yards and twenty-nine touchdowns and ran in nine more, which is a top-five fantasy quarterback season regardless of the 60.9% completion rate. The receiving work is split three ways and the backfield is split three ways after that.",
    facts: [
      { label: "Head coach", value: "Liam Coen (second season)" },
      { label: "Scoring", value: "27.9 pts/g", rank: "6th" },
      { label: "Pace", value: "64.3 plays/g", rank: "4th" },
      { label: "Turnover margin", value: "+13", rank: "3rd" },
      { label: "Passing", value: "236.8 yds/g", rank: "11th" },
      { label: "TD split", value: "29 pass / 22 rush" },
    ],
    groups: [
      {
        label: "Core fantasy pieces",
        players: [
          {
            name: "Trevor Lawrence",
            position: "QB",
            tier: "Top-five QB1",
            thesis:
              "Twenty-nine passing touchdowns and nine on the ground, at the league's fourth-fastest pace.",
            stats: ["4,007 pass yds", "29 TD, 12 INT", "9 rush TD"],
            note:
              "Thirty-eight total touchdowns across seventeen games is the whole case, and the nine rushing scores are the part that makes it durable — that is a floor no receiving corps can take away from him. The 60.9% completion rate is genuinely poor and it did not stop any of it, because sixty-four plays a game produces enough attempts to absorb the misses. Pace and legs are why he is a QB1 rather than a good real-life quarterback.",
          },
          {
            name: "Brian Thomas",
            position: "WR",
            tier: "WR2 with WR1 upside",
            thesis:
              "14.7 a catch in fourteen games, on ninety-one targets he did not have to share evenly.",
            stats: ["48 rec, 707 yds", "91 targets", "14 games"],
            note:
              "Fifty yards a game and 14.7 a reception is a downfield role on a fast offence, and ninety-one targets in fourteen appearances is a rate that projects past 100 over a full year. Two touchdowns is the number that will look wrong in hindsight — nothing about the usage or the depth of target explains it, and Jacksonville threw twenty-nine scores. The cheapest source of touchdown regression on this roster.",
          },
          {
            name: "Parker Washington",
            position: "WR",
            tier: "WR3",
            thesis:
              "Led the team's receivers in yards, which nobody expected and the price has not caught up to.",
            stats: ["58 rec, 847 yds", "95 targets", "5 TD"],
            note:
              "Eight hundred and forty-seven yards at 14.6 a catch, with five touchdowns, is the most complete receiving season anyone here produced. Ninety-five targets is a real share on an offence with this much volume. The caution is that he has done it once, in a room where Thomas and Meyers both have stronger claims to the first read — this is a genuine three-way split, and he is the one with the least security in it.",
          },
          {
            name: "Jakobi Meyers",
            position: "WR",
            tier: "PPR WR3",
            thesis:
              "Team-high 110 targets and 75 catches, and three touchdowns to show for it.",
            stats: ["75 rec, 835 yds", "110 targets", "3 TD"],
            note:
              "Seventy-five receptions is the safest PPR floor in this receiving corps and the target share is the largest. Three touchdowns on an offence that scored twenty-nine through the air is the anomaly, and it is the same anomaly he has produced most seasons — this is a chains-and-slot role, not a red-zone one. Reliable in points-per-reception, unstartable without it.",
          },
        ],
      },
      {
        label: "A three-way backfield and two wild cards",
        players: [
          {
            name: "Chris Rodriguez",
            position: "RB",
            tier: "Touchdown-share RB3",
            thesis:
              "The largest share of a backfield that ran twenty-two touchdowns in.",
            stats: ["500 rush yds", "4.5 yds/carry", "6 TD"],
            note:
              "One hundred and twelve carries is the biggest workload in a room that gave meaningful touches to three backs, and six touchdowns is the reason he matters — Jacksonville reached the end zone on the ground twenty-two times and he took the largest slice. Five hundred rushing yards is not a startable base. He is a touchdown-dependent flex whose value collapses the moment the split moves.",
          },
          {
            name: "Bhayshul Tuten",
            position: "RB",
            tier: "Speculative RB4",
            thesis:
              "Five touchdowns on eighty-three carries, at 3.7 a pop.",
            stats: ["307 rush yds", "5 rush TD", "10 rec"],
            note:
              "Seven scores in total from 93 touches is a startling rate and 3.7 yards a carry is the reason it has not earned him a bigger role. He is the change-of-pace and short-yardage option in a committee that has no lead back, which means the path to volume exists and nobody has walked it. Worth a final-round pick in a deep league and nothing more until the split resolves.",
          },
          {
            name: "Travis Hunter",
            position: "WR",
            tier: "Upside bench stash",
            thesis:
              "Seven games, and the only player here whose ceiling is unknown rather than measured.",
            stats: ["28 rec, 298 yds", "45 targets", "7 games"],
            note:
              "Forty-five targets in seven appearances is a six-a-week rate, which in this offence would be a genuine WR3 role over a full season. Everything about the sample is too small to price and the games he missed are the reason he is available. He is the one player on this roster you draft for what he might become rather than for what the numbers already say.",
          },
          {
            name: "Brenton Strange",
            position: "TE",
            tier: "Streaming TE",
            thesis:
              "Caught 77% of his targets in twelve games, then the season ended.",
            stats: ["46 rec, 540 yds", "60 targets", "12 games"],
            note:
              "Forty-six catches on sixty targets is efficient work and forty-five yards a game is a usable tight-end rate on an offence with this much volume. Twelve games is the recurring problem and three touchdowns is the ceiling it produced. In a fast offence that spreads it around he is a fine bye-week answer and a poor season-long plan.",
          },
        ],
      },
    ],
    bottomLine:
      "Trevor Lawrence is the asset here and the pace is why — thirty-eight total touchdowns from a quarterback completing 60.9% of his throws is a volume story, and the volume is not going anywhere. Brian Thomas is the buy underneath him; the backfield is a three-way split nobody should pay to solve.",
  },
  ten: {
    season: 2026,
    updated: "September 2026",
    summary:
      "Tennessee scored 16.7 points a game, converted 31.9% of its third downs and gave up fifty-six sacks. Cam Ward threw fifteen touchdowns in a full seventeen-game season at a 59.8% completion rate. The two players worth owning both got there on volume nobody else wanted: Tony Pollard's 275 touches and Wan'Dale Robinson's 140 targets.",
    facts: [
      { label: "Head coach", value: "Robert Saleh" },
      { label: "Scoring", value: "16.7 pts/g", rank: "30th" },
      { label: "Third down", value: "31.9%", rank: "31st" },
      { label: "Passing", value: "190.6 yds/g", rank: "29th" },
      { label: "Sacks allowed", value: "56", rank: "27th" },
      { label: "Robinson targets", value: "140" },
    ],
    groups: [
      {
        label: "Worth owning",
        players: [
          {
            name: "Wan'Dale Robinson",
            position: "WR",
            tier: "PPR WR2",
            thesis:
              "140 targets and ninety-two catches, at eleven yards each.",
            stats: ["92 rec, 1,014 yds", "140 targets", "4 TD"],
            note:
              "One hundred and forty targets is a top-five share in the entire league and it happened on the 29th-ranked passing offence, which tells you how completely this passing game runs through him. Ninety-two receptions is an elite PPR floor. Everything else is a warning: 11.0 yards a catch and four touchdowns is what a high-volume underneath role produces, so in standard scoring the same season is barely startable.",
          },
          {
            name: "Tony Pollard",
            position: "RB",
            tier: "Volume RB2",
            thesis:
              "1,082 rushing yards at 4.5 a carry, behind the 30th-ranked rushing offence.",
            stats: ["1,082 rush yds", "242 carries", "5 TD"],
            note:
              "Beating 4.5 a carry on a team that finished 30th in rushing yards is genuinely good running, and 242 carries across all seventeen games is the kind of durable workload that survives a bad offence. Five touchdowns is the cost of playing here — Tennessee ran the ball into the end zone nine times all year. He is a weekly starter on usage whose ceiling is capped by everything around him.",
          },
        ],
      },
      {
        label: "Everything else",
        players: [
          {
            name: "Cam Ward",
            position: "QB",
            tier: "Superflex only",
            thesis:
              "Fifteen touchdowns in seventeen starts, behind a line that allowed fifty-six sacks.",
            stats: ["3,169 pass yds", "15 TD, 7 INT", "80.2 rating"],
            note:
              "He took every snap of a lost season and came out of it with a 59.8% completion rate and an 80.2 rating, which is roughly what the pass protection deserved. The seven interceptions are the encouraging part — he was not throwing the game away, he was being hit. Two rushing scores and 159 yards on the ground is not enough of a floor to make him startable in a one-quarterback league.",
          },
          {
            name: "Elic Ayomanor",
            position: "WR",
            tier: "Late-round flier",
            thesis:
              "Eighty-nine targets and four scores as the WR2 in a bad passing game.",
            stats: ["41 rec, 515 yds", "89 targets", "4 TD"],
            note:
              "Eighty-nine targets is real volume and a 46% catch rate is what happens when a struggling quarterback throws them. Four touchdowns on an offence with fifteen passing scores is a meaningful red-zone share. If Ward takes any step at all, he is the receiver on this roster with the most room between his usage and his production.",
          },
          {
            name: "Chimere Dike",
            position: "WR",
            tier: "Deep bench",
            thesis:
              "Four touchdowns on 74 targets, and 8.8 yards a catch.",
            stats: ["48 rec, 423 yds", "74 targets", "4 TD"],
            note:
              "Forty-eight receptions across seventeen games is steady involvement in a three-man rotation that nobody has separated from. The yardage is the ceiling — 8.8 a catch in an offence that does not score means the touchdowns are the only path to a usable week. He is a name to know in the deepest leagues rather than a player to roster.",
          },
          {
            name: "Gunnar Helm",
            position: "TE",
            tier: "Streaming TE",
            thesis:
              "An 80% catch rate on a small, safe role.",
            stats: ["44 rec, 357 yds", "55 targets", "2 TD"],
            note:
              "Forty-four catches on fifty-five targets is exactly the outlet role a pressured quarterback creates, and it gives him a floor of three or four receptions most weeks. Three hundred and fifty-seven yards and two touchdowns is the whole ceiling. Stream him when the matchup is right and never plan a season around him.",
          },
          {
            name: "Calvin Ridley",
            position: "WR",
            tier: "Bench flier",
            thesis:
              "17.8 yards a catch in seven games, and no touchdowns at all.",
            stats: ["17 rec, 303 yds", "36 targets", "7 games"],
            note:
              "The per-catch number says the downfield ability is intact and thirty-six targets in seven games is a real role while he was available. Zero touchdowns on an offence that threw fifteen is the kind of luck that usually corrects. Seven games is why he will be cheap, and the offence is why cheap is the only price worth paying.",
          },
        ],
      },
    ],
    bottomLine:
      "Two players here are startable and both got there by absorbing volume from an offence that had nowhere else to put it. Robinson is a PPR-only asset and Pollard is a floor play; in standard scoring there is almost nothing on this roster worth a starting spot.",
  },
};

/** The outlook for a team, or null when none has been written. */
export function getTeamOutlook(abbreviation: string): TeamOutlook | null {
  return TEAM_OUTLOOKS[abbreviation] ?? null;
}
