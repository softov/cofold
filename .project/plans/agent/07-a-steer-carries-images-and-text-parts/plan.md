---
title: A steer carries image and text parts, not only a string
domain: agent
status: built
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agents/src/types/command.ts#L20](../../../../packages/agents/src/types/command.ts#L20) - the `steer` command: `text` and the optional `parts`"
  - "[code://packages/agents/src/types/turn.ts#L37-L38](../../../../packages/agents/src/types/turn.ts#L37-L38) - `Steer`, the queued steer with `text` and its `parts`"
  - "[code://packages/agents/src/run/steering.ts#L6-L29](../../../../packages/agents/src/run/steering.ts#L6-L29) - `enqueueSteer`, `partsOf` and `drainSteering`: the queue and the message a steer becomes"
  - "[code://packages/agents/src/run/handle.ts#L62-L66](../../../../packages/agents/src/run/handle.ts#L62-L66) - `submit` passes `command.text` and `command.parts` to the run"
  - "[code://packages/agents/src/run/run.ts#L43](../../../../packages/agents/src/run/run.ts#L43) - `steer: (text, parts) => enqueueSteer(...)`"
  - "[code://packages/agents/src/run/resume.ts#L54-L58](../../../../packages/agents/src/run/resume.ts#L54-L58) - the resumed handle's own `steer`, which enqueues the same way"
  - "[code://packages/agents/src/types/run.ts#L14](../../../../packages/agents/src/types/run.ts#L14) - a run's `input` is `string | ContentPart[]`, the shape a steer now matches"
  - "file:///github/ahpd/.project/plans/plugin/36-a-cofold-turn-reads-its-attachments/plan.md - the ahpd plan that sends a steered message's attachments"
---

## Goal

A message sent to a running turn can carry images and text parts, as a run's first input can.
ahpd sends a steered message with its attachments, and a model that takes images sees the image.

## Reconnaissance

### Searches performed

- `rg "steer" packages/agents/src` - the command, the queue entry, `enqueueSteer` and the handle all carry a `text` string only.
- `drainSteering` already builds a `Message` from `parts`, so the transcript takes parts without change.

### Runtime path

```
handle.submit({ type: 'steer', text, parts }) -> args.steer -> enqueueSteer -> drainSteering -> Message.parts -> run.steered
```

### Gaps

- `Not found: a steer with parts - searched "steer" in packages/agents/src`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | none | - |

| What | Source | Task |
| --- | --- | --- |
| A steer takes image and text parts | Softov, 2026-10-07, chose "cofold steer takes content" for ahpd plugin 36 | 01 |
| The command keeps `text` and adds an optional `parts: (TextPart \| ImagePart)[]`; the message is the text part, if the text is not empty, then the parts | (defaulted: an existing caller that sends `text` is unchanged) | 01 |
| papo's steer stays text-only in this plan; widening `say` and `queue` to carry parts waits for later | Softov, 2026-10-07, "change papo latter and sent nothing now" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A steer carries its parts to the transcript](task-01-a-steer-carries-its-parts.md) | done | - |

## Risks and tradeoffs

- An image part sent to a model without image input fails the next step. The caller checks the model's `features.images` before it sends one, as it does for a run's input.

## Resume state

- **Done so far:** task 01 implemented 2026-10-07; see [implemented.md](implemented.md).
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none.
- **Watch out for:** `@cofold/agents` only: papo's steer stays text-only, so a held steer carries no parts; the message is the text part first, then the parts, with the text part left out only when `text` is empty and a part carries the message, so an empty text with an image gives a message with the image alone and an empty text with no parts gives the empty text message it always did.

## Final verification checklist

- [x] A test: a steer with an image part puts a message with that part in the transcript, and `run.steered` carries it.
- [x] A test: a steer with `text` only is unchanged.
- [x] The repo's typecheck and test commands pass.
- [x] `plans/index.md` updated.
