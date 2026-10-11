/**
 * What a body does on its own: loops that run while a mood holds, and small
 * moments a host fires now and then (a blink, a glance, a swing of the antenna).
 */

import { BOOD_W as W, MIDDLE } from "../box.js";
import { faceColors } from "../color.js";
import { creatures } from "../creatures/index.js";
import {
  ANTENNA_DOT_R,
  antennaByMood,
  antennaGeometry,
  browsByMood,
  eyeGeometry,
  pupilRoom,
} from "../face.js";
import type {
  BoodBody,
  BoodLayer,
  BoodMood,
  BoodPlay,
  BoodScheme,
} from "../types.js";
import { all, move, seq, set, timeline, to, wait } from "./build.js";
import { antennaBase } from "./actions.js";

const loop = Infinity;

/** The loops for a body in a mood. A host starts them on a mood change and stops the old ones. */
export function ambient(
  body: BoodBody,
  mood: BoodMood,
  options: { scheme?: BoodScheme; brows?: boolean; effects?: boolean } = {},
): BoodPlay[] {
  const creature = creatures[body];
  const scheme = options.scheme ?? "dark";
  const plays: BoodPlay[] = [];
  // Breath: the whole body swells a little and back.
  plays.push({
    timeline: timeline(
      seq(
        move("breath", { sx: 1.02, sy: 1.02 }, 1200),
        move("breath", { sx: 1, sy: 1 }, 1200),
      ),
      {
        origins: { breath: MIDDLE },
        iterations: loop,
      },
    ),
    layers: [],
  });
  if (options.brows ?? false) {
    const ms = browsByMood[mood].ms;
    plays.push({
      timeline: timeline(
        seq(to("brows", "y", -30, ms / 2), to("brows", "y", 0, ms / 2)),
        { iterations: loop },
      ),
      layers: [],
    });
  }
  if (mood === "error") {
    const px = W * 0.012;
    plays.push({
      timeline: timeline(
        seq(
          to("shake", "x", px, 40, "linear"),
          to("shake", "x", -px, 80, "linear"),
          to("shake", "x", 0, 40, "linear"),
        ),
        { iterations: loop },
      ),
      layers: [],
    });
  }
  if (mood === "sad") {
    plays.push({
      timeline: timeline(
        all(
          seq(
            to("tear", "opacity", 0.9, 720, "linear"),
            wait(2160),
            to("tear", "opacity", 0, 720, "linear"),
          ),
          to("tear", "y", 420, 3600, "linear"),
        ),
        { iterations: loop, from: { tear: { opacity: 0 } } },
      ),
      layers: [],
    });
  }
  if (creature.antenna !== undefined) {
    const config = antennaByMood[mood];
    const base = antennaBase(body);
    if (config.swing === "alarm") {
      plays.push({
        timeline: timeline(
          seq(
            to("antenna", "turn", 25, 90, "linear"),
            to("antenna", "turn", -20, 90, "linear"),
            to("antenna", "turn", 15, 90, "linear"),
            to("antenna", "turn", 0, 90, "linear"),
            wait(900),
          ),
          { origins: { antenna: base }, iterations: loop },
        ),
        layers: [],
      });
    }
    if (options.effects ?? true)
      plays.push(...antennaEffects(body, mood, scheme));
  }
  return plays;
}

