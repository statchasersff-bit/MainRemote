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
 * embedded tool, so it ships `noindex, indexifembedded` - out of the index as a
 * standalone result, still usable by Google as part of the page that embeds it.
 *
 * The canonical stays self-referencing and always points at the PPR URL. The
 * scoring format is the one piece of genuine state these pages carry in a query
 * string, and three formats of the same profile are three renderings of one
 * page, not three pages - so `?format=half` canonicalises to the bare slug.
 */

import { escapeHtml } from "./render";
import { OUTLOOK_SEASON } from "./player/header";
import type { PlayerPageData } from "./player/player-data";
import { bioDescription } from "./player/bio-seo";
import { fitTitle } from "./title-fit";

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
 * deliberately built to carry both intents - the current status and the
 * history - because they are the same page and splitting them would put two
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
      // Every section title is a ladder for fitTitle(): the fullest wording
      // that fits sixty characters, and a shorter rung for the longest names
      // (mak approved the wording, 2026-10-08).
      title: fitTitle([
        `${player.name} Stats ${season}: Fantasy Points & Career Stats`,
        `${player.name} Stats ${season}: Fantasy Points & Rank`,
      ]),
      description:
        `${player.name} ${season} stats: ${position}season totals, fantasy ` +
        `points and positional rank, career stats by season from his rookie ` +
        `year, and career bests.`,
    };
  }

  if (section === "injury") {
    return {
      title: fitTitle([
        `${player.name} Injury Update, Status & History ${season}`,
        `${player.name} Injury Update & History ${season}`,
      ]),
      description:
        `${player.name} injury update: current status and designation, ` +
        `${season} games missed, and every logged injury of his career with ` +
        `games missed by body part.`,
    };
  }

  if (section === "bio") {
    // Deliberately no fantasy words in either string. Bio is the one section
    // whose queries are biographical - age, height, college, draft, where he
    // is from - and a title promising fantasy analysis would be competing for
    // the wrong ones while the profile page competes for the right ones.
    // The Bio spec's title and description (2.11, approved by mak
    // 2026-09-30), from the sourced fact store when the player has a record.
    const profile = data.bioProfile;
    const born = profile.facts.find((fact) => fact.label === "Born")?.value;
    const college = profile.college;
    const title = `${player.name} Bio: Age, Height, College & Draft`;
    const specDescription = data.bioPage ? bioDescription(data, data.bioPage) : null;
    if (specDescription) return { title, description: specDescription };

    return {
      title,
      description:
        `${player.name} bio: age, height, weight` +
        `${born ? `, born ${born}` : ""}` +
        `${college ? `, ${college}` : ""}` +
        `, NFL draft position and full career team history.`,
    };
  }

  if (section === "outlook") {
    // OUTLOOK_SEASON, not the season the player last played: the tab is the
    // 2026 outlook for everybody, and a player with no 2026 snaps yet got a
    // "2025" title over a 2026 H1.
    return {
      title: fitTitle([
        `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: Role, Usage & Value`,
        `${player.name} Fantasy Outlook ${OUTLOOK_SEASON}: Role & Usage`,
      ]),
      description:
        `${player.name} ${OUTLOOK_SEASON} fantasy outlook: his ${position}role, the ` +
        `usage behind it and what it is worth on draft day.`,
    };
  }

  if (section === "news") {
    return {
      title: `${player.name} News & Fantasy Analysis`,
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
      title: fitTitle([
        `${player.name} Game Log ${year}: Fantasy Points by Week`,
        `${player.name} Game Log ${year}: Week by Week`,
      ]),
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
  const { player, season } = data;
  const position = player.position ? `${player.position} ` : "";

  const scoped = section ? sectionMeta(data, section) : null;

  // The description names what is actually on the page and the season it
  // describes. No superlatives, and no claim about next season - see rule 3 in
  // player-render.ts.
  const description =
    scoped?.description ??
    `${player.name} ${position}fantasy football stats and analysis: ` +
      `${season} season and career stats, game log, weekly finishes, injury ` +
      `history and fantasy outlook.`;

  return {
    // The profile's title is the one the WordPress page builder stores
    // (statchasers_player_page_meta); the two must say the same thing.
    title: scoped?.title ?? `${player.name} Fantasy Football Stats & Analysis`,
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
