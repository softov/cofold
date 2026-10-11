import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** A wide rectangle with round corners. */
const BODY = rounded(
  [
    [1500, 1100],
    [7000, 1100],
    [7000, 4500],
    [1500, 4500],
  ],
  650,
);

export default defineCreature({
  id: "rectangle",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 850, scale: 0.7 },
  mouth: { x: 4250, y: 3600 },
  actions: ["squash", "jump"],
  turn: 0.05,
});
