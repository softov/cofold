/**
 * The ways any body leaves and comes back. Each is written as its hide half;
 * the show half is the same motion run backwards from hidden.
 */

import { BOOD_H as H, BOOD_W as W, MIDDLE } from "../box.js";
import type {
  BoodChannel,
  BoodEasing,
  BoodLayer,
  BoodPlay,
  BoodTarget,
  BoodTimeline,
  BoodTransit,
  SvgNode,
} from "../types.js";
import { all, seq, type Step, timeline, to } from "./build.js";
import { along, derived, reversed } from "./derive.js";

export const BOOD_TRANSITS: readonly BoodTransit[] = [
  "beam",
  "phantom",
  "jelly",
  "blackHole",
  "spin",
  "erase",
  "portal",
  "dust",
  "melt",
  "glitch",
  "jump",
  "bubble",
];

/** Any transit, at random. */
export function randomTransit(random: () => number = Math.random): BoodTransit {
  return BOOD_TRANSITS[
    Math.floor(random() * BOOD_TRANSITS.length)
  ] as BoodTransit;
}

/** The values a transit frame moves: the figure's channels, `fx` (its effects' progress, 0 to 1) and `clip` (the wipe, 0 to 1). */
type FrameValues = Partial<Record<BoodChannel | "fx" | "clip", number>>;
interface Frame {
  ms: number;
  to: FrameValues;
  easing?: BoodEasing;
}

const stepped = (n: number): BoodEasing => ({ steps: n });

function framesOf(kind: BoodTransit): {
  origin: [number, number];
  frames: Frame[];
} {
  switch (kind) {
    case "beam":
      return {
        origin: [W / 2, H * 0.9],
        frames: [
          { ms: 350, to: { sx: 1.5, sy: 0.025, fx: 0.6 } },
          { ms: 250, to: { sx: 0, opacity: 0, fx: 1 } },
        ],
      };
    case "phantom":
      return {
        origin: MIDDLE,
        frames: [
          { ms: 800, to: { y: -H * 0.3, sx: 0.9, sy: 1.1, opacity: 0 } },
        ],
      };
    case "jelly":
      return {
        origin: [W / 2, H * 0.92],
        frames: [
          { ms: 250, to: { sx: 1.35, sy: 0.6 } },
          { ms: 300, to: { sx: 0.65, sy: 1.45 } },
          { ms: 250, to: { sx: 1.65, sy: 0.1 } },
          { ms: 200, to: { sx: 0, sy: 0, opacity: 0 } },
        ],
      };
    case "blackHole":
      return {
        origin: MIDDLE,
        frames: [
          {
            ms: 900,
            to: { turn: 540, sx: 0.02, sy: 0.02, fx: 0.9 },
            easing: "ease-in",
          },
          { ms: 120, to: { sx: 0, sy: 0, opacity: 0, fx: 1 } },
        ],
      };
    case "spin":
      return {
        origin: MIDDLE,
        frames: [
          {
            ms: 900,
            to: { turn: 1080, sx: 0.05, sy: 0.05, opacity: 0, fx: 1 },
            easing: "in-out-cubic",
          },
        ],
      };
    case "erase":
      return {
        origin: MIDDLE,
        frames: [{ ms: 900, to: { clip: 1, fx: 1 }, easing: stepped(12) }],
      };
    case "portal":
      return {
        origin: MIDDLE,
        frames: [
          { ms: 600, to: { sx: 0.015, fx: 0.65 } },
          { ms: 250, to: { sx: 0, opacity: 0, fx: 1 } },
        ],
      };
    case "dust":
      return {
        origin: MIDDLE,
        frames: [
          { ms: 300, to: { opacity: 0, fx: 0.35 } },
          { ms: 600, to: { fx: 1 } },
        ],
      };
    case "melt":
      return {
        origin: [W / 2, H * 0.94],
        frames: [
          { ms: 450, to: { sx: 1.2, sy: 0.65, fx: 0.4 } },
          { ms: 450, to: { sx: 1.65, sy: 0.035, opacity: 0, fx: 0.8 } },
          { ms: 250, to: { fx: 1 } },
        ],
      };
    case "glitch":
      return {
        origin: MIDDLE,
        frames: [
          { ms: 60, to: { opacity: 0, fx: 0.05 } },
          { ms: 750, to: { fx: 1 }, easing: "linear" },
        ],
      };
    case "jump":
      return {
        origin: [W / 2, H * 0.92],
        frames: [
          { ms: 220, to: { y: H * 0.05, sx: 1.25, sy: 0.7, fx: 0.2 } },
          {
            ms: 450,
            to: { y: -H * 2.5, sx: 0.7, sy: 1.3, fx: 1 },
            easing: "out-quad",
          },
          { ms: 100, to: { opacity: 0 } },
        ],
      };
    case "bubble":
      return {
        origin: MIDDLE,
        frames: [
          { ms: 400, to: { sx: 0.25, sy: 0.25, fx: 0.5 } },
          { ms: 150, to: { sx: 0, sy: 0, opacity: 0, fx: 0.65 } },
          { ms: 350, to: { fx: 1 } },
        ],
      };
  }
}

