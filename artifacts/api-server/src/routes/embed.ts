import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import { renderNewsFragment } from "../lib/ssr";
import { DEFAULT_PAGE_SIZE } from "../lib/render";
import { MAX_LIMIT } from "../lib/news-query";
import { publicOrigin } from "../lib/request";
import {
  linkTemplatesFromEnv,
  parseRelatedLinks,
  relatedLinksFromEnv,
} from "../lib/links";
import { appSchema } from "../lib/schema";
import { pageMeta } from "../lib/seo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Content hash of the compiled browser assets, written by build.mjs. WordPress
 * uses it as the `ver` on the enqueued script/style so a deploy busts caches
 * without the filenames having to change.
 */
function assetVersion(): string {
  try {
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), "public", "dist", "version.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version) return parsed.version;
  } catch {
    // Not built yet (or running from an unexpected cwd) — fall through.
  }
  return "0";
}

// The external resize listener, served as a standalone .js file. Hosting it as a
// file (rather than inline) is what makes the embed survive WordPress/Divi: the
// page's HTML formatter (wpautop) rewrites inline <script> bodies — inserting
// <br>/<p> tags — which produces "Uncaught SyntaxError: Unexpected token '<'"
// and kills the listener. A separate file has no inline body to mangle.
export function embedScript(origin: string): string {
  return `(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  function frame() { return document.getElementById('statchasers-news'); }

  // The origin the frame is ACTUALLY loaded from, read off its own src. ORIGIN
  // is baked in when this file is served, so the two disagree whenever the
  // snippet pasted into the page is older than the current deploy, or the host
  // reached this server over a different scheme/host than the one that
  // generated the snippet (http vs https, apex vs www). A strict comparison
  // against the baked value then rejects every height message in silence, the
  // frame keeps its placeholder height forever, and the symptom on the page is
  // a tool that scrolls inside its own box.
  function frameOrigin(f) {
    try { return new URL(f.getAttribute('src'), location.href).origin; }
    catch (err) { return ORIGIN; }
  }

  // Resolve the frame inside the handler so load order never matters.
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'statchasers:height') return;
    var f = frame();
    if (!f) return;
    // Identity of the sending window is the real check — it is precisely "this
    // came from our iframe" and cannot be spoofed by another frame on the page.
    // The origin comparison stays as the fallback for the case where the source
    // window is not exposed, and now accepts the frame's real origin as well as
    // the baked one.
    if (e.source) {
      if (e.source !== f.contentWindow) return;
    } else if (e.origin !== ORIGIN && e.origin !== frameOrigin(f)) {
      return;
    }
    var h = parseInt(e.data.height, 10);
    // Set the height as inline !important so it wins over any leftover host CSS
    // (e.g. a legacy "#statchasers-news { height: 530px !important }" rule) —
    // an inline !important beats a stylesheet !important, so the frame always
    // reflects the true content height. Clear min-height for the same reason.
    if (h > 0) {
      f.style.setProperty('height', h + 'px', 'important');
      f.style.setProperty('min-height', '0', 'important');
    }
  });

  // This file is often loaded LATE — performance plugins (WP Rocket /
  // Perfmatters / LiteSpeed) "delay JavaScript execution" until the first user
  // interaction, by which point the iframe's load-time height broadcast is long
  // gone. So don't just wait passively: ask the iframe for its height now, and
  // again whenever it (re)loads. The iframe answers with a fresh statchasers:height.
  function requestHeight() {
    var f = frame();
    if (f && f.contentWindow) {
      f.contentWindow.postMessage({ type: 'statchasers:request-height' }, frameOrigin(f));
    }
  }
  requestHeight();
  window.addEventListener('load', requestHeight);
  var f0 = frame();
  if (f0) f0.addEventListener('load', requestHeight);
  // The mirror of the child's re-broadcast. The first request above lands on a
  // frame whose document may not be listening yet (nothing answers, and no
  // event tells us so), and a frame that finished loading before this file ran
  // fires no further load event. A few bounded retries cover both without any
  // state to keep.
  for (var i = 0, ms = [300, 1000, 2500, 5000]; i < ms.length; i++) {
    setTimeout(requestHeight, ms[i]);
  }
})();
`;
}

