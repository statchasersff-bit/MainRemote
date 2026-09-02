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
};

/** The outlook for a team, or null when none has been written. */
export function getTeamOutlook(abbreviation: string): TeamOutlook | null {
  return TEAM_OUTLOOKS[abbreviation] ?? null;
}
