import { defineCreature } from "../define.js";
import { smooth } from "../draw.js";

/** A flame at a moment `t` of its flicker: a round base, a tongue to one side, a tip that moves. */
const flame = (t: number) =>
  smooth([
    [4250 + Math.sin(t) * 450, 300 + Math.cos(t * 1.7) * 120],
    [4900 + Math.sin(t + 1) * 150, 1500],
    [5300, 1250 + Math.sin(t * 2) * 200],
    [5950, 2700],
    [5800, 3900],
    [4250, 4750],
    [2700, 3900],
    [2550, 2600],
    [3100, 1600 + Math.cos(t) * 150],
    [3500, 1900],
    [3800, 1100],
  ]);

const BODY = flame(0);

export default defineCreature({
  id: "flame",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 3300, gap: 750, scale: 0.66 },
  mouth: { x: 4250, y: 4100 },
  actions: ["flare", "wiggle"],
  flow: { frames: [flame(1.5), flame(3), flame(4.5)], ms: 3400 },
  turn: 0.07,
});
