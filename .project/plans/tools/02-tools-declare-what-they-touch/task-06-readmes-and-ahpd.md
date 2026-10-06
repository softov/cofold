---
title: The READMEs say what a tool declares, and ahpd's removals are planned
status: todo
depends: [task-01-web-and-memory-subjects.md, task-02-a-tool-declares-the-file-it-writes.md, task-03-tool-proposed-carries-the-subject.md, task-04-a-capability-leaves-out-tools.md]
layer: "docs; ahpd after a cofold release"
refs:
  - "[code://packages/agents/README.md](../../../../packages/agents/README.md) - tools, events, capabilities, permission modes"
  - "[code://packages/tools/README.md](../../../../packages/tools/README.md) - each tool's subject"
  - file:///github/ahpd/packages/agent-cofold/src/tools.ts - lines 176-224, the per-name subject fields
  - file:///github/ahpd/packages/agent-cofold/src/turnagent.ts - lines 35-45, `EDITS` and `editPathOf`
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 84-117, `withoutTaken` and `taken`
---

## Objective

The READMEs document `subject` on every standard tool, `writes`, `tool.proposed.subject`, `Capability.exclude` and the `isEdit` default; and an ahpd plan, opened after the cofold release, removes ahpd's name tables.

## Files

- `UPDATE: packages/agents/README.md` - the three new fields and the `acceptEdits` default.
- `UPDATE: packages/tools/README.md` - a subject column, and which tools declare `writes`.
- `UPDATE: ahpd packages/agent-cofold/src/tools.ts:176-224, turnagent.ts:35-45, capabilities.ts:84-117` - in an ahpd plan, not here: read `subject` from `tool.proposed`, `tool.writes(input)` (kept only when inside the workspace) instead of `EDITS`, and `exclude` instead of `withoutTaken`.

## Steps

1. Write the README changes.
2. After the cofold release, open the ahpd plan and put its path in *Resume*.

## Validation

- Each README example matches the code.
- The ahpd plan names this task and the cofold versions it needs.

## Resume

