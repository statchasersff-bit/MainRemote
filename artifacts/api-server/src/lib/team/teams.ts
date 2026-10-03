/**
 * The canonical NFL team table - one row per franchise, one place to change.
 *
 * Everything about a team that the app needs to know lives here: the id it is
 * keyed by, the URL it lives at, how it is named, which division it plays in,
 * and the ids the upstream providers use for it. Nothing else in the codebase
 * may carry its own team mapping.
 *
 * The canonical id is `abbreviation` - Sleeper's lowercase code ("ne", "was",
 * "jax"). That is deliberate rather than arbitrary: it is already what the news
 * pipeline resolves each item to (see lib/teams.ts and lib/news-query.ts) and
 * what `TEAM_COLORS`/`TEAM_NAMES` in lib/render.ts are keyed by, so choosing it
 * means the team pages and the news feed agree without a translation layer
 * between them. ESPN's own ids are carried alongside as provider fields; they
 * are for talking to ESPN and never for identifying a team internally.
 *
 * Colours are imported from lib/render.ts rather than restated. The news card
 * already tints itself with them, and a second copy here would be a second
 * thing to keep in sync - the failure mode being a team whose page and whose
 * news cards disagree about its own colour.
 */

import { TEAM_ACCENTS, TEAM_COLORS, TEAM_NAMES, teamLogoUrl } from "../render";

export type Conference = "AFC" | "NFC";
export type DivisionName = "East" | "North" | "South" | "West";

export interface NflTeam {
  /** Canonical internal id: Sleeper's lowercase code, e.g. "ne". */
  abbreviation: string;
  /** Display form of the same code, e.g. "NE". */
  code: string;
  /** URL segment, e.g. "new-england-patriots". */
  slug: string;
  city: string;
  nickname: string;
  /**
   * One player's worth of the nickname: "Cardinal", "Ram", "49er". Written
   * out rather than derived, because stripping an "s" is right for 31 clubs
   * and the one exception is the kind of thing a reader notices.
   */
  singular: string;
  fullName: string;
  conference: Conference;
  divisionName: DivisionName;
  /** e.g. "AFC East" - the form shown in the hero. */
  division: string;
  /** Absolute logo URL (Sleeper's CDN, already used by the news cards). */
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  /** ESPN's numeric team id, for the schedule/record/statistics providers. */
  espnId: string;
  /** ESPN's abbreviation. Differs from ours for Washington (WSH vs WAS). */
  espnAbbr: string;
  /**
   * The club's own site, e.g. "patriots.com" - the host of its official news
   * feed at https://www.<siteDomain>/rss/news.
   *
   * Stored rather than derived because it follows no rule: some clubs use the
   * nickname (packers.com), some the city and nickname (dallascowboys.com),
   * some neither (therams.com, azcardinals.com). All 32 are on one NFL platform
   * and answer the same path, so the domain is the only part that varies.
   */
  siteDomain: string;
}

interface TeamSeed {
  abbreviation: string;
  slug: string;
  city: string;
  nickname: string;
  singular: string;
  conference: Conference;
  divisionName: DivisionName;
  espnId: string;
  espnAbbr?: string;
  siteDomain: string;
}

