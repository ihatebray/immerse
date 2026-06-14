/**
 * Motion tokens — the app's shared animation vocabulary.
 *
 * The goal is a single, consistent set of easing curves and durations so
 * every transition/animation feels like it belongs to the same product.
 * Prefer animating `transform` and `opacity` (GPU-composited, no layout)
 * over `width`/`height`/`top`/`left`/`margin` (which force reflow each
 * frame and read as janky).
 *
 * Usage:
 *   import { EASE, DUR, ui } from './motion.js';
 *   style={{ transition: ui(['background', 'border-color']) }}
 *   style={{ transition: `transform ${DUR.base} ${EASE.out}` }}
 */

// ---- Easing curves --------------------------------------------------------
export const EASE = {
  // Decelerate — the app's signature curve. Fast start, gentle settle.
  // Great for entrances, hovers, and most UI motion.
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  // Standard in/out — symmetric, neutral. Good for toggles and moves
  // where the element travels a fixed distance and stops.
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  // Spring — slight overshoot. Reserved for "pop" affordances (a control
  // grabbing focus, a button press releasing). Use sparingly.
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  // Linear — only for things that should feel mechanical (progress fills,
  // continuous sweeps) where easing would look like lag.
  linear: 'linear',
};

// ---- Durations ------------------------------------------------------------
// Kept short. Micro-interactions should feel instant-but-eased, not slow.
export const DUR = {
  fast: '120ms',   // taps, presses, tight hovers
  base: '180ms',   // default UI transition
  slow: '280ms',   // larger moves, panel/overlay entrances
  slower: '420ms', // hero moments (cover swap, fullscreen)
};

/**
 * Build a scoped transition string for a list of properties, all sharing
 * one duration + easing. Scoping (vs `transition: all`) keeps motion off
 * layout-triggering properties and avoids animating things unintentionally.
 *
 *   ui(['background', 'color'])                 → "background 180ms <out>, color 180ms <out>"
 *   ui(['transform'], DUR.fast, EASE.spring)    → "transform 120ms <spring>"
 */
export function ui(props, duration = DUR.base, easing = EASE.out) {
  const list = Array.isArray(props) ? props : [props];
  return list.map((p) => `${p} ${duration} ${easing}`).join(', ');
}

// A ready-made transition for the most common interactive surface
// (buttons, list rows, inputs): color/background/border + a lightly-sprung
// transform, none of which trigger layout.
export const INTERACTIVE = ui(
  ['background', 'border-color', 'color', 'box-shadow'],
  '150ms',
  EASE.out,
) + `, transform 150ms ${EASE.out}`;
