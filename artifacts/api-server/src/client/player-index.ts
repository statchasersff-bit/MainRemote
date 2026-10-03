/**
 * The player index's two controls.
 *
 * The page is complete before this file runs, exactly like the profile bundle:
 * every club, every player, every portrait and every standing is in the markup
 * the server sent, grouped by club and ordered within it. Nothing here fetches
 * and nothing here renders a row.
 *
 * It adds three things:
 *
 *   1. the position chips, which the server ships hidden for the reason
 *      renderPlayerSearch() ships its box hidden - a control with no script
 *      behind it is a promise the page cannot keep. Revealed here, and from
 *      here on they filter what is already in the document: no request, no
 *      re-render, no URL change.
 *   2. the club filter, which is the same kind of filtering on the other axis
 *      and is not a control of its own: the only way to choose a club is to
 *      pick one out of the search box above, which hands it here as an
 *      `scp:club-filter` event. What this file adds is the pill that says one
 *      is on and the way back out of it.
 *   3. portraits that take themselves out of a row rather than leaving a
 *      broken one, which is cdnImage()'s job in the search panel. Here the
 *      images arrive in the HTML instead of being built, so the same rule is
 *      applied to them after the fact - including to the ones that had already
 *      failed before this file ran.
 *
 * The search box above the chips is not this file's: it is the same widget the
 * profile carries, wired by client/player-search.ts, so a reader who types a
 * name gets the same eight results with the same portraits on the index as on
 * a player's own page. The one thing that differs between the two pages is
 * where a club row goes, and that is the box's business, not this file's.
 *
 * The two filters compose, and neither touches the URL: a club and a position
 * are a view of what is already here, not an address. Which is also why a
 * reader cannot arrive on one - nothing here is a page worth linking to that
 * /nfl/players/ and the club's own hub do not already answer.
 */

/** A club card, with its own counts to keep in step with what it is showing. */
interface Club {
  root: HTMLElement;
  /** "KC" - what a filter pick names this card by. "FA" for the free agents. */
  code: string;
  /** "Kansas City Chiefs", read off the card rather than passed in with the
   * pick: the heading is already the page's own spelling of the club's name,
   * and the pill should not be able to disagree with the card it filtered to. */
  name: string;
  list: HTMLElement | null;
  items: HTMLElement[];
  /** The ink half of the header pair: players with production behind them. */
  scoring: HTMLElement | null;
  /** The muted half: how many are listed at all. */
  count: HTMLElement | null;
}

/**
 * Drop an image the CDN has no file for.
 *
 * Neither CDN is this app's: Sleeper has no portrait for every player on the
 * list and a club's logo file can move. A 404 with an empty alt is an empty
 * box of the right size in some engines and a broken-image glyph in others,
 * and the second is worse than the plain well underneath.
 */
function dropBrokenImages(root: HTMLElement): void {
  // `error` does not bubble, so this listens in the capture phase - one
  // listener for six hundred portraits rather than six hundred listeners.
  root.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement && target.matches(".scp-dir-shot, .scp-dir-club-logo")) {
        target.remove();
      }
    },
    true,
  );

  // The ones that failed before this file ran. A complete image with no
  // intrinsic width is one the browser gave up on.
  for (const img of Array.from(
    root.querySelectorAll<HTMLImageElement>(".scp-dir-shot, .scp-dir-club-logo"),
  )) {
    if (img.complete && img.naturalWidth === 0) img.remove();
  }
}

