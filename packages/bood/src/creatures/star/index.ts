import { defineCreature } from "../define.js";
import { polar, rounded } from "../draw.js";

/** A chubby star: five short points with round tips and soft inner corners. */
const BODY = rounded(
  polar([4250, 2750], 10, (i) => (i % 2 === 0 ? 2450 : 1550)),
  Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 650 : 280)),
);

export default defineCreature({
  id: "star",
  released: true,
  name: "Stella",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2800, gap: 620, scale: 0.6 },
  mouth: { x: 4250, y: 3550 },
  actions: ["roll", "aura"],
  turn: 0.05,
});
