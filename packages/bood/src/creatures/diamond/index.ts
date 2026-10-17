import { defineCreature } from "../define.js";
import { rounded } from "../draw.js";

/** A losango: a rhombus standing on a point, taller than wide. */
const BODY = rounded(
  [
    [4250, 300],
    [6000, 2600],
    [4250, 4900],
    [2500, 2600],
  ],
  450,
);

export default defineCreature({
  id: "diamond",
  released: true,
  name: "Dia",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2450, gap: 620, scale: 0.62 },
  mouth: { x: 4250, y: 3350 },
  actions: ["tumble", "wiggle"],
  turn: 0.05,
});
