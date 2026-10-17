import { defineCreature } from "../define.js";

/** Goo: a jelly, domed, with a wavy rim and the ridges of its mould. */
const JELLY =
  "M 2000 4300 C 2000 3300 2300 2200 2800 1600 C 3200 1100 3700 950 4250 950 C 4800 950 5300 1100 5700 1600 C 6200 2200 6500 3300 6500 4300 C 6500 4500 6350 4600 6150 4600 C 5850 4600 5850 4430 5675 4430 C 5500 4430 5500 4600 5200 4600 C 4900 4600 4900 4430 4725 4430 C 4550 4430 4550 4600 4250 4600 C 3950 4600 3950 4430 3775 4430 C 3600 4430 3600 4600 3300 4600 C 3000 4600 3000 4430 2825 4430 C 2650 4430 2650 4600 2350 4600 C 2150 4600 2000 4500 2000 4300 Z";
const LEFT_RIDGE = "M 3300 1150 Q 2900 2800 3200 4450";
const RIGHT_RIDGE = "M 5200 1150 Q 5600 2800 5300 4450";

export default defineCreature({
  id: "jelly",
  released: true,
  name: "Jello",
  parts: () => [
    { d: JELLY, width: 45, shape: true },
    { d: LEFT_RIDGE, width: 40, opacity: 0.35, detail: true },
    { d: RIGHT_RIDGE, width: 40, opacity: 0.35, detail: true },
  ],
  eyes: { centerX: 4250, centerY: 2700, gap: 810, scale: 0.7 },
  mouth: { x: 4250, y: 3750 },
  actions: ["shapes"],
  turn: 0.07,
});
