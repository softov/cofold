---
title: Chat forks a session and reads its context
status: implemented
depends: []
layer: "copapo"
refs:
  - "[code://packages/agents/src/types/store.ts#L195-L201](../../../../packages/agents/src/types/store.ts#L195-L201) - `sessions.fork`, which the cofold backend calls"
  - "[code://packages/copapo/src/types/claude.ts#L55-L61](../../../../packages/copapo/src/types/claude.ts#L55-L61) - `ClaudeSdkSubset`"
  - "[code://packages/copapo/src/commands/runtime.ts#L147-L160](../../../../packages/copapo/src/commands/runtime.ts#L147-L160) - how `/context` counts the context fill"
  - "[code://packages/copapo/src/chat-contract.test.ts](../../../../packages/copapo/src/chat-contract.test.ts) - the scenarios both backends agree on"
---

## Objective

`Chat.fork(sessionId)` makes a new session with the whole conversation and the settings of the old one, on both backends.
`Chat.context(sessionId)` gives the context fill as `{ used, size }` on the cofold backend, and `undefined` on the claude backend.

## Files

- `UPDATE: packages/copapo/src/types/chat.ts` - `fork(sessionId): Promise<SessionRow>` and `context(sessionId): Promise<{ used: number; size: number } | undefined>` on `Chat`.
- `UPDATE: packages/copapo/src/chat.ts` - `fork` over `store.sessions.fork` through the newest message, with the settings copied; `context` as `/context` counts it.
- `UPDATE: packages/copapo/src/commands/runtime.ts` - `/context` reads the shared count.
- `UPDATE: packages/copapo/src/types/claude.ts` - `forkSession` on `ClaudeSdkSubset`.
- `UPDATE: packages/copapo/src/claude/chat.ts` - `fork` over `forkSession`, with the settings copied; `context` answers `undefined`.
- `UPDATE: packages/copapo/src/claude/testing.ts` - the fake SDK's `forkSession`.
- `UPDATE: packages/copapo/src/chat-contract.test.ts` - a fork keeps the transcript and the settings, and the old session is unchanged.

## Steps

1. Add `fork` and `context` to the `Chat` interface.
2. Move the count of `/context` into one function that `runtime.ts` and `chat.ts` both call.
3. Implement `fork` on the cofold backend with `store.sessions.fork` and a new session id.
4. Copy the session's settings key to the new id.
5. Refuse a fork while the session runs or waits, with `AgentError('writer_busy')`.
6. Add `forkSession` to `ClaudeSdkSubset` and the fake SDK.
7. Implement `fork` on the claude backend with `forkSession`, and copy the settings key.
8. Add the fork scenario to `chat-contract.test.ts`.

## Validation

- `chat-contract.test.ts`: on both backends, a fork lists as a new session with the same turns and settings.
- `chat.test.ts`: `context` after one turn is above zero and below `context.maxTokens`.
- `pnpm --filter @cofold/copapo test` is green.

## Resume
Implemented 2026-11-10. `fork` and `context` are on both backends, and the shared count is `contextFill` in `commands/runtime.ts`.
Departure: `Chat.create()` is added too, on both backends. ACP's `session/new` answers with an id before any turn, and `say` refused an id the store did not hold.
On the claude backend, `create` reserves an id, and the first `say` tells the CLI to make that session, not resume it.
`chat-contract.test.ts` has a create scenario and two fork scenarios on both backends; `chat.test.ts` checks `context`.
