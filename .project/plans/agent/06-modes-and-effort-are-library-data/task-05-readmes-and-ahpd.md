---
title: The READMEs name the lists, and ahpd's copies are planned away
status: done
depends: [task-01-the-permission-modes.md, task-02-the-thinking-levels.md, task-03-a-reasoning-param-turns-reasoning-on.md]
layer: "docs; ahpd after a cofold release"
refs:
  - "[code://packages/agents/README.md](../../../../packages/agents/README.md) - permission modes and model params"
  - file:///github/ahpd/packages/agent-cofold/src/agent.ts - lines 124 and 137-158 (the copies) and 370-374 (the forced feature)
  - file:///github/ahpd/packages/agent-cofold/src/turnagent.ts - lines 48-53, `modeOf`
---

## Objective

The agents README lists the modes with their descriptions and the levels with `effortOf`; an ahpd plan, opened after the cofold release, replaces ahpd's copies and drops the forced `features.reasoning`, keeping its labels.

## Files

- `UPDATE: packages/agents/README.md` - the two lists and `effortOf`.
- `UPDATE: ahpd packages/agent-cofold/src/agent.ts:124,137-158,374` and `turnagent.ts:48-53` - in an ahpd plan, not here.

## Steps

1. Write the README change.
2. After the cofold release, open the ahpd plan and put its path in *Resume*.

## Validation

- The README lists match the exports.
- The ahpd plan names this task and the cofold versions it needs.

## Resume

- **Built:** `packages/agents/README.md` documents both lists. The *Rules* section ends with `policyOf(mode, rules)`, the rule-lists-first ordering and a snippet showing `PERMISSION_MODES` and `PERMISSION_MODE_DESCRIPTIONS`; the *Models and providers* section gains `EFFORT_LEVELS`, `EffortLevel` and `effortOf` with the `effort !== undefined` spread, and the note that `ReasoningEffort` is wider than a level. The *Layout* block gained the `src/policy/` line it was missing and `effortOf` beside `costOf`.
- **The README lists match the exports:** the six modes are written in `PERMISSION_MODES`'s order, the `plan` sentence is copied from `PERMISSION_MODE_DESCRIPTIONS`, and the four levels are the ones `EFFORT_LEVELS` holds.
- **The ahpd half is not built here:** the ahpd copies (`agent.ts:124`, `137-158`, the forced `features.reasoning` at `374`, `turnagent.ts:48-53`) are replaced in an ahpd plan, after a cofold release; that is *Resume*'s step 2 and waits. It is recorded in the plan's `deferred.md` rather than opened here, since it is outside this repository and this worktree.

