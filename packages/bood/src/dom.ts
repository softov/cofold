/// <reference lib="dom" />
/**
 * @cofold/bood/dom: bood in a browser.
 *
 * The figure is a fixed nest of boxes, one per target, each the size of the
 * drawing and holding its layer's SVG. Motion is handed to the Web Animations
 * API as transform and opacity keyframes, which the browser runs on its
 * compositor. Moves add up: each transform animation is `composite: "add"`
 * and carries its own origin, so a walk, a glance and a blink run together.
 */

import { BOOD_H, BOOD_W, VIEW_BOX } from "./box.js";
import { cssFrames } from "./motion/sample.js";
import { toSvg } from "./svg.js";
import type { BoodLayer, BoodPlay, BoodScene, BoodTarget } from "./types.js";

/** A move that plays: wait for it, or stop it. */
export interface BoodPlaying {
  finished: Promise<void>;
  cancel(): void;
}

export interface BoodView {
  /** The box that holds the figure; it fills its container's width at the drawing's aspect. */
  readonly root: HTMLDivElement;
  /** Draws another scene, a mood change, without stopping what plays. */
  setScene(scene: BoodScene): void;
  /** Plays a move. A `key` replaces the move that played under the same key. */
  play(play: BoodPlay, options?: { key?: string; rate?: number }): BoodPlaying;
  /** Stops the move under `key`. */
  stop(key: string): void;
  /** Stops everything and removes the figure. */
  destroy(): void;
}

/** The targets that hold a layer of the scene. */
const LAYERED: BoodTarget[] = [
  "body",
  "antenna",
  "brows",
  "eyes",
  "pupils",
  "pupilL",
  "pupilR",
  "glints",
  "mouth",
  "tear",
];

const SVG_NS = "http://www.w3.org/2000/svg";

function box(name: string): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset["bood"] = name;
  Object.assign(el.style, {
    position: "absolute",
    inset: "0",
    transformOrigin: "0 0",
    pointerEvents: "none",
  });
  return el;
}

function svg(): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", VIEW_BOX);
  el.setAttribute("width", "100%");
  el.setAttribute("height", "100%");
  el.style.overflow = "visible";
  el.style.position = "absolute";
  el.style.inset = "0";
  return el;
}

