#!/usr/bin/env node
// Interaction (INP) probe: loads a URL in headless Chromium over the DevTools
// protocol, performs real taps/clicks on the selectors you name, and prints
// each interaction's Event Timing split into the three INP phases (input
// delay, processing, presentation) together with the Long Animation Frame
// scripts that ran inside it. Written for the 2026-11-15 INP audit
// (docs/INP-AUDIT.md); use it to re-check a template after a change.
//
//   node scripts/inp-probe.mjs <url> [mobile|desktop] --click="<css>|<css>|..."
//
//   mobile    412x915 phone emulation, touch input, 4x CPU throttle
//   desktop   1366x768, mouse input, no throttle
//   --click   "|"-separated selectors, clicked in order (first VISIBLE match;
//             append " @N" to pick the Nth visible match). "BODY" taps a
//             paragraph of plain text: an interaction no handler of ours
//             owns, so it shows the page's baseline cost per tap.
//   --settle=ms   wait after load before the first click (default 6000)
//   --early       first click 1500ms after DOMContentLoaded instead
//   --cpu=N       override the CPU throttle rate
//   --block=pat,..  Network.setBlockedURLs patterns (A/B a script's cost)
//   --css=<file>  inject this CSS after load (A/B a stylesheet rule)
//   --nodelay     rewrite the live document so WP Rocket's "Delay JavaScript
//                 execution" is undone (scripts load as authored): A/B for it
//   --undelay=<keyword>  un-delay only the scripts containing <keyword>: what
//                 adding it to WP Rocket's Delay JS exclusions would do
//   --serve=<substring>=<file>,...  answer any request whose URL contains
//                 <substring> with a local file (test a rebuilt bundle or
//                 stylesheet on the live page before deploying it)
//   --eval=<js>   evaluate an expression after load (and --css) and print it
//   --long        list the longest individual scripts of the whole run
//   --after=<js>  evaluate an expression after the clicks and print it (check
//                 the interactions still did what they should)
//   --json        print the raw JSON report only
//   --trace       record a devtools timeline trace across the clicks and print
//                 style recalc (elements touched) / layout / paint per click
//
// Reads CHROMIUM from the environment; defaults to the Replit binary. Run with
// the Bash sandbox OFF (Chromium's children die inside it). Lab numbers on
// this box are slower than a real phone's in absolute terms; compare runs.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, mode = "mobile", ...rest] = process.argv.slice(2);
if (!url) {
  console.error('usage: node scripts/inp-probe.mjs <url> [mobile|desktop] --click="sel|sel"');
  process.exit(2);
}
const opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const clicks = (opt("click") ?? "BODY").split("|").map((s) => s.trim()).filter(Boolean);
const settle = Number(opt("settle") ?? 6000);
const early = rest.includes("--early");
const mobile = mode === "mobile";
const cpu = Number(opt("cpu") ?? (mobile ? 4 : 1));
const blocked = (opt("block") ?? "").split(",").filter(Boolean);
const cssFile = opt("css");
const jsonOnly = rest.includes("--json");
const traceOn = rest.includes("--trace");
const noDelay = rest.includes("--nodelay");
// --undelay=<keyword>: un-delay only the scripts whose tag or inline body
// contains the keyword - what a WP Rocket Delay JS exclusion of it would do.
const unDelay = opt("undelay");
const serves = (opt("serve") ?? "").split(",").filter(Boolean).map((p) => {
  const i = p.lastIndexOf("=");
  return { match: p.slice(0, i), file: p.slice(i + 1) };
});

const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(
  process.env["CHROMIUM"] || "/repl/tools/bin/chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `inp-probe-${port}`)}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d));
process.on("exit", () => chrome.kill("SIGKILL"));

async function pageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chromium did not start: " + stderr.slice(-500));
}

const ws = new WebSocket(await pageWs());
await new Promise((res) => (ws.onopen = res));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Fetch.requestPaused") { void onPaused(msg.params); return; }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? rej(new Error(method + ": " + msg.error.message)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

