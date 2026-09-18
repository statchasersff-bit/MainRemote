/**
 * Who and what a post is about.
 *
 * This is the step that lets an X post join the rest of the archive rather than
 * sit beside it. Everything it resolves against is the index the news tool
 * already maintains — the Sleeper player dictionary behind the headshots, the
 * team map behind the card colours — so a post tagged here lands on the same
 * player, the same team code and the same team page as a wire story about the
 * same person, with no second source of truth about who plays where.
 *
 * Both answers are best-effort and both may be null. A post the matcher cannot
 * place is still stored and still shown; it simply carries no player and no
 * team, exactly like a wire row with an unreadable headshot.
 */

import { TEAM_NAMES } from "../render";
import { playerForSearchKey, type NamedPlayer } from "../team/roster";

/**
 * Fold a name the way Sleeper's own search index does: lowercase, unaccented,
 * punctuation and spaces removed. "Ja'Marr Chase" -> "jamarrchase".
 */
function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Club nicknames and codes, as they appear in a reporter's shorthand.
 *
 * Built from TEAM_NAMES rather than hand-listed, so the 32 entries cannot drift
 * from the ones the cards and the team pages use. The nickname is the last word
 * of the full name ("Eagles"), with the handful of two-word nicknames spelled
 * out below — and every code ("sf", "kc") is matched too, because that is how
 * half of these posts are actually written.
 */
function buildTeamPatterns(): Array<{ team: string; pattern: RegExp }> {
  const extras: Record<string, string[]> = {
    was: ["commanders", "washington"],
    ne: ["patriots", "pats", "new england"],
    no: ["saints", "new orleans"],
    sf: ["49ers", "niners", "san francisco"],
    tb: ["buccaneers", "bucs", "tampa bay", "tampa"],
    gb: ["packers", "green bay"],
    kc: ["chiefs", "kansas city"],
    lv: ["raiders", "las vegas"],
    lac: ["chargers", "la chargers"],
    lar: ["rams", "la rams"],
    nyg: ["giants", "new york giants", "ny giants"],
    nyj: ["jets", "new york jets", "ny jets"],
    jax: ["jaguars", "jags", "jacksonville"],
    ari: ["cardinals", "cards", "arizona"],
    bal: ["ravens", "baltimore"],
    min: ["vikings", "vikes", "minnesota"],
    ind: ["colts", "indianapolis", "indy"],
  };

  const patterns: Array<{ team: string; pattern: RegExp }> = [];

  /**
   * City names, but only where the city belongs to exactly one club.
   *
   * "Detroit is dealing a pick to the Rams" is how these posts are actually
   * written, so the city has to count. "New York" and "Los Angeles" do not:
   * each is two clubs, and resolving one of them to a single team would be
   * inventing a fact — the same call the roster index makes about a name shared
   * by two players. Derived by counting rather than hand-listed, so an expansion
   * or a relocation cannot leave a stale exception behind.
   */
  const cityOwners = new Map<string, number>();
  for (const fullName of Object.values(TEAM_NAMES)) {
    const city = fullName.split(" ").slice(0, -1).join(" ").toLowerCase();
    cityOwners.set(city, (cityOwners.get(city) ?? 0) + 1);
  }

  for (const [team, fullName] of Object.entries(TEAM_NAMES)) {
    const words = new Set<string>();
    // "Philadelphia Eagles" -> "eagles", plus the full name itself.
    const nickname = fullName.split(" ").pop();
    if (nickname) words.add(nickname.toLowerCase());
    words.add(fullName.toLowerCase());
    const city = fullName.split(" ").slice(0, -1).join(" ").toLowerCase();
    if (city && cityOwners.get(city) === 1) words.add(city);
    for (const extra of extras[team] ?? []) words.add(extra);

    const alternatives = [...words]
      .sort((a, b) => b.length - a.length)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    patterns.push({
      team,
      // The code gets its own alternative with word boundaries so "sf" matches
      // "SF" and "49ers" but not the "sf" inside another word.
      pattern: new RegExp(`\\b(?:${alternatives}|${team})\\b`, "i"),
    });
  }

  return patterns;
}

let teamPatterns: Array<{ team: string; pattern: RegExp }> | null = null;

/**
 * Strip what should not be matched against.
 *
 * URLs go because a t.co link is noise and an expanded one can contain a team
 * name that the post is not about ("nfl.com/eagles/..."). Handles go because
 * "@Chargers" in a mention is not the subject of the sentence and, more to the
 * point, a reporter's own handle (@nflstroud) is in every post they write.
 */
function readableText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first player named in the text, or null.
 *
 * Works over word windows rather than a scan of every roster name: post text is
 * short and the roster is thousands of names, so it is much cheaper to fold the
 * handful of two- and three-word windows a sentence contains and look each one
 * up than to test every player against the sentence. Three words first, so
 * "Marvin Harrison Jr" wins over the "Marvin Harrison" inside it.
 *
 * First match, not every match: a post routinely names two or three people
 * ("the Bears are signing X to replace Y"), and a card shows one player. The
 * first named is the subject far more often than not, and the full text is on
 * the card either way.
 */
export function findPlayer(text: string): NamedPlayer | null {
  const words = readableText(text).split(" ").filter(Boolean);

  for (let size = 3; size >= 2; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const window = words.slice(i, i + size).join(" ");
      // A window that is mostly punctuation folds to something too short to be
      // a name; skip it before paying for the lookup.
      const key = foldName(window);
      if (key.length < 6) continue;
      const player = playerForSearchKey(key);
      if (player) return player;
    }
  }

  return null;
}

/**
 * The club the text is about, as a lowercase code, or null.
 *
 * Only returns a team when exactly one is named. A post that mentions two clubs
 * is usually about a transaction between them ("Detroit is dealing Stafford to
 * the Rams"), and picking one of the two would file it under a team page where
 * it does not belong — the same call the roster index makes about an ambiguous
 * player name, for the same reason.
 */
export function findTeam(text: string): string | null {
  teamPatterns ??= buildTeamPatterns();
  const readable = readableText(text);
  if (!readable) return null;

  let found: string | null = null;
  for (const { team, pattern } of teamPatterns) {
    if (!pattern.test(readable)) continue;
    if (found) return null;
    found = team;
  }
  return found;
}

export interface DetectedEntities {
  player: NamedPlayer | null;
  /** The player's club when one was named, else the club found in the text. */
  team: string | null;
}

/**
 * Both, with the player's own team winning.
 *
 * A named player's club comes from the roster and is a fact; a club name in the
 * sentence is a guess about what the sentence is about. When a post says
 * "49ers RB Christian McCaffrey", both agree. When it says "the Jets are
 * signing Christian McCaffrey", the roster is one transaction behind and the
 * text is right — but this cannot know which of those it is looking at, and
 * preferring the roster keeps the card consistent with the player's page.
 */
export function detectEntities(...parts: Array<string | null | undefined>): DetectedEntities {
  const text = parts.filter(Boolean).join(" ");
  const player = findPlayer(text);
  return {
    player,
    team: player?.team ?? findTeam(text),
  };
}