// The legacy parent-page embed markup. Kept working for existing installs, but
// the plugin (see wordpress-plugin/) is now the recommended integration: it
// mounts the tool directly into the page instead of sealing it inside a
// cross-origin frame that no crawler can attribute to the host URL.
export function embedSnippet(origin: string): string {
  // NOTE: deliberately NOT using loading="lazy" — and we add the skip markers
  // that the common performance plugins honor (WP Rocket / Perfmatters /
  // LiteSpeed / a3 Lazy Load). A lazy-loaded iframe gets pulled out of the DOM
  // until scrolled into view, which both hides it and breaks the postMessage
  // auto-resize. These attributes keep the plugin from touching it.
  // Keep the iframe on ONE line with only quoted attributes. Divi/WordPress's
  // editor mangles multi-line tags (and bare attributes like `data-skip-lazy`),
  // and a dropped </iframe> makes the iframe swallow everything after it.
  // The height here is only a placeholder shown before embed.js runs and resizes
  // the frame to the true content height. Set it close to the ACTUAL height of a
  // full page of cards (~728px) rather than oversized: performance plugins often
  // delay the resize script until the visitor interacts, and until then the
  // placeholder IS the visible height — too tall leaves an empty gap under the
  // cards, too short shows a brief scrollbar. Matching real content avoids both.
  return (
    `<iframe id="statchasers-news" src="${origin}/" title="StatChasers NFL Player News" class="skip-lazy" data-no-lazy="1" style="width:100%;border:0;border-radius:16px;display:block;height:728px;"></iframe>\n` +
    `<script src="${origin}/embed.js"></script>`
  );
}

// Small HTML escaper so the snippet renders as text inside <code>, not as live
// markup that the browser would try to execute.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Shared parsing for the fragment endpoints. `heading_text` lets the host page
 * word the tool's H2 to agree with its own H1 and <title>.
 */
function fragmentOptions(req: Parameters<typeof publicOrigin>[0]) {
  const headingText = String(req.query["heading_text"] ?? "").trim();
  const relatedHeading = String(req.query["related_heading"] ?? "").trim();

  // Link templates are supplied per-request by the host (the plugin passes the
  // site's own URL patterns) and fall back to the server environment.
  const envLinks = linkTemplatesFromEnv();
  const playerUrl =
    String(req.query["player_url"] ?? "").trim() || envLinks.playerUrl;
  const teamUrl =
    String(req.query["team_url"] ?? "").trim() || envLinks.teamUrl;

  const related = String(req.query["related"] ?? "").trim();
  const relatedLinks = related ? parseRelatedLinks(related) : relatedLinksFromEnv();

  const vitalsEndpoint =
    String(req.query["vitals_endpoint"] ?? "").trim() ||
    (process.env["VITALS_ENDPOINT"] ?? "").trim();
  const pageUrl = String(req.query["page_url"] ?? "").trim();

  return {
    limit: clampInt(req.query["limit"], MAX_LIMIT, 1, MAX_LIMIT),
    pageSize: clampInt(req.query["page_size"], DEFAULT_PAGE_SIZE, 1, 50),
    heading: req.query["heading"] !== "0",
    origin: publicOrigin(req),
    // Cap it so a stray query can't inject a wall of text into the heading.
    ...(headingText ? { headingText: headingText.slice(0, 120) } : {}),
    ...(relatedHeading ? { relatedHeading: relatedHeading.slice(0, 120) } : {}),
    links: {
      ...(playerUrl ? { playerUrl } : {}),
      ...(teamUrl ? { teamUrl } : {}),
    },
    ...(relatedLinks.length ? { relatedLinks } : {}),
    ...(vitalsEndpoint ? { vitalsEndpoint } : {}),
    ...(pageUrl ? { pageUrl } : {}),
  };
}

