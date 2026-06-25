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

// The parent-page embed markup. The iframe broadcasts its true content height
// (see public/app.js -> postHeight); this snippet listens for that message and
// resizes the frame to match, so there is no inner scrollbar and no leftover
// whitespace ("white block") when the content is shorter than a fixed height.
export function embedSnippet(origin: string): string {
  return `<iframe
  id="statchasers-news"
  src="${origin}/"
  title="StatChasers — NFL Player News"
  style="width:100%;border:0;border-radius:16px;display:block;height:600px;"
  loading="lazy"></iframe>
<script>
  (function () {
    var frame = document.getElementById('statchasers-news');
    window.addEventListener('message', function (e) {
      if (e.origin !== '${origin}') return;
      if (!e.data || e.data.type !== 'statchasers:height') return;
      var h = parseInt(e.data.height, 10);
      if (h > 0) frame.style.height = h + 'px';
    });
  })();
</script>`;
}

// Small HTML escaper so the snippet renders as text inside <code>, not as live
// markup that the browser would try to execute.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
  <p>Paste this into a code/HTML block on your page (in Divi, use a <strong>Code</strong> module so the <code>&lt;script&gt;</code> is kept):</p>
  <pre><code id="snippet">${escapeHtml(snippet)}</code></pre>
  <button onclick="navigator.clipboard.writeText(document.getElementById('snippet').textContent).then(function(){this.textContent='Copied!'}.bind(this))">Copy snippet</button>
  <h2>Important</h2>
  <ol>
    <li>Do <strong>not</strong> set a fixed height on the surrounding module/row — leave Height blank/auto. The script sizes the frame to the content; a fixed height leaves a white block below it.</li>
    <li>The <code>height:600px</code> in the snippet is only a placeholder shown before the script runs.</li>
    <li>The frame re-sizes automatically on refresh, pagination, and window resize.</li>
  </ol>
  <p class="muted">Raw snippet also available at <a href="/embed.txt">/embed.txt</a>.</p>
</body>
</html>`);
});

export default router;
