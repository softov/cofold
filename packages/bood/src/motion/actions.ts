/**
 * Each body's moves, ported from ahpapp's `Bood.tsx` step for step. Sizes are
 * in drawing units: `W` and `H` stand where that code had the body's pixels.
 */

import { BOOD_H as H, BOOD_W as W, FEET, MIDDLE } from "../box.js";
import { creatures } from "../creatures/index.js";
import { CIRCLE } from "../creatures/circle/index.js";
import { SHARP_PENTAGON } from "../creatures/pentagon/index.js";
import { SQUARE } from "../creatures/square/index.js";
import { TRIANGLE } from "../creatures/triangle/index.js";
import { eyeGeometry, pupilRoom } from "../face.js";
import type {
  BoodAction,
  BoodBody,
  BoodLayer,
  BoodPlay,
  BoodTarget,
} from "../types.js";
import {
  all,
  move,
  repeat,
  seq,
  set,
  settle,
  type Step,
  timeline,
  to,
  wait,
} from "./build.js";

export interface PlayOptions {
  /** The body colour, for the effects a move draws. */
  color: string;
  filled?: boolean;
}

/** Every move, in the order the playground lists them. */
export const BOOD_ACTIONS: BoodAction[] = [
  "reboot",
  "radar",
  "faceShift",
  "shakeGrow",
  "vanish",
  "haunt",
  "teleport",
  "scan",
  "wobble",
  "split",
  "roll",
  "pop",
  "shapes",
  "squash",
  "flip",
  "tumble",
  "rubik",
  "spin",
  "pyramid",
  "cartwheel",
  "sharpen",
  "rotate",
  "aura",
  "drip",
  "bubble",
  "wiggle",
  "jump",
  "fart",
  "puff",
  "thud",
  "flare",
  "sway",
  "float",
  "beat",
];

const act = "act";
/** Where a body that rocks on its base turns: the middle of its bottom edge. */
const BASE: [number, number] = [W / 2, H * 0.94];
const TRIANGLE_MIDDLE: [number, number] = [4250, 3350];
const DROP_TIP: [number, number] = [4250, 430];
const PUFF = [
  { x: 1500, y: 4500, r: 260 },
  { x: 1150, y: 4280, r: 200 },
  { x: 1250, y: 4760, r: 160 },
];
/** Cubbi's four pieces, the square cut in quarters with a gap between. */
const RUBIK = [
  { x: 2200, y: 550 },
  { x: 4320, y: 550 },
  { x: 4320, y: 2670 },
  { x: 2200, y: 2670 },
];
/** The colours Cubbi's pieces start from, before they match the body. */
const SCRAMBLE = ["#d7263d", "#f59e0b", "#2f6fdf", "#2f9e5b", "#7c4fe0"];

const size = (v: number, ms: number, easing?: Parameters<typeof to>[4]) =>
  move(act, { sx: v, sy: v }, ms, easing);
const squish = () =>
  all(
    seq(to(act, "sx", 1.12, 175), to(act, "sx", 1, 175)),
    seq(to(act, "sy", 0.88, 175), to(act, "sy", 1, 175)),
  );
const jitter = (n: number, ms: number) =>
  seq(
    repeat(n, (i) =>
      to(act, "x", (i % 2 === 0 ? 1 : -1) * W * 0.03, ms, "linear"),
    ),
    to(act, "x", 0, ms),
  );
/** Turns in `n` steps of `deg`, with a hop on each when `hop`. */
const steps = (
  n: number,
  deg: number,
  ms: number,
  pause: number,
  hop: boolean,
  easing?: Parameters<typeof to>[4],
) =>
  seq(
    repeat(n, (i) =>
      seq(
        all(
          to(act, "turn", (i + 1) * deg, ms, easing),
          ...(hop
            ? [seq(to(act, "y", -H * 0.06, ms / 2), to(act, "y", 0, ms / 2))]
            : []),
        ),
        wait(pause),
      ),
    ),
    set(act, "turn", 0),
  );

