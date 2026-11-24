/**
 * Every StatChasers URL the team pages link to, built in one place.
 *
 * The team hub's job is to send readers into the real tools, so it emits a lot
 * of internal links - and a link built inline in a component is a link nobody
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
 * them with the env vars named beside each one - no code change or redeploy of
 * this module is needed to fix a wrong path.
 *
 * Setting a template to an empty string switches its link off everywhere
 * rather than pointing it somewhere wrong, which is the same rule the news
 * tool's entity links already follow (see lib/links.ts).
 */

import {
  indexedSlugForSleeperId,
  loadGameLogs,
  playersNamed,
  sleeperIdFor,
} from "../player/data";
import { getTeamByAbbreviation, type NflTeam } from "./teams";

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
  /** The team hub itself - the URL these pages are embedded at. */
  teamHub: template("SC_TEAM_HUB_URL_TEMPLATE", "/nfl/teams/{slug}/"),
  /**
   * "View full NFL schedule": the league schedule page. The team's own schedule
   * is the hub's /schedule/ section, which is the page this link is printed on.
   * The old default, /nfl/schedule/{slug}/, was a guess at a page that never
   * existed.
   */
  teamSchedule: template("SC_TEAM_SCHEDULE_URL_TEMPLATE", "/nfl/nfl-schedule/"),
  /** League-wide advanced player stats. Given by the site's owner, not guessed. */
  playerStats: template("SC_PLAYER_STATS_URL", "/nfl/nfl-player-stats/"),
  /**
   * A player's profile. `{player}` is the site's own slug, not one derived
   * from the name - see playerProfileUrl().
   *
   * It defaulted to `/nfl/players/outlook/{player}/`, a retired layout whose
   * old pages still resolved, so every team hub linked readers and crawlers to
   * a stale copy. The plugin now 301s that layout to the profile.
   */
  playerProfile: template("SC_PLAYER_PROFILE_URL_TEMPLATE", "/nfl/players/{player}/"),
  /** The site's tool index. Given by the site's owner, not guessed. */
  tools: template("SC_TOOLS_URL", "/nfl/fantasy-football-tools/"),
  sos: template("SC_SOS_URL", "/nfl/fantasy-football-strength-of-schedule/"),
  fpa: template("SC_FPA_URL", "/nfl/fantasy-points-allowed-by-position/"),
} as const;

/**
 * Absolute, or nothing.
 *
 * These pages are read inside statchasers.com - both mounted directly into a
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
    // Keep "/" out of the encoded output - every value here is a single path
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
 * What a row knows about the player it names, for playerProfileUrl().
 *
 * Every id is optional; pass each one the row carries. `team` is the club
 * the row puts him on (the team page's club, the matchup side he played for)
 * and `pos` the position it lists; both only matter when no id is given.
 */
export interface PlayerLinkRef {
  /** Sleeper's id: players.json `id`, the key the site's slugs hang off. */
  sleeperId?: string | number | null;
  /** ESPN athlete id (box scores, depth-chart headshots). */
  espnId?: string | number | null;
  /** NFL GSIS id, "00-0036322" (nflverse, OverTheCap). */
  gsisId?: string | null;
  /** Pro Football Reference id, "JeffJu00". */
  pfrId?: string | null;
  /** A matchup row's game key, "espn:4262921" or "sleeper:6794". */
  gameKey?: string | null;
  /** The club or clubs the row places him with, any spelling teams.ts knows. */
  team?: string | readonly string[] | null;
  /** The row's position, "WR", "LB", "PK"; unknown is null. */
  pos?: string | null;
  /**
   * A past game the row describes: a player traded since then is still
   * matched on the club he played for that week (from his game logs).
   */
  game?: { season: number; week?: number | null; logsOnly?: boolean } | null;
}

/** A renderer's link callback: the printed name and whatever ids the row has. */
export type PlayerUrlFn = (name: string, ref?: PlayerLinkRef) => string | null;

const OFFENSE_POS = new Set(["QB", "RB", "HB", "FB", "WR", "TE", "LWR", "RWR", "SWR", "SLOT"]);
const KICK_POS = new Set(["K", "PK", "P"]);
const TEAM_DEF_POS = new Set(["DEF", "DST", "D/ST"]);
/** Slots anyone can fill: returners, the holder, a generic athlete. */
const ANY_POS = new Set(["PR", "KR", "KOR", "H", "ATH"]);

type PosGroup = "offense" | "kick" | "team-defense" | "other";

/** The broad group a position belongs to, or null when it says nothing. */
function posGroup(pos: string | null | undefined): PosGroup | null {
  const p = String(pos ?? "").trim().toUpperCase().replace(/^FAN_/, "").replace(/\d+$/, "");
  if (!p || ANY_POS.has(p)) return null;
  if (OFFENSE_POS.has(p)) return "offense";
  if (KICK_POS.has(p)) return "kick";
  if (TEAM_DEF_POS.has(p)) return "team-defense";
  // The line, the defense, long snappers: none of them has a fantasy page.
  return "other";
}

/** Lowercase canonical club code ("was" for WSH), or null. */
function clubCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const team = getTeamByAbbreviation(value);
  return team ? team.abbreviation : value.trim().toLowerCase() || null;
}

