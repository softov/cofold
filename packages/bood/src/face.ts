/**
 * The face: eyes, brows, mouths and the antenna, per mood. The same for every
 * body; a creature only says where each sits.
 */

import { faceColors } from "./color.js";
import { outline } from "./creatures/outline.js";
import type {
  AntennaPlacement,
  BoodCreature,
  BoodMood,
  BoodScheme,
  IrisPlacement,
  MouthShape,
} from "./types.js";

export const BOOD_MOODS: BoodMood[] = [
  "idle",
  "observing",
  "thinking",
  "planning",
  "executing",
  "reflecting",
  "waiting_external",
  "learning",
  "failed",
  "error",
  "neutral",
  "happy",
  "sad",
  "surprised",
];

/** The mood after this one, for a tap that steps through them. */
export function nextMood(mood: BoodMood): BoodMood {
  return BOOD_MOODS[
    (BOOD_MOODS.indexOf(mood) + 1) % BOOD_MOODS.length
  ] as BoodMood;
}

// Mouths.

export const DEFAULT_MOUTH_SHAPES: Record<BoodMood, MouthShape> = {
  // At rest and watching, the mouth is the small, nearly level one of waiting.
  idle: (x, y) => `M ${x - 328} ${y + 82} Q ${x} ${y + 115} ${x + 328} ${y + 82}`,
  observing: (x, y) =>
    `M ${x - 328} ${y + 82} Q ${x} ${y + 115} ${x + 328} ${y + 82}`,
  thinking: (x, y) =>
    `M ${x - 360} ${y + 20} Q ${x} ${y + 100} ${x + 360} ${y - 40}`,
  planning: (x, y) =>
    `M ${x - 410} ${y + 16} Q ${x} ${y + 279} ${x + 410} ${y + 16}`,
  executing: (x, y) => `M ${x - 410} ${y} Q ${x} ${y + 164} ${x + 410} ${y}`,
  reflecting: (x, y) =>
    `M ${x - 394} ${y + 33} Q ${x + 33} ${y + 246} ${x + 394} ${y + 33}`,
  waiting_external: (x, y) =>
    `M ${x - 328} ${y + 82} Q ${x} ${y + 115} ${x + 328} ${y + 82}`,
  learning: (x, y) =>
    `M ${x - 410} ${y - 16} Q ${x} ${y + 410} ${x + 410} ${y - 16}`,
  happy: (x, y) => `M ${x - 475} ${y} Q ${x} ${y + 325} ${x + 475} ${y}`,
  neutral: (x, y) => `M ${x - 410} ${y} H ${x + 410}`,
  sad: (x, y) =>
    `M ${x - 450} ${y + 210} Q ${x} ${y - 130} ${x + 450} ${y + 210}`,
  surprised: (x, y) => {
    const r = 150;
    return `M ${x} ${y} m -${r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0`;
  },
  error: (x, y) =>
    `M ${x - 390} ${y - 130} L ${x + 390} ${y + 130} M ${x + 390} ${y - 130} L ${x - 390} ${y + 130}`,
  failed: (x, y) =>
    `M ${x - 420} ${y} L ${x - 300} ${y - 75} L ${x - 150} ${y} L ${x} ${y - 75} L ${x + 150} ${y} L ${x + 300} ${y - 75}`,
};

const mouthColorByMood: Partial<Record<BoodMood, string>> = {
  waiting_external: "#F8E277",
  failed: "#F8E277",
  error: "#EF4444",
};

export function mouthColor(mood: BoodMood): string {
  return mouthColorByMood[mood] ?? "#60a5fa";
}

/** The mouth's path, or "" for a body with no mouth. */
export function mouthPath(creature: BoodCreature, mood: BoodMood): string {
  if (creature.mouth === false) return "";
  const { x, y, shapes } = creature.mouth;
  return (shapes?.[mood] ?? DEFAULT_MOUTH_SHAPES[mood])(x, y);
}

/** How much narrower a fully open mouth is than the mood's mouth. */
const TALK_NARROW = 0.3;
/** How tall a fully open mouth is in its middle, as a share of the mood's mouth's width. */
const TALK_HEIGHT = 0.5;
/**
 * How round the opening is across its width: below 1 the lips part almost as
 * far near the corners as in the middle, as a mouth saying "ah", where a plain
 * sine would come to a point at the bottom.
 */
const TALK_ROUND = 0.6;
/** How much of the opening the upper lip takes as it lifts; the lower lip drops the rest. */
const TALK_UPPER = 0.3;
/** Points along each lip, so every opening has the same commands and one blends into the next. */
const TALK_POINTS = 17;

