/**
 * The FAQ under the strength-of-schedule board.
 *
 * mak's questions and answers (2026-10-08), printed as written, with two
 * kinds of fill-in: the season, wherever the copy names a year, and the four
 * team answers (easiest and toughest full-season and playoff schedules for
 * running backs in PPR), which quote the board's own summary cards so they
 * move with the board instead of going stale. The facts come from the RB/PPR
 * board whatever view the fragment shows, because the copy says "PPR" and
 * "running backs" in so many words.
 *
 * On the page only: no FAQ schema is emitted here (the SOS page prints title,
 * H1 and description and nothing else, by mak's 2026-09-30 decision).
 */
import { escapeHtml } from "./render";
import type { SosBoard } from "./sos/sos-model";

export interface SosFaqTeamFact {
  city: string;
  nickname: string;
  fullName: string;
  /** Opponent aFPA the card shows, one decimal. */
  afpa: number;
  /** Against the league mean, signed. */
  delta: number;
  /** The team's rank on the ranking the card sorts by, 1 = easiest. */
  rank: number;
}

export interface SosFaqFacts {
  easiestFull: SosFaqTeamFact;
  toughestFull: SosFaqTeamFact;
  easiestPlayoff: SosFaqTeamFact;
  toughestPlayoff: SosFaqTeamFact;
}

/** The four team answers' numbers, from the RB/PPR board's cards; null if the board is another one or has no cards. */
export function sosFaqFacts(board: SosBoard | null): SosFaqFacts | null {
  if (!board || board.position !== "RB" || board.scoring !== "ppr") return null;
  const fact = (id: SosBoard["teamCards"][number]["id"]): SosFaqTeamFact | null => {
    const card = board.teamCards.find((c) => c.id === id);
    if (!card) return null;
    const row = board.teams.find((t) => t.team.abbreviation === card.team.abbreviation);
    const rank = card.sortKey === "playoff" ? row?.playoffRank : row?.overallRank;
    return {
      city: card.team.city,
      nickname: card.team.nickname,
      fullName: card.team.fullName,
      afpa: card.afpa,
      delta: card.delta,
      rank: rank ?? (card.tone === "good" ? 1 : 32),
    };
  };
  const easiestFull = fact("easiest-full");
  const toughestFull = fact("toughest-full");
  const easiestPlayoff = fact("easiest-playoff");
  const toughestPlayoff = fact("toughest-playoff");
  if (!easiestFull || !toughestFull || !easiestPlayoff || !toughestPlayoff) return null;
  return { easiestFull, toughestFull, easiestPlayoff, toughestPlayoff };
}

const one = (n: number): string => n.toFixed(1);

/** "1.3 points above the league average", "0.8 points below ...", or "level with ...". */
function vsAverage(delta: number): string {
  const r = Math.round(Math.abs(delta) * 10) / 10;
  if (r === 0) return "level with the league average";
  return `${one(r)} points ${delta > 0 ? "above" : "below"} the league average`;
}

interface Faq {
  q: string;
  /** Paragraphs, already HTML (the copy's own emphasis is the only markup). */
  a: string[];
}

const e = escapeHtml;

