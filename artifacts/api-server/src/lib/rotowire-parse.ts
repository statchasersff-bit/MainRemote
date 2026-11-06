/**
 * RotoWire's NFL news pages, parsed into the wire's item shape.
 *
 * No network. The sweep in lib/rotowire-news.ts fetches; this file turns what
 * it fetched into the same RawNewsItem the Dynasty Command relay used to hand
 * us, so the archive, the dedupe keys and the News tab see one wire.
 *
 * Why the HTML and not the RSS: RotoWire's RSS carries the five newest notes
 * and nothing else, so anything posted between two reads is gone for good.
 * The per-team news page (`/football/news.php?team=PIT`) carries the 25 newest
 * notes for that club - a week or more of them - with the player, position,
 * injury tag, date and the free news blurb. The paid "ANALYSIS" paragraph is
 * not on the page and is not wanted. Thirty-two of those pages are the whole
 * league.
 *
 * The page gives a date, not a time. The sweep fills the time in from the
 * note's own headline page (its NewsArticle datePublished) the first time it
 * sees a note, and from the archive's memory after that - see
 * lib/rotowire-news.ts.
 */

import type { RawNewsItem } from "./news-item";
import type { NflTeam } from "./team/teams";
import { nameMatchKey } from "./render";

/** Where RotoWire's football section lives. Links on the page are relative to it. */
export const ROTOWIRE_ORIGIN = "https://www.rotowire.com";

/**
 * RotoWire's team code for each of ours. Identical except where Sleeper's
 * lowercase code and RotoWire's disagree; spelled out in full so a club that
 * moves or renames is a one-line change, not a guess at runtime.
 */
const TEAM_CODES: Record<string, string> = {
  ari: "ARI", atl: "ATL", bal: "BAL", buf: "BUF", car: "CAR", chi: "CHI",
  cin: "CIN", cle: "CLE", dal: "DAL", den: "DEN", det: "DET", gb: "GB",
  hou: "HOU", ind: "IND", jax: "JAX", kc: "KC", lac: "LAC", lar: "LAR",
  lv: "LV", mia: "MIA", min: "MIN", ne: "NE", no: "NO", nyg: "NYG",
  nyj: "NYJ", phi: "PHI", pit: "PIT", sea: "SEA", sf: "SF", tb: "TB",
  ten: "TEN", was: "WAS",
};

export function rotowireTeamCode(team: Pick<NflTeam, "abbreviation">): string {
  const code = TEAM_CODES[team.abbreviation];
  if (!code) throw new Error(`no RotoWire team code for ${team.abbreviation}`);
  return code;
}

/** The team's news page: its 25 newest player notes. */
export function rotowireTeamUrl(team: Pick<NflTeam, "abbreviation">): string {
  return `${ROTOWIRE_ORIGIN}/football/news.php?team=${rotowireTeamCode(team)}`;
}

