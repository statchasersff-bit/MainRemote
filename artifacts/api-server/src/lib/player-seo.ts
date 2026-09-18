/**
 * Metadata for a player page.
 *
 * Same posture as the news tool (lib/seo.ts) and the team hubs (lib/team-seo.ts):
 * everything is in the initial HTML, nothing is amended by JavaScript, and the
 * canonical is a plain tag rather than something applied at runtime.
 *
 * These pages are not meant to rank on this origin. The public URL is
 * `https://statchasers.com/nfl/players/<slug>/`, and WordPress owns the title,
 * description, canonical and schema there. What this server serves is the
 * embedded tool, so it ships `noindex, indexifembedded` — out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 *
 * The canonical stays self-referencing and always points at the PPR URL. The
 * scoring format is the one piece of genuine state these pages carry in a query
 * string, and three formats of the same profile are three renderings of one
 * page, not three pages — so `?format=half` canonicalises to the bare slug.
 */

import { escapeHtml } from "./render";
import type { PlayerPageData } from "./player/player-data";

export interface PlayerPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
  /** Absolute headshot URL for og:image, when there is one. */
  image: string | null;
}

const SITE_NAME = "StatChasers";

export function playerPageMeta(
  data: PlayerPageData,
  canonical: string,
): PlayerPageMeta {
  const { player, team, season } = data;
  const position = player.position ? `${player.position} ` : "";
  const teamName = team ? ` | ${team.fullName}` : "";

  // The description names what is actually on the page and the season it
  // describes. No superlatives, and no claim about next season — see rule 3 in
  // player-render.ts.
  const description =
    `${player.name} ${position}fantasy football stats and analysis: ` +
    `${season} game log, weekly finishes, advanced metrics, injury history ` +
    `and career production.`;

  return {
    title: `${player.name} Fantasy Football Stats & Analysis${teamName} | ${SITE_NAME}`,
    description,
    canonical,
    siteName: SITE_NAME,
    image: player.headshotUrl ?? null,
  };
}

export function renderPlayerHeadTags(meta: PlayerPageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    // "profile" rather than "website": this page is about a person.
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
  }
  return tags.join("\n  ");
}
