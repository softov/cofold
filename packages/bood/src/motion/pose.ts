/**
 * Where a body faces and how it walks.
 *
 * A flat drawing turns its head by moving its face: the eyes, brows and mouth
 * slide toward the side it looks at, the pupils go further, the antenna less,
 * and the outline narrows a little. That reads as a head turning in 3D while
 * every layer only moves and scales.
 */

import { BOOD_H as H, BOOD_W as W, FEET, MIDDLE } from "../box.js";
import { creatures } from "../creatures/index.js";
import { eyeGeometry, pupilRoom } from "../face.js";
import type {
  BoodBody,
  BoodChannel,
  BoodMood,
  BoodPlay,
  BoodTarget,
} from "../types.js";
import { all, move, repeat, seq, timeline, to } from "./build.js";
import { antennaBase } from "./actions.js";
import { eyeTilt } from "./ambient.js";

/** How a body holds its head. */
export interface BoodPose {
  /** Which side it faces, from -1 (its left, the viewer's left) to 1. */
  facing: number;
  /** How far it lifts its head, from -1 (down) to 1 (up). */
  lift?: number;
}

/** The most the head turns and lifts: 6 degrees and 8 px at 280 px wide, as ahpapp's head does. */
const LEAN_DEG = 6;
const LIFT = (8 / 280) * W;
/** How much a face narrows when the head is fully turned, as the side of a ball does. */
const SQUEEZE = 0.3;

/** The values each target holds for a pose. */
function values(
  body: BoodBody,
  mood: BoodMood,
  pose: BoodPose,
): Partial<Record<BoodTarget, Partial<Record<BoodChannel, number>>>> {
  const creature = creatures[body];
  const share = creature.turn ?? 0.07;
  const f = Math.max(-1, Math.min(1, pose.facing));
  const lift = Math.max(-1, Math.min(1, pose.lift ?? 0));
  const [left] = eyeGeometry(creature, mood, "dark");
  const room = pupilRoom(left);
  // The dot eyes lean with a sideways look, as a glance leans them.
  const tilt = eyeTilt(f, -lift);
  // The face slides toward the side it turns to and narrows about its middle,
  // so the eyes come closer together instead of sliding off a narrow body.
  return {
    face: {
      x: f * share * W * 0.4,
      y: -lift * LIFT * 0.6,
      sx: 1 - Math.abs(f) * SQUEEZE,
    },
    pupils: { x: f * room.x * 0.3, y: -lift * room.y * 0.4 },
    pupilL: { turn: tilt },
    pupilR: { turn: tilt },
    glints: { x: f * room.x * 0.3 },
    antenna: { x: f * share * W * 0.45 },
    body: { sx: 1 - Math.abs(f) * 0.04 },
    look: { turn: f * LEAN_DEG, y: -lift * LIFT },
  };
}

/** Each dot eye turns about its own middle. */
function eyeOrigins(
  body: BoodBody,
  mood: BoodMood,
): Partial<Record<BoodTarget, [number, number]>> {
  const [left, right] = eyeGeometry(creatures[body], mood, "dark");
  return { pupilL: [left.cx, left.cy], pupilR: [right.cx, right.cy] };
}

/** Moves from one pose to another over `ms`, and holds it. */
export function pose(
  body: BoodBody,
  mood: BoodMood,
  next: BoodPose,
  from: BoodPose = { facing: 0 },
  ms = 260,
): BoodPlay {
  const start = values(body, mood, from);
  const end = values(body, mood, next);
  const steps = (
    Object.entries(end) as [BoodTarget, Partial<Record<BoodChannel, number>>][]
  ).map(([target, channels]) => move(target, channels, ms, "ease-out"));
  return {
    timeline: timeline(all(...steps), {
      from: start,
      origins: {
        body: [W / 2, H / 2],
        look: MIDDLE,
        antenna: antennaBase(body),
        face: [creatures[body].eyes.centerX, creatures[body].eyes.centerY],
        ...eyeOrigins(body, mood),
      },
    }),
    layers: [],
    hold: true,
  };
}

/**
 * Steps in place, bobbing and rocking, while the host moves the body by
 * `travel` drawing units over the same time. Face the way first with `pose`.
 */
export function walk(
  direction: -1 | 1,
  options: { steps?: number; stepMs?: number } = {},
): { play: BoodPlay; travel: number } {
  const steps = options.steps ?? 4;
  const stepMs = options.stepMs ?? 320;
  const half = stepMs / 2;
  const step = repeat(steps, (i) =>
    seq(
      all(
        to("act", "y", -H * 0.05, half, "out-quad"),
        to("act", "turn", (i % 2 === 0 ? 3 : -3) * direction, half),
        move("act", { sx: 0.97, sy: 1.04 }, half),
      ),
      all(
        to("act", "y", 0, half, "in-quad"),
        to("act", "turn", 0, half),
        move("act", { sx: 1.04, sy: 0.95 }, half * 0.6),
      ),
    ),
  );
  return {
    play: {
      timeline: timeline(seq(step, move("act", { sx: 1, sy: 1 }, 120)), {
        origins: { act: FEET },
      }),
      layers: [],
    },
    travel: direction * steps * W * 0.12,
  };
}
