<!--
Domain: agent
Status: Not started
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-13
Dependencies: ./01-harness-core-p3-durable-hitl.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p4 - ahpd adapter (stub)

_Status: Not started · Priority: High · Created: 2026-09-13_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 4: "Implement the `ahpd` adapter. Verify with `ahpc` that a turn, tool approval, cancellation, reconnect, and history all display correctly."

This is a stub.
Run `/dooplan` against it when p3 is marked `Shipped`; that round must re-read `ahpd/packages/sdk/src/types/{agent,session}.ts` and `ahpd/packages/agent-claude/src/*` at that date, since ahpd is moving.

## Objective

`@facio/transport-ahp` implements `@ahpd/sdk`'s `Agent` and `Session` on top of `createAgent()` + `run()` + `resume()`, so `ahpc` and VS Code see an ordinary AHP agent.

## Requires

- p3 shipped: durable store, paused approvals, `resume()`.
- `@ahpd/sdk` importable (local workspace link to a checkout of softov/ahpd, or a published version; deferred question).

## Scope (mapped from the ahpd contracts read on 2026-09-13)

| ahpd contract | Harness mapping |
| --- | --- |
| `Agent.provider`, `displayName`, `description`, `schema()`, `defaults()` | From `agent.definition` plus adapter options (settings schema exposes model id, temperature, limits) |
| `Agent.create(start: Start)` → `Session` | One harness session per AHP session; `Start.resume` maps to the harness `sessionId`; `Start.tools` (`BoundTool[]`) become harness tools whose `execute` calls `BoundTool.run` when present and otherwise defers to the client via `Session.completeToolCall` (ownership honored, spec "must honor the existing BoundTool ownership semantics") |
| `Session.begin(turnId, text, model?)` | `run({ agent, session, input })`; the adapter keeps `turnId ↔ runId` |
| `Session.cancel(turnId)` | `handle.cancel()` |
| `Session.confirm(toolCallId, approved)` | `handle.submit({ type: approved ? 'approve' : 'deny', requestId })` with `toolCallId ↔ requestId` kept by the adapter |
| `Session.steer?` | Not advertised in p4 (no steering in the harness yet) |
| `Session.forkPoint?` / `endPoint?` | Advertised only if p3 added `inputMessageId` / `lastMessageId` and the adapter can honor `Start.forkAt` / `rewindAt`; otherwise omitted so the host advertises no fork/rewind |
| `Emit('session' \| 'chat', action)` | Driven by `RunEvent`s: `model.completed` → assistant message actions, `tool.*` → tool call actions, `approval.requested` → confirmation request, `run.finished` → turn end |
| `Session.models()` | From the adapter's configured model list |
| `Agent.list?` / `transcript?` | From `store.sessions` and `listMessages`; advertised only when the store is durable |
| `Start.credentials` | Placed into `agent.resources`, never into messages |

- The adapter reconciles two identities and keeps both: the AHP session/channel URI and the harness `sessionId`.
- `examples/ahpd-host.ts`: starts `ahpd` with this backend against LM Studio.

## Acceptance (driven from `ahpc`)

- A turn with a tool call renders the call and its result.
- A `destructive` tool pauses; `ahpc` shows the confirmation; approving continues; denying yields a denied tool result.
- Cancel mid-turn ends the turn as cancelled.
- Disconnect `ahpc` during a turn, reconnect: the transcript shows the full turn (replay from `store.runs.listEvents`).
- History listing shows previous sessions with titles and timestamps.

## Resume state

- **Done so far:** stub only.
- **Next action:** after p3 ships, run `/dooplan` with this file as notes, re-reading ahpd at that date.
- **Open questions (to be asked in that round):** how `@ahpd/sdk` is consumed (workspace link vs npm); which settings the AHP settings schema exposes; whether client-owned `BoundTool`s without `run` are modeled as tools with a `deferred` effect or as a separate executor binding.
