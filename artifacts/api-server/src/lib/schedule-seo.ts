/**
 * Metadata for the NFL schedule page.
 *
 * Same posture as the other five tools: everything is in the initial HTML,
 * nothing is amended by JavaScript, and the page ships
 * `noindex, indexifembedded` because the address that should rank is
 * `https://statchasers.com/nfl/nfl-schedule/`, not this origin.
 *
 * The canonical points at the path and never at a parameter. View, team and
 * filter are ways of looking at one board, and every rendering of them is the
 * same page — the same reasoning the FPA table's format toggle gets, and it
 * matters more here, because the three combine into several hundred URLs and
 * every one of them would otherwise be a near-duplicate of the others.
 *
 * The week is the exception, and the reason is that it is not a way of looking
 * at the board: Week 2 is a different set of games. It has an address of its
 * own (`/schedule/week-2`), the route hands the canonical in already built, and
 * the title and description below say which week they are about — eighteen
 * pages that share one title are eighteen pages a search engine has no reason
 * to tell apart.
 *
 * The description varies with the view too, because the three views are
 * genuinely about different things and a snippet that says "browse by week" on
 * the season matrix is a worse answer than one that does not.
 */

import { escapeHtml } from "./render";
import type { ScheduleSeason, ScheduleView } from "./schedule/schedule-data";

export interface SchedulePageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

export interface SchedulePageMetaInput {
  view: ScheduleView;
  week: number;
}

export function schedulePageMeta(
  schedule: ScheduleSeason | null,
  canonical: string,
  state: SchedulePageMetaInput,
): SchedulePageMeta {
  const season = schedule?.season ?? new Date().getUTCFullYear();

  if (state.view === "matrix") {
    return {
      title: `${season} NFL Schedule Grid: Every Team, Every Week | ${SITE_NAME}`,
      description:
        `All 32 NFL teams and all 18 weeks of the ${season} regular season in ` +
        `one grid, with byes marked and home and road games distinguished.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  return {
    title: `${season} NFL Schedule: Week ${state.week} | ${SITE_NAME}`,
    description:
      `Every Week ${state.week} game of the ${season} NFL regular season: ` +
      `matchups, dates, kickoff times in ET, TV networks, the teams on bye, ` +
      `division and international games, and the market's posted spreads and ` +
      `totals.`,
    canonical,
    siteName: SITE_NAME,
  };
}

export function renderScheduleHeadTags(meta: SchedulePageMeta): string {
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
