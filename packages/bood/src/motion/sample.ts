/**
 * Reading a timeline at a time, and turning it into the keyframes a browser's
 * Web Animations API runs on its compositor.
 */

import { BOOD_H, BOOD_W, MIDDLE } from "../box.js";
import type {
  BoodChannel,
  BoodKey,
  BoodTarget,
  BoodTimeline,
  BoodTrack,
} from "../types.js";
import { REST } from "./build.js";
import { ease } from "./ease.js";

/** One channel's value at `t` ms. Before the first key it holds the first, after the last the last. */
export function sampleKeys(
  keys: readonly BoodKey[],
  t: number,
  rest: number,
): number {
  const first = keys[0];
  if (first === undefined) return rest;
  if (t <= first.at) return first.value;
  for (let i = 1; i < keys.length; i += 1) {
    const next = keys[i] as BoodKey;
    const prev = keys[i - 1] as BoodKey;
    if (t <= next.at) {
      const span = next.at - prev.at;
      if (span <= 0) return next.value;
      return (
        prev.value +
        (next.value - prev.value) * ease(prev.easing, (t - prev.at) / span)
      );
    }
  }
  return (keys[keys.length - 1] as BoodKey).value;
}

/** Every channel of one track at `t` ms. */
export function sampleTrack(
  track: BoodTrack,
  t: number,
): Record<BoodChannel, number> {
  const out = { ...REST };
  for (const [channel, keys] of Object.entries(track.channels)) {
    if (keys !== undefined) {
      out[channel as BoodChannel] = sampleKeys(
        keys,
        t,
        REST[channel as BoodChannel],
      );
    }
  }
  return out;
}

const pct = (value: number, of: number) =>
  `${Math.round((value / of) * 100000) / 1000}%`;

/**
 * A CSS transform for the values, turning and scaling about `origin`. It
 * carries its own origin, so moves with different origins add up on one
 * element. Percentages are of the element, which spans the drawing's box.
 */
export function cssTransform(
  values: Record<BoodChannel, number>,
  origin: [number, number] = MIDDLE,
): string {
  const [ox, oy] = origin;
  return [
    `translate(${pct(ox + values.x, BOOD_W)}, ${pct(oy + values.y, BOOD_H)})`,
    `rotate(${values.turn}deg)`,
    `skewX(${values.skew}deg)`,
    `scale(${values.sx}, ${values.sy})`,
    `translate(${pct(-ox, BOOD_W)}, ${pct(-oy, BOOD_H)})`,
  ].join(" ");
}

/** One frame of the Web Animations API, as plain data. */
export interface CssFrame {
  offset: number;
  transform?: string;
  opacity?: number;
}

/**
 * A target's keyframes, sampled every `stepMs` and at every key, so each
 * easing reaches the browser as straight segments it runs on its own.
 * `null` when the timeline does not move that target.
 */
export function cssFrames(
  timeline: BoodTimeline,
  target: BoodTarget,
  stepMs = 16,
): { transform: CssFrame[] | null; opacity: CssFrame[] | null } {
  const track = timeline.tracks[target];
  if (track === undefined) return { transform: null, opacity: null };
  const times = new Set<number>([0, timeline.duration]);
  for (let t = 0; t < timeline.duration; t += stepMs) times.add(t);
  for (const keys of Object.values(track.channels)) {
    for (const key of keys ?? [])
      times.add(Math.min(key.at, timeline.duration));
  }
  const sorted = [...times].sort((a, b) => a - b);
  const moves = Object.keys(track.channels).some(
    (channel) => channel !== "opacity",
  );
  const fades = track.channels.opacity !== undefined;
  const transform: CssFrame[] = [];
  const opacity: CssFrame[] = [];
  for (const t of sorted) {
    const values = sampleTrack(track, t);
    const offset = t / timeline.duration;
    if (moves)
      transform.push({ offset, transform: cssTransform(values, track.origin) });
    if (fades) opacity.push({ offset, opacity: values.opacity });
  }
  return {
    transform: moves ? transform : null,
    opacity: fades ? opacity : null,
  };
}
