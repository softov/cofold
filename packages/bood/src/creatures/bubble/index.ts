import { defineCreature } from "../define.js";

/**
 * A round speech bubble with a triangle tail at the bottom right: the tail's
 * straight sides meet the circle in soft curves and end in a round tip.
 */
const BODY =
  "M 4819 4700 A 2200 2200 0 1 1 6155 3675 Q 6052 3837 6177 4090 L 6426 4599 Q 6550 4850 6273 4813 L 5389 4694 Q 5002 4642 4819 4700 Z";

export default defineCreature({
  id: "bubble",
  released: true,
  name: "Poppi",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2500, gap: 750, scale: 0.68 },
  mouth: { x: 4250, y: 3500 },
  actions: ["pop", "puff"],
  turn: 0.08,
});
