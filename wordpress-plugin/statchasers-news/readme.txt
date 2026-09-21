=== StatChasers ===
Contributors: statchasers
Requires at least: 6.3
Requires PHP: 7.4
Stable tag: 1.7.4
License: GPL-2.0-or-later

Mounts the StatChasers NFL news tool, the 32 team hubs, the player pages, the Fantasy Points Allowed table and the redraft rankings into WordPress pages.

== Why this file exists ==

WordPress reads the plugin version from the PHP header, and PHP files execute
rather than serve — so from outside the server there is no way to tell which
version is actually on disk. This file is served as-is, so

    https://<site>/wp-content/plugins/statchasers-news/readme.txt

answers that question directly, with a Last-Modified header that says when the
upload landed. Keep "Stable tag" in step with the Version header.

== Changelog ==

= 1.7.4 =
* The "print a heading only when the theme prints none" check is now taken per page type. It was one measurement, taken on a team hub and applied to player and matchup pages as well, so a site whose hub title comes from a builder layout and whose player pages get their title from the theme's template printed two H1s on every player page — the theme's plain one and the tool's designed one — on the one setting meant to prevent exactly that. A page type with no measurement of its own now prints nothing rather than borrowing the hub's answer. Re-run the check on Tools -> StatChasers Pages after updating.

= 1.7.3 =
* The team index page at /nfl/teams/ prints the grid of 32 hubs even when nothing on the page mounts it, and loads the hub stylesheet while doing it. Exactly the 1.7.2 fix, on the other container: a page built in a page builder is neither empty nor the old stub, so the build left it alone and the parent of the 32 hubs shipped as a paragraph and 32 bullets in the theme's list styling.

= 1.7.2 =
* The player index page at /nfl/players/ prints the roster even when nothing on the page mounts it. The build only writes the shortcode into a container that is empty or still carrying the old stub, so a container built in a page builder kept its heading and its paragraph and showed no players at all.

= 1.7.1 =
* The generated page heading lines up with the tool beneath it. It sat in the hero module's centred shell while the embedded fragment ran flush to the container, so on a layout wider than the site's content width the H1 started well to the right of the tool it heads.

= 1.7.0 =
* Tools -> StatChasers Pages now builds the player profile pages as well, in resumable batches of 25, and the matchup holder page beside them.
* Page headings: the plugin fetches one published page and counts its H1 elements, then prints its own heading only on a template that prints none. Re-checked on a theme switch; overridable from the same screen.
* An H1 on every matchup URL. One holder page serves 496 addresses and they all used to share the holder's heading.
* Team section URLs, player section URLs and matchup pair URLs are on by default, with the permalink flush done on activation instead of by hand.
* The team News tab has a public address, /nfl/teams/<team>/news/, like the other five.

= 1.6.0 =
* [statchasers_rankings]: the redraft rankings board, ported from the standalone Redraft-Rankings-table app. All five position panels are server-rendered into the page, not filled in by React after load.

= 1.3.1 =
* Renamed from "StatChasers News" to "StatChasers" — the plugin has carried the team hubs as well as the news tool since 1.0.0, and the old name sent people looking for a second plugin that does not exist.

= 1.3.0 =
* Tools -> StatChasers Team Pages: one button creates all 32 team hub pages.
* Admin notice while pages are missing.

= 1.2.0 =
* Force Divi's full-width layout on pages mounting the team hub.

= 1.1.0 =
* Same, first attempt (body class only; not sufficient on its own).

= 1.0.0 =
* Initial release.
