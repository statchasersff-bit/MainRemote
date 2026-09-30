/**
 * Metadata for the strength-of-schedule page.
 *
 * Same posture as the other tools: everything is in the initial HTML, and the
 * page ships `noindex, indexifembedded`, because the address that should rank
 * is https://statchasers.com/nfl/fantasy-football-strength-of-schedule/, not
 * this origin. There the plugin reads the same words off the fragment's
 * `scsos-page-data` island (statchasers-sos.php).
 *
 * The words are the source app's, approved by mak on 2026-09-30 (sosPageCopy
 * in sos-render.ts). The canonical is the bare path: the tab, position and
 * scoring are one page's controls, so no combination of them is a second page.
 */

import { escapeHtml } from "./render";

export interface SosPageMeta {
  title: string;
  description: string;
  canonical: string;
}

const SITE_NAME = "StatChasers";

export function renderSosHeadTags(meta: SosPageMeta): string {
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
