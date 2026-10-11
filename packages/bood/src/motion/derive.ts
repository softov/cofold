/** Helpers that build keys from other keys: an effect driven by a progress value, and a timeline run backwards. */

import type { BoodKey, BoodTimeline, BoodTrack } from "../types.js";
import { sampleKeys } from "./sample.js";

/** A value mapped through `input` to `output`, as Animated's `interpolate` with clamping. */
export function along(
  value: number,
  input: readonly number[],
  output: readonly number[],
): number {
  const first = input[0] as number;
  if (value <= first) return output[0] as number;
  for (let i = 1; i < input.length; i += 1) {
    const hi = input[i] as number;
    if (value <= hi) {
      const lo = input[i - 1] as number;
      const span = hi - lo;
      const a = output[i - 1] as number;
      const b = output[i] as number;
      return span <= 0 ? b : a + ((value - lo) / span) * (b - a);
    }
  }
  return output[output.length - 1] as number;
}

/** Keys for `fn(progress)` over `duration` ms, sampled every `stepMs` from the progress keys. */
export function derived(
  progress: readonly BoodKey[],
  duration: number,
  fn: (p: number) => number,
  stepMs = 16,
): BoodKey[] {
  const keys: BoodKey[] = [];
  for (let t = 0; t < duration; t += stepMs) {
    keys.push({
      at: t,
      value: fn(sampleKeys(progress, t, 0)),
      easing: "linear",
    });
  }
  keys.push({ at: duration, value: fn(sampleKeys(progress, duration, 0)) });
  return keys;
}

/** The same motion backwards in time, sampled every `stepMs`. */
export function reversed(timeline: BoodTimeline, stepMs = 16): BoodTimeline {
  const { duration } = timeline;
  const tracks: BoodTimeline["tracks"] = {};
  for (const [target, track] of Object.entries(timeline.tracks)) {
    if (track === undefined) continue;
    const back: BoodTrack = { channels: {} };
    if (track.origin !== undefined) back.origin = track.origin;
    for (const [channel, keys] of Object.entries(track.channels)) {
      if (keys === undefined) continue;
      const out: BoodKey[] = [];
      for (let t = 0; t < duration; t += stepMs) {
        out.push({
          at: t,
          value: sampleKeys(keys, duration - t, 0),
          easing: "linear",
        });
      }
      out.push({ at: duration, value: sampleKeys(keys, 0, 0) });
      back.channels[channel as keyof BoodTrack["channels"]] = out;
    }
    tracks[target as keyof BoodTimeline["tracks"]] = back;
  }
  return { ...timeline, tracks };
}
