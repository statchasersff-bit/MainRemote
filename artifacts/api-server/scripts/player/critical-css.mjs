#!/usr/bin/env node
/**
 * The player header's critical CSS: every rule of the built player.css that
 * styles the search box, the header and the tab strip, in player.css order,
 * written to public/player-critical.css. The fragment prints it inline
 * (src/lib/player/critical-css.ts), so the header and the tab strip paint at
 * their final size while player.css itself loads asynchronously (WP Rocket's
 * "Load CSS asynchronously" on statchasers.com). docs/MOBILE-PERF-PLAYER-2026-11-27.md.
 *
 * Derived, never hand-written:
 *
 *   1. player.css is minified with the build's own esbuild settings.
 *   2. Each selector is tested (jsdom) against real hub fragments for several
 *      players. A selector is kept when it matches the player root, the search
 *      box, the header or the tab strip, or anything inside them.
 *   3. A kept selector that ALSO matches something else on the page (`.scp a`,
 *      `.scp *`) gets `:where(<header scope>)` on its subject, so the inline
 *      copy can never re-order rules for the body of the page. :where() adds
 *      no specificity, so inside the header the cascade is player.css's own.
 *   4. All rules that can touch a header element are kept, in their original
 *      order, so the header's final cascade is unchanged when player.css lands
 *      (it is the same rules, applied again later in the document).
 *
 * tests/player-critical-css.test.mjs re-runs this selection on fresh fragments
 * and fails if the committed file differs, so a player.css or header change
 * that is not followed by `node scripts/player/critical-css.mjs` cannot ship.
 *
 *   node scripts/player/critical-css.mjs [--origin=http://127.0.0.1:PORT] [--check]
 *
 * Without --origin it boots the built server itself (tests/helpers/server.mjs).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CRITICAL_PATH = path.join(APP_DIR, "public", "player-critical.css");

/**
 * Players whose hubs are the fixtures: every position, a photo and a
 * silhouette, a veteran and a rookie on IR, a long name, a kicker. Their
 * union is the selection, so a header variant only some players have is
 * still covered.
 */
export const FIXTURE_SLUGS = [
  "jahmyr-gibbs",
  "hayden-large",
  "josh-allen",
  "jamarr-chase",
  "trey-mcbride",
  "brandon-aubrey",
  "amon-ra-st-brown",
  "nate-carter",
];

/** Also a tab address, whose strip marks another tab current. */
export const FIXTURE_TABS = ["stats", "game-log"];

const SCOPE = ":where([data-scp-root],.scp-search,.scp-search *,.scp-phead,.scp-phead *,.scp-controls,.scp-controls *)";
const SCOPE_SELECTOR = "[data-scp-root], [data-scp-root] > :is(.scp-search, .scp-phead, .scp-controls), [data-scp-root] > :is(.scp-search, .scp-phead, .scp-controls) *";
/** Selectors jsdom cannot evaluate are kept when they name a header-only class. */
const HEADER_TOKEN = /\.scp-(?:phead|pid\b|pwell|pboard|pp-|pm-|ptag|pspec|pstrip|pstat|nav|search|controls)/;

/**
 * The one hand-written part: everything in the root below the tab strip is
 * laid out but not painted until player.css has arrived (player.css sets
 * --scp-sheet-vis, --scp-sheet-ovx and --scp-sheet-min on the root), and the root keeps at
 * least a screen of height meanwhile so the host's footer cannot sit in the
 * first screen and then be pushed out, and an unstyled panel cannot widen the
 * page (horizontal scroll) meanwhile. The panels are styled by player.css
 * only, so they would otherwise paint unstyled and reflow under the reader
 * when it lands. Zero specificity, so any player.css rule outranks it. If
 * player.css never arrives (asset host down, a blocked request) the panels
 * are shown unstyled after 4s rather than never.
 */