const shapePath = (d: string, color: string, filled: boolean, width = 45) => ({
  tag: "path" as const,
  attrs: {
    d,
    fill: filled ? color : "none",
    stroke: color,
    "stroke-width": width,
    "stroke-linejoin": "round",
  },
});

/** One move of one body, with the effect layers it draws. */
export function action(
  body: BoodBody,
  name: BoodAction,
  options: PlayOptions,
): BoodPlay {
  const creature = creatures[body];
  const [left] = eyeGeometry(creature, "idle", "dark");
  const reach = pupilRoom(left, creature.iris).x;
  const { color } = options;
  const filled = options.filled ?? false;
  const layers: BoodLayer[] = [];
  let origin: [number, number] = MIDDLE;
  const origins: Partial<Record<BoodTarget, [number, number]>> = {};
  let step: Step;

  switch (name) {
    case "reboot":
      step = seq(
        to("eyes", "opacity", 0, 150),
        to("antenna", "turn", 35, 260),
        jitter(8, 50),
        wait(350),
        to("eyes", "opacity", 0.6, 80),
        to("eyes", "opacity", 0, 80),
        to("eyes", "opacity", 1, 120),
        to("antenna", "turn", 0, 300),
      );
      break;
    case "radar":
      step = seq(
        ...[-30, 30, -30, 0].map((deg) =>
          all(
            to("antenna", "turn", deg, 500),
            to("pupils", "x", (deg / 30) * reach, 500),
          ),
        ),
      );
      break;
    case "faceShift":
      step = seq(
        all(
          to("pupils", "x", reach, 300),
          to(act, "sx", 1.06, 300),
          to(act, "x", W * 0.02, 300),
        ),
        wait(400),
        all(to("pupils", "x", -reach, 400), to(act, "x", -W * 0.02, 400)),
        wait(400),
        all(
          to("pupils", "x", 0, 300),
          to(act, "sx", 1, 300),
          to(act, "x", 0, 300),
        ),
      );
      break;
    case "shakeGrow":
      step = repeat(3, () =>
        seq(
          ...[-7, 0, 7, 0].map((deg) =>
            all(to(act, "turn", deg, 110), size(deg === 0 ? 1 : 1.05, 110)),
          ),
        ),
      );
      break;
    case "vanish":
      step = seq(
        all(
          to(act, "x", W * 0.3, 800),
          to(act, "y", -H * 0.3, 800),
          size(0.45, 800),
          to(act, "opacity", 0.3, 800),
          to(act, "turn", 25, 800),
        ),
        all(to(act, "opacity", 0, 250), to(act, "turn", 35, 250)),
        wait(350),
        all(
          set(act, "x", -W * 0.45),
          set(act, "y", 0),
          size(0.7, 0),
          set(act, "turn", 20),
        ),
        all(
          to(act, "opacity", 1, 500),
          to(act, "x", 0, 700, "ease-out"),
          size(1, 700),
          seq(to(act, "turn", -12, 500), to(act, "turn", 0, 450, "spring")),
        ),
      );
      break;
    case "haunt":
      step = seq(
        all(to(act, "y", -H * 0.14, 500), to(act, "turn", 6, 500)),
        repeat(3, () =>
          seq(to(act, "skew", 10, 140), to(act, "skew", -10, 140)),
        ),
        to(act, "skew", 0, 120),
        all(to(act, "y", 0, 500), to(act, "turn", 0, 500)),
      );
      break;
    case "teleport":
      step = seq(
        all(to(act, "sy", 0.04, 180), to(act, "sx", 1.4, 180)),
        to(act, "opacity", 0, 90),
        wait(300),
        size(0.2, 0),
        set(act, "opacity", 1),
        settle(act, ["sx", "sy"]),
      );
      break;
    case "scan":
      step = seq(
        all(to(act, "turn", -10, 300), move("eyes", { sx: 1.4, sy: 1.4 }, 300)),
        all(to(act, "turn", 10, 500), move("eyes", { sx: 0.7, sy: 0.7 }, 500)),
        all(to(act, "turn", 0, 300), move("eyes", { sx: 1, sy: 1 }, 300)),
      );
      break;
    case "wobble":
      origin = FEET;
      step = seq(
        ...[
          [1.12, 0.9, 6],
          [0.92, 1.08, -6],
          [1.07, 0.95, 4],
          [0.96, 1.04, -3],
          [1, 1, 0],
        ].map(([sx, sy, skew]) =>
          move(
            act,
            { sx: sx as number, sy: sy as number, skew: skew as number },
            130,
          ),
        ),
      );
      break;
    case "split": {
      // The body fades out, two small copies hop apart and back, and it fades in.
      const d = 1800;
      const at = (p: number) => p * d;
      step = all(
        seq(
          to(act, "opacity", 0, at(0.15), "linear"),
          wait(at(0.7)),
          to(act, "opacity", 1, at(0.15), "linear"),
        ),
        ...[-1, 1].map((side) => {
          const target = `fx:split${side}` as const;
          layers.push({ target, place: "front", nodes: [], clone: {} });
          return all(
            seq(
              to(target, "opacity", 0, 0),
              to(target, "opacity", 1, at(0.15), "linear"),
              wait(at(0.7)),
              to(target, "opacity", 0, at(0.15), "linear"),
            ),
            seq(
              to(target, "x", side * W * 0.3, at(0.3), "linear"),
              wait(at(0.4)),
              to(target, "x", 0, at(0.3), "linear"),
            ),
            seq(
              wait(at(0.3)),
              to(target, "y", -H * 0.12, at(0.1), "linear"),
              to(target, "y", 0, at(0.1), "linear"),
              to(target, "y", -H * 0.12, at(0.1), "linear"),
              to(target, "y", 0, at(0.1), "linear"),
            ),
            seq(
              move(target, { sx: 0.55, sy: 0.55 }, at(0.15), "linear"),
              wait(at(0.7)),
              move(target, { sx: 1, sy: 1 }, at(0.15), "linear"),
            ),
          );
        }),
      );
      // A copy starts hidden.
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE },
          from: { "fx:split-1": { opacity: 0 }, "fx:split1": { opacity: 0 } },
        }),
        layers,
      };
    }
    case "roll":
      step = seq(to(act, "turn", 360, 900), set(act, "turn", 0));
      break;
    case "pop":
      step = seq(
        size(0.08, 250),
        size(1.5, 350, "ease-out"),
        settle(act, ["sx", "sy"]),
      );
      break;
    case "flip":
      step = seq(
        to(act, "turn", 180, 350),
        wait(450),
        to(act, "turn", 360, 350),
        set(act, "turn", 0),
      );
      break;
    case "shapes": {
      // The jelly becomes a square, a triangle and a circle in turn, then itself again.
      const shapes = [SQUARE, TRIANGLE, CIRCLE];
      shapes.forEach((d, j) =>
        layers.push({
          target: `fx:shape${j}`,
          place: "figure",
          nodes: [shapePath(d, color, filled)],
        }),
      );
      step = seq(
        ...[1, 2, 3, 4].map((i) =>
          seq(
            all(
              squish(),
              ...(i === 1 ? [to("body", "opacity", 0, 350)] : []),
              ...(i === 4 ? [to("body", "opacity", 1, 350)] : []),
              ...(i - 1 <= 2
                ? [to(`fx:shape${i - 1}`, "opacity", 1, 350)]
                : []),
              ...(i - 2 >= 0
                ? [to(`fx:shape${i - 2}`, "opacity", 0, 350)]
                : []),
            ),
            wait(550),
          ),
        ),
      );
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE },
          from: {
            "fx:shape0": { opacity: 0 },
            "fx:shape1": { opacity: 0 },
            "fx:shape2": { opacity: 0 },
          },
        }),
        layers,
      };
    }
    case "rubik": {
      // The square splits in four scrambled pieces, turns three times as they match, and closes.
      const scrambled = SCRAMBLE.filter((one) => one !== color);
      const piece = (at: { x: number; y: number }, fill: string) => ({
        tag: "rect" as const,
        attrs: { x: at.x, y: at.y, width: 1980, height: 1980, rx: 260, fill },
      });
      layers.push({
        target: "fx:rubik",
        place: "figure",
        nodes: RUBIK.map((at) => piece(at, color)),
      });
      RUBIK.forEach((at, k) =>
        layers.push({
          target: `fx:rubik${k}`,
          place: "figure",
          nodes: [piece(at, scrambled[k] ?? color)],
        }),
      );
      origins["fx:rubik"] = [4250, 2600];
      RUBIK.forEach((_, k) => (origins[`fx:rubik${k}`] = [4250, 2600]));
      const turnAll = (deg: number, ms: number) =>
        all(
          to("fx:rubik", "turn", deg, ms),
          ...RUBIK.map((_, k) => to(`fx:rubik${k}`, "turn", deg, ms)),
        );
      step = seq(
        all(
          to("body", "opacity", 0, 250),
          to("fx:rubik", "opacity", 1, 250),
          ...RUBIK.map((_, k) => to(`fx:rubik${k}`, "opacity", 1, 250)),
        ),
        wait(200),
        ...[1, 2, 3].map((i) =>
          seq(
            all(
              turnAll(i * 90, 450),
              // Pieces 0 and 1 match on the first turn, 2 on the second, 3 on the third.
              ...RUBIK.map((_, k) => k)
                .filter((k) => [1, 1, 2, 3][k] === i)
                .map((k) => to(`fx:rubik${k}`, "opacity", 0, 300)),
            ),
            wait(300),
          ),
        ),
        all(...RUBIK.map((_, k) => to(`fx:rubik${k}`, "opacity", 0, 200))),
        all(to("body", "opacity", 1, 400), to("fx:rubik", "opacity", 0, 400)),
        all(turnAll(0, 0)),
      );
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE, ...origins },
          from: {
            "fx:rubik": { opacity: 0 },
            ...Object.fromEntries(
              RUBIK.map((_, k) => [`fx:rubik${k}`, { opacity: 0 }]),
            ),
          },
        }),
        layers,
      };
    }
    case "sharpen":
      layers.push({
        target: "fx:sharp",
        place: "figure",
        nodes: [
          {
            ...shapePath(SHARP_PENTAGON, color, filled),
            attrs: {
              ...shapePath(SHARP_PENTAGON, color, filled).attrs,
              "stroke-linejoin": "miter",
            },
          },
        ],
      });
      step = seq(
        all(
          to("fx:sharp", "opacity", 1, 400),
          to("body", "opacity", 0, 400),
          size(1.06, 400),
        ),
        wait(800),
        all(
          to("fx:sharp", "opacity", 0, 400),
          to("body", "opacity", 1, 400),
          size(1, 400),
        ),
      );
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE },
          from: { "fx:sharp": { opacity: 0 } },
        }),
        layers,
      };
    case "aura": {
      const outline = creature.parts("idle")[0]?.d ?? "";
      [0, 1, 2].forEach((ring) => {
        const target = `fx:aura${ring}` as const;
        layers.push({
          target,
          place: "behind",
          nodes: [
            {
              tag: "path",
              attrs: {
                d: outline,
                fill: "none",
                stroke: color,
                "stroke-width": 90,
                "stroke-linejoin": "round",
              },
            },
          ],
        });
        origins[target] = [4250, 2550];
      });
      step = all(
        ...[0, 1, 2].map((ring) => {
          const target = `fx:aura${ring}` as const;
          return seq(
            wait(ring * 400),
            all(
              seq(
                to(target, "opacity", 0.7, 180, "linear"),
                to(target, "opacity", 0, 1020, "linear"),
              ),
              move(target, { sx: 1.7, sy: 1.7 }, 1200, "linear"),
            ),
          );
        }),
        seq(
          size(1.05, 300),
          size(1, 300),
          wait(400),
          size(1.05, 300),
          size(1, 300),
        ),
      );
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE, ...origins },
          from: {
            "fx:aura0": { opacity: 0 },
            "fx:aura1": { opacity: 0 },
            "fx:aura2": { opacity: 0 },
          },
        }),
        layers,
      };
    }
    case "squash":
      origin = FEET;
      step = seq(
        all(to(act, "sy", 0.15, 180), to(act, "sx", 1.6, 180)),
        wait(220),
        all(
          to(act, "sy", 1.25, 200),
          to(act, "sx", 0.85, 200),
          to(act, "y", -H * 0.12, 200),
        ),
        settle(act, ["sx", "sy", "y"]),
      );
      break;
    case "tumble":
      step = steps(4, 90, 260, 60, true);
      break;
    case "spin":
      origin = TRIANGLE_MIDDLE;
      step = steps(3, 120, 260, 220, false);
      break;
    case "pyramid":
      origin = FEET;
      step = seq(
        all(to(act, "sy", 0.6, 250), to(act, "sx", 1.1, 250)),
        all(to(act, "sy", 1.4, 300), to(act, "sx", 0.85, 300)),
        settle(act, ["sx", "sy"]),
      );
      break;
    case "cartwheel":
      step = steps(5, 72, 240, 40, true);
      break;
    case "rotate":
      step = steps(6, 60, 160, 90, false, "linear");
      break;
    case "drip":
      origin = DROP_TIP;
      step = seq(
        all(to(act, "sy", 1.3, 1400), to(act, "sx", 0.85, 1400)),
        wait(400),
        all(to(act, "sy", 1.45, 600), to(act, "sx", 0.78, 600)),
        all(
          to(act, "sy", 1, 900, "soft-spring"),
          to(act, "sx", 1, 900, "soft-spring"),
        ),
      );
      break;
    case "bubble":
      origin = DROP_TIP;
      step = seq(size(0.5, 900), wait(800), size(1, 900));
      break;
    case "wiggle":
      step = seq(
        repeat(5, (i) =>
          all(
            to(act, "skew", i % 2 === 0 ? 12 : -12, 120),
            to(act, "turn", i % 2 === 0 ? -4 : 4, 120),
          ),
        ),
        all(to(act, "skew", 0, 120), to(act, "turn", 0, 120)),
      );
      break;
    case "jump":
      origin = FEET;
      step = seq(
        all(to(act, "sy", 0.7, 200), to(act, "sx", 1.15, 200)),
        all(
          to(act, "sy", 1.15, 300, "out-quad"),
          to(act, "sx", 0.9, 300, "out-quad"),
          to(act, "y", -H * 0.35, 300, "out-quad"),
          to(act, "turn", 15, 300, "out-quad"),
        ),
        all(
          to(act, "y", 0, 300, "in-quad"),
          to(act, "turn", 0, 300, "in-quad"),
          to(act, "sy", 1, 300),
          to(act, "sx", 1, 300),
        ),
        all(to(act, "sy", 0.85, 90), to(act, "sx", 1.1, 90)),
        settle(act, ["sx", "sy"]),
      );
      break;
    case "fart": {
      layers.push({
        target: "fx:puff",
        place: "front",
        nodes: PUFF.map((one) => ({
          tag: "circle",
          attrs: { cx: one.x, cy: one.y, r: one.r, fill: "#a3a3a3" },
        })),
      });
      const first = PUFF[0] as { x: number; y: number };
      origins["fx:puff"] = [first.x, first.y];
      step = seq(
        jitter(6, 55),
        all(
          seq(
            to("fx:puff", "opacity", 0.85, 100, "linear"),
            to("fx:puff", "opacity", 0.6, 500, "linear"),
            to("fx:puff", "opacity", 0, 400, "linear"),
          ),
          to("fx:puff", "x", -W * 0.06, 1000, "linear"),
          seq(
            move("fx:puff", { sx: 0.3, sy: 0.3 }, 0),
            move("fx:puff", { sx: 1.5, sy: 1.5 }, 1000, "linear"),
          ),
          seq(to(act, "y", -H * 0.05, 120), to(act, "y", 0, 450, "spring")),
          seq(
            move("eyes", { sx: 0.6, sy: 0.6 }, 120),
            wait(500),
            move("eyes", { sx: 1, sy: 1 }, 200),
          ),
        ),
      );
      return {
        timeline: timeline(step, {
          origins: { act: MIDDLE, ...origins },
          from: { "fx:puff": { opacity: 0 } },
        }),
        layers,
      };
    }
    case "puff":
      step = seq(
        ...[1.08, 1.16, 1.25].map((v) =>
          seq(size(v, 200, "ease-out"), size(v - 0.04, 100)),
        ),
        wait(300),
        size(1, 400),
      );
      break;
    case "thud":
      // Heavy: it lifts a little, drops hard, flattens on landing and shudders.
      origin = FEET;
      step = seq(
        all(to(act, "y", -H * 0.12, 320, "out-quad"), to(act, "sy", 1.03, 320)),
        all(to(act, "y", 0, 170, "in-quad"), to(act, "sy", 1, 170)),
        all(to(act, "sy", 0.9, 70), to(act, "sx", 1.06, 70)),
        all(jitter(4, 45), settle(act, ["sx", "sy"])),
      );
      break;
    case "flare":
      // The flame leaps up thin, flickers tall, and sinks back.
      origin = FEET;
      step = seq(
        all(to(act, "sy", 1.3, 240, "ease-out"), to(act, "sx", 0.88, 240)),
        ...[1.2, 1.32, 1.17, 1.27].map((v) => to(act, "sy", v, 90, "linear")),
        all(
          to(act, "sy", 1, 700, "soft-spring"),
          to(act, "sx", 1, 700, "soft-spring"),
        ),
      );
      break;
    case "sway":
      // A rocking chair: it rocks on its base, less each time.
      origin = BASE;
      step = seq(
        ...[12, -10, 7, -4, 0].map((deg) =>
          to(act, "turn", deg, 380, "ease-in-out"),
        ),
      );
      break;
    case "float":
      // It rises and drifts, turning a little with the air, and comes down.
      step = seq(
        all(
          to(act, "y", -H * 0.25, 1200, "ease-in-out"),
          to(act, "x", W * 0.04, 1200, "ease-in-out"),
          to(act, "turn", 5, 1200, "ease-in-out"),
        ),
        wait(250),
        all(
          to(act, "y", 0, 1300, "ease-in-out"),
          to(act, "x", 0, 1300, "ease-in-out"),
          seq(to(act, "turn", -3, 800), to(act, "turn", 0, 500)),
        ),
      );
      break;
    case "beat":
      // Two heartbeats: a quick small pulse, then a bigger one.
      step = repeat(2, () =>
        seq(
          size(1.1, 110, "ease-out"),
          size(1, 110),
          size(1.18, 130, "ease-out"),
          size(1, 380, "spring"),
          wait(250),
        ),
      );
      break;
  }
  const eyeLine: [number, number] = [W / 2, left.cy];
  return {
    timeline: timeline(step, {
      origins: {
        act: origin,
        eyes: eyeLine,
        antenna: antennaBase(body),
        ...origins,
      },
    }),
    layers,
  };
}

/** Where the antenna turns: the foot of its stem. */
export function antennaBase(body: BoodBody): [number, number] {
  const at = creatures[body].antenna;
  return at === undefined ? MIDDLE : [at.x, at.y + at.stemHeight];
}
