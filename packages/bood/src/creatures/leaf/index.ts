import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** A round square with one corner, at the bottom left, left almost sharp. */
const BODY = rounded(
  [
    [2250, 450],
    [6250, 450],
    [6250, 4800],
    [2250, 4800],
  ],
  [1800, 1800, 1800, 300],
);

export default defineCreature({
  id: "leaf",
  released: true,
  name: "Levi",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2450, gap: 700, scale: 0.66 },
  mouth: { x: 4250, y: 3450 },
  actions: ["wiggle", "vanish"],
  turn: 0.07,
});