/** One note as the team page prints it. */
export interface RotowireNote {
  /** RotoWire's numeric id for the note, from the headline link. */
  noteId: string;
  playerName: string;
  /** The player page path's slug, e.g. "aaron-rodgers-4307". */
  playerSlug: string;
  headline: string;
  /** Absolute URL of the note's own page. */
  headlineUrl: string;
  /** RotoWire's team code from the logo, e.g. "PIT". */
  teamCode: string | null;
  position: string | null;
  /** The injury tag beside the position ("Undisclosed", "Knee"), or null. */
  injury: string | null;
  /** The date as printed, e.g. "November 5, 2026". */
  dateText: string;
  /** The free blurb, tags stripped and entities decoded. */
  news: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Tags out, entities decoded, whitespace folded. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * The text of the first element with `className`, searched inside `block`.
 *
 * The page's blocks are flat: one div per field, no nesting of the same class,
 * so a non-greedy match to the next closing div is the whole field. A field
 * carrying inline links (the news blurb) still ends at its own </div>, because
 * <a> closes with </a>.
 */
function field(block: string, className: string): string | null {
  const m = new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</(?:div|b|span)>`, "i").exec(block);
  return m ? textOf(m[1]!) : null;
}

/**
 * Every note on a team page, in page order (newest first).
 *
 * A note the parser cannot identify - no headline id, no player - is skipped
 * rather than stored under a made-up key: the archive dedupes on title and id,
 * and a guessed id is how one story becomes two rows.
 */
export function parseRotowirePage(html: string): RotowireNote[] {
  const notes: RotowireNote[] = [];
  const blocks = html.split(/<div class="news-update(?:\s[^"]*)?">/).slice(1);

  for (const block of blocks) {
    const player = /<a[^>]*class="[^"]*news-update__player-link[^"]*"[^>]*href="\/football\/player\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const head = /<a[^>]*class="[^"]*news-update__headline[^"]*"[^>]*href="([^"]+?-(\d+))"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!player || !head) continue;

    const playerName = textOf(player[2]!);
    const headline = textOf(head[3]!);
    if (!playerName || !headline) continue;

    const logo = /<img[^>]*class="[^"]*news-update__logo[^"]*"[^>]*alt="([A-Z]{2,4})"/i.exec(block);
    const dateText = field(block, "news-update__timestamp") ?? "";
    const news = field(block, "news-update__news") ?? "";
    const href = head[1]!;

    notes.push({
      noteId: head[2]!,
      playerName,
      playerSlug: player[1]!,
      headline,
      headlineUrl: href.startsWith("http") ? href : `${ROTOWIRE_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`,
      teamCode: logo ? logo[1]!.toUpperCase() : null,
      position: field(block, "news-update__pos"),
      injury: field(block, "news-update__inj"),
      dateText,
      news,
    });
  }

  return notes;
}

/**
 * The note's publish time from its own page, as an ISO string, or null.
 *
 * The headline page carries a NewsArticle JSON-LD block with datePublished
 * (and the analytics data layer repeats it as article_publish_date). Either
 * will do; both are read because the page template has changed before.
 */
export function parseHeadlineTime(html: string): string | null {
  const m =
    /"datePublished"\s*:\s*"([^"]+)"/.exec(html) ??
    /"article_publish_date"\s*:\s*"([^"]+)"/.exec(html);
  if (!m) return null;
  const ms = Date.parse(m[1]!);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The page's date as a time, when no better one is known: noon Eastern on
 * that day. Used only for a note whose headline page could not be read; the
 * sweep prefers the real time and the archive keeps whichever it stored first.
 */
export function noonEasternOf(dateText: string): string | null {
  const ms = Date.parse(`${dateText} 12:00:00 EST`);
  if (!Number.isFinite(ms)) return null;
  // EST is fixed at -5. Summer notes land an hour late this way, which is
  // still the same day and still noon-ish; exact times come from the page.
  return new Date(ms).toISOString();
}

/** The wire's id for a RotoWire note. Same spelling the relay used, so a story already archived through it is the same row. */
export function rotowireItemId(noteId: string): string {
  return `rotowire:nfl${noteId}`;
}

/** The wire's title convention, "Player: Headline" - the archive's dedupe key is built on it. */
export function rotowireItemTitle(note: Pick<RotowireNote, "playerName" | "headline">): string {
  return `${note.playerName}: ${note.headline}`;
}

/**
 * A note as the archive stores it. `pubDate` is whatever the sweep resolved;
 * `image` is the Sleeper headshot when the player could be matched.
 */
export function rotowireItem(
  note: RotowireNote,
  pubDate: string,
  image: string | null,
): RawNewsItem {
  const item: RawNewsItem = {
    id: rotowireItemId(note.noteId),
    title: rotowireItemTitle(note),
    link: note.headlineUrl,
    pubDate,
    playerName: note.playerName,
  };
  if (image) item.image = image;
  if (note.news) item.summary = note.news;
  return item;
}

/* ------------------------------------------------------------- headshots */

export interface RosterEntry {
  id: string;
  team: string | null;
  position: string | null;
}

/**
 * The Sleeper headshot for a note's player, or null.
 *
 * Name first; a shared name is settled by the note's team, then position.
 * Still ambiguous means no picture rather than the wrong one.
 */
export function headshotFor(
  note: Pick<RotowireNote, "playerName" | "teamCode" | "position">,
  roster: Map<string, RosterEntry[]>,
): string | null {
  const candidates = roster.get(nameMatchKey(note.playerName)) ?? [];
  if (candidates.length === 0) return null;
  let pick: RosterEntry[] = candidates;
  if (pick.length > 1 && note.teamCode) {
    const onTeam = pick.filter((c) => c.team === note.teamCode);
    if (onTeam.length > 0) pick = onTeam;
  }
  if (pick.length > 1 && note.position) {
    const atPos = pick.filter((c) => c.position === note.position);
    if (atPos.length > 0) pick = atPos;
  }
  if (pick.length !== 1) return null;
  return `https://sleepercdn.com/content/nfl/players/thumb/${pick[0]!.id}.jpg`;
}

/** A player the live Sleeper index knows, as headshotFromIndex reads one. */
export interface IndexedPlayer {
  id: string;
  /** Lowercase club code, as the index stores it. */
  team: string;
}

/**
 * The Sleeper headshot from the live, all-positions index, or null.
 *
 * The fallback for players the shipped roster leaves out - it is the fantasy
 * pool, so a linebacker, a guard or a punter on the wire had no picture. The
 * index is keyed by Sleeper's search_full_name ("henrytootoo"), with
 * suffix-free aliases, and a name on two clubs is already dropped from it.
 * The player must be on the club whose page carried the note: a stale or
 * wrong match then costs a picture rather than showing the wrong face.
 */
export function headshotFromIndex(
  note: Pick<RotowireNote, "playerName" | "teamCode">,
  lookup: (key: string) => IndexedPlayer | null,
): string | null {
  const key = note.playerName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!key || !note.teamCode) return null;
  const player = lookup(key);
  if (!player || player.team.toUpperCase() !== note.teamCode) return null;
  return `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;
}
