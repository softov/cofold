import { defineCreature } from "../define.js";
import { type Point, rounded } from "../draw.js";

/** An X: two thick arms with round ends, the face where they cross. */
const BODY = (() => {
  const [cx, cy, arm, half] = [4250, 2550, 2600, 950];
  const points: Point[] = [];
  for (let k = 0; k < 4; k += 1) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const [vx, vy] = [-uy, ux];
    // The arm's two outer corners, then the inner corner before the next arm.
    points.push([cx + ux * arm - vx * half, cy + uy * arm - vy * half]);
    points.push([cx + ux * arm + vx * half, cy + uy * arm + vy * half]);
    const b = a + Math.PI / 4;
    points.push([
      cx + Math.cos(b) * half * Math.SQRT2,
      cy + Math.sin(b) * half * Math.SQRT2,
    ]);
  }
  return rounded(
    points,
    points.map((_, i) => (i % 3 === 2 ? 250 : 520)),
  );
})();

export default defineCreature({
  id: "cross",
  released: true,
  name: "Exo",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2550, gap: 600, scale: 0.6 },
  mouth: { x: 4250, y: 3200 },
  actions: ["roll", "pop"],
  turn: 0.04,
});
