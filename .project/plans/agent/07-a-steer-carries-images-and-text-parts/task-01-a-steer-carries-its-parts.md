---
title: A steer carries its parts to the transcript
status: todo
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/command.ts#L16](../../../../packages/agents/src/types/command.ts#L16) - the `steer` command"
  - "[code://packages/agents/src/run/steering.ts#L6-L22](../../../../packages/agents/src/run/steering.ts#L6-L22) - the queue and the drain"
---

## Objective

`submit({ type: 'steer', text, parts })` puts one user message in the transcript whose parts are the text part, if the text is not empty, then `parts`.

## Files

- `UPDATE: packages/agents/src/types/command.ts:16` - `{ type: 'steer'; text: string; parts?: (TextPart | ImagePart)[] }`.
- `UPDATE: packages/agents/src/types/turn.ts:38` - `Steer` gets `parts?`.
- `UPDATE: packages/agents/src/run/steering.ts` - `enqueueSteer` takes the parts; `drainSteering` builds the message from the text and the parts.
- `UPDATE: packages/agents/src/run/handle.ts:61-65` and `packages/agents/src/run/run.ts:43` - pass the parts through.
- `UPDATE: the papo code that holds a steer across a decision` - keep the parts with the held steer.
- `UPDATE: packages/agents/src/run/steering.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Add `parts` to the command and to `Steer`.
3. Pass it through the handle and the run to the queue.
4. Build the message in `drainSteering`. Leave out the text part when the text is empty.

## Validation

- `steering.test.ts`: a steer with text and an image part gives a message with both parts.
- The same file: `run.steered` carries that message.
- The same file: a steer with empty text and one image gives a message with the image only.
- The same file: a steer with `text` only gives the same message as before.
- The repo's typecheck and test commands pass.

## Resume
