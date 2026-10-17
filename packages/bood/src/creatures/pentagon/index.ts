import { defineCreature } from "../define.js";

/** A pentagon, point up, with round corners. */
const BODY =
  "M 3684 761 Q 4250 350 4816 761 L 5919 1562 Q 6485 1974 6269 2640 L 5848 3935 Q 5631 4601 4931 4601 L 3569 4601 Q 2869 4601 2652 3935 L 2231 2640 Q 2015 1974 2581 1562 Z";
/** The same pentagon with sharp corners, which `sharpen` shows. */
export const SHARP_PENTAGON =
  "M 4250 350 L 6485 1974 L 5631 4601 L 2869 4601 L 2015 1974 Z";

export default defineCreature({
  id: "pentagon",
  released: true,
  name: "Penta",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["cartwheel", "sharpen"],
  turn: 0.07,
});
