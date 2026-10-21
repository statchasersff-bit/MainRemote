/**
 * Metadata for the injury pages.
 *
 * Same posture as the other tools: everything is in the initial HTML, and the
 * page ships `noindex, indexifembedded`, because the address that should rank
 * is the statchasers.com page that mounts [statchasers_injury_impact] or
 * [statchasers_injury_database], not this origin. There the plugin reads the
 * same words off the fragment's `scin-page-data` island.
 *
 * The words are injuryPageCopy in injury-impact/render-shared.ts: the app's
 * own H1s and lead sentences, since no live page mounts the tools yet. New
 * wording for search needs mak's approval.
 */

import { escapeHtml } from "./render";

export interface InjuryPageMeta {
  title: string;
  description: string;
  canonical: string;
}

const SITE_NAME = "StatChasers";

export function renderInjuryHeadTags(meta: InjuryPageMeta): string {
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
