/**
 * Release gate (2026-11-19): one scoring model across pages, under the
 * deployed setting (SC_SCORING_TOTALS=house) and the rollback (unset).
 *
 * A team hub's Key Offensive Contributors row and the player's own page must
 * agree on games and fantasy points per game for the same season and format
 * (the overview is PPR only). A traded player's team row is team-specific by
 * design, so the check covers players whose season is with one club.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

const TEAMS = ["det", "lv", "sea", "min", "kc"];

async function body(origin, path) {
  const res = await fetch(origin + path, { redirect: "follow", headers: { connection: "close" } });
  return { status: res.status, text: await res.text() };
}

function contributors(html) {
  const out = [];
  const re = /href="https:\/\/statchasers\.com\/nfl\/players\/([^/]+)\/"[^>]*>[^<]+<\/a>(?:(?!<\/li>)[\s\S])*?sct-ovw-ppg"><b>([\d.]+)<\/b><span>PPR\/G<\/span><span class="sct-ovw-gp">(\d+) G/g;
  for (const m of html.matchAll(re)) out.push({ slug: m[1], ppg: Number(m[2]), games: Number(m[3]) });
  return out;
}

function hub(html) {
  const ppg = /<b>([\d.]+)<\/b><abbr title="[^"]*">FPPG/.exec(html);
  const gp = /<abbr title="Games played">GP<\/abbr><\/dt><dd>(\d+)<\/dd>/.exec(html);
  return { ppg: ppg ? Number(ppg[1]) : null, games: gp ? Number(gp[1]) : null };
}

for (const policy of ["house", "provider"]) {
  describe(`team overview = player page (SC_SCORING_TOTALS=${policy})`, () => {
    let server;
    before(async () => {
      server = await startServer(policy === "house" ? { SC_SCORING_TOTALS: "house" } : { SC_SCORING_TOTALS: "" });
    });
    after(async () => server && (await server.stop()));

    test("every contributor's G and PPR/G equal the player's own GP and FPPG", async () => {
      let checked = 0;
      for (const team of TEAMS) {
        const page = await body(server.origin, `/team/${team}`);
        assert.equal(page.status, 200, team);
        const rows = contributors(page.text);
        assert.ok(rows.length >= 4, `${team}: contributors found`);
        for (const r of rows) {
          const p = hub((await body(server.origin, `/player/${r.slug}`)).text);
          if (p.games === null) continue;
          assert.equal(r.games, p.games, `${team} ${r.slug}: games`);
          assert.equal(r.ppg, p.ppg, `${team} ${r.slug}: PPR/G`);
          checked++;
        }
      }
      assert.ok(checked >= 20, `checked ${checked}`);
    });
  });
}

describe("team overview injuries = player pages' current status", () => {
  let server;
  before(async () => {
    server = await startServer({ SC_SCORING_TOTALS: "house" });
  });
  after(async () => server && (await server.stop()));

  test("no overview row shows a game designation the player's own page has expired", async () => {
    const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    let rows = 0;
    for (const team of ["det", "lv", "sea", "min", "kc", "lar", "chi", "bal"]) {
      const html = (await body(server.origin, `/team/${team}`)).text;
      const list = /<ul class="sct-ovw-inj-list">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
      for (const li of list.matchAll(/<li class="sct-ovw-inj-row">([\s\S]*?)<\/li>/g)) {
        const slug = /\/nfl\/players\/([^/]+)\//.exec(li[1])?.[1];
        const status = /sct-ovw-status"[^>]*>([^<]*)</.exec(li[1])?.[1]?.trim().toLowerCase();
        if (!slug || !status) continue;
        rows++;
        if (["questionable", "doubtful", "out"].includes(status)) {
          const page = strip((await body(server.origin, `/player/${slug}/injury`)).text);
          assert.doesNotMatch(page, /No injury designation for Week/, `${team} ${slug}: overview says ${status}`);
        }
      }
    }
    assert.ok(rows > 0, "some injury rows checked");
  });

  test("the overview FAQ's injury answer names exactly the panel's players", async () => {
    for (const team of ["det", "lv", "sea", "min", "kc", "lar", "chi", "bal"]) {
      const html = (await body(server.origin, `/team/${team}`)).text;
      const list = /<ul class="sct-ovw-inj-list">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
      // The name element, a link or plain text when the player has no page.
      const panel = [...list.matchAll(/class="[^"]*sct-ovw-inj-name[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
      let answer = "";
      for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const j = JSON.parse(b[1]);
        for (const x of j["@graph"] ?? [j]) {
          if (x["@type"] !== "FAQPage") continue;
          for (const q of x.mainEntity ?? []) if (/injured right now/.test(q.name)) answer = q.acceptedAnswer.text;
        }
      }
      if (!panel.length) {
        assert.doesNotMatch(answer, /On the current injury report/, `${team}: FAQ lists injuries the panel does not`);
        continue;
      }
      for (const name of panel.slice(0, 6)) assert.ok(answer.includes(name), `${team}: FAQ omits ${name}`);
      const named = [...answer.matchAll(/([A-Z][\w.'-]+(?: [A-Z][\w.'-]+)+) \((?:QB|RB|WR|TE|K)/g)].map((m) => m[1]);
      for (const n of named) assert.ok(panel.includes(n), `${team}: FAQ names ${n}, not in the panel`);
    }
  });
});

describe("scoring audit endpoint access", () => {
  test("production with no key configured: 404", async () => {
    const s = await startServer({ NODE_ENV: "production", SC_AUDIT_KEY: "" });
    try {
      const r = await body(s.origin, "/api/scoring/audit?player=kirk-cousins&season=2021");
      assert.equal(r.status, 404);
    } finally {
      await s.stop();
    }
  });

  test("no NODE_ENV (how the deployment starts) and no key: 404; development: open", async () => {
    const s = await startServer({ NODE_ENV: "", SC_AUDIT_KEY: "" });
    try {
      assert.equal((await body(s.origin, "/api/scoring/audit?player=kirk-cousins&season=2021")).status, 404);
    } finally {
      await s.stop();
    }
    const d = await startServer({ NODE_ENV: "development", SC_AUDIT_KEY: "" });
    try {
      assert.equal((await body(d.origin, "/api/scoring/audit?player=kirk-cousins&season=2021")).status, 200);
    } finally {
      await d.stop();
    }
  });

  test("with a key: 404 without it, 200 with it, and no data beyond the public pages", async () => {
    const s = await startServer({ SC_AUDIT_KEY: "test-audit-key" });
    try {
      assert.equal((await body(s.origin, "/api/scoring/audit?player=kirk-cousins&season=2021")).status, 404);
      const res = await fetch(`${s.origin}/api/scoring/audit?player=kirk-cousins&season=2021`, { headers: { "x-sc-audit-key": "test-audit-key", connection: "close" } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
      const j = await res.json();
      assert.deepEqual(Object.keys(j).sort(), ["displayed", "games", "player", "season", "totals"]);
      assert.deepEqual(Object.keys(j.player).sort(), ["name", "position", "slug"]);
      assert.equal(j.totals.ppr.provider, 295.34);
      assert.equal(j.totals.ppr.house, 307.34);
    } finally {
      await s.stop();
    }
  });
});
