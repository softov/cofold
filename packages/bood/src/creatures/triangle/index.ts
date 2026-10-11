import { defineCreature } from "../define.js";

/** A triangle with wide round corners. */
export const TRIANGLE =
  "M 3521 1326 Q 4250 250 4979 1326 L 6571 3674 Q 7300 4750 6000 4750 L 2500 4750 Q 1200 4750 1929 3674 Z";

export default defineCreature({
  id: "triangle",
  released: true,
  parts: () => [{ d: TRIANGLE, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 3400, gap: 790, scale: 0.68 },
  mouth: { x: 4250, y: 4450 },
  actions: ["spin", "pyramid"],
  turn: 0.06,
});
