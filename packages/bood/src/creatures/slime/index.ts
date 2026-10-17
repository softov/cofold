import { defineCreature } from "../define.js";
import { type Point, perimeter, polar, smooth } from "../draw.js";

/**
 * Every outline the slime takes runs through the same 24 points, starting
 * straight up and going clockwise, so any one blends into any other. 24 falls
 * on the corners of the triangle (every 8th point) and the square (every 6th).
 */
const COUNT = 24;

/**
 * Slime at a moment `t` of its flow: one smooth outline, wider than tall,
 * resting on its base. Its radius is a sum of slow waves, and `t` moves their
 * phases, so the outline rolls round like jelly while the base stays put.
 */
const slime = (t: number) =>
  smooth(
    polar([4250, 2900], COUNT, (_, a) => {
      const wave =
        1 + 0.07 * Math.sin(2 * a + t) + 0.05 * Math.sin(3 * a - 1.3 * t + 1);
      return 1900 * wave;
    }).map(([x, y]): Point => {
      const dy = y - 2900;
      // Wider than tall, and flatter where it rests.
      return [4250 + (x - 4250) * 1.35, 2900 + dy * (dy > 0 ? 0.8 : 1.05)];
    }),
  );

/** The shapes it turns into now and then, each resting where the slime rests. */
const corners = (center: Point, k: number, from: number, n: number) =>
  Array.from({ length: n }, (_, i): Point => {
    const a = ((from + (i * 360) / n) * Math.PI) / 180;
    return [center[0] + Math.cos(a) * k, center[1] + Math.sin(a) * k];
  });
const TRIANGLE = smooth(perimeter(corners([4250, 3250], 2600, -90, 3), COUNT));
// From the middle of the top side, so its points start straight up as the others do.
const SQUARE = smooth(
  perimeter(
    [[4250, 950], ...corners([4250, 2850], 1900 * Math.SQRT2, -45, 4)],
    COUNT,
  ),
);
const CIRCLE = smooth(polar([4250, 2800], COUNT, () => 2000));

const BODY = slime(0);

/**
 * The loop: it flows, and now and then turns into a triangle, a circle or a
 * square, holds it a moment, and melts back. The order is uneven so it reads
 * as chance, but fixed, so a redraw on a mood change picks up where it was.
 */
const FLOW = [
  slime(1.3),
  slime(2.6),
  TRIANGLE,
  TRIANGLE,
  slime(3.9),
  slime(5.2),
  slime(6.5),
  CIRCLE,
  CIRCLE,
  slime(7.8),
  slime(9.1),
  SQUARE,
  SQUARE,
  slime(10.4),
  slime(11.7),
];
/** How long each step of the flow takes. */
const STEP_MS = 2600;

export default defineCreature({
  id: "slime",
  released: true,
  name: "Goo",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2700, gap: 800, scale: 0.72 },
  mouth: { x: 4250, y: 3700 },
  actions: ["wobble", "squash"],
  flow: { frames: () => FLOW, ms: (FLOW.length + 1) * STEP_MS },
  turn: 0.08,
});

/*
 * For a renderer that cannot redraw a path, such as React Native on its
 * native driver, the same jelly can be played with layer moves only: drop
 * `flow` and loop the body's stretch and lean, each step a different length
 * so the loop never looks mechanical. The outline then keeps its shape and
 * only stretches. Kept here for when the React Native renderer is tested.
 *
 * import { MIDDLE } from "../../box.js";
 * import { move, seq, timeline } from "../../motion/build.js";
 *
 * const stretch = (sx: number, sy: number, skew: number, ms: number) =>
 *   move("body", { sx, sy, skew }, ms, "ease-in-out");
 * export const slimeStretch = timeline(
 *   seq(
 *     stretch(1.06, 0.95, 3, 2300),
 *     stretch(0.97, 1.04, -2, 3100),
 *     stretch(1.03, 0.98, 1, 2700),
 *     stretch(1, 1, 0, 2900),
 *   ),
 *   { origins: { body: [MIDDLE[0], 4600] }, iterations: Infinity },
 * );
 */