// Observers go in before any page script runs, so load-time long frames and
// the very first interaction are both on the record.
const OBSERVE = `(() => {
  const d = (el) => {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = (el.getAttribute && el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    return s;
  };
  window.__inp = { ev: [], loaf: [], lt: [], raf: [] };
  // Main-thread time from the event to just after the next frame: input
  // delay + every handler + style/layout/paint. Unlike Event Timing it does
  // not wait on compositor presentation, which headless software rendering
  // sometimes withholds for seconds; read the two together.
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'input']) {
    addEventListener(type, (e) => {
      const t0 = e.timeStamp;
      requestAnimationFrame(() => setTimeout(() => window.__inp.raf.push({ type, target: d(e.target), t: t0, dur: performance.now() - t0 }), 0));
    }, { capture: true });
  }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__inp.ev.push({
      name: e.name, id: e.interactionId, start: e.startTime, dur: e.duration,
      delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart,
      pres: e.startTime + e.duration - e.processingEnd, target: d(e.target) }); })
      .observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__inp.loaf.push({
      start: e.startTime, dur: e.duration, block: e.blockingDuration,
      render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
      style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
      scripts: e.scripts.map((s) => ({ src: (s.sourceURL || '').replace(/\\?.*$/, ''), fn: s.sourceFunctionName,
        inv: s.invoker, type: s.invokerType, dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration) })) }); })
      .observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
})();`;

async function onPaused(p) {
  try {
    const hit = serves.find((s) => p.request.url.includes(s.match));
    if (hit) {
      const body = readFileSync(hit.file);
      const type = hit.file.endsWith(".css") ? "text/css" : "application/javascript";
      await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: "content-type", value: type }, { name: "access-control-allow-origin", value: "*" }],
        body: body.toString("base64") });
      return;
    }
    if (unDelay && p.resourceType === "Document" && p.responseStatusCode) {
      const r = await send("Fetch.getResponseBody", { requestId: p.requestId });
      let html = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
      html = html.replace(/<script type="text\/rocketlazyloadscript"([^>]*)>([\s\S]*?)<\/script>/g, (m0, a, body) =>
        (a + body).includes(unDelay)
          ? "<script" + a.replace(/data-rocket-type=/g, "type=").replace(/data-rocket-src=/g, "src=") + ">" + body + "</script>"
          : m0);
      await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: p.responseStatusCode,
        responseHeaders: (p.responseHeaders || []).filter((h) => !/content-(length|encoding)/i.test(h.name)),
        body: Buffer.from(html).toString("base64") });
      return;
    }
    if (noDelay && p.resourceType === "Document" && p.responseStatusCode) {
      const r = await send("Fetch.getResponseBody", { requestId: p.requestId });
      let html = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
      html = html
        .replace(/<script type="text\/rocketlazyloadscript"([^>]*)>/g, (m0, a) =>
          "<script" + a.replace(/data-rocket-type=/g, "type=").replace(/data-rocket-src=/g, "src=") + ">")
        .replace(/RocketLazyLoadScripts\.run\(\)/g, "void 0");
      await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: p.responseStatusCode,
        responseHeaders: (p.responseHeaders || []).filter((h) => !/content-(length|encoding)/i.test(h.name)),
        body: Buffer.from(html).toString("base64") });
      return;
    }
    await send("Fetch.continueRequest", { requestId: p.requestId });
  } catch (e) {
    try { await send("Fetch.continueRequest", { requestId: p.requestId }); } catch {}
  }
}

const patterns = [];
if (noDelay || unDelay) patterns.push({ urlPattern: "*", resourceType: "Document", requestStage: "Response" });
for (const s of serves) patterns.push({ urlPattern: `*${s.match}*`, requestStage: "Request" });
if (patterns.length) await send("Fetch.enable", { patterns });
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: false });
if (blocked.length) await send("Network.setBlockedURLs", { urls: blocked });
await send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
await send("Emulation.setDeviceMetricsOverride", mobile
  ? { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }
  : { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", {
  userAgent: mobile
    ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});
if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu });

const t0 = Date.now();
await send("Page.navigate", { url });
const waitFor = async (method, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (events.some((e) => e.method === method)) return true;
    await sleep(100);
  }
  return false;
};
await waitFor("Page.domContentEventFired", 30000);
const dcl = Date.now() - t0;
if (early) await sleep(1500);
else {
  await waitFor("Page.loadEventFired", 30000);
  await sleep(settle);
}
if (cssFile) {
  const css = readFileSync(cssFile, "utf8");
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
  await sleep(500);
}
const domSize = await evaluate("document.getElementsByTagName('*').length");
const evalExpr = opt("eval");
if (evalExpr) console.log("  eval:", JSON.stringify(await evaluate(evalExpr)));
const sheetRules = await evaluate(`(() => { let n = 0; for (const s of document.styleSheets) { try { n += s.cssRules.length; } catch (e) {} } return n; })()`);

const tap = async (x, y) => {
  if (mobile) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(60);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
};

