import type { Point } from "../draw.js";
import { defineCreature } from "../define.js";
import { smallMouth } from "../mouths.js";

/**
 * A paper clip standing on its big loop, the narrow bend on top and both ends
 * of the wire pointing up. Its eyes sit on the two wires under the top bend. The wire is
 * a tube round a centre line, so the clip bends as wire does: everything above
 * the pivot curves into an arc and the face rides the top.
 */

/** Half the wire's thickness. */
const HALF = 85;
/** The middle of the clip, which the bend curves away from. */
const AXIS = 4250;
/** Below this height the clip holds still as it bends. */
const PIVOT = 3600;
/** The top of the clip, where a bend has turned its full angle. */
const TOP = 450;
/** Points per half turn of the wire, and the longest straight piece between two points. */
const ARC_STEPS = 20;
const LINE_STEP = 150;
/** Points round each rounded end of the wire. */
const CAP_STEPS = 6;

/** The wire's centre line as straight runs and half turns, from the outer end round to the inner one. */
type Piece =
  | { line: [Point, Point] }
  | { arc: { center: Point; r: number; from: number; to: number } };
const PIECES: Piece[] = [
  { line: [[5000, 1900], [5000, 3950]] },
  { arc: { center: [4250, 3950], r: 750, from: 0, to: Math.PI } },
  { line: [[3500, 3950], [3500, 1000]] },
  { arc: { center: [4050, 1000], r: 550, from: Math.PI, to: 2 * Math.PI } },
  { line: [[4600, 1000], [4600, 3500]] },
  { arc: { center: [4250, 3500], r: 350, from: 0, to: Math.PI } },
  { line: [[3900, 3500], [3900, 2300]] },
];

const CENTRE: Point[] = [
  ...PIECES.flatMap((piece): Point[] => {
    if ("line" in piece) {
      const [[x0, y0], [x1, y1]] = piece.line;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / LINE_STEP));
      return Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    }
    const { center, r, from, to } = piece.arc;
    return Array.from({ length: ARC_STEPS }, (_, i) => {
      const t = from + ((to - from) * i) / ARC_STEPS;
      return [center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)];
    });
  }),
  [3900, 2300],
];

/**
 * Where a point goes when the top turns `angle` degrees: the line through the
 * middle bends into an arc of that angle from the pivot to the top, and each
 * point keeps its distance across it. The third value is how far it turns there.
 */
function bent(angle: number, x: number, y: number): [number, number, number] {
  const along = PIVOT - y;
  const theta = (angle * Math.PI) / 180;
  if (along <= 0 || Math.abs(theta) < 1e-6) return [x, y, 0];
  const k = theta / (PIVOT - TOP);
  const phi = k * along;
  const across = x - AXIS;
  return [
    AXIS + (1 - Math.cos(phi)) / k + across * Math.cos(phi),
    PIVOT - Math.sin(phi) / k + across * Math.sin(phi),
    (phi * 180) / Math.PI,
  ];
}

/** The tube round a centre line, as one closed outline: one side, the far end, the other side back, the near end. */
function tube(line: Point[]): string {
  const n = line.length;
  const tangent = (i: number): Point => {
    const a = line[Math.max(0, i - 1)] as Point;
    const b = line[Math.min(n - 1, i + 1)] as Point;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  const side = (sign: 1 | -1) =>
    line.map(([x, y], i): Point => {
      const [tx, ty] = tangent(i);
      return [x - sign * ty * HALF, y + sign * tx * HALF];
    });
  // An end of the wire, round from one side to the other through the point `out` faces.
  const cap = ([x, y]: Point, [tx, ty]: Point, out: 1 | -1): Point[] =>
    Array.from({ length: CAP_STEPS - 1 }, (_, k) => {
      const t = (Math.PI * (k + 1)) / CAP_STEPS;
      const [nx, ny] = [-ty * out, tx * out];
      return [x + (Math.cos(t) * nx + Math.sin(t) * tx * out) * HALF, y + (Math.cos(t) * ny + Math.sin(t) * ty * out) * HALF];
    });
  const left = side(1);
  const right = side(-1);
  const points = [
    ...left,
    ...cap(line[n - 1] as Point, tangent(n - 1), 1),
    ...right.reverse(),
    ...cap(line[0] as Point, tangent(0), -1),
  ];
  return `M ${points.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join(" L ")} Z`;
}

function outline(angle: number): string {
  return tube(CENTRE.map(([x, y]) => bent(angle, x, y).slice(0, 2) as Point));
}

const WIRE = outline(0);

export default defineCreature({
  id: "clip",
  released: true,
  name: "Clip",
  parts: () => [{ d: WIRE, width: 45, shape: true }],
  eyes: { centerX: 4050, centerY: 1350, gap: 550, scale: 0.5 },
  mouth: { x: 4050, y: 1960, shapes: smallMouth },
  bareFace: true,
  googly: true,
  actions: ["bend", "lean", "twirl", "knock", "jump"],
  bend: { outline, point: bent },
  // Its face slides less than a round body's, so the eyes stay over the wire as it turns.
  turn: 0.04,
});
