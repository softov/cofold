import { defineCreature } from "../define.js";
import { disc, rounded } from "../draw.js";

/** A slice, its point down. */
const BODY = rounded(
  [
    [1700, 900],
    [6800, 900],
    [4250, 4850],
  ],
  [500, 500, 350],
);
/** The crust along the top. */
const CRUST =
  "M 1950 750 Q 4250 350 6550 750 Q 6950 820 6800 1150 Q 6700 1400 6400 1350 Q 4250 1050 2100 1350 Q 1800 1400 1700 1150 Q 1550 820 1950 750 Z";
const PEPPERONI = [
  disc(2850, 1750, 300),
  disc(5650, 1750, 300),
  disc(4250, 4000, 220),
];

export default defineCreature({
  id: "pizza",
  released: true,
  name: "Peppo",
  parts: () => [
    { d: BODY, width: 45, shape: true },
    { d: CRUST, width: 45, shape: true, dark: true },
    ...PEPPERONI.map((d) => ({ d, width: 30, detail: true, dark: true })),
  ],
  eyes: { centerX: 4250, centerY: 2700, gap: 700, scale: 0.66 },
  mouth: { x: 4250, y: 3400 },
  actions: ["flip", "wiggle"],
  turn: 0.05,
});
