import type { BoodCreature, MouthPlacement } from "../types.js";

/** Declares one creature. The function is the identity; it is here so each file reads as a declaration and is checked as one. */
export function defineCreature(creature: BoodCreature): BoodCreature {
  return creature;
}

/** Where most bodies keep their mouth. */
export const DEFAULT_MOUTH: MouthPlacement = { x: 4233, y: 3750 };
