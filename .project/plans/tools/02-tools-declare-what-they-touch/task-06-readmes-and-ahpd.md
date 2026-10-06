---
title: The READMEs say what a tool declares, and ahpd's removals are planned
status: done
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

- **Built:** the README half only. `packages/agents/README.md` gained the `tool.proposed { callId, name, input, subject? }` announcement in the loop paragraph (with the two ways the field is absent); a paragraph and a self-contained `write_file` snippet showing `subject` beside `writes` in *Rules*, saying which of the two words means what; the `policyOf` paragraph now takes `{ inside }` alone and says `isEdit` is optional and defaults to `tool.writes !== undefined`; and `Capability.exclude` in the capabilities paragraph. `packages/tools/README.md` gained a *Subject, `writes`* column on the `files()` table, the paragraph after it (path tools, the two writers and their `writes`, the three read-only ones declaring none, and that the subject is the string `tool.proposed` carries), the `shell_exec` sentence saying why it declares no `writes`, the subjects of `web_fetch` and `web_search`, and the memory tools' subjects with `memory_write`'s `writes`.
- **Not built:** the ahpd half. It is another repository's work and the plan ties it to a cofold release, which this build does not make (nothing is committed, pushed or tagged here), so no ahpd plan was opened and no path is in this *Resume*. It is in [deferred.md](deferred.md) with what it removes.
- **Validation:** every claim was read off the code before it was written - `packages/agents/src/run/tools.ts` for the announcement, `types/tool.ts` and `tools/files.ts` for `writes`, `policy/modes.ts:68-75` for the `acceptEdits` path and the `declaresWrites` default, `policy/rules.ts:27` for a `match` reading `tool.subject`, `run/turn.ts` for `exclude`, and each tool in `packages/tools/src` for its own subject. `pnpm typecheck` and `pnpm test` are recorded in [implemented.md](implemented.md).

