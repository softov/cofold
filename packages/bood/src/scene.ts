/**
 * A creature in a mood, as a stack of layers.
 *
 * Each layer is plain SVG in the drawing's box and is moved as a whole by its
 * target. Nothing here moves: motion is in `motion/`, and a renderer joins the
 * two. A mood change is a new scene. The only path that changes is a body's
 * `flow`, drawn as an SVG `<animate>` on its silhouette.
 */

import { VIEW_BOX } from "./box.js";
import { FACE_INK, bodyColor, darken, lighten } from "./color.js";
import { creatures } from "./creatures/index.js";
import {
  ANTENNA_DOT_R,
  BROW_COLOR,
  BROW_WIDTH,
  antennaByMood,
  antennaGeometry,
  browTransform,
  browsByMood,
  eyeGeometry,
  mouthColor,
  mouthPath,
} from "./face.js";
import { faceColors } from "./color.js";
import type {
  BoodBody,
  BoodLayer,
  BoodMood,
  BoodScene,
  BoodScheme,
  BodyFlow,
  SvgNode,
} from "./types.js";

export interface SceneOptions {
  mood?: BoodMood;
  scheme?: BoodScheme;
  /** The body colour a person picked; the mood's colour when unset. */
  color?: string;
  /** Fill the silhouette with the body colour, and draw the face in ink over it. */
  filled?: boolean;
  /** Every part, or the outline, eyes and mouth. */
  detail?: "full" | "simple";
  /** doop's ringed eyes, or plain dark ovals that tilt as they look. */
  eyes?: "bood" | "dots";
  brows?: boolean;
  mouth?: boolean;
}

const path = (attrs: Record<string, string | number>): SvgNode => ({
  tag: "path",
  attrs,
});

/**
 * The silhouette's flow as SVG: from its own outline through each frame and
 * back, eased in and out at every frame so the edge never jerks, or at an even
 * pace for a flow that glides. The clock is the `<svg>`'s own, so a mood
 * change that redraws the body keeps its place.
 */
function flowNode(d: string, flow: BodyFlow): SvgNode {
  const values = [d, ...flow.frames(), d];
  const gaps = values.length - 1;
  const pace = flow.glide === true
    ? { calcMode: "linear" }
    : { keySplines: Array.from({ length: gaps }, () => "0.45 0 0.55 1").join(";"), calcMode: "spline" };
  return {
    tag: "animate",
    attrs: {
      attributeName: "d",
      values: values.join(";"),
      keyTimes: values.map((_, i) => (i / gaps).toFixed(4)).join(";"),
      ...pace,
      dur: `${flow.ms}ms`,
      begin: "0s",
      repeatCount: "indefinite",
    },
  };
}

