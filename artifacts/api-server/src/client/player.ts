/**
 * Player page enhancement bundle.
 *
 * The page is complete before this file runs — every stat, every week of the
 * game log, every injury and every chart is in the HTML the server sent, and
 * the tab strip works with JavaScript disabled. Nothing here fetches anything
 * and nothing here renders a section.
 *
 * It adds five things:
 *   1. tab behaviour for the section bar, from client/enhance.ts;
 *   2. relative timestamps on the news list, likewise;
 *   3. height reporting for the legacy iframe mount, likewise;
 *   4. the player search above the header, from client/player-search.ts —
 *      the one control on the page that does not exist until this file runs,
 *      because a search box with no script behind it swallows typing and
 *      answers nothing;
 *   5. the behaviours particular to this page: a hover layer on the weekly
 *      chart, sortable columns on the game log and the career table, the
 *      per-week detail the game log folds away behind each week number, the
 *      header's staged squeeze, and centring the peers rail on the card the
 *      reader is standing on.
 *
 * (5)'s squeeze is the one thing here that changes how the page LOOKS rather
 * than what it does, and it is still an enhancement: the header is complete
 * and correctly sized without it — see the scale fallbacks in player.css —
 * and what the fitter adds is a size measured from the header's own parts
 * instead of guessed from the viewport.
 *
 * The chart already carries a `<title>` per point, so it is readable with no
 * script at all; what (5) adds is a real tooltip with a hit target bigger than
 * the 4px dot, which is the difference between a chart you can inspect and one
 * you can only look at.
 */

import { wireFrameHeight, wireTabs, wireTimestamps } from "./enhance";
import { wirePlayerDirectory } from "./player-index";
import { wirePlayerSearch } from "./player-search";

const ROOT_SELECTOR = "[data-scp-root]";

/**
 * The index of every profile — /player, and the fragment the container page at
 * /nfl/players/ mounts. A different root from the one above and deliberately
 * so: none of the profile's wiring (tabs, chart, sortable log, header fitter)
 * has anything to do on a page with no player on it.
 */
const INDEX_SELECTOR = "[data-scp-index]";

/* --------------------------------------------------------------- tooltip */

/**
 * A hover layer for the weekly points chart.
 *
 * One tooltip element per chart, positioned against the root rather than the
 * SVG, so it is not clipped by the SVG's own viewBox. Driven by pointer events
 * on invisible hit rectangles rather than on the 4px dots: a dot that small is
 * not a usable target, and widening the dot itself would change the chart.
 */
function wireChartTooltip(root: HTMLElement): void {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(".scp-figure"));

  for (const figure of figures) {
    const svg = figure.querySelector<SVGSVGElement>(".scp-spark");
    if (!svg) continue;

    const dots = Array.from(svg.querySelectorAll<SVGCircleElement>(".scp-spark-dot"));
    if (dots.length === 0) continue;

    const tip = document.createElement("div");
    tip.className = "scp-tip";
    tip.hidden = true;
    // Announced politely rather than asserted: the same information is in the
    // table below and in each point's <title>, so this must not interrupt.
    tip.setAttribute("role", "status");
    figure.appendChild(tip);

    const show = (dot: SVGCircleElement): void => {
      const week = dot.getAttribute("data-week");
      const value = dot.getAttribute("data-value");
      const opp = dot.getAttribute("data-opp");
      if (!week || !value) return;

      tip.textContent = `Week ${week}${opp ? ` vs ${opp}` : ""} · ${value} pts`;
      tip.hidden = false;

      // The dot's position in the figure's own box. getBoundingClientRect on
      // the dot is in viewport coordinates; both are, so the difference is the
      // offset inside the figure and survives any scroll position.
      const dotBox = dot.getBoundingClientRect();
      const figBox = figure.getBoundingClientRect();
      tip.style.left = `${dotBox.left + dotBox.width / 2 - figBox.left}px`;
      tip.style.top = `${dotBox.top - figBox.top}px`;
      dot.classList.add("is-hot");
    };

    const hide = (): void => {
      tip.hidden = true;
      for (const dot of dots) dot.classList.remove("is-hot");
    };

    for (const dot of dots) {
      // Pointer events rather than mouse events, so a touch tap works too.
      dot.addEventListener("pointerenter", () => show(dot));
      dot.addEventListener("pointerdown", () => show(dot));
      // Keyboard reachable, so the chart is inspectable without a pointer.
      dot.setAttribute("tabindex", "0");
      dot.addEventListener("focus", () => show(dot));
      dot.addEventListener("blur", hide);
    }

    svg.addEventListener("pointerleave", hide);
  }
}

