/**
 * A view switcher for the Replit preview, so every way this app's markup can be
 * mounted is reachable from every other one.
 *
 * The problem it solves: the preview opens at "/", which is the news tool, and
 * the news tool deliberately links nowhere. It is the fragment printed into a
 * statchasers.com page, so anything navigational added to its markup would
 * appear on the live site — which is exactly why this bar is NOT part of any
 * renderer. It is injected into the finished HTML on the way out, in
 * development only, the same way lib/livereload.ts injects its snippet.
 *
 * Consequences of that placement, all deliberate:
 *   - `renderFragment` and `renderTeamPage` are untouched, so /embed/ssr and
 *     /embed/team/:slug can never carry it — which is also why the FRAGMENT
 *     links below open in a new tab: the bar cannot ride along to a view whose
 *     whole point is that it is bare;
 *   - it cannot exist in a production response, because the guard is the same
 *     NODE_ENV check that arms live reload;
 *   - it is pinned to the TOP of the viewport, so it is the first thing on
 *     screen. It was a bar along the BOTTOM and that was a mistake: it read as
 *     a page footer, and a switcher nobody finds is not a switcher. The height
 *     it takes is measured and pushed onto the body by the script rather than
 *     hard-coded, and the iframe height measurement in both client bundles
 *     already accounts for content above the tool (see wireFrameHeight — it
 *     measures the root's bottom in document coordinates for that reason).
 *     It has no hide control: a switcher that can be dismissed by one stray
 *     click, persistently, is a switcher that gets reported as missing.
 *
 * Everything is inline: no extra stylesheet, no bundle, no request. It is a
 * development affordance and should cost the app nothing.
 */

import { TEAM_GROUPS, type NflTeam } from "./team/teams";
import { indexedPlayers, type IndexedPlayer } from "./player/player-data";

/** True only in development. The single guard for everything in this file. */
export function devBarEnabled(): boolean {
  return process.env["NODE_ENV"] === "development";
}

export interface DevBarContext {
  /** Request path, query already stripped. */
  path: string;
  /** Whether this response is the embedded variant. */
  embed: boolean;
}

/**
 * How a given piece of markup is being mounted.
 *
 *   page      — the standalone tool, with this app's own shell around it
 *   embed     — the same markup stripped for a host page (`?embed=1`)
 *   shortcode — the fragment assembled the way WordPress assembles it: the
 *               plugin's stylesheet and bundle, inside a host page. This is
 *               what the shortcode LOOKS like, and it is the one to switch
 *               between when comparing the two tools as published
 *   fragment  — the bare bytes the plugin fetches, unstyled
 *
 * The mount travels with the tool switch, so picking "Shortcode" and then
 * flipping News/Team Hub alternates between the two shortcode pages — which is
 * the thing this bar is really for.
 */
type Mount = "page" | "embed" | "shortcode" | "fragment";

interface Tool {
  key: "news" | "team" | "player";
  label: string;
  /** Shown instead of `label` when the pane is too narrow for the full name. */
  shortLabel: string;
  /** The WordPress shortcode this tool is mounted by, for orientation. */
  shortcode: string;
  /** Does `?embed=1` actually change this tool's output? */
  hasEmbedMode: boolean;
  active(path: string): boolean;
}

const TOOLS: Tool[] = [
  {
    key: "news",
    label: "Recent Player News",
    shortLabel: "News",
    shortcode: "statchasers_news",
    // The news page has no embedded variant: `/` renders one way and the
    // stripped markup is only ever reached through /embed/ssr. Saying so here
    // is what stops the bar offering an Embed button that does nothing —
    // which is what it used to do.
    hasEmbedMode: false,
    active: (path) =>
      path === "/" ||
      path === "/index.html" ||
      path === "/preview/news" ||
      path === "/preview/raw/news",
  },
  {
    key: "team",
    label: "NFL Team Hub",
    shortLabel: "Team Hub",
    // Named for the shortcode agreed for it. The WordPress side is not written
    // yet, so the `team` attribute below is this app's canonical team id
    // standing in for whatever the plugin ends up accepting.
    shortcode: "statchasers_team",
    hasEmbedMode: true,
    active: (path) =>
      path.startsWith("/team") ||
      path.startsWith("/preview/team") ||
      path.startsWith("/preview/raw/team"),
  },
  {
    key: "player",
    label: "NFL Player Pages",
    shortLabel: "Players",
    shortcode: "statchasers_player",
    hasEmbedMode: true,
    // Ordered after the two /team tests above only for readability; the paths
    // are disjoint, so `toolFor` finding this one first would be equivalent.
    active: (path) =>
      path.startsWith("/player") ||
      path.startsWith("/preview/player") ||
      path.startsWith("/preview/raw/player"),
  },
];

