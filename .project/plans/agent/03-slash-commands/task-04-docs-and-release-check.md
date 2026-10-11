---
title: The README describes slash commands, and agents 0.2.2 passes ahpd's suite
status: todo
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
