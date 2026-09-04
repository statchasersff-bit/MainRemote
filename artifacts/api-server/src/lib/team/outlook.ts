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
};

/** The outlook for a team, or null when none has been written. */
export function getTeamOutlook(abbreviation: string): TeamOutlook | null {
  return TEAM_OUTLOOKS[abbreviation] ?? null;
}
