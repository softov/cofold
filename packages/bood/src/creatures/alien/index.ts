import { defineCreature } from "../define.js";
import { smallMouth } from "../mouths.js";

/** A tall head that narrows to a chin, with a small sensor on top. */
const BODY =
  "M4235 561c1003,0 1850,944 1850,1846 0,903 -1064,2309 -1850,2404 -690,-77 -1850,-1502 -1850,-2404 0,-903 847,-1846 1850,-1846z";
const TOP =
  "M4269 1049c-44,0 -80,-36 -80,-80 0,-44 36,-80 80,-80 44,0 80,36 80,80 0,40 -30,73 -69,79l0 96 53 27 2 120c-27,-28 -72,-32 -104,-8 -35,26 -43,76 -17,111 26,35 76,43 111,17 35,-26 43,-76 17,-111";

export default defineCreature({
  id: "alien",
  released: true,
  parts: () => [
    { d: BODY, width: 45, shape: true },
    { d: TOP, width: 20, opacity: 0.35, detail: true },
  ],
  eyes: { centerX: 4250, centerY: 2600, gap: 900, scale: 0.8 },
  mouth: { x: 4250, y: 3900, shapes: smallMouth },
  brows: false,
  actions: ["teleport", "scan"],
  turn: 0.08,
});
