import { defineCreature } from "../define.js";

/** A square with round corners. */
export const SQUARE =
  "M 2200 1650 Q 2200 550 3300 550 L 5200 550 Q 6300 550 6300 1650 L 6300 3550 Q 6300 4650 5200 4650 L 3300 4650 Q 2200 4650 2200 3550 Z";

export default defineCreature({
  id: "square",
  released: true,
  name: "Cubbi",
  parts: () => [{ d: SQUARE, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["tumble", "rubik"],
  turn: 0.06,
});
