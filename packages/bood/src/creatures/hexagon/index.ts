import { defineCreature } from "../define.js";

/** A hexagon, point up, with round corners. */
const BODY =
  "M 3687 525 Q 4250 200 4813 525 L 5722 1050 Q 6285 1375 6285 2025 L 6285 3075 Q 6285 3725 5722 4050 L 4813 4575 Q 4250 4900 3687 4575 L 2778 4050 Q 2215 3725 2215 3075 L 2215 2025 Q 2215 1375 2778 1050 Z";

export default defineCreature({
  id: "hexagon",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["rotate", "aura"],
  turn: 0.07,
});
