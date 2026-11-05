// Screenshots of the Contracts panel at the brief's widths: one wide window,
// the embed fragment mounted in a column of the set width (the WordPress case),
// plus full viewport runs. Sandbox OFF for chromium (memory: headless-chromium-verify).
import fs from "node:fs";
import { spawn } from "node:child_process";
import { startServer, APP_DIR } from "../tests/helpers/server.mjs";
const { origin, stop } = await startServer();
const slug = process.argv[2] ?? "cleveland-browns";
const outDir = process.argv[3] ?? "/tmp/claude-1000/-home-runner-workspace/14a06413-c28e-482d-b5d7-894aeeca6794/scratchpad/shots";
fs.mkdirSync(outDir, { recursive: true });
const widths = (process.argv[4] ?? "1536,1440,1200,1024,820,768,735,390").split(",").map(Number);
const html = await (await fetch(`${origin}/embed/team/${slug}?section=contracts`)).text();
// The hub fragment; keep only the contracts panel's premium block + the original for context.
fs.writeFileSync(`${outDir}/frag.html`, html);
for (const wpx of widths) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${origin}/team.css">
  <style>body{margin:0;background:#fff;font-family:Inter,system-ui,sans-serif} .col{width:${wpx}px;margin:0 auto;padding:12px 0} </style></head>
  <body><div class="col"><div class="sct" data-sct-root>${html}</div></div><script src="${origin}/dist/statchasers-team.js"></script>
  <script>document.addEventListener("DOMContentLoaded",()=>{setTimeout(()=>{const p=document.getElementById("contracts");if(p){p.hidden=false;for(const el of document.querySelectorAll("[data-sct-panel]")){el.hidden=el.id!=="contracts"}}
  const neu=document.querySelector(".sct-ctp"); if(neu){ for(const x of document.querySelectorAll(".sct-ct, .sct-tp, .sct-tpb, nav, header, .sct-cp-flag ~ *:not(.sct-ctp)")){} }
  const old=document.querySelector(".sct-ct"); if(old) old.style.display="none"; const h2=document.querySelector("#contracts > h2.sct-h2"); if(h2) h2.style.display="none";
  const top=document.querySelector(".sct-ctp"); if(top){ let n=top.closest("#contracts"); if(n){ const kids=[...n.parentElement.children]; for(const k of kids){ if(k!==n) k.style.display="none"; } let a=n.parentElement; while(a && a!==document.body){ for(const s of [...a.parentElement.children]){ if(s!==a && !s.contains(a)) s.style.display="none"; } a=a.parentElement; } } }
  },50)});</script></body></html>`;
  const file = `${outDir}/page-${wpx}.html`;
  fs.writeFileSync(file, page);
  const winW = Math.max(wpx + 40, 1600);
  await new Promise((resolve) => {
    const c = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--screenshot=${outDir}/contracts-${wpx}.png`, "--virtual-time-budget=6000", `--window-size=${winW},2400`, "--blink-settings=imagesEnabled=true", `file://${file}`], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => (err += d));
    c.on("exit", () => { console.log(wpx, "done", fs.existsSync(`${outDir}/contracts-${wpx}.png`) ? "" : err.slice(-300)); resolve(); });
  });
}
await stop();
