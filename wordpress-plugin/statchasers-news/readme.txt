=== StatChasers ===
Contributors: statchasers
Requires at least: 6.3
Requires PHP: 7.4
Stable tag: 1.9.4
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

= 1.9.4 =
* The schedule's heading now lines up with the board on desktop. 1.9.3 had it print the site's hero in the "Let the tool supply the heading" mode, but the rule that holds a generated hero flush with the tool beneath it — undoing the hand-built hero's side padding and its centred, max-width inner shell — was still printed only in the modes where the plugin normally prints a heading. So on a wide screen the heading sat inset from the board, and a Custom CSS override on the padding alone could not reach the centring. Plugin only.

= 1.9.3 =
* The NFL schedule's heading now wears the site's own hero — the serif H1, the gold rule and the standfirst — in the "Let the tool supply the heading" mode. That mode empties the theme's title and asks each tool for its heading; the team hubs and player pages answer with a section heading already in the site's style, but the schedule answered with its source repo's Space Grotesk title, which read as a second design at the top of the page. It now prints the same `sc-lo-hero` markup the plugin prints in the other modes, and never asks the API for `?h1=1`. The standfirst carries the season again ("View the full 2026 NFL schedule…"), read off the board, so it says what the API's own page says. Plugin only; no API deploy needed.

= 1.9.2 =
* The NFL schedule's questions now reach the page's structured data. The fragment has carried them as an inert payload since the weekly board got a FAQ, and this file was the one of the six tools with nothing to lift it — so the answers shipped as visible prose and as a dead JSON island, and never as a FAQPage node. They are lifted into Rank Math's graph and stripped before printing now, the same arrangement the team hubs, the rankings board and the FPA table already use. Unlike those three, which question set gets described depends on what the page mounts: the shortcode's own attributes are read off the post before the head is built, so the bare schedule page is described by the season grid's questions and `/nfl/nfl-schedule/week-7/` by week 7's. Needs the matching API deploy.
* Every game on the weekly board now has a link to the two clubs' own matchup page, in a column of its own at the end of the row. A game the pair's page has stopped leading with is linked at its dated address rather than at the pair, so a reader opening Week 3 in December lands on Week 3's game. `SC_MATCHUP_PATH_PREFIX` on the API deployment decides where those links point; its default is already this plugin's `/nfl/<a>-vs-<b>/`. API side.
* The season grid gets its own FAQ and its own heading. The board is titled "2026 NFL Schedule Grid — All 32 Teams, Weeks 1–18" with a sentence under it saying what it is, and the questions below it answer what the grid is asked: how to read a row, what the @ means, where the byes are, how many weeks and games the season holds. Every number in them is counted off the slate rather than written in, and the count questions are withheld entirely when the feed is only part loaded. API side.

= 1.9.1 =
* The 4px side gutter a phone reads the tools through now reaches the team hubs, which were still running edge to edge after 1.9.0 shipped it. The gutter was on `.container`, and a page that has been through the Divi Builder does not have one: Divi's page.php prints the `.container` / `#content-area` / `#left-area` wrappers only when the builder is unused, so on the hubs every rule naming those elements was addressed to nothing. It is on `#main-content` now — the one wrapper a plain page, a builder page and a Theme Builder body layout all print — and `.container` gives its own gutter up rather than adding a second one on the pages that do have both. Measured on the real hub fragment under both page shapes: 4px a side on each, at every width below 981px, with no change above it.

= 1.9.0 =
* Changing scoring format or view on the Fantasy Points Allowed table no longer changes the page's address. The Scoring and View controls are still ordinary links — a crawler follows them, a middle-click still opens the combination that was asked for — but the bundle now intercepts the click, fetches that combination and swaps the table in place, writing nothing to the URL and pushing nothing onto the history stack. Six renderings of one table are one page, which is what the canonical has always said. The legend and the FAQ are left alone by a swap, so a question a reader has opened stays open.
* The same controls now work with scripting off, which they did not. The links carry the combination in a query string, and the shortcode read only its own attributes — so a reader who clicked PPR inside a WordPress page was sent to a URL that rendered the DEFAULT table, a control that appears to work and does not. `?format=` and `?view=` are now read off the URL, validated against the three formats and two views and dropped rather than corrected if they are anything else. An attribute you write still outranks them: a page carrying format="ppr" has decided what it shows.
* The Fantasy Points Allowed FAQ is rewritten around the questions people actually search — "which teams allow the most fantasy points to RBs", "what does FPA mean in fantasy football", "is a higher number better" — and the page now carries a FAQPage node built from the same list it renders, so the questions are not merely on the page but described to a crawler. On a WordPress mount the questions arrive as an inert payload that the plugin lifts into Rank Math's graph and strips before printing, so what ships is one <script> holding one graph, the same arrangement the team hubs and the rankings board already use. Needs the matching API deploy.