/** The ring, radar, waves and particles round the antenna's dot. */
function antennaEffects(
  body: BoodBody,
  mood: BoodMood,
  scheme: BoodScheme,
): BoodPlay[] {
  const at = creatures[body].antenna;
  if (at === undefined) return [];
  const config = antennaByMood[mood];
  const { dotX, dotY, baseX, baseY } = antennaGeometry(at, config);
  const dot = config.dotColor ?? faceColors[scheme].antennaDot;
  const tilt =
    config.rotation !== undefined
      ? { transform: `rotate(${config.rotation} ${baseX} ${baseY})` }
      : {};
  const center: [number, number] = [dotX, dotY];
  const layer = (
    target: `fx:${string}`,
    nodes: BoodLayer["nodes"],
  ): BoodLayer => ({
    target,
    place: "antenna",
    nodes: [{ tag: "g", attrs: tilt, children: nodes }],
  });
  const plays: BoodPlay[] = [];
  const grow = (ANTENNA_DOT_R + 180) / (ANTENNA_DOT_R + 30);
  plays.push({
    layers: [
      layer("fx:pulse", [
        {
          tag: "circle",
          attrs: {
            cx: dotX,
            cy: dotY,
            r: ANTENNA_DOT_R + 30,
            fill: "none",
            stroke: dot,
            "stroke-width": 35,
          },
        },
      ]),
    ],
    timeline: timeline(
      seq(
        all(
          to("fx:pulse", "opacity", 0.04, config.pulseMs / 2),
          move("fx:pulse", { sx: grow, sy: grow }, config.pulseMs / 2),
        ),
        all(
          to("fx:pulse", "opacity", 0.35, config.pulseMs / 2),
          move("fx:pulse", { sx: 1, sy: 1 }, config.pulseMs / 2),
        ),
      ),
      {
        origins: { "fx:pulse": center },
        from: { "fx:pulse": { opacity: 0.35 } },
        iterations: loop,
      },
    ),
  });
  if (config.radar === true) {
    const r = ANTENNA_DOT_R + 60;
    const half = r * Math.SQRT1_2;
    plays.push({
      layers: [
        layer("fx:radar", [
          {
            tag: "path",
            attrs: {
              d: `M ${dotX - half} ${dotY - half} A ${r} ${r} 0 0 1 ${dotX + half} ${dotY - half}`,
              fill: "none",
              stroke: dot,
              "stroke-width": 28,
              "stroke-linecap": "round",
              opacity: 0.9,
            },
          },
        ]),
      ],
      timeline: timeline(to("fx:radar", "turn", 360, 1800, "linear"), {
        origins: { "fx:radar": center },
        iterations: loop,
      }),
    });
  }
  if (config.signalWave === true) {
    const wide = (ANTENNA_DOT_R + 600) / ANTENNA_DOT_R;
    [0, 1].forEach((i) => {
      const target = `fx:wave${i}` as const;
      plays.push({
        layers: [
          layer(target, [
            {
              tag: "circle",
              attrs: {
                cx: dotX,
                cy: dotY,
                r: ANTENNA_DOT_R,
                fill: "none",
                stroke: dot,
                "stroke-width": 20,
              },
            },
          ]),
        ],
        timeline: timeline(
          seq(
            wait(i * 900),
            all(
              to(target, "opacity", 0, 1800, "ease-out"),
              move(target, { sx: wide, sy: wide }, 1800, "ease-out"),
            ),
            wait((1 - i) * 900),
          ),
          {
            origins: { [target]: center },
            from: { [target]: { opacity: 0.7 } },
            iterations: loop,
          },
        ),
      });
    });
  }
  if (config.particles === true) {
    [
      { dx: -560, dy: 120, r: 55, delay: 0 },
      { dx: -260, dy: 60, r: 40, delay: 300 },
      { dx: 260, dy: 60, r: 40, delay: 600 },
      { dx: 560, dy: 120, r: 55, delay: 900 },
    ].forEach((p, i) => {
      const target = `fx:particle${i}` as const;
      plays.push({
        layers: [
          layer(target, [
            {
              tag: "circle",
              attrs: { cx: dotX + p.dx, cy: dotY + p.dy, r: p.r, fill: dot },
            },
          ]),
        ],
        timeline: timeline(
          seq(
            wait(p.delay),
            all(
              seq(
                to(target, "opacity", 0.85, 800, "linear"),
                to(target, "opacity", 0, 800, "linear"),
              ),
              to(target, "y", -220, 1600, "linear"),
            ),
            set(target, "y", 0),
            wait(900 - p.delay),
          ),
          { from: { [target]: { opacity: 0 } }, iterations: loop },
        ),
      });
    });
  }
  return plays;
}

/** A blink: the eyes close and open about their middle line. */
export function blink(body: BoodBody): BoodPlay {
  const [left] = eyeGeometry(creatures[body], "idle", "dark");
  return {
    timeline: timeline(
      seq(to("eyes", "sy", 0.1, 120), to("eyes", "sy", 1, 120)),
      {
        origins: { eyes: [W / 2, left.cy] },
      },
    ),
    layers: [],
  };
}

/**
 * The pupils look `x` and `y` of their reach, each from -1 to 1, and stay.
 * The glints follow slower and not as far, so they drift a little.
 */
export function glance(
  body: BoodBody,
  mood: BoodMood,
  x: number,
  y: number,
  from = { x: 0, y: 0 },
): BoodPlay {
  const creature = creatures[body];
  const [left, right] = eyeGeometry(creature, mood, "dark");
  const room = pupilRoom(left, creature.iris);
  const start = {
    pupils: { x: from.x * room.x, y: from.y * room.y },
    glints: { x: from.x * room.x * 0.6, y: from.y * room.y * 0.6 },
    pupilL: { turn: eyeTilt(from.x, from.y) },
    pupilR: { turn: eyeTilt(from.x, from.y) },
  };
  return {
    timeline: timeline(
      all(
        move("pupils", { x: x * room.x, y: y * room.y }, 120),
        move(
          "glints",
          { x: x * room.x * 0.6, y: y * room.y * 0.6 },
          360,
          "ease-out",
        ),
        to("pupilL", "turn", eyeTilt(x, y), 160),
        to("pupilR", "turn", eyeTilt(x, y), 160),
      ),
      {
        from: start,
        origins: { pupilL: [left.cx, left.cy], pupilR: [right.cx, right.cy] },
      },
    ),
    layers: [],
    hold: true,
  };
}

/** How far the dot eyes tilt for a sideways look, in degrees, as ahpapp's `Bood.tsx`. */
export const EYE_TILT_DEG = 14;

/**
 * A dot eye's tilt for a look `x` and `y` of its reach (y down), as ahpapp's
 * `tilt`: a look to the right leans the eye back to the left (-14 at full
 * reach), and the lean turns the other way as the look goes down.
 */
export function eyeTilt(x: number, y: number): number {
  return -EYE_TILT_DEG * x * (1 - 2 * Math.max(0, Math.min(1, y)));
}

/** The antenna sways once, as a gentle swing does now and then. */
export function swing(body: BoodBody): BoodPlay {
  return {
    timeline: timeline(
      seq(
        to("antenna", "turn", 10, 220),
        to("antenna", "turn", -7, 300),
        to("antenna", "turn", 0, 300),
      ),
      { origins: { antenna: antennaBase(body) } },
    ),
    layers: [],
  };
}

/** A small pop of the whole body, on a mood change. */
export function pop(): BoodPlay {
  return {
    timeline: timeline(
      seq(
        move("shake", { sx: 0.92, sy: 0.92 }, 0),
        move("shake", { sx: 1, sy: 1 }, 500, "spring"),
      ),
      {
        origins: { shake: MIDDLE },
      },
    ),
    layers: [],
  };
}
