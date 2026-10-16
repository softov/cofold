import { describe, expect, it } from "vitest";
import {
  BOOD_ACTIONS,
  BOOD_ALIASES,
  BOOD_BODIES,
  BOOD_MOODS,
  BOOD_RELEASED,
  BOOD_TRANSITS,
  action,
  ambient,
  blink,
  bodyOf,
  creatures,
  cssFrames,
  ease,
  glance,
  faceRoom,
  insideOutline,
  outline,
  pose,
  referenceScene,
  scene,
  sceneSvg,
  seq,
  timeline,
  to,
  toSvg,
  transit,
  walk,
  type BoodPlay,
  type BoodTarget,
} from "@cofold/bood";

/** Every frame of every target is a number, so a renderer never gets `NaN`. */
function expectPlayable(play: BoodPlay) {
  expect(play.timeline.duration).toBeGreaterThan(0);
  for (const target of Object.keys(play.timeline.tracks) as BoodTarget[]) {
    const { transform, opacity } = cssFrames(play.timeline, target);
    for (const frame of [...(transform ?? []), ...(opacity ?? [])]) {
      expect(frame.offset).toBeGreaterThanOrEqual(0);
      expect(frame.offset).toBeLessThanOrEqual(1);
      expect(frame.transform ?? "").not.toContain("NaN");
      if (frame.opacity !== undefined)
        expect(Number.isFinite(frame.opacity)).toBe(true);
    }
  }
}

describe("creatures", () => {
  it("registers each creature under its own id", () => {
    for (const body of BOOD_BODIES) expect(creatures[body].id).toBe(body);
    expect(BOOD_BODIES).toHaveLength(34);
  });

  it("reads an old body tag as the body it became", () => {
    expect(bodyOf("semicircle")).toBe("jelly");
    expect(bodyOf("jelly")).toBe("jelly");
    expect(bodyOf("constructor")).toBeUndefined();
    for (const body of Object.values(BOOD_ALIASES))
      expect(BOOD_BODIES).toContain(body);
  });

  it("gives every flowing body frames it can blend into", () => {
    const commands = (d: string) => d.replace(/[^A-Za-z]/g, "");
    for (const body of BOOD_BODIES) {
      const { flow } = creatures[body];
      if (flow === undefined) continue;
      const silhouette = creatures[body].parts("idle").find((p) => p.shape);
      expect(silhouette).toBeDefined();
      for (const frame of flow.frames)
        expect(commands(frame)).toBe(commands(silhouette?.d ?? ""));
      const drawn = scene(body, { filled: true }).layers[0]?.nodes[0];
      expect(drawn?.children?.[0]?.tag).toBe("animate");
    }
  });

  it("releases every body but the logo and the owl", () => {
    expect(BOOD_RELEASED).not.toContain("logo");
    expect(BOOD_RELEASED).not.toContain("owl");
    expect(BOOD_RELEASED).toHaveLength(32);
  });
});

describe("scene", () => {
  it("draws every body in every mood with a body layer and eyes", () => {
    for (const body of BOOD_BODIES) {
      for (const mood of BOOD_MOODS) {
        const drawn = scene(body, {
          mood,
          brows: true,
          mouth: true,
          eyes: "bood",
          filled: true,
        });
        const targets = drawn.layers.map((layer) => layer.target);
        expect(targets).toContain("body");
        expect(targets).toContain("pupils");
        expect(
          scene(body, { mood }).layers.map((layer) => layer.target),
        ).toEqual(expect.arrayContaining(["pupilL", "pupilR"]));
      }
    }
  });

  it("gives the robot an antenna and the circle none", () => {
    expect(scene("robot").layers.map((layer) => layer.target)).toContain(
      "antenna",
    );
    expect(scene("circle").layers.map((layer) => layer.target)).not.toContain(
      "antenna",
    );
  });

  it("writes a reference drawing with black eyes and a recolourable body", () => {
    const svg = sceneSvg(referenceScene("ghost"));
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 8500 5000"/,
    );
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain("var(--bood-color, #2f9e5b)");
  });
});

describe("toSvg", () => {
  it("escapes attribute values and closes empty elements", () => {
    expect(toSvg({ tag: "path", attrs: { d: 'M 0 0 "x" <y> &' } })).toBe(
      '<path d="M 0 0 &quot;x&quot; &lt;y> &amp;"/>',
    );
    expect(
      toSvg({
        tag: "g",
        attrs: {},
        children: [{ tag: "circle", attrs: { r: 1 } }],
      }),
    ).toBe('<g><circle r="1"/></g>');
  });
});

