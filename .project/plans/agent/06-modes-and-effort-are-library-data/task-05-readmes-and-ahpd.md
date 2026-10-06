---
title: The READMEs name the lists, and ahpd's copies are planned away
status: todo
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