/** The team the Team Hub button lands on when you are not already on one. */
const DEFAULT_TEAM_SLUG = "new-england-patriots";

const TEAM_PATH = /^\/(?:preview\/(?:raw\/)?)?team\/([a-z0-9-]+)\/?$/i;
const PLAYER_PATH = /^\/(?:preview\/(?:raw\/)?)?player\/([a-z0-9-]+)\/?$/i;

/**
 * The player the Players button lands on when you are not already on one.
 *
 * Read from the indexed list rather than hard-coded. A pinned slug is a name
 * that retires, gets traded out of the index, or is simply spelled differently
 * next season — and the failure mode is a switcher button that 404s, which is
 * exactly the thing this bar exists to prevent.
 */
function defaultPlayerSlug(): string {
  return indexedPlayers()[0]?.slug ?? "";
}

/**
 * The team currently on screen, read back out of the path.
 *
 * Derived rather than passed in so the route handlers keep their two-field
 * context — the bar is a development detail and should not be a parameter every
 * caller has to remember to thread through correctly.
 */
function currentTeam(path: string): NflTeam | null {
  const match = TEAM_PATH.exec(path);
  if (!match) return null;
  const slug = (match[1] ?? "").toLowerCase();
  for (const conference of TEAM_GROUPS) {
    for (const division of conference.divisions) {
      for (const team of division.teams) {
        if (team.slug === slug) return team;
      }
    }
  }
  return null;
}

/** The player currently on screen, read back out of the path. */
function currentPlayer(path: string): IndexedPlayer | null {
  const match = PLAYER_PATH.exec(path);
  if (!match) return null;
  const slug = (match[1] ?? "").toLowerCase();
  return indexedPlayers().find((row) => row.slug === slug) ?? null;
}

function toolFor(path: string): Tool {
  return TOOLS.find((tool) => tool.active(path)) ?? TOOLS[0]!;
}