/** An effect layer, and how each of its channels follows the progress: `[input, output]` as Animated's interpolate. */
interface Overlay {
  target: BoodTarget;
  nodes: SvgNode[];
  origin?: [number, number];
  clone?: { band: [number, number] };
  follow: Partial<Record<BoodChannel, [number[], number[]]>>;
}

/** Where dust flies from and how far, as drawn on a 120 box, 68 drawing units to one, its middle on the body's. */
const DUST = [
  [40, 40, -37, -25, 4],
  [55, 30, -20, -39, 3],
  [75, 38, 24, -34, 4],
  [87, 57, 37, -7, 3],
  [76, 78, 26, 29, 4],
  [50, 84, -15, 33, 3],
  [32, 65, -40, 13, 4],
  [62, 55, 7, -45, 3],
  [46, 60, -28, 21, 3],
  [73, 59, 33, 19, 3],
].map(([x, y, dx, dy, r]) => ({
  x: 4250 + ((x as number) - 60) * 68,
  y: 2550 + ((y as number) - 57.5) * 68,
  dx: (dx as number) * 68,
  dy: (dy as number) * 68,
  r: (r as number) * 68,
}));

/** Each glitch band's sideways jumps, as a share of the width, one for each fifth of the glitch. */
const GLITCH = [
  [-0.12, 0.09, -0.05, 0.13, -0.08],
  [0.09, -0.05, 0.13, -0.08, -0.12],
  [-0.05, 0.13, -0.08, -0.12, 0.09],
  [0.13, -0.08, -0.12, 0.09, -0.05],
  [-0.08, -0.12, 0.09, -0.05, 0.13],
];
const GLITCH_AT = [0, 0.199, 0.2, 0.399, 0.4, 0.599, 0.6, 0.799, 0.8, 1];

