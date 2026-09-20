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
 * Nothing here writes to the URL and nothing here fetches.
 */

import { searchKey } from "../lib/render";

/** How many results the panel shows. More than this is a list, not an answer. */
const LIMIT = 8;

/** A club, as the island carries it: named once, referenced by every player. */
interface Club {
  name: string;
  logo: string;
}

/** One row of the inlined roster, split and normalised once. */
interface Entry {
  slug: string;
  name: string;
  position: string;
  team: string;
  /** Sleeper's id — what the portrait CDN is keyed by. */
  id: string;
  club: Club | null;
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

/** Ids are minted per widget: a page may legitimately hold two fragments. */
let widgetSeq = 0;

function parseRoster(script: HTMLScriptElement): Entry[] {
  let island: { rows?: unknown; teams?: Record<string, Club> };
  try {
    island = JSON.parse(script.textContent ?? "{}");
  } catch {
    // A truncated island is a broken search, not a broken page.
    return [];
  }
  const rows = island.rows;
  if (!Array.isArray(rows)) return [];
  const teams = island.teams ?? {};

  const entries: Entry[] = [];
  for (const row of rows) {
    if (typeof row !== "string") continue;
    const [slug, name, position, team, id] = row.split("|");
    if (!slug || !name) continue;
    const key = searchKey(name);
    entries.push({
      slug,
      name,
      position: position ?? "",
      team: team ?? "",
      id: id ?? "",
      club: (team && teams[team]) || null,
      key,
      words: key ? key.split(" ") : [],
      compact: key.replace(/ /g, ""),
    });
  }
  return entries;
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
  entry: Entry,
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

function match(entries: Entry[], value: string): Entry[] {
  const query = searchKey(value);
  if (!query) return [];
  const words = query.split(" ");
  const compact = query.replace(/ /g, "");

  const hits: Array<{ entry: Entry; rank: number }> = [];
  for (const entry of entries) {
    const rank = score(entry, query, compact, words);
    if (rank > 0) hits.push({ entry, rank });
  }

  // A stable sort on a list the server already put in alphabetical order, so
  // players of equal rank stay alphabetical rather than arriving in whatever
  // order the roster file happens to hold them.
  hits.sort((a, b) => b.rank - a.rank);
  return hits.slice(0, LIMIT).map((hit) => hit.entry);
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
  const query = widget.dataset["scpQuery"] ?? "";

  // The roles go on now rather than in the server's markup: they promise
  // behaviour — a list that opens, an option that can be highlighted with the
  // arrow keys — and until this file runs there is none to deliver.
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Player results");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", id);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  // Now it can filter, so now it exists.
  widget.hidden = false;

  let entries: Entry[] | null = null;
  let options: HTMLAnchorElement[] = [];
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

  const render = (hits: Entry[], typed: boolean): void => {
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
      empty.textContent = "No player found.";
      list.appendChild(empty);
    }

    hits.forEach((entry, i) => {
      const link = document.createElement("a");
      link.className = "scp-search-opt";
      link.id = `${id}-opt-${i}`;
      link.href = `${prefix}${entry.slug}${query}`;
      // Same as every other link in this fragment: break out of the legacy
      // iframe mount rather than loading the next player inside it.
      link.target = "_top";
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
      link.appendChild(face);

      const who = document.createElement("span");
      who.className = "scp-search-who";

      const name = document.createElement("span");
      name.className = "scp-search-name";
      name.textContent = entry.name;
      who.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "scp-search-meta";
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
          ? "No player found."
          : `${hits.length} player${hits.length === 1 ? "" : "s"} found.`;
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
    const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
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
