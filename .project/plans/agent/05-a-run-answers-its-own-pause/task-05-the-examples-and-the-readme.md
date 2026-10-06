---
title: The examples and the README say the handle answers its pause
status: todo
depends: [task-02-the-run-waits-at-its-pause.md, task-03-every-handle-ends-with-run-finished.md]
layer: "docs"
refs:
  - "[code://examples/agents/pause-resume.ts#L20-L27](../../../../examples/agents/pause-resume.ts#L20-L27) - process 1 reads the events to the end and expects an `awaiting` outcome"
  - "[code://examples/agents/ask-user.ts#L15-L17](../../../../examples/agents/ask-user.ts#L15-L17) - the same on an input pause"
  - "[code://examples/agents/README.md#L57-L66](../../../../examples/agents/README.md#L57-L66) - the expected output of `pause-resume`"
  - "[code://packages/agents/README.md#L70](../../../../packages/agents/README.md#L70) - `outcome` \"resolves to exactly one of completed | awaiting | ...\""
  - "[code://packages/agents/README.md#L87-L111](../../../../packages/agents/README.md#L87-L111) - *Pause and resume*"
---

## Objective

The two pause examples run against the new handle, and the agents README says that a run's handle takes the answer to its own pause and that `resume()` is for a run another process left.

## Files

- `UPDATE: examples/agents/pause-resume.ts` - process 1 runs in a child process (the script spawns itself with an argument) and exits at `run.paused`; process 2 resumes as today.
- `UPDATE: examples/agents/ask-user.ts` - answers on the first handle, reading the request from `input.requested`.
- `UPDATE: examples/agents/README.md:57-66` - the expected output.
- `UPDATE: packages/agents/README.md:70,87-111` - `outcome` resolves at the run's end; *Pause and resume* opens with answering on the same handle, then `resume()` after a restart; `approval.requested` follows the `awaiting` record; every stream ends with `run.finished`.

## Steps

1. Change the examples and run each.
2. Rewrite the README sections; one sentence per idea, no history.

## Validation

- `pnpm --filter cofold-examples-agents pause-resume` prints the child's events up to `run.paused`, then the replay and the approval, `completed notes.txt is gone.` and `tool steps: 1 (executions: 1)`.
- `pnpm --filter cofold-examples-agents ask-user` completes.

## Resume

