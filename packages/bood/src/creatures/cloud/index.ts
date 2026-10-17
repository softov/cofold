import { defineCreature } from "../define.js";

/** A lopsided cloud: a tall bump on top, smaller ones round it, a bumpy base. */
const BODY =
  "M 2040 4175 C 714 3767 1292 2135 2278 2033 C 2176 571 3706 95 4556 1251 C 5814 265 6936 1421 6698 2339 C 7990 3087 7140 4685 5950 4311 C 4794 4923 3944 4175 3400 4413 C 2822 4719 2346 4651 2040 4175 Z";

export default defineCreature({
  id: "cloud",
  released: true,
  name: "Nimbo",
  parts: () => [{ d: BODY, width: 45, shape: true }],
  eyes: { centerX: 4250, centerY: 2600, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3650 },
  actions: ["fart", "puff"],
  turn: 0.08,
});