const SEEDS: TeamSeed[] = [
  // AFC East
  { abbreviation: "buf", slug: "buffalo-bills", city: "Buffalo", nickname: "Bills", singular: "Bill", conference: "AFC", divisionName: "East", espnId: "2", siteDomain: "buffalobills.com" },
  { abbreviation: "mia", slug: "miami-dolphins", city: "Miami", nickname: "Dolphins", singular: "Dolphin", conference: "AFC", divisionName: "East", espnId: "15", siteDomain: "miamidolphins.com" },
  { abbreviation: "ne", slug: "new-england-patriots", city: "New England", nickname: "Patriots", singular: "Patriot", conference: "AFC", divisionName: "East", espnId: "17", siteDomain: "patriots.com" },
  { abbreviation: "nyj", slug: "new-york-jets", city: "New York", nickname: "Jets", singular: "Jet", conference: "AFC", divisionName: "East", espnId: "20", siteDomain: "newyorkjets.com" },
  // AFC North
  { abbreviation: "bal", slug: "baltimore-ravens", city: "Baltimore", nickname: "Ravens", singular: "Raven", conference: "AFC", divisionName: "North", espnId: "33", siteDomain: "baltimoreravens.com" },
  { abbreviation: "cin", slug: "cincinnati-bengals", city: "Cincinnati", nickname: "Bengals", singular: "Bengal", conference: "AFC", divisionName: "North", espnId: "4", siteDomain: "bengals.com" },
  { abbreviation: "cle", slug: "cleveland-browns", city: "Cleveland", nickname: "Browns", singular: "Brown", conference: "AFC", divisionName: "North", espnId: "5", siteDomain: "clevelandbrowns.com" },
  { abbreviation: "pit", slug: "pittsburgh-steelers", city: "Pittsburgh", nickname: "Steelers", singular: "Steeler", conference: "AFC", divisionName: "North", espnId: "23", siteDomain: "steelers.com" },
  // AFC South
  { abbreviation: "hou", slug: "houston-texans", city: "Houston", nickname: "Texans", singular: "Texan", conference: "AFC", divisionName: "South", espnId: "34", siteDomain: "houstontexans.com" },
  { abbreviation: "ind", slug: "indianapolis-colts", city: "Indianapolis", nickname: "Colts", singular: "Colt", conference: "AFC", divisionName: "South", espnId: "11", siteDomain: "colts.com" },
  { abbreviation: "jax", slug: "jacksonville-jaguars", city: "Jacksonville", nickname: "Jaguars", singular: "Jaguar", conference: "AFC", divisionName: "South", espnId: "30", siteDomain: "jaguars.com" },
  { abbreviation: "ten", slug: "tennessee-titans", city: "Tennessee", nickname: "Titans", singular: "Titan", conference: "AFC", divisionName: "South", espnId: "10", siteDomain: "tennesseetitans.com" },
  // AFC West
  { abbreviation: "den", slug: "denver-broncos", city: "Denver", nickname: "Broncos", singular: "Bronco", conference: "AFC", divisionName: "West", espnId: "7", siteDomain: "denverbroncos.com" },
  { abbreviation: "kc", slug: "kansas-city-chiefs", city: "Kansas City", nickname: "Chiefs", singular: "Chief", conference: "AFC", divisionName: "West", espnId: "12", siteDomain: "chiefs.com" },
  { abbreviation: "lv", slug: "las-vegas-raiders", city: "Las Vegas", nickname: "Raiders", singular: "Raider", conference: "AFC", divisionName: "West", espnId: "13", siteDomain: "raiders.com" },
  { abbreviation: "lac", slug: "los-angeles-chargers", city: "Los Angeles", nickname: "Chargers", singular: "Charger", conference: "AFC", divisionName: "West", espnId: "24", siteDomain: "chargers.com" },
  // NFC East
  { abbreviation: "dal", slug: "dallas-cowboys", city: "Dallas", nickname: "Cowboys", singular: "Cowboy", conference: "NFC", divisionName: "East", espnId: "6", siteDomain: "dallascowboys.com" },
  { abbreviation: "nyg", slug: "new-york-giants", city: "New York", nickname: "Giants", singular: "Giant", conference: "NFC", divisionName: "East", espnId: "19", siteDomain: "giants.com" },
  { abbreviation: "phi", slug: "philadelphia-eagles", city: "Philadelphia", nickname: "Eagles", singular: "Eagle", conference: "NFC", divisionName: "East", espnId: "21", siteDomain: "philadelphiaeagles.com" },
  { abbreviation: "was", slug: "washington-commanders", city: "Washington", nickname: "Commanders", singular: "Commander", conference: "NFC", divisionName: "East", espnId: "28", espnAbbr: "WSH", siteDomain: "commanders.com" },
  // NFC North
  { abbreviation: "chi", slug: "chicago-bears", city: "Chicago", nickname: "Bears", singular: "Bear", conference: "NFC", divisionName: "North", espnId: "3", siteDomain: "chicagobears.com" },
  { abbreviation: "det", slug: "detroit-lions", city: "Detroit", nickname: "Lions", singular: "Lion", conference: "NFC", divisionName: "North", espnId: "8", siteDomain: "detroitlions.com" },
  { abbreviation: "gb", slug: "green-bay-packers", city: "Green Bay", nickname: "Packers", singular: "Packer", conference: "NFC", divisionName: "North", espnId: "9", siteDomain: "packers.com" },
  { abbreviation: "min", slug: "minnesota-vikings", city: "Minnesota", nickname: "Vikings", singular: "Viking", conference: "NFC", divisionName: "North", espnId: "16", siteDomain: "vikings.com" },
  // NFC South
  { abbreviation: "atl", slug: "atlanta-falcons", city: "Atlanta", nickname: "Falcons", singular: "Falcon", conference: "NFC", divisionName: "South", espnId: "1", siteDomain: "atlantafalcons.com" },
  { abbreviation: "car", slug: "carolina-panthers", city: "Carolina", nickname: "Panthers", singular: "Panther", conference: "NFC", divisionName: "South", espnId: "29", siteDomain: "panthers.com" },
  { abbreviation: "no", slug: "new-orleans-saints", city: "New Orleans", nickname: "Saints", singular: "Saint", conference: "NFC", divisionName: "South", espnId: "18", siteDomain: "neworleanssaints.com" },
  { abbreviation: "tb", slug: "tampa-bay-buccaneers", city: "Tampa Bay", nickname: "Buccaneers", singular: "Buccaneer", conference: "NFC", divisionName: "South", espnId: "27", siteDomain: "buccaneers.com" },
  // NFC West
  { abbreviation: "ari", slug: "arizona-cardinals", city: "Arizona", nickname: "Cardinals", singular: "Cardinal", conference: "NFC", divisionName: "West", espnId: "22", siteDomain: "azcardinals.com" },
  { abbreviation: "lar", slug: "los-angeles-rams", city: "Los Angeles", nickname: "Rams", singular: "Ram", conference: "NFC", divisionName: "West", espnId: "14", siteDomain: "therams.com" },
  { abbreviation: "sf", slug: "san-francisco-49ers", city: "San Francisco", nickname: "49ers", singular: "49er", conference: "NFC", divisionName: "West", espnId: "25", siteDomain: "49ers.com" },
  { abbreviation: "sea", slug: "seattle-seahawks", city: "Seattle", nickname: "Seahawks", singular: "Seahawk", conference: "NFC", divisionName: "West", espnId: "26", siteDomain: "seahawks.com" },
];

