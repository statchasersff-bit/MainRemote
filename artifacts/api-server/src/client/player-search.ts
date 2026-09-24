/**
 * The player search above the header.
 *
 * The server ships the box hidden, the whole roster inlined beside it as a
 * JSON island, and no behaviour at all — see renderPlayerSearch() in
 * lib/player-render.ts for why it is hidden and why the roster is inlined
 * rather than fetched. This file is what turns that markup into a control:
 * it reveals the box, parses the island once (lazily, on the first keystroke
 * rather than at boot — several hundred rows is not free, and most readers
 * never type), filters it, and builds the results as real links.
 *
 * REAL LINKS, not a click handler that assigns location: a result has to be
 * middle-clickable, open-in-new-tabbable and copyable like every other link on
 * this page, and — inside the legacy iframe mount — has to carry the same
 * `target="_top"` the rest of them do, or the player page opens inside the
 * frame. The combobox roles sit on top of the anchors rather than replacing
 * them.
 *
 * ONE ROW IS NOT A LINK, on one page. The index prints `data-scp-club-filter`
 * on the widget (see renderPlayerSearch in lib/player-render.ts) because there
 * a club is not somewhere to go: the page below the box is the whole roster
 * grouped by club, so picking the Chiefs means "show me the Chiefs' players".
 * That row is a <button>, which is what a control that changes this page
 * rather than leaving it has to be — an anchor with no address is not
 * middle-clickable or copyable in any useful sense, it is a link that lies.
 * The pick is handed to the directory as a bubbling event; the filtering, the
 * counts and the pill that says a club is on are client/player-index.ts's.
 *
 * Nothing here writes to the URL and nothing here fetches.
 */

import { searchKey } from "../lib/render";

/** How many results the panel shows. More than this is a list, not an answer. */
const LIMIT = 8;

/**
 * How many of those may be clubs.
 *
 * Clubs lead the list, because there are 32 of them against ~575 players and a
 * reader who has typed something a club answers has almost certainly asked for
 * the club. The cap is what stops a broad query — a single letter — from
 * spending the whole panel on hubs and burying the player the reader was
 * actually reaching for.
 *
 * Four rather than three because four clubs begin with "New", and a reader who
 * types it and is shown three of them has been told something untrue about the
 * fourth. Half the panel is the most this may take.
 */
const TEAM_LIMIT = 4;

/** A club, as the island carries it: named once, referenced by every player. */
interface Club {
  name: string;
  logo: string;
}

/**
 * What the matcher needs of anything it ranks.
 *
 * Both a player and a club are a name to be found by; everything that differs
 * between them belongs to the row that is built, not to the finding of it.
 */
interface Searchable {
  /** The name as it is matched: lowercase, unaccented, punctuation folded. */
  key: string;
  /** That same key split into words, so a surname matches on its own. */
  words: string[];
  /**
   * The key with its spaces closed up.
   *
   * searchKey() folds punctuation to a SPACE, so "Ja'Marr" normalises to
   * "ja marr" and a reader typing "jamarr" — the spelling the slug itself
   * uses — matches nothing without this. Closing the spaces on both sides
   * makes the two spellings one string, which is the same trade the name's
   * own slug makes.
   */
  compact: string;
}

/** One club, as a destination rather than as a row's affiliation. */
interface TeamEntry extends Searchable {
  kind: "team";
  slug: string;
  /**
   * "KC" — the club's display code.
   *
   * Carried because it is the name the club card on the index answers to
   * (`data-scp-club` holds this exact string), so it is what a filter pick has
   * to say. The slug addresses the hub; the code addresses the card.
   */
  code: string;
  /** "Baltimore Ravens" — the city and the nickname, as the row prints it. */
  name: string;
  /** "AFC North", the line under the name. */
  division: string;
  logo: string;
}

/** One row of the inlined roster, split and normalised once. */
interface Entry extends Searchable {
  kind: "player";
  slug: string;
  name: string;
  position: string;
  team: string;
  /** Sleeper's id — what the portrait CDN is keyed by. */
  id: string;
  club: Club | null;
}

