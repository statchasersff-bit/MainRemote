/**
 * Metadata for the Fantasy Points Allowed page.
 *
 * Same posture as the other three tools: everything is in the initial HTML,
 * nothing is amended by JavaScript, and the page ships
 * `noindex, indexifembedded` because the address that should rank is
 * `https://statchasers.com/nfl/fantasy-points-allowed/`, not this origin.
 *
 * The canonical always points at the bare path. Scoring format and raw/adjusted
 * are the two pieces of state this page carries in a query string, and six
 * renderings of one table are one page — exactly the reasoning the player
 * pages' format toggle gets.
 */

import { escapeHtml } from "./render";
import type { FpaTableData } from "./fpa/fpa-data";

export interface FpaPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

export function fpaPageMeta(
  data: FpaTableData | null,
  canonical: string,
): FpaPageMeta {
  const season = data?.season ?? new Date().getUTCFullYear();
  const week = data && !data.isPreseason ? ` through Week ${data.weekNumber}` : "";

  return {
    title: `${season} Fantasy Points Allowed by Position | ${SITE_NAME}`,
    description:
      `Fantasy points allowed per game by all 32 NFL defenses to QBs, RBs, WRs ` +
      `and TEs${week}. Standard, Half-PPR and PPR, raw and schedule-adjusted, ` +
      `with ranks and a CSV export.`,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderFpaHeadTags(meta: FpaPageMeta): string {
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
