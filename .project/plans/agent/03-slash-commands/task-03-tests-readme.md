---
title: The harness README names slash commands
status: todo
depends: [task-02-registry-built-ins.md]
layer: docs
refs:
  - code://packages/agents/README.md
---

## Objective

A reader of the `@facio/agents` README knows what a slash command is, how to declare one, which are built in, and how a command run looks in the transcript.

## Files

- `UPDATE: packages/agents/README.md` - a "Slash commands" section (the type, `definition.slashCommands`, `capability.slashCommands`, the built-in `compact`, the `command` and `notice` messages, the events); the "Compaction" section rewritten around `/compact`; the `compact()` mention removed.
- `UPDATE: .project/plans/agent/00-agent.md` - the contracts list and the runtime path gain slash commands.

## Steps

1. Write the section after "Skills"; one line says a skill is a prompt the model reads and a command is something the runtime runs.
2. Correct the domain reference.

## Validation

- Every symbol the README names exists (`rg` each one).

## Resume