function currentMount(context: DevBarContext): Mount {
  // Order matters: /preview/raw/* is a source view, not a shortcode page, and
  // the broader /preview/ test would swallow it.
  if (context.path.startsWith("/preview/raw/")) return "fragment";
  if (context.path.startsWith("/preview/")) return "shortcode";
  if (context.path.startsWith("/embed/")) return "fragment";
  return context.embed ? "embed" : "page";
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/* ------------------------------------------------------------------ links */

/**
 * Whatever the current view is *about* — a team, a player, or neither.
 *
 * Carried as one object rather than as two parameters threaded through every
 * function below, because a third tool made the two-parameter version a
 * four-argument call at every site and the next tool would make it five.
 */
interface Subject {
  team: NflTeam | null;
  player: IndexedPlayer | null;
}

/** Where a given tool + mount + subject lives. */
function href(tool: Tool, mount: Mount, subject: Subject): string {
  if (tool.key === "team") {
    const slug = subject.team?.slug ?? DEFAULT_TEAM_SLUG;
    // The source VIEW, not the fragment endpoint itself: the endpoint is bare
    // by design and carries no bar, so linking straight at it strands you.
    if (mount === "fragment") return `/preview/raw/team/${slug}`;
    if (mount === "shortcode") return `/preview/team/${slug}`;
    return mount === "embed" ? `/team/${slug}?embed=1` : `/team/${slug}`;
  }

  if (tool.key === "player") {
    const slug = subject.player?.slug ?? defaultPlayerSlug();
    // No indexed players at all — a deployment with no data files. Send the
    // button at the index, which says so honestly, rather than at /player/.
    if (!slug) return "/player";
    if (mount === "fragment") return `/preview/raw/player/${slug}`;
    if (mount === "shortcode") return `/preview/player/${slug}`;
    return mount === "embed" ? `/player/${slug}?embed=1` : `/player/${slug}`;
  }

  if (mount === "fragment") return "/preview/raw/news";
  return mount === "shortcode" ? "/preview/news" : "/";
}

/**
 * The shortcode that produces what is on screen.
 *
 * Printed rather than linked because it is the one thing the preview cannot
 * show you: which line in a WordPress page this view corresponds to.
 */
function shortcodeText(tool: Tool, subject: Subject): string {
  if (tool.key === "team") {
    return `[${tool.shortcode} team="${subject.team?.abbreviation ?? "ne"}"]`;
  }
  if (tool.key === "player") {
    // Spelled with the slug, which is what the plugin actually accepts. On a
    // real page the attribute is usually absent — it defaults to the post slug
    // — but the preview has no post to default from.
    const slug = subject.player?.slug ?? defaultPlayerSlug();
    return slug ? `[${tool.shortcode} slug="${slug}"]` : `[${tool.shortcode}]`;
  }
  return `[${tool.shortcode}]`;
}

/* ------------------------------------------------------------------ parts */

function toolButtons(context: DevBarContext, subject: Subject): string {
  const mount = currentMount(context);
  const active = toolFor(context.path);
  return TOOLS.map((tool) => {
    const current = tool.key === active.key;
    // The mount travels with the switch, so flipping between the two tools does
    // not silently drop you back out of embedded mode. A tool with no embed
    // variant falls back to its page.
    const keep: Mount = mount === "embed" && !tool.hasEmbedMode ? "page" : mount;
    return (
      `<a href="${escapeAttr(href(tool, keep, subject))}"` +
      `${current ? ' aria-current="page"' : ""}>` +
      `<span class="scdev-full">${tool.label}</span>` +
      `<span class="scdev-short">${tool.shortLabel}</span>` +
      `<span class="scdev-code">[${tool.shortcode}]</span>` +
      `</a>`
    );
  }).join("");
}

function teamPicker(context: DevBarContext, subject: Subject): string {
  if (toolFor(context.path).key !== "team") return "";
  const team = subject.team;
  const mount = currentMount(context);
  const options = TEAM_GROUPS.map((conference) =>
    conference.divisions
      .map((division) => {
        const items = division.teams
          .map((entry) => {
            const selected = entry.slug === team?.slug;
            return (
              `<option value="${escapeAttr(href(TOOLS[1]!, mount, { team: entry, player: null }))}"` +
              `${selected ? " selected" : ""}>${escapeAttr(entry.fullName)}</option>`
            );
          })
          .join("");
        return (
          `<optgroup label="${escapeAttr(division.division)}">` +
          `${items}</optgroup>`
        );
      })
      .join(""),
  ).join("");

  // The option VALUE is the destination, so the one line of script below is the
  // whole behaviour. Keeping the current mount in every value is what makes the
  // picker change the team without also changing which view you are in.
  return (
    `<span class="scdev-group">` +
    `<span class="scdev-label">Team</span>` +
    `<select data-scdev-goto aria-label="Preview a different team">${options}</select>` +
    `</span>`
  );
}

/**
 * The player picker, grouped by team.
 *
 * Rendered only while the player tool is the active one, like the team picker —
 * which matters more here: this is six hundred options, and injecting it into
 * every page in development would put ~40KB of `<select>` on the news tool for
 * no reason.
 */
function playerPicker(context: DevBarContext, subject: Subject): string {
  if (toolFor(context.path).key !== "player") return "";
  const mount = currentMount(context);
  const players = indexedPlayers();
  if (players.length === 0) return "";

  const byTeam = new Map<string, IndexedPlayer[]>();
  for (const player of players) {
    const label = player.team?.fullName ?? "Free agents";
    const group = byTeam.get(label);
    if (group) group.push(player);
    else byTeam.set(label, [player]);
  }

  const options = Array.from(byTeam.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, group]) => {
      const items = group
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((player) => {
          const selected = player.slug === subject.player?.slug;
          const name = player.position
            ? `${player.name} (${player.position})`
            : player.name;
          return (
            `<option value="${escapeAttr(
              href(TOOLS[2]!, mount, { team: null, player }),
            )}"${selected ? " selected" : ""}>${escapeAttr(name)}</option>`
          );
        })
        .join("");
      return `<optgroup label="${escapeAttr(label)}">${items}</optgroup>`;
    })
    .join("");

  // Same one-line behaviour as the team picker: the option VALUE is the
  // destination, and keeping the current mount in every value is what makes the
  // picker change the player without also changing which view you are in.
  return (
    `<span class="scdev-group">` +
    `<span class="scdev-label">Player</span>` +
    `<select data-scdev-goto aria-label="Preview a different player">${options}</select>` +
    `</span>`
  );
}

