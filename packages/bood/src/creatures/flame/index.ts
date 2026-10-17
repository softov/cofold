import { defineCreature } from "../define.js";
import type { Point } from "../draw.js";

/** One point of the outline and its two handles, each handle as an offset from the point. */
interface Anchor {
  p: Point;
  in: Point;
  out: Point;
}

/** A change to one anchor in a pose: where it goes, and the handles it takes there; a handle left out keeps its rest one. */
type Change = { p: Point; in?: Point; out?: Point };

/**
 * The flame at rest, clockwise from the middle tip: the right dip and tip, the
 * round base, the left tip and dip.
 */
const REST_POINTS: Point[] = [
  [4250, 300],
  [4900, 1500],
  [5300, 1250],
  [5950, 2700],
  [5800, 3900],
  [4250, 4750],
  [2700, 3900],
  [2550, 2600],
  [3100, 1600],
  [3500, 1900],
];
/** Where the top's anchors sit in the outline. */
const TIP = 0;
const DIP_R = 1;
const TIP_R = 2;
const TIP_L = 8;
const DIP_L = 9;

/** The rest outline's handles, as a smooth curve through its points would have them (Catmull-Rom). */
const REST: Anchor[] = REST_POINTS.map((p, i) => {
  const n = REST_POINTS.length;
  const before = REST_POINTS[(i - 1 + n) % n]!;
  const after = REST_POINTS[(i + 1) % n]!;
  const along: Point = [(after[0] - before[0]) / 6, (after[1] - before[1]) / 6];
  return { p, in: [-along[0], -along[1]], out: along };
});

/** The rest outline with some anchors changed. */
function pose(changes: Record<number, Change>): Anchor[] {
  return REST.map((rest, i) => {
    const change = changes[i];
    return change === undefined ? rest : { p: change.p, in: change.in ?? rest.in, out: change.out ?? rest.out };
  });
}

/**
 * The middle tongue leaning left, its tip hooking right: the left edge runs
 * straight up to the tip, the right edge goes hollow down to the right dip.
 */
const LEAN_LEFT = pose({
  [TIP]: { p: [4370, 300], in: [-380, 180], out: [260, 85] },
  [DIP_R]: { p: [5006, 1440], in: [-876, -276], out: [120, -150] },
  [DIP_L]: { p: [3482, 1848], out: [60, -560] },
});

/**
 * The middle tongue leaning right: the tip goes left and round, the left edge
 * goes hollow and bends up into it, the right edge runs straight down.
 */
const LEAN_RIGHT = pose({
  [TIP]: { p: [3878, 336], in: [-300, 288], out: [100, -90] },
  [DIP_L]: { p: [3494, 1860], in: [-156, 120], out: [660, -636] },
  [DIP_R]: { p: [5018, 1440] },
});

const mixPoint = (a: Point, b: Point, k: number): Point => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** The outline part of the way from one pose to another, handles turning with the points. */
const mix = (a: Anchor[], b: Anchor[], k: number): Anchor[] =>
  a.map((one, i) => ({ p: mixPoint(one.p, b[i]!.p, k), in: mixPoint(one.in, b[i]!.in, k), out: mixPoint(one.out, b[i]!.out, k) }));

/** An anchor moved by `[dx, dy]`, its handles with it. */
const moved = (anchor: Anchor, [dx, dy]: Point): Anchor => ({ ...anchor, p: [anchor.p[0] + dx, anchor.p[1] + dy] });

const r = Math.round;

/** The outline as cubic Beziers, one from each anchor to the next. */
function outline(anchors: Anchor[]): string {
  const n = anchors.length;
  let d = `M ${r(anchors[0]!.p[0])} ${r(anchors[0]!.p[1])}`;
  for (let i = 0; i < n; i += 1) {
    const from = anchors[i]!;
    const to = anchors[(i + 1) % n]!;
    d += ` C ${r(from.p[0] + from.out[0])} ${r(from.p[1] + from.out[1])} ${r(to.p[0] + to.in[0])} ${r(to.p[1] + to.in[1])} ${r(to.p[0])} ${r(to.p[1])}`;
  }
  return `${d} Z`;
}

/**
 * The flame at a lean, from -1 (right) through 0 (rest) to 1 (left), with the
 * side tips moved by their own offsets.
 */
export function flame(lean: number, left: Point = [0, 0], right: Point = [0, 0]): string {
  const leaned = lean >= 0 ? mix(REST, LEAN_LEFT, lean) : mix(REST, LEAN_RIGHT, -lean);
  leaned[TIP_L] = moved(leaned[TIP_L]!, left);
  leaned[TIP_R] = moved(leaned[TIP_R]!, right);
  return outline(leaned);
}

const BODY = flame(0);

/** How far the side tips bob from rest, as [dx, dy]. */
const SIDE_REACH: Point = [150, 180];

/** How many shapes one loop samples, enough that gliding between them reads as one smooth motion. */
const STEPS = 15;

/**
 * One random smooth path across a loop, from rest back to rest, never past
 * `reach` either way: three waves of random size added up, the largest sum
 * scaled to fit.
 */
function wander(reach: number): (t: number) => number {
  const waves = [1, 2, 3].map(() => Math.random() * 2 - 1);
  const most = waves.reduce((sum, wave) => sum + Math.abs(wave), 0) || 1;
  return (t) => (reach * waves.reduce((sum, wave, k) => sum + wave * Math.sin((k + 1) * Math.PI * t), 0)) / most;
}

/** The shapes of one loop: the middle tongue leaning one way and the other at random, the side tips bobbing, from rest to rest. */
function flicker(): string[] {
  const lean = wander(1);
  const left = [wander(SIDE_REACH[0]), wander(SIDE_REACH[1])] as const;
  const right = [wander(SIDE_REACH[0]), wander(SIDE_REACH[1])] as const;
  return Array.from({ length: STEPS }, (_, i) => {
    const t = (i + 1) / (STEPS + 1);
    return flame(lean(t), [left[0](t), left[1](t)], [right[0](t), right[1](t)]);
  });
}

export default defineCreature({
  id: "flame",
  released: true,
  name: "Ember",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 3300, gap: 750, scale: 0.66 },
  mouth: { x: 4250, y: 4100 },
  actions: ["flare", "wiggle"],
  flow: { frames: flicker, ms: 4000, glide: true },
  turn: 0.07,
});
