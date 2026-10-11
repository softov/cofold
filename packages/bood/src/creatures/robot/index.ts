import { DEFAULT_MOUTH, defineCreature } from "../define.js";

/** A rounded screen with an antenna on top. */
const BODY =
  "M 2246 1392 H 6320 Q 6542 1392 6542 1827 V 3393 Q 6542 4444 6320 4444 H 2246 Q 1930 4444 1930 3393 V 1827 Q 1930 1392 2246 1392 Z";

export default defineCreature({
  id: "robot",
  released: true,
  parts: () => [{ d: BODY, width: 50, shape: true }],
  eyes: { centerX: 4240, centerY: 2540, gap: 1000, scale: 0.75 },
  mouth: DEFAULT_MOUTH,
  antenna: { x: 4250, y: 720, stemHeight: 650 },
  actions: ["reboot", "radar"],
  turn: 0.06,
});