/* ------------------------------------------------------------ sortable log */

/** The sort value for a cell: its number if it has one, else its text. */
function cellValue(cell: HTMLTableCellElement): number | string {
  const text = (cell.textContent ?? "").trim();
  // Strip the thousands separators the renderer adds, and any trailing unit.
  const numeric = Number(text.replace(/,/g, "").replace(/[^\d.\-]/g, ""));
  return text !== "" && Number.isFinite(numeric) ? numeric : text.toLowerCase();
}

/**
 * Make a marked table sortable by any column.
 *
 * Two tables opt in: the weekly game log and the career table on the Stats tab.
 * Both are "one row per period, sorted by that period" and both are read the
 * same way — you arrive in chronological order and re-sort to find the best or
 * worst of something.
 *
 * Rows that carry a colspan cell rather than a full set of columns — a week the
 * player did not play — cannot be sorted meaningfully, so they are pushed to
 * the bottom and kept in their original order rather than interleaved with real
 * results on a value they do not have.
 *
 * A <tfoot> is untouched: the career total belongs under the table however it
 * is sorted, not somewhere in the middle of it.
 *
 * The default order is the one the server sent, and the button that restores it
 * is the first column's header, so there is always a way back.
 */
interface RowGroup {
  row: HTMLTableRowElement;
  /** The expandable detail that belongs under it, when there is one. */
  detail: HTMLTableRowElement | null;
}

/**
 * The body's rows, with each detail row absorbed into the row above it.
 *
 * Sorting moves rows with appendChild, and a detail row is only a detail of the
 * row it follows — left to itself it has no sortable cells, sinks to the
 * bottom, and ends up describing a week it is nowhere near. So the pair moves
 * as one thing.
 */
function rowGroups(body: Element): RowGroup[] {
  const groups: RowGroup[] = [];

  for (const child of Array.from(body.children)) {
    const row = child as HTMLTableRowElement;
    const last = groups[groups.length - 1];
    if (row.classList.contains("scp-detail") && last && !last.detail) {
      last.detail = row;
      continue;
    }
    groups.push({ row, detail: null });
  }

  return groups;
}

function wireSortableLog(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-scp-sortable]"),
  );

  for (const table of tables) {
    // The LAST header row. The career table puts a column-group row above its
    // headers, and those cells are not columns — treating them as sort buttons
    // would map every click to the wrong index.
    const headerRow = table.querySelector<HTMLTableRowElement>("thead tr:last-child");
    const headers = headerRow
      ? Array.from(headerRow.querySelectorAll<HTMLTableCellElement>("th"))
      : [];
    const body = table.querySelector("tbody");
    if (!body || headers.length === 0) continue;

    const original = rowGroups(body);

    /** Re-append in this order, each detail following its own row. */
    const place = (groups: RowGroup[]): void => {
      for (const group of groups) {
        body.appendChild(group.row);
        if (group.detail) body.appendChild(group.detail);
      }
    };

    headers.forEach((header, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scp-sort";
      button.textContent = header.textContent ?? "";
      header.textContent = "";
      header.appendChild(button);
      header.setAttribute("aria-sort", index === 0 ? "ascending" : "none");

      let descending = true;

      button.addEventListener("click", () => {
        const playable = original.filter(
          (group) => group.row.getAttribute("data-status") === "active",
        );
        const rest = original.filter(
          (group) => group.row.getAttribute("data-status") !== "active",
        );

        if (index === 0) {
          // The week column restores the page as the server sent it.
          place(original);
          for (const other of headers) other.setAttribute("aria-sort", "none");
          header.setAttribute("aria-sort", "ascending");
          descending = true;
          return;
        }

        playable.sort((a, b) => {
          const left = cellValue(a.row.cells[index] as HTMLTableCellElement);
          const right = cellValue(b.row.cells[index] as HTMLTableCellElement);
          if (typeof left === "number" && typeof right === "number") {
            return descending ? right - left : left - right;
          }
          return descending
            ? String(right).localeCompare(String(left))
            : String(left).localeCompare(String(right));
        });

        place(playable);
        place(rest);

        for (const other of headers) other.setAttribute("aria-sort", "none");
        header.setAttribute("aria-sort", descending ? "descending" : "ascending");
        descending = !descending;
      });
    });

    table.dataset["scpSort"] = "js";
  }
}

