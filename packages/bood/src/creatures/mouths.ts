/** Mouths that more than one body shares, beside the default ones in `face.ts`. */

import type { BoodMood, MouthShape } from "../types.js";

const slit: MouthShape = (x, y) => `M ${x - 110} ${y} L ${x + 110} ${y}`;
const openOval: MouthShape = (x, y) => {
  const rx = 70;
  const ry = 95;
  return `M ${x - rx} ${y} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 -${rx * 2} 0`;
};
const jagged: MouthShape = (x, y) =>
  `M ${x - 120} ${y} L ${x - 60} ${y - 40} L ${x} ${y + 30} L ${x + 60} ${y - 40} L ${x + 120} ${y}`;

/** The alien's and gumbo's small mouth. */
export const smallMouth: Partial<Record<BoodMood, MouthShape>> = {
  idle: slit,
  observing: slit,
  thinking: slit,
  planning: slit,
  executing: slit,
  reflecting: slit,
  waiting_external: slit,
  learning: slit,
  neutral: slit,
  sad: slit,
  failed: jagged,
  error: jagged,
  happy: openOval,
  surprised: openOval,
};