function questions(season: number, facts: SosFaqFacts | null): Faq[] {
  const prior = season - 1;
  const f = facts;
  return [
    {
      q: `What is the ${season} NFL strength of schedule?`,
      a: [
        "NFL strength of schedule measures how difficult a team's upcoming opponents are expected to be. Traditional NFL strength of schedule is usually based on opponent records or team strength, while fantasy football strength of schedule looks at how favorable those opponents are for specific fantasy positions.",
        `The StatChasers ${season} Fantasy Football Strength of Schedule rankings evaluate schedules separately for quarterbacks, running backs, wide receivers, and tight ends using adjusted fantasy points allowed (aFPA).`,
      ],
    },
    {
      q: "What is fantasy football strength of schedule?",
      a: [
        "Fantasy football strength of schedule, or fantasy SOS, measures how favorable a team's schedule is for fantasy production at a specific position.",
        "Instead of asking whether an NFL opponent is simply good or bad, fantasy SOS asks how many adjusted fantasy points that defense allows to QBs, RBs, WRs, or TEs. A defense can be difficult for one position and favorable for another, which is why positional strength of schedule is more useful for fantasy football.",
      ],
    },
    {
      q: `Who has the easiest fantasy football strength of schedule in ${season}?`,
      a: [
        "The team with the easiest fantasy football schedule depends on the position, scoring format, and portion of the season you are evaluating.",
        `Use the QB, RB, WR, and TE filters above to see the easiest ${season} fantasy schedules for each position. You can also switch between full-season, rest-of-season, and fantasy playoff strength of schedule rankings.`,
      ],
    },
    {
      q: `Who has the hardest fantasy football strength of schedule in ${season}?`,
      a: [
        "The hardest fantasy football schedule also varies by position. A team may have a difficult schedule for running backs but a much more favorable schedule for wide receivers or quarterbacks.",
        "In the StatChasers rankings, a schedule rank of 32 represents the toughest schedule for the selected position and time period.",
      ],
    },
    {
      q: `Which NFL team has the easiest schedule for running backs in ${season}?`,
      a: [
        f
          ? `For ${season} PPR scoring, the ${e(f.easiestFull.fullName)} currently rank No. ${f.easiestFull.rank} in full-season running back strength of schedule. Their opponents average ${one(f.easiestFull.afpa)} adjusted fantasy points allowed to running backs, which is ${vsAverage(f.easiestFull.delta)}.`
          : `For ${season} PPR scoring, the Easiest Full-Season card above names the team at No. 1 in full-season running back strength of schedule, with its opponents' average adjusted fantasy points allowed to running backs.`,
        "Because defensive performance changes throughout the season, these rankings can move as new games are played.",
      ],
    },
    {
      q: `Which NFL team has the hardest schedule for running backs in ${season}?`,
      a: [
        f
          ? `For ${season} PPR scoring, the ${e(f.toughestFull.fullName)} currently rank No. ${f.toughestFull.rank} in full-season running back strength of schedule. Their opponents average ${one(f.toughestFull.afpa)} adjusted fantasy points allowed to running backs, ${vsAverage(f.toughestFull.delta)}.`
          : `For ${season} PPR scoring, the Toughest Full-Season card above names the team at No. 32 in full-season running back strength of schedule, with its opponents' average adjusted fantasy points allowed to running backs.`,
        "A difficult schedule does not mean a running back should automatically be benched. Talent, workload, offensive environment, injuries, and game script still matter.",
      ],
    },
    {
      q: `Which running backs have the easiest fantasy playoff schedule in ${season}?`,
      a: [
        f
          ? `${e(f.easiestPlayoff.city)} currently has the easiest ${season} fantasy playoff schedule for running backs in PPR scoring. ${e(f.easiestPlayoff.nickname)} running backs face opponents allowing an average of ${one(f.easiestPlayoff.afpa)} adjusted fantasy points to the position during the selected playoff window.`
          : `The Easiest Playoff card above names the team with the easiest ${season} fantasy playoff schedule for running backs in PPR scoring, with the average adjusted fantasy points its opponents allow to the position during the selected playoff window.`,
        "Use the Player SOS view to evaluate individual running backs alongside their projected playoff matchups.",
      ],
    },
    {
      q: `Which running backs have the hardest fantasy playoff schedule in ${season}?`,
      a: [
        f
          ? `${e(f.toughestPlayoff.city)} currently has the toughest ${season} fantasy playoff schedule for running backs in PPR scoring. The ${e(f.toughestPlayoff.nickname)}' playoff opponents allow an average of ${one(f.toughestPlayoff.afpa)} adjusted fantasy points to running backs.`
          : `The Toughest Playoff card above names the team with the toughest ${season} fantasy playoff schedule for running backs in PPR scoring, with the average adjusted fantasy points its playoff opponents allow to running backs.`,
        "Fantasy playoff strength of schedule can be especially useful when comparing closely valued players in trades or when preparing for Weeks 15–17.",
      ],
    },
    {
      q: "What is fantasy football playoff strength of schedule?",
      a: [
        "Fantasy football playoff strength of schedule measures the quality of a player's or team's matchups during the weeks that typically decide fantasy championships.",
        "Rather than averaging the entire NFL season, playoff SOS focuses on the fantasy playoff window. This can reveal players with favorable late-season schedules even when their overall strength of schedule is only average.",
      ],
    },
    {
      q: "What does aFPA mean in fantasy football?",
      a: [
        "aFPA stands for adjusted Fantasy Points Allowed. It measures how many fantasy points a defense allows to a particular position while adjusting the raw results to make opponent matchups more comparable.",
        "On the StatChasers Strength of Schedule board, a higher aFPA generally means an easier matchup for the selected fantasy position, while a lower aFPA indicates a tougher matchup.",
      ],
    },
    {
      q: "How do I read fantasy football strength of schedule rankings?",
      a: [
        "StatChasers ranks all 32 NFL teams from easiest to hardest for the selected fantasy position.",
        "A rank of <strong>1</strong> means the easiest schedule, while <strong>32</strong> means the toughest schedule. Higher aFPA values indicate more favorable fantasy matchups.",
        "Each weekly cell shows the opponent and that defense's aFPA against the selected position. Green or favorable matchups indicate defenses allowing more fantasy production, while tougher matchups indicate defenses allowing less.",
      ],
    },
    {
      q: "What is the difference between OVR, ROS, and Playoff SOS?",
      a: [
        "<strong>OVR</strong> ranks the team's strength of schedule across the full season.",
        "<strong>ROS</strong> means rest of season and ranks only the games that have not yet been played.",
        "<strong>Playoff SOS</strong> focuses on the fantasy playoff weeks, helping identify players with favorable or difficult schedules when fantasy championships are decided.",
        "These rankings can differ significantly because a team with a difficult early schedule may have an excellent remaining or playoff schedule.",
      ],
    },
    {
      q: "Does strength of schedule matter in fantasy football?",
      a: [
        "Yes, but strength of schedule should be used as a tiebreaker rather than as the only reason to start, sit, trade, or draft a player.",
        "Volume, talent, offensive role, injuries, scoring format, and team environment generally matter more. SOS becomes particularly valuable when choosing between similarly ranked players or identifying favorable stretches for trades and fantasy playoff preparation.",
      ],
    },
    {
      q: "Should I use strength of schedule for fantasy football trades?",
      a: [
        "Fantasy strength of schedule can help identify trade targets whose upcoming matchups are better than their season-long production suggests.",
        "Look for players with stable roles and strong usage who also have favorable rest-of-season or fantasy playoff schedules. Conversely, an extremely difficult upcoming schedule can be one factor to consider when deciding whether to sell a player at peak value.",
      ],
    },
    {
      q: "Does fantasy strength of schedule change during the season?",
      a: [
        "Yes. Fantasy football strength of schedule should change as new information becomes available.",
        `Defenses can improve or decline because of injuries, personnel changes, coaching adjustments, and opponent quality. StatChasers uses a ${prior}–${season} data blend early in the season so the rankings are not based on only a few ${season} games. As more current-season data becomes available, the rankings become increasingly reflective of ${season} defensive performance.`,
      ],
    },
    {
      q: "Is PPR strength of schedule different from Half-PPR or Standard?",
      a: [
        "Yes. The scoring format can change how favorable a defense appears against a position.",
        "PPR scoring gives additional value to receptions, which can significantly affect running backs, wide receivers, and tight ends. Use the PPR, Half-PPR, and Standard filters to view strength of schedule rankings for your league's scoring format.",
      ],
    },
    {
      q: "How is running back strength of schedule calculated?",
      a: [
        "Running back strength of schedule is calculated from the fantasy production allowed by each upcoming opponent to running backs.",
        "StatChasers uses adjusted fantasy points allowed rather than simply looking at opponent win-loss records. The schedule score combines those matchup values across the selected period to rank every NFL team's RB schedule from easiest to toughest.",
      ],
    },
    {
      q: "What is the easiest remaining schedule in fantasy football?",
      a: [
        "The easiest remaining fantasy football schedule depends on position and scoring format. A team can rank highly for RB strength of schedule but poorly for QB, WR, or TE strength of schedule.",
        `Select <strong>ROS</strong> and choose QB, RB, WR, or TE above to see which NFL teams have the easiest remaining fantasy schedules in ${season}.`,
      ],
    },
    {
      q: "What is the best strength of schedule for fantasy football playoffs?",
      a: [
        "There is no single best playoff schedule for every fantasy player because defensive matchups affect positions differently.",
        "Use the Playoff SOS rankings to compare quarterbacks, running backs, wide receivers, and tight ends separately. A favorable Weeks 15–17 schedule can be especially useful when evaluating trade targets, roster depth, and close start/sit decisions ahead of the fantasy playoffs.",
      ],
    },
    {
      q: "Is NFL strength of schedule the same as fantasy football strength of schedule?",
      a: [
        "No. Traditional NFL strength of schedule usually evaluates how difficult a team's opponents are overall, often using records, projected wins, or team-quality ratings.",
        "Fantasy football strength of schedule measures how favorable those defenses are for fantasy production at a specific position. For fantasy managers, positional SOS is generally more relevant because a defense may be excellent against running backs while still allowing significant production to wide receivers or tight ends.",
      ],
    },
  ];
}