/** Whether two spellings name the same club ("WSH" and "was", "JAC" and "JAX"). */
export function sameClub(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = clubCode(a);
  return x !== null && x === clubCode(b);
}

function gameKeyRef(key: string | null | undefined): { espnId?: string; sleeperId?: string } {
  const m = /^(espn|sleeper):(.+)$/.exec(key ?? "");
  if (!m) return {};
  return m[1] === "espn" ? { espnId: m[2]! } : { sleeperId: m[2]! };
}

/**
 * The slug the row's ids lead to; null when they lead to no published
 * profile (or disagree); undefined when the row carries no id at all.
 */
function slugFromIds(ref: PlayerLinkRef): string | null | undefined {
  const fromKey = gameKeyRef(ref.gameKey);
  const sleeperIds = new Set<string>();
  let carried = false;
  for (const direct of [ref.sleeperId, fromKey.sleeperId]) {
    if (direct === null || direct === undefined || direct === "") continue;
    carried = true;
    sleeperIds.add(String(direct));
  }
  const others: Array<["espn" | "gsis" | "pfr", string | number | null | undefined]> = [
    ["espn", ref.espnId],
    ["espn", fromKey.espnId],
    ["gsis", ref.gsisId],
    ["pfr", ref.pfrId],
  ];
  for (const [kind, id] of others) {
    if (id === null || id === undefined || id === "") continue;
    carried = true;
    const sleeper = sleeperIdFor(kind, id);
    if (sleeper) sleeperIds.add(sleeper);
  }
  if (!carried) return undefined;
  // An id that resolves to nobody we know is still an id: the row is about
  // someone, and it is not a player the site publishes. Never the name then.
  if (sleeperIds.size !== 1) return null;
  return indexedSlugForSleeperId([...sleeperIds][0]!);
}

/** The clubs a dictionary player can be matched on for this row. */
function clubsOf(player: { id: string; team: string | null }, game: PlayerLinkRef["game"]): Set<string> {
  const clubs = new Set<string>();
  // `logsOnly`: the season's game logs alone place him (team audit T1,
  // 2026-11-24). A historical row (a Fantasy Finishes season years back)
  // must not match a namesake who merely plays for that club today.
  const now = game?.logsOnly ? null : clubCode(player.team);
  if (now) clubs.add(now);
  if (game) {
    const rows = loadGameLogs(game.season)[player.id] ?? [];
    const wanted = game.week === null || game.week === undefined ? rows : rows.filter((r) => r.week === game.week);
    for (const r of wanted) {
      const c = clubCode(r.team ?? null);
      if (c) clubs.add(c);
    }
  }
  return clubs;
}

/**
 * The slug for a name the row gives with no id: only when exactly one player
 * in the whole dictionary has that name, plays for one of the row's clubs and
 * fits its position, and that player has a profile. No club, no link.
 */
function slugFromName(name: string, ref: PlayerLinkRef): string | null {
  const teams = (Array.isArray(ref.team) ? ref.team : [ref.team])
    .map((t) => clubCode(t as string | null | undefined))
    .filter((t): t is string => !!t);
  if (teams.length === 0) return null;
  const rowGroup = posGroup(ref.pos);
  const fits = playersNamed(name).filter((p) => {
    const clubs = clubsOf(p, ref.game ?? null);
    if (!teams.some((t) => clubs.has(t))) return false;
    const group = posGroup(p.position);
    return rowGroup === null || group === null || group === rowGroup;
  });
  if (fits.length !== 1) return null;
  return indexedSlugForSleeperId(fits[0]!.id);
}

/**
 * The published slug for the player a row names, or null.
 *
 * mak's rules (2026-11-20): an id decides. Any id the row carries is
 * translated to a Sleeper id and the link exists only when that player has a
 * published profile; an id that matches nobody published is plain text, and
 * the name is NEVER tried in its place - that fallback is how the Browns'
 * linebacker Justin Jefferson linked to the Vikings' receiver. A row with no
 * id at all is matched by name only inside its own club and position group
 * (see slugFromName); anything less certain is plain text.
 */
export function resolvePlayerSlug(name: string | null | undefined, ref: PlayerLinkRef = {}): string | null {
  const byId = slugFromIds(ref);
  if (byId !== undefined) return byId;
  if (!name) return null;
  return slugFromName(name, ref);
}

/**
 * A single player's profile, or null when the site does not publish one.
 *
 * The slug is the site's own, from the player dictionary - never derived from
 * the name: the site spells A.J. Brown "aj-brown", and deriving one gives
 * "a-j-brown". Which player a row means is resolvePlayerSlug()'s call.
 *
 * Still overridable, and still switched off wholesale by setting
 * SC_PLAYER_PROFILE_URL_TEMPLATE to an empty string.
 */
export function playerProfileUrl(name: string | null | undefined, ref: PlayerLinkRef = {}): string | null {
  const slug = resolvePlayerSlug(name, ref);
  if (!slug) return null;
  return fill(TEMPLATES.playerProfile, { player: slug, slug });
}

/**
 * A player's page on statchasers.com, from a slug already resolved against the
 * dictionary - what the rankings rows carry. Null without one.
 */
export function getPlayerPageUrl(
  slug: string | null | undefined,
): string | null {
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
