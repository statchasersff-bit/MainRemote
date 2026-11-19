# Desktop layout shift on team pages: the shared Divi header (2026-11-19)

For the WordPress / Divi template workstream. Found during Team Pages
Phase 2B; not fixed there, because it is outside the Coaching tab.

## What happens

On `statchasers.com/nfl/teams/new-england-patriots/coaching/` at 1280px,
in 2 of 5 cold loads (Chromium, 1280x844, production page unmodified), one
layout shift of **0.285** at 370-440ms:

| Source node | Before (y, height) | After (y, height) |
|---|---|---|
| `#et-main-area` | 361, 483 | 0, 844 |
| `.sct-tpb-hero` (team header) | 353, 309 | 0, 301 |
| `.sct-tpb-bands`, `::before` | not laid out | laid out |

The whole content area starts 361px down the viewport and jumps to the top.
The stylesheets that had just finished loading at that moment:
`statchasers-font.css`, `statchasers-display-font.css`, `team.css`,
Divi `style.min.css`, `et-divi-dynamic-tb-268-tb-269-3542-late.css` and
`et-divi-customizer-global.min.css`.

The other 3 loads measured 0 to 0.021: the late stylesheet sometimes lands
before first paint. The small residual (0.021) is the team header's own
identity, badge and switcher moving 15-30px when the same late Divi CSS
applies.

## Attribution

The 361px is the site header's space before its styles apply (the Theme
Builder header, `tb-268`), not anything inside the tool: the Coaching content
is not among the shift's sources, and the same shift appears on the
unmodified production page and on the Phase 2 page. It matches
docs/CLS-ANALYSIS.md (October): the header CSS Divi defers.

## Suggested direction (not done)

- Print the Theme Builder header's critical layout rules in `<head>` (as
  plugin 1.10.24 did for the tool pages' header), or exclude
  `et-divi-dynamic-*-late.css` from WP Rocket's deferral on team pages.
- Re-measure with the same harness (scratchpad `cls-trace.mjs`: production
  page through a local proxy, `PerformanceObserver` layout-shift sources and
  the resources that finished just before each shift), at least 5 cold loads,
  since the shift is load-order dependent.
