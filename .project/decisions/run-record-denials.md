---
title: 118 - Every denied tool call is recorded on the run
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L5130-L5138 - `SDKPermissionDenial` and `result.permission_denials`, "the authoritative record"
  - code://packages/agents/src/types/store.ts#L30-L44 - `RunRecord`, where `denials` goes next to `usage`
  - code://packages/agents/src/run/tools.ts#L16-L19 - the `deny` helper that emits `tool.denied`
  - code://packages/agents/src/run/turn.ts#L259-L263 - the `max_tool_calls` denial
---

## Context

Claude keeps `permission_denials[]` on the turn result and calls it the authoritative record; a frame per denial is best effort.
The harness has the `tool.denied` event and the error tool result, both in logs a host has to scan.

## Decision

`RunRecord.denials: Denial[]` with `Denial = { callId, name, input, reason, by: 'policy' | 'hook' | 'user' | 'invalid' | 'limit' }`, written by the loop at each denial (`runs.update({ denials })`, the whole list) and carried as `denials?` on every `RunOutcome` variant next to `usage`.
`by`: `policy` (a `deny` decision or rule), `hook` (`beforeTool` deny or stop), `user` (an approval answered `deny`, or a declined input), `invalid` (unknown tool, arguments not JSON or failing the schema), `limit` (`max_tool_calls`).
`(defaulted: the `user` kind)`: Claude's list covers automatic denials; the person's are added so the record is complete. Reversible.
The `tool.denied` event stays.

Source: user, 2026-09-16, asked "RunRecord.denials[] + event (Claude) / Event only".

## Consequences

A host reads why a turn did less than asked from the run record, not from the event log; `resume()` carries the list on.
`store.runs.update` gains `denials?`; the memory and file stores persist it; the conformance suite proves it.
