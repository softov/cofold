import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** A standing rectangle, like a phone. */
const BODY = rounded(
  [
    [2850, 200],
    [5650, 200],
    [5650, 4850],
    [2850, 4850],
  ],
  550,
);

export default defineCreature({
  id: "tall",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 1900, gap: 700, scale: 0.66 },
  mouth: { x: 4250, y: 2800 },
  actions: ["jump", "wiggle"],
  turn: 0.06,
});
