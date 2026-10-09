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
 * embedded tool, so it ships `noindex, indexifembedded` - out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 * The canonical stays self-referencing, because pointing a noindex page's
 * canonical somewhere else is a contradictory signal.
 */

import { escapeHtml } from "./render";
import type { NflTeam } from "./team/teams";
import { fitTitle } from "./title-fit";

export interface TeamPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
  /** "article" for a game recap; "website" when absent. */
  ogType?: string;
  /** A large share image: absolute URL, 1200×630, with its alt text. */
  image?: { url: string; width: number; height: number; alt: string } | null;
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
 * owns the title and this origin is noindex. The two must say the same thing -
 * a reader who lands on the API page and a reader who lands on the WordPress
 * page are on the same page - so changing one means changing the other.
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

  // Approved by mak 2026-09-30 with the Usage tab's own address.
  if (section === "usage") {
    return {
      title: fitTitle([
        `${name} Target Share & Snap Counts ${season}: Usage Report`,
        `${name} Target Share & Snap Counts ${season}`,
      ]),
      description:
        `${name} target share, snap share and red-zone touches for ${season}, updated every ` +
        `Tuesday: the ${nick} target tree, backfield split, pass map and buy-low / sell-high signals.`,
    };
  }

  if (section === "stats") {
    return {
      title: fitTitle([
        `${name} Stats ${season}: Offense, Defense & NFL Rankings`,
        `${name} Stats ${season}: Offense & Defense Rankings`,
      ]),
      description:
        `${name} team stats for ${season}: points, yards, pace and play mix on offense ` +
        `and defense, each with the ${nick} rank among all 32 teams.`,
    };
  }

  if (section === "schedule") {
    return {
      title: fitTitle([
        `${name} Schedule ${season}: Dates, Opponents & Results`,
        `${name} Schedule ${season}: Opponents & Results`,
      ]),
      description:
        `The full ${season} ${name} schedule: every opponent, kickoff time and result, ` +
        `plus the ${nick} bye week and what is next on the calendar.`,
    };
  }

  if (section === "matchups") {
    return {
      title: fitTitle([
        `${name} Matchups ${season}: Opponents & Head-to-Head`,
        `${name} Matchups ${season}: Opponents & Results`,
      ]),
      description:
        `Every ${name} opponent in ${season}, week by week, with results and a matchup ` +
        `page for each pair: team stats side by side, injuries and the head-to-head record.`,
    };
  }

  if (section === "news") {
    return {
      title: fitTitle([
        `${name} News ${season}: Injuries, Moves & Fantasy Impact`,
        `${name} News ${season}: Injuries & Roster Moves`,
      ]),
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

/** The hub's own title: "Buffalo Bills 2026: Record, Schedule, Stats & Fantasy". */
export function teamHubTitle(team: NflTeam, season: number): string {
  return fitTitle([
    `${team.fullName} ${season}: Record, Schedule, Stats & Fantasy`,
    `${team.fullName} ${season}: Record, Schedule & Stats`,
  ]);
}

export function teamPageMeta(
  team: NflTeam,
  season: number,
  canonical: string,
  section?: string,
): TeamPageMeta {
  const scoped = section ? sectionMeta(team, season, section) : null;

  return {
    // Every title is a fitTitle() ladder and none carries " | StatChasers"
    // (mak, 2026-10-08). The hub's is the one the WordPress page builder
    // stores - statchasers_team_section_meta() with no section.
    title: scoped?.title ?? teamHubTitle(team, season),
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
    `<meta property="og:type" content="${escapeHtml(meta.ogType ?? "website")}" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    ...(meta.image
      ? [
          `<meta property="og:image" content="${escapeHtml(meta.image.url)}" />`,
          `<meta property="og:image:width" content="${meta.image.width}" />`,
          `<meta property="og:image:height" content="${meta.image.height}" />`,
          `<meta property="og:image:alt" content="${escapeHtml(meta.image.alt)}" />`,
          `<meta name="twitter:image" content="${escapeHtml(meta.image.url)}" />`,
          `<meta name="twitter:image:alt" content="${escapeHtml(meta.image.alt)}" />`,
        ]
      : []),
  ].join("\n  ");
}
