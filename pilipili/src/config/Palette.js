/**
 * Palette.js — the single source of truth for Le PiliPili's neon-crimson venue.
 *
 * ONE PALETTE, TWO CONSUMERS
 *   - Three.js wants colors as hex NUMBERS (0xRRGGBB) for materials and lights.
 *   - The DOM HUD / menus want CSS color STRINGS ("#rrggbb").
 * We author the numbers ONCE (the `N` table below), then derive the CSS strings
 * and the `--pili-*` custom properties from them, so a color can never drift out
 * of sync between the WebGL scene and the HTML overlay. Retheme the whole game by
 * editing one number here.
 */

/**
 * Numeric source of truth. Every value is a Three.js-ready hex number, annotated
 * with where it is meant to be used across the club.
 */
const N = {
  crimson:     0xff1030, // PRIMARY neon. Signs, tube lights, player rim, HUD accent, bloom fuel.
  crimsonDeep: 0x8a0a1e, // Shadowed crimson. Gradients, pressed buttons, health-bar backing.
  crimsonGlow: 0xff3048, // Hot bloom core — the brightest part of a glowing tube.
  magentaRim:  0xff2a6d, // Cooler secondary neon. Rim accents, strobe wash, selection glow.
  violet:      0x9a3cff, // Rare accent. Strobe flashes, phase-transition flare.

  black:       0x08060a, // The void backdrop / page background. Near-black with a red bias.
  ink:         0x120309, // Panels, the DJ booth shell, menu cards. Matches the boss booth.

  bone:        0xe9e2d0, // Warm off-white. The skull, teeth, DJ shades — matches DjSkullBoss.
  white:       0xfff4f6, // Pure highlight. Body text, big score numbers, flash frames.

  iceCyan:     0x8fe9ff, // Cold accent. Ice-cube enemies and their frictionless trails.
  chiliRed:    0xff0a1e, // Danger / heat. The chili pepper glow, hazard highlights.
  amber:       0xffb03a, // Warm reward. Cocktail pickups, growth "tier up" sparkle.
  ash:         0x9aa0a8, // Neutral grey. The male hero's shirt, muted secondary UI text.
};

/** number → "#rrggbb" (zero-padded, lower-case). */
const toHex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** camelCase → kebab-case, for CSS custom-property names. */
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The exported palette: all numbers at the top level (for Three), plus a `css`
 * sub-map of matching color strings (for the DOM), derived from the same source.
 *
 *   PALETTE.crimson      -> 0xff1030   (material.color, light.color, …)
 *   PALETTE.css.crimson  -> "#ff1030"  (element.style, CSS, canvas 2D, …)
 */
export const PALETTE = Object.freeze({
  ...N,
  css: Object.freeze(
    Object.fromEntries(Object.entries(N).map(([k, v]) => [k, toHex(v)])),
  ),
});

/**
 * cssVars() — the palette as `--pili-*` CSS custom properties so the HUD/menus can
 * theme from this one source. Spread the result onto `:root` (or any element) once
 * at boot and reference the tokens everywhere in CSS:
 *
 *   Object.assign(document.documentElement.style, cssVars());
 *   // then:  color: var(--pili-crimson);  background: var(--pili-black);
 */
export function cssVars() {
  const out = {};
  for (const [k, v] of Object.entries(N)) out[`--pili-${kebab(k)}`] = toHex(v);
  return out;
}
