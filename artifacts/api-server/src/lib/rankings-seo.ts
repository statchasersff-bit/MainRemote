/**
 * Metadata for the redraft rankings page.
 *
 * Same posture as the other four tools: everything is in the initial HTML,
 * nothing is amended by JavaScript, and the page ships
 * `noindex, indexifembedded` because the address that should rank is
 * `https://statchasers.com/fantasy-football/redraft-rankings/`, not this origin.
 *
 * The canonical always points at the bare path. The position tabs are fragments
 * (`#scr-panel-rb`), which never form a separate URL to begin with — five boards
 * of one set of rankings are one page, which is the same reasoning the player
 * pages' section bar gets.
 */

import { escapeHtml } from "./render";
import type { RankingsData } from "./rankings/rankings-data";

export interface RankingsPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

export function rankingsPageMeta(
  data: RankingsData | null,
  canonical: string,
): RankingsPageMeta {
  const season = data?.season ?? new Date().getUTCFullYear();
  const scoring = data?.scoring ?? "PPR";
  const updated = data && data.updatedAt !== "" ? ` Updated ${data.updatedAt}.` : "";

  return {
    title: `${season} Fantasy Football Redraft Rankings | ${SITE_NAME}`,
    description:
      `Free ${season} fantasy football redraft rankings for ${scoring} leagues: ` +
      `tiered quarterback, running back, wide receiver and tight end boards, ` +
      `plus an all-positions view and a CSV export.${updated}`,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderRankingsHeadTags(meta: RankingsPageMeta): string {
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
