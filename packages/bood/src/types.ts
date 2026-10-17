/**
 * The shapes every part of bood shares: what a creature is, what a mood is,
 * what a renderer is handed, and what motion is made of.
 *
 * A renderer gets two things and nothing else: a scene, which is a stack of
 * layers of plain SVG nodes, and timelines, which move those layers by their
 * target with transform and opacity only. Transform and opacity are what a
 * browser's compositor and React Native's native driver animate off the main
 * thread, so the same data runs smoothly on both. The one exception is a
 * body's `flow`, an outline that keeps changing (see `BodyFlow`).
 */

/** A body tag, as a bot record names it. */
export type BoodBody =
  | "logo"
  | "robot"
  | "humanoid"
  | "owl"
  | "alien"
  | "gumbo"
  | "circle"
  | "jelly"
  | "smash"
  | "square"
  | "rectangle"
  | "tall"
  | "slant"
  | "diamond"
  | "triangle"
  | "wedge"
  | "pizza"
  | "pentagon"
  | "hexagon"
  | "star"
  | "burst"
  | "cross"
  | "heart"
  | "leaf"
  | "bubble"
  | "drop"
  | "bean"
  | "cloud"
  | "ghost"
  | "slime"
  | "flame"
  | "rock"
  | "moon"
  | "balloon";

/** doop's agent states, and four plain expressions. */
export type BoodMood =
  | "idle"
  | "observing"
  | "thinking"
  | "planning"
  | "executing"
  | "reflecting"
  | "waiting_external"
  | "learning"
  | "failed"
  | "error"
  | "neutral"
  | "happy"
  | "sad"
  | "surprised";

export type BoodScheme = "dark" | "light";

/** A short move a body plays when asked to. */
export type BoodAction =
  | "reboot"
  | "radar"
  | "faceShift"
  | "shakeGrow"
  | "vanish"
  | "haunt"
  | "teleport"
  | "scan"
  | "wobble"
  | "split"
  | "roll"
  | "pop"
  | "shapes"
  | "squash"
  | "flip"
  | "tumble"
  | "rubik"
  | "spin"
  | "pyramid"
  | "cartwheel"
  | "sharpen"
  | "rotate"
  | "aura"
  | "drip"
  | "bubble"
  | "wiggle"
  | "jump"
  | "fart"
  | "puff"
  | "thud"
  | "flare"
  | "sway"
  | "float"
  | "beat";

/** A way any body leaves and comes back: it plays its hide half to go and its show half to come. */
export type BoodTransit =
  | "beam"
  | "phantom"
  | "jelly"
  | "blackHole"
  | "spin"
  | "erase"
  | "portal"
  | "dust"
  | "melt"
  | "glitch"
  | "jump"
  | "bubble";

/** A mouth, drawn at a point. */
export type MouthShape = (x: number, y: number) => string;

/** One stroked path of a body. */
export interface BodyPart {
  d: string;
  width: number;
  fill?: boolean;
  opacity?: number;
  /** Drawn only at the full detail level. */
  detail?: boolean;
  /** The silhouette: filled with the body colour when the body is filled. */
  shape?: boolean;
  /** Filled with a darker shade of the body colour when the body is filled. */
  dark?: boolean;
  /** Filled with a lighter shade of the body colour when the body is filled, as a lit face. */
  light?: boolean;
}

/**
 * Outlines the silhouette flows through, in a loop, as a jelly's edge does.
 * Each frame has the same commands as the silhouette's path, so a renderer
 * blends one into the next. This is the one motion that redraws a path
 * instead of moving a layer, so it runs on the main thread.
 */
export interface BodyFlow {
  /**
   * The frames of one loop. A renderer that can asks again at every loop, so a
   * body may give new frames each time, as the flame's random flicker does.
   * Every call gives the same number of frames.
   */
  frames: () => string[];
  /** One loop through every frame and back to the silhouette. */
  ms: number;
  /**
   * True for frames that sample one smooth motion, which the outline passes
   * through without slowing. Otherwise it eases into and out of every frame,
   * as the slime does as it settles into each shape.
   */
  glide?: boolean;
}

export interface EyePlacement {
  centerX: number;
  centerY: number;
  gap: number;
  scale: number;
}
export interface MouthPlacement {
  x: number;
  y: number;
  shapes?: Partial<Record<BoodMood, MouthShape>>;
}
/**
 * A dot eye drawn as an animal's eye: a coloured iris that stays put and a
 * big round pupil with a glint that looks about inside it. For a body whose
 * eye holes show what is behind it, such as the owl's, where a lone dark dot
 * would vanish.
 */