/** The line a talking mouth opens from: the mood's mouth when it is one open curve, else a level line as wide. */
function lipLine(d: string): [number, number][] {
  const polygons = outline(d);
  const all = polygons.flat();
  const first = polygons[0];
  const curve =
    polygons.length === 1 && first !== undefined && first.length > 1 &&
    Math.hypot(first[0]![0] - first.at(-1)![0], first[0]![1] - first.at(-1)![1]) > 1;
  const left = Math.min(...all.map(([x]) => x));
  const right = Math.max(...all.map(([x]) => x));
  const sorted = curve ? [...first!].sort((a, b) => a[0] - b[0]) : [];
  // The curve's height at `x`, or the middle of the mouth for a level line.
  const middle = (Math.min(...all.map(([, y]) => y)) + Math.max(...all.map(([, y]) => y))) / 2;
  const at = (x: number): number => {
    if (!curve) return middle;
    const k = sorted.findIndex(([px]) => px >= x);
    if (k <= 0) return sorted[0]![1];
    const [x0, y0] = sorted[k - 1]!;
    const [x1, y1] = sorted[k]!;
    return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
  return Array.from({ length: TALK_POINTS }, (_, i) => {
    const x = left + ((right - left) * i) / (TALK_POINTS - 1);
    return [x, at(x)];
  });
}

/**
 * The mouth opened `open` of the way, from 0 (the mood's mouth as a line) to 1,
 * as it talks: it narrows toward its middle and opens most there, the lower
 * lip dropping and the upper lifting a little, as a mouth shaping a vowel.
 * A closed shape with the same commands at every opening, filled as well as
 * stroked, so a renderer can set it every frame or blend between two. "" for
 * a body with no mouth.
 */
export function mouthOpen(creature: BoodCreature, mood: BoodMood, open: number): string {
  const d = mouthPath(creature, mood);
  if (d === "") return "";
  const o = Math.max(0, Math.min(1, open));
  const line = lipLine(d);
  const left = line[0]![0];
  const right = line.at(-1)![0];
  const centre = (left + right) / 2;
  const height = TALK_HEIGHT * (right - left) * o;
  const squeeze = 1 - TALK_NARROW * o;
  const lip = (side: -1 | 1) =>
    line.map(([x, y], i) => {
      const swell = Math.sin((Math.PI * i) / (TALK_POINTS - 1)) ** TALK_ROUND;
      const share = side < 0 ? TALK_UPPER : 1 - TALK_UPPER;
      return `${Math.round(centre + (x - centre) * squeeze)} ${Math.round(y + side * share * height * swell)}`;
    });
  const upper = lip(-1);
  const lower = lip(1).reverse();
  return `M ${upper.join(" L ")} L ${lower.slice(1).join(" L ")} Z`;
}

// Eyes.

export interface EyeShape {
  rx: number;
  ry: number;
  offsetY?: number;
  rotate?: number;
  pupilRadius?: number;
  pupilDx?: number;
  pupilDy?: number;
}

export const eyeShapeByMood: Record<BoodMood, EyeShape> = {
  idle: { rx: 890, ry: 890, pupilRadius: 0.3, pupilDx: 0.5, pupilDy: 0.5 },
  observing: {
    rx: 890,
    ry: 890,
    pupilRadius: 0.3,
    pupilDx: 0.2,
    pupilDy: -0.5,
  },
  thinking: {
    rx: 890,
    ry: 880,
    pupilRadius: 0.4,
    rotate: 35,
    pupilDx: 0.5,
    pupilDy: -0.9,
  },
  planning: {
    rx: 850,
    ry: 650,
    pupilRadius: 0.2,
    rotate: 0,
    pupilDx: 0.8,
    pupilDy: 0.8,
  },
  executing: { rx: 890, ry: 520, pupilRadius: 0.3, pupilDx: 0.2, pupilDy: 0.5 },
  reflecting: {
    rx: 790,
    ry: 850,
    pupilRadius: 0.3,
    pupilDx: 0.2,
    pupilDy: -0.85,
  },
  waiting_external: {
    rx: 890,
    ry: 560,
    pupilRadius: 0.3,
    pupilDx: 0.2,
    pupilDy: 0.35,
    rotate: -5,
  },
  learning: { rx: 890, ry: 890, pupilRadius: 0.5, pupilDx: 0.2, pupilDy: 0.5 },
  failed: {
    rx: 650,
    ry: 750,
    pupilRadius: 0.25,
    pupilDx: -0.5,
    pupilDy: 0.65,
    rotate: 5,
  },
  error: { rx: 250, ry: 850, pupilRadius: 0.3, pupilDx: 0, pupilDy: 0 },
  happy: { rx: 890, ry: 890, pupilRadius: 0.45, pupilDx: 0.2, pupilDy: 0.55 },
  neutral: { rx: 890, ry: 890, pupilRadius: 0.3, pupilDx: 0.2, pupilDy: 0.5 },
  sad: {
    rx: 890,
    ry: 700,
    offsetY: 80,
    pupilRadius: 0.4,
    pupilDx: 0.2,
    pupilDy: 0.75,
  },
  surprised: { rx: 990, ry: 990, pupilRadius: 0.2, pupilDx: 0.2, pupilDy: 0.5 },
};

const eyeRingColorByMood: Partial<Record<BoodMood, string>> = {
  thinking: "#a78bfa",
  planning: "#818cf8",
  executing: "#60a5fa",
  reflecting: "#c4b5fd",
  observing: "#7dd3fc",
  learning: "#6ee7b7",
  waiting_external: "#94a3b8",
  failed: "#f87171",
  error: "#ef4444",
  sad: "#60a5fa",
  surprised: "#fbbf24",
};

const pupilColorByMood: Partial<Record<BoodMood, string>> = {
  thinking: "#7c3aed",
  planning: "#6366f1",
  executing: "#3b82f6",
  reflecting: "#8b5cf6",
  observing: "#0ea5e9",
  learning: "#10b981",
  waiting_external: "#64748b",
  failed: "#dc2626",
  error: "#b91c1c",
  sad: "#1e40af",
  surprised: "#f59e0b",
};

/** One eye's ring and pupil, with the pupil at rest for the mood. */
export interface EyeGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
  px: number;
  py: number;
  pr: number;
  ring: string;
  pupil: string;
}

