/**
 * Metadata for the rookie hit rate page.
 *
 * Same posture as the other tools: everything is in the initial HTML, and the
 * page ships `noindex, indexifembedded`, because the address that should rank
 * is the statchasers.com page that mounts [statchasers_rookie_hit_rates], not
 * this origin. There the plugin reads the same words off the fragment's
 * `schr-page-data` island (statchasers-rookie-hit-rates.php).
 *
 * The words are rhrPageCopy in rookie-hit-rates/render.ts, and are pending
 * mak's approval. The canonical is the bare path: the tabs and filters are one
 * page's controls.
 */

import { escapeHtml } from "./render";

export interface RhrPageMeta {
  title: string;
  description: string;
  canonical: string;
}

const SITE_NAME = "StatChasers";

export function renderRhrHeadTags(meta: RhrPageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join("\n  ");
}
