# Route test harness

Executes the plugin's routing code (`SCDC_Route`, `SCDC_Rewrite`,
`SCDC_Shortcode`) against a small set of WordPress stubs, so the *initial
server response* for any URL can be inspected without a WordPress install.

```bash
./run-tests.sh                                              # full sweep
php render-url.php /nfl/nfl-depth-charts/fantasy/dallas-cowboys/   # a 301
php render-url.php /nfl/nfl-depth-charts/ body                      # full markup
```

- `wp-stubs.php` - minimal shims (hooks, escaping, options, permalinks). The
  simulated site is `https://statchasers.com`, the tool page is
  `/nfl/nfl-depth-charts/` (ID 42) under an `/nfl/` parent (ID 7).
- `render-url.php` - simulates the rewrite rules, runs the request lifecycle
  (`parse_request` → `wp` → `template_redirect`), then prints the status (or the
  301 and where it goes), the route and the server-rendered markup.
- `checks.php` - the assertions: the 301s and 404s, the refresh, the store, the
  lock, the push, the scrapers and the hub.
- `fixtures/statchasers/depth-charts.json` - three teams of sample cached data.

This is a harness, not the live site: it proves the plugin's own logic. After
deploying, run `verify-live.sh` for the real responses.
