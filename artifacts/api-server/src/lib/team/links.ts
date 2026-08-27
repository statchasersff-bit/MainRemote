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
 * not something it can verify from here. Only `TEAM_HUB` and `SOS` have any
 * evidence behind them (the intended team-page URL the project was specced
 * with, and the example already in lib/links.ts). Check the rest against the
 * live site and correct them with the env vars named beside each one — no code
 * change or redeploy of this module is needed to fix a wrong path.
 *
 * Setting a template to an empty string switches its link off everywhere
 * rather than pointing it somewhere wrong, which is the same rule the news
 * tool's entity links already follow (see lib/links.ts).
 */

import { slugify } from "../render";
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
  teamPlayers: template("SC_TEAM_PLAYERS_URL_TEMPLATE", "/nfl/players/?team={code}"),
  playerProfile: template("SC_PLAYER_PROFILE_URL_TEMPLATE", ""),
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

/** Player database, filtered to this team where the site supports it. */
export function getTeamPlayersUrl(team: NflTeam): string | null {
  return fill(TEMPLATES.teamPlayers, teamValues(team));
}

/**
 * A single player's profile.
 *
 * Off by default. The news tool made the same call for the same reason (see
 * lib/links.ts): this server cannot tell whether a profile page exists for a
 * given player, and linking every name to a 404 is worse than leaving the names
 * as plain text. Set SC_PLAYER_PROFILE_URL_TEMPLATE once the profiles are live
 * and every player name on the page becomes a link.
 */
export function getPlayerProfileUrl(
  playerName: string | null | undefined,
): string | null {
  const name = (playerName ?? "").trim();
  if (!name) return null;
  return fill(TEMPLATES.playerProfile, { player: slugify(name), slug: slugify(name) });
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
