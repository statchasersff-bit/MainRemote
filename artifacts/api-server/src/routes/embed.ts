import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();

// Work out the public origin this server is reachable at, so the generated
// snippet's iframe src and the parent-side origin check are always correct —
// even behind a proxy (Replit terminates TLS and forwards x-forwarded-*).
function publicOrigin(req: Request): string {
  const proto = (
    req.get("x-forwarded-proto")?.split(",")[0] ??
    req.protocol ??
    "https"
  ).trim();
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
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

  // Resolve the frame inside the handler so load order never matters.
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    if (!e.data || e.data.type !== 'statchasers:height') return;
    var f = frame();
    var h = parseInt(e.data.height, 10);
    // Set the height as inline !important so it wins over any leftover host CSS
    // (e.g. a legacy "#statchasers-news { height: 530px !important }" rule) —
    // an inline !important beats a stylesheet !important, so the frame always
    // reflects the true content height. Clear min-height for the same reason.
    if (f && h > 0) {
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
      f.contentWindow.postMessage({ type: 'statchasers:request-height' }, ORIGIN);
    }
  }
  requestHeight();
  window.addEventListener('load', requestHeight);
  var f0 = frame();
  if (f0) f0.addEventListener('load', requestHeight);
})();
`;
}

// The parent-page embed markup. The iframe broadcasts its true content height
// (see public/app.js -> postHeight); the external embed.js listens for that
// message and resizes the frame to match, so there is no inner scrollbar and no
// leftover whitespace ("white block") when the content is shorter than the frame.
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

// GET /embed.js — the external resize listener referenced by the snippet.
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

// GET /embed — a small page that shows the snippet with a copy button and the
// host-side setup notes (the bits a fixed-height embed gets wrong).
router.get("/embed", (req, res) => {
  const snippet = embedSnippet(publicOrigin(req));
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Embed StatChasers News</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.4rem; }
    pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; overflow-x: auto; font-size: 13px; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; }
    button { background: #d4af37; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
    ol { padding-left: 20px; }
    .muted { color: #6b7280; }
  </style>
</head>
<body>
  <h1>Embed the StatChasers news feed</h1>
  <p>Paste this into a code/HTML block on your page (in Divi, use a <strong>Code</strong> module):</p>
  <pre><code id="snippet">${escapeHtml(snippet)}</code></pre>
  <button onclick="navigator.clipboard.writeText(document.getElementById('snippet').textContent).then(function(){this.textContent='Copied!'}.bind(this))">Copy snippet</button>
  <h2>Important</h2>
  <ol>
    <li>The resize logic loads from <code>/embed.js</code> (an external file) on purpose — WordPress/Divi rewrites <em>inline</em> scripts and breaks them, but it can't touch an external file.</li>
    <li>Do <strong>not</strong> set a fixed height on the surrounding module/row — leave Height blank/auto. The script sizes the frame to the content; a fixed height leaves a white block below it.</li>
    <li>The <code>height:728px</code> in the snippet is only a placeholder shown before the script runs — set close to the real content height so there's no gap (too tall) or scrollbar (too short) before the resize kicks in.</li>
    <li>After pasting, click into the code and confirm the script URL reads <code>/embed.js</code> with no stray space — Divi occasionally inserts one when a long line wraps, which stops the resize script from loading.</li>
    <li>The frame re-sizes automatically on refresh, pagination, and window resize.</li>
  </ol>
  <p class="muted">Raw snippet also available at <a href="/embed.txt">/embed.txt</a>.</p>
</body>
</html>`);
});

export default router;