export function scene(body: BoodBody, options: SceneOptions = {}): BoodScene {
  const creature = creatures[body];
  const mood = options.mood ?? "idle";
  const scheme = options.scheme ?? "dark";
  const filled = options.filled ?? false;
  const detail = options.detail ?? "full";
  const color = options.color ?? bodyColor(mood, scheme);
  const [left, right] = eyeGeometry(creature, mood, scheme);
  /**
   * A detail drawn on the silhouette, such as a cheek or a crest, is drawn in
   * ink on a filled body so it shows on the colour. A body with no silhouette,
   * such as the logo's two strokes, keeps its colour.
   */
  const partColor = (part: { detail?: boolean }) =>
    filled && part.detail === true ? FACE_INK : color;
  /** A shaded part, darker or lighter than the body, when the body is filled. */
  const shade = (part: { dark?: boolean; light?: boolean }) =>
    !filled
      ? undefined
      : part.dark
        ? darken(color, 0.45)
        : part.light
          ? lighten(color, 0.25)
          : undefined;
  const layers: BoodLayer[] = [];

  layers.push({
    target: "body",
    nodes: creature
      .parts(mood)
      .filter((part) => detail === "full" || !part.detail)
      .map((part) => {
        const shaded = shade(part);
        const node = path({
          d: part.d,
          fill:
            shaded ??
            (part.fill || (filled && part.shape) ? partColor(part) : "none"),
          stroke: shaded ?? partColor(part),
          "stroke-width": part.width,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity:
            filled && !part.shape && shaded === undefined && part.detail
              ? 0.3
              : (part.opacity ?? 1),
        });
        return part.shape && creature.flow !== undefined
          ? { ...node, children: [flowNode(part.d, creature.flow)] }
          : node;
      }),
  });

  if (creature.antenna !== undefined) {
    const config = antennaByMood[mood];
    const { stem, dotX, dotY, baseX, baseY } = antennaGeometry(
      creature.antenna,
      config,
    );
    const dot = config.dotColor ?? faceColors[scheme].antennaDot;
    const line = config.lineColor ?? faceColors[scheme].antenna;
    layers.push({
      target: "antenna",
      nodes: [
        {
          tag: "g",
          attrs:
            config.rotation !== undefined
              ? { transform: `rotate(${config.rotation} ${baseX} ${baseY})` }
              : {},
          children: [
            path({
              d: stem,
              fill: "none",
              stroke: line,
              "stroke-width": 100,
              "stroke-linecap": "round",
            }),
            {
              tag: "circle",
              attrs: {
                cx: dotX,
                cy: dotY,
                r: ANTENNA_DOT_R,
                fill: "none",
                stroke: dot,
                "stroke-width": 50,
              },
            },
          ],
        },
      ],
    });
  }

  if (
    (options.brows ?? false) &&
    detail === "full" &&
    creature.brows !== false
  ) {
    const brows = browsByMood[mood];
    const ink = filled ? FACE_INK : BROW_COLOR;
    const move = browTransform(creature);
    layers.push({
      target: "brows",
      nodes: [
        {
          tag: "g",
          attrs: move === undefined ? {} : { transform: move },
          children: [brows.left, brows.right].map((d) =>
            path({
              d,
              fill: "none",
              stroke: ink,
              "stroke-width": BROW_WIDTH,
              "stroke-linecap": "round",
              opacity: 0.95,
            }),
          ),
        },
      ],
    });
  }

  const tilt = (eye: { rotate: number; cx: number; cy: number }) =>
    eye.rotate !== 0
      ? { transform: `rotate(${eye.rotate} ${eye.cx} ${eye.cy})` }
      : {};
  const iris = creature.iris;
  if ((options.eyes ?? "dots") === "dots" && iris !== undefined) {
    // The iris stays put; each pupil, with its glint, looks about inside it.
    const y = creature.eyes.centerY;
    layers.push({
      target: "eyes",
      nodes: [left, right].map((eye) => ({
        tag: "circle",
        // A dark rim keeps the iris apart from a body of a like colour.
        attrs: {
          cx: eye.cx,
          cy: y,
          r: iris.r,
          fill: iris.color,
          stroke: FACE_INK,
          "stroke-width": 70,
        },
      })),
    });
    (
      [
        ["pupilL", left],
        ["pupilR", right],
      ] as const
    ).forEach(([target, eye]) =>
      layers.push({
        target,
        nodes: [
          {
            tag: "circle",
            attrs: { cx: eye.cx, cy: y, r: iris.pupil, fill: FACE_INK },
          },
          {
            tag: "circle",
            attrs: {
              cx: eye.cx - iris.pupil * 0.35,
              cy: y - iris.pupil * 0.35,
              r: iris.pupil * 0.28,
              fill: "#ffffff",
            },
          },
        ],
      }),
    );
  } else if ((options.eyes ?? "dots") === "dots") {
    // Each dot eye in its own layer, so each tilts about its own middle as it looks.
    (
      [
        ["pupilL", left],
        ["pupilR", right],
      ] as const
    ).forEach(([target, eye]) =>
      layers.push({
        target,
        nodes: [
          {
            tag: "ellipse",
            attrs: {
              cx: eye.cx,
              cy: eye.cy,
              rx: eye.rx * 0.3,
              ry: eye.ry * 0.45,
              fill: filled ? FACE_INK : eye.ring,
              ...tilt(eye),
            },
          },
        ],
      }),
    );
  } else {
    layers.push({
      target: "eyes",
      nodes: [left, right].map((eye) => ({
        tag: "ellipse",
        attrs: {
          cx: eye.cx,
          cy: eye.cy,
          rx: eye.rx,
          ry: eye.ry,
          fill: filled ? "#ffffff" : "none",
          stroke: filled ? FACE_INK : eye.ring,
          "stroke-width": 50,
          ...tilt(eye),
        },
      })),
    });
    layers.push({
      target: "pupils",
      nodes: [left, right].map((eye) => ({
        tag: "circle",
        attrs: {
          cx: eye.px,
          cy: eye.py,
          r: eye.pr,
          fill: filled ? FACE_INK : eye.pupil,
        },
      })),
    });
    if (filled) {
      layers.push({
        target: "glints",
        nodes: [left, right].map((eye) => ({
          tag: "circle",
          attrs: {
            cx: eye.px - eye.pr * 0.35,
            cy: eye.py - eye.pr * 0.35,
            r: eye.pr * 0.3,
            fill: "#ffffff",
          },
        })),
      });
    }
  }

  if ((options.mouth ?? false) && creature.mouth !== false) {
    layers.push({
      target: "mouth",
      nodes: [
        path({
          d: mouthPath(creature, mood),
          fill: "none",
          stroke: filled ? FACE_INK : mouthColor(mood),
          "stroke-width": 100,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ],
    });
  }

  if (mood === "sad") {
    layers.push({
      target: "tear",
      nodes: [
        path({
          d: "M 5200 3300 C 5260 3420 5260 3510 5200 3550 C 5140 3510 5140 3420 5200 3300 Z",
          fill: "#3b82f6",
          opacity: 0,
        }),
      ],
    });
  }

  return { body, mood, viewBox: VIEW_BOX, color, layers };
}

/**
 * The reference drawing of a body: the silhouette filled, the detail in ink,
 * and two solid black eyes, with no mouth, brows or antenna effects.
 * The fill is `var(--bood-color, <colour>)`, so a page can recolour it.
 */
export function referenceScene(body: BoodBody, color = "#2f9e5b"): BoodScene {
  const creature = creatures[body];
  const [left, right] = eyeGeometry(creature, "neutral", "dark");
  // In `style`, not the attributes: a presentation attribute does not read CSS variables.
  const paint = (fill: string, stroke: string) => ({
    style: `fill: ${fill}; stroke: ${stroke}`,
  });
  const fill = `var(--bood-color, ${color})`;
  const layers: BoodLayer[] = [
    {
      target: "body",
      nodes: creature.parts("neutral").map((part) =>
        path({
          d: part.d,
          // The silhouette and a body made only of strokes, as the logo, take
          // the colour; a detail drawn on the silhouette is faint black ink.
          // A shaded part is a faint black or white over the colour, as it is
          // filled darker or lighter on a filled body.
          ...paint(
            part.dark
              ? "#000000"
              : part.light
                ? "#ffffff"
                : part.shape
                  ? fill
                  : part.fill
                    ? "#000000"
                    : "none",
            part.dark || part.light
              ? "none"
              : part.detail === true
                ? "#000000"
                : fill,
          ),
          "stroke-width": part.width,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: part.dark
            ? 0.3
            : part.light
              ? 0.18
              : part.detail === true
                ? (part.opacity ?? 0.3)
                : 1,
        }),
      ),
    },
    {
      target: "pupils",
      nodes: [left, right].map((eye) => ({
        tag: "ellipse",
        attrs: {
          cx: eye.cx,
          cy: eye.cy,
          rx: eye.rx * 0.3,
          ry: eye.ry * 0.45,
          fill: "#000000",
        },
      })),
    },
  ];
  if (creature.antenna !== undefined) {
    const { stem, dotX, dotY } = antennaGeometry(
      creature.antenna,
      antennaByMood.neutral,
    );
    layers.push({
      target: "antenna",
      nodes: [
        path({
          d: stem,
          ...paint("none", fill),
          "stroke-width": 100,
          "stroke-linecap": "round",
        }),
        {
          tag: "circle",
          attrs: {
            cx: dotX,
            cy: dotY,
            r: ANTENNA_DOT_R,
            ...paint("none", fill),
            "stroke-width": 50,
          },
        },
      ],
    });
  }
  return { body, mood: "neutral", viewBox: VIEW_BOX, color, layers };
}
