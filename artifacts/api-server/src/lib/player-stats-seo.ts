/**
 * Metadata for the advanced player stats pages.
 *
 * Same posture as the other tools: everything is in the initial HTML, nothing
 * is amended by JavaScript, and the page ships `noindex, indexifembedded`
 * because the address that should rank is
 * `https://statchasers.com/nfl/nfl-player-stats/`, not this origin.
 *
 * Each position is its own page with its own canonical - it is a different
 * table of different players, which is why the standalone app gave it an
 * address. The season is NOT: it is a control, the canonical is built from the
 * path alone, and the title names the newest season whichever one is open.
 */

import { escapeHtml } from "./render";
import { statsPageCopy } from "./player-stats/stats-copy";
import {
  defaultSeason,
  type StatsPosition,
  type StatsTable,
} from "./player-stats/stats-data";

export interface StatsPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

/**
 * The title and description for one position's page - the words in
 * stats-copy.ts, which the WordPress plugin reads from the fragment rather
 * than keeping its own copy.
 */
export function statsPageMeta(
  position: StatsPosition,
  table: StatsTable | null,
  canonical: string,
): StatsPageMeta {
  const latest = defaultSeason();
  const season =
    typeof latest === "number"
      ? latest
      : table && typeof table.season === "number"
        ? table.season
        : new Date().getFullYear();
  const copy = statsPageCopy(position, season);
  return {
    title: `${copy.title} | ${SITE_NAME}`,
    description: copy.description,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderStatsHeadTags(meta: StatsPageMeta): string {
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