function mountButtons(context: DevBarContext, subject: Subject): string {
  const tool = toolFor(context.path);
  const mount = currentMount(context);

  const buttons: string[] = [];
  // Nothing here opens a new tab. Every mount is an ordinary in-place
  // navigation, so the whole bar works inside a preview pane.
  const add = (target: Mount, label: string, title: string): void => {
    buttons.push(
      `<a href="${escapeAttr(href(tool, target, subject))}"` +
        ` title="${escapeAttr(title)}"` +
        (target === mount ? ' aria-current="page"' : "") +
        `>${label}</a>`,
    );
  };

  add("page", "Page", "The standalone tool, with this app's own shell around it");
  if (tool.hasEmbedMode) {
    add("embed", "Embed", "?embed=1 — the markup stripped for a host page");
  }
  add(
    "shortcode",
    "Shortcode",
    `${shortcodeText(tool, subject)} as it renders on a page — the plugin's ` +
      "stylesheet and bundle, inside a host page that supplies the H1",
  );
  add(
    "fragment",
    "Raw",
    "The bare bytes the plugin fetches, shown as source: no stylesheet, no " +
      "script. Same response body as the /embed endpoint.",
  );

  return (
    `<span class="scdev-group">` +
    `<span class="scdev-label">Mount</span>${buttons.join("")}</span>`
  );
}

function css(): string {
  return `
.scdev{position:fixed;top:0;left:0;right:0;z-index:2147483000;
 display:flex;align-items:center;gap:10px;
 padding:7px 12px;background:#0b1220;color:#e2e8f0;
 font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
 border-bottom:2px solid #d4af37;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.scdev-body{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;flex:1}
/* A label, not a control.
   It used to be a button that collapsed the bar and remembered it in
   localStorage. That is a trap on a bar whose entire job is to be found: one
   accidental click hid every control, and the flag persisted across reloads and
   navigations, so it stayed hidden with no obvious way back. There is nothing to
   collapse away from anyway — the bar is padded out of the content's way rather
   than sitting on top of it. */
.scdev-tag{flex:0 0 auto;padding:4px 8px;border-radius:4px;
 background:#d4af37;color:#0b1220;font-weight:800;letter-spacing:.08em}
.scdev-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.scdev-label{color:#64748b;font-weight:500;font-size:10px;letter-spacing:.1em;
 text-transform:uppercase}
/* The one label that never hides. Without it the leading pair of chips reads as
   decoration; with it the bar announces what it is for. */
.scdev-label-view{color:#d4af37;font-weight:800;font-size:10px;letter-spacing:.1em;
 text-transform:uppercase}
.scdev a{display:inline-flex;align-items:baseline;gap:7px;
 padding:6px 11px;border-radius:6px;border:1px solid #24324d;
 background:#131c30;color:#cbd5e1;text-decoration:none;white-space:nowrap}
.scdev a:hover{background:#1b2743;border-color:#d4af37;color:#fff}
.scdev a[aria-current]{background:#1e2b48;border-color:#d4af37;color:#fff}
.scdev select{padding:6px 9px;border-radius:6px;border:1px solid #24324d;
 background:#131c30;color:#cbd5e1;font:inherit;max-width:44vw}
.scdev-code{color:#93a4bf;font-weight:500}
.scdev-short{display:none}
.scdev a[aria-current] .scdev-code{color:#e8c766}
.scdev-sep{width:1px;height:20px;background:#24324d}
.scdev-now{margin-left:auto;padding:5px 9px;border-radius:6px;
 background:#131c30;border:1px dashed #34415f;color:#e8c766;font-weight:700;
 white-space:nowrap}
/* A floor for the no-JS / pre-script case; the script below replaces it with
   the bar's measured height, which is the only number that is right once the
   bar wraps. */
body{padding-top:44px}
@media (max-width:860px){.scdev-label{display:none}.scdev-code{display:none}}
/* Roughly the Replit preview pane. Every control still fits, but only if the
   labels shrink to the words that distinguish them — at full length the bar
   wraps to four rows. */
@media (max-width:720px){.scdev{gap:8px;padding:6px 9px;align-items:flex-start}

 .scdev-body{gap:6px}.scdev-now{display:none}
 .scdev-tag{margin-top:2px}
 /* The dividers cost a gap either side and push the bar to an extra row. The
    groups still read as groups without them at this width. */
 .scdev-sep{display:none}
 /* Qualified by the element: ".scdev a" is (0,1,1) and a bare class is (0,1,0),
    so an unqualified ".scdev-wide-only{display:none}" loses to it and the link
    stays on screen. It did exactly that. */
 .scdev a.scdev-wide-only{display:none}
 .scdev-full{display:none}.scdev-short{display:inline}
 .scdev a{padding:6px 9px}
 .scdev select{max-width:100%;flex:1 1 140px}}`;
}