function overlays(kind: BoodTransit, color: string): Overlay[] {
  const mid: [number, number] = [4250, 2550];
  switch (kind) {
    case "beam":
      return [
        {
          target: "fx:beam",
          origin: [4250, 4500],
          nodes: [
            {
              tag: "rect",
              attrs: {
                x: 1190,
                y: 4400,
                width: 6120,
                height: 200,
                rx: 100,
                fill: color,
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.6, 1],
              [0, 1, 0],
            ],
            sx: [
              [0, 0.6, 1],
              [0.1, 1, 0.1],
            ],
          },
        },
      ];
    case "blackHole":
      return [
        {
          target: "fx:hole",
          origin: mid,
          nodes: [
            {
              tag: "circle",
              attrs: {
                cx: 4250,
                cy: 2550,
                r: 2040,
                fill: "none",
                stroke: color,
                "stroke-width": 140,
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.5, 1],
              [0, 1, 0],
            ],
            sx: [
              [0, 1],
              [0.2, 1.3],
            ],
            sy: [
              [0, 1],
              [0.2, 1.3],
            ],
          },
        },
      ];
    case "spin":
      return [
        {
          target: "fx:ring",
          origin: mid,
          nodes: [
            {
              tag: "circle",
              attrs: {
                cx: 4250,
                cy: 2550,
                r: 2350,
                fill: "none",
                stroke: color,
                "stroke-width": 180,
                "stroke-dasharray": "900 780",
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.6, 1],
              [0, 0.7, 0],
            ],
            turn: [
              [0, 1],
              [0, 420],
            ],
            sx: [
              [0, 0.6],
              [0.4, 1.35],
            ],
            sy: [
              [0, 0.6],
              [0.4, 1.35],
            ],
          },
        },
      ];
    case "erase":
      return [
        {
          target: "fx:scan",
          nodes: [
            {
              tag: "rect",
              attrs: {
                x: W * 0.2,
                y: 0,
                width: W * 0.6,
                height: H * 0.025,
                fill: color,
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.03, 0.97, 1],
              [0, 1, 1, 0],
            ],
            y: [
              [0, 1],
              [H * 0.97, 0],
            ],
          },
        },
      ];
    case "portal":
      return [
        {
          target: "fx:portal",
          origin: mid,
          nodes: [
            {
              tag: "rect",
              attrs: {
                x: 4130,
                y: 300,
                width: 240,
                height: 4500,
                rx: 120,
                fill: color,
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.65, 1],
              [0, 1, 0],
            ],
            sy: [
              [0, 0.65, 1],
              [0.2, 1, 0.2],
            ],
          },
        },
      ];
    case "dust":
      return DUST.map((bit, i) => ({
        target: `fx:dust${i}` as const,
        origin: [bit.x, bit.y] as [number, number],
        nodes: [
          {
            tag: "circle" as const,
            attrs: { cx: bit.x, cy: bit.y, r: bit.r, fill: color },
          },
        ],
        follow: {
          opacity: [
            [0, 0.3, 1],
            [0, 1, 0],
          ],
          x: [
            [0, 1],
            [0, bit.dx],
          ],
          y: [
            [0, 1],
            [0, bit.dy],
          ],
          sx: [
            [0, 1],
            [0.2, 1.3],
          ],
          sy: [
            [0, 1],
            [0.2, 1.3],
          ],
        },
      }));
    case "melt":
      return [
        {
          target: "fx:puddle",
          origin: [4250, 4800],
          nodes: [
            {
              tag: "ellipse",
              attrs: { cx: 4250, cy: 4800, rx: 3200, ry: 340, fill: color },
            },
          ],
          follow: {
            opacity: [
              [0, 0.3, 0.8, 1],
              [0, 1, 1, 0],
            ],
            sx: [
              [0, 0.8],
              [0.2, 1],
            ],
          },
        },
        {
          target: "fx:drop",
          nodes: [
            {
              tag: "circle",
              attrs: { cx: 5800, cy: 3150, r: 270, fill: color },
            },
          ],
          follow: {
            opacity: [
              [0.3, 0.45, 0.75],
              [0, 1, 0],
            ],
            y: [
              [0.3, 0.75],
              [0, 1500],
            ],
          },
        },
      ];
    case "jump":
      return [
        {
          target: "fx:shadow",
          origin: [4250, 4850],
          nodes: [
            {
              tag: "ellipse",
              attrs: { cx: 4250, cy: 4850, rx: 1700, ry: 200, fill: color },
            },
          ],
          follow: {
            opacity: [
              [0, 0.1, 1],
              [0, 0.25, 0],
            ],
            sx: [
              [0, 1],
              [1, 0.3],
            ],
          },
        },
      ];
    case "bubble":
      return [
        {
          target: "fx:bubble",
          origin: mid,
          nodes: [
            {
              tag: "circle",
              attrs: {
                cx: 4250,
                cy: 2550,
                r: 2250,
                fill: "none",
                stroke: color,
                "stroke-width": 200,
              },
            },
          ],
          follow: {
            opacity: [
              [0, 0.5, 0.8],
              [0, 1, 0],
            ],
            sx: [
              [0, 0.5, 0.8],
              [0.1, 0.6, 1.8],
            ],
            sy: [
              [0, 0.5, 0.8],
              [0.1, 0.6, 1.8],
            ],
          },
        },
        {
          target: "fx:pop",
          origin: mid,
          nodes: [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({
            tag: "path" as const,
            attrs: {
              d: "M 4250 150 L 4250 650",
              stroke: color,
              "stroke-width": 200,
              "stroke-linecap": "round",
              transform: `rotate(${deg} 4250 2550)`,
            },
          })),
          follow: {
            opacity: [
              [0.5, 0.65, 0.85],
              [0, 1, 0],
            ],
            sx: [
              [0.5, 0.65],
              [0.2, 1.3],
            ],
            sy: [
              [0.5, 0.65],
              [0.2, 1.3],
            ],
          },
        },
      ];
    case "glitch":
      return GLITCH.map((offsets, band) => ({
        target: `fx:band${band}` as const,
        nodes: [],
        clone: {
          band: [band / GLITCH.length, (band + 1) / GLITCH.length] as [
            number,
            number,
          ],
        },
        follow: {
          opacity: [
            [0, 0.03, 0.92, 1],
            [0, 1, 1, 0],
          ],
          x: [GLITCH_AT, offsets.flatMap((one) => [one * W, one * W])],
        },
      }));
    default:
      return [];
  }
}

