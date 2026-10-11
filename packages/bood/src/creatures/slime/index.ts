import { defineCreature } from "../define.js";
import { polar, smooth } from "../draw.js";

/**
 * Slime at a moment `t` of its flow: one smooth outline, wider than tall,
 * resting on its base. Its radius is a sum of slow waves, and `t` moves their
 * phases, so the outline rolls round like jelly while the base stays put.
 */
const slime = (t: number) =>
  smooth(
    polar([4250, 2900], 28, (_, a) => {
      const wave =
        1 + 0.07 * Math.sin(2 * a + t) + 0.05 * Math.sin(3 * a - 1.3 * t + 1);
      return 1900 * wave;
    }).map(([x, y]) => {
      const dy = y - 2900;
      // Wider than tall, and flatter where it rests.
      return [4250 + (x - 4250) * 1.35, 2900 + dy * (dy > 0 ? 0.8 : 1.05)];
    }),
  );

const BODY = slime(0);

export default defineCreature({
  id: "slime",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2700, gap: 800, scale: 0.72 },
  mouth: { x: 4250, y: 3700 },
  actions: ["wobble", "squash"],
  flow: { frames: [slime(1.6), slime(3.2), slime(4.8)], ms: 7000 },
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
