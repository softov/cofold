/** Easing curves as plain functions of `t` from 0 to 1, so any renderer paces the same. */

import type { BoodEasing } from "../types.js";

/** A CSS-style cubic Bézier through (0,0), (x1,y1), (x2,y2), (1,1). */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;
  return (x: number): number => {
    let t = x;
    // Newton steps find the curve's t for this x; eight are plenty at this scale.
    for (let i = 0; i < 8; i += 1) {
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(x1, x2, t) - x) / d;
    }
    return at(y1, y2, Math.min(1, Math.max(0, t)));
  };
}

const curves: Record<
  Exclude<BoodEasing, { steps: number }>,
  (t: number) => number
> = {
  linear: (t) => t,
  ease: bezier(0.25, 0.1, 0.25, 1),
  "ease-in": bezier(0.42, 0, 1, 1),
  "ease-out": bezier(0, 0, 0.58, 1),
  "ease-in-out": bezier(0.42, 0, 0.58, 1),
  "in-quad": (t) => t * t,
  "out-quad": (t) => t * (2 - t),
  "in-out-cubic": (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  // A damped wobble past the target and back, in place of a physical spring.
  spring: (t) => 1 - Math.exp(-6 * t) * Math.cos(10 * t),
  "soft-spring": (t) => 1 - Math.exp(-4 * t) * Math.cos(7 * t),
};

/** `t` from 0 to 1, paced by `easing`. The default is ease-in-out, as Animated's timing. */
export function ease(easing: BoodEasing | undefined, t: number): number {
  if (easing === undefined) return curves["ease-in-out"](t);
  if (typeof easing === "object") {
    return Math.min(1, Math.floor(t * easing.steps) / easing.steps);
  }
  return curves[easing](t);
}