function toOffset(value: number | undefined, max: number): number {
  if (value === undefined || max <= 0) return 0;
  return Math.sign(value) * Math.min(Math.abs(value), 1) * max;
}

/** Both eyes for a creature and mood: left first, the right one mirrored. */
export function eyeGeometry(
  creature: BoodCreature,
  mood: BoodMood,
  scheme: BoodScheme,
): [EyeGeometry, EyeGeometry] {
  const { centerX, centerY, gap, scale } = creature.eyes;
  const shape = eyeShapeByMood[mood];
  const base = 800;
  const pr = Math.min(base, Math.min(shape.pupilRadius ?? 0.1, 1) * base) * 0.8;
  const rx = shape.rx * scale;
  const ry = shape.ry * scale;
  const cy = centerY + (shape.offsetY ?? 0) * scale;
  const dx = toOffset(shape.pupilDx, Math.max(0, rx - pr - 80));
  const dy = toOffset(shape.pupilDy, Math.max(0, ry - pr - 80));
  const ring = eyeRingColorByMood[mood] ?? faceColors[scheme].eyeRing;
  const pupil = pupilColorByMood[mood] ?? faceColors[scheme].pupil;
  const rotate = shape.rotate ?? 0;
  return [
    {
      cx: centerX - gap,
      cy,
      rx,
      ry,
      rotate: -rotate,
      px: centerX - gap + dx,
      py: cy + dy,
      pr,
      ring,
      pupil,
    },
    {
      cx: centerX + gap,
      cy,
      rx,
      ry,
      rotate,
      px: centerX + gap - dx,
      py: cy + dy,
      pr,
      ring,
      pupil,
    },
  ];
}

/**
 * How far a pupil may wander from rest, in drawing units. With an iris, no
 * further than keeps the iris's pupil inside it, so one glance fits both kinds
 * of eye.
 */
export function pupilRoom(
  eye: EyeGeometry,
  iris?: IrisPlacement,
): { x: number; y: number } {
  const inIris = iris === undefined ? Infinity : iris.r - iris.pupil - 60;
  return {
    x: Math.max(0, Math.min(eye.rx - eye.pr - 60, inIris)),
    y: Math.max(0, Math.min(eye.ry - eye.pr - 60, inIris)),
  };
}

// Brows.

/** A pair of brows, drawn for the robot's eyes; `browTransform` moves them to a body's. */
export interface BrowPair {
  left: string;
  right: string;
  ms: number;
}

export const BROW_COLOR = "#F8E277";
export const BROW_WIDTH = 110;