= 1.8.2 =
* Every tool sits in the site's own content column. `#left-area { width: 100% }` takes back the column Divi reserves for a sidebar nobody filled — but Divi also widens the content container on any page that has been opened in the Divi Builder, so that a full-width section can bleed to the window. A tool is not a section, it is page content, so on those pages "the whole column" meant the whole screen: the team hubs rendered around 1800px wide while the player pages, carrying the same stylesheet on pages that had not been through the builder, sat in the ordinary column. The width is now capped at the site's own content width, read from Divi's Customizer setting rather than written down, so the tools line up with every hand-built row on the site. Override with the `statchasers_content_width` filter on a theme that cannot be asked.
* The matchup holder page is built where the pair URLs actually look for it. It was created under the team hubs' container, at /nfl/teams/matchup/, while every rewrite rule and every filter in the plugin addresses it as /nfl/matchup/ — so all 496 pair URLs resolved to no page, and WordPress's own 404 guess then matched the stray page by its slug and sent the reader to it. What that looked like from the front end: "View matchup" on a team hub landed on a page saying it was the holder and rendered nothing. The Tools screen could not see the problem either, because the builder looked under one parent and the panel under the other, so pressing "Create the holder page" reported success and changed nothing. The screen now detects a holder at the wrong address and offers to move it, an admin notice says so from any screen, and the build rebuilds the permalinks itself.

= 1.8.1 =
* "Let the tool supply the heading" now covers team hubs as well as player pages. A hub section address printed its phrase twice the same way — the theme's page title above, the panel's own heading with the gold rule below it — and the hub answers to it on the same terms: the theme's title is emptied and the panel the page opens on has its heading promoted to the page's H1. A hub panel carries several headings and only the one it opens with is promoted, so a section page and the whole hub both carry exactly one H1. Needs the matching API deploy.

= 1.8.0 =
* New heading mode: "Let the tool supply the heading". A player section page printed its phrase twice — once as the theme's page title in its own serif, once as the tool's section heading with the gold rule under it, saying the same words a few hundred pixels apart. This mode empties the theme's title and asks the API for the promoted markup, so the heading a reader can see IS the page's H1, in the tool's own type. Exactly one panel is promoted, so a section page and the all-tabs page both carry a single H1. Player pages only; the other tools are unaffected. Needs the matching API deploy.

= 1.7.7 =
* A page builder's wrapper is no longer mistaken for somebody's own arrangement. Opening the generated container body in Divi wraps the same words in [et_pb_section] and friends, and the "does this page carry a shortcode" test read that packaging as intent — so /nfl/teams/ reported as a hand-written page and was left alone. The same wrapper is why the grid printed below everything else: the_content appends after the closing [/et_pb_section], outside every section the builder laid out. Builder tags are now told apart from real mounts, the rebuild removes the wrapper along with the body it holds, and the Index pages panel names the shortcodes it found instead of only saying there were some.

= 1.7.6 =
* The container pages are recognised after a block editor has been near them. Recognition counted only root-relative, double-quoted links (`href="/nfl/teams/`), which is how the build writes them and not how they come back from WonderBlocks, Gutenberg or Divi — those rewrite them to absolute URLs on save, the count fell to zero, and /nfl/teams/ reported as a hand-written page and was left alone through two releases while the theme printed its wall of links and the plugin appended the real grid underneath. Absolute and single-quoted links now count, a bracket in prose is no longer mistaken for a shortcode, and the Index pages panel prints what it looked at whenever it declines to touch a container.

= 1.7.5 =
* Tools -> StatChasers Pages gains an "Index pages" panel with a rebuild button. Mounting the grid on the two container pages at /nfl/teams/ and /nfl/players/ was only ever done at the end of a page build, and the build button is only offered while pages are missing — so on a site where all 32 hubs already existed the screen said "Nothing to do" and a container still carrying the old list of 32 links had no way left to be fixed. The panel now names the state of each container and writes only the two it should: an empty body, or the generated stub. A page you have edited yourself is never touched.

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