export const SHEET_GATE =
  ":where([data-scp-root]){min-height:var(--scp-sheet-min,100vh)}" +
  ":where([data-scp-root])>:where(:not(.scp-search,.scp-phead,.scp-controls,script,style)){visibility:var(--scp-sheet-vis,hidden);overflow-x:var(--scp-sheet-ovx,clip);animation:scp-sheet 0s 4s forwards}" +
  "@keyframes scp-sheet{to{visibility:visible}}";

/** Flat list of style rules from minified CSS, each with its at-rule context. */
export function parseCss(css) {
  const rules = [];
  let i = 0;
  const skipString = (j) => {
    const q = css[j];
    j++;
    while (j < css.length && css[j] !== q) j += css[j] === "\\" ? 2 : 1;
    return j + 1;
  };
  // Index of the "}" closing the block opened at `open` ("{").
  const blockEnd = (open) => {
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      const c = css[j];
      if (c === '"' || c === "'") { j = skipString(j) - 1; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return j;
    }
    throw new Error("unbalanced CSS at " + open);
  };
  const preludeEnd = (from) => {
    for (let j = from; j < css.length; j++) {
      const c = css[j];
      if (c === '"' || c === "'") { j = skipString(j) - 1; continue; }
      if (c === "{" || c === ";") return j;
    }
    return css.length;
  };
  const walk = (from, to, ctx) => {
    i = from;
    while (i < to) {
      while (i < to && /\s/.test(css[i])) i++;
      if (i >= to) break;
      if (css.startsWith("/*", i)) { i = css.indexOf("*/", i) + 2; continue; }
      const p = preludeEnd(i);
      const prelude = css.slice(i, p).trim();
      if (css[p] === ";") { i = p + 1; continue; } // @charset, @import
      const end = blockEnd(p);
      if (/^@(media|supports|container|layer)\b/.test(prelude)) {
        const resume = end + 1;
        walk(p + 1, end, [...ctx, prelude]);
        i = resume;
      } else if (prelude.startsWith("@")) {
        rules.push({ type: "at", prelude, body: css.slice(p + 1, end), ctx });
        i = end + 1;
      } else {
        rules.push({ type: "rule", sel: prelude, body: css.slice(p + 1, end), ctx });
        i = end + 1;
      }
    }
  };
  walk(0, css.length, []);
  return rules;
}

