import { defineCreature } from "../define.js";

/** A round heart: full lobes, a soft dip between them and a soft point below. */
const BODY =
  "M 4520 4560 Q 4250 4780 3980 4560 C 3000 3900 1700 3150 1700 2000 C 1700 1100 2400 450 3200 450 C 3700 450 4000 780 4120 1030 Q 4250 1230 4380 1030 C 4500 780 4800 450 5300 450 C 6100 450 6800 1100 6800 2000 C 6800 3150 5500 3900 4520 4560 Z";

export default defineCreature({
  id: "heart",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2250, gap: 850, scale: 0.7 },
  mouth: { x: 4250, y: 3150 },
  actions: ["beat", "aura"],
  turn: 0.07,
});
