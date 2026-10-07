---
title: A steer carries image and text parts, not only a string - implemented
date: 2026-10-07
refs:
  - git://5749a3b - the last commit before this plan's work; everything below is uncommitted on top of it
  - "[code://packages/agents/src/run/steering.ts](../../../../packages/agents/src/run/steering.ts) - `enqueueSteer`, `partsOf` and `drainSteering`"
  - "[code://packages/agents/src/types/command.ts](../../../../packages/agents/src/types/command.ts) - the `steer` command, `text` and optional `parts`"
  - "[code://packages/agents/src/types/turn.ts](../../../../packages/agents/src/types/turn.ts) - `Steer`"
  - "[code://packages/agents/src/run/handle.ts](../../../../packages/agents/src/run/handle.ts) - `submit` hands the parts to the run"
  - "[code://packages/agents/src/run/run.ts](../../../../packages/agents/src/run/run.ts)"
  - "[code://packages/agents/src/run/resume.ts](../../../../packages/agents/src/run/resume.ts)"
  - "[code://packages/agents/src/run/steering.test.ts](../../../../packages/agents/src/run/steering.test.ts) - tests 7 to 9"
  - "[code://packages/agents/README.md](../../../../packages/agents/README.md) - the `submit({ type: 'steer' })` line"
---

A message sent to a running turn can carry image and text parts, as a run's first input can: `submit({ type: 'steer', text, parts })` appends one `user` message whose parts are the text part when the text is not empty, then the parts, and `run.steered` carries that message.
ahpd can send a steered message with its attachments, and a model whose `features.images` is true sees the image.

## What was built

- [`code://packages/agents/src/types/command.ts`](../../../../packages/agents/src/types/command.ts) - `{ type: 'steer'; text: string; parts?: (TextPart | ImagePart)[] }`.
- [`code://packages/agents/src/types/turn.ts`](../../../../packages/agents/src/types/turn.ts) - `Steer` carries `parts?` beside `text`.
- [`code://packages/agents/src/run/steering.ts`](../../../../packages/agents/src/run/steering.ts) - `enqueueSteer(queue, text, parts?)`; the private `partsOf(steer)` returns the text part first, then the parts, and leaves the text part out only when `text` is empty and there is at least one part, so a steer never appends a message with no parts; `drainSteering` builds each message with it, so the transcript and `run.steered` take the parts with no other change.
- [`code://packages/agents/src/run/handle.ts`](../../../../packages/agents/src/run/handle.ts) - the `steer` callback is `(text, parts?)` and `submit` passes `command.parts`.
- [`code://packages/agents/src/run/run.ts`](../../../../packages/agents/src/run/run.ts), [`code://packages/agents/src/run/resume.ts`](../../../../packages/agents/src/run/resume.ts) - both handles pass the parts to `enqueueSteer`.
- [`code://packages/agents/README.md`](../../../../packages/agents/README.md) - the `submit({ type: 'steer' })` line names `parts?`, the order they land in, the empty-text rule, and that an image needs `features.images`.

## Verified

- `pnpm check` on 2026-10-07, after the review fix: 949 tests across 75 files, all passed, no type errors. `@cofold/agents` is 255 tests across 24 files.
- [`code://packages/agents/src/run/steering.test.ts`](../../../../packages/agents/src/run/steering.test.ts) is 11 tests: the seven that were there, plus 7 (a text with an image gives one message with both parts, `run.steered` carries it, and the model's next request sees the image), 8 (an empty text with an image gives a message with the image alone), 9 (a text-only steer gives the message it always did), and 10 (an empty text with no parts gives `[{ type: 'text', text: '' }]`, as it did before this plan).
- No manual run: the change is a type and a message the tests read straight off the store.

## Departures from the plan

- The task's Files list did not name `packages/agents/src/run/resume.ts`; `enqueueSteer`'s new parameter forces it, and Softov accepted adding it to the list. The plan's refs gained it too.
- The task's Files list did not name `packages/agents/README.md`; its `submit({ type: 'steer' })` line documents the surface this task changed, so it was updated with it. This is the one file changed that the plan does not name.
- papo is untouched, as Softov decided on 2026-10-07 (the plan's second table): its `say` and `queue` stay text-only, so a held steer carries no parts. See [deferred.md](deferred.md).
- Line numbers in the plan's and the task's `code://` refs moved with the edits and were corrected to the code as it now stands.
- The task's Objective and the plan's second table read "the message is the text part, if the text is not empty, then the parts", which taken literally drops the text part from an empty text with no parts and leaves a message with no parts, which a model adapter may refuse. The review caught this and `partsOf` now leaves the text part out only when the text is empty and a part carries the message; both documents were left as they are, and their stated rationale ("an existing caller that sends `text` is unchanged") is what the code now does.

## Left for later

- papo's `say` and `queue` taking parts, so a held steer keeps them - see [deferred.md](deferred.md).
