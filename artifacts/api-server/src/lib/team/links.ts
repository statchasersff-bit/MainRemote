/**
 * Every StatChasers URL the team pages link to, built in one place.
 *
 * The team hub's job is to send readers into the real tools, so it emits a lot
 * of internal links — and a link built inline in a component is a link nobody
 * can find again when the site's URL structure changes. Components ask for
 * `getTeamDepthChartUrl(team)`; only this file knows what that resolves to.
 *
 * ── Verify these before launch ──────────────────────────────────────────────
 * Every template below is overridable by an environment variable, and the
 * DEFAULTS ARE THIS SERVER'S BEST GUESS at statchasers.com's URL structure,
 * not something it can verify from here. Only `TEAM_HUB`, `SOS`, `TOOLS` and
 * `PLAYER_STATS` have any evidence behind them (the intended team-page URL the
 * project was specced with, the example already in lib/links.ts, and two URLs
 * given by the site's owner). Check the rest against the live site and correct
 * them with the env vars named beside each one — no code change or redeploy of
 * this module is needed to fix a wrong path.
 *
 * Setting a template to an empty string switches its link off everywhere
 * rather than pointing it somewhere wrong, which is the same rule the news
 * tool's entity links already follow (see lib/links.ts).
 */

import { getPlayerSlugByName } from "../player/data";
import type { NflTeam } from "./teams";

/** Origin of the public StatChasers site. */
const SITE_ORIGIN = (
  process.env["SC_SITE_ORIGIN"] ?? "https://statchasers.com"
).replace(/\/+$/, "");

function template(envKey: string, fallback: string): string {
  const raw = process.env[envKey];
  return (raw === undefined ? fallback : raw).trim();
}

/**
 * Path templates. `{slug}` is the team slug, `{code}` the uppercase
 * abbreviation, `{team}` the lowercase one, `{player}` a player-name slug.
 */
const TEMPLATES = {
  /** The team hub itself — the URL these pages are embedded at. */
  teamHub: template("SC_TEAM_HUB_URL_TEMPLATE", "/nfl/teams/{slug}/"),
  depthChart: template("SC_DEPTH_CHART_URL_TEMPLATE", "/nfl/depth-charts/{slug}/"),
  teamSchedule: template("SC_TEAM_SCHEDULE_URL_TEMPLATE", "/nfl/schedule/{slug}/"),
  /** League-wide advanced player stats. Given by the site's owner, not guessed. */
  playerStats: template("SC_PLAYER_STATS_URL", "/nfl/nfl-player-stats/"),
  /**
   * A player's profile. `{player}` is the site's own slug, not one derived
   * from the name — see getPlayerProfileUrl().
   */
  playerProfile: template(
    "SC_PLAYER_PROFILE_URL_TEMPLATE",
    "/nfl/players/outlook/{player}/",
  ),
  /** The site's tool index. Given by the site's owner, not guessed. */
  tools: template("SC_TOOLS_URL", "/nfl/fantasy-football-tools/"),
  sos: template("SC_SOS_URL", "/nfl/fantasy-football-strength-of-schedule/"),
  fpa: template("SC_FPA_URL", "/nfl/fantasy-points-allowed/"),
  news: template("SC_NEWS_URL", "/nfl/fantasy-football-player-news/"),
} as const;

/**
 * Absolute, or nothing.
 *
 * These pages are read inside statchasers.com — both mounted directly into a
 * WordPress page and, where the legacy integration is used, inside an iframe on
 * a different origin. A root-relative "/nfl/..." is correct in the first case
 * and resolves against *this* server in the second, so every link is made
 * absolute against SITE_ORIGIN instead. Absolute is right in both mounts.
 */
function absolute(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith("/")) return null;
  if (!SITE_ORIGIN) return null;
  return `${SITE_ORIGIN}${trimmed}`;
}

function fill(tpl: string, values: Record<string, string>): string | null {
  if (!tpl) return null;
  let missing = false;
  const filled = tpl.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = values[key];
    if (!value) {
      missing = true;
      return "";
    }
    // Keep "/" out of the encoded output — every value here is a single path
    // segment or a query value, and encodeURIComponent is the right escape for
    // both.
    return encodeURIComponent(value);
  });
  if (missing) return null;
  return absolute(filled);
}

function teamValues(team: NflTeam): Record<string, string> {
  return { slug: team.slug, code: team.code, team: team.abbreviation };
}

/** This team's hub page on statchasers.com. */
export function getTeamHubUrl(team: NflTeam): string | null {
  return fill(TEMPLATES.teamHub, teamValues(team));
}

/** The full StatChasers depth chart for this team. */
export function getTeamDepthChartUrl(team: NflTeam): string | null {
  return fill(TEMPLATES.depthChart, teamValues(team));
}

/** The full StatChasers schedule for this team. */
export function getTeamScheduleUrl(team: NflTeam): string | null {
  return fill(TEMPLATES.teamSchedule, teamValues(team));
}

/**
 * Advanced player stats.
 *
 * League-wide, not filtered to a team: the page this points at takes no team
 * parameter. It replaced a team-filtered `/nfl/players/?team={code}` that was
 * this server's guess at a URL structure the site does not use.
 */
export function getPlayerStatsUrl(): string | null {
  return fill(TEMPLATES.playerStats, {});
}

/**
 * A single player's profile, or null when the site does not publish one.
 *
 * The rule this used to enforce by staying switched off — never link a name to
 * a page that may not exist — is enforced per name instead. The player
 * dictionary carries the site's own slug for every player it indexes, so a name
 * that resolves to one has a profile and a name that does not is left as plain
 * text. That is also the only way to get the slug right: the site spells A.J.
 * Brown "aj-brown", and deriving a slug from the name gives "a-j-brown".
 *
 * Still overridable, and still switched off wholesale by setting
 * SC_PLAYER_PROFILE_URL_TEMPLATE to an empty string.
 */
export function getPlayerProfileUrl(
  playerName: string | null | undefined,
): string | null {
  const slug = getPlayerSlugByName(playerName);
  if (!slug) return null;
  return fill(TEMPLATES.playerProfile, { player: slug, slug });
}

/** The index of every StatChasers fantasy tool. */
export function getToolsUrl(): string | null {
  return fill(TEMPLATES.tools, {});
}

/** Strength of Schedule tool. Team-agnostic today; the template may add {slug}. */
export function getSOSUrl(team?: NflTeam): string | null {
  return fill(TEMPLATES.sos, team ? teamValues(team) : {});
}

/** Fantasy Points Allowed tool. */
export function getFPAUrl(team?: NflTeam): string | null {
  return fill(TEMPLATES.fpa, team ? teamValues(team) : {});
}

/** The main player-news page — where "view all news" goes. */
export function getNewsUrl(): string | null {
  return fill(TEMPLATES.news, {});
}
