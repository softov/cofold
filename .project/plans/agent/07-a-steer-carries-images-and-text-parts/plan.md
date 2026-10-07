---
title: A steer carries image and text parts, not only a string
domain: agent
status: planned
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agents/src/types/command.ts#L16](../../../../packages/agents/src/types/command.ts#L16) - the `steer` command, `text` only"
  - "[code://packages/agents/src/types/turn.ts#L37-L38](../../../../packages/agents/src/types/turn.ts#L37-L38) - `Steer`, a queued steer with `text` only"
  - "[code://packages/agents/src/run/steering.ts#L6-L22](../../../../packages/agents/src/run/steering.ts#L6-L22) - `enqueueSteer` and `drainSteering`, which builds a message of one text part"
  - "[code://packages/agents/src/run/handle.ts#L61-L65](../../../../packages/agents/src/run/handle.ts#L61-L65) - `submit` passes `command.text` to the run"
  - "[code://packages/agents/src/run/run.ts#L43](../../../../packages/agents/src/run/run.ts#L43) - `steer: (text) => enqueueSteer(...)`"
  - "[code://packages/agents/src/types/run.ts#L14](../../../../packages/agents/src/types/run.ts#L14) - a run's `input` is `string | ContentPart[]`, which a steer does not match"
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

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A steer carries its parts to the transcript](task-01-a-steer-carries-its-parts.md) | todo | - |

## Risks and tradeoffs

- An image part sent to a model without image input fails the next step. The caller checks the model's `features.images` before it sends one, as it does for a run's input.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-steer-carries-its-parts.md](task-01-a-steer-carries-its-parts.md).
- **Open questions:** none.
- **Watch out for:** papo holds a steer across a decision; the held steer must keep its parts.

## Final verification checklist

- [ ] A test: a steer with an image part puts a message with that part in the transcript, and `run.steered` carries it.
- [ ] A test: a steer with `text` only is unchanged.
- [ ] The repo's typecheck and test commands pass.
- [ ] `plans/index.md` updated.
