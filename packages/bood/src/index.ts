/**
 * @cofold/bood: the bood creatures, declared once and drawn anywhere.
 *
 * - `creatures`: one file each, under `creatures/<name>/`.
 * - `scene(body, options)`: a creature in a mood, as layers of plain SVG.
 * - `action`, `transit`, `ambient`, `pose`, `walk`, `blink`, `glance`: motion
 *   as keyframes on transform and opacity, which every platform animates off
 *   its main thread.
 * - `@cofold/bood/dom`: a renderer for the browser on the Web Animations API.
 */

export * from "./types.js";
export { BOOD_H, BOOD_W, FEET, MIDDLE, VIEW_BOX } from "./box.js";
export {
  BOOD_COLORS,
  FACE_INK,
  bodyBaseColor,
  bodyColor,
  darken,
  faceColors,
  lighten,
} from "./color.js";
export {
  ANTENNA_DOT_R,
  BOOD_MOODS,
  BROW_COLOR,
  BROW_WIDTH,
  antennaByMood,
  antennaGeometry,
  browTransform,
  browsByMood,
  eyeGeometry,
  eyeShapeByMood,
  mouthColor,
  mouthPath,
  nextMood,
  pupilRoom,
} from "./face.js";
export type {
  AntennaConfig,
  AntennaSwing,
  BrowPair,
  EyeGeometry,
  EyeShape,
} from "./face.js";
export {
  BOOD_ALIASES,
  BOOD_BODIES,
  BOOD_RELEASED,
  actionsOf,
  bodyOf,
  creatures,
} from "./creatures/index.js";
export { defineCreature } from "./creatures/define.js";
export { disc, polar, rounded, smooth } from "./creatures/draw.js";
export type { Point } from "./creatures/draw.js";
export { referenceScene, scene } from "./scene.js";
export type { SceneOptions } from "./scene.js";
export { sceneSvg, toSvg } from "./svg.js";
export {
  REST,
  all,
  move,
  repeat,
  seq,
  set,
  settle,
  timeline,
  to,
  wait,
} from "./motion/build.js";
export type { Step } from "./motion/build.js";
export { ease } from "./motion/ease.js";
export {
  cssFrames,
  cssTransform,
  sampleKeys,
  sampleTrack,
} from "./motion/sample.js";
export type { CssFrame } from "./motion/sample.js";
export { along, derived, reversed } from "./motion/derive.js";
export { BOOD_ACTIONS, action, antennaBase } from "./motion/actions.js";
export type { PlayOptions } from "./motion/actions.js";
export { BOOD_TRANSITS, randomTransit, transit } from "./motion/transits.js";
export {
  EYE_TILT_DEG,
  ambient,
  blink,
  eyeTilt,
  glance,
  pop,
  swing,
} from "./motion/ambient.js";
export { pose, walk } from "./motion/pose.js";
export type { BoodPose } from "./motion/pose.js";
