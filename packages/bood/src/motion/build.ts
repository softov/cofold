/**
 * A small language for motion that reads like React Native's `Animated`:
 * `seq`, `all`, `to`, `wait`. It compiles to plain keys per target and
 * channel, so a move is written once and played by any renderer.
 */

import type {
  BoodChannel,
  BoodEasing,
  BoodKey,
  BoodTarget,
  BoodTimeline,
  BoodTrack,
} from "../types.js";

/** The value each channel rests at between moves. */
export const REST: Record<BoodChannel, number> = {
  x: 0,
  y: 0,
  turn: 0,
  skew: 0,
  sx: 1,
  sy: 1,
  opacity: 1,
};

type Keys = Map<string, BoodKey[]>;

interface Context {
  keys: Keys;
  /** Each channel's value as the steps so far leave it. */
  now: Map<string, number>;
}

/** One step of a move: how long it takes, and what it writes from a start time. */
export interface Step {
  ms: number;
  run(at: number, context: Context): void;
}

const slot = (target: BoodTarget, channel: BoodChannel) =>
  `${target}|${channel}`;

/** Moves one channel of one target to `value` over `ms`. */
export function to(
  target: BoodTarget,
  channel: BoodChannel,
  value: number,
  ms: number,
  easing?: BoodEasing,
): Step {
  return {
    ms,
    run(at, { keys, now }) {
      const name = slot(target, channel);
      const list = keys.get(name) ?? [];
      const from = now.get(name) ?? REST[channel];
      const last = list[list.length - 1];
      // The key the change starts from: a new one, or the last one when it is at this time.
      if (last !== undefined && last.at === at) {
        last.value = from;
        if (easing === undefined) delete last.easing;
        else last.easing = easing;
      } else {
        list.push(
          easing === undefined
            ? { at, value: from }
            : { at, value: from, easing },
        );
      }
      list.push({ at: at + ms, value });
      keys.set(name, list);
      now.set(name, value);
    },
  };
}

/** Sets a channel at once, as a zero-length `to`. */
export function set(
  target: BoodTarget,
  channel: BoodChannel,
  value: number,
): Step {
  return to(target, channel, value, 0);
}

/** Moves several channels of one target together. */
export function move(
  target: BoodTarget,
  values: Partial<Record<BoodChannel, number>>,
  ms: number,
  easing?: BoodEasing,
): Step {
  return all(
    ...(Object.entries(values) as [BoodChannel, number][]).map(
      ([channel, value]) => to(target, channel, value, ms, easing),
    ),
  );
}

/** Waits. */
export function wait(ms: number): Step {
  return { ms, run() {} };
}

/** Runs the steps one after another. */
export function seq(...steps: Step[]): Step {
  return {
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    run(at, context) {
      let t = at;
      for (const step of steps) {
        step.run(t, context);
        t += step.ms;
      }
    },
  };
}

/** Runs the steps together; it takes as long as the longest. */
export function all(...steps: Step[]): Step {
  return {
    ms: steps.reduce((most, step) => Math.max(most, step.ms), 0),
    run(at, context) {
      for (const step of steps) step.run(at, context);
    },
  };
}

/** Runs `step(i)` for each `i` below `n`, one after another. */
export function repeat(n: number, step: (i: number) => Step): Step {
  return seq(...Array.from({ length: n }, (_, i) => step(i)));
}

/** A spring to rest: a quick overshoot and settle. */
export function settle(
  target: BoodTarget,
  channels: BoodChannel[],
  ms = 450,
): Step {
  return all(
    ...channels.map((channel) =>
      to(target, channel, REST[channel], ms, "spring"),
    ),
  );
}

/**
 * Compiles a step into a timeline. `origins` says where each target turns and
 * scales about; `from` gives values a channel starts at other than rest.
 */
export function timeline(
  step: Step,
  options: {
    origins?: Partial<Record<BoodTarget, [number, number]>>;
    from?: Partial<Record<BoodTarget, Partial<Record<BoodChannel, number>>>>;
    iterations?: number;
  } = {},
): BoodTimeline {
  const context: Context = { keys: new Map(), now: new Map() };
  for (const [target, values] of Object.entries(options.from ?? {})) {
    for (const [channel, value] of Object.entries(values ?? {})) {
      context.now.set(
        slot(target as BoodTarget, channel as BoodChannel),
        value,
      );
    }
  }
  step.run(0, context);
  const duration = Math.max(step.ms, 1);
  const tracks: Partial<Record<BoodTarget, BoodTrack>> = {};
  for (const [name, keys] of context.keys) {
    const [target, channel] = name.split("|") as [BoodTarget, BoodChannel];
    const track: BoodTrack = tracks[target] ?? { channels: {} };
    const origin = options.origins?.[target];
    if (origin !== undefined) track.origin = origin;
    track.channels[channel] = keys;
    tracks[target] = track;
  }
  for (const [target, origin] of Object.entries(options.origins ?? {})) {
    const track = tracks[target as BoodTarget];
    if (track !== undefined && origin !== undefined) track.origin = origin;
  }
  return options.iterations === undefined
    ? { duration, tracks }
    : { duration, tracks, iterations: options.iterations };
}
