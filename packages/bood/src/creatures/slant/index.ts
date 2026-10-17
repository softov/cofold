import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** A parallelogram leaning right. */
const BODY = rounded(
  [
    [2700, 1200],
    [7100, 1200],
    [5800, 4500],
    [1400, 4500],
  ],
  550,
);

export default defineCreature({
  id: "slant",
  released: true,
  name: "Skew",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4300, centerY: 2600, gap: 800, scale: 0.7 },
  mouth: { x: 4250, y: 3550 },
  actions: ["haunt", "jump"],
  turn: 0.05,
});
