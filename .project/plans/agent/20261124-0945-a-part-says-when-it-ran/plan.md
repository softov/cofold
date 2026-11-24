---
title: A part says when it ran
domain: agent
status: planned
priority: high
created: 2026-11-24
revalidated: 2026-11-24
refs:
  - "[code://packages/agents/src/types/message.ts#L3-L31](../../../../packages/agents/src/types/message.ts#L3-L31) - the content parts, with no time"
  - "[code://packages/agents/src/run/turn.ts#L316-L330](../../../../packages/agents/src/run/turn.ts#L316-L330) - `callModel`, which streams the deltas of one model call"
  - "[code://packages/agents/src/run/turn.ts#L333-L370](../../../../packages/agents/src/run/turn.ts#L333-L370) - `processCalls`, which runs each tool call"
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `ReasoningResponsePart.startedAt` and `duration`, which ahpd fills from these times
---

## Goal

Each content part a run writes says when it started and when it ended. A reader of a transcript, such as ahpd's agent-cofold, can say how long a model thought, wrote or ran a tool, after a restart too.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "createdAt" packages/agents/src/types/message.ts` on 2026-11-24 - a message has a time; its parts do not.
- `rg "reasoning.delta" packages/agents/src` - `callModel` sees each delta of a streamed reply before the reply is whole.

### Gaps

- No part has a time.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every part a run writes gets `startedAt` and `endedAt` | Softov, 2026-11-24, chose "Every part's start and end" | 01 |
| The times are ISO 8601 strings, as `createdAt` is | `(defaulted: the shape the message already uses)` | 01 |
| A streamed part starts at its first delta and ends at its last; a part of a reply that did not stream takes the model call's start and end | `(defaulted: the only clock a non-streamed reply has)` | 02 |
| A tool result starts when its call begins to run and ends when it has a result | `(defaulted: the time the tool ran)` | 02 |
| Both fields are optional, so an older transcript still reads | `(defaulted: transcripts on disk have none)` | 01 |

## Proposed architecture

- **Data flow** - `callModel` notes the time of each part's first and last delta; the reply's parts are stamped before the message is written.
- **State flow** - the times are written with the message, so a resumed run reads them.
- **Layer responsibilities** - `@cofold/agents`: the types and the stamping.
- **Source-of-truth files** - [`code://packages/agents/src/types/message.ts`](../../../../packages/agents/src/types/message.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a part has a start and an end](task-01-a-part-has-a-start-and-an-end.md) | todo | - |
| [02 - a run stamps each part](task-02-a-run-stamps-each-part.md) | todo | 01 |

## Risks and tradeoffs

- Parts may not follow the order of their deltas - a part is matched by kind and by place among parts of that kind.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-part-has-a-start-and-an-end.md](task-01-a-part-has-a-start-and-an-end.md).
- **Open questions:** none.
- **Watch out for:** `textOf()` and the context builder must ignore the new fields.

## Final verification checklist

- [ ] A streamed reply's parts each have `startedAt` and `endedAt`.
- [ ] A tool result has the time its tool ran.
- [ ] A transcript with no times still loads.
- [ ] `pnpm test` passes in the repository.
