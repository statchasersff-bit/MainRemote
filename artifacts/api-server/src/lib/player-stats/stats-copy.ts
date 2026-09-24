/**
 * The words on the player stats page: its titles, headings, introductory copy
 * and FAQ.
 *
 * Written to an SEO brief (2026-09-23) whose point is the keyword order:
 *
 *   1. NFL player stats
 *   2. fantasy football stats
 *   3. the position's own stats — passing, rushing, receiving
 *   4. advanced NFL stats
 *
 * "Advanced" is why the page is better, not what it is called. The table was
 * titled "Advanced Stats & Grades", which is accurate and narrower than what
 * people search for.
 *
 * One module for both hosts. The WordPress plugin does not keep a copy of any
 * of this: the fragment carries the page's title, H1 and description in an
 * inert island (renderMetaIsland() in player-stats-render.ts) and the FAQ in
 * another, and the plugin reads both. So a reworded title is one edit here,
 * and the season in it is always the one the API is serving.
 */

import type { StatsPosition } from "./stats-data";

/* ----------------------------------------------------------- per position */

interface PositionCopy {
  /** "Wide Receiver", as it reads in "2026 NFL Wide Receiver Stats". */
  name: string;
  /** The meta description of the position's own address. */
  description: (season: string) => string;
}

export const POSITION_COPY: Record<StatsPosition, PositionCopy> = {
  QB: {
    name: "Quarterback",
    description: (s) =>
      `${s} NFL quarterback stats: passing yards, touchdowns, completion % and fantasy points, ` +
      `plus advanced QB stats like air yards, EPA, CPOE and pressure rate.`,
  },
  RB: {
    name: "Running Back",
    description: (s) =>
      `${s} NFL running back stats: rushing yards, carries, touchdowns, targets and fantasy points, ` +
      `plus advanced RB stats like snap share, yards after contact and broken tackles.`,
  },
  WR: {
    name: "Wide Receiver",
    description: (s) =>
      `${s} NFL wide receiver stats: receiving yards, targets, receptions and fantasy points, ` +
      `plus advanced receiving stats like target share, air yards and yards per route run.`,
  },
  TE: {
    name: "Tight End",
    description: (s) =>
      `${s} NFL tight end stats: receiving yards, targets, receptions and fantasy points, ` +
      `plus advanced TE stats like target share, route rate and yards per route run.`,
  },
};

/* ------------------------------------------------------------- the page */

export interface StatsPageCopy {
  /** The document title, less the " | StatChasers" suffix. */
  title: string;
  /** The page's H1. */
  h1: string;
  description: string;
}

/**
 * The title, H1 and description of one address.
 *
 * The bare address is the master page — NFL player stats across every
 * position — though it opens on the quarterback table. Each other position is
 * its own address and page, titled for that position. The season is the one
 * the address opens on, never a season a reader switched to.
 */
export function statsPageCopy(position: StatsPosition, season: number): StatsPageCopy {
  if (position === "QB") {
    return {
      title: `${season} NFL Player Stats & Fantasy Football Stats`,
      h1: `${season} NFL Player Stats & Fantasy Football Stats`,
      description:
        `Compare ${season} NFL player stats for QBs, RBs, WRs and TEs: passing, rushing, ` +
        `receiving, fantasy football and advanced stats, with StatChasers player grades.`,
    };
  }
  const name = POSITION_COPY[position].name;
  return {
    title: `${season} NFL ${name} Stats & Fantasy Football Stats`,
    h1: `${season} NFL ${name} Stats & Fantasy Football Stats`,
    description: POSITION_COPY[position].description(String(season)),
  };
}

/** The two paragraphs under the H1. */
export function introCopy(season: number): string[] {
  return [
    `Compare ${season} NFL player stats for quarterbacks, running backs, wide receivers and tight ends.`,
    `View passing, rushing, receiving, fantasy football and advanced stats including targets, ` +
      `target share, air yards, snap share, yards per route run, red-zone usage and StatChasers ` +
      `player grades.`,
  ];
}

