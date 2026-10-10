/**
 * Metadata for the redraft strategy page.
 *
 * Same posture as the other tools: everything is in the initial HTML, and the
 * page ships `noindex, indexifembedded`, because the address that should rank
 * is the statchasers.com page that mounts [statchasers_redraft_strategy], not
 * this origin. There the plugin reads the same words off the fragment's
 * `scds-page-data` island (statchasers-redraft-strategy.php).
 *
 * The words are rdsPageCopy in redraft-strategy/render.ts: the live page's
 * own, carried here unchanged. The canonical is the bare path: the filters
 * are one page's controls.
 */

import { escapeHtml } from "./render";

export interface RdsPageMeta {
  title: string;
  description: string;
  canonical: string;
}

const SITE_NAME = "StatChasers";

export function renderRdsHeadTags(meta: RdsPageMeta): string {
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
