/**
 * The RB handcuff tool's icons, as inline SVG.
 *
 * Pure: the renderer prints them into the board, and client/rb-handcuffs.ts
 * prints the same ones into the compare tray and the drawer it builds.
 */

/**
 * The standalone app's icons, inlined. The path data is lucide's (ISC), the
 * same set the app imported through lucide-react; nothing here fetches a font
 * or a sprite. Decorative everywhere they are used — each one sits beside
 * text that says the same thing, or is given a label by its button.
 */
const ICONS: Record<string, string> = {
  premium:
    `<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/>`,
  contingency:
    `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
  talent:
    `<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>`,
  opportunity:
    `<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>`,
  trap:
    `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`,
  ceiling: `<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>`,
  deadzone: `<path d="M4.929 4.929 19.07 19.071"/><circle cx="12" cy="12" r="10"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  chevron: `<path d="m6 9 6 6 6-6"/>`,
  external:
    `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
  info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
};

export function icon(name: string, className = "rbh-icon"): string {
  const body = ICONS[name];
  if (!body) return "";
  return (
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
    ` focusable="false">${body}</svg>`
  );
}