/** Either kind of destination the panel can offer. */
type Hit = Entry | TeamEntry;

/** Ids are minted per widget: a page may legitimately hold two fragments. */
let widgetSeq = 0;

/** The three matching fields, derived from one name, in one place. */
function searchable(text: string): Searchable {
  const key = searchKey(text);
  return { key, words: key ? key.split(" ") : [], compact: key.replace(/ /g, "") };
}

function parseRoster(script: HTMLScriptElement): { players: Entry[]; teams: TeamEntry[] } {
  const empty = { players: [], teams: [] };
  let island: { rows?: unknown; teams?: Record<string, Club>; clubs?: unknown };
  try {
    island = JSON.parse(script.textContent ?? "{}");
  } catch {
    // A truncated island is a broken search, not a broken page.
    return empty;
  }
  const rows = island.rows;
  if (!Array.isArray(rows)) return empty;
  const teams = island.teams ?? {};

  const players: Entry[] = [];
  for (const row of rows) {
    if (typeof row !== "string") continue;
    const [slug, name, position, team, id] = row.split("|");
    if (!slug || !name) continue;
    players.push({
      kind: "player",
      slug,
      name,
      position: position ?? "",
      team: team ?? "",
      id: id ?? "",
      club: (team && teams[team]) || null,
      ...searchable(name),
    });
  }

  const clubs: TeamEntry[] = [];
  // An island from before the clubs were added still searches its players:
  // this fragment is printed into a WordPress page that caches, so the two
  // halves can legitimately be of different vintages for a while.
  if (Array.isArray(island.clubs)) {
    for (const row of island.clubs) {
      if (typeof row !== "string") continue;
      const [code, slug, city, nickname, division] = row.split("|");
      if (!slug || !city || !nickname) continue;
      clubs.push({
        kind: "team",
        slug,
        code: code ?? "",
        name: `${city} ${nickname}`,
        division: division ?? "",
        logo: (code && teams[code]?.logo) || "",
        // The code is matched as a word of its own, so "gb" finds Green Bay —
        // which neither the city nor the nickname starts with. It is not part
        // of the name the row prints, only of the name it answers to.
        ...searchable(`${city} ${nickname} ${code ?? ""}`),
      });
    }
  }

  return { players, teams: clubs };
}

/**
 * An <img> that takes itself out of the row rather than leaving a broken one.
 *
 * Neither CDN is this app's: Sleeper has no portrait for every player on the
 * list and its logo file for a club can move. A 404 with an empty alt is an
 * empty box of the right size in some engines and a broken-image glyph in
 * others, and the second of those is worse than the plain well underneath.
 */
