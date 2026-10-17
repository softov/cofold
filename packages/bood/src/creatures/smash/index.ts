import { defineCreature } from "../define.js";

/** A half circle on a flat base, its two bottom corners rounded. */
const BODY =
  "M 2000 4550 L 6500 4550 Q 6950 4550 6950 4100 A 2700 2700 0 0 0 1550 4100 Q 1550 4550 2000 4550 Z";

export default defineCreature({
  id: "smash",
  released: true,
  name: "Half",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2950, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 4000 },
  actions: ["squash", "flip"],
  turn: 0.08,
});
