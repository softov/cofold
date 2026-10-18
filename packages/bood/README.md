# @cofold/bood

The bood creatures: thirty-four bodies with faces and moods, declared once as data, with motion as keyframes that any renderer can play.
No dependencies.

- **Creatures** live one per folder in `src/creatures/<name>/`: `index.ts` declares the body, and `reference.svg` is its reference drawing.
- **A scene** is a creature in a mood, as a stack of layers of plain SVG nodes.
- **Motion** is keyframes on transform and opacity only, which browsers and React Native's native driver both animate off the main thread.

```ts
import { action, ambient, pose, scene, walk } from "@cofold/bood";
import { mountBood } from "@cofold/bood/dom";

const view = mountBood(element, scene("robot", { mood: "thinking", filled: true, brows: true, mouth: true }));
for (const loop of ambient("robot", "thinking")) view.play(loop);
view.play(pose("robot", "thinking", { facing: -1 }), { key: "pose" });
view.play(action("robot", "radar", { color: "#2f9e5b" }), { key: "act" });
```

A scene keeps the base colour in every mood unless it is asked for the mood's: `color: "mood"`. A picked colour, as `color: "#2f9e5b"`, holds whatever the mood.
On a filled body, `mouthTone: "body"` draws the mouth in the body's own tone instead of ink: the body colour darker, or lighter on a body too dark for darker to show, as black or navy (`bodyTone`).

## What moves

| Function | What it plays |
| --- | --- |
| `action(body, name, { color })` | One of a body's moves, such as `jump`, `roll` or `rubik`. Any body can play any move. |
| `transit(kind, "hide" \| "show", { color })` | A way out or back in, such as `portal`, `dust` or `glitch`. The hide half holds the body hidden. |
| `ambient(body, mood)` | The loops of a mood: breath, brows, the antenna's pulse, radar, waves and particles, an error's shake, a sad tear. |
| `pose(body, mood, { facing, lift, tilt, depth }, from)` | A head turn: the face slides and narrows toward where it looks, and the head rolls as a face on a ball does (up and left turns it clockwise). `tilt` leans the head left or right without looking anywhere. `depth` draws the side turned toward the viewer bigger and the side turned away smaller, 0.1 for a tenth each way: facing left grows the right eye and shrinks the left, looking up grows the mouth and shrinks the eyes, and the other way round. Held. |
| `walk(direction)` | Steps in place, and the distance the host moves the body over the same time. |
| `blink`, `glance`, `swing`, `pop` | The small moments a host fires now and then. |
| `view.talk(open)` | The mouth opened `open` of the way, 0 to 1, as it speaks: narrower, open most in the middle. Call it every frame with a level read from a voice; 0 gives the mood's mouth back. It redraws the mouth's path, so it runs on the main thread. `mouthOpen(creature, mood, open)` is the same shape as path data, for another renderer. |

Each returns a `BoodPlay`: a timeline of keys per target and channel, and the effect layers the move draws while it plays.
`cssFrames(timeline, target)` turns a timeline into Web Animations keyframes; `sampleKeys` reads any channel at any time for another renderer.
Two channels turn a layer in depth, `yaw` and `pitch`, seen from `BOOD_PERSPECTIVE` drawing units away; only `pose` with a `depth` uses them. `cssFrames` writes that perspective in `cqw`, so the box spanning the drawing must be a size container, as `mountBood` makes it; another renderer converts `BOOD_PERSPECTIVE` to its own units, as React Native takes `perspective` in points.

## Renderers

- `@cofold/bood/dom` draws in a browser with the Web Animations API. Moves add up, so a walk, a glance and a blink run together. A `key` replaces the move played under the same key.
- `sceneSvg(scene)` writes a still drawing as one SVG document, for a page, a file or a server.
- React Native: draw each layer in its own `Svg` inside an `Animated.View`, and drive the views from the same keys. This renderer is not written yet.

## Develop

```sh
npm run dev          # the playground at http://127.0.0.1:5199, rebuilt and reloaded on change
npm run references   # rewrite every src/creatures/<name>/reference.svg
```

The playground takes its state from the address, so a look is a link: `?body=ghost&mood=happy&facing=1&tab=grid`.