function cdnImage(src: string, className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

/**
 * How well one player answers what has been typed, 0 for "not at all".
 *
 * Three tiers, in the order a reader expects them:
 *
 *   3  the name starts with what was typed — "jaco" or "jamarr c" for Jacoby
 *      and Ja'Marr, punctuation ignored on both sides.
 *   2  every word typed starts a word of the name — "brissett" on its own,
 *      "j brissett", and "brissett jac" for the same man. Order-free, because
 *      a reader typing two words is naming a person, not dictating a string.
 *   1  it appears anywhere in the name — the fallback that catches a middle
 *      name, or a half of a hyphenated one nobody thinks of as a word.
 *
 * Both sides are normalised by searchKey, which is what makes "andre" find
 * "André" and "aj" find "A.J." without this function knowing about either
 * spelling.
 */
function score(
  entry: Searchable,
  query: string,
  compact: string,
  words: string[],
): number {
  if (!entry.key) return 0;
  if (entry.key.startsWith(query) || entry.compact.startsWith(compact)) return 3;
  if (words.every((word) => entry.words.some((part) => part.startsWith(word)))) {
    return 2;
  }
  return entry.compact.includes(compact) ? 1 : 0;
}

/** The best `limit` of one list, still in the order the server sent them. */
function rank<T extends Searchable>(entries: T[], value: string, limit: number): T[] {
  const query = searchKey(value);
  if (!query) return [];
  const words = query.split(" ");
  const compact = query.replace(/ /g, "");

  const hits: Array<{ entry: T; rank: number }> = [];
  for (const entry of entries) {
    const scored = score(entry, query, compact, words);
    if (scored > 0) hits.push({ entry, rank: scored });
  }

  // A stable sort on a list the server already put in order — alphabetical for
  // the players, the league's own for the clubs — so equally ranked matches
  // stay in it rather than arriving in whatever order the file happens to hold.
  hits.sort((a, b) => b.rank - a.rank);
  return hits.slice(0, limit).map((hit) => hit.entry);
}

/**
 * Clubs first, then players, to one panel's worth.
 *
 * Two lists ranked separately rather than one ranked together, because the
 * two scores are not comparable: a club scores against 31 rivals and a player
 * against 574, so the same tier means something much rarer on the player side.
 * Interleaving them by score would push Lamar Jackson below the Jaguars for
 * "ja" — and a reader who wanted a club got one in the first three rows
 * either way.
 */
function match(entries: { players: Entry[]; teams: TeamEntry[] }, value: string): Hit[] {
  const teams = rank(entries.teams, value, TEAM_LIMIT);
  const players = rank(entries.players, value, LIMIT - teams.length);
  return [...teams, ...players];
}

export function wirePlayerSearch(root: HTMLElement): void {
  const widget = root.querySelector<HTMLElement>("[data-scp-search]");
  if (!widget) return;

  const input = widget.querySelector<HTMLInputElement>(".scp-search-input");
  const panel = widget.querySelector<HTMLElement>(".scp-search-panel");
  const list = widget.querySelector<HTMLElement>(".scp-search-list");
  const status = widget.querySelector<HTMLElement>("[data-scp-search-status]");
  const island = widget.querySelector<HTMLScriptElement>("[data-scp-roster]");
  if (!input || !panel || !list || !island) return;

  const id = `scp-search-${++widgetSeq}`;
  const prefix = widget.dataset["scpPrefix"] ?? "/player/";
  const teamPrefix = widget.dataset["scpTeamPrefix"] ?? "/team/";
  const query = widget.dataset["scpQuery"] ?? "";

  /*
   * Whether a club row filters this page instead of leaving it.
   *
   * Both halves are required. The attribute is the page saying it is the
   * index; the grid is the thing that would carry the pick out. A button that
   * dispatches into nothing is worse than the link it replaced — the reader
   * clicks a club and the page sits there — so if the roster below is missing
   * for any reason, every row goes back to being a destination.
   */
  const clubsFilter =
    "scpClubFilter" in widget.dataset && root.querySelector("[data-scp-dir]") !== null;

  // The roles go on now rather than in the server's markup: they promise
  // behaviour — a list that opens, an option that can be highlighted with the
  // arrow keys — and until this file runs there is none to deliver.
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Player and team results");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", id);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  // Now it can filter, so now it exists.
  widget.hidden = false;

  let entries: { players: Entry[]; teams: TeamEntry[] } | null = null;
  // Anchors, except for the club rows on the index, which are buttons. Both
  // answer to .click(), which is all Enter on the highlighted row needs.
  let options: HTMLElement[] = [];
  let active = -1;

  const setActive = (next: number): void => {
    const previous = options[active];
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    active = next;
    const current = options[active];
    if (!current) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    current.classList.add("is-active");
    current.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", current.id);
    // Only the panel scrolls, never the page: the reader is typing, and a
    // window that jumps under them is a worse answer than a clipped row.
    if (current.offsetTop < panel.scrollTop) {
      panel.scrollTop = current.offsetTop;
    } else if (
      current.offsetTop + current.offsetHeight >
      panel.scrollTop + panel.clientHeight
    ) {
      panel.scrollTop =
        current.offsetTop + current.offsetHeight - panel.clientHeight;
    }
  };

  const close = (): void => {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const render = (hits: Hit[], typed: boolean): void => {
    list.textContent = "";
    options = [];
    active = -1;
    input.removeAttribute("aria-activedescendant");

    if (!typed) {
      close();
      if (status) status.textContent = "";
      return;
    }

    if (hits.length === 0) {
      const empty = document.createElement("p");
      empty.className = "scp-search-empty";
      empty.textContent = "No player or team found.";
      list.appendChild(empty);
    }

    hits.forEach((entry, i) => {
      const filters = entry.kind === "team" && clubsFilter;

      // A button where the row acts on this page, an anchor where it leaves
      // it. See the head of this file for why the two cannot be one thing.
      let link: HTMLElement;
      if (filters && entry.kind === "team") {
        const button = document.createElement("button");
        // Without this a button in a form submits it. There is no form here by
        // design, but this fragment is printed into other people's pages.
        button.type = "button";
        button.dataset["club"] = entry.code;
        button.addEventListener("click", () => {
          // The directory does the filtering; this box only says which club
          // was asked for. An event rather than a call, so the two files stay
          // strangers and the order they are wired in cannot matter.
          widget.dispatchEvent(
            new CustomEvent("scp:club-filter", {
              bubbles: true,
              detail: { code: entry.code, name: entry.name },
            }),
          );
          // The box has answered, so it empties: what was typed is now said by
          // the pill in the toolbar, and leaving "kansas" in a box whose panel
          // reopens on focus would offer the reader the filter they already
          // have.
          input.value = "";
          render([], false);
          if (status) status.textContent = `Showing ${entry.name} players.`;
        });
        link = button;
      } else {
        const anchor = document.createElement("a");
        anchor.href =
          entry.kind === "team"
            ? `${teamPrefix}${entry.slug}/${query}`
            : `${prefix}${entry.slug}/${query}`;
        // Same as every other link in this fragment: break out of the legacy
        // iframe mount rather than loading the next player inside it.
        anchor.target = "_top";
        link = anchor;
      }

      link.className = "scp-search-opt";
      link.id = `${id}-opt-${i}`;
      // Marked rather than inferred from the shape of the row, so the
      // stylesheet can size a club's mark differently from a portrait without
      // reading the markup underneath it.
      link.dataset["kind"] = entry.kind;
      // Reached with the arrow keys through the input, never with Tab: a
      // combobox has one stop, and eight more would put the page's own
      // navigation eight keystrokes further away.
      link.tabIndex = -1;
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", "false");

      /*
       * The portrait, with the club's mark on its corner.
       *
       * The arrangement the app this page was ported from used for its own
       * autocomplete, and it is the right one for a list: both images read as
       * one object at the head of the row, so the eye runs down a single
       * column of faces rather than two columns of small pictures.
       */
      const face = document.createElement("span");
      face.className = "scp-search-face";
      if (entry.kind === "team") {
        // One mark, filling the well the portrait would have filled, rather
        // than a portrait with a badge on its corner. The club IS the subject
        // of this row, so it takes the whole of the space the subject gets.
        if (entry.logo) face.appendChild(cdnImage(entry.logo, "scp-search-mark"));
      } else {
        if (entry.id) {
          face.appendChild(
            cdnImage(
              `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(entry.id)}.jpg`,
              "scp-search-shot",
            ),
          );
        }
        if (entry.club?.logo) {
          face.appendChild(cdnImage(entry.club.logo, "scp-search-badge"));
        }
      }
      link.appendChild(face);

      const who = document.createElement("span");
      who.className = "scp-search-who";

      const name = document.createElement("span");
      name.className = "scp-search-name";
      name.textContent = entry.name;
      who.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "scp-search-meta";

      if (entry.kind === "team") {
        /*
         * "Team · AFC North", in the shape a player's row uses for
         * "QB · Cardinals".
         *
         * The word is not redundant with the mark beside it: this row is an
         * option in a listbox, and a reader hearing it read aloud has no mark
         * to look at. It is also the site's own word for these pages.
         */
        const kind = document.createElement("span");
        kind.className = "scp-search-kind";
        kind.textContent = "Team";
        meta.appendChild(kind);
        if (entry.division) {
          const dot = document.createElement("span");
          dot.className = "scp-search-dot";
          dot.textContent = "·";
          dot.setAttribute("aria-hidden", "true");
          meta.appendChild(dot);
          const division = document.createElement("span");
          division.className = "scp-search-club";
          division.textContent = entry.division;
          meta.appendChild(division);
        }
        who.appendChild(meta);
        link.appendChild(who);
        list.appendChild(link);
        options.push(link);
        return;
      }

      if (entry.position) {
        const pos = document.createElement("span");
        pos.className = "scp-search-pos";
        // The stylesheet colours it from here — the site's four position inks,
        // the same ones the depth chart and the matchup tables use. A position
        // without an ink of its own (a kicker) keeps the muted grey around it
        // rather than being given a fifth colour to mean "other".
        pos.dataset["pos"] = entry.position;
        pos.textContent = entry.position;
        meta.appendChild(pos);
      }
      if (entry.club) {
        if (entry.position) {
          const dot = document.createElement("span");
          dot.className = "scp-search-dot";
          dot.textContent = "·";
          // Decoration between two facts, not a third one: the row is an
          // option in a listbox and its name is read aloud as one string.
          dot.setAttribute("aria-hidden", "true");
          meta.appendChild(dot);
        }
        const club = document.createElement("span");
        club.className = "scp-search-club";
        club.textContent = entry.club.name;
        meta.appendChild(club);
      }
      if (meta.childNodes.length > 0) who.appendChild(meta);

      link.appendChild(who);
      list.appendChild(link);
      options.push(link);
    });

    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    panel.scrollTop = 0;

    if (status) {
      status.textContent =
        hits.length === 0
          ? "No player or team found."
          : `${hits.length} result${hits.length === 1 ? "" : "s"} found.`;
    }
  };

  const update = (): void => {
    // Parsed on demand: several hundred rows split and normalised is work
    // worth doing for a reader who searches and worth skipping for one who
    // does not.
    if (!entries) entries = parseRoster(island);
    const typed = input.value.trim() !== "";
    render(typed ? match(entries, input.value) : [], typed);
  };

  input.addEventListener("input", update);

  input.addEventListener("focus", () => {
    if (input.value.trim() !== "") update();
  });

  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (panel.hidden) {
          update();
          if (panel.hidden || options.length === 0) return;
          event.preventDefault();
          setActive(event.key === "ArrowDown" ? 0 : options.length - 1);
          return;
        }
        if (options.length === 0) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        // Wraps, so the list can be walked in either direction from either end
        // without the reader having to know which end they are at.
        setActive((active + step + options.length) % options.length);
        return;
      }
      case "Home":
      case "End": {
        if (panel.hidden || options.length === 0) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : options.length - 1);
        return;
      }
      case "Enter": {
        // The highlighted player, or — when the reader has typed enough that
        // only one name is left — that one. Nothing otherwise: this is not a
        // form, and Enter must never submit the page to itself.
        const target = options[active] ?? (options.length === 1 ? options[0] : null);
        if (!target) return;
        event.preventDefault();
        target.click();
        return;
      }
      case "Escape": {
        // First press closes the list, second clears the box — so Escape never
        // throws away what was typed while the reader was still reading it.
        if (!panel.hidden) {
          event.preventDefault();
          close();
          return;
        }
        if (input.value !== "") {
          event.preventDefault();
          input.value = "";
          update();
        }
        return;
      }
      default:
    }
  });

  // Pointer, not click: the panel must not close on the blur that a mousedown
  // fires before the link it lands on has had its own click.
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  list.addEventListener("mousemove", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".scp-search-opt",
    );
    if (!target) return;
    const index = options.indexOf(target);
    if (index >= 0 && index !== active) setActive(index);
  });

  input.addEventListener("blur", () => {
    close();
  });

  // A click anywhere else is a dismissal. On the document rather than the
  // window so a host page that stops propagation at its own root still closes
  // this, and capturing so a handler that swallows the event cannot keep the
  // panel open over the rest of the page.
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (panel.hidden) return;
      const target = event.target as Node | null;
      if (target && widget.contains(target)) return;
      close();
    },
    true,
  );
}
