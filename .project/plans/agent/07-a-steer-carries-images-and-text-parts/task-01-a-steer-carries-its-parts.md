---
title: A steer carries its parts to the transcript
status: done
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/command.ts#L20](../../../../packages/agents/src/types/command.ts#L20) - the `steer` command"
  - "[code://packages/agents/src/run/steering.ts#L6-L29](../../../../packages/agents/src/run/steering.ts#L6-L29) - the queue and the drain"
  - "[code://packages/agents/src/run/resume.ts#L54-L58](../../../../packages/agents/src/run/resume.ts#L54-L58) - the resumed handle's own `steer`, which enqueues like `run()`'s"
---

## Objective

`submit({ type: 'steer', text, parts })` puts one user message in the transcript whose parts are the text part, if the text is not empty, then `parts`.

## Files

- `UPDATE: packages/agents/src/types/command.ts:20` - `{ type: 'steer'; text: string; parts?: (TextPart | ImagePart)[] }`.
- `UPDATE: packages/agents/src/types/turn.ts:38` - `Steer` gets `parts?`.
- `UPDATE: packages/agents/src/run/steering.ts` - `enqueueSteer` takes the parts; `drainSteering` builds the message from the text and the parts.
- `UPDATE: packages/agents/src/run/handle.ts:62-66` and `packages/agents/src/run/run.ts:43` - pass the parts through.
- `UPDATE: packages/agents/src/run/resume.ts:54-58` - the resumed handle's `steer` passes the parts through too; `enqueueSteer`'s new parameter forces it.
- `UPDATE: packages/agents/src/run/steering.test.ts` - the cases below.
- papo is not touched: its steer stays text-only, as the plan's second table decides.

## Steps

1. Write the tests.
2. Add `parts` to the command and to `Steer`.
3. Pass it through the handle, `run()` and `resume()` to the queue.
4. Build the message in `drainSteering`. Leave out the text part when the text is empty.

## Validation

- `steering.test.ts`: a steer with text and an image part gives a message with both parts.
- The same file: `run.steered` carries that message.
- The same file: a steer with empty text and one image gives a message with the image only.
- The same file: a steer with `text` only gives the same message as before.
- The repo's typecheck and test commands pass.

## Resume

Implemented 2026-10-07.
The command and `Steer` carry `parts?`; `enqueueSteer` takes them, and a private `partsOf` builds the message `drainSteering` appends: the text part first, then the parts, with the text part left out only when the text is empty and a part carries the message, so a steer never appends a message with no parts.
`handle.submit`, `run()` and `resume()` pass them through; `resume.ts` was not in the Files list and is forced by `enqueueSteer`'s signature, and Softov accepted adding it.
Tests 7 to 10 in `steering.test.ts` cover a text with an image (one message with both parts, carried by `run.steered` and seen by the model's next request), an empty text with an image (the image alone), a text-only steer (the message it always gave), and an empty text with no parts (the empty text message it always gave, which the review asked for after the first cut left the message with no parts).
`packages/agents/README.md`'s `submit({ type: 'steer' })` line was updated with it, and it was not in the Files list either.
papo is untouched, as the plan's second table decides; what waits is in `deferred.md`.
