---
title: CLI-06 - papo says what a session used, in tokens, and heads the conversation with what the session is - implemented
date: 2026-09-18
refs:
  - git://268ab80e36348a3201050956a51f29c8668594e8 - the last commit before this plan's work; everything below is uncommitted on top of it
  - code://packages/agents/src/types/usage.ts - `RunUsage`, `SessionUsage`
  - code://packages/agents/src/store/usage.ts - `sessionUsage({ store, sessionId })`
  - code://packages/papo/src/types/chat.ts - `Chat.usage`
  - code://packages/papo/src/chat.ts - the harness backend's `usage`
  - code://packages/papo/src/claude/chat.ts - the Claude backend's `usage`, summed from its turns
  - code://packages/papo/src/commands.ts - the `usage` action, `renderUsage`
  - code://packages/papo/src/screen/app.tsx - `chat.usage` (in place of `chat.cost`), `usageLines`, `PLACE` set at boot
  - code://packages/papo/src/screen/chat.tsx - the head: `ChatSessionHead` over `sessionView(snapshot.session)`, `tokensOf`
  - code://packages/papo/src/screen/state.ts - `PLACE`
---

## What a person sees

`papo usage <session>` and `/usage` on the screen print one row per turn and a total: input and output tokens, cache read, cache write and reasoning tokens when the provider reported them (a count nobody reported is not a column), model steps, tool calls that ran and calls refused.
No price appears anywhere; the `Cost` panel is gone.
A conversation opens with what the session is: its title and state, the harness and model, permissions, thinking and auto-compaction, turns and tokens so far, home, workspace, when it started and was last updated, and its id, scrolling with the transcript.

## What changed

- `@facio/agents`: `sessionUsage` reads the session's run records and step logs (tool calls are the `tool` step records; refusals are `RunRecord.denials`) and sums with `addUsage`; `SessionUsage` / `RunUsage` in `types/usage.ts`; exported from the index. `not_found` from the store for a session that is not there.
- `@facio/papo`: `Chat.usage(sessionId)` on both backends. The Claude backend sums what the CLI reported per turn; every tool part is a call and `denials` is 0 there, since the CLI's refusals arrive as failed tool results like any failed tool. The shell's `usage <session>` (group `sessions`, `mcp: true`). The screen's `/chat.usage` replaces `/chat.cost`, prints the same table as the shell plus what each turn asked. `PLACE` holds `{ workspace, home }` for the head.
- The head: `ChatSessionHead` with `sessionView(snapshot.session)`, the model, and rows Permissions, Thinking, Auto-compact, Turns, Tokens, Home (last, so it sits by the component's Workspace row); the "new conversation" line stays before the first message.

## Deviations from the plan

- The Claude backend cannot tell a refusal from a tool that ran and failed, so its `denials` is 0 rather than a guess (task 01 said "the turn's tool parts" for calls, which stands).
- `statusLines` kept its own token sum (it reads the snapshot synchronously); the plan's note that it would read `chat.usage` was dropped.

## Verification

- `packages/agents/src/store/usage.test.ts` (new): two runs, one with a tool call and a refusal.
- `chat.test.ts` "usage: what the session used..."; `claude/chat.test.ts` first case extended; `commands.test.ts` "says, lists, shows and deletes" extended with `usage` (json, table, unknown session); `screen.test.ts` "heads the conversation..." (new) and "/status, /usage, /config and /help" (amended).
- `pnpm check` 2026-09-18: 68 test files, 783 tests, no type errors.
- Not run: the screen by hand (the head after the first message, `/usage` on a session with cache tokens from OpenRouter).
