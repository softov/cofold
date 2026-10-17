import { defineCreature } from "../define.js";
import { polar, rounded, smooth } from "../draw.js";

/** An egg, fuller at the bottom. */
const BODY = smooth(
  polar([4250, 2000], 16, (_, a) =>
    Math.sin(a) > 0 ? 1750 + 250 * Math.sin(a) : 1750,
  ).map(([x, y]) => [4250 + (x - 4250) * 0.92, y]),
);
/** The knot under it. */
const KNOT = rounded(
  [
    [4250, 3900],
    [4500, 4250],
    [4000, 4250],
  ],
  120,
);
const STRING = "M 4250 4250 C 4050 4500 4500 4650 4300 4950";

export default defineCreature({
  id: "balloon",
  released: true,
  name: "Floo",
  parts: () => [
    { d: BODY, width: 45, shape: true },
    { d: KNOT, width: 45, shape: true },
    { d: STRING, width: 60, detail: true, opacity: 0.6 },
  ],
  eyes: { centerX: 4250, centerY: 2200, gap: 750, scale: 0.68 },
  mouth: { x: 4250, y: 3050 },
  actions: ["float", "pop"],
  turn: 0.08,
});
