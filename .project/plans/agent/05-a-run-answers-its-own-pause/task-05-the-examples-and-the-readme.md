---
title: The examples and the README say the handle answers its pause
status: done
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

- **Built:** `pause-resume.ts` spawns itself as a child process (`process.execPath`, `--experimental-strip-types`, the file, `child`, and the folder it must open) and process 1 prints its events up to the pause there; the parent then opens the same folder, reads the pending request out of the run record and the request store, and resumes. `ask-user.ts` reads its request off `input.requested` and submits the answers on the handle that is waiting, so nothing resumes. `examples/agents/README.md` and `packages/agents/README.md` were rewritten to the new shape.
- **Deviation:** the child stops at the `run.finished` that carries `awaiting` rather than at `run.paused`, because that is the last event the pause writes - exiting earlier can leave the folder without it, and the README's own expectation is seq 1..7 up to `run.finished`.
- **Deviation:** each process builds its own fake model with the one step it plays. The old example worked only because both processes shared one `createFakeModel` object in one process, so the script carried over; with a real child process the folder's second reader would otherwise be handed the tool call that was already answered and pause a second time. The two scripts are now `asksToDelete()` and `confirms()`.
- **Deviation:** the child is handed the temp folder as an argument. Without it the child runs its own `mkdtemp` and opens a folder the parent has never seen.
- **Validation:** both items pass. `pnpm --filter cofold-examples-agents pause-resume` prints seq 1..7 in the child, `--- process 1 exits; ... ---`, `paused: approval request ...`, the replay of 1..7, then 8..14, `completed notes.txt is gone.` and `tool steps: 1 (executions: 1)`; `pnpm --filter cofold-examples-agents ask-user` prints 1..8 up to the pause's `run.finished`, the two prompts, then 9..14 and `completed Scaffolding the project now.` with the answers on the step.