function build(seed: TeamSeed): NflTeam {
  const abbr = seed.abbreviation;
  return {
    abbreviation: abbr,
    code: abbr.toUpperCase(),
    slug: seed.slug,
    city: seed.city,
    nickname: seed.nickname,
    singular: seed.singular,
    // TEAM_NAMES is the same string the news card already prints for this team;
    // reading it from there rather than concatenating city + nickname keeps the
    // two surfaces literally identical.
    fullName: TEAM_NAMES[abbr] ?? `${seed.city} ${seed.nickname}`,
    conference: seed.conference,
    divisionName: seed.divisionName,
    division: `${seed.conference} ${seed.divisionName}`,
    logo: teamLogoUrl(abbr) ?? "",
    primaryColor: TEAM_COLORS[abbr] ?? "#0b1634",
    secondaryColor: TEAM_ACCENTS[abbr] ?? "#d4af37",
    espnId: seed.espnId,
    espnAbbr: seed.espnAbbr ?? abbr.toUpperCase(),
    siteDomain: seed.siteDomain,
  };
}

/** All 32 teams, in division order. */
export const TEAMS: readonly NflTeam[] = SEEDS.map(build);

const BY_ABBR = new Map<string, NflTeam>(TEAMS.map((t) => [t.abbreviation, t]));
const BY_SLUG = new Map<string, NflTeam>(TEAMS.map((t) => [t.slug, t]));

