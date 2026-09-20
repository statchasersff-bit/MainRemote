/**
 * Metadata for a team hub page.
 *
 * Same posture as the news tool (lib/seo.ts): everything is rendered into the
 * initial HTML, nothing is set or amended by JavaScript, and the canonical is a
 * plain in-HTML tag rather than something applied at runtime.
 *
 * These pages are not meant to rank on this origin. The public URL is
 * `https://statchasers.com/nfl/teams/<slug>/`, and WordPress owns the title,
 * description, canonical and schema there. What this server serves is the
 * embedded tool, so it ships `noindex, indexifembedded` — out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 * The canonical stays self-referencing, because pointing a noindex page's
 * canonical somewhere else is a contradictory signal.
 */

import { escapeHtml } from "./render";
import type { NflTeam } from "./team/teams";

export interface TeamPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

/**
 * Title and description for a section-scoped page.
 *
 * A section URL exists to answer one kind of query, so it gets a title written
 * for that query rather than the hub's. Same posture as sectionMeta() in
 * lib/player-seo.ts.
 *
 * MIRRORED IN PHP. statchasers_team_section_meta() in the WordPress plugin
 * builds the same strings for Rank Math, because on statchasers.com Rank Math
 * owns the title and this origin is noindex. The two must say the same thing —
 * a reader who lands on the API page and a reader who lands on the WordPress
 * page are on the same page — so changing one means changing the other.
 *
 * Returns null for a section with no written metadata; the caller falls back to
 * the hub's.
 */
function sectionMeta(
  team: NflTeam,
  season: number,
  section: string,
): { title: string; description: string } | null {
  const name = team.fullName;
  const nick = team.nickname;

  if (section === "outlook") {
    return {
      title: `${name} Fantasy Football Outlook ${season}`,
      description:
        `${name} fantasy outlook for ${season}: projected win total, offensive pace and ` +
        `pass rate, the ${nick} players who carry fantasy value and the roles behind them.`,
    };
  }

  if (section === "stats") {
    return {
      title: `${name} Stats ${season}: Offense, Defense & NFL Rankings`,
      description:
        `${name} team stats for ${season}: points, yards, pace and play mix on offense ` +
        `and defense, each with the ${nick} rank among all 32 teams.`,
    };
  }

  if (section === "schedule") {
    return {
      title: `${name} Schedule ${season}: Dates, Opponents & Results`,
      description:
        `The full ${season} ${name} schedule: every opponent, kickoff time and result, ` +
        `plus the ${nick} bye week and what is next on the calendar.`,
    };
  }

  if (section === "matchups") {
    return {
      title: `${name} Matchups ${season}: Opponents, Results & Head-to-Head`,
      description:
        `Every ${name} opponent in ${season}, week by week, with results and a matchup ` +
        `page for each pair: team stats side by side, injuries and the head-to-head record.`,
    };
  }

  if (section === "news") {
    return {
      title: `${name} News ${season}: Injuries, Roster Moves & Fantasy Impact`,
      description:
        `The latest ${name} news: injury designations, roster moves and depth-chart ` +
        `changes through the ${season} season, each with what it means for ${nick} fantasy value.`,
    };
  }

  if (section === "depth-chart") {
    return {
      title: `${name} Depth Chart ${season}: Starters & Backups`,
      description:
        `The ${name} offensive depth chart for ${season}: starters and backups by ` +
        `position, with the ${nick} roles that decide fantasy value.`,
    };
  }

  return null;
}

export function teamPageMeta(
  team: NflTeam,
  season: number,
  canonical: string,
  section?: string,
): TeamPageMeta {
  const scoped = section ? sectionMeta(team, season, section) : null;

  return {
    title: scoped
      ? `${scoped.title} | ${SITE_NAME}`
      : `${season} ${team.fullName} Fantasy Football Hub | ${SITE_NAME}`,
    description:
      scoped?.description ??
      `${team.fullName} fantasy football hub: the latest ${team.nickname} player news, ` +
        `injury designations, offensive depth chart, ${season} schedule and fantasy outlook.`,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderTeamHeadTags(meta: TeamPageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join("\n  ");
}