export function wirePlayerDirectory(root: HTMLElement): void {
  dropBrokenImages(root);

  const grid = root.querySelector<HTMLElement>("[data-scp-dir]");
  if (!grid) return;

  const filters = root.querySelector<HTMLElement>("[data-scp-dir-filters]");
  const chips = filters
    ? Array.from(filters.querySelectorAll<HTMLButtonElement>("[data-scp-pos]"))
    : [];

  const clubs: Club[] = Array.from(
    grid.querySelectorAll<HTMLElement>("[data-scp-club]"),
  ).map((club) => ({
    root: club,
    code: club.dataset["team"] ?? "",
    name: (club.querySelector<HTMLElement>(".scp-dir-club-name")?.textContent ?? "").trim(),
    list: club.querySelector<HTMLElement>("[data-scp-dir-list]"),
    items: Array.from(club.querySelectorAll<HTMLElement>(".scp-dir-item")),
    scoring: club.querySelector<HTMLElement>("[data-scp-club-scoring]"),
    count: club.querySelector<HTMLElement>("[data-scp-club-count]"),
  }));

  const total = root.querySelector<HTMLElement>("[data-scp-dir-count]");
  const empty = root.querySelector<HTMLElement>("[data-scp-dir-empty]");

  // The club pill: the toolbar's one piece of state that is not a chip.
  const pill = root.querySelector<HTMLElement>("[data-scp-dir-club]");
  const pillName = root.querySelector<HTMLElement>("[data-scp-dir-club-name]");
  const pillClear = root.querySelector<HTMLButtonElement>("[data-scp-dir-club-clear]");

  /* The two axes of the view. Neither is in the URL; see the head of the file. */
  let position = "all";
  let club: string | null = null;

  /** Whether this card is one the club filter is letting through. */
  const inScope = (entry: Club): boolean => club === null || entry.code === club;

  const apply = (): void => {
    const all = position === "all";
    let shown = 0;

    for (const entry of clubs) {
      // A club the filter excludes is off the page rather than an empty card -
      // the same rule the position filter already applies to a club it empties.
      if (!inScope(entry)) {
        entry.root.hidden = true;
        continue;
      }
      let visible = 0;
      let scoring = 0;
      for (const item of entry.items) {
        const match = all || item.dataset["pos"] === position;
        // `hidden` rather than a class: the row is a link, and a link that is
        // merely invisible is still in the tab order and still read aloud.
        item.hidden = !match;
        if (!match) continue;
        visible += 1;
        // The same rule the server counted by - directoryBand()'s one band for
        // "nothing to show", read off the row rather than recomputed here.
        if (item.dataset["band"] !== "idle") scoring += 1;
      }
      // A club with nobody left is not an empty card, it is not on the page -
      // thirty-two headings over nothing is worse than the filter itself.
      entry.root.hidden = visible === 0;
      if (entry.scoring) entry.scoring.textContent = String(scoring);
      if (entry.count) entry.count.textContent = String(visible);
      // The position rules divide runs of positions. Filtered to one position
      // there are no runs, so the first rule would be a line under the header
      // dividing nothing.
      if (entry.list) {
        if (all) entry.list.setAttribute("data-grouped", "");
        else entry.list.removeAttribute("data-grouped");
      }
      shown += visible;
    }

    if (total) total.textContent = String(shown);
    if (empty) empty.hidden = shown > 0;

    for (const chip of chips) {
      const active = (chip.dataset["scpPos"] ?? "") === position;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  /*
   * The chip counts, over the clubs currently in scope.
   *
   * League-wide they are the server's own numbers and this changes nothing.
   * Filtered to one club they would otherwise be a lie of exactly the kind the
   * server took care to avoid when it counted the positions the roster
   * actually had: "K 32" over a card with one kicker on it. So they are
   * recounted, and a position the club has nobody at loses its chip rather
   * than becoming a 0 to press and find nothing behind.
   */
  const syncChips = (): void => {
    const counts = new Map<string, number>();
    let scope = 0;
    for (const entry of clubs) {
      if (!inScope(entry)) continue;
      for (const item of entry.items) {
        scope += 1;
        const pos = item.dataset["pos"];
        if (pos) counts.set(pos, (counts.get(pos) ?? 0) + 1);
      }
    }
    for (const chip of chips) {
      const value = chip.dataset["scpPos"] ?? "";
      const count = value === "all" ? scope : counts.get(value) ?? 0;
      const label = chip.querySelector<HTMLElement>(".scp-dir-chip-n");
      if (label) label.textContent = String(count);
      chip.hidden = count === 0;
    }
  };

  /**
   * Show one club, or the league.
   *
   * The name on the pill comes off the card this lands on rather than out of
   * the event, so the toolbar cannot name a club the grid is not showing.
   */
  const setClub = (code: string | null): void => {
    const card = code === null ? null : clubs.find((entry) => entry.code === code);
    // A code no card answers to - a search island cached from a roster newer
    // than the page around it - leaves the view alone rather than emptying it.
    if (code !== null && !card) return;

    club = code;

    // A club with nobody at the chosen position would be a filtered page with
    // nothing on it, and the reader asked for the club, not for the position.
    if (card && !card.items.some((item) => (item.dataset["pos"] ?? "") === position)) {
      position = "all";
    }

    if (pillName) pillName.textContent = card ? card.name : "";
    if (pill) pill.hidden = card === null;
    // What the one-card view is styled by: auto-fill would otherwise leave the
    // single card that is left in the first of four tracks.
    if (card) grid.dataset["club"] = card.code;
    else delete grid.dataset["club"];

    syncChips();
    apply();
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      position = chip.dataset["scpPos"] ?? "all";
      apply();
    });
  }

  /*
   * A club picked out of the search box.
   *
   * Listened for on the root rather than on the widget: this file does not
   * know the box exists, only that a pick may arrive from somewhere above the
   * grid, which is what keeps the two of them independent of the order they
   * are wired in.
   */
  root.addEventListener("scp:club-filter", (event) => {
    const detail = (event as CustomEvent<{ code?: unknown }>).detail;
    const code = detail?.code;
    if (typeof code === "string" && code !== "") setClub(code);
  });

  if (pillClear) {
    pillClear.addEventListener("click", () => {
      setClub(null);
      // The pill the click was on has just left the page, so the focus on it
      // would go to the body. It goes to the box instead: a reader who cleared
      // one club is most likely about to name another.
      root.querySelector<HTMLInputElement>(".scp-search-input")?.focus();
    });
  }

  // Last, so a reader never sees a control that is not wired yet. The pill
  // stays hidden either way - it has its own `hidden`, and no club is on.
  if (filters && chips.length > 0) filters.hidden = false;
}
