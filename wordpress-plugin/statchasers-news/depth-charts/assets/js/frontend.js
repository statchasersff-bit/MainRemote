/* StatChasers Depth Charts - front-end renderer.
   Reads the locally cached JSON (data-endpoint) and renders the depth-chart UI:
   Fantasy / Offense / Defense / Special Teams tabs, search, team + position
   filters, and a responsive grid that packs more teams per row as columns shrink.
   Renders only from the cached file in /uploads; no external calls. */
(function () {
	"use strict";

	// `key` is the JSON positions[] key; `slug` is the clean URL segment. The
	// Fantasy tab reads its dedicated FAN_* columns but keeps simple
	// position slugs (qb/rb/…) in the URL.
	var TABS = {
		fantasy: {
			label: "Fantasy",
			columns: [
				{ key: "FAN_QB", slug: "qb", label: "Quarterbacks", short: "QB" },
				{ key: "FAN_RB", slug: "rb", label: "Running Backs", short: "RB" },
				{ key: "FAN_WR", slug: "wr", label: "Wide Receivers", short: "WR" },
				{ key: "FAN_TE", slug: "te", label: "Tight Ends", short: "TE" },
				{ key: "FAN_K", slug: "k", label: "Kickers", short: "K" }
			]
		},
		offense: {
			label: "Offense",
			columns: [
				{ key: "QB", slug: "qb", label: "QB" },
				{ key: "RB", slug: "rb", label: "RB" },
				{ key: "WR", slug: "wr", label: "WR" },
				{ key: "TE", slug: "te", label: "TE" },
				{ key: "LT", slug: "lt", label: "LT" },
				{ key: "LG", slug: "lg", label: "LG" },
				{ key: "C", slug: "c", label: "C" },
				{ key: "RG", slug: "rg", label: "RG" },
				{ key: "RT", slug: "rt", label: "RT" }
			]
		},
		defense: {
			label: "Defense",
			columns: [
				{ key: "EDGE", slug: "edge", label: "EDGE" },
				{ key: "DL", slug: "dl", label: "DL" },
				{ key: "LB", slug: "lb", label: "LB" },
				{ key: "CB", slug: "cb", label: "CB" },
				{ key: "S", slug: "s", label: "S" }
			]
		},
		special: {
			label: "Special Teams",
			columns: [
				{ key: "K", slug: "k", label: "K" },
				{ key: "P", slug: "p", label: "P" },
				{ key: "LS", slug: "ls", label: "LS" },
				{ key: "KR", slug: "kr", label: "KR" },
				{ key: "PR", slug: "pr", label: "PR" }
			]
		}
	};
	var TAB_ORDER = ["fantasy", "offense", "defense", "special"];
	var COLUMN_WIDTH_REM = 11;

	// Color-coded position abbreviations in the search dropdown. Keyed by the base
	// position code (col.short || col.label || col.key); unlisted positions render
	// in a neutral gray.
	var POSITION_COLOR = {
		QB: "#dc2626", // red
		RB: "#16a34a", // green
		WR: "#2563eb", // blue
		TE: "#ca8a04", // yellow
		K: "#9333ea" // purple
	};

	// Normalize a player name for cross-position matching: lowercase, drop periods
	// and generational suffixes, collapse whitespace.
	function normNameKey(name) {
		var words = String(name)
			.toLowerCase()
			.replace(/[.']/g, "")
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
			.split(/\s+/);
		var suffixes = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
		while (words.length > 1 && suffixes[words[words.length - 1]]) words.pop();
		return words.join(" ");
	}

	// Pretty-URL view slugs <-> internal tab keys.
	var VIEW_TO_SLUG = {
		fantasy: "fantasy",
		offense: "offense",
		defense: "defense",
		special: "special-teams"
	};
	var SLUG_TO_VIEW = {
		fantasy: "fantasy",
		offense: "offense",
		defense: "defense",
		"special-teams": "special"
	};

	// "Buffalo Bills" -> "buffalo-bills"; "San Francisco 49ers" -> "san-francisco-49ers".
	function slugify(value) {
		return String(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	// Read a JSON data-attribute, falling back to `fallback` on anything unexpected.
	function jsonAttr(node, name, fallback) {
		var raw = node.getAttribute(name);
		if (!raw) return fallback;
		try {
			var parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : fallback;
		} catch (e) {
			return fallback;
		}
	}

	// Image props with the opt-outs the common lazy-load plugins honor. These
	// images are created after page load, and several optimizers still swap their
	// src for a placeholder that never resolves inside a popover that was never
	// "scrolled into view" - leaving an empty box where the logo should be.
	// "eager" is deliberate for the small dropdown imagery.
	// Every image the script makes carries width and height: the CSS sizes them,
	// but the attributes are what let the browser reserve the box before the
	// file arrives (a late logo otherwise shifts the row it sits in).
	function imgProps(props) {
		var out = { "data-no-lazy": "1", "data-skip-lazy": "1", decoding: "async" };
		Object.keys(props).forEach(function (k) {
			out[k] = props[k];
		});
		out.class = (out.class ? out.class + " " : "") + "skip-lazy";
		return out;
	}

	// Tiny DOM helper. props.text sets textContent (safe); props.class sets className.
	function el(tag, props, children) {
		var node = document.createElement(tag);
		if (props) {
			Object.keys(props).forEach(function (k) {
				if (k === "class") {
					node.className = props[k];
				} else if (k === "text") {
					node.textContent = props[k];
				} else if (k === "html") {
					node.innerHTML = props[k];
				} else {
					node.setAttribute(k, props[k]);
				}
			});
		}
		(children || []).forEach(function (c) {
			if (c == null) return;
			node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
		});
		return node;
	}

	// A select that can show imagery. Native <option> elements render as OS
	// widgets and cannot contain an <img> or per-option color, so the team and
	// position filters use this instead - same behavior as a <select> (value,
	// change event, keyboard), but each row can carry a team logo or a colored
	// position code, matching the rows in the search dropdown.
	function customSelect(config) {
		var options = [];
		var value = null;
		var open = false;
		var activeIndex = -1;

		var valueEl = el("span", { class: "scdc-cs-value" });
		var trigger = el("button", {
			type: "button",
			class: "scdc-cs-trigger",
			"aria-haspopup": "listbox",
			"aria-expanded": "false"
		}, [valueEl]);
		var caret = el("span", { class: "scdc-cs-caret", "aria-hidden": "true" });
		caret.innerHTML =
			'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
		trigger.appendChild(caret);

		var list = el("div", { class: "scdc-cs-list", role: "listbox" });
		if (config && config.icon) {
			var icon = el("span", { class: "scdc-cs-icon", "aria-hidden": "true" });
			icon.innerHTML = config.icon;
			trigger.insertBefore(icon, valueEl);
		}
		var root = el("div", { class: "scdc-cs" + (config && config.className ? " " + config.className : "") }, [trigger, list]);
		if (config && config.label) trigger.setAttribute("aria-label", config.label);

		function optionByValue(v) {
			for (var i = 0; i < options.length; i++) {
				if (options[i].value === v) return options[i];
			}
			return null;
		}

		// Row content: optional logo (or abbreviation placeholder), the label, and
		// an optional color-coded position code.
		function fillRow(node, opt) {
			node.innerHTML = "";
			if (opt.logo) {
				node.appendChild(el("img", imgProps({ class: "scdc-cs-logo", src: opt.logo, alt: "", width: "20", height: "20" })));
			} else if (opt.abbr) {
				node.appendChild(el("span", { class: "scdc-cs-logo scdc-cs-logo-text", text: opt.abbr }));
			}
			node.appendChild(el("span", { class: "scdc-cs-label", text: opt.label }));
			if (opt.badge) {
				var badge = el("span", { class: "scdc-cs-badge", text: opt.badge });
				if (opt.badgeColor) badge.style.color = opt.badgeColor;
				node.appendChild(badge);
			}
		}

		function renderTrigger() {
			var opt = optionByValue(value) || options[0];
			if (opt) fillRow(valueEl, opt);
		}

		function renderList() {
			list.innerHTML = "";
			options.forEach(function (opt, i) {
				var row = el("div", {
					class: "scdc-cs-option" + (opt.value === value ? " is-selected" : ""),
					role: "option",
					"aria-selected": opt.value === value ? "true" : "false"
				});
				fillRow(row, opt);
				// mousedown, so the choice registers before the trigger loses focus.
				row.addEventListener("mousedown", function (e) {
					e.preventDefault();
					choose(i);
				});
				row.addEventListener("mouseenter", function () {
					setActive(i);
				});
				list.appendChild(row);
			});
		}

		function setActive(i) {
			activeIndex = i;
			Array.prototype.forEach.call(list.children, function (c, idx) {
				c.classList.toggle("is-active", idx === i);
			});
			if (list.children[i] && list.children[i].scrollIntoView) {
				list.children[i].scrollIntoView({ block: "nearest" });
			}
		}

		function openList() {
			if (open) return;
			open = true;
			root.classList.add("is-open");
			trigger.setAttribute("aria-expanded", "true");
			renderList();
			var current = options.map(function (o) { return o.value; }).indexOf(value);
			setActive(current < 0 ? 0 : current);
		}

		function closeList() {
			if (!open) return;
			open = false;
			root.classList.remove("is-open");
			trigger.setAttribute("aria-expanded", "false");
			activeIndex = -1;
		}

		function choose(i) {
			var opt = options[i];
			if (!opt) return;
			value = opt.value;
			renderTrigger();
			closeList();
			trigger.focus();
			if (config && config.onChange) config.onChange(value);
		}

		trigger.addEventListener("click", function () {
			if (open) closeList(); else openList();
		});
		trigger.addEventListener("keydown", function (e) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (!open) { openList(); return; }
				var next = e.key === "ArrowDown" ? activeIndex + 1 : activeIndex - 1;
				setActive(Math.max(0, Math.min(options.length - 1, next)));
			} else if (e.key === "Enter" || e.key === " ") {
				if (open) { e.preventDefault(); choose(activeIndex); }
			} else if (e.key === "Escape") {
				closeList();
			} else if (e.key === "Home" && open) {
				e.preventDefault(); setActive(0);
			} else if (e.key === "End" && open) {
				e.preventDefault(); setActive(options.length - 1);
			}
		});
		trigger.addEventListener("blur", function () {
			// Delay, so a click landing inside the list still resolves first.
			setTimeout(closeList, 120);
		});
		document.addEventListener("mousedown", function (e) {
			if (open && !root.contains(e.target)) closeList();
		});

		return {
			el: root,
			setOptions: function (next) {
				options = next || [];
				if (!optionByValue(value) && options.length) value = options[0].value;
				renderTrigger();
				if (open) renderList();
			},
			setValue: function (v) {
				if (v === value) return;
				value = v;
				renderTrigger();
				if (open) renderList();
			},
			getValue: function () { return value; }
		};
	}

	function getPlayers(team, key) {
		return (team.positions && team.positions[key]) || [];
	}

	// Tab-aware search match: a team is a hit when its name/abbr contains the
	// query, OR one of its players *in the currently displayed columns* does.
	// Scoping to `columns` (rather than every raw position key) means a Fantasy-tab
	// search only surfaces teams whose match is actually visible on that tab.
	function teamMatchesSearch(team, q, columns) {
		if (!q) return true;
		q = q.toLowerCase();
		if (
			team.team.name.toLowerCase().indexOf(q) !== -1 ||
			team.team.abbr.toLowerCase().indexOf(q) !== -1
		) {
			return true;
		}
		for (var i = 0; i < columns.length; i++) {
			var players = getPlayers(team, columns[i].key);
			for (var j = 0; j < players.length; j++) {
				if (players[j].name && players[j].name.toLowerCase().indexOf(q) !== -1) {
					return true;
				}
			}
		}
		return false;
	}

	var STATUS_BADGE = {
		Q: { label: "Q", cls: "scdc-badge-warn" },
		D: { label: "D", cls: "scdc-badge-warn" },
		O: { label: "O", cls: "scdc-badge-out" },
		IR: { label: "IR", cls: "scdc-badge-out" },
		PUP: { label: "PUP", cls: "scdc-badge-out" },
		SUSP: { label: "SUS", cls: "scdc-badge-out" },
		SUS: { label: "SUS", cls: "scdc-badge-out" }
	};

	// ---- Search suggestions (shared by the original and premium toolbars) ----

	// Index headshots by normalized name across *every* position (built once per
	// loaded dataset), so a tab whose source lacks headshots (e.g. Fantasy's
	// FAN_* columns) can still borrow a player's ESPN headshot found elsewhere.
	function headshotIndexFor(teams) {
		if (teams._scdcHeads) return teams._scdcHeads;
		var index = {};
		teams.forEach(function (t) {
			var positions = t.positions || {};
			Object.keys(positions).forEach(function (key) {
				positions[key].forEach(function (p) {
					if (p.headshot && p.name) {
						var nk = normNameKey(p.name);
						if (!index[nk]) index[nk] = p.headshot;
					}
				});
			});
		});
		teams._scdcHeads = index;
		return index;
	}

	// The alphabetical team + player list for one tab's columns. Players are
	// de-duplicated by name and drawn only from the tab's visible columns. Each
	// row carries its imagery: teams a logo; players a headshot + their team's
	// abbr/logo, plus the position code.
	function buildSuggestionItems(teams, cols) {
		var heads = headshotIndexFor(teams);
		var items = [];
		teams.forEach(function (t) {
			items.push({ type: "team", label: t.team.name, sub: t.team.abbr, logo: t.team.logo });
		});
		var seen = {};
		teams.forEach(function (t) {
			cols.forEach(function (col) {
				var code = col.short || col.label || col.key;
				getPlayers(t, col.key).forEach(function (p) {
					if (!p.name) return;
					var k = p.name.toLowerCase();
					if (seen[k]) return;
					seen[k] = true;
					items.push({
						type: "player",
						label: p.name,
						sub: t.team.abbr,
						pos: code,
						headshot: p.headshot || heads[normNameKey(p.name)] || null,
						teamLogo: t.team.logo
					});
				});
			});
		});
		items.sort(function (a, b) {
			return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
		});
		return items;
	}

	// Row imagery: a team logo for team rows; a player headshot with a small
	// team-logo badge for player rows. Missing images fall back to the team
	// abbreviation. Logos render on transparent backgrounds.
	function suggestAvatar(it) {
		if (it.type === "team") {
			var teamWrap = el("span", { class: "scdc-sg-avatar scdc-sg-avatar-team" });
			if (it.logo) {
				teamWrap.appendChild(el("img", imgProps({ class: "scdc-sg-logo", src: it.logo, alt: "", width: "24", height: "24" })));
			} else {
				teamWrap.appendChild(el("span", { class: "scdc-sg-fallback", text: it.sub || "" }));
			}
			return teamWrap;
		}
		var wrap = el("span", { class: "scdc-sg-avatar" });
		if (it.headshot) {
			wrap.appendChild(el("img", imgProps({ class: "scdc-sg-head", src: it.headshot, alt: "", width: "28", height: "28" })));
			if (it.teamLogo) {
				wrap.appendChild(el("img", imgProps({ class: "scdc-sg-badge", src: it.teamLogo, alt: "", width: "14", height: "14" })));
			}
		} else if (it.teamLogo) {
			// No headshot for this player (ESPN doesn't publish one, or the cached
			// file predates them). Show the team logo at full size rather than an
			// orphaned corner badge floating beside the abbreviation.
			wrap.appendChild(el("img", imgProps({ class: "scdc-sg-logo", src: it.teamLogo, alt: "", width: "24", height: "24" })));
		} else {
			wrap.appendChild(el("span", { class: "scdc-sg-fallback", text: it.sub || "" }));
		}
		return wrap;
	}

	// Autocomplete glue for a search input: opens on focus/click/typing, filters
	// `opts.items()` by the input, keyboard navigation, selection via
	// `opts.onSelect(label)`. Capped at 60 rows so a full roster can't build
	// thousands of DOM nodes at once. `opts.onInput(value)` fires on typing.
	function attachSuggest(search, suggestBox, opts) {
		var shown = [];
		var active = -1;

		function setActive(i) {
			active = i;
			Array.prototype.forEach.call(suggestBox.children, function (c, idx) {
				c.className = idx === i ? "scdc-suggest-item is-active" : "scdc-suggest-item";
			});
			var item = suggestBox.children[i];
			if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
		}

		function close() {
			suggestBox.style.display = "none";
			suggestBox.innerHTML = "";
			active = -1;
			search.setAttribute("aria-expanded", "false");
		}

		function select(it) {
			search.value = it.label;
			close();
			opts.onSelect(it.label);
		}

		function open() {
			var items = opts.items();
			var q = search.value.trim().toLowerCase();
			var list = q
				? items.filter(function (it) {
						return it.label.toLowerCase().indexOf(q) !== -1;
				  })
				: items;
			shown = list.slice(0, 60);
			active = -1;
			suggestBox.innerHTML = "";
			if (!shown.length) {
				close();
				return;
			}
			shown.forEach(function (it, i) {
				// Name, with the color-coded position code to its right (players only).
				var main = el("span", { class: "scdc-suggest-main" }, [
					el("span", { class: "scdc-suggest-label", text: it.label })
				]);
				if (it.type === "player" && it.pos) {
					var posEl = el("span", { class: "scdc-suggest-pos", text: it.pos });
					posEl.style.color = POSITION_COLOR[it.pos] || "#64748b";
					// Inline, so the code can't be squeezed to nothing beside the
					// nowrap label if the stylesheet is ever stripped or overridden.
					posEl.style.flex = "0 0 auto";
					main.appendChild(posEl);
				}
				var left = el("span", { class: "scdc-suggest-left" }, [suggestAvatar(it), main]);
				var right = el("span", {
					class: "scdc-suggest-type",
					text: it.type === "team" ? "Team" : it.sub || "Player"
				});
				var row = el("div", { class: "scdc-suggest-item", role: "option" }, [left, right]);
				// mousedown (not click) so the selection fires before the input's blur.
				row.addEventListener("mousedown", function (e) {
					e.preventDefault();
					select(it);
				});
				row.addEventListener("mouseenter", function () {
					setActive(i);
				});
				suggestBox.appendChild(row);
			});
			suggestBox.style.display = "block";
			search.setAttribute("aria-expanded", "true");
		}

		search.addEventListener("input", function () {
			opts.onInput(search.value);
			open();
		});
		search.addEventListener("focus", open);
		search.addEventListener("click", open);
		search.addEventListener("blur", function () {
			// Small delay so a click inside the list still resolves first.
			setTimeout(close, 120);
		});
		search.addEventListener("keydown", function (e) {
			var isOpen = suggestBox.style.display !== "none" && shown.length;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (!isOpen) { open(); return; }
				setActive(Math.min(active + 1, shown.length - 1));
			} else if (e.key === "ArrowUp") {
				if (!isOpen) return;
				e.preventDefault();
				setActive(Math.max(active - 1, 0));
			} else if (e.key === "Enter") {
				if (isOpen && active >= 0 && shown[active]) {
					e.preventDefault();
					select(shown[active]);
				}
			} else if (e.key === "Escape") {
				close();
			}
		});

		return { close: close };
	}

	// ---- CSV export (shared) ----

	// CSV-quote a field if it contains a comma, quote, or newline.
	function csvCell(value) {
		var s = value == null ? "" : String(value);
		if (/[",\n]/.test(s)) {
			s = '"' + s.replace(/"/g, '""') + '"';
		}
		return s;
	}

	// Export the on-screen data (visible teams × displayed columns) as a
	// wide-format CSV: one row per Team + Position, players in depth order
	// spread across Player 1, Player 2, … columns. Opens natively in Excel.
	function exportCsv(visible, columns, tabKey) {
		var records = [];
		visible.forEach(function (team) {
			columns.forEach(function (col) {
				var players = getPlayers(team, col.key);
				if (players.length) {
					records.push({ team: team, position: col.label, players: players });
				}
			});
		});
		if (!records.length) return;

		var maxPlayers = records.reduce(function (m, r) {
			return Math.max(m, r.players.length);
		}, 0);

		var header = ["Team", "Abbr", "Position"];
		for (var i = 0; i < maxPlayers; i++) header.push("Player " + (i + 1));

		var lines = [header.map(csvCell).join(",")];
		records.forEach(function (r) {
			var cells = [r.team.team.name, r.team.team.abbr, r.position];
			for (var j = 0; j < maxPlayers; j++) {
				var p = r.players[j];
				cells.push(p ? p.name + (p.status ? " (" + p.status + ")" : "") : "");
			}
			lines.push(cells.map(csvCell).join(","));
		});

		// Prepend a BOM so Excel reads UTF-8 names (accents, apostrophes) right.
		var csv = "\ufeff" + lines.join("\r\n");
		var stamp = new Date().toISOString().slice(0, 10);
		var filename = "statchasers-depth-charts-" + VIEW_TO_SLUG[tabKey] + "-" + stamp + ".csv";

		var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		var url = URL.createObjectURL(blob);
		var a = el("a", { href: url, download: filename });
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// "Josh Sweat" -> "J. Sweat". Keeps everything after the first name intact
	// so suffixes/compound surnames survive (e.g. "Amon-Ra St. Brown").
	function abbreviateName(name) {
		var firstSpace = name.indexOf(" ");
		if (firstSpace <= 0) return name;
		return name.charAt(0) + ". " + name.slice(firstSpace + 1);
	}

	function playerRow(player) {
		var children = [];

		if (player.movement === "up") {
			children.push(el("span", { class: "scdc-move scdc-move-up", text: "▲", title: "Moved up" }));
		} else if (player.movement === "down") {
			children.push(el("span", { class: "scdc-move scdc-move-down", text: "▼", title: "Moved down" }));
		}

		// Zero-padded depth rank ("01", "02") for a calm, aligned tabular column.
		var rankText = String(player.rank);
		if (rankText.length < 2) rankText = "0" + rankText;
		children.push(el("span", { class: "scdc-rank", text: rankText }));
		// Full name by default; CSS swaps to the abbreviated form when the
		// column is squeezed to its narrowest (scrolling) width.
		children.push(el("span", { class: "scdc-name scdc-name-full", text: player.name }));
		children.push(el("span", { class: "scdc-name scdc-name-abbr", text: abbreviateName(player.name) }));

		var badges = [];
		if (player.movement === "new") {
			badges.push(el("span", { class: "scdc-badge scdc-badge-new", text: "NEW" }));
		}
		if (player.status) {
			var known = STATUS_BADGE[String(player.status).toUpperCase()];
			if (known) {
				badges.push(el("span", { class: "scdc-badge " + known.cls, text: known.label }));
			} else {
				badges.push(el("span", { class: "scdc-badge scdc-badge-out", text: player.status }));
			}
		}
		if (badges.length) {
			children.push(el("span", { class: "scdc-badges" }, badges));
		}

		return el("div", { class: "scdc-player" }, children);
	}

	function positionColumn(label, players, short) {
		var body;
		if (!players.length) {
			body = el("div", { class: "scdc-col-body" }, [el("div", { class: "scdc-col-empty", text: "-" })]);
		} else {
			body = el("div", { class: "scdc-col-body" }, players.map(playerRow));
		}
		// Editorial header: an uppercase eyebrow (full label by default; CSS swaps
		// to the compact form e.g. "QB" once the column is squeezed) plus a quiet
		// count badge, then a hairline rule with a short gold micro-accent.
		var headChildren = [
			el("span", { class: "scdc-colhead-text" }, [
				el("span", { class: "scdc-colhead-full", text: label }),
				el("span", { class: "scdc-colhead-abbr", text: short || label })
			])
		];
		if (players.length) {
			headChildren.push(el("span", { class: "scdc-col-count", text: String(players.length) }));
		}
		var head = el("div", { class: "scdc-col-head" }, headChildren);
		var rule = el("div", { class: "scdc-col-rule" });
		return el("div", { class: "scdc-col" }, [head, rule, body]);
	}

	// Watches a card's horizontally-scrollable column strip and toggles --sc-fit
	// on it: 1 while everything fits, 0.8 once the columns overflow and would
	// otherwise need horizontal scrolling (shrinking column widths + padding
	// ~20%). Hysteresis on the restore side keeps the shrink - which itself
	// reduces scrollWidth - from oscillating the state.
	function attachFit(colsEl, innerEl) {
		if (typeof ResizeObserver === "undefined") return;
		var fit = 1;
		function measure() {
			var overflow = colsEl.scrollWidth - colsEl.clientWidth;
			var next = fit === 1 ? (overflow > 0 ? 0.8 : 1) : (overflow > -24 ? 0.8 : 1);
			if (next !== fit) {
				fit = next;
				colsEl.style.setProperty("--sc-fit", String(fit));
			}
		}
		var ro = new ResizeObserver(measure);
		ro.observe(colsEl);
		ro.observe(innerEl);
	}

	function teamCard(team, columns, template) {
		var logo;
		if (team.team.logo) {
			logo = el("img", imgProps({ src: team.team.logo, alt: team.team.name + " logo", width: "40", height: "40", loading: "lazy" }));
		} else {
			logo = el("span", { text: team.team.abbr });
		}

		var inner = el(
			"div",
			{ class: "scdc-cols-inner" },
			columns.map(function (col) {
				return positionColumn(col.label, getPlayers(team, col.key), col.short);
			})
		);
		// Per-position auto-fit widths (computed once from all teams). Uniform on
		// wide screens, narrowing each position to its own width as space runs out.
		inner.style.gridTemplateColumns = template;

		// Small summary strip, e.g. "3 QB · 6 RB · 4 WR · 2 TE · 1 K".
		var summary = columns
			.map(function (col) {
				return { label: col.short || col.label, n: getPlayers(team, col.key).length };
			})
			.filter(function (x) { return x.n > 0; })
			.map(function (x) { return x.n + " " + x.label; })
			.join(" · ");

		var cols = el("div", { class: "scdc-cols" }, [inner]);
		attachFit(cols, inner);

		return el("div", { class: "scdc-team-card" }, [
			el("div", { class: "scdc-team-head" }, [
				el("div", { class: "scdc-logo" }, [logo]),
				el("div", { class: "scdc-team-title" }, [
					el("span", { class: "scdc-team-name", text: team.team.name }),
					summary ? el("div", { class: "scdc-team-summary", text: summary }) : null
				])
			]),
			cols
		]);
	}

	function cardMinWidth(colCount) {
		// + team-surface horizontal padding (~1.15rem each side).
		var rem = colCount * COLUMN_WIDTH_REM + (colCount - 1) * 0.5 + 2.3;
		return "min(100%, " + rem.toFixed(2) + "rem)";
	}

	// ESPN's files are a 350x254 PNG per headshot and a 500px PNG per crest,
	// for boxes of 20 to 40 pixels. When the page names the StatChasers app's
	// public origin (data-image-origin), every image is pointed at the app's
	// own derivatives instead: the 160px square WebP of each ESPN headshot
	// (`latest` redirects to the current version, cached an hour) and the SVG
	// crest by team code (a day-cached redirect to the hashed file). Done once
	// on the loaded data, so every place that draws a logo or a headshot -
	// cards, dropdown, search - picks the new address up without knowing.
	var ESPN_HEADSHOT = /^https?:\/\/a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/(\d+)\.png/i;
	function optimizeImagery(teams, origin) {
		origin = String(origin || "").replace(/\/+$/, "");
		if (!origin) return;
		teams.forEach(function (t) {
			if (t.team && t.team.abbr) {
				t.team.logo = origin + "/team-logos/" + String(t.team.abbr).toLowerCase() + ".svg";
			}
			var positions = t.positions && typeof t.positions === "object" ? t.positions : {};
			Object.keys(positions).forEach(function (key) {
				(Array.isArray(positions[key]) ? positions[key] : []).forEach(function (p) {
					var m = p && typeof p.headshot === "string" ? ESPN_HEADSHOT.exec(p.headshot) : null;
					if (m) p.headshot = origin + "/news-image/athlete/" + m[1] + "/latest/160.webp";
				});
			});
		});
	}

	function render(root, data, ctx) {
		var teams = (data.teams || []).slice().sort(function (a, b) {
			return a.team.name.localeCompare(b.team.name);
		});
		optimizeImagery(teams, ctx.imageOrigin);

		// Bidirectional team <-> slug maps built from the loaded data.
		var abbrToSlug = {};
		var slugToAbbr = {};
		teams.forEach(function (t) {
			var s = slugify(t.team.name);
			abbrToSlug[t.team.abbr] = s;
			slugToAbbr[s] = t.team.abbr;
		});

		// The server's 32-team config wins: routes, canonicals and links are built
		// from it in PHP, so the client uses the same slugs rather than re-deriving.
		Object.keys(ctx.teams || {}).forEach(function (abbr) {
			var slug = ctx.teams[abbr] && ctx.teams[abbr].s;
			if (!slug) return;
			abbrToSlug[abbr] = slug;
			slugToAbbr[slug] = abbr;
		});

		var state = { search: "", team: "ALL", position: "ALL", tab: "fantasy" };

		// Per-position "auto-fit" width (rem): wide enough for that position's
		// longest (abbreviated) name across every team, so a given position is the
		// SAME width in all teams. Cached per position key.
		var fitCache = {};
		function positionFitRem(colKey, shortLabel) {
			if (fitCache[colKey] != null) return fitCache[colKey];
			var maxChars = (shortLabel || "").length;
			teams.forEach(function (t) {
				getPlayers(t, colKey).forEach(function (p) {
					var len = abbreviateName(p.name).length;
					if (len > maxChars) maxChars = len;
				});
			});
			// ~0.4rem/char at the tight 0.7rem font, plus gutters; clamped so no
			// column is absurdly narrow or wider than the uniform 6rem max.
			var rem = Math.min(6, Math.max(3.5, Math.round((maxChars * 0.4 + 1) * 100) / 100));
			fitCache[colKey] = rem;
			return rem;
		}
		// Per-column grid template for the currently displayed columns: uniform
		// 6rem min on wide screens (grows via 1fr), tightening toward each
		// position's own fit as the viewport shrinks. Same vw term for all so they
		// narrow together; the per-column min is what differentiates.
		function columnTemplate(columns) {
			return columns
				.map(function (col) {
					// Each track's min is scaled by --sc-fit (set per card by
					// attachFit): 1 normally, 0.8 when the columns overflow - shrinking
					// columns (and their padding) up to 20% to pack more onto the screen.
					return (
						"minmax(calc(clamp(" +
						positionFitRem(col.key, col.short || col.label) +
						"rem, calc(0.6rem + 9.6vw), 6rem) * var(--sc-fit, 1)), 1fr)"
					);
				})
				.join(" ");
		}

		// ---- Fragment state ---------------------------------------------------
		// The page has one address. The view/team/position filters are kept in
		// the URL fragment (#fantasy/buffalo-bills/rb), so a filtered view can
		// still be copied, reloaded and stepped through with back/forward, while
		// the browser never sends the fragment and search engines never index it.
		// The slugs are the ones the pre-1.7.0 paths used, so an old deep link's
		// tail still means the same thing here.
		function teamSlugFor(abbr) {
			if (abbr === "ALL") return "all-teams";
			return abbrToSlug[abbr] || "all-teams";
		}
		function positionSlugFor(pos) {
			if (pos === "ALL") return "";
			var cols = TABS[state.tab].columns;
			for (var i = 0; i < cols.length; i++) {
				if (cols[i].key === pos) return cols[i].slug;
			}
			return "";
		}
		function buildHash() {
			var view = VIEW_TO_SLUG[state.tab];
			var teamSlug = teamSlugFor(state.team);
			var ps = positionSlugFor(state.position);
			// The default state is the bare address, no fragment at all.
			if (view === "fantasy" && teamSlug === "all-teams" && !ps) return "";
			var hash = "#" + view;
			// "all-teams" is only needed as a placeholder when a position follows it.
			if (teamSlug !== "all-teams" || ps) hash += "/" + teamSlug;
			if (ps) hash += "/" + ps;
			return hash;
		}
		function buildUrl() {
			return window.location.pathname + window.location.search + buildHash();
		}
		function currentUrl() {
			return window.location.pathname + window.location.search + window.location.hash;
		}
		// Resolve raw URL slugs into a validated state, with safe fallbacks (#11).
		function resolveSlugs(slugs) {
			var tab = SLUG_TO_VIEW[slugs.view] || "fantasy";

			var team = "ALL";
			if (slugs.team && slugs.team !== "all-teams") {
				team = slugToAbbr[slugs.team] || "ALL";
			}

			var position = "ALL";
			if (slugs.position && slugs.position !== "all") {
				var want = slugs.position.toLowerCase();
				TABS[tab].columns.forEach(function (c) {
					if (c.slug === want) position = c.key;
				});
			}
			return { tab: tab, team: team, position: position };
		}
		// Read the fragment into raw slugs.
		function parseHash() {
			var raw = String(window.location.hash || "").replace(/^#\/?/, "");
			var segs = raw.split("/").filter(Boolean);
			return { view: segs[0] || "", team: segs[1] || "", position: segs[2] || "" };
		}

		root.innerHTML = "";

		// ---- Controls ----
		var controls = el("div", { class: "scdc-controls" });

		var search = el("input", {
			type: "text",
			class: "scdc-input",
			placeholder: "Search team or player...",
			autocomplete: "off",
			role: "combobox",
			"aria-expanded": "false",
			"aria-autocomplete": "list"
		});
		// Autocomplete dropdown: teams + players for the active tab, alphabetical.
		var suggestBox = el("div", { class: "scdc-suggest", role: "listbox" });
		var searchWrap = el("div", { class: "scdc-search-wrap" }, [search, suggestBox]);

		// Autocomplete rows for the active tab, rebuilt when the tab changes.
		var suggestItems = null;
		var suggestTab = null;
		var suggest = attachSuggest(search, suggestBox, {
			items: function () {
				if (suggestTab !== state.tab) {
					suggestItems = buildSuggestionItems(teams, TABS[state.tab].columns);
					suggestTab = state.tab;
				}
				return suggestItems;
			},
			onInput: function (value) {
				state.search = value;
				draw();
			},
			onSelect: function (label) {
				state.search = label;
				draw();
			}
		});

		var posSelect = customSelect({
			label: "Filter by position",
			onChange: function (v) {
				state.position = v;
				commit("push");
			}
		});
		var teamSelect = customSelect({
			label: "Filter by team",
			onChange: function (v) {
				state.team = v;
				commit("push");
			}
		});

		// Team rows carry the franchise logo, exactly like the search dropdown.
		teamSelect.setOptions(
			[{ value: "ALL", label: "All teams" }].concat(
				teams.map(function (t) {
					return {
						value: t.team.abbr,
						label: t.team.name + " (" + t.team.abbr + ")",
						logo: t.team.logo,
						abbr: t.team.logo ? null : t.team.abbr
					};
				})
			)
		);
		teamSelect.setValue("ALL");

		// Export - secondary action, softened so it doesn't compete with the
		// view switch. Exports exactly what's on screen (visible teams ×
		// displayed columns) as an Excel-friendly CSV.
		var downloadBtn = el("button", { type: "button", class: "scdc-download" });
		downloadBtn.innerHTML =
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
		downloadBtn.appendChild(document.createTextNode("Export"));
		downloadBtn.addEventListener("click", handleDownload);

		// Row 1: search (grows) + Export beside it. Row 2: the two filters share
		// a row. Keeps the toolbar to two tidy rows instead of auto-stacking.
		var searchRow = el("div", { class: "scdc-controls-row scdc-controls-row-primary" }, [
			el("div", { class: "scdc-field scdc-field-search" }, [searchWrap]),
			el("div", { class: "scdc-field scdc-field-download" }, [downloadBtn])
		]);
		var filterRow = el("div", { class: "scdc-controls-row scdc-controls-row-filters" }, [
			el("div", { class: "scdc-field scdc-field-pos" }, [posSelect.el]),
			el("div", { class: "scdc-field scdc-field-team" }, [teamSelect.el])
		]);

		var tabsEl = el("div", { class: "scdc-tabs" });
		TAB_ORDER.forEach(function (key) {
			var btn = el("button", { type: "button", class: "scdc-tab", text: TABS[key].label });
			btn.addEventListener("click", function () {
				state.tab = key;
				state.position = "ALL"; // positions differ per tab
				// Clear the search: its term is scoped to the tab's columns, so a
				// carried-over query could otherwise leave the new tab looking empty.
				state.search = "";
				search.value = "";
				suggest.close();
				commit("push");
			});
			btn._key = key;
			tabsEl.appendChild(btn);
		});

		// View switch spans the toolbar width; quiet results count at the far
		// right (populated in draw()).
		var contextEl = el("span", { class: "scdc-context" });
		var viewRow = el("div", { class: "scdc-view scdc-header" }, [tabsEl, contextEl]);

		// View switch first, as a top header band; then the toolbar rows.
		controls.appendChild(viewRow);
		controls.appendChild(searchRow);
		controls.appendChild(filterRow);

		// Soft informational note, shown only while the Fantasy view is active
		// (toggled in draw()).
		var fantasyNote = el("div", { class: "scdc-fantasy-note" });
		fantasyNote.innerHTML =
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
		fantasyNote.appendChild(
			document.createTextNode(
				"Fantasy view prioritizes fantasy value and may differ from official team depth charts."
			)
		);
		controls.appendChild(fantasyNote);
		root.appendChild(controls);

		var body = el("div", {});
		root.appendChild(body);

		function syncTabs() {
			Array.prototype.forEach.call(tabsEl.children, function (btn) {
				if (btn._key === state.tab) {
					btn.className = "scdc-tab is-active";
				} else {
					btn.className = "scdc-tab";
				}
			});
		}

		function syncPosOptions() {
			var opts = [{ value: "ALL", label: "All positions" }];
			TABS[state.tab].columns.forEach(function (col) {
				var code = col.short || col.label || col.key;
				opts.push({
					value: col.key,
					label: col.label,
					badge: code,
					badgeColor: POSITION_COLOR[code] || "#64748b"
				});
			});
			posSelect.setOptions(opts);
			posSelect.setValue(state.position);
		}

		// Columns currently displayed (active tab, narrowed by the position filter).
		function currentColumns() {
			var tabColumns = TABS[state.tab].columns;
			return state.position === "ALL"
				? tabColumns
				: tabColumns.filter(function (c) {
						return c.key === state.position;
				  });
		}

		// Teams currently visible (team filter + search). Search is scoped to the
		// active tab's columns so only teams with a *visible* match are kept.
		function currentVisible() {
			var cols = TABS[state.tab].columns;
			return teams.filter(function (t) {
				if (state.team !== "ALL" && t.team.abbr !== state.team) return false;
				return teamMatchesSearch(t, state.search, cols);
			});
		}

		function draw() {
			var columns = currentColumns();
			var visible = currentVisible();

			if (fantasyNote) fantasyNote.style.display = state.tab === "fantasy" ? "" : "none";
			if (downloadBtn) downloadBtn.disabled = !visible.length;

			// Quiet results count (secondary context, muted text). Shown in the
			// header on wider screens; on mobile it's hidden there and rendered
			// directly above the first team card instead (see below).
			var contextText = "";
			var count = 0;
			visible.forEach(function (t) {
				columns.forEach(function (col) {
					count += getPlayers(t, col.key).length;
				});
			});
			contextText = "Showing " + count + " players";
			if (state.position !== "ALL") {
				var posLabel = state.position;
				TABS[state.tab].columns.forEach(function (c) {
					if (c.key === state.position) posLabel = c.label;
				});
				contextText += " · " + posLabel;
			}
			if (state.team !== "ALL") {
				contextText += " · " + state.team;
			}
			if (contextEl) contextEl.textContent = contextText;

			body.innerHTML = "";

			if (!visible.length) {
				body.appendChild(
					el("div", { class: "scdc-empty" }, [el("p", { text: "No teams found. Try adjusting your search or filters." })])
				);
				return;
			}

			var template = columnTemplate(columns);
			var grid = el(
				"div",
				{ class: "scdc-grid" },
				visible.map(function (t) {
					return teamCard(t, columns, template);
				})
			);
			grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(" + cardMinWidth(columns.length) + ", 1fr))";

			// Mobile-only results count, directly above the first team card.
			body.appendChild(el("div", { class: "scdc-context-mobile", text: contextText }));
			body.appendChild(grid);
		}

		// Exports exactly what's on screen (visible teams × displayed columns).
		function handleDownload() {
			exportCsv(currentVisible(), currentColumns(), state.tab);
		}

		// Re-sync the controls to `state`, redraw, and optionally update the URL.
		// mode: "push" (user action), "replace" (canonicalize), or "" (no URL change).
		function commit(mode) {
			syncTabs();
			syncPosOptions();
			teamSelect.setValue(state.team);
			draw();
			if (mode === "push" || mode === "replace") {
				var url = buildUrl();
				if (mode === "replace") {
					window.history.replaceState(null, "", url);
				} else if (url !== currentUrl()) {
					window.history.pushState(null, "", url);
				}
			}
		}

		// Apply a resolved state (from URL/attrs) without recording new history.
		function applyResolved(resolved) {
			state.tab = resolved.tab;
			state.team = resolved.team;
			state.position = resolved.position;
		}

		// ---- Initialize from the fragment ----
		var initial = resolveSlugs(parseHash());
		applyResolved(initial);
		commit("");

		// NEW DESIGN - COMPARISON: the premium browser, under the complete
		// original, drawing the same loaded teams (no second fetch). It keeps
		// its own filter state and never writes the URL fragment, so the two
		// cannot fight over history while they are compared side by side.
		renderPremium(root, { teams: teams, initial: initial });

		// Back/forward (and a hand-edited fragment): re-read it, no new history entry.
		window.addEventListener("popstate", function () {
			applyResolved(resolveSlugs(parseHash()));
			commit("");
		});
	}

	// =====================================================================
	// NEW DESIGN - COMPARISON: the premium league-wide browser.
	//
	// Mounted under the complete original by render(), from the same loaded,
	// sorted and imagery-optimized `teams` array (no second fetch and no second
	// ranking pass). Same TABS, same getPlayers, same search semantics
	// (teamMatchesSearch), same count rule (visible teams x displayed columns),
	// same CSV (exportCsv). Its own filter state; it does not touch the URL
	// fragment while the two designs are compared.
	// =====================================================================

	var PRM_ICON = {
		fantasy:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" x2="6" y1="20" y2="15"></line><line x1="12" x2="12" y1="20" y2="10"></line><line x1="18" x2="18" y1="20" y2="4"></line></svg>',
		offense:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="11" ry="6.5" transform="rotate(-45 12 12)"></ellipse><path d="m8.5 15.5 7-7"></path><path d="m10 13 1.2 1.2"></path><path d="m11.8 11.2 1.2 1.2"></path><path d="m13.6 9.4 1.2 1.2"></path></svg>',
		defense:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg>',
		special:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
		search:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.8-3.8"></path></svg>',
		layers:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"></path><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"></path><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"></path></svg>',
		helmet:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 13.5a7.5 7.5 0 0 1 15 0V16a2 2 0 0 1-2 2h-1.3l-1-3H9.6l-.9 3H6.5a2 2 0 0 1-2-2Z"></path><path d="M15.2 15h5"></path><path d="M9.5 10.5h.01"></path></svg>',
		download:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
		info:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
		up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9.2 8.5H.8Z" fill="currentColor"></path></svg>',
		down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5.8 1.5h8.4Z" fill="currentColor"></path></svg>'
	};

	// Premium position headings: the Fantasy tab's are spelled out already;
	// the other tabs' single-code labels get their full names here.
	var PRM_HEADING = {
		QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends",
		LT: "Left Tackles", LG: "Left Guards", C: "Centers", RG: "Right Guards", RT: "Right Tackles",
		EDGE: "Edge Rushers", DL: "Defensive Line", LB: "Linebackers", CB: "Cornerbacks", S: "Safeties",
		K: "Kickers", P: "Punters", LS: "Long Snappers", KR: "Kick Returners", PR: "Punt Returners"
	};
	function prmHeading(col) {
		var code = col.short || col.label || col.key;
		return col.label.length > 4 ? col.label : PRM_HEADING[code] || col.label;
	}

	function prmPlayerRow(player) {
		var children = [];
		var move = el("span", { class: "scdc-prm-move" });
		if (player.movement === "up") {
			move.className += " is-up";
			move.innerHTML = PRM_ICON.up;
			move.appendChild(el("span", { class: "scdc-prm-sr", text: "Moved up in the depth chart." }));
		} else if (player.movement === "down") {
			move.className += " is-down";
			move.innerHTML = PRM_ICON.down;
			move.appendChild(el("span", { class: "scdc-prm-sr", text: "Moved down in the depth chart." }));
		}
		children.push(move);

		var rankText = String(player.rank);
		if (rankText.length < 2) rankText = "0" + rankText;
		children.push(el("span", { class: "scdc-prm-rank", text: rankText }));
		children.push(el("span", { class: "scdc-prm-name", text: player.name, title: player.name }));

		if (player.movement === "new") {
			children.push(el("span", { class: "scdc-prm-badge scdc-prm-badge-new", text: "NEW", title: "Newly listed on this depth chart" }));
		}
		if (player.status) {
			var known = STATUS_BADGE[String(player.status).toUpperCase()];
			children.push(
				el("span", {
					class: "scdc-prm-badge " + (known ? known.cls : "scdc-badge-out"),
					text: known ? known.label : player.status
				})
			);
		}
		var row = el("div", { class: "scdc-prm-row", role: "listitem" }, children);
		if (player.id) row.setAttribute("data-id", String(player.id));
		return row;
	}

	function prmPositionGroup(team, col) {
		var players = getPlayers(team, col.key);
		var headId = "scdc-prm-h-" + team.team.abbr.toLowerCase() + "-" + col.key.toLowerCase();
		var head = el("div", { class: "scdc-prm-col-head" }, [
			el("span", { class: "scdc-prm-col-label", id: headId, text: prmHeading(col) }),
			el("span", { class: "scdc-prm-col-count", text: String(players.length) })
		]);
		var rule = el("div", { class: "scdc-prm-col-rule", "aria-hidden": "true" });
		var list;
		if (players.length) {
			list = el("div", { class: "scdc-prm-list", role: "list", "aria-labelledby": headId }, players.map(prmPlayerRow));
		} else {
			list = el("div", { class: "scdc-prm-list is-empty", text: "-" });
		}
		return el("div", { class: "scdc-prm-col" }, [head, rule, list]);
	}

	function prmTeamCard(team, columns) {
		var logo;
		if (team.team.logo) {
			logo = el("img", imgProps({ src: team.team.logo, alt: "", width: "40", height: "40", loading: "lazy" }));
		} else {
			logo = el("span", { text: team.team.abbr });
		}
		var summary = columns
			.map(function (col) {
				return { label: col.short || col.label, n: getPlayers(team, col.key).length };
			})
			.filter(function (x) { return x.n > 0; })
			.map(function (x) { return x.n + " " + x.label; })
			.join(" · ");

		var head = el("div", { class: "scdc-prm-team" }, [
			el("div", { class: "scdc-prm-logo" }, [logo]),
			el("div", { class: "scdc-prm-team-bar", "aria-hidden": "true" }),
			el("div", { class: "scdc-prm-team-id" }, [
				el("h3", { class: "scdc-prm-team-name", text: team.team.name }),
				summary ? el("div", { class: "scdc-prm-team-summary", text: summary }) : null
			])
		]);
		var cols = el("div", { class: "scdc-prm-cols" }, columns.map(function (col) {
			return prmPositionGroup(team, col);
		}));
		var card = el("article", { class: "scdc-prm-card", "data-team": team.team.abbr }, [head, cols]);
		card.appendChild(el("span", { class: "scdc-prm-corner", "aria-hidden": "true" }));
		return card;
	}

	function renderPremium(root, shared) {
		var teams = shared.teams;
		var state = {
			tab: shared.initial.tab,
			team: shared.initial.team,
			position: shared.initial.position,
			search: ""
		};

		var wrap = el("section", { class: "scdc-prm-compare", "aria-label": "New design - comparison" });
		wrap.appendChild(el("div", { class: "scdc-prm-divider" }, [el("span", { text: "NEW DESIGN - COMPARISON" })]));
		var prm = el("div", { class: "scdc-prm" });
		wrap.appendChild(prm);

		// ---- Navigation + count ----
		var tabsEl = el("div", { class: "scdc-prm-tabs", role: "group", "aria-label": "Depth chart view" });
		var tabButtons = {};
		TAB_ORDER.forEach(function (key) {
			var btn = el("button", { type: "button", class: "scdc-prm-tab", "aria-pressed": "false" });
			btn.innerHTML = PRM_ICON[key];
			btn.appendChild(el("span", { text: TABS[key].label }));
			btn.addEventListener("click", function () {
				if (state.tab === key) return;
				state.tab = key;
				state.position = "ALL";
				state.search = "";
				search.value = "";
				suggest.close();
				commit();
			});
			tabButtons[key] = btn;
			tabsEl.appendChild(btn);
		});
		var countEl = el("div", { class: "scdc-prm-count", role: "status", "aria-live": "polite" });
		prm.appendChild(el("div", { class: "scdc-prm-top" }, [tabsEl, countEl]));

		// ---- Toolbar ----
		var search = el("input", {
			type: "text",
			class: "scdc-prm-input",
			placeholder: "Search team or player...",
			autocomplete: "off",
			role: "combobox",
			"aria-label": "Search team or player",
			"aria-expanded": "false",
			"aria-autocomplete": "list"
		});
		var suggestBox = el("div", { class: "scdc-suggest", role: "listbox" });
		var searchIcon = el("span", { class: "scdc-prm-search-icon", "aria-hidden": "true" });
		searchIcon.innerHTML = PRM_ICON.search;
		var searchWrap = el("div", { class: "scdc-search-wrap scdc-prm-search" }, [searchIcon, search, suggestBox]);

		var suggestItems = null;
		var suggestTab = null;
		var suggest = attachSuggest(search, suggestBox, {
			items: function () {
				if (suggestTab !== state.tab) {
					suggestItems = buildSuggestionItems(teams, TABS[state.tab].columns);
					suggestTab = state.tab;
				}
				return suggestItems;
			},
			onInput: function (value) {
				state.search = value;
				draw();
			},
			onSelect: function (label) {
				state.search = label;
				draw();
			}
		});

		var posSelect = customSelect({
			label: "Filter by position",
			className: "scdc-prm-select",
			icon: PRM_ICON.layers,
			onChange: function (v) {
				state.position = v;
				commit();
			}
		});
		var teamSelect = customSelect({
			label: "Filter by team",
			className: "scdc-prm-select",
			icon: PRM_ICON.helmet,
			onChange: function (v) {
				state.team = v;
				commit();
			}
		});
		teamSelect.setOptions(
			[{ value: "ALL", label: "All teams" }].concat(
				teams.map(function (t) {
					return {
						value: t.team.abbr,
						label: t.team.name + " (" + t.team.abbr + ")",
						logo: t.team.logo,
						abbr: t.team.logo ? null : t.team.abbr
					};
				})
			)
		);
		teamSelect.setValue(state.team);

		var exportBtn = el("button", { type: "button", class: "scdc-prm-export", "aria-label": "Export the displayed depth charts as CSV" });
		exportBtn.innerHTML = PRM_ICON.download;
		exportBtn.appendChild(el("span", { text: "Export" }));
		exportBtn.addEventListener("click", function () {
			exportCsv(currentVisible(), currentColumns(), state.tab);
		});

		prm.appendChild(
			el("div", { class: "scdc-prm-toolbar" }, [
				el("div", { class: "scdc-prm-field scdc-prm-field-search" }, [searchWrap]),
				el("div", { class: "scdc-prm-field scdc-prm-field-pos" }, [posSelect.el]),
				el("div", { class: "scdc-prm-field scdc-prm-field-team" }, [teamSelect.el]),
				el("div", { class: "scdc-prm-field scdc-prm-field-export" }, [exportBtn])
			])
		);

		// ---- Fantasy notice ----
		var notice = el("div", { class: "scdc-prm-notice", role: "note" });
		notice.innerHTML = PRM_ICON.info;
		notice.appendChild(
			el("p", {}, [
				el("strong", { text: "Fantasy view" }),
				document.createTextNode(" prioritizes fantasy value and may differ from official team depth charts.")
			])
		);
		prm.appendChild(notice);

		var body = el("div", { class: "scdc-prm-body" });
		prm.appendChild(body);
		root.appendChild(wrap);

		// ---- State -> view ----
		function syncTabs() {
			TAB_ORDER.forEach(function (key) {
				var on = key === state.tab;
				tabButtons[key].className = "scdc-prm-tab" + (on ? " is-active" : "");
				tabButtons[key].setAttribute("aria-pressed", on ? "true" : "false");
			});
		}
		function syncPosOptions() {
			var opts = [{ value: "ALL", label: "All positions" }];
			TABS[state.tab].columns.forEach(function (col) {
				var code = col.short || col.label || col.key;
				opts.push({ value: col.key, label: prmHeading(col), badge: code, badgeColor: POSITION_COLOR[code] || "#64748b" });
			});
			posSelect.setOptions(opts);
			posSelect.setValue(state.position);
		}
		function currentColumns() {
			var tabColumns = TABS[state.tab].columns;
			return state.position === "ALL"
				? tabColumns
				: tabColumns.filter(function (c) { return c.key === state.position; });
		}
		function currentVisible() {
			var cols = TABS[state.tab].columns;
			return teams.filter(function (t) {
				if (state.team !== "ALL" && t.team.abbr !== state.team) return false;
				return teamMatchesSearch(t, state.search, cols);
			});
		}

		// Cards are built once per team + tab + position filter and reused across
		// searches and team filters (the same node is simply re-appended).
		var cardCache = {};
		function cardFor(team, columns) {
			var key = state.tab + "|" + state.position + "|" + team.team.abbr;
			if (!cardCache[key]) cardCache[key] = prmTeamCard(team, columns);
			return cardCache[key];
		}

		function reset() {
			state.search = "";
			state.team = "ALL";
			state.position = "ALL";
			search.value = "";
			commit();
		}

		function draw() {
			var columns = currentColumns();
			var visible = currentVisible();

			notice.style.display = state.tab === "fantasy" ? "" : "none";
			exportBtn.disabled = !visible.length;

			var count = 0;
			visible.forEach(function (t) {
				columns.forEach(function (col) {
					count += getPlayers(t, col.key).length;
				});
			});
			countEl.innerHTML = "";
			countEl.appendChild(document.createTextNode("Showing "));
			countEl.appendChild(el("b", { text: String(count) }));
			countEl.appendChild(document.createTextNode(count === 1 ? " player" : " players"));

			body.innerHTML = "";
			if (!visible.length) {
				var resetBtn = el("button", { type: "button", class: "scdc-prm-reset", text: "Reset filters" });
				resetBtn.addEventListener("click", reset);
				body.appendChild(
					el("div", { class: "scdc-prm-empty" }, [
						el("p", { class: "scdc-prm-empty-title", text: "No teams match" }),
						el("p", { class: "scdc-prm-empty-text", text: "Try another name, position or team." }),
						resetBtn
					])
				);
				return;
			}

			// Column count per card: the tab's groups, five across at most; the
			// grid packs more cards per row as the column count drops.
			var perRow = Math.min(5, columns.length);
			var grid = el("div", { class: "scdc-prm-grid" });
			grid.style.setProperty("--prm-cols", String(perRow));
			grid.setAttribute("data-cols", String(perRow));
			var frag = document.createDocumentFragment();
			visible.forEach(function (t) {
				frag.appendChild(cardFor(t, columns));
			});
			grid.appendChild(frag);
			body.appendChild(grid);
		}

		function commit() {
			syncTabs();
			syncPosOptions();
			teamSelect.setValue(state.team);
			draw();
		}

		commit();
	}

	function init(root) {
		var endpoint = root.getAttribute("data-endpoint");
		if (!endpoint) return;

		var ctx = {
			imageOrigin: root.getAttribute("data-image-origin") || "",
			lastUpdated: root.getAttribute("data-last-updated") || "",
			season: root.getAttribute("data-season") || "",
			// The 32-team config (abbr => { n, c, s }), so the fragment uses the
			// server's slugs.
			teams: jsonAttr(root, "data-teams", {})
		};

		fetch(endpoint, { credentials: "same-origin" })
			.then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				return res.json();
			})
			.then(function (data) {
				render(root, data, ctx);
			})
			.catch(function () {
				root.innerHTML = "";
				root.appendChild(
					el("div", { class: "scdc-error" }, [el("p", { text: "Unable to load depth chart data right now. Please try again later." })])
				);
			});
	}

	function boot() {
		var roots = document.querySelectorAll(".scdc-root[data-endpoint]");
		Array.prototype.forEach.call(roots, init);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