/** Split a selector list on top-level commas. */
export function splitSelectors(list) {
  const out = [];
  let depth = 0, cur = "";
  for (let j = 0; j < list.length; j++) {
    const c = list[j];
    if (c === '"' || c === "'") {
      const k = list.indexOf(c, j + 1);
      cur += list.slice(j, k + 1);
      j = k;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split a declaration block on top-level semicolons. */
export function splitDeclarations(body) {
  const out = [];
  let depth = 0, cur = "";
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '"' || c === "'") {
      let k = j + 1;
      while (k < body.length && body[k] !== c) k += body[k] === "\\" ? 2 : 1;
      cur += body.slice(j, k + 1);
      j = k;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) { if (cur.trim()) out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const PSEUDO_ELEMENT = /(::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?)+$/;
const STATE = /:(?:hover|focus-visible|focus-within|focus|active|visited|link|target|checked|placeholder-shown|autofill|-webkit-autofill|popover-open|open|indeterminate|user-invalid|user-valid|invalid|valid)\b/g;

/** The selector as jsdom should test it: no pseudo-elements, no user states. */
function forMatching(sel) {
  let s = sel.replace(PSEUDO_ELEMENT, "");
  s = s.replace(/::?(?:before|after|placeholder|marker|selection|-webkit-[\w-]+|-moz-[\w-]+)/g, "");
  s = s.replace(STATE, "");
  s = s.replace(/:not\(\s*\)/g, "");
  if (!s.trim() || /[>+~]\s*$/.test(s)) s += "*";
  return s;
}

/** `sel` restricted to the header scope, specificity unchanged. */
function scoped(sel) {
  const m = sel.match(PSEUDO_ELEMENT);
  return m ? sel.slice(0, m.index) + SCOPE + m[0] : sel + SCOPE;
}

/**
 * @param {string} minifiedCss the built player.css
 * @param {string[]} fragments hub/tab fragment HTML
 * @param {typeof import("jsdom").JSDOM} JSDOM
 */
export function selectCritical(minifiedCss, fragments, JSDOM) {
  // Fixtures as served, and in the state the player script puts it
  // in at boot (tabs owned by script with their ARIA roles, the search box
  // shown, the photo well marked missing as for a 404 or a player without a
  // photo), so rules for those states are selected too.
  const booted = (doc) => {
    const root = doc.querySelector("[data-scp-root]");
    root.setAttribute("data-scp-tabs", "js");
    const search = root.querySelector(":scope > .scp-search");
    if (search) search.hidden = false;
    root.querySelector(".scp-search-input")?.setAttribute("role", "combobox");
    root.querySelector("[data-scp-pwell]")?.classList.add("is-missing");
    const list = root.querySelector(".scp-nav-list");
    list?.setAttribute("role", "tablist");
    for (const [n, link] of [...root.querySelectorAll(".scp-nav-link")].entries()) {
      link.setAttribute("role", "tab");
      link.setAttribute("aria-selected", n === 0 ? "true" : "false");
      link.closest("li")?.setAttribute("role", "presentation");
    }
  };
  // (The booted copy for the first two fixtures - a veteran with a photo and a
  // rookie on IR - is enough: the script does the same to every header.)
  const runs = [...fragments.map((html) => ({ html, variant: false })), ...fragments.slice(0, 2).map((html) => ({ html, variant: true }))];
  const docs = runs.map(({ html, variant }) => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><div class="entry-content">${html}</div></body></html>`);
    const doc = dom.window.document;
    if (variant) booted(doc);
    const scope = new Set(doc.querySelectorAll(SCOPE_SELECTOR));
    if (!doc.querySelector("[data-scp-root] > .scp-phead")) throw new Error("fixture without a player header");
    return { doc, scope, scopeList: [...scope] };
  });
  const verdict = new Map(); // matching selector -> {inScope, outside, unknown}
  const judge = (sel) => {
    const key = forMatching(sel);
    if (verdict.has(key)) return verdict.get(key);
    const v = { inScope: false, outside: false, unknown: false };
    try {
      // Cheap first: does it match any header element (full page as context,
      // so :has() and sibling combinators see the real panels)?
      v.inScope = docs.some(({ scopeList }) => scopeList.some((el) => el.matches(key)));
      if (v.inScope) {
        for (const { doc, scope } of docs) {
          for (const el of doc.querySelectorAll(key)) {
            if (!scope.has(el) && el.closest("[data-scp-root]")) { v.outside = true; break; }
          }
          if (v.outside) break;
        }
      }
    } catch {
      v.unknown = true;
    }
    if (v.unknown) {
      v.inScope = HEADER_TOKEN.test(sel);
      v.outside = false;
    }
    verdict.set(key, v);
    return v;
  };

  const kept = [];
  let unknown = 0;
  for (const r of parseCss(minifiedCss)) {
    if (r.type !== "rule") continue;
    if (r.ctx.some((c) => !/^@(media|supports|container)\b/.test(c))) continue;
    const sels = [];
    for (const sel of splitSelectors(r.sel)) {
      const v = judge(sel);
      if (v.unknown) unknown++;
      if (!v.inScope) continue;
      sels.push(v.outside ? scoped(sel) : sel);
    }
    if (sels.length) kept.push({ ctx: r.ctx, sels, body: r.body });
  }

  // Custom properties: keep only those the kept rules use (transitively). The
  // root's palette block alone declares ~300, most for the page body; the full
  // set still arrives with player.css, with the same values.
  const declsOf = (body) => splitDeclarations(body);
  const used = new Set();
  const refs = (v) => [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  const customs = new Map();
  for (const k of kept) for (const d of declsOf(k.body)) {
    const m = d.match(/^\s*(--[\w-]+)\s*:(.*)$/s);
    if (m) { if (!customs.has(m[1])) customs.set(m[1], []); customs.get(m[1]).push(m[2]); }
    else refs(d).forEach((r) => used.add(r));
  }
  const queue = [...used];
  while (queue.length) for (const v of customs.get(queue.pop()) ?? []) for (const r of refs(v)) if (!used.has(r)) { used.add(r); queue.push(r); }
  let dropped = 0;
  for (const k of kept) {
    const ds = declsOf(k.body);
    const keep = ds.filter((d) => { const m = d.match(/^\s*(--[\w-]+)\s*:/); if (m && !used.has(m[1])) { dropped++; return false; } return true; });
    k.body = keep.join(";");
    k.text = `${k.sels.join(",")}{${k.body}}`;
  }
  const live = kept.filter((k) => k.body.trim());

  // Re-wrap consecutive rules that share an at-rule context.
  let out = "";
  let open = [];
  for (const k of live) {
    let same = 0;
    while (same < open.length && same < k.ctx.length && open[same] === k.ctx[same]) same++;
    out += "}".repeat(open.length - same);
    for (const c of k.ctx.slice(same)) out += `${c}{`;
    open = k.ctx;
    out += k.text;
  }
  out += "}".repeat(open.length);
  out += SHEET_GATE;
  return { css: out, rules: live.length, unknown, droppedCustomProperties: dropped };
}

/** The built player.css, minified exactly as build.mjs does. */
export async function builtPlayerCss() {
  const { transform } = await import("esbuild");
  const source = await readFile(path.join(APP_DIR, "public", "player.css"), "utf8");
  const { code } = await transform(source, { loader: "css", minify: true, logLevel: "warning" });
  return code;
}

/** Hub (and two tab) fragments from a running server. */
export async function fetchFragments(origin) {
  const urls = [
    ...FIXTURE_SLUGS.map((s) => `${origin}/embed/player/${s}?h1=1`),
    ...FIXTURE_TABS.map((t) => `${origin}/embed/player/${FIXTURE_SLUGS[0]}?h1=1&section=${t}`),
  ];
  const out = [];
  for (const u of urls) {
    const res = await fetch(u, { headers: { connection: "close" } });
    if (!res.ok) continue; // a fixture player without a page is skipped, not fatal
    const html = await res.text();
    if (html.includes("data-scp-root")) out.push(html);
  }
  if (out.length < 4) throw new Error(`only ${out.length} fixture fragments`);
  return out;
}

/** The selection for the current tree. */
export async function buildCritical(origin) {
  const { JSDOM } = await import("jsdom");
  return selectCritical(await builtPlayerCss(), await fetchFragments(origin), JSDOM);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  let origin = arg("origin");
  let stop = async () => {};
  if (!origin) {
    const { startServer } = await import(path.join(APP_DIR, "tests", "helpers", "server.mjs"));
    ({ origin, stop } = await startServer());
  }
  try {
    const { css, rules, unknown } = await buildCritical(origin);
    const header = "/* Generated by scripts/player/critical-css.mjs from player.css - do not edit. */\n";
    if (process.argv.includes("--check")) {
      const have = await readFile(CRITICAL_PATH, "utf8").catch(() => "");
      if (have !== header + css) { console.error("public/player-critical.css is stale: run node scripts/player/critical-css.mjs"); process.exitCode = 1; }
      else console.log("public/player-critical.css is current");
    } else {
      await writeFile(CRITICAL_PATH, header + css);
      console.log(`wrote public/player-critical.css: ${rules} rules, ${css.length} bytes (${unknown} selectors jsdom could not evaluate, kept by class)`);
    }
  } finally {
    await stop();
  }
}
