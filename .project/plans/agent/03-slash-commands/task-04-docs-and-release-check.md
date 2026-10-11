---
title: The README describes slash commands, and agents 0.2.2 passes ahpd's suite
status: implemented
depends: [task-02-the-harness-runs-a-command.md, task-03-the-harness-expands-a-skill.md]
layer: docs
refs:
  - "[code://packages/agents/README.md](../../../../packages/agents/README.md) - says `compact()` takes an ask; has a Compaction section"
  - file:///github/ahpd/packages/agent-cofold - the consumer of `@cofold/agents`
---

## Objective

The agents README explains the three kinds of slash line, and the package is ready for 0.2.2 with ahpd's suite green against it.

## Files

- `UPDATE: packages/agents/README.md` - a section on slash commands; the Compaction section names `/compact`.
- `UPDATE: packages/agents/package.json` - version 0.2.2.

## Steps

1. Add a section that names runtime, prompt and client commands, with one example each.
2. Say in the Compaction section that `/compact` is the command and `compact()` runs it.
3. Remove the README line that says `compact()` takes its own ask.
4. Set the version to 0.2.2.
5. Pack `@cofold/agents` and run ahpd's agent-cofold suite against the tarball.

## Validation

- ahpd's agent-cofold suite passes against the packed package.
- The README examples type-check if copied into a test file.

## Resume

- **Done so far:** the README has a "Slash commands" section with one example per kind, the Compaction section names `/compact`, and the version is 0.2.2. The README examples type-check in a test file. ahpd's agent-cofold suite passes against the packed 0.2.2: 223 of 223, as against 0.2.1.
- **Watch out for:** ahpd's `pnpm typecheck` fails against 0.2.2 at `packages/agent-cofold/src/mapping.ts:718`: its exhaustive event switch does not handle `command.started` and `command.finished`. See [deferred.md](deferred.md).
