import { DEFAULT_MOUTH, defineCreature } from "../define.js";

/** A helmeted head with cheek plates and a crest. */
const HEAD =
  "M4230 299l241 0c877,0 1594,718 1594,1594l0 1295c0,877 -718,1594 -1594,1594l-472 0c-877,0 -1594,-718 -1594,-1594l0 -1295c0,-877 718,-1594 1594,-1594l232 0";
const LEFT_CHEEK = "M2423 3436l642 476 252 716c-467,-223 -810,-666 -893,-1193z";
const RIGHT_CHEEK = "M6045 3436l-642 476 -252 716c467,-223 810,-666 893,-1193z";
const CREST =
  "M4899 358l0 477 -431 275 -468 0 -431 -275 0 -477c137,-38 280,-59 429,-59l472 0c148,0 292,21 429,59z";
const CREST_EDGE =
  "M4899 358 L4899 835 L4468 1110 L4000 1110 L3569 835 L3569 358";
const CREST_INNER =
  "M3749 318 L3749 774 L4059 972 L4410 972 L4719 774 L4719 318";
const CREST_FILL =
  "M4552 721l0 -420c-27,-1 -54,-2 -81,-2l-472 0c-27,0 -54,1 -81,2l0 420 197 126 241 0 197 -126z";

export default defineCreature({
  id: "humanoid",
  released: true,
  name: "Frost",
  parts: () => [
    { d: HEAD, width: 34, shape: true },
    { d: LEFT_CHEEK, width: 4, fill: true, detail: true },
    { d: RIGHT_CHEEK, width: 4, fill: true, detail: true },
    { d: CREST, width: 4, detail: true },
    { d: CREST_EDGE, width: 42, detail: true },
    { d: CREST_INNER, width: 85, detail: true },
    { d: CREST_FILL, width: 2, fill: true, detail: true },
  ],
  eyes: { centerX: 4240, centerY: 2540, gap: 1000, scale: 0.75 },
  mouth: DEFAULT_MOUTH,
  actions: ["faceShift", "shakeGrow"],
  turn: 0.08,
});