/**
 * GET /embed/ssr — the tool, server-rendered, as a bare HTML fragment.
 *
 * This is the endpoint that makes the WordPress plugin possible: the plugin
 * fetches it during page render and drops the markup straight into the page
 * body, so statchasers.com serves the headlines itself rather than pointing at
 * an opaque frame. Returned as JSON so the asset version rides along with it.
 */
router.get("/embed/ssr", async (req, res) => {
  const options = fragmentOptions(req);

  try {
    const html = await renderNewsFragment(options);
    res
      .set("Cache-Control", "public, max-age=60")
      .json({
        ok: true,
        html,
        version: assetVersion(),
        origin: options.origin,
      });
  } catch (err) {
    logger.error({ err }, "SSR fragment render failed");
    res.status(500).json({ ok: false, error: "render_failed" });
  }
});

// GET /embed/ssr.html — the same fragment as raw HTML, for hand-pasting into a
// page or for anyone wiring this up outside WordPress.
router.get("/embed/ssr.html", async (req, res) => {
  try {
    const html = await renderNewsFragment(fragmentOptions(req));
    res
      .set("Cache-Control", "public, max-age=60")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err }, "SSR fragment render failed");
    res.status(500).type("html").send("");
  }
});

/**
 * GET /embed/schema.json — the tool's structured-data node, on its own.
 *
 * Returns a single SoftwareApplication/WebApplication node, NOT a complete
 * `@graph`. That is the point: the host page already has an SEO plugin
 * producing WebPage and BreadcrumbList nodes, and publishing a second graph
 * alongside it would duplicate and contradict them. Merge this node into the
 * graph you already emit — the WordPress plugin does exactly that through
 * Rank Math's `rank_math/json_ld` filter.
 *
 * Query: `page_url` (the canonical URL of the host page — required for the node
 * to describe the right page) and optional `webpage_id` to attach it to your
 * existing WebPage node.
 */
router.get("/embed/schema.json", (req, res) => {
  const pageUrl =
    String(req.query["page_url"] ?? "").trim() || `${publicOrigin(req)}/`;
  const webPageId = String(req.query["webpage_id"] ?? "").trim();

  if (!/^https?:\/\//i.test(pageUrl)) {
    res.status(400).json({ ok: false, error: "page_url must be absolute" });
    return;
  }

  const meta = pageMeta(pageUrl);
  const name = String(req.query["name"] ?? "").trim() || meta.heading;
  const description =
    String(req.query["description"] ?? "").trim() || meta.description;

  res.set("Cache-Control", "public, max-age=300").json({
    ok: true,
    node: appSchema({
      pageUrl,
      name: name.slice(0, 160),
      description: description.slice(0, 500),
      ...(webPageId ? { webPageId } : {}),
    }),
  });
});

// GET /embed/assets.json — where the compiled bundles live and what version
// they are. Lets the plugin enqueue without hardcoding paths.
router.get("/embed/assets.json", (req, res) => {
  const origin = publicOrigin(req);
  res.set("Cache-Control", "public, max-age=60").json({
    ok: true,
    version: assetVersion(),
    js: `${origin}/dist/statchasers-news.js`,
    css: `${origin}/styles.css`,
  });
});

// GET /embed.js — the external resize listener referenced by the iframe snippet.
router.get("/embed.js", (req, res) => {
  res
    .type("application/javascript")
    .set("Cache-Control", "public, max-age=300")
    .send(embedScript(publicOrigin(req)));
});

// GET /embed.txt — raw snippet, for scripting or a quick copy.
router.get("/embed.txt", (req, res) => {
  res.type("text/plain").send(embedSnippet(publicOrigin(req)));
});