const traceEvents = [];
if (traceOn) {
  await send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
}
const done = [];
for (const raw of clicks) {
  // "type:<css>=<text>" focuses the field and types the text one key at a time.
  const typed = raw.match(/^type:(.+?)=(.*)$/);
  if (typed) {
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(typed[1])}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); return true; })()`);
    if (!ok) { done.push({ sel: raw, missing: true }); continue; }
    await sleep(500);
    for (const ch of typed[2]) {
      const at = await evaluate("performance.now()");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      done.push({ sel: `${raw} [${ch}]`, at });
      await sleep(180);
    }
    await sleep(1200);
    continue;
  }
  const m = raw.match(/^(.*?)\s+@(\d+)$/);
  const sel = m ? m[1] : raw;
  const nth = m ? Number(m[2]) : 0;
  const box = await evaluate(`(() => {
    let els = ${sel === "BODY" ? `Array.from(document.querySelectorAll('p')).filter(p => p.textContent.trim().length > 60 && !p.closest('a,button,summary,label'))` : `Array.from(document.querySelectorAll(${JSON.stringify(sel)}))`};
    els = els.filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; });
    const el = els[${nth}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  if (!box) { done.push({ sel: raw, missing: true }); continue; }
  await sleep(700);
  const pt = await evaluate(`(() => {
    let els = ${sel === "BODY" ? `Array.from(document.querySelectorAll('p')).filter(p => p.textContent.trim().length > 60 && !p.closest('a,button,summary,label'))` : `Array.from(document.querySelectorAll(${JSON.stringify(sel)}))`};
    els = els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const r = els[${nth}].getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + r.height / 2) };
  })()`);
  const before = await evaluate("performance.now()");
  await tap(pt.x, pt.y);
  await sleep(1500);
  done.push({ sel: raw, at: before });
}
await sleep(1000);
const afterExpr = opt("after");
if (afterExpr) console.log("  after:", JSON.stringify(await evaluate(afterExpr)));
let traceSummary = [];
if (traceOn) {
  await send("Tracing.end");
  for (let i = 0; i < 100 && !events.some((e) => e.method === "Tracing.tracingComplete"); i++) await sleep(200);
  for (const e of events) if (e.method === "Tracing.dataCollected") traceEvents.push(...e.params.value);
  if (opt("trace-out")) (await import("node:fs")).writeFileSync(opt("trace-out"), JSON.stringify({ traceEvents }));
  const main = traceEvents.filter((e) => e.ph === "X" && ["UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "EventDispatch", "FunctionCall", "ParseHTML", "RecalculateStyles", "RasterTask", "ImageDecodeTask", "Decode Image", "GPUTask"].includes(e.name));
  const inputs = traceEvents.filter((e) => e.name === "EventDispatch" && e.args?.data?.type === "click").sort((a, b) => a.ts - b.ts);
  traceSummary = inputs.map((c, i) => {
    const endTs = inputs[i + 1] ? inputs[i + 1].ts - 200000 : Infinity;
    const win = main.filter((e) => e.ts >= c.ts - 300000 && e.ts < Math.min(c.ts + 1200000, endTs));
    const sum = (n) => Math.round(win.filter((e) => e.name === n).reduce((a, e) => a + (e.dur || 0), 0) / 1000);
    const styles = win.filter((e) => e.name === "UpdateLayoutTree").sort((a, b) => b.dur - a.dur).slice(0, 3)
      .map((e) => `${Math.round(e.dur / 1000)}ms/${e.args?.elementCount ?? "?"}el`);
    const layouts = win.filter((e) => e.name === "Layout").sort((a, b) => b.dur - a.dur).slice(0, 2)
      .map((e) => `${Math.round(e.dur / 1000)}ms/${e.args?.beginData?.dirtyObjects ?? "?"}of${e.args?.beginData?.totalObjects ?? "?"}`);
    return `click ${i + 1}: style ${sum("UpdateLayoutTree")}ms [${styles.join(", ")}]  layout ${sum("Layout")}ms [${layouts.join(", ")}]  prepaint ${sum("PrePaint")}ms  paint ${sum("Paint")}ms  layerize ${sum("Layerize")}ms  raster ${sum("RasterTask")}ms  decode ${sum("ImageDecodeTask") + sum("Decode Image")}ms  gpu ${sum("GPUTask")}ms`;
  });
}
const data = await evaluate("JSON.stringify(window.__inp)");
const rep = JSON.parse(data || '{"ev":[],"loaf":[]}');

// Group event entries into interactions (INP = the worst one's duration).
const byId = new Map();
for (const e of rep.ev) {
  const cur = byId.get(e.id);
  if (!cur || e.dur > cur.dur) byId.set(e.id, e);
}
const interactions = [...byId.values()].sort((a, b) => a.start - b.start).map((e) => {
  const end = e.start + e.dur;
  const frames = rep.loaf.filter((f) => f.start < end && f.start + f.dur > e.start - 50);
  const scripts = frames.flatMap((f) => f.scripts).filter((s) => s.dur >= 5).sort((a, b) => b.dur - a.dur).slice(0, 6);
  const click = [...done].reverse().find((c) => c.at && c.at <= e.start + 5);
  const raf = Math.round(Math.max(0, ...rep.raf.filter((r) => r.t >= e.start - 120 && r.t <= e.start + e.dur).map((r) => r.dur)));
  return {
    click: click?.sel ?? "(load)",
    raf,
    target: e.target,
    event: e.name,
    inp: Math.round(e.dur),
    inputDelay: Math.round(e.delay),
    processing: Math.round(e.proc),
    presentation: Math.round(e.pres),
    frameStyleLayout: Math.round(Math.max(0, ...frames.map((f) => f.style))),
    scripts,
  };
});
const loadFrames = rep.loaf.filter((f) => f.block > 0);
const loadBlocking = Math.round(loadFrames.reduce((a, f) => a + f.block, 0));
const topLoad = Object.entries(
  rep.loaf.flatMap((f) => f.scripts).reduce((acc, s) => {
    const k = (s.src || s.inv || "?").replace(/^https?:\/\//, "").slice(0, 90);
    acc[k] = (acc[k] || 0) + s.dur;
    return acc;
  }, {}),
).sort((a, b) => b[1] - a[1]).slice(0, 10);
// Taps whose main-thread cost was over budget but whose Event Timing entry
// never arrived (or arrived small) still get reported from the rAF metric.
for (const c of done.filter((d) => d.at)) {
  const next = done.find((d) => d.at && d.at > c.at)?.at ?? Infinity;
  const mine = rep.raf.filter((r) => r.t >= c.at - 5 && r.t < next);
  if (!mine.length || interactions.some((i) => i.click === c.sel)) continue;
  interactions.push({ click: c.sel, raf: Math.round(Math.max(...mine.map((r) => r.dur))), target: mine[0].target, event: "(raf only)", inp: 0, inputDelay: 0, processing: 0, presentation: 0, frameStyleLayout: 0, scripts: [] });
}
const longScripts = rep.loaf.flatMap((f) => f.scripts.map((sc) => ({ ...sc, at: Math.round(f.start) })))
  .filter((sc) => sc.dur >= 30).sort((a, b) => b.dur - a.dur).slice(0, 12)
  .map((sc) => `${sc.dur}ms @${sc.at} ${sc.type}:${(sc.inv || "").slice(0, 60)} ${sc.fn || ""} ${sc.src.split("/").pop()}${sc.forced ? " forced=" + sc.forced : ""}`);
const report = {
  url, mode, cpu, longScripts, dcl, domSize, sheetRules,
  missing: done.filter((d) => d.missing).map((d) => d.sel),
  inp: Math.max(0, ...interactions.map((i) => i.inp)),
  rafWorst: Math.max(0, ...interactions.map((i) => i.raf)),
  interactions,
  longFrames: rep.loaf.length, totalBlocking: loadBlocking, scriptTimeBySource: topLoad,
};
if (jsonOnly) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`${url} [${mode} cpu x${cpu}] DOM ${domSize} nodes, ${sheetRules} CSS rules, DCL ${dcl}ms`);
  console.log(`  long frames ${report.longFrames}, blocking ${loadBlocking}ms; worst interaction ${report.inp}ms (main-thread to next frame: ${report.rafWorst}ms)`);
  if (report.missing.length) console.log("  not found:", report.missing.join(" | "));
  for (const i of interactions)
    console.log(`  ${String(i.inp).padStart(4)}ms raf ${String(i.raf).padStart(4)}  delay ${String(i.inputDelay).padStart(3)} proc ${String(i.processing).padStart(3)} pres ${String(i.presentation).padStart(3)} (style/layout ${i.frameStyleLayout})  ${i.event} ${i.target}  <- ${i.click}` +
      (i.scripts.length ? "\n        " + i.scripts.map((s) => `${s.dur}ms ${s.type}:${(s.inv || "").slice(0, 50)} ${s.src.split("/").pop()}${s.forced ? ` forced=${s.forced}` : ""}`).join("\n        ") : ""));
  for (const t of traceSummary) console.log("  trace " + t);
  if (rest.includes("--long")) for (const l of longScripts) console.log("  long " + l);
  console.log("  script time by source:", topLoad.map(([k, v]) => `${k.split("/").pop() || k} ${v}ms`).join(", "));
}
ws.close();
process.exit(0);
