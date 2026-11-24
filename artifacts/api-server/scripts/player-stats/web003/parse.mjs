// Read a stats page: week range, updated date, and one player's games + FPTS.
export function readStats(html, name) {
  const weeks = (html.match(/<span>Weeks ([0-9]+–[0-9]+)<\/span>/) || [])[1] ?? null;
  const updated = (html.match(/sca-meta-updated">Updated <time datetime="([^"]+)">([^<]+)/) || []).slice(1, 3);
  const thead = (html.match(/<thead[\s\S]*?<\/thead>/) || [""])[0];
  const keys = [...thead.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  const rows = (html.match(/<tr class="sca-row/g) || []).length;
  let player = null;
  const at = html.indexOf(`data-name="${name.toLowerCase()}"`);
  if (at >= 0) {
    const tr = html.slice(at, html.indexOf("</tr>", at));
    const cells = [...tr.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)].slice(1); // drop rank td
    const val = (k) => {
      const i = keys.indexOf(k);
      if (i < 0 || !cells[i]) return null;
      const ds = /data-sort="([^"]*)"/.exec(cells[i][2]);
      return ds ? ds[1] : cells[i][3].replace(/<[^>]+>/g, "").trim();
    };
    player = { games: (/data-games="([^"]*)"/.exec(tr) || [])[1], fpts: val("fantasyPoints") };
  }
  return { weeks, updated: updated[1] ?? null, rows, player };
}
