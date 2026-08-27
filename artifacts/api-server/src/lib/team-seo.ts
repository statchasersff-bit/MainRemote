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

export function teamPageMeta(
  team: NflTeam,
  season: number,
  canonical: string,
): TeamPageMeta {
  return {
    title: `${season} ${team.fullName} Fantasy Football Hub | ${SITE_NAME}`,
    description:
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
