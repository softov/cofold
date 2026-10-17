import { defineCreature } from "../define.js";
import { smallMouth } from "../mouths.js";

/** A soft round head on a pinched neck and a wide foot. */
const BODY =
  "M 4250 280 C 6500 280, 7200 1700, 7050 2800 C 6950 3350, 5800 3500, 5400 3680 C 5200 3820, 5200 3980, 5400 4120 C 5800 4380, 5700 4750, 4250 4750 C 2800 4750, 2700 4380, 3100 4120 C 3300 3980, 3300 3820, 3100 3680 C 2700 3500, 1550 3350, 1450 2800 C 1300 1700, 2000 280, 4250 280 Z";
const LEFT_CHEEK = "M 2900 2400 C 2700 2700, 2700 3000, 2900 3200";
const RIGHT_CHEEK = "M 5600 2400 C 5800 2700, 5800 3000, 5600 3200";

export default defineCreature({
  id: "gumbo",
  released: true,
  name: "Gumbo",
  parts: () => [
    { d: BODY, width: 45, shape: true },
    { d: LEFT_CHEEK, width: 20, opacity: 0.35, detail: true },
    { d: RIGHT_CHEEK, width: 20, opacity: 0.35, detail: true },
  ],
  eyes: { centerX: 4250, centerY: 2150, gap: 1200, scale: 1.35 },
  mouth: { x: 4250, y: 3200, shapes: smallMouth },
  actions: ["wobble", "split"],
  turn: 0.08,
});
