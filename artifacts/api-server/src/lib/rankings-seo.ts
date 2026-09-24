/**
 * Metadata for the rest-of-season rankings page.
 *
 * Same posture as the other four tools: everything is in the initial HTML,
 * nothing is amended by JavaScript, and the page ships
 * `noindex, indexifembedded` because the address that should rank is
 * `https://statchasers.com/fantasy-football/rest-of-season-rankings/`, not
 * this origin.
 *
 * Each position is its own page: `/rest-of-season-rankings/rb` is the running
 * back board, with its own title, description and canonical, the way a player's
 * `/injury` section is. "RB rankings" is a query people type on its own, and a
 * page that answers it should be able to rank for it rather than sit behind
 * the All board's canonical. The canonical is still built from the path alone,
 * so `?season=` and `?embed=` never mint a second one.
 */

import { escapeHtml } from "./render";
import {
  POSITION_NAMES,
  POSITION_PLURALS,
  type PositionFilter,
  type RankingsData,
} from "./rankings/rankings-data";

export interface RankingsPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

/**
 * The page's heading for a board: the title's phrase without the site name or
 * the plural gloss. One function, because three things must say it identically
 * — the WordPress page's H1 (from the fragment's `scr-page-data` island), each
 * position tab (`data-scr-heading`, which the bundle swaps into that H1 when a
 * tab switches boards in place) and the title below.
 */
export function rankingsHeading(
  season: number,
  position: PositionFilter = "All",
): string {
  return position === "All"
    ? `${season} Rest of Season Fantasy Football Rankings`
    : `${season} Rest of Season Fantasy Football ${position} Rankings`;
}

/**
 * The title, H1 and description the WordPress page wears, shipped in the
 * embed fragment so the plugin keeps no copy of the words. The title is
 * without the site name; the plugin appends its own.
 */
export function rankingsPageCopy(
  data: RankingsData,
  position: PositionFilter = "All",
): { title: string; h1: string; description: string } {
  const meta = rankingsPageMeta(data, "", position);
  return {
    title: meta.title.replace(` | ${SITE_NAME}`, ""),
    h1: rankingsHeading(data.season, position),
    description: meta.description,
  };
}

export function rankingsPageMeta(
  data: RankingsData | null,
  canonical: string,
  position: PositionFilter = "All",
): RankingsPageMeta {
  const season = data?.season ?? new Date().getUTCFullYear();
  const scoring = data?.scoring ?? "PPR";
  const updated = data && data.updatedAt !== "" ? ` Updated ${data.updatedAt}.` : "";

  if (position !== "All") {
    const plural = POSITION_PLURALS[position];
    return {
      title:
        `${rankingsHeading(season, position)}: ` +
        `${POSITION_NAMES[position]}s | ${SITE_NAME}`,
      description:
        `Free ${season} rest-of-season fantasy football ${position} rankings ` +
        `for ${scoring} ` +
        `leagues: every ranked ${plural.replace(/s$/, "")} by tier, with ` +
        `boards for the other positions a tab away and a CSV export.${updated}`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  return {
    title: `${rankingsHeading(season)} | ${SITE_NAME}`,
    description:
      `Free ${season} rest-of-season fantasy football rankings for ${scoring} leagues: ` +
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
