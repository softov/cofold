import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** The triangle's cousin: a right triangle, straight up the left side and sloping down to the right. */
const BODY = rounded(
  [
    [2700, 300],
    [6400, 4750],
    [2700, 4750],
  ],
  [450, 500, 500],
);

export default defineCreature({
  id: "wedge",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 3800, centerY: 3300, gap: 550, scale: 0.6 },
  mouth: { x: 3800, y: 4100 },
  actions: ["pyramid", "cartwheel"],
  turn: 0.04,
});
