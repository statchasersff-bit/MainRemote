=== StatChasers ===
Contributors: statchasers
Requires at least: 6.3
Requires PHP: 7.4
Stable tag: 1.6.0
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
