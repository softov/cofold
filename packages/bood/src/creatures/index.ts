/** Every creature, by its body tag. A new creature is a folder here and one line below. */

import type { BoodBody, BoodCreature } from "../types.js";
import alien from "./alien/index.js";
import balloon from "./balloon/index.js";
import bean from "./bean/index.js";
import bubble from "./bubble/index.js";
import burst from "./burst/index.js";
import circle from "./circle/index.js";
import cloud from "./cloud/index.js";
import cross from "./cross/index.js";
import diamond from "./diamond/index.js";
import drop from "./drop/index.js";
import flame from "./flame/index.js";
import ghost from "./ghost/index.js";
import gumbo from "./gumbo/index.js";
import heart from "./heart/index.js";
import hexagon from "./hexagon/index.js";
import humanoid from "./humanoid/index.js";
import jelly from "./jelly/index.js";
import leaf from "./leaf/index.js";
import logo from "./logo/index.js";
import moon from "./moon/index.js";
import owl from "./owl/index.js";
import pentagon from "./pentagon/index.js";
import pizza from "./pizza/index.js";
import rectangle from "./rectangle/index.js";
import robot from "./robot/index.js";
import rock from "./rock/index.js";
import slant from "./slant/index.js";
import slime from "./slime/index.js";
import smash from "./smash/index.js";
import square from "./square/index.js";
import star from "./star/index.js";
import tall from "./tall/index.js";
import triangle from "./triangle/index.js";
import wedge from "./wedge/index.js";

export const creatures: Record<BoodBody, BoodCreature> = {
  logo,
  robot,
  humanoid,
  owl,
  alien,
  gumbo,
  circle,
  jelly,
  smash,
  square,
  rectangle,
  tall,
  slant,
  diamond,
  triangle,
  wedge,
  pizza,
  pentagon,
  hexagon,
  star,
  burst,
  cross,
  heart,
  leaf,
  bubble,
  drop,
  bean,
  cloud,
  ghost,
  slime,
  flame,
  rock,
  moon,
  balloon,
};

export const BOOD_BODIES = Object.keys(creatures) as BoodBody[];

/** The bodies a new bot is given from. The rest wait for fixes or a later release. */
export const BOOD_RELEASED: BoodBody[] = BOOD_BODIES.filter(
  (body) => creatures[body].released,
);

/** Old body tags a bot record may still carry, and the body each is now. */
export const BOOD_ALIASES: Readonly<Record<string, BoodBody>> = {
  semicircle: "jelly",
};

/** The body a stored tag names, through its old name if it has one; undefined for a tag no body has. */
export function bodyOf(tag: string): BoodBody | undefined {
  if (Object.hasOwn(creatures, tag)) return tag as BoodBody;
  return Object.hasOwn(BOOD_ALIASES, tag) ? BOOD_ALIASES[tag] : undefined;
}

/** The moves each body plays, in the order a click plays them. */
export function actionsOf(body: BoodBody) {
  return creatures[body].actions;
}
