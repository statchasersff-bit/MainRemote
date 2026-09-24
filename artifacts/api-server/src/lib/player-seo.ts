/**
 * Metadata for a player page.
 *
 * Same posture as the news tool (lib/seo.ts) and the team hubs (lib/team-seo.ts):
 * everything is in the initial HTML, nothing is amended by JavaScript, and the
 * canonical is a plain tag rather than something applied at runtime.
 *
 * These pages are not meant to rank on this origin. The public URL is
 * `https://statchasers.com/nfl/players/<slug>/`, and WordPress owns the title,
 * description, canonical and schema there. What this server serves is the
 * embedded tool, so it ships `noindex, indexifembedded` — out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 *
 * The canonical stays self-referencing and always points at the PPR URL. The
 * scoring format is the one piece of genuine state these pages carry in a query
 * string, and three formats of the same profile are three renderings of one
 * page, not three pages — so `?format=half` canonicalises to the bare slug.
 */

import { escapeHtml } from "./render";
import type { PlayerPageData } from "./player/player-data";

export interface PlayerPageMeta {
  title: string;
  description: string;
  canonical: string;
  siteName: string;
  /** Absolute headshot URL for og:image, when there is one. */
  image: string | null;
}

const SITE_NAME = "StatChasers";

/**
 * Title and description for a section-scoped page.
 *
 * A section URL exists to answer one kind of query, so it gets a title written
 * for that query rather than the profile's generic one. The injury entry is
 * deliberately built to carry both intents — the current status and the
 * history — because they are the same page and splitting them would put two
 * thin pages where one good one belongs.
 *
 * Returns null for a section with no written metadata; the caller falls back to
 * the profile's own.
 */
function sectionMeta(
  data: PlayerPageData,
  section: string,
): { title: string; description: string } | null {
  const { player, season } = data;
  const position = player.position ? `${player.position} ` : "";

  if (section === "stats") {
    return {
      title: `${player.name} Stats ${season}: Fantasy Points, ${
        player.position === "QB" ? "Passing & Rushing" : "Receiving & Rushing"
      } Stats | ${SITE_NAME}`,
      description:
        `${player.name} ${season} stats: ${position}season totals, fantasy ` +
        `points and positional rank, career stats by season from his rookie ` +
        `year, and career bests.`,
    };
  }

  if (section === "injury") {
    return {
      title: `${player.name} Injury Update, Status & History ${season} | ${SITE_NAME}`,
      description:
        `${player.name} injury update: current status and designation, ` +
        `${season} games missed, and every logged injury of his career with ` +
        `games missed by body part.`,
    };
  }

  if (section === "bio") {
    // Deliberately no fantasy words in either string. Bio is the one section
    // whose queries are biographical — age, height, college, draft, where he
    // is from — and a title promising fantasy analysis would be competing for
    // the wrong ones while the profile page competes for the right ones.
    const profile = data.bioProfile;
    const born = profile.facts.find((fact) => fact.label === "Born")?.value;
    const college = profile.college;

    return {
      title: `${player.name} Bio: Age, Height, College, Draft & Career | ${SITE_NAME}`,
      description:
        `${player.name} bio: age, height, weight` +
        `${born ? `, born ${born}` : ""}` +
        `${college ? `, ${college}` : ""}` +
        `, NFL draft position and full career team history.`,
    };
  }

  if (section === "outlook") {
    return {
      title: `${player.name} Fantasy Outlook ${season}: Role, Usage & Draft Value | ${SITE_NAME}`,
      description:
        `${player.name} ${season} fantasy outlook: his ${position}role, the ` +
        `usage behind it and what it is worth on draft day.`,
    };
  }

  if (section === "news") {
    return {
      title: `${player.name} News & Fantasy Analysis | ${SITE_NAME}`,
      description:
        `The latest ${player.name} news and updates, and what each item ` +
        `changes for fantasy.`,
    };
  }

  if (section === "game-log") {
    // The ACTIVE season, on every rendering of this page. `?log=2023` adds
    // 2023's table under the season selector and leaves the current season
    // where it was, so the page is still the current season's game log and a
    // title naming 2023 would describe the block at the bottom of it.
    const year = data.season;
    return {
      title:
        `${player.name} Game Log ${year}: Fantasy Points & Stats by Week | ${SITE_NAME}`,
      description:
        `${player.name} ${year} game log: fantasy points by week, ` +
        `${position}stats game by game, weekly positional finish and the ` +
        `last-five-games trend.`,
    };
  }

  return null;
}

export function playerPageMeta(
  data: PlayerPageData,
  canonical: string,
  section?: string,
): PlayerPageMeta {
  const { player, team, season } = data;
  const position = player.position ? `${player.position} ` : "";
  const teamName = team ? ` | ${team.fullName}` : "";

  const scoped = section ? sectionMeta(data, section) : null;

  // The description names what is actually on the page and the season it
  // describes. No superlatives, and no claim about next season — see rule 3 in
  // player-render.ts.
  const description =
    scoped?.description ??
    `${player.name} ${position}fantasy football stats and analysis: ` +
      `${season} season and career stats, game log, weekly finishes, injury ` +
      `history and fantasy outlook.`;

  return {
    title:
      scoped?.title ??
      `${player.name} Fantasy Football Stats & Analysis${teamName} | ${SITE_NAME}`,
    description,
    canonical,
    siteName: SITE_NAME,
    image: player.headshotUrl ?? null,
  };
}

export function renderPlayerHeadTags(meta: PlayerPageMeta): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const url = escapeHtml(meta.canonical);
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    // "profile" rather than "website": this page is about a person.
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
  }
  return tags.join("\n  ");
}
