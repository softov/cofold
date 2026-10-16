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
import { insideOutline, outline } from "../creatures/outline.js";
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

/** How a body holds its head. */
export interface BoodPose {
  /** Which side it faces, from -1 (its left, the viewer's left) to 1. */
  facing: number;
  /** How far it lifts its head, from -1 (down) to 1 (up). */
  lift?: number;
  /** How far it tilts its head without looking anywhere, from -1 (to the viewer's left) to 1 (to the right). */
  tilt?: number;
}

/**
 * The most the head turns for a look. It turns away from the side it looks to
 * when it looks up, as a face on a ball rolls up and over, and the other way
 * when it looks down: up and left turns it clockwise.
 */
const LEAN_DEG = 18;
/** The most a tilt leans the head, in degrees. */
const TILT_DEG = 16;
/** The most the head lifts, 8 px at 280 px wide, as ahpapp's head does. */
const LIFT = (8 / 280) * W;
/**
 * How far the face slides up or down at full lift, as a share of the drawing's
 * height, for a body of the default turn; a body that turns less slides less
 * up and down too. The head's own lift adds to it.
 */
const SLIDE_Y = 0.1;
const DEFAULT_TURN = 0.07;
/** How much a face narrows when the head is fully turned, as the side of a ball does. */
const SQUEEZE = 0.3;
/** How much the body narrows when the head is fully turned. */
const BODY_SQUEEZE = 0.04;
/** How far a pupil moves inside its eye for a look, as a share of its room. */
const PUPIL_X = 0.3;
const PUPIL_Y = 0.4;
/** The body kept round each eye, in drawing units: about 4 px on a body drawn 130 px wide. */
const EYE_MARGIN = 260;
/** How much of a body's room up and down a face may use. */
const ROOM_USED = 0.7;

/** How far a face may slide, in drawing units: sideways at a full turn, and up and down at a full lift. */
export interface FaceRoom {
  side: number;
  up: number;
  down: number;
}

/** Each body's room in each mood, worked out once. */
const rooms = new Map<string, FaceRoom>();

/**
 * How far a face may slide before an eye, with a margin of body round it,
 * leaves the outline: sideways up to the body's turn share, then up and down
 * at every facing a look can take. Each body keeps its eyes in another place,
 * so one share cannot fit them all: a body whose eyes sit near its top has
 * little room to look up, and a narrow one little room to turn.
 */
export function faceRoom(body: BoodBody, mood: BoodMood): FaceRoom {
  const key = `${body}:${mood}`;
  const held = rooms.get(key);
  if (held !== undefined) return held;
  const creature = creatures[body];
  const shape = creature.parts(mood).filter((part) => part.shape).flatMap((part) => outline(part.d));
  const share = creature.turn ?? DEFAULT_TURN;
  const [left, right] = eyeGeometry(creature, mood, "dark");
  const room = pupilRoom(left, creature.iris);
  const { centerX, centerY } = creature.eyes;
  const iris = creature.iris;
  // Whether both eyes sit inside the body for a face slid `side` at a full turn and `y`, at facing `f` and lift `lift`.
  const fits = (f: number, side: number, lift: number, y: number): boolean => {
    const face = 1 - Math.abs(f) * SQUEEZE;
    const bodyScale = 1 - Math.abs(f) * BODY_SQUEEZE;
    return [left, right].every((eye) => {
      const rx = (iris === undefined ? eye.rx * 0.3 : iris.r) + EYE_MARGIN;
      const ry = (iris === undefined ? eye.ry * 0.45 : iris.r) + EYE_MARGIN;
      const pupil = iris === undefined ? 1 : 0;
      const x = centerX + (eye.cx - centerX) * face + f * side + pupil * f * room.x * PUPIL_X;
      const cy = (iris === undefined ? eye.cy : centerY) + y - pupil * lift * room.y * PUPIL_Y;
      for (let a = 0; a < 16; a += 1) {
        const t = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(t) * rx * face;
        const py = cy + Math.sin(t) * ry;
        if (!insideOutline(shape, W / 2 + (px - W / 2) / bodyScale, py)) return false;
      }
      return true;
    });
  };
  // The largest value in [0, top] that `ok` takes, by ten halvings: a few units, far finer than anyone sees.
  const largest = (top: number, ok: (value: number) => boolean): number => {
    if (ok(top)) return top;
    if (!ok(0)) return 0;
    let lo = 0;
    let hi = top;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const side = largest(share * W, (s) => fits(-1, s, 0, 0) && fits(1, s, 0, 0));
  const most = (up: boolean): number =>
    largest(H / 2, (y) => [-1, 0, 1].every((f) => fits(f, side, up ? 1 : -1, up ? -y : y))) * ROOM_USED;
  const answer = { side, up: most(true), down: most(false) };
  rooms.set(key, answer);
  return answer;
}

/** The values each target holds for a pose. */
function values(
  body: BoodBody,
  mood: BoodMood,
  pose: BoodPose,
): Partial<Record<BoodTarget, Partial<Record<BoodChannel, number>>>> {
  const creature = creatures[body];
  const share = creature.turn ?? DEFAULT_TURN;
  const f = Math.max(-1, Math.min(1, pose.facing));
  const lift = Math.max(-1, Math.min(1, pose.lift ?? 0));
  const tilt = Math.max(-1, Math.min(1, pose.tilt ?? 0));
  const [left] = eyeGeometry(creature, mood, "dark");
  const room = pupilRoom(left, creature.iris);
  const reach = faceRoom(body, mood);
  const down = Math.max(0, -lift);
  // The face slides toward where it looks and narrows about its middle, so the
  // eyes come closer together instead of sliding off a narrow body. The dot
  // eyes lean with the head's turn and no further.
  return {
    face: {
      x: f * reach.side,
      // As far as the share says, but never so far that an eye leaves this body.
      y: Math.max(-reach.up, Math.min(reach.down, -lift * SLIDE_Y * (share / DEFAULT_TURN) * H)),
      sx: 1 - Math.abs(f) * SQUEEZE,
    },
    pupils: { x: f * room.x * PUPIL_X, y: -lift * room.y * PUPIL_Y },
    glints: { x: f * room.x * PUPIL_X },
    antenna: { x: f * reach.side * 1.1 },
    body: { sx: 1 - Math.abs(f) * BODY_SQUEEZE },
    look: { turn: -f * LEAN_DEG * (1 - 2 * down) + tilt * TILT_DEG, y: -lift * LIFT },
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
