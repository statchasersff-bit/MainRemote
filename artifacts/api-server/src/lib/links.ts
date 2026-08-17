/**
 * Configuration for the internal links the tool renders.
 *
 * Everything here is opt-in and empty by default. The tool will not invent
 * links: we can't verify from this server that a player profile or team page
 * exists on the host site, and linking every name to a 404 would be worse than
 * leaving the names as plain text. Set these only for pages that really exist.
 */

import type { LinkTemplates, RelatedLink } from "./render";

/**
 * Parse a `Label|URL` list, one pair per `;`.
 *
 * e.g. "Fantasy Football Strength of Schedule|/nfl/fantasy-football-strength-of-schedule/"
 */
export function parseRelatedLinks(raw: string | undefined): RelatedLink[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("|");
      if (separator === -1) return null;
      const label = entry.slice(0, separator).trim();
      const href = entry.slice(separator + 1).trim();
      return label && href ? { label, href } : null;
    })
    .filter((link): link is RelatedLink => link !== null);
}

/** Link templates from the environment, for the standalone app page. */
export function linkTemplatesFromEnv(): LinkTemplates {
  const playerUrl = process.env["PLAYER_PROFILE_URL_TEMPLATE"]?.trim();
  const teamUrl = process.env["TEAM_PAGE_URL_TEMPLATE"]?.trim();
  return {
    ...(playerUrl ? { playerUrl } : {}),
    ...(teamUrl ? { teamUrl } : {}),
  };
}

/** Related-tool links from the environment, for the standalone app page. */
export function relatedLinksFromEnv(): RelatedLink[] {
  return parseRelatedLinks(process.env["RELATED_LINKS"]);
}
