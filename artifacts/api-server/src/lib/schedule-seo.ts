/**
 * Metadata for the NFL schedule page.
 *
 * Same posture as the other five tools: everything is in the initial HTML,
 * nothing is amended by JavaScript, and the page ships
 * `noindex, indexifembedded` because the address that should rank is
 * `https://statchasers.com/nfl/nfl-schedule/`, not this origin.
 *
 * The canonical points at the path and never at a parameter, and there are
 * exactly two kinds of path. The bare one is the season matrix: the whole
 * season in one grid, the same page in December as in July. The other eighteen
 * are the weeks (`/schedule/week-2`), because Week 2 is not a way of looking at
 * the board — it is a different set of games, which is the whole reason it has
 * an address.
 *
 * Nothing else may mint one. Filter and season are ways of looking at a page
 * and are dropped on the way in, the same reasoning the FPA table's format
 * toggle gets; `?view=` is not read here at all, because the route redirects it
 * rather than rendering it.
 *
 * The title and description say which of the nineteen pages they are about —
 * eighteen weeks sharing one title are eighteen pages a search engine has no
 * reason to tell apart — and the wording differs by view, because a snippet
 * that says "browse by week" on the season grid is a worse answer than one
 * that does not.
 */

import { escapeHtml } from "./render";
import { TEAMS } from "./team/teams";
import { TOTAL_WEEKS } from "./schedule/schedule-data";
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
      title:
        `${season} NFL Schedule Grid: All ${TEAMS.length} Teams, ` +
        `Weeks 1–${TOTAL_WEEKS} | ${SITE_NAME}`,
      description:
        `The full ${season} NFL schedule for all ${TEAMS.length} teams in one ` +
        `grid: every team's opponents by week, home and away games, and every ` +
        `bye week from Week 1 through Week ${TOTAL_WEEKS}.`,
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
