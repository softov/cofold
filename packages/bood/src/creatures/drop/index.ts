import { defineCreature } from "../define.js";

/** A drop of water: a round base under a soft point. */
const BODY =
  "M 4420 520 C 5000 1300 5950 1900 5950 3050 A 1700 1700 0 0 1 2550 3050 C 2550 1900 3500 1300 4080 520 Q 4250 290 4420 520 Z";

export default defineCreature({
  id: "drop",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 3150, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 4200 },
  actions: ["drip", "bubble"],
  turn: 0.08,
});
