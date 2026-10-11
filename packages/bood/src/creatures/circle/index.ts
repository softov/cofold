import { defineCreature } from "../define.js";

/** A circle round the middle of the box. */
export const CIRCLE =
  "M 4250 400 A 2150 2150 0 0 1 4250 4700 A 2150 2150 0 0 1 4250 400 Z";

export default defineCreature({
  id: "circle",
  released: true,
  parts: () => [{ d: CIRCLE, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2350, gap: 900, scale: 0.7 },
  mouth: { x: 4250, y: 3550 },
  actions: ["roll", "pop"],
  turn: 0.09,
});