/** Draws `scene` in `container` and returns the handle that moves it. */
export function mountBood(container: HTMLElement, scene: BoodScene): BoodView {
  const root = document.createElement("div");
  root.dataset["bood"] = "root";
  Object.assign(root.style, {
    position: "relative",
    width: "100%",
    aspectRatio: `${BOOD_W} / ${BOOD_H}`,
  });

  const el: Partial<Record<BoodTarget, HTMLDivElement>> = {};
  const art: Partial<Record<BoodTarget, SVGSVGElement>> = {};
  const make = (target: BoodTarget, parent: HTMLElement, drawn: boolean) => {
    const node = box(target);
    parent.append(node);
    el[target] = node;
    if (drawn) {
      const drawing = svg();
      node.append(drawing);
      art[target] = drawing;
    }
    return node;
  };

  // The nest, outside in. The slots hold the effect layers a move adds.
  const wipe = make("wipe", root, false);
  const unwipe = make("unwipe", wipe, false);
  const act = make("act", unwipe, false);
  const look = make("look", act, false);
  const shake = make("shake", look, false);
  const breath = make("breath", shake, false);
  const behind = box("slot:behind");
  breath.append(behind);
  make("body", breath, true);
  const figure = box("slot:figure");
  breath.append(figure);
  const antenna = make("antenna", breath, true);
  const antennaSlot = box("slot:antenna");
  antenna.append(antennaSlot);
  const face = make("face", breath, false);
  make("brows", face, true);
  const eyes = make("eyes", face, true);
  const pupils = make("pupils", eyes, true);
  make("pupilL", pupils, true);
  make("pupilR", pupils, true);
  make("glints", eyes, true);
  make("mouth", face, true);
  make("tear", breath, true);
  const front = box("slot:front");
  root.append(front);
  const slots = { behind, figure, antenna: antennaSlot, front };
  container.append(root);

  const draw = (next: BoodScene) => {
    for (const target of LAYERED) {
      const drawing = art[target];
      if (drawing === undefined) continue;
      drawing.innerHTML = next.layers
        .filter((layer) => layer.target === target)
        .flatMap((layer) => layer.nodes.map(toSvg))
        .join("");
    }
  };
  draw(scene);

  const keyed = new Map<string, BoodPlaying>();
  const all = new Set<BoodPlaying>();

  const addFx = (layer: BoodLayer): HTMLDivElement => {
    const node = box(layer.target);
    if (layer.clone !== undefined) {
      node.append(look.cloneNode(true));
      const band = layer.clone.band;
      if (band !== undefined)
        node.style.clipPath = `inset(${band[0] * 100}% 0 ${(1 - band[1]) * 100}% 0)`;
    } else {
      const drawing = svg();
      drawing.innerHTML = layer.nodes.map(toSvg).join("");
      node.append(drawing);
    }
    slots[layer.place ?? "front"].append(node);
    return node;
  };

  const play = (
    what: BoodPlay,
    options: { key?: string; rate?: number } = {},
  ): BoodPlaying => {
    if (options.key !== undefined) keyed.get(options.key)?.cancel();
    const fx = new Map<BoodTarget, HTMLDivElement>();
    for (const layer of what.layers) fx.set(layer.target, addFx(layer));
    const { timeline } = what;
    const timing: KeyframeAnimationOptions = {
      duration: timeline.duration,
      iterations: timeline.iterations ?? 1,
      fill: what.hold === true ? "forwards" : "none",
      easing: "linear",
    };
    const animations: Animation[] = [];
    for (const target of Object.keys(timeline.tracks) as BoodTarget[]) {
      const node = fx.get(target) ?? el[target];
      if (node === undefined) continue;
      const frames = cssFrames(timeline, target);
      if (frames.transform !== null) {
        animations.push(
          node.animate(frames.transform as Keyframe[], {
            ...timing,
            composite: "add",
          }),
        );
      }
      if (frames.opacity !== null) {
        animations.push(
          node.animate(frames.opacity as Keyframe[], {
            ...timing,
            composite: "replace",
          }),
        );
      }
    }
    if (options.rate !== undefined)
      for (const one of animations) one.playbackRate = options.rate;
    if (what.clip === true) wipe.style.overflow = "hidden";
    let ended = false;
    let forgotten = false;
    /** The effects go when the move ends. */
    const end = () => {
      if (ended) return;
      ended = true;
      for (const node of fx.values()) node.remove();
      if (what.clip === true) wipe.style.overflow = "";
    };
    /**
     * The handle goes when nothing of the move is left. A held move keeps its
     * end state on the element after it finishes, so it stays known, under its
     * key too, until it is cancelled; otherwise the next move under that key
     * would add to it instead of replacing it.
     */
    const forget = () => {
      if (forgotten) return;
      forgotten = true;
      all.delete(handle);
      if (options.key !== undefined && keyed.get(options.key) === handle)
        keyed.delete(options.key);
    };
    const handle: BoodPlaying = {
      finished: Promise.all(animations.map((one) => one.finished)).then(
        () => {
          end();
          if (what.hold !== true) forget();
        },
        () => {
          end();
          forget();
        },
      ),
      cancel() {
        for (const one of animations) one.cancel();
        end();
        forget();
      },
    };
    all.add(handle);
    if (options.key !== undefined) keyed.set(options.key, handle);
    return handle;
  };

  return {
    root,
    setScene: draw,
    play,
    stop(key) {
      keyed.get(key)?.cancel();
    },
    destroy() {
      for (const one of [...all]) one.cancel();
      root.remove();
    },
  };
}
