---
title: CLI-06 - papo says what a session used, in tokens, and heads the conversation with what the session is
domain: cli
status: built
priority: high
created: 2026-09-18
revalidated: 2026-09-18
requires:
  - plans/cli/04-papo-harness-adoption/plan.md
  - plans/cli/05-papo-defaults-picker-thought/plan.md
decisions:
  - decisions/papo-usage-replaces-cost.md
  - decisions/papo-session-head-rows.md
refs:
  - code://packages/agents/src/types/store.ts#L40-L58 - `RunRecord`: `usage`, `steps`, `denials` per run; tool calls are the `tool` step records
  - code://packages/agents/src/model/usage.ts - `ZERO_USAGE`, `addUsage`: the arithmetic the sum reuses
  - code://packages/papo/src/screen/app.tsx#L532-L539 - `chat.status` and `chat.cost` (tokens per turn, no dollars, despite the name)
  - code://packages/papo/src/screen/app.tsx#L615-L637 - `statusLines`, `costLines`, `total`: the sums the screen did itself
  - code://packages/papo/src/screen/chat.tsx#L82-L88 - the transcript's `head`, only before the first message
  - code://packages/papo/src/screen/sessions.tsx#L13 - `sessionView(row)`: a `SessionRow` as `@textui/chat`'s `ChatSession`
  - code://textui/packages/chat/src/sessionhead.tsx - `ChatSessionHead { session, model?, settings? }`: title and status, harness, settings rows, workspace, started/updated, session id
  - code://ahpc/src/screens.tsx#L796-L810 - how ahpc mounts it as the transcript's head, memoised on a signature
---

## Goal

`/usage` says what a session used, from what the harness already records and nothing else: tokens by kind (input, output, cache read and write, reasoning), steps, tool calls and denials, per turn and in total, with no prices anywhere.
The conversation opens with a header that says what the session is: title and state, session id, started and updated, model, permissions, thinking, auto-compact, workspace and home, turns and tokens.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg "costLines|chat.cost" packages/papo/src` - one panel, one command; the shell has no usage action.
- `rg "addUsage|ZERO_USAGE" packages/agents/src` - the arithmetic exists; nothing sums a session.
- `rg "head" packages/papo/src/screen/chat.tsx` - the head is the "new conversation" line only.
- `rg "ChatSessionHead" ahpc/src textui/packages/chat/src` - the component and its one consumer.

### Gaps

- `Not found: a sum of a session's runs in @facio/agents`.
- `Not found: Chat.usage` on either backend.
- `Not found: ChatSessionHead in papo`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| [CLI-06.1](../../../decisions/papo-usage-replaces-cost.md) | `/chat.usage` replaces `/chat.cost`; dollars stay deferred | User (2026-09-18) |
| [CLI-06.2](../../../decisions/papo-session-head-rows.md) | The header shows identity, settings, place and usage rows | User (2026-09-18), all four offered groups chosen |

## Proposed architecture

- **Data flow** - `@facio/agents` gains `sessionUsage({ store, sessionId })`: every run of the session in order, each with `usage`, `steps`, the count of `tool` step records and of `denials`, and the sums (`addUsage`). papo's `Chat.usage(sessionId)` returns it on the harness backend and the same shape summed from its turns on the Claude backend. The shell's `usage <session>` prints it; the screen's `/chat.usage` panel and the header's usage row read it.
- **Layer responsibilities** - `@facio/agents` `store/usage.ts` (the sum) · `@facio/papo` `chat.ts`, `claude/chat.ts` (`usage`), `commands.ts` (the action), `screen/app.tsx` (`chat.usage`, the `PLACE` store key), `screen/chat.tsx` (the head).
- **Source-of-truth files** - `code://packages/agents/src/types/usage.ts`, `code://packages/papo/src/types/chat.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `sessionUsage` in the harness; `Chat.usage`; `papo usage`; `/chat.usage` replaces `/chat.cost`](task-01-usage.md) | done | - |
| [02 - The conversation heads with what the session is](task-02-session-head.md) | done | 01 |

## Risks and tradeoffs

- Tool calls are counted from step records, so a session written by an older build that recorded none shows zero tool calls, not a wrong number.
- The header scrolls with the transcript (textui's design: a caption pinned outside it would cost a row for ever); after the first screen it is out of view, and `/chat.status` still has the same facts.

## Resume state

- **Done so far:** planned and built 2026-09-18; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the Claude backend's usage is what the CLI reported per turn; cache and reasoning tokens appear only when it reports them.

## Final verification checklist

- [x] `sessionUsage` sums a session's runs (`packages/agents/src/store/usage.test.ts`).
- [x] `Chat.usage` on both backends; `papo usage <session>` prints the table (`chat.test.ts`, `claude/chat.test.ts`, `commands.test.ts`).
- [x] `/chat.usage` on the screen, `/chat.cost` gone (`screen.test.ts`).
- [x] The header shows the rows of CLI-06.2 once a conversation exists (`screen.test.ts`).
- [x] `pnpm check` green.
- [x] `plans/index.md` updated.
