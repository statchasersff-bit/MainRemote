=== StatChasers — Rookie Hit Rates ===
Contributors: statchasers
Tags: fantasy football, dynasty, analytics, shortcode, embed
Requires at least: 5.0
Tested up to: 6.5
Requires PHP: 7.0
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embed the StatChasers Rookie Hit Rates dynasty analytics tool with a shortcode.

== Description ==

Drop the interactive Rookie Hit Rates tool into any page, post, or "Code" module
with a single shortcode:

    [rookie_hit_rates]

The entire application (charts, filters, data) is bundled with the plugin and runs
in an isolated iframe, so it never conflicts with your theme's CSS or JavaScript.
No external server, database, or API is required — all data ships inside the plugin.

= Shortcode attributes =

* `height` — initial iframe height in px before auto-resize (default 1400)
* `min_height` — minimum iframe height in px (default 600)
* `max_width` — max embed width in px, centered (default 1380; use 0 for full width)

Example:

    [rookie_hit_rates height="1500" max_width="0"]

The iframe automatically resizes to fit the tool's content as you switch tabs.

== Installation ==

1. In WordPress admin go to Plugins > Add New > Upload Plugin.
2. Choose statchasers-rookie-hit-rates.zip and click Install Now.
3. Activate the plugin.
4. Add [rookie_hit_rates] to any page, post, or Code module.

== Changelog ==

= 1.1.0 =
* Prints a "How We Count a Hit" methodology section and a hit-rate-by-position
  table in the page itself, under the tool, from summary/hit-rates-summary.json.
  The summary is computed at build time by the tool's own calculation from the
  bundled app/data CSVs (script/build-wp-summary.mjs, step 4 of
  script/build-wp-plugin.sh), so it needs no request or calculation per page
  view. With JavaScript off the
  iframe is hidden and the section remains. `summary="0"` leaves it out.
* Data: every rookie now links to all of his seasons (player-id-links.json:
  name-variant aliases, Frank Gore Jr. split from his father's id, Mark
  Walton's 2018-2019 seasons added).

= 1.0.0 =
* Initial release.