/** A transit's half: `hide` leaves the body gone, `show` brings it back from gone. */
export function transit(
  kind: BoodTransit,
  half: "hide" | "show",
  options: { color: string },
): BoodPlay {
  const { origin, frames } = framesOf(kind);
  const step: Step = seq(
    ...frames.map((frame) =>
      all(
        ...(Object.entries(frame.to) as [keyof FrameValues, number][]).map(
          ([key, value]) => {
            if (key === "fx")
              return to("fx:progress", "x", value, frame.ms, frame.easing);
            if (key === "clip") {
              return all(
                to("wipe", "y", -value * H, frame.ms, frame.easing),
                to("unwipe", "y", value * H, frame.ms, frame.easing),
              );
            }
            return to("act", key, value, frame.ms, frame.easing);
          },
        ),
      ),
    ),
  );
  const hide: BoodTimeline = timeline(step, { origins: { act: origin } });
  const progress = hide.tracks["fx:progress"]?.channels.x ?? [
    { at: 0, value: 0 },
  ];
  delete hide.tracks["fx:progress"];
  const layers: BoodLayer[] = [];
  for (const overlay of overlays(kind, color(options))) {
    const layer: BoodLayer = {
      target: overlay.target,
      nodes: overlay.nodes,
      place: "front",
    };
    if (overlay.clone !== undefined) layer.clone = overlay.clone;
    layers.push(layer);
    const channels: Partial<Record<BoodChannel, ReturnType<typeof derived>>> =
      {};
    for (const [channel, [input, output]] of Object.entries(overlay.follow) as [
      BoodChannel,
      [number[], number[]],
    ][]) {
      channels[channel] = derived(progress, hide.duration, (p) =>
        along(p, input, output),
      );
    }
    hide.tracks[overlay.target] =
      overlay.origin === undefined
        ? { channels }
        : { channels, origin: overlay.origin };
  }
  const clip = kind === "erase";
  if (half === "hide") return { timeline: hide, layers, hold: true, clip };
  return { timeline: reversed(hide), layers, clip };
}

const color = (options: { color: string }) => options.color;
