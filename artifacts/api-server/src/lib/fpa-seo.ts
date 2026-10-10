/**
 * The words on the Fantasy Points Allowed page: title, H1, description, the
 * answer sentence above the table and the "Updated" line under the heading.
 *
 * Mak's spec of 2026-10-10 ("Fantasy points allowed: week range in the title,
 * a 2025 archive, and start/sit links"). Searchers want to know how current
 * the data is, so the week range is in the title and the H1, and the figures
 * the page leads with are stated in a sentence a crawler can quote.
 *
 * Pure, and in one place: the standalone page prints these itself, the
 * embedded fragment hands them to the WordPress plugin in a JSON island
 * (`scf-page-data`), and tests/fpa.test.mjs checks the wording against a
 * synthetic table. Whichever document prints them, the words are these.
 *
 * Standalone this page still ships `noindex, indexifembedded`: the address that
 * ranks is `https://statchasers.com/nfl/fantasy-points-allowed-by-position/`,
 * not this origin. The canonical always points at the bare path, because
 * scoring format and view are state, not pages.
 */

import { escapeHtml } from "./render";
import type { FpaRow, FpaTableData } from "./fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "./fpa/nflverse";

export interface FpaPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
}

const SITE_NAME = "StatChasers";

/** The en dash the spec writes week ranges with: "Weeks 1–5". */
const RANGE = "–";

/**
 * Everything the page says about itself, from one table.
 *
 * `updated` is null when the rows carry no write time - a table from before
 * the column existed, or a test fixture - and the sentences that would have
 * named a date leave it out rather than print "Updated".
 */
export interface FpaPageCopy {
  /** ≤ 60 characters, no site suffix. */
  title: string;
  h1: string;
  /** ≤ 155 characters. */
  description: string;
  /** One sentence naming the softest defense per position, or "" with no rows. */
  answer: string;
  /** "Updated Oct 8, through Week 5" - the line under the H1, "" when unknown. */
  updatedLine: string;
  /** ISO date (YYYY-MM-DD) of the data, for dateModified; "" when unknown. */
  updatedIso: string;
  /** The write time in full (ISO 8601, UTC), for og:updated_time; "" when unknown. */
  updatedAt: string;
  season: number;
  kind: FpaTableData["kind"];
  weekNumber: number | null;
  archiveSeasons: number[];
}