export const browsByMood: Record<BoodMood, BrowPair> = {
  idle: {
    left: "M 2640 1680 Q 3240 1620 3840 1680",
    right: "M 4640 1680 Q 5240 1620 5840 1680",
    ms: 2400,
  },
  observing: {
    left: "M 2640 1680 Q 3240 1640 3840 1680",
    right: "M 4640 1640 Q 5240 1480 5840 1620",
    ms: 1400,
  },
  thinking: {
    left: "M 2640 1620 Q 3240 1700 3840 1790",
    right: "M 4640 1790 Q 5240 1700 5840 1620",
    ms: 1600,
  },
  planning: {
    left: "M 2640 1650 Q 3340 1680 3840 1750",
    right: "M 4640 1750 Q 5140 1680 5840 1650",
    ms: 1600,
  },
  executing: {
    left: "M 2640 1640 L 3840 1730",
    right: "M 4640 1730 L 5840 1640",
    ms: 800,
  },
  reflecting: {
    left: "M 2640 1700 Q 3240 1560 3840 1680",
    right: "M 4640 1680 Q 5240 1560 5840 1700",
    ms: 1600,
  },
  waiting_external: {
    left: "M 2640 1700 Q 3240 1770 3840 1720",
    right: "M 4640 1720 Q 5240 1770 5840 1700",
    ms: 3000,
  },
  learning: {
    left: "M 2640 1700 Q 3240 1500 3840 1650",
    right: "M 4640 1650 Q 5240 1500 5840 1700",
    ms: 1000,
  },
  failed: {
    left: "M 2640 1840 Q 3240 1700 3840 1700",
    right: "M 4640 1700 Q 5240 1700 5840 1840",
    ms: 5200,
  },
  error: {
    left: "M 2640 1480 L 3840 1820",
    right: "M 4640 1820 L 5840 1480",
    ms: 180,
  },
  happy: {
    left: "M 2640 1520 Q 3240 1280 3840 1460",
    right: "M 4640 1460 Q 5240 1280 5840 1520",
    ms: 1400,
  },
  neutral: {
    left: "M 2640 1680 L 3840 1680",
    right: "M 4640 1680 L 5840 1680",
    ms: 1600,
  },
  sad: {
    left: "M 2640 1820 Q 3240 1620 3840 1500",
    right: "M 4640 1500 Q 5240 1620 5840 1820",
    ms: 2600,
  },
  surprised: {
    left: "M 2640 1380 Q 3240 1160 3840 1300",
    right: "M 4640 1400 Q 5240 1160 5840 1380",
    ms: 600,
  },
};

/**
 * Moves the brows from the robot's eyes to a body's: they follow the eye
 * centre, spread with the gap and rise with the eye size.
 */
export function browTransform(creature: BoodCreature): string | undefined {
  const { centerX, centerY, gap, scale } = creature.eyes;
  if (centerX === 4240 && centerY === 2540 && gap === 1000 && scale === 0.75)
    return undefined;
  return `translate(${centerX} ${centerY}) scale(${gap / 1000} ${scale / 0.75}) translate(-4240 -2540)`;
}

// Antenna.

export type AntennaSwing = "gentle" | "alarm" | "none";

export interface AntennaConfig {
  swing: AntennaSwing;
  /** One pulse of the ring round the dot, in ms. */
  pulseMs: number;
  curviness?: number;
  rotation?: number;
  particles?: boolean;
  radar?: boolean;
  signalWave?: boolean;
  dotColor?: string;
  lineColor?: string;
}

export const antennaByMood: Record<BoodMood, AntennaConfig> = {
  idle: { swing: "gentle", pulseMs: 2400 },
  observing: { swing: "gentle", pulseMs: 1600, radar: true },
  thinking: {
    swing: "gentle",
    pulseMs: 1400,
    radar: true,
    particles: true,
    dotColor: "#DCDC00",
  },
  planning: { swing: "gentle", pulseMs: 1600, particles: true },
  executing: { swing: "gentle", pulseMs: 1000, dotColor: "#2f9e5b" },
  reflecting: { swing: "gentle", pulseMs: 2000, particles: true },
  waiting_external: { swing: "gentle", pulseMs: 2600, signalWave: true },
  learning: { swing: "gentle", pulseMs: 1800, particles: true },
  failed: {
    swing: "alarm",
    pulseMs: 600,
    curviness: 90,
    rotation: -80,
    lineColor: "#ef4444",
  },
  happy: { swing: "gentle", pulseMs: 2400 },
  neutral: { swing: "gentle", pulseMs: 2400 },
  sad: { swing: "none", pulseMs: 3200, curviness: -40, rotation: -25 },
  surprised: { swing: "gentle", pulseMs: 900 },
  error: {
    swing: "gentle",
    pulseMs: 600,
    curviness: -80,
    rotation: -25,
    dotColor: "#ef4444",
    lineColor: "#ef4444",
  },
};

export const ANTENNA_DOT_R = 150;

/** The antenna's stem, its dot centre and the point it turns on. */
export function antennaGeometry(
  at: AntennaPlacement,
  config: AntennaConfig,
): { stem: string; dotX: number; dotY: number; baseX: number; baseY: number } {
  const curve = config.curviness ?? 0;
  const baseX = at.x;
  const baseY = at.y + at.stemHeight;
  const stem =
    curve !== 0
      ? `M ${baseX} ${baseY} Q ${at.x + curve} ${at.y + at.stemHeight * 0.5} ${at.x} ${at.y}`
      : `M ${baseX} ${baseY} V ${at.y}`;
  return { stem, dotX: at.x, dotY: at.y - 140, baseX, baseY };
}