export const SOS_FAQ_HEADING = "Fantasy Football Strength of Schedule FAQ";

/** The questions, for anything that needs the list without the markup (tests, a future schema). */
export function sosFaqEntries(season: number, facts: SosFaqFacts | null): { question: string; answer: string }[] {
  return questions(season, facts).map((f) => ({
    question: f.q,
    answer: f.a.map((p) => p.replace(/<[^>]+>/g, "")).join(" "),
  }));
}

/**
 * One fold per question, shut by default, the team hubs' arrangement
 * (usage-render.ts): every question shows, the answer opens under the one the
 * reader came for.
 */
export function renderSosFaq(season: number, facts: SosFaqFacts | null): string {
  const items = questions(season, facts)
    .map(
      (f) =>
        `<details class="scsos-faq-item">` +
        `<summary class="scsos-faq-q-row"><h3 class="scsos-faq-q">${e(f.q)}</h3></summary>` +
        `<div class="scsos-faq-a">${f.a.map((p) => `<p>${p}</p>`).join("")}</div>` +
        `</details>`,
    )
    .join("");
  return (
    `<section class="scsos-faq" aria-labelledby="scsos-faq-title">` +
    `<h2 id="scsos-faq-title" class="scsos-faq-title">${e(SOS_FAQ_HEADING)}</h2>` +
    `<div class="scsos-faq-list">${items}</div>` +
    `</section>`
  );
}