// GET /embed — setup instructions: the plugin first, the legacy iframe second.
router.get("/embed", (req, res) => {
  const origin = publicOrigin(req);
  const snippet = embedSnippet(origin);
  res
    .set("X-Robots-Tag", "noindex")
    .type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Embed StatChasers News</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; margin-top: 32px; }
    pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; overflow-x: auto; font-size: 13px; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; }
    button { background: #d4af37; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
    ol, ul { padding-left: 20px; }
    .muted { color: #6b7280; }
    .rec { border-left: 4px solid #d4af37; background: #fdf8e8; padding: 12px 16px; border-radius: 0 10px 10px 0; }
  </style>
</head>
<body>
  <h1>Add the StatChasers news feed to a page</h1>

  <div class="rec">
    <strong>Recommended: the WordPress plugin.</strong> It renders the headlines
    into your page's own HTML and loads the tool's compiled bundles through
    <code>wp_enqueue_script()</code>/<code>wp_enqueue_style()</code>. Search
    engines then see the news as part of your page instead of as an opaque frame
    they can't credit to your URL.
  </div>

  <h2>Option 1 — WordPress plugin (recommended)</h2>
  <ol>
    <li>Install and activate <code>statchasers-news</code> (see <code>wordpress-plugin/</code> in the repo).</li>
    <li>Point it at this server by adding to <code>wp-config.php</code>:
      <pre><code>define( 'STATCHASERS_NEWS_ORIGIN', '${escapeHtml(origin)}' );</code></pre>
    </li>
    <li>Drop the shortcode into the page:
      <pre><code>[statchasers_news]</code></pre>
    </li>
  </ol>
  <p class="muted">
    Optional attributes: <code>limit</code>, <code>page_size</code>, and
    <code>heading="0"</code> if the page already has its own section heading.
  </p>

  <h2>Option 2 — server-rendered fragment, no plugin</h2>
  <p>
    If you'd rather not install a plugin, fetch the rendered markup yourself and
    print it into the page, then load the two assets:
  </p>
  <pre><code>GET ${escapeHtml(origin)}/embed/ssr.html
&lt;link rel="stylesheet" href="${escapeHtml(origin)}/styles.css"&gt;
&lt;script src="${escapeHtml(origin)}/dist/statchasers-news.js" defer&gt;&lt;/script&gt;</code></pre>
  <p class="muted">
    The fragment carries <code>data-sc-origin</code>, so the script knows which
    host to refresh from. <code>/embed/assets.json</code> returns the current
    asset version if you want to cache-bust.
  </p>

  <h2>Option 3 — legacy iframe</h2>
  <p>Paste this into a code/HTML block (in Divi, use a <strong>Code</strong> module):</p>
  <pre><code id="snippet">${escapeHtml(snippet)}</code></pre>
  <button onclick="navigator.clipboard.writeText(document.getElementById('snippet').textContent).then(function(){this.textContent='Copied!'}.bind(this))">Copy snippet</button>
  <ol>
    <li>The resize logic loads from <code>/embed.js</code> (an external file) on purpose — WordPress/Divi rewrites <em>inline</em> scripts and breaks them, but it can't touch an external file.</li>
    <li>Do <strong>not</strong> set a fixed height on the surrounding module/row — leave Height blank/auto. The script sizes the frame to the content; a fixed height leaves a white block below it.</li>
    <li>The <code>height:728px</code> in the snippet is only a placeholder shown before the script runs.</li>
    <li>After pasting, confirm the script URL reads <code>/embed.js</code> with no stray space — Divi occasionally inserts one when a long line wraps.</li>
  </ol>
  <p>
    The framed app is served with <code>noindex, indexifembedded</code>, so the
    raw tool URL won't rank on its own but Google may still use its content for
    the page embedding it. Note that this only helps on Google, and it still
    leaves your page's own HTML empty — which is why Option 1 or 2 is better.
  </p>

  <p class="muted">Raw iframe snippet also available at <a href="/embed.txt">/embed.txt</a>.</p>
</body>
</html>`);
});

export default router;
