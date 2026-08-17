/**
 * Page metadata, built on the server.
 *
 * Everything here lands in the initial HTML response. None of it is set,
 * changed, or "corrected" by JavaScript after load: a crawler that never runs
 * the bundle still sees the final title, description, canonical and OG tags.
 *
 * The values are also deliberately consistent with each other — the <title>,
 * the visible <h1>, og:title and the tool's own heading are all derived from
 * the same two strings, so a search engine picking any one of those signals
 * arrives at the same wording.
 */

import { escapeHtml } from "./render";

export interface PageMeta {
  /** <title>. Longer than the H1: carries the qualifier and the brand. */
  title: string;
  /** Visible <h1>. The same phrase as the title, minus qualifier and brand. */
  heading: string;
  description: string;
  canonical: string;
  /** Absolute URL for og:url — the canonical, always. */
  ogUrl: string;
  siteName: string;
  season: number;
}

const SITE_NAME = "StatChasers";

/**
 * The NFL season a date belongs to. Seasons are named for the year they start,
 * and run into January/February, so those two months belong to the prior year.
 */
export function seasonYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  // getUTCMonth() is zero-based: 0 = January, 1 = February.
  return now.getUTCMonth() >= 2 ? year : year - 1;
}

/**
 * Build the metadata for the standalone tool page.
 *
 * @param canonical Canonical URL, already query-stripped (see lib/request.ts).
 * @param now       Injected for testability.
 */
export function pageMeta(canonical: string, now: Date = new Date()): PageMeta {
  const season = seasonYear(now);

  // Title and heading share their leading phrase on purpose. Google may derive
  // the displayed result title from <title>, the H1, og:title or prominent
  // page text; keeping them in agreement means every one of those routes
  // produces the same answer.
  const heading = `${season} Fantasy Football Player News`;
  const title = `${season} Fantasy Football Player News & Injury Updates | ${SITE_NAME}`;

  return {
    title,
    heading,
    description:
      `Browse ${season} fantasy football player news and injury updates for every NFL team. ` +
      `Headlines, publish times and sources for each report, updated continuously.`,
    canonical,
    ogUrl: canonical,
    siteName: SITE_NAME,
    season,
  };
}

/**
 * The <head> tags, as an HTML string injected at the SSR-HEAD marker.
 *
 * Note there is no `rel="canonical"` conflict with the robots meta already in
 * index.html: the canonical is self-referencing, which is the safe pairing.
 * Pointing a `noindex` page's canonical at a *different* URL sends Google
 * contradictory instructions, so we never do that.
 */
export function renderHeadTags(meta: PageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);

  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    // Placed directly in the HTML rather than injected by script — Google
    // treats an in-HTML canonical as the strong signal, and a JS-applied one
    // is only honoured if the page is rendered.
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.ogUrl)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join("\n  ");
}