/**
 * Two small jobs.
 *
 * The <select>'s option values ARE the destinations, so navigation is one line.
 *
 * The other is `offset`, which measures the bar and feeds the number to the two
 * things that need it.
 *
 * The bar is `position: fixed` rather than in flow, and deliberately: a sticky
 * (in-flow) bar takes the BODY width, and its own nowrap contents then stretch
 * the body past the viewport — the bar runs off the right edge instead of
 * wrapping, taking half its controls with it. That happened. Fixed is measured
 * against the viewport and is immune. The cost is that it no longer occupies
 * flow, so `offset` pads the body by its height.
 *
 * It also sets `--sct-nav-offset`. The team hub's section nav is itself sticky,
 * and it would otherwise park at top:0 underneath this bar. The hub already
 * exposes that property for exactly this case — "a host page with its own
 * sticky header sets this to that header's height".
 *
 * Both are measured rather than hard-coded because the bar wraps to two or
 * three rows in a narrow pane, and re-measured on resize for the same reason.
 */
function script(): string {
  return `(function(){var b=document.querySelector('[data-scdev]');if(!b)return;
var s=b.querySelector('[data-scdev-goto]');
function offset(){var h=Math.round(b.getBoundingClientRect().height);
document.body.style.paddingTop=h+'px';
var r=document.querySelectorAll('[data-sct-root]');
for(var i=0;i<r.length;i++){r[i].style.setProperty('--sct-nav-offset',h+'px')}}
if(s)s.addEventListener('change',function(){location.href=s.value});
// The tool root is parsed after this script, so the first measurement waits.
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',offset)}else{offset()}
addEventListener('resize',offset);offset();})();`;
}

/**
 * Inject the bar before </body>.
 *
 * Returns the HTML unchanged outside development, so callers do not have to
 * guard — but they generally do anyway, to skip the string work entirely.
 */
export function injectDevBar(html: string, context: DevBarContext): string {
  if (!devBarEnabled()) return html;

  const subject: Subject = {
    team: currentTeam(context.path),
    player: currentPlayer(context.path),
  };
  const tool = toolFor(context.path);
  // At most one of these renders: each returns "" unless its own tool is the
  // active one, so the two are mutually exclusive by construction.
  const picker = teamPicker(context, subject) + playerPicker(context, subject);

  const bar =
    `<div class="scdev" data-scdev role="navigation" aria-label="Preview switcher">` +
    `<span class="scdev-tag">DEV</span>` +
    `<div class="scdev-body">` +
    `<span class="scdev-group"><span class="scdev-label-view">View</span>${toolButtons(context, subject)}</span>` +
    (picker ? `<span class="scdev-sep"></span>${picker}` : "") +
    `<span class="scdev-sep"></span>` +
    mountButtons(context, subject) +
    `<span class="scdev-sep"></span>` +
    `<span class="scdev-group">` +
    `<a href="/team">` +
    `<span class="scdev-full">All 32 teams</span>` +
    `<span class="scdev-short">All 32</span></a>` +
    `<a href="/player">` +
    `<span class="scdev-full">All players</span>` +
    `<span class="scdev-short">Players</span></a>` +
    `<a class="scdev-wide-only" href="/embed">Embed setup</a>` +
    `</span>` +
    `<code class="scdev-now">${escapeAttr(shortcodeText(tool, subject))}</code>` +
    `</div></div>`;

  const block = `<style>${css()}</style>${bar}<script>${script()}</script>`;

  // Straight after the opening <body>, so the bar is the first thing rendered
  // rather than something you have to scroll to the end of a long page to find.
  // The script sits with it: it runs before the tool's own markup is parsed,
  // which is why the one measurement that needs the tool defers to
  // DOMContentLoaded.
  const open = /<body[^>]*>/i.exec(html);
  if (open) {
    const at = open.index + open[0].length;
    return html.slice(0, at) + block + html.slice(at);
  }
  // A fragment with no <body> of its own should never reach here — the fragment
  // routes do not call this — but appending beats losing the bar silently.
  return html.includes("</body>")
    ? html.replace("</body>", `${block}</body>`)
    : html + block;
}