/** "Oct 8", in Eastern time - the NFL's clock, and the one the site keeps. */
export function fpaUpdatedLabel(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function updatedIso(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  // The calendar day in Eastern time, so a Monday-night ingest at 11pm is
  // dated Monday here and in the label above.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The team as the answer sentence names it: the city ("Detroit", "New
 * Orleans"), except where two clubs share one and the city alone would be a
 * coin flip - those get the full name. A row the team table cannot resolve
 * keeps its abbreviation.
 */
function teamLabel(row: FpaRow, rows: FpaRow[]): string {
  const team = row.team;
  if (!team) return row.abbr;
  const shared = rows.some((r) => r.team && r.team !== team && r.team.city === team.city);
  return shared ? team.fullName : team.city;
}

const PLURAL: Record<FantasyPosition, string> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs" };

/**
 * "Softest matchups through Week 5: Detroit allows the most fantasy points to
 * QBs (26.7 per game) and WRs, New Orleans the most to RBs (29.6) and TEs."
 *
 * Built from the table's rank 1 per position, in QB, RB, WR, TE order, with
 * each team named once. The first position a team leads carries its figure;
 * the first team's figure says "per game" and the rest leave it understood.
 */
export function fpaAnswerSentence(data: Pick<FpaTableData, "rows" | "kind" | "season" | "weekNumber" | "isPreseason" | "baselineSeason">): string {
  const leaders = new Map<FpaRow, FantasyPosition[]>();
  for (const pos of FANTASY_POSITIONS) {
    const top = data.rows.find((r) => r.byPos[pos].rank === 1);
    if (!top) continue;
    const list = leaders.get(top) ?? [];
    list.push(pos);
    leaders.set(top, list);
  }
  if (leaders.size === 0) return "";

  const opening =
    data.kind === "archive"
      ? `Softest matchups of the ${data.season} season`
      : data.isPreseason || data.weekNumber === null
        ? `Softest matchups on the ${data.baselineSeason} baseline`
        : `Softest matchups through Week ${data.weekNumber}`;

  const clauses = [...leaders.entries()].map(([row, positions], i) => {
    const [first, ...rest] = positions as [FantasyPosition, ...FantasyPosition[]];
    const figure = `${row.byPos[first].fpa.toFixed(1)}${i === 0 ? " per game" : ""}`;
    const list = [`${PLURAL[first]} (${figure})`, ...rest.map((p) => PLURAL[p])];
    const named = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
    const verb = i === 0 ? "allows the most fantasy points to" : "the most to";
    return `${teamLabel(row, data.rows)} ${verb} ${named}`;
  });

  return `${opening}: ${clauses.join(", ")}.`;
}

/** The page's words for one table. See FpaPageCopy. */
export function fpaPageCopy(data: FpaTableData): FpaPageCopy {
  const season = data.season;
  const week = data.weekNumber;
  const label = fpaUpdatedLabel(data.updatedAtMs);
  const iso = updatedIso(data.updatedAtMs);
  const base = {
    answer: fpaAnswerSentence(data),
    updatedIso: iso,
    updatedAt: data.updatedAtMs ? new Date(data.updatedAtMs).toISOString() : "",
    season,
    kind: data.kind,
    weekNumber: week,
    archiveSeasons: data.archiveSeasons,
  };

  if (data.kind === "archive") {
    const through = week ?? 17;
    return {
      ...base,
      title: `Fantasy Points Allowed by Position ${season} (Full Season)`,
      h1: `${season} Fantasy Points Allowed by Position`,
      description:
        `Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses over the ` +
        `full ${season} season (Weeks 1${RANGE}${through}), raw and schedule-adjusted.`,
      updatedLine: `Full ${season} season, Weeks 1${RANGE}${through}`,
    };
  }

  if (data.isPreseason || week === null) {
    return {
      ...base,
      title: `Fantasy Points Allowed by Position ${season} (Preseason)`,
      h1: `Fantasy Points Allowed by Position: ${season} Preseason`,
      description:
        `Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses before ` +
        `Week 1 of ${season}, ranked on the ${data.baselineSeason} season, raw and ` +
        `schedule-adjusted.${label ? ` Updated ${label}.` : ""}`,
      updatedLine: label ? `Updated ${label}, before Week 1` : `Before Week 1 of ${season}`,
    };
  }

  return {
    ...base,
    title: `Fantasy Points Allowed by Position ${season} (Weeks 1${RANGE}${week})`,
    h1: `Fantasy Points Allowed by Position: Weeks 1${RANGE}${week}, ${season}`,
    description:
      `Fantasy points allowed to QB, RB, WR and TE by all 32 NFL defenses through ` +
      `Week ${week} of ${season}, raw and schedule-adjusted.${label ? ` Updated ${label}.` : ""}`,
    updatedLine: label ? `Updated ${label}, through Week ${week}` : `Through Week ${week}, ${season}`,
  };
}

export function fpaPageMeta(
  data: FpaTableData | null,
  canonical: string,
): FpaPageMeta {
  if (data) {
    const copy = fpaPageCopy(data);
    return { title: copy.title, description: copy.description, canonical, siteName: SITE_NAME };
  }
  const season = new Date().getUTCFullYear();
  return {
    title: `Fantasy Points Allowed by Position ${season}`,
    description:
      `Fantasy points allowed per game by all 32 NFL defenses to QBs, RBs, WRs ` +
      `and TEs. Standard, Half-PPR and PPR, raw and schedule-adjusted, ` +
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