describe("motion", () => {
  it("lays steps one after another and keeps the last value", () => {
    const made = timeline(
      seq(to("act", "x", 100, 200), to("act", "x", 0, 300)),
    );
    expect(made.duration).toBe(500);
    expect(
      made.tracks.act?.channels.x?.map((key) => [key.at, key.value]),
    ).toEqual([
      [0, 0],
      [200, 100],
      [500, 0],
    ]);
  });

  it("eases from 0 to 1", () => {
    for (const easing of [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "in-quad",
      "out-quad",
      "in-out-cubic",
    ] as const) {
      expect(ease(easing, 0)).toBeCloseTo(0, 3);
      expect(ease(easing, 1)).toBeCloseTo(1, 3);
    }
    expect(ease({ steps: 4 }, 0.3)).toBe(0.25);
  });

  it("plays every action, on a body with an antenna and on one without", () => {
    for (const body of ["robot", "gumbo"] as const) {
      for (const name of BOOD_ACTIONS)
        expectPlayable(action(body, name, { color: "#2f9e5b" }));
    }
  });

  it("plays each body's own moves", () => {
    for (const body of BOOD_BODIES) {
      for (const name of creatures[body].actions)
        expectPlayable(action(body, name, { color: "#2f9e5b", filled: true }));
    }
  });

  it("plays both halves of every transit, and the hide half holds", () => {
    for (const kind of BOOD_TRANSITS) {
      const hide = transit(kind, "hide", { color: "#2f9e5b" });
      expectPlayable(hide);
      expect(hide.hold).toBe(true);
      expectPlayable(transit(kind, "show", { color: "#2f9e5b" }));
    }
  });

  it("loops the ambient motion of every mood", () => {
    for (const mood of BOOD_MOODS) {
      for (const play of ambient("robot", mood, { brows: true })) {
        expectPlayable(play);
        expect(play.timeline.iterations).toBe(Infinity);
      }
    }
  });

  it("turns the face toward the side it faces", () => {
    const right = pose("robot", "idle", { facing: 1 });
    const keys = right.timeline.tracks.face?.channels.x ?? [];
    expect(keys[keys.length - 1]?.value).toBeGreaterThan(0);
    expectPlayable(right);
    expectPlayable(blink("robot"));
    expectPlayable(glance("robot", "idle", 1, -1));
  });

  it("turns the head as a face on a ball: up and left clockwise, up and right counter-clockwise, flipped looking down", () => {
    const turn = (next: Parameters<typeof pose>[2]) => {
      const keys = pose("robot", "idle", next).timeline.tracks.look?.channels.turn ?? [];
      return keys[keys.length - 1]?.value ?? 0;
    };
    expect(turn({ facing: -1, lift: 1 })).toBeGreaterThan(0);
    expect(turn({ facing: 1, lift: 1 })).toBeLessThan(0);
    expect(turn({ facing: -1, lift: -1 })).toBeLessThan(0);
    expect(turn({ facing: 1, lift: -1 })).toBeGreaterThan(0);
  });

  it("tilts the head without looking anywhere", () => {
    const tilted = pose("robot", "idle", { facing: 0, tilt: 1 });
    const turn = tilted.timeline.tracks.look?.channels.turn ?? [];
    const face = tilted.timeline.tracks.face?.channels.x ?? [];
    expect(turn[turn.length - 1]?.value).toBeGreaterThan(0);
    expect(face[face.length - 1]?.value ?? 0).toBe(0);
    expect(pose("robot", "idle", { facing: 0, tilt: -1 }).timeline.tracks.look?.channels.turn?.at(-1)?.value).toBeLessThan(0);
    expectPlayable(tilted);
  });

  it("keeps every body's eyes on its face: a look never slides the face past the room its outline leaves", () => {
    for (const body of BOOD_BODIES) {
      const room = faceRoom(body, "idle");
      for (const lift of [1, -1]) {
        const keys = pose(body, "idle", { facing: 1, lift }).timeline.tracks.face?.channels.y ?? [];
        const y = keys[keys.length - 1]?.value ?? 0;
        expect(y).toBeGreaterThanOrEqual(-room.up - 1e-6);
        expect(y).toBeLessThanOrEqual(room.down + 1e-6);
      }
    }
    // A body whose eyes sit near its top has less room to look up than one whose eyes sit in its middle.
    expect(faceRoom("gumbo", "idle").up).toBeLessThan(faceRoom("square", "idle").up);
  });

  it("reads an outline's lines, curves and arcs, and says what is inside it", () => {
    const square = outline("M 0 0 H 100 V 100 H 0 Z");
    expect(insideOutline(square, 50, 50)).toBe(true);
    expect(insideOutline(square, 150, 50)).toBe(false);
    const circle = outline("M 0 50 A 50 50 0 1 1 100 50 A 50 50 0 1 1 0 50 Z");
    expect(insideOutline(circle, 50, 50)).toBe(true);
    expect(insideOutline(circle, 5, 5)).toBe(false);
    const relative = outline("m10 10c0,-10 80,-10 80,0l0 80 -80 0z");
    expect(insideOutline(relative, 50, 50)).toBe(true);
    expect(insideOutline(relative, 50, 95)).toBe(false);
  });

  it("walks the way it is told", () => {
    expect(walk(-1).travel).toBeLessThan(0);
    expect(walk(1, { steps: 2 }).travel).toBeGreaterThan(0);
    expectPlayable(walk(1).play);
  });
});