export interface IrisPlacement {
  /** The iris's radius, about the size of the eye hole. */
  r: number;
  /** The pupil's radius. */
  pupil: number;
  color: string;
}
export interface AntennaPlacement {
  x: number;
  y: number;
  stemHeight: number;
}

/** One creature, declared once, in its own file under `creatures/`. */
export interface BoodCreature {
  id: BoodBody;
  /** Offered when a new bot is made. A body still being fixed is not. */
  released: boolean;
  /** The name a new bot of this body is offered, as ahpapp offered it. */
  name: string;
  /** The body's paths for a mood. Most bodies are the same in every mood. */
  parts: (mood: BoodMood) => BodyPart[];
  eyes: EyePlacement;
  /** With dot eyes, each eye is an iris and a pupil instead of a dot. */
  iris?: IrisPlacement;
  /** False for a body with no mouth of its own, as the owl, whose beak is drawn in its parts. */
  mouth: MouthPlacement | false;
  antenna?: AntennaPlacement;
  /** False for a body drawn with no brows. */
  brows?: boolean;
  /** The moves it plays, in the order a click plays them. */
  actions: BoodAction[];
  /** The silhouette's flow, for a body whose outline never holds still. */
  flow?: BodyFlow;
  /**
   * How far the face slides when the body turns to one side, as a share of the
   * drawing's width. A round body turns more than a flat one. Default 0.07.
   */
  turn?: number;
}

/** A plain SVG element: what every renderer knows how to draw. */
export interface SvgNode {
  tag: "path" | "circle" | "ellipse" | "rect" | "g" | "animate";
  attrs: Record<string, string | number>;
  children?: SvgNode[];
}

/**
 * What a layer is moved by. The figure is a fixed nest of wrappers, outside in:
 * `wipe` > `act` > `look` > `shake` > `breath`, and inside `breath` the body,
 * the `antenna`, and the `face` with its `brows`, `eyes` (`rings`, `pupils` with each dot eye as `pupilL` and `pupilR`,
 * `glints`) and `mouth`. An `fx:` layer is an effect that one move adds.
 */
export type BoodTarget =
  | "wipe"
  | "unwipe"
  | "act"
  | "look"
  | "shake"
  | "breath"
  | "body"
  | "antenna"
  | "face"
  | "brows"
  | "eyes"
  | "pupils"
  | "pupilL"
  | "pupilR"
  | "glints"
  | "mouth"
  | "tear"
  | `fx:${string}`;

/** Where an effect layer sits: behind the body, over the body inside the figure, or over everything. */
export type BoodFxPlace = "behind" | "figure" | "antenna" | "front";

export interface BoodLayer {
  target: BoodTarget;
  nodes: SvgNode[];
  /** For an `fx:` layer: where it sits. */
  place?: BoodFxPlace;
  /** For an `fx:` layer: a copy of the whole figure, cut to a band of its height when `band` is set. */
  clone?: { band?: [number, number] };
}

/** One creature in one mood, ready to draw. */
export interface BoodScene {
  body: BoodBody;
  mood: BoodMood;
  viewBox: string;
  /** The colour the body is drawn in. */
  color: string;
  layers: BoodLayer[];
}

/** How a change between two keys is paced. */
export type BoodEasing =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "in-quad"
  | "out-quad"
  | "in-out-cubic"
  | "spring"
  | "soft-spring"
  | { steps: number };

/** The values a timeline moves. Distances are in drawing units, angles in degrees. */
export type BoodChannel = "x" | "y" | "turn" | "skew" | "sx" | "sy" | "opacity";

/** One value at one time, in ms from the timeline's start. The easing paces the change to the next key. */
export interface BoodKey {
  at: number;
  value: number;
  easing?: BoodEasing;
}

export interface BoodTrack {
  /** The point it turns and scales about, in drawing units. */
  origin?: [number, number];
  channels: Partial<Record<BoodChannel, BoodKey[]>>;
}

/** Motion: every target's channels as keys over one duration. */
export interface BoodTimeline {
  duration: number;
  /** How many times it plays; `Infinity` loops. Default 1. */
  iterations?: number;
  tracks: Partial<Record<BoodTarget, BoodTrack>>;
}

/** A move to play: its motion, and the effect layers it adds while it plays. */
export interface BoodPlay {
  timeline: BoodTimeline;
  layers: BoodLayer[];
  /** Keep the end state when it is done, as a transit's hide half does. */
  hold?: boolean;
  /** Cut the figure to the drawing's box while it plays, as `erase` wipes it from the feet up. */
  clip?: boolean;
}
