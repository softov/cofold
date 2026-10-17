import { defineCreature } from "../define.js";

/** A dome over straight sides and three round hems. */
const BODY =
  "M 6050 2100 L 6050 4150 A 600 600 0 0 1 4850 4150 A 600 600 0 0 1 3650 4150 A 600 600 0 0 1 2450 4150 L 2450 2100 A 1800 1800 0 0 1 6050 2100 Z";

export default defineCreature({
  id: "ghost",
  released: true,
  name: "Boozi",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["vanish", "haunt"],
  turn: 0.08,
});
