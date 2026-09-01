/**
 * Regenerates src/lib/team/network-marks.ts from the .svg files in
 * public/networks. Run it after adding or replacing one:
 *
 *   node scripts/network-marks.mjs
 *
 * The vendored files are already flat — one <svg> with a <title> and a run of
 * <path fill="#rrggbb">, no transforms, no groups, no <style> — because the
 * crop below has to measure path data in the file's own coordinate space and a
 * transform it did not apply would silently move the artwork out from under the
 * box it computed. public/networks/SOURCES.md says where each file came from
 * and how it was flattened.
 *
 * Each logo is cropped from whatever frame its source drew it in to its own
 * artwork, so a roundel and a wordmark can be fitted to a common optical box
 * rather than to a common frame. Bounds include control points (a Bezier never
 * leaves its control hull, so this over-estimates rather than clips) and an arc
 * contributes its radii around both endpoints.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const ARGS = { M:2, m:2, L:2, l:2, H:1, h:1, V:1, v:1, C:6, c:6, S:4, s:4, Q:4, q:4, T:2, t:2, A:7, a:7, Z:0, z:0 };

function bbox(d, hit) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0, cmd = "", cx = 0, cy = 0, sx = 0, sy = 0;
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const n = ARGS[cmd];
    if (n === undefined) throw new Error("bad command " + cmd);
    const rel = cmd === cmd.toLowerCase() && cmd !== "Z" && cmd !== "z";
    const a = toks.slice(i, i + n).map(Number); i += n;
    const px = rel ? cx : 0, py = rel ? cy : 0;
    if (cmd === "M" || cmd === "m") { cx = px + a[0]; cy = py + a[1]; sx = cx; sy = cy; hit(cx, cy); }
    else if (cmd === "L" || cmd === "l") { cx = px + a[0]; cy = py + a[1]; hit(cx, cy); }
    else if (cmd === "H" || cmd === "h") { cx = px + a[0]; hit(cx, cy); }
    else if (cmd === "V" || cmd === "v") { cy = py + a[0]; hit(cx, cy); }
    else if (cmd === "C" || cmd === "c") { hit(px + a[0], py + a[1]); hit(px + a[2], py + a[3]); cx = px + a[4]; cy = py + a[5]; hit(cx, cy); }
    else if (cmd === "S" || cmd === "s" || cmd === "Q" || cmd === "q") { hit(px + a[0], py + a[1]); cx = px + a[2]; cy = py + a[3]; hit(cx, cy); }
    else if (cmd === "T" || cmd === "t") { cx = px + a[0]; cy = py + a[1]; hit(cx, cy); }
    else if (cmd === "A" || cmd === "a") {
      const [rx, ry] = a; const ex = px + a[5], ey = py + a[6];
      hit(cx - rx, cy - ry); hit(cx + rx, cy + ry); hit(ex - rx, ey - ry); hit(ex + rx, ey + ry);
      cx = ex; cy = ey;
    } else if (cmd === "Z" || cmd === "z") { cx = sx; cy = sy; }
  }
}

/** Every <path> in document order — the order the colours have to be painted in. */
function paths(svg) {
  return [...svg.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => {
    const attr = (name) => m[1].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
    const d = attr("d");
    const fill = attr("fill");
    if (!d) throw new Error("<path> with no d");
    if (!fill || !/^#[0-9A-Fa-f]{6}$/.test(fill)) {
      throw new Error(`<path> needs an explicit 6-digit fill, got ${fill}`);
    }
    return { d, fill: fill.toUpperCase(), evenOdd: attr("fill-rule") === "evenodd" };
  });
}

const out = [];
for (const f of readdirSync("public/networks").filter((f) => f.endsWith(".svg")).sort()) {
  const svg = readFileSync("public/networks/" + f, "utf8");
  if (/\btransform=/.test(svg)) throw new Error(`${f} still carries a transform; flatten it first`);
  const title = svg.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) throw new Error(`${f} has no <title>`);
  const frame = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
  if (frame?.length !== 4) throw new Error(`${f} has no viewBox`);
  const shapes = paths(svg);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const hit = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  for (const s of shapes) bbox(s.d, hit);
  // The arc bound above is generous; clamp back to the frame the file drew in.
  x0 = Math.max(frame[0], x0); y0 = Math.max(frame[1], y0);
  x1 = Math.min(frame[0] + frame[2], x1); y1 = Math.min(frame[1] + frame[3], y1);

  const r = (n) => Math.round(n * 100) / 100;
  out.push({
    key: f.replace(/\.svg$/, ""),
    title,
    viewBox: `${r(x0)} ${r(y0)} ${r(x1 - x0)} ${r(y1 - y0)}`,
    aspect: r((x1 - x0) / (y1 - y0)),
    paths: shapes,
  });
}

const target = "src/lib/team/network-marks.ts";
const source = readFileSync(target, "utf8");
const start = source.indexOf("export const NETWORK_MARKS");
const end = source.indexOf("\n};", start) + 3;
if (start < 0 || end < 3) throw new Error("NETWORK_MARKS block not found in " + target);
const table =
  "export const NETWORK_MARKS: Record<string, NetworkMark> = {\n" +
  out
    .map(
      (m) =>
        `  ${m.key}: {\n` +
        `    key: "${m.key}",\n` +
        `    title: ${JSON.stringify(m.title)},\n` +
        `    viewBox: "${m.viewBox}",\n` +
        `    aspect: ${m.aspect},\n` +
        `    paths: [\n` +
        m.paths
          .map(
            (p) =>
              `      {\n` +
              `        fill: "${p.fill}",\n` +
              (p.evenOdd ? `        evenOdd: true,\n` : "") +
              `        d: ${JSON.stringify(p.d)},\n` +
              `      },`,
          )
          .join("\n") +
        `\n    ],\n` +
        `  },`,
    )
    .join("\n") +
  "\n};";
writeFileSync(target, source.slice(0, start) + table + source.slice(end));
for (const o of out) {
  console.log(o.key.padEnd(15), "viewBox:", o.viewBox.padEnd(30), "aspect:", String(o.aspect).padEnd(6), o.paths.length + " path(s)");
}
console.log("wrote", target);
