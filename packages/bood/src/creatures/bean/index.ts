import { defineCreature } from "../define.js";

/** A bean, the left lobe smaller than the right. */
const BODY =
  "M 4400 1350 C 5000 1450 5500 750 6250 900 C 7150 1100 7300 2300 6950 3200 C 6550 4250 5300 4600 4000 4550 C 2600 4500 1450 3900 1350 2850 C 1250 1750 2100 950 3100 1000 C 3700 1030 3900 1270 4400 1350 Z";

export default defineCreature({
  id: "bean",
  released: true,
  name: "Beni",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["wiggle", "jump"],
  turn: 0.08,
});
