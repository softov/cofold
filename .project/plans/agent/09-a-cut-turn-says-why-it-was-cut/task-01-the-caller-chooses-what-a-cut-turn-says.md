---
title: The caller chooses what a cut turn says
status: todo
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/run/turn.ts#L138-L149](../../../../packages/agents/src/run/turn.ts#L138-L149) - `interrupt`, which reads the texts from the context"
  - "[code://packages/agents/src/message/markers.ts#L1-L6](../../../../packages/agents/src/message/markers.ts#L1-L6) - the defaults go beside the two texts"
  - "[code://packages/agents/src/types/run.ts#L7-L36](../../../../packages/agents/src/types/run.ts#L7-L36) - the option goes beside `signal`"
  - "[code://packages/agents/src/run/interrupt.test.ts](../../../../packages/agents/src/run/interrupt.test.ts) - the interrupt tests"
---

## Objective

`run`, `compact` and `resume` take `interrupted(abort)`, which returns the turn text and the tool text a cut turn writes.
With no option, `interruptedText(abort)` writes the plan's defaults.

## Files

- `UPDATE: packages/agents/src/types/abort.ts` - add `InterruptText` (`{ turn, tool }`) and `Interrupted` (`(abort: AbortReason) => InterruptText`).
- `UPDATE: packages/agents/src/types/run.ts:7-36` - add `interrupted?: Interrupted` to `RunArgs`, `CompactArgs` and `ResumeArgs`.
- `UPDATE: packages/agents/src/types/turn.ts` - add `interrupted: Interrupted` to `TurnContext`.
- `UPDATE: packages/agents/src/message/markers.ts` - add `interruptedText`, the defaults.
- `UPDATE: packages/agents/src/run/turn.ts:41-81` - `createTurnContext` takes `interrupted` and defaults it to `interruptedText`.
- `UPDATE: packages/agents/src/run/turn.ts:138-149` - `interrupt` writes `ctx.interrupted(reason)`.
- `UPDATE: packages/agents/src/run/run.ts` - pass `args.interrupted` to the context.
- `UPDATE: packages/agents/src/run/resume.ts` - pass `args.interrupted` to the context.
- `UPDATE: packages/agents/src/index.ts` - export `interruptedText` and the two types.
- `UPDATE: packages/agents/src/run/interrupt.test.ts` - the cases in Validation.
- `UPDATE: packages/agents/README.md:72` - name the option and the defaults beside `cancel`.
- `UPDATE: docs/agents/README.md` - name the option where it lists the run options, if it lists them.

## Steps

1. Write the tests in `interrupt.test.ts` and see them fail.
2. Add the types to `types/abort.ts` and the option to `types/run.ts`.
3. Add `interruptedText` to `markers.ts`.
4. Put `interrupted` on the turn context in `run.ts`, `resume.ts` and `createTurnContext`.
5. Make `interrupt` write the texts that `ctx.interrupted` returns.
6. Export `interruptedText`, `InterruptText` and `Interrupted` from the package index.
7. Update the README line on `cancel` and the timeout.
8. Run `pnpm typecheck` and `pnpm test`.

## Validation

- `interrupt.test.ts`: a cancel with no reason writes `INTERRUPTED` and `INTERRUPTED_TOOL`.
- `interrupt.test.ts`: `cancel({ reason: 'restart' })` writes `[Request interrupted: restart]` and `[Request interrupted for tool use: restart]`.
- `interrupt.test.ts`: a timeout writes `[Request interrupted: timeout]` and the tool text with `timeout`.
- `interrupt.test.ts`: `interrupted` on `run` replaces both texts and gets the abort reason.
- `interrupt.test.ts`: a cancel at a pause, on a `resume` handle with `interrupted`, writes the caller's texts.
- `pnpm typecheck` and `pnpm test` pass.

## Resume