/** The block after the table. */
export const ADVANCED_COPY = {
  label: "Advanced Analysis",
  heading: "Advanced NFL Stats for Fantasy Football",
  paragraphs: [
    "Traditional box-score stats tell you what happened. Advanced stats can help explain how it happened.",
    "StatChasers combines fantasy points and traditional NFL player stats with usage and efficiency " +
      "metrics such as snap share, target share, air yards, yards per route run, red-zone " +
      "opportunities, yards after catch and more.",
  ],
};

/* ------------------------------------------------------------------- faq */

export interface StatsFaq {
  question: string;
  answer: string;
}

export const STATS_FAQ_LABEL = "Questions";
export const STATS_FAQ_HEADING = "NFL Player Stats FAQ";

/**
 * The questions, phrased the way they are typed into a search bar.
 *
 * Copy as supplied. One answer names the season: it is the newest the API has,
 * so it moves when a new season's file lands.
 */
export function statsFaq(season: number): StatsFaq[] {
  return [
    {
      question: "Where can I find NFL player stats?",
      answer:
        "StatChasers provides NFL player stats for quarterbacks, running backs, wide receivers and " +
        "tight ends. Filter players by season and position, then compare fantasy production, passing, " +
        "rushing, receiving, usage and advanced NFL stats.",
    },
    {
      question: "Where can I find fantasy football stats?",
      answer:
        "The StatChasers Player Stats table includes fantasy football stats alongside NFL usage and " +
        "performance data. Compare fantasy points with targets, snaps, receiving production, rushing " +
        "production, opportunity and advanced efficiency metrics.",
    },
    {
      question: `Who are the NFL stat leaders in ${season}?`,
      answer:
        `Use the StatChasers player stats table to sort the ${season} season by fantasy points, ` +
        "targets, receptions, receiving yards, touchdowns, opportunity metrics and other NFL player stats.",
    },
    {
      question: "Where can I find NFL wide receiver stats?",
      answer:
        "Select WR to view NFL wide receiver stats including targets, receptions, receiving yards, " +
        "touchdowns, air yards, target share, yards after catch and other advanced receiving metrics.",
    },
    {
      question: "Where can I find NFL receiving stats?",
      answer:
        "The receiving stats table includes receptions, receiving yards, touchdowns, targets, yards per " +
        "reception, air yards, yards after catch and additional opportunity and efficiency metrics for " +
        "NFL pass catchers.",
    },
    {
      question: "Where can I find NFL quarterback stats?",
      answer:
        "Select QB to compare NFL quarterback passing and fantasy football stats, along with advanced " +
        "metrics that measure efficiency and passing performance.",
    },
    {
      question: "Where can I find NFL running back stats?",
      answer: "Select RB to compare rushing, receiving, fantasy football and advanced running back stats.",
    },
    {
      question: "Where can I find NFL tight end stats?",
      answer: "Select TE to compare receiving, fantasy football, usage and advanced stats for NFL tight ends.",
    },
    {
      question: "What are advanced NFL stats?",
      answer:
        "Advanced NFL stats provide additional context beyond traditional box-score totals. Metrics " +
        "such as target share, snap share, air yards, yards per route run, EPA and red-zone usage can " +
        "help measure how players are being used and how efficiently they are producing.",
    },
    {
      question: "Can I view NFL stats by season?",
      answer:
        "Yes. StatChasers lets you switch between individual seasons and multi-season views to compare " +
        "how player usage and production change over time.",
    },
    {
      question: "Can I view NFL stats per game?",
      answer:
        "Yes. Switch between totals and per-game stats to compare players with different numbers of " +
        "games played.",
    },
    {
      question: "How often are the NFL player stats updated?",
      answer:
        "NFL player stats are updated as new game data becomes available. The table shows the season, " +
        "weeks included and most recent update date.",
    },
  ];
}
