import { defineCreature } from "../define.js";

/** A fat crescent: a disc with a smaller one cut from its top right. The face sits in the thick part. */
const BODY = (() => {
  const [ax, ay, ar] = [4250, 2600, 2250];
  const [bx, by, br] = [5450, 1550, 1850];
  // Where the two circles cross.
  const d = Math.hypot(bx - ax, by - ay);
  const a = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(ar * ar - a * a);
  const [mx, my] = [ax + ((bx - ax) * a) / d, ay + ((by - ay) * a) / d];
  const p1 = `${Math.round(mx + (h * (by - ay)) / d)} ${Math.round(my - (h * (bx - ax)) / d)}`;
  const p2 = `${Math.round(mx - (h * (by - ay)) / d)} ${Math.round(my + (h * (bx - ax)) / d)}`;
  return `M ${p1} A ${ar} ${ar} 0 1 0 ${p2} A ${br} ${br} 0 0 1 ${p1} Z`;
})();

export default defineCreature({
  id: "moon",
  released: true,
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 3500, centerY: 3350, gap: 600, scale: 0.6 },
  mouth: { x: 3500, y: 4100 },
  actions: ["sway", "flip"],
  turn: 0.04,
});
