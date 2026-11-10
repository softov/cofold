---
title: A prompt runs a turn over ACP
status: implemented
depends: [task-01-chat-forks-and-reads-context.md, task-02-acp-opens-and-lists-sessions.md]
layer: "copapo"
refs:
  - "[code://packages/copapo/src/types/turn.ts#L8-L87](../../../../packages/copapo/src/types/turn.ts#L8-L87) - the snapshot that is projected"
  - "[code://packages/copapo/src/turns.ts#L117-L153](../../../../packages/copapo/src/turns.ts#L117-L153) - the order of a turn's parts"
  - "[code://packages/copapo/src/questions.ts](../../../../packages/copapo/src/questions.ts) - the question form and `toAskAnswers`"
---

## Objective

A `session/prompt` runs one turn and answers with its stop reason.
While it runs, the client gets the text, the reasoning, the tool calls and the context fill as `session/update`. The client answers the tool calls and questions that wait.

## Files

- `CREATE: packages/copapo/src/acp/project.ts` - `project(snapshot, sent)`: the new updates since `sent`, and the next `sent`.
- `CREATE: packages/copapo/src/acp/tools.ts` - the ACP kind and title of a tool call, for the cofold tools and Claude Code's.
- `CREATE: packages/copapo/src/acp/pending.ts` - a confirmation as `session/request_permission`, a question as `elicitation/create`, and their answers.
- `UPDATE: packages/copapo/src/acp/server.ts` - `session/prompt`, `session/cancel`, the subscription per session.
- `CREATE: packages/copapo/src/acp/project.test.ts` - a draft that becomes the stored text sends no text twice; tool calls go from `pending` to `completed`.
- `UPDATE: packages/copapo/src/acp/server.test.ts` - a turn with a scripted provider, a permission, a question, a cancel, a steer.

## Steps

1. Write `project` to send each text and reasoning place's new suffix as a chunk.
2. Send a tool call as `tool_call` when first seen, then `tool_call_update` when its status or output changes.
3. Map the tool name to an ACP kind in `tools.ts`, and use the call's input as its title.
4. On `session/prompt`, join the text blocks and `resource_link` URIs, and call `Chat.say`.
5. Subscribe to the session, and send the projected updates on each change.
6. Send a new confirmation as `session/request_permission`, with allow, always where offered, and reject.
7. Map the chosen option to `approve`, `approve({ always: true })` or `deny`, and `cancelled` to `deny`.
8. Send a new question as `elicitation/create` when the client declares `elicitation.form`, and decline it otherwise.
9. Map an accepted form to `Chat.answer`, and a decline or cancel to `Chat.deny`.
10. Answer the prompt when `Chat.wait` settles to anything but `awaiting`, after a last projection.
11. Map the outcome to a stop reason, or to a JSON-RPC error that carries the turn's message.
12. Answer a prompt that `say` steered when the turn it steered ends.
13. On `session/cancel`, call `Chat.cancel`, and answer the running prompts with `cancelled`.
14. Send `usage_update` from `Chat.context` after each model step, if `Chat.context` gives a value.

## Validation

- `project.test.ts`: a draft of "Hel" then the stored "Hello" sends "Hel" and "lo".
- `server.test.ts`: a turn with a destructive tool asks, the client allows, and the prompt ends `end_turn`.
- `server.test.ts`: a question answered through the form reaches the tool's result.
- `server.test.ts`: a second prompt during the turn steers it, and both answer `end_turn`.
- `server.test.ts`: `session/cancel` during a permission ends the prompt `cancelled`.
- `pnpm --filter @cofold/copapo test` is green.

## Resume
Implemented 2026-11-10. Departures found by the tests:
- The watch loop does not wait for the client's answer to a permission. A second `Chat.wait` follows the turn past it, so a cancel does not deadlock.
- When nothing is attached, the loop reads how the turn ended from the snapshot: a turn can end between two waits.
- A draft that is the start of the last stored text is not sent; a fork's reply was sent twice before.
- A tool call is first sent `in_progress` on the cofold backend, then `pending` when the turn pauses on it.
`project.test.ts` has 5 tests and `server.test.ts` 13, the claude backend's turn with a permission among them.