/* ---------------------------------------------------------- expandable log */

/**
 * Fold the game log's per-week detail away behind its week number.
 *
 * The server sends those rows EXPANDED and this collapses them, which is the
 * way round it has to be: the stylesheet hides them only under
 * `[data-scp-expand="js"]`, so a page whose script never runs keeps every fact
 * visible instead of hiding content behind a button that does nothing. The
 * toggle is built here for the same reason — a control that cannot work should
 * not be in the HTML.
 */
function wireExpandableLog(root: HTMLElement): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>("table[data-scp-expandable]"),
  );

  for (const table of tables) {
    const rows = Array.from(
      table.querySelectorAll<HTMLTableRowElement>("tr[data-detail]"),
    );
    if (rows.length === 0) continue;

    for (const row of rows) {
      const id = row.getAttribute("data-detail");
      if (!id) continue;
      const detail = table.querySelector<HTMLTableRowElement>(`tr[id="${id}"]`);
      const head = row.querySelector("th");
      if (!detail || !head) continue;

      const week = (head.textContent ?? "").trim();

      const button = document.createElement("button");
      button.type = "button";
      button.className = "scp-expand";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", id);
      // The visible label is the week number; the accessible name says what
      // pressing it does, which "7" on its own does not.
      button.setAttribute("aria-label", `Week ${week} detail`);
      button.textContent = week;

      const icon = document.createElement("span");
      icon.className = "scp-expand-icon";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);

      head.textContent = "";
      head.appendChild(button);

      button.addEventListener("click", () => {
        const open = detail.classList.toggle("is-open");
        row.classList.toggle("is-open", open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    table.dataset["scpExpand"] = "js";
  }
}

/* ------------------------------------------------------------- hero fit */

/**
 * The hero's staged squeeze.
 *
 * Ported from the start/sit tool's player header, whose rule is the one this
 * follows: breakpoints decide topology, measurement decides everything inside.
 * The three media queries in player.css answer "one row, two columns, or
 * stacked".
 * Everything else — how big the bust is, how wide the numbers are, how long
 * the club's name is — is decided here, from the widths the parts actually
 * take, because a viewport width cannot know how long "Amon-Ra St. Brown" is
 * or that a one-game season prints "16.5" where a full one prints "235.4".
 *
 * Nothing is truncated, hidden or scrolled. Concessions are spent cheapest
 * first — whitespace, then type and column scale in proportion, then word
 * swaps, then, only at the very end, the name is allowed to wrap.
 *
 * Runs in the one-row tier only — above 800px. Below that the layout has
 * already made the room these scales exist to find, and a squeezed part inside
 * a stacked header is a small part for no reason; the scales are cleared and
 * the CSS fallbacks of 1 take over.
 */

/** The six multipliers player.css writes every hero size against. */
interface HeroScales {
  pad: number;
  gap: number;
  bust: number;
  id: number;
  tbl: number;
  tblp: number;
}

type HeroScaleKey = keyof HeroScales;

/** The three lengths the swappable runs of text come in. */
type HeroForm = "full" | "short" | "tight";

interface HeroNatural {
  /** The identity column at each of its three forms, at scale 1. */
  id: Record<HeroForm, number>;
  /** The numbers strip, at scale 1. Zero when the header has no strip. */
  strip: number;
  /** The strip's figures alone, with its cell padding taken to zero. */
  stripText: number;
  /** The strip's cell padding alone: what is left of it when the text is out. */
  stripPad: number;
  /** The headshot's box, at scale 1. Zero when there is no headshot. */
  photo: number;
  /** Gutters, gaps and the name's clearance, at scale 1. */
  chrome: number;
  /** Everything --scp-hero-pad is a multiplier of, at scale 1. */
  padBasis: number;
}

interface HeroFit {
  scales: HeroScales;
  form: HeroForm;
  /** Which stage the squeeze got to. 0 = nothing spent. Exposed for devtools. */
  stage: number;
  /** Every stage spent and still short: the surname may wrap. */
  wrap: boolean;
}

/**
 * The geometry that is NOT measured, because it is fixed by the stylesheet.
 *
 * Archetype A from the start/sit notes: where a part's natural width is a
 * constant, a constant is cheaper and steadier than a probe. These mirror the
 * px in player.css — .scp-hero's gutter, .scp-photo's box and inset,
 * .scp-hero-inner's gap, .scp-hero-text's clearance — and the cells inside
 * .scp-hero-stat that --scp-hero-tblp governs.
 */
const HERO_GUTTER = 28;
const HERO_INNER_GAP = 26;
const HERO_PHOTO_INSET = 35;
const HERO_PHOTO_W = 204;
const HERO_TEXT_CLEAR = 40;

/**
 * The row's fixed geometry, for the parts this header actually has.
 *
 * A player with no season has no numbers strip and a player with no thumbnail
 * has no figure, and in both cases the gap that separated them is not there to
 * be spent either. Counting a gap that does not exist would have the fitter
 * squeezing a row that already fits.
 */
function heroChrome(hasPhoto: boolean, hasStrip: boolean): {
  chrome: number;
  padBasis: number;
} {
  const gaps = (hasPhoto ? 1 : 0) + (hasStrip ? 1 : 0);
  const padBasis =
    HERO_GUTTER * 2 + (hasPhoto ? HERO_PHOTO_INSET : 0) + HERO_INNER_GAP * gaps;
  return { chrome: padBasis + (hasPhoto ? HERO_TEXT_CLEAR : 0), padBasis };
}

const HERO_SCALES_BASE: HeroScales = {
  pad: 1,
  gap: 1,
  bust: 1,
  id: 1,
  tbl: 1,
  tblp: 1,
};

/**
 * Growing back is reluctant; shrinking is eager.
 *
 * A form swap is the one discrete step in an otherwise continuous response, so
 * it is the one that can flap: a pixel of jitter either side of the threshold
 * would toggle "Patriots" and "New England Patriots" forever. Widening has to
 * clear the threshold by this much before the richer form comes back.
 */
const HERO_FORM_STICK = 10;

/** Below this, a change is rounding and re-rendering on it is a loop. */
const HERO_EPSILON = 0.005;

/**
 * Half a pixel: the width at which a deficit is settled and a saving is not
 * worth having.
 *
 * Two jobs, and they are the same job. Spending a stage leaves a deficit of
 * `deficit - budget * (deficit / budget)`, which is not zero in floating point
 * — and a residue of 7e-15 used to be enough to fall through into the next
 * stage, whose levers would then write their `from` values over the partial
 * spend that had just been computed. A bust squeezed to 94.8% came out at 85%.
 * And on the other side, a word swap that saves a fraction of a pixel is not a
 * concession, it is just a shorter word.
 */
const HERO_SETTLED = 0.5;

interface HeroLever {
  key: HeroScaleKey;
  from: number;
  to: number;
  /** The px this lever is a multiplier of — what a full spend saves. */
  basis: number;
}

interface HeroStage {
  /** Spent on entry, all at once: a word swap has no in-between. */
  form?: HeroForm;
  levers: HeroLever[];
}

/**
 * The stages, in the order they are spent.
 *
 * Each stage is a scalar in [0,1] — the fraction of that stage's budget the
 * deficit needed — so the response is continuous rather than a jump at a
 * threshold, and every lever inside a stage moves together.
 *
 *   1  whitespace, and the first proportional shrink of all three parts
 *   2  deeper on bust and type, and the strip's own cell padding, which goes
 *      faster than the type beside it: whitespace before legibility, inside
 *      the strip exactly as outside it
 *   3  words — "New England Patriots" becomes "Patriots", the draft line
 *      abbreviates — then the last of the name's clearance and the gutter
 *   4  the strip's last cut, and the last of its padding
 *   5  "Patriots" becomes "NE", the draft line goes, and bust and type take
 *      their last cut to 0.65 / 0.75 — the strip is already at its floor
 *
 * The strip floors at 0.88 and takes no part in stage 5. It used to run to
 * 0.60, which is where this came from: the label row is letter-spaced small
 * caps at 10px, so 0.60 printed "POS RANK" at six pixels and the figure under
 * it at fourteen — and a 620px window, which is a phone held sideways and not
 * an edge case, sat there. A strip nobody can read is not a cheaper concession
 * than a surname on two lines: it is the panel's whole content spent to buy
 * the least load-bearing part of the header one more line. So the type stops
 * at 0.88 — 8.8px on the label, 20.2px on the figure — and the CELL PADDING
 * carries stage 4 instead, down to 0.3: the same whitespace-before-legibility
 * rule stage 2 already follows, taken to its end. The narrow tiers are
 * unaffected either way; at 800px and below the scales are cleared and the
 * strip has a full-width row of its own at full size.
 *
 * The other floors are the start/sit tool's, unchanged. They were picked from
 * the narrowest supported screen against the widest content case, and below
 * them the header stops being readable — which is why stage 5 is the last one
 * and the name wraps after it rather than anything shrinking further.
 */
function heroStages(nat: HeroNatural): HeroStage[] {
  return [
    {
      levers: [
        { key: "pad", from: 1, to: 0.6, basis: nat.padBasis },
        { key: "gap", from: 1, to: 0.6, basis: HERO_TEXT_CLEAR },
        { key: "bust", from: 1, to: 0.85, basis: nat.photo },
        { key: "id", from: 1, to: 0.9, basis: nat.id.full },
        { key: "tbl", from: 1, to: 0.94, basis: nat.stripText },
      ],
    },
    {
      levers: [
        { key: "bust", from: 0.85, to: 0.75, basis: nat.photo },
        { key: "id", from: 0.9, to: 0.8, basis: nat.id.full },
        { key: "tblp", from: 1, to: 0.55, basis: nat.stripPad },
      ],
    },
    {
      form: "short",
      levers: [
        { key: "gap", from: 0.6, to: 0.3, basis: HERO_TEXT_CLEAR },
        { key: "pad", from: 0.6, to: 0.45, basis: nat.padBasis },
      ],
    },
    {
      levers: [
        { key: "tbl", from: 0.94, to: 0.88, basis: nat.stripText },
        { key: "tblp", from: 0.55, to: 0.3, basis: nat.stripPad },
      ],
    },
    {
      form: "tight",
      levers: [
        { key: "bust", from: 0.75, to: 0.65, basis: nat.photo },
        { key: "id", from: 0.8, to: 0.75, basis: nat.id.tight },
      ],
    },
  ];
}

/**
 * Walk the stages until the deficit is covered.
 *
 * The deficit is always computed against UNSQUEEZED geometry — the naturals
 * the probe reported at scale 1 — never against the row as it currently
 * stands. Measuring the thing you are about to change is the one reliable way
 * to build a fitter that oscillates.
 */
function heroFit(avail: number, nat: HeroNatural): HeroFit {
  const scales: HeroScales = { ...HERO_SCALES_BASE };
  let form: HeroForm = "full";

  let deficit = nat.chrome + nat.photo + nat.id.full + nat.strip - avail;
  if (deficit <= HERO_SETTLED) return { scales, form, stage: 0, wrap: false };

  const stages = heroStages(nat);
  let reached = 0;

  for (const stage of stages) {
    if (stage.form) {
      // The saving is the difference between the form we are leaving and the
      // one we are entering, both measured off-screen before either was shown.
      //
      // Usually zero, and then not spent. The column's natural width is its
      // widest LINE, and its widest line is almost always the surname — so
      // shortening "Arizona Cardinals" to "Cardinals" under a name that is
      // already wider than both buys no width at all. A concession that
      // concedes nothing is not a cheaper concession; it is a worse header for
      // free, and the club keeps its name.
      const saving = nat.id[form] - nat.id[stage.form];
      if (saving > HERO_SETTLED) {
        form = stage.form;
        deficit -= saving;
        reached += 1;
        if (deficit <= HERO_SETTLED) return { scales, form, stage: reached, wrap: false };
      }
    }

    const budget = stage.levers.reduce(
      (sum, lever) => sum + lever.basis * (lever.from - lever.to),
      0,
    );
    // Nothing to spend here — a strip-less header's table stages, say. Move on
    // WITHOUT writing this stage's levers: their `from` values are the
    // previous stage's `to`, and writing them over a partial spend is how a
    // squeeze jumps.
    if (budget <= 0) continue;

    const spent = Math.min(1, deficit / budget);
    for (const lever of stage.levers) {
      scales[lever.key] = lever.from + (lever.to - lever.from) * spent;
    }
    reached += 1;
    deficit -= budget * spent;
    if (deficit <= HERO_SETTLED) return { scales, form, stage: reached, wrap: false };
  }

  // Every stage spent and still short. The last concession, and only now: the
  // surname wraps. Not an ellipsis — a surname is the one string on this page
  // a reader came for, and "Beckh…" is worse than two lines.
  return { scales, form, stage: reached, wrap: true };
}

const HERO_KEYS: HeroScaleKey[] = ["pad", "gap", "bust", "id", "tbl", "tblp"];

/** Hysteresis: a fit that differs only by rounding is the same fit. */
function heroFitSame(a: HeroFit | null, b: HeroFit): boolean {
  if (!a) return false;
  if (a.form !== b.form || a.wrap !== b.wrap) return false;
  return HERO_KEYS.every(
    (key) => Math.abs(a.scales[key] - b.scales[key]) < HERO_EPSILON,
  );
}

const HERO_RICHER: Record<HeroForm, number> = { tight: 0, short: 1, full: 2 };

/**
 * A measuring copy of a finished element.
 *
 * Cloned rather than re-rendered. The start/sit tool renders its probes from
 * the same function as the visible cells, because in a React tree the two can
 * otherwise drift; cloning the real node is the strictest version of that same
 * rule, and it keeps three duplicate copies of the player's name, club and
 * draft out of a document whose whole job is to be indexed for that name.
 *
 * Two things are neutralised on the way out, because the copy lives in the
 * document and the document has rules: a second <h1> is demoted to a <div>
 * carrying the same class, so the measured type is identical and the outline
 * is not; and every link loses its href and its place in the tab order. The
 * wrapper is aria-hidden, so none of it is announced either.
 */
function heroProbeClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;

  for (const heading of Array.from(clone.querySelectorAll("h1, h2, h3"))) {
    const plain = document.createElement("div");
    plain.className = heading.className;
    plain.innerHTML = heading.innerHTML;
    heading.replaceWith(plain);
  }

  for (const link of Array.from(clone.querySelectorAll("a"))) {
    link.removeAttribute("href");
    link.setAttribute("tabindex", "-1");
  }

  for (const el of Array.from(clone.querySelectorAll("[id]"))) {
    el.removeAttribute("id");
  }
  clone.removeAttribute("id");

  return clone;
}

/**
 * Build the off-screen probe: the identity column at each of its three forms,
 * and the numbers strip, all at scale 1.
 *
 * Appended to the hero rather than the body so it inherits the same fonts,
 * colours and team variables the real column does — then resets the six scales
 * to 1, which is what makes it a NATURAL width rather than a reading of
 * whatever the fitter last wrote.
 */
function heroBuildProbe(
  hero: HTMLElement,
  text: HTMLElement,
  strip: HTMLElement | null,
): HTMLElement {
  const probe = document.createElement("div");
  probe.className = "scp-hero-probe";
  probe.setAttribute("aria-hidden", "true");
  probe.setAttribute("data-scp-hero-probe", "");

  for (const form of ["full", "short", "tight"] as HeroForm[]) {
    const item = document.createElement("div");
    item.className = "scp-hero-probe-item";
    item.setAttribute("data-scp-probe", form);
    // The form attribute on the item itself, so the swap rules resolve to this
    // copy's form and not to whatever the visible row is currently showing.
    const copy = heroProbeClone(text);
    copy.setAttribute("data-scp-form", form);
    item.appendChild(copy);
    probe.appendChild(item);
  }

  if (strip) {
    // Twice: once whole, and once with the cell padding taken to zero so the
    // figures can be measured on their own. The strip's width is text times
    // one scale plus padding times another, and the two run at different
    // rates — so the fitter needs the two terms, not their sum.
    for (const variant of ["strip", "strip-bare"]) {
      const item = document.createElement("div");
      item.className = "scp-hero-probe-item";
      item.setAttribute("data-scp-probe", variant);
      if (variant === "strip-bare") item.style.setProperty("--scp-hero-tblp", "0");
      item.appendChild(heroProbeClone(strip));
      probe.appendChild(item);
    }
  }

  hero.appendChild(probe);
  return probe;
}

function wireHeroFit(root: HTMLElement): void {
  const hero = root.querySelector<HTMLElement>("[data-scp-hero]");
  if (!hero) return;
  const inner = hero.querySelector<HTMLElement>(".scp-hero-inner");
  const text = inner?.querySelector<HTMLElement>(".scp-hero-text");
  if (!inner || !text) return;

  // The parts this header actually has. Which of them exist decides what the
  // row's fixed geometry is; the headshot's own box is then a constant rather
  // than a measurement — archetype A from the start/sit notes, where a part's
  // natural width is fixed by the stylesheet and a constant is cheaper and
  // steadier than a probe.
  const photo = inner.querySelector<HTMLElement>(".scp-photo");
  const stripEl = inner.querySelector<HTMLElement>(".scp-hero-stats");

  const probe = heroBuildProbe(hero, text, stripEl);

  const probeWidth = (selector: string): number => {
    const el = probe.querySelector<HTMLElement>(selector);
    return el ? el.getBoundingClientRect().width : 0;
  };

  const natural = (): HeroNatural | null => {
    const stripW = probeWidth('[data-scp-probe="strip"] .scp-hero-stats');
    const stripText = probeWidth('[data-scp-probe="strip-bare"] .scp-hero-stats');
    const nat: HeroNatural = {
      id: {
        full: probeWidth('[data-scp-probe="full"] .scp-hero-text'),
        short: probeWidth('[data-scp-probe="short"] .scp-hero-text'),
        tight: probeWidth('[data-scp-probe="tight"] .scp-hero-text'),
      },
      // Zero when the player has no season to report: the strip is absent
      // from the header entirely, and its stages then have no budget to
      // spend, which is exactly right.
      strip: stripW,
      stripText,
      // What the padding is worth, by difference. Measuring the two terms
      // apart is the whole reason the second strip copy exists: the strip's
      // width is its figures TIMES --scp-hero-tbl plus its padding TIMES
      // --scp-hero-tblp, and the two scales run at different rates. Modelling
      // the whole strip at the type's rate over-credited every saving by
      // about two to one, and the row the fitter promised would fit came out
      // wider than the room — which a reader saw as the measurements line
      // wrapping while the fitter still reported budget in hand.
      stripPad: Math.max(0, stripW - stripText),
      photo: photo ? HERO_PHOTO_W : 0,
      ...heroChrome(Boolean(photo), Boolean(stripEl)),
    };
    // A probe that reports nothing has not been laid out yet. Writing scales
    // from it would pin the header at a size measured from an empty box.
    return nat.id.full > 0 ? nat : null;
  };

  const apply = (fit: HeroFit): void => {
    for (const key of HERO_KEYS) {
      hero.style.setProperty(`--scp-hero-${key}`, fit.scales[key].toFixed(3));
    }
    inner.setAttribute("data-scp-form", fit.form);
    hero.setAttribute("data-scp-hero-stage", String(fit.stage));
    hero.setAttribute("data-scp-hero-wrap", fit.wrap ? "1" : "0");
  };

  const reset = (): void => {
    for (const key of HERO_KEYS) hero.style.removeProperty(`--scp-hero-${key}`);
    inner.setAttribute("data-scp-form", "full");
    hero.setAttribute("data-scp-hero-stage", "0");
    hero.setAttribute("data-scp-hero-wrap", "0");
  };

  // The one-row tier, and the only tier this runs in. Matches the 800px
  // boundary in player.css from the other side: at 800 and below the figure
  // takes a column of its own and the strip stacks under the name, and below
  // 560 the whole header stacks. Both tiers have already made the room these
  // scales exist to find.
  const oneRow =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 800.02px)")
      : null;

  let current: HeroFit | null = null;
  /** Whether the narrow tiers' cleared state is already on the element. */
  let cleared = false;
  let raf = 0;

  const measure = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;

      // Below the one-row tier the topology has already made the room these
      // scales exist to find, so they are cleared and player.css's fallbacks
      // of 1 take over. Written once on the way in rather than every frame of
      // a drag-resize, but written even if nothing was ever fitted, so the
      // devtools attributes say "nothing spent" rather than saying nothing.
      if (oneRow && !oneRow.matches) {
        if (current || !cleared) {
          current = null;
          cleared = true;
          reset();
        }
        return;
      }

      cleared = false;

      // Zero is how an element in a hidden tab or an unlaid-out document
      // reports itself, and a scale written from it poisons the next read.
      const avail = hero.clientWidth;
      if (!avail) return;

      const nat = natural();
      if (!nat) return;

      let next = heroFit(avail, nat);
      // Eager to shrink, reluctant to grow back: re-fit against a slightly
      // narrower row before letting a richer form return, so a pixel of
      // jitter at a threshold cannot flip the club's name back and forth.
      if (current && HERO_RICHER[next.form] > HERO_RICHER[current.form]) {
        next = heroFit(avail - HERO_FORM_STICK, nat);
      }

      if (heroFitSame(current, next)) return;
      current = next;
      apply(next);
    });
  };

  // Before the first measurement, not after: the stylesheet keys the name's
  // size off this attribute — a measured 52px where the fitter is live, the
  // viewport's clamp where it is not — so setting it late would measure one
  // size and paint another.
  hero.dataset["scpHeroFit"] = "js";

  measure();

  if (typeof ResizeObserver === "undefined") {
    // No observer: the header is fitted once, at the width it loaded at, and
    // the CSS tiers still handle a rotation. Better than throwing.
    window.addEventListener("resize", measure);
    return;
  }

  const observer = new ResizeObserver(measure);
  observer.observe(hero);
  // The probe too: a web font landing after first paint widens the text
  // without resizing the header, and silently moves every threshold here.
  observer.observe(probe);
  if (document.fonts) document.fonts.ready.then(measure).catch(() => {});
}

