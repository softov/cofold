import { DEFAULT_MOUTH, defineCreature } from "../define.js";

/** The two loops of the doop logo, a `d` and a `p`, with the face between them. */
const D =
  "M 2105 270 V 2540 A 895 895 0 0 1 1210 3435 A 895 895 0 0 1 315 2540 A 895 895 0 0 1 1210 1645 A 895 895 0 0 1 2105 2540";
const P =
  "M 6359 4810 V 2540 A 895 895 0 0 1 7255 1645 A 895 895 0 0 1 8140 2540 A 895 895 0 0 1 7255 3435 A 895 895 0 0 1 6359 2540";

export default defineCreature({
  id: "logo",
  released: false,
  parts: () => [
    { d: D, width: 100 },
    { d: P, width: 100 },
  ],
  eyes: { centerX: 4240, centerY: 2540, gap: 1000, scale: 1 },
  mouth: DEFAULT_MOUTH,
  actions: [],
  turn: 0.03,
});
