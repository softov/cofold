import { defineCreature } from "../define.js";
import { rounded, smooth } from "../draw.js";

/** A smooth pebble: a few flat sides barely showing under big round corners. */
const BODY = rounded(
  [
    [2050, 4550],
    [1750, 3250],
    [2550, 1950],
    [4300, 1450],
    [5950, 1750],
    [6800, 2950],
    [6550, 4400],
    [4500, 4700],
  ],
  [700, 800, 900, 1000, 900, 800, 700, 1000],
);
/** Its top, a little lit. */
const TOP = smooth([
  [2900, 2150],
  [4300, 1700],
  [5700, 1950],
  [5100, 2350],
  [3700, 2450],
]);

export default defineCreature({
  id: "rock",
  released: true,
  parts: () => [
    { d: BODY, width: 45, shape: true },
    { d: TOP, width: 30, light: true, detail: true, opacity: 0.35 },
  ],
  eyes: { centerX: 4250, centerY: 3100, gap: 850, scale: 0.7 },
  mouth: { x: 4250, y: 3950 },
  actions: ["thud", "shakeGrow"],
  turn: 0.06,
});