/* ------------------------------------------------------------ peers rail */

/**
 * Centre the "You are here" card in the positional peers rail.
 *
 * The rail is complete and readable without this — it simply starts at its
 * best-ranked end, which is a reasonable place to begin reading — but the card
 * the reader is standing on is the anchor the other six are arranged around,
 * and on a phone it starts three cards off the left edge.
 *
 * Measured with rects rather than offsetLeft, which is relative to whatever
 * the nearest positioned ancestor happens to be and would silently change
 * meaning the day something above the rail gains `position: relative`. And
 * only the RAIL scrolls: the page must not jump to the bottom on load.
 */
function wirePeerRail(root: HTMLElement): void {
  for (const rail of Array.from(root.querySelectorAll<HTMLElement>("[data-scp-peers]"))) {
    const current = rail.querySelector<HTMLElement>(".scp-peer.is-current");
    if (!current) continue;
    // A rail that fits has nothing to centre, and every card is already in
    // view — which is the desktop case.
    if (rail.scrollWidth <= rail.clientWidth) continue;

    const railBox = rail.getBoundingClientRect();
    const cardBox = current.getBoundingClientRect();
    rail.scrollLeft +=
      cardBox.left - railBox.left - (rail.clientWidth - cardBox.width) / 2;
  }
}

/* ------------------------------------------------------------------ boot */

function boot(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
    wireTabs(root, {
      navSelector: "[data-scp-nav]",
      listSelector: ".scp-nav-list",
      linkSelector: ".scp-nav-link",
      datasetKey: "scpTabs",
      panelKey: "scpPanelId",
      headingKey: "scpHeading",
      leadKey: "scpLead",
    });
    wireTimestamps(root);
    wirePlayerSearch(root);
    wireChartTooltip(root);
    wireHeroFit(root);
    wireSortableLog(root);
    wireExpandableLog(root);
    wirePeerRail(root);
    wireFrameHeight(root);
  }

  for (const root of Array.from(document.querySelectorAll<HTMLElement>(INDEX_SELECTOR))) {
    // The same search widget the profile carries, so the box behaves the same
    // on both pages, plus the chips that are the index's own.
    wirePlayerSearch(root);
    wirePlayerDirectory(root);
    wireFrameHeight(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
