import { defineCreature } from "../define.js";
import { polar, rounded } from "../draw.js";

/** A sun of eight short spikes. */
const BODY = rounded(
  polar([4250, 2600], 16, (i) => (i % 2 === 0 ? 2400 : 1550)),
  Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 180 : 120)),
);

export default defineCreature({
  id: "burst",
  released: true,
  name: "Solar",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 650, scale: 0.64 },
  mouth: { x: 4250, y: 3350 },
  actions: ["rotate", "aura"],
  turn: 0.05,
});
