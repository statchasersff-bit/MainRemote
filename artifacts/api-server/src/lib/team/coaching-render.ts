/**
 * Markup for the team hub's Coaching Profile & Tendencies section.
 *
 * Server-rendered in full like the usage tab beside it: everything is in the
 * HTML the server sends, and nothing here needs the client bundle. The ten
 * components render in the build spec's order — header + intro, the coach
 * card beside the tendencies table, three shift cards, the staff strip, the
 * career dossier, the positional finishes, the rookie note, the two
 * fingerprint panels, the two situational panels, and the gold bottom line.
 *
 * The section is mostly the evergreen layer read from
 * data/team/coaching_<season>.json. The weekly surface our own feed carries —
 * the four env-backed tendency rows and the current backfield bar — is read
 * live from the usage view handed in, so those cells move with the daily
 * chain while everything editorial stays put (see coaching.ts).
 */

import { escapeHtml } from "../render";
import type { NflTeam } from "./teams";
import {
  RELIABILITY_PCT,
  reliabilityRating,
  type BarRow,
  type Reliability,
  type TeamCoaching,
  type TendencyRow,
} from "./coaching";
import type { UsageView } from "./usage";
import { signed } from "./usage-copy";
import { inkOn } from "./usage-render";

const e = escapeHtml;

