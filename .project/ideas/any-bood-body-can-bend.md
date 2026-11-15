---
title: Any bood body bends
created: 2026-11-15
refs:
  - "[code://packages/bood/src/types.ts#L174](../../packages/bood/src/types.ts#L174) - `BodyBend`, which only the clip declares"
  - "[code://packages/bood/src/motion/actions.ts#L836-L852](../../packages/bood/src/motion/actions.ts#L836-L852) - `bend` and `lean`, where a body without `BodyBend` leans whole from its base"
  - "[code://packages/bood/src/creatures/outline.ts#L62](../../packages/bood/src/creatures/outline.ts#L62) - `outline`, which turns any path into polygons that a bend could deform"
---

The `bend` and `lean` moves curve the clip's wire, because the clip declares a `BodyBend`.
Every other body leans whole from its base, so these two moves are rigid on 34 bodies.
Any body could bend from its own outline, as the clip bends from its wire.
Then each body plays the same move with the same feel, as bood promises for every move.
