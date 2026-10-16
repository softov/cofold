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

## What moves

| Function | What it plays |
| --- | --- |
| `action(body, name, { color })` | One of a body's moves, such as `jump`, `roll` or `rubik`. Any body can play any move. |
| `transit(kind, "hide" \| "show", { color })` | A way out or back in, such as `portal`, `dust` or `glitch`. The hide half holds the body hidden. |
| `ambient(body, mood)` | The loops of a mood: breath, brows, the antenna's pulse, radar, waves and particles, an error's shake, a sad tear. |
| `pose(body, mood, { facing, lift, tilt }, from)` | A head turn: the face slides and narrows toward where it looks, and the head rolls as a face on a ball does (up and left turns it clockwise). `tilt` leans the head left or right without looking anywhere. Held. |
| `walk(direction)` | Steps in place, and the distance the host moves the body over the same time. |
| `blink`, `glance`, `swing`, `pop` | The small moments a host fires now and then. |

Each returns a `BoodPlay`: a timeline of keys per target and channel, and the effect layers the move draws while it plays.
`cssFrames(timeline, target)` turns a timeline into Web Animations keyframes; `sampleKeys` reads any channel at any time for another renderer.

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