/**
 * Every string we are willing to accept as naming a team, folded to a single
 * lookup form. Built once at module load.
 *
 * Retired and alternate codes are included on purpose: archived news rows,
 * saved WordPress shortcodes and hand-typed URLs all outlive a relocation, and
 * `[statchasers_team team="OAK"]` resolving to the Raiders is strictly better
 * than a 404 for someone who typed what they remembered.
 */
const ALIASES = new Map<string, NflTeam>();

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function alias(key: string, team: NflTeam): void {
  const folded = fold(key);
  if (folded && !ALIASES.has(folded)) ALIASES.set(folded, team);
}

for (const team of TEAMS) {
  alias(team.abbreviation, team);
  alias(team.espnAbbr, team);
  alias(team.slug, team);
  alias(team.fullName, team);
  alias(team.nickname, team);
  alias(`${team.city} ${team.nickname}`, team);
  // City alone is ambiguous for the two New York and two Los Angeles clubs, so
  // it is only registered when it is unique - `alias` keeps the first writer,
  // which would silently hand "los angeles" to whichever team happened to be
  // earlier in the table. Explicitly skipping is clearer than relying on that.
  if (!["New York", "Los Angeles"].includes(team.city)) alias(team.city, team);
}

// Relocations and alternate codes, mapped to the current franchise.
const EXTRA_ALIASES: Record<string, string> = {
  oak: "lv", // Oakland Raiders
  oakland: "lv",
  sd: "lac", // San Diego Chargers
  "san diego": "lac",
  stl: "lar", // St. Louis Rams
  "st louis": "lar",
  la: "lar",
  lram: "lar",
  wsh: "was",
  wft: "was", // Washington Football Team
  "washington redskins": "was",
  "washington football team": "was",
  jac: "jax",
  gnb: "gb",
  kan: "kc",
  nwe: "ne",
  nor: "no",
  sfo: "sf",
  tam: "tb",
  lvr: "lv",
  arz: "ari",
  blt: "bal",
  clv: "cle",
  hst: "hou",
};

for (const [key, abbr] of Object.entries(EXTRA_ALIASES)) {
  const team = BY_ABBR.get(abbr);
  if (team) alias(key, team);
}

/** Look a team up by its URL slug, e.g. "new-england-patriots". */
export function getTeamBySlug(slug: string | null | undefined): NflTeam | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

/** Look a team up by abbreviation, in either case: "NE", "ne", "WSH". */
export function getTeamByAbbreviation(
  abbr: string | null | undefined,
): NflTeam | null {
  if (!abbr) return null;
  return BY_ABBR.get(abbr.trim().toLowerCase()) ?? ALIASES.get(fold(abbr)) ?? null;
}

/**
 * Resolve anything that plausibly names a team - abbreviation, slug, full name,
 * nickname, unambiguous city, ESPN code, or a retired code - to the one team it
 * means. Returns null rather than guessing.
 *
 * This is the single entry point the routes and the shortcode use, so
 * `/team/patriots`, `/team/new-england-patriots` and `team="NE"` all land in
 * the same place.
 */
export function normalizeTeamName(
  value: string | null | undefined,
): NflTeam | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  return (
    BY_SLUG.get(raw.toLowerCase()) ??
    BY_ABBR.get(raw.toLowerCase()) ??
    ALIASES.get(fold(raw)) ??
    null
  );
}

export interface DivisionGroup {
  division: string;
  divisionName: DivisionName;
  teams: NflTeam[];
}

export interface ConferenceGroup {
  conference: Conference;
  divisions: DivisionGroup[];
}

/**
 * Teams grouped conference → division, in the order they are shown in the team
 * switcher. Computed once: the table never changes at runtime.
 */
export const TEAM_GROUPS: readonly ConferenceGroup[] = (
  ["AFC", "NFC"] as const
).map((conference) => ({
  conference,
  divisions: (["East", "North", "South", "West"] as const).map(
    (divisionName) => ({
      division: `${conference} ${divisionName}`,
      divisionName,
      teams: TEAMS.filter(
        (t) => t.conference === conference && t.divisionName === divisionName,
      ),
    }),
  ),
}));
