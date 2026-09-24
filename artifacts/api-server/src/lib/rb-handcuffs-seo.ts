/**
 * Metadata for the RB handcuff rankings page.
 *
 * Same posture as the other tools: everything is in the initial HTML, nothing
 * is amended by JavaScript, and the page ships `noindex, indexifembedded`
 * because the address that should rank is
 * `https://statchasers.com/rb-handcuff-rankings/`, not this origin. There,
 * Rank Math owns the title and description; the WordPress side adds only the
 * tool's own schema node (statchasers-rb-handcuffs.php).
 *
 * The weights are NOT part of any address. They are a control, as they were in
 * the standalone app, which kept them in component state and never wrote them
 * to the URL.
 */

import { escapeHtml } from "./render";
import type { HandcuffBoard } from "./rb-handcuffs/handcuffs-data";
import { seasonOf } from "./rb-handcuffs/handcuffs-data";

export interface HandcuffPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

/**
 * The page's title and description. The title is the one the standalone app's
 * index.html carried; the description is its schema node's.
 *
 * MIRRORS statchasers_rb_handcuffs_schema() in the WordPress plugin, which says
 * the same thing about the same tool on statchasers.com.
 */
export function handcuffPageMeta(
  board: HandcuffBoard | null,
  canonical: string,
): HandcuffPageMeta {
  const season = board?.season ?? seasonOf(null);
  return {
    title: `${season} Fantasy Football RB Handcuff Rankings | ${SITE_NAME}`,
    description:
      `Every NFL backup running back ranked as a fantasy football handcuff for the ${season} ` +
      `season, scored on backfield opportunity, path to opportunity and player quality, ` +
      `with adjustable scoring weights and side-by-side comparison.`,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderHandcuffHeadTags(meta: HandcuffPageMeta): string {
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