function h3(text: string): string {
  return `<h3 class="sct-co-h3">${e(text)}</h3>`;
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix =
    rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/* ------------------------------------------------------------ header/intro */

function header(): string {
  return `<div class="sct-co-head"><h2 class="sct-h2">Coaching Profile &amp; Tendencies</h2></div>`;
}

/** The continuity principle in plain prose near the top — the citable claim. */
function intro(c: TeamCoaching, team: NflTeam): string {
  return (
    `<p class="sct-co-intro">` +
    e(
      "Play-calling tendencies carry over from season to season when the play-caller stays the same — and become unreliable the moment he changes. " +
        `That's the whole reason this module exists: before you trust any ${team.nickname} projection, you need to know whose fingerprints are on the offense and how stable they are. ` +
        c.introAnswer,
    ) +
    `</p>`
  );
}

/* -------------------------------------------------------------- coach card */

function reliabilityBox(c: TeamCoaching): string {
  const rating = reliabilityRating(c);
  const pct = RELIABILITY_PCT[rating];
  const tone: Record<Reliability, string> = { HIGH: "high", MEDIUM: "medium", LOW: "low" };
  return (
    `<div class="sct-co-rel">` +
    `<p class="sct-co-rel-row"><span class="sct-co-label">Tendency reliability</span>` +
    `<span class="sct-co-rating is-${tone[rating]}">${rating}</span></p>` +
    `<span class="sct-co-relbar" role="img" aria-label="${e(`Tendency reliability: ${rating}`)}">` +
    `<span style="width:${pct}%"></span></span>` +
    `<p class="sct-co-rel-note">${e(c.reliability.explanation)}</p>` +
    `<p class="sct-co-ledger"><span class="sct-co-label">Play-caller ledger</span>` +
    `<span class="sct-co-ledger-val">${e(c.reliability.ledger)}</span></p>` +
    `</div>`
  );
}

function coachCard(c: TeamCoaching, team: NflTeam): string {
  const ink = inkOn(team.primaryColor);
  const path = c.playCaller.careerPath
    .map(
      (step) =>
        `<li class="sct-co-step"><span class="sct-co-step-role">${e(step.role)}</span>` +
        `<span class="sct-co-step-years">${e(step.years)}</span></li>`,
    )
    .join("");
  return (
    `<div class="sct-co-card" style="--co-ink:${ink}">` +
    `<p class="sct-co-kicker">${e(c.playCaller.kicker)}</p>` +
    `<h3 class="sct-co-name">${e(c.playCaller.name)}</h3>` +
    `<p class="sct-co-tree">${e(c.playCaller.tree ?? "No established tree")}</p>` +
    `<p class="sct-co-card-sub">${e(c.playCaller.subline)}</p>` +
    `<ul class="sct-co-path">${path}</ul>` +
    reliabilityBox(c) +
    `</div>`
  );
}

/* -------------------------------------------------------------- tendencies */

/**
 * A feed-backed row's current cell and change, from the usage env block.
 *
 * Null when the feed has nothing, in which case the stored (spec) values
 * stand. The pace row inverts: fewer seconds is "up", and its change reads
 * faster/slower rather than a signed number.
 */
function liveCell(
  row: TendencyRow,
  view: UsageView | null,
): { current: string; change: { dir: "up" | "down" | "flat"; text: string } } | null {
  if (!row.feed || !view || row.priorNum == null) return null;
  const env = view.team.env[row.feed];
  const value = env?.value;
  if (value == null) return null;
  const delta = value - row.priorNum;
  if (row.invert) {
    const dir = Math.abs(delta) < 0.3 ? "flat" : delta < 0 ? "up" : "down";
    const text = dir === "flat" ? "steady" : dir === "up" ? "faster" : "slower";
    return { current: `${value.toFixed(1)}s`, change: { dir, text } };
  }
  const dir = Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
  const rank = env?.rank;
  const tail = dir !== "flat" && rank != null && rank <= 8 ? ` — ${ordinal(rank)} in NFL` : "";
  const rounded = Math.round(value * 10) / 10;
  const places = Number.isInteger(Math.round(delta * 10) / 10) ? 0 : 1;
  return {
    current: row.feed === "proe" ? `${signed(rounded)}%` : `${rounded}%`,
    change: { dir, text: dir === "flat" ? "steady" : `${signed(delta, places)}${tail}` },
  };
}

const ARROWS = { up: "▲", down: "▼", flat: "—" } as const;

function tendenciesTable(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const rows = c.tendencies.rows
    .map((row) => {
      const live = liveCell(row, view);
      const current = live?.current ?? row.current;
      const change = live?.change ?? row.change;
      return (
        `<tr>` +
        `<th scope="row" class="sct-co-td is-tendency">${e(row.label)}` +
        (row.sub ? `<span class="sct-co-cell-sub">${e(row.sub)}</span>` : "") +
        `</th>` +
        `<td class="sct-co-td">${e(row.prior)}</td>` +
        `<td class="sct-co-td is-now">${e(current)}</td>` +
        `<td class="sct-co-td"><span class="sct-co-change is-${change.dir}">` +
        `<span aria-hidden="true">${ARROWS[change.dir]}</span> ${e(change.text)}</span></td>` +
        `<td class="sct-co-td is-avg">${e(row.nflAvg)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} play-calling tendencies`)}">` +
    `<table class="sct-co-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Tendency</th>` +
    `<th scope="col" class="sct-co-th">${e(c.tendencies.priorLabel)}</th>` +
    `<th scope="col" class="sct-co-th">${e(c.tendencies.currentLabel)}</th>` +
    `<th scope="col" class="sct-co-th">Change</th>` +
    `<th scope="col" class="sct-co-th">NFL avg.</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  );
}

/* ------------------------------------------------------------- shift cards */

function shifts(c: TeamCoaching): string {
  return (
    `<ul class="sct-co-shifts">` +
    c.shifts
      .map(
        (s) =>
          `<li class="sct-co-shift">` +
          `<p class="sct-co-shift-stat">${e(s.stat)}<span class="sct-co-shift-unit">${e(s.unit)}</span></p>` +
          `<h4 class="sct-co-h4">${e(s.heading)}</h4>` +
          `<p class="sct-co-body">${e(s.body)}</p>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

/* ------------------------------------------------------------- staff strip */

function staff(c: TeamCoaching): string {
  const { oc, dc, continuity } = c.staff;
  return (
    `<div class="sct-co-staff">` +
    `<article class="sct-co-staffcard${oc.hasCalledPlays ? " is-watch" : ""}">` +
    `<p class="sct-co-role">Offensive coordinator${oc.hasCalledPlays ? " · Delegation watch" : ""}</p>` +
    `<h4 class="sct-co-h4">${e(oc.name)}</h4>` +
    `<p class="sct-co-staff-sub">${e(oc.sub)}</p>` +
    `<p class="sct-co-body">${e(oc.body)}</p>` +
    `</article>` +
    `<article class="sct-co-staffcard">` +
    `<p class="sct-co-role">Defensive coordinator</p>` +
    `<h4 class="sct-co-h4">${e(dc.name)}</h4>` +
    `<p class="sct-co-staff-sub">${e(dc.sub)}</p>` +
    `<p class="sct-co-body">${e(dc.body)}</p>` +
    `</article>` +
    `<article class="sct-co-staffcard">` +
    `<p class="sct-co-role">Staff continuity</p>` +
    `<h4 class="sct-co-h4">${e(continuity.stat)}</h4>` +
    `<p class="sct-co-staff-sub">${e(continuity.sub)}</p>` +
    `<p class="sct-co-body">${e(continuity.body)}</p>` +
    `</article>` +
    `</div>`
  );
}

/* ----------------------------------------------------------------- dossier */

function dossier(c: TeamCoaching, team: NflTeam): string {
  const rows = c.dossier
    .map(
      (row) =>
        `<tr class="${row.current ? "is-current" : ""}">` +
        `<th scope="row" class="sct-co-td is-stop">${e(row.stop)}` +
        `<span class="sct-co-cell-sub">${e(row.years)}</span></th>` +
        `<td class="sct-co-td is-offense"><span class="sct-co-num">${e(row.scoring)}</span>` +
        `<span class="sct-co-cell-sub">${e(row.scoringContext)}</span></td>` +
        `<td class="sct-co-td is-print"><strong>${e(row.thesis)}</strong> ${e(row.fingerprint)}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<div class="sct-co-block">` +
    h3("Career dossier") +
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} play-caller career history`)}">` +
    `<table class="sct-co-dossier">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">Stop</th>` +
    `<th scope="col" class="sct-co-th">Offense</th>` +
    `<th scope="col" class="sct-co-th">The fingerprint he left</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}

/* ---------------------------------------------------------------- finishes */

function finishes(c: TeamCoaching, team: NflTeam): string {
  const rows = c.finishes.rows
    .map(
      (row) =>
        `<tr class="${row.current ? "is-current" : ""}">` +
        `<th scope="row" class="sct-co-td is-stop">${e(row.stop)}` +
        `<span class="sct-co-cell-sub">${e(row.context)}</span></th>` +
        row.cells
          .map(
            (cell) =>
              `<td class="sct-co-td"><span class="sct-co-finish is-${cell.tone}">${e(cell.text)}</span></td>`,
          )
          .join("") +
        `</tr>`,
    )
    .join("");
  return (
    `<div class="sct-co-block">` +
    `<div class="sct-co-scroll" tabindex="0" role="region" aria-label="${e(`Positional fantasy finishes under the ${team.nickname} play-caller`)}">` +
    `<table class="sct-co-finishes">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-co-th">${e(c.finishes.heading)}</th>` +
    `<th scope="col" class="sct-co-th">QB</th>` +
    `<th scope="col" class="sct-co-th">RB1</th>` +
    `<th scope="col" class="sct-co-th">WR1</th>` +
    `<th scope="col" class="sct-co-th">TE1</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="sct-co-fnote">${e(c.finishes.note)}</p>` +
    `</div>`
  );
}

/* -------------------------------------------------------------- note + bars */

function rookieNote(c: TeamCoaching): string {
  return (
    `<div class="sct-co-rookie">` +
    `<p class="sct-co-role is-blue">${e(c.rookieNote.label)}</p>` +
    `<p class="sct-co-body">${e(c.rookieNote.body)}</p>` +
    `</div>`
  );
}

/**
 * One labelled bar: fill = the share, an optional thin marker = the league
 * average. The number always rides beside the bar — never colour-only.
 */
function barRow(row: BarRow, label: string, value: string): string {
  const width = row.pct ?? row.share ?? 0;
  return (
    `<div class="sct-co-brow">` +
    `<span class="sct-co-blabel">${e(row.label)}</span>` +
    `<span class="sct-co-btrack" role="img" aria-label="${e(label)}">` +
    `<span class="sct-co-bfill${row.gold ? " is-gold" : ""}" style="width:${width}%"></span>` +
    (row.nfl != null ? `<span class="sct-co-bmark" style="left:${row.nfl}%"></span>` : "") +
    `</span>` +
    `<span class="sct-co-bval">${e(value)}</span>` +
    `</div>`
  );
}

function distribution(c: TeamCoaching): string {
  const name = c.playCaller.name.split(" ").pop() ?? c.playCaller.name;
  return (
    `<div class="sct-co-panel">` +
    h3("How he distributes the ball") +
    `<p class="sct-co-panel-sub">${e(c.distribution.sub)}</p>` +
    `<p class="sct-co-key">${e(`Filled bar = ${name} offenses · thin marker = league average`)}</p>` +
    c.distribution.rows
      .map((row) =>
        barRow(
          row,
          `${row.label}: ${row.pct}% of targets, league average ${row.nfl}%`,
          `${row.pct}% · NFL ${row.nfl}%`,
        ),
      )
      .join("") +
    `<p class="sct-co-note">${e(c.distribution.note)}</p>` +
    `</div>`
  );
}

function backfield(c: TeamCoaching, view: UsageView | null): string {
  const bars = c.backfield.bars.map((bar) => {
    if (!bar.feed || !view) return bar;
    // The current season's bar is the lead back's live share of the room's
    // weighted opportunities, from the same numbers the usage tab draws.
    const lead = Math.max(0, ...view.rbs.map((p) => p.woppShare ?? 0));
    return lead > 0 ? { ...bar, value: Math.round(lead) } : bar;
  });
  const caption = bars.map((b) => `${b.label} ${b.value}%`).join(", ");
  return (
    `<div class="sct-co-panel">` +
    h3("How he manages a backfield") +
    `<p class="sct-co-panel-sub">${e(c.backfield.sub)}</p>` +
    `<div class="sct-co-cols" role="img" aria-label="${e(`Lead back share by season: ${caption}`)}">` +
    bars
      .map(
        (bar) =>
          `<div class="sct-co-col${bar.current ? " is-current" : ""}">` +
          `<span class="sct-co-colval">${e(`${bar.value}%`)}</span>` +
          // 0.72: the track also holds the value and season labels, so a 100%
          // bar must leave them ~34px. Linear, so the bars stay proportional.
          `<span class="sct-co-colbar" style="height:${Math.round(bar.value * 0.72)}%"></span>` +
          `<span class="sct-co-collabel">${e(bar.label)}</span>` +
          `</div>`,
      )
      .join("") +
    `</div>` +
    `<p class="sct-co-note">${e(c.backfield.note)}</p>` +
    `</div>`
  );
}

function personnel(c: TeamCoaching): string {
  return (
    `<div class="sct-co-panel">` +
    h3("Personnel groupings — usage & result") +
    `<p class="sct-co-panel-sub">${e(c.personnel.sub)}</p>` +
    c.personnel.rows
      .map((row) =>
        barRow(
          row,
          `${row.label}: ${row.share}% of snaps, ${row.result}`,
          `${row.share}% · ${row.result}`,
        ),
      )
      .join("") +
    `<p class="sct-co-note">${e(c.personnel.note)}</p>` +
    `</div>`
  );
}

function scoreState(c: TeamCoaching): string {
  return (
    `<div class="sct-co-panel">` +
    h3("Play-calling by score state") +
    `<p class="sct-co-panel-sub">${e(c.scoreState.sub)}</p>` +
    c.scoreState.rows
      .map((row) => barRow(row, `${row.label}: ${row.result}`, row.result ?? `${row.share}%`))
      .join("") +
    `<p class="sct-co-note">${e(c.scoreState.note)}</p>` +
    `</div>`
  );
}

function bottomLine(c: TeamCoaching): string {
  return `<p class="sct-co-bottom">${e(c.bottomLine)}</p>`;
}

/* ------------------------------------------------------------------ caveat */

/**
 * The LOW-reliability caveat the rest of the page carries.
 *
 * Rendered beside anything that projects from last season's data when the
 * team's play-caller is new. Empty for HIGH and MEDIUM — the caveat is the
 * exception, not a banner on all 32 pages.
 */
export function coachingCaveat(c: TeamCoaching | null): string {
  if (!c || reliabilityRating(c) !== "LOW") return "";
  const name = c.playCaller.name;
  return (
    `<p class="sct-co-caveat">${e(
      `New play-caller: ${name} is calling plays for the first season here, so last year's tendencies are an unreliable guide — see the Coaching tab before trusting season-over-season projections.`,
    )}</p>`
  );
}

/* ------------------------------------------------------------------ public */

export interface CoachingSection {
  html: string;
  faqHtml: string;
  faq: Array<{ question: string; answer: string }>;
}

export function renderCoachingSection(
  coaching: TeamCoaching | null,
  team: NflTeam,
  view: UsageView | null,
): CoachingSection {
  if (!coaching) return { html: "", faqHtml: "", faq: [] };
  const html =
    `<div class="sct-block sct-co">` +
    header() +
    intro(coaching, team) +
    `<div class="sct-co-grid">` +
    coachCard(coaching, team) +
    tendenciesTable(coaching, team, view) +
    `</div>` +
    shifts(coaching) +
    staff(coaching) +
    dossier(coaching, team) +
    finishes(coaching, team) +
    rookieNote(coaching) +
    `<div class="sct-co-panels">` +
    distribution(coaching) +
    backfield(coaching, view) +
    `</div>` +
    `<div class="sct-co-panels">` +
    personnel(coaching) +
    scoreState(coaching) +
    `</div>` +
    bottomLine(coaching) +
    `</div>`;

  // Same contract as the usage FAQ: the link sits outside .sct-faq-a so the
  // schema's answer and the visible answer are the same text.
  const faq = coaching.faq;
  const faqHtml =
    `<div class="sct-block">` +
    `<h2 class="sct-h2">Common questions</h2>` +
    `<div class="sct-faq"><details class="sct-faq-item">` +
    `<summary class="sct-faq-q-row"><h3 class="sct-faq-q">${e(faq.question)}</h3></summary>` +
    `<p class="sct-faq-a">${e(faq.answer)}</p>` +
    `<p class="sct-faq-more"><a class="sct-textlink" href="#coaching">See the full coaching profile</a></p>` +
    `</details></div></div>`;
  return { html, faqHtml, faq: [faq] };
}
