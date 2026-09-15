<!--
Domain: agent
Status: Not started
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-13
Dependencies: ./01-harness-core-p1-contracts.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p2 - Serial loop and run handle (stub)

_Status: Not started · Priority: High · Created: 2026-09-13_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 2: "Implement the bounded serial loop with argument validation, cancellation, and ordered events. Prove a model can request a tool, receive its result, and produce a final answer."

This is a stub.
Run `/dooplan` against it when p1 is marked `Shipped` in `index.md`; the Decisions table below is the input to that planning round, not a substitute for it.

## Objective

Implement `createAgent()` and the standalone `run()` in `@facio/agents` so that one agent definition, the fake model, and one tool produce a `completed` outcome with an ordered, persisted event stream.

## Requires

- p1 shipped: contracts, `validateSchema`, `createTool`, `createMemoryStore`, `createFakeModel`.

## Scope (from the spec and the parent decisions)

- `createAgent({...})` in `packages/agents/src/agent/create-agent.ts`: validates options, fills `DEFAULT_LIMITS` and context defaults, indexes tools by name (duplicate name → `invalid_options`), defaults `store` to `createMemoryStore()` with a one-time warning (decision 25), validates `capabilities` ids are unique (duplicate → `invalid_options`), returns a frozen `Agent`.
- Capability resolution at run start (parent decision 31), after the writer claim and before step 1: for each `agent.capabilities` in order, `await cap.tools?.(args)` and `await cap.instructions?.(args)` with `CapabilityArgs { agentId, sessionId, runId, workspace, kv, signal }`; contributed tools are re-stamped `{ ...tool, source: cap.id }`; the run's tool map is agent tools + capability tools, duplicate name → the run fails `invalid_options` before any model step; `request.instructions` for every step of this run = `definition.instructions` followed by a blank line and `## <cap.id>` + the text, per capability that returned text. A capability that throws fails the run with `failed { code: 'capability_error' }` (new `AgentErrorCode` value; add it to `errors.ts` in this phase). Tools are resolved once per run, not per step.
- `run({ agent, session, workspace, input, signal })` in `packages/agents/src/run/run.ts` (decision 27): creates the session with `workspace` when it does not exist (parent decision 29; `workspace` is ignored for an existing session), or loads it, claims the writer (decision 34 in p1: refuses to start when another run holds the claim), appends the input message, then loops:
  1. assemble `ModelRequest` = instructions + recent history within `context.maxTokens` (whole messages, newest first, tool calls kept paired with their results);
  2. `hooks.beforeModel` → `model.complete` → `hooks.afterModel`; step record `kind: 'model'` with `invocationId`; `model.started` / `model.completed` events;
  3. no tool calls → `completed`;
  4. per tool call, serially: unknown tool → `tool.denied` result; `validateSchema` on `input` (undefined `input` from a raw parse failure → validation failure result); `hooks.beforeTool` → `allow | modify (re-validate) | deny | approval`; `approval` in p2 ends the run as `awaiting` with a `PendingRequest` but cannot be resumed until p3; execute with a `ToolContext` (`kv` scopes from the store, `resources` from the agent, `signal`); bound output to `limits.maxToolOutputChars`; `hooks.afterTool`; step record `kind: 'tool'` with `original` and `transformed`; `tool.*` events; append the `toolResult` message;
  5. limits: `maxSteps`, `maxToolCalls`, `timeoutMs` → `stopped` with the reason; `signal` abort → `cancelled`; adapter or hook throw → `failed`.
- Default `beforeTool` when no hook is set: `allow`, except `effects.destructive === true` → `approval` (deferred question for the p2 planning round: confirm or change).
- `RunHandle`: `events` is an `AsyncIterable` fed by an in-memory queue after each `store.runs.appendEvent`; `submit` accepts only `cancel` in p2 (others → `not_found`/invalid until p3); `outcome` resolves after `run.finished`.
- Every state transition is persisted (`store.runs.update`) before the corresponding event is appended and published.
- Examples: `examples/standalone.ts` (fake model, one tool, prints events) and `examples/lmstudio-tools.ts` (real adapter).

## Acceptance (to be expanded into validation steps)

- Test with `createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'hi' } }] }, { text: 'done' }] })`: events are `run.started, model.started, model.completed, tool.proposed, tool.started, tool.completed, model.started, model.completed, run.finished` with seq 1..9; the session transcript holds user, assistant(toolCall), tool(toolResult), assistant messages; outcome `completed` with `steps: 2`.
- Invalid arguments: `rawToolCall` step → `tool.completed` with `isError: true` and the model receives the validation issues as the tool result; the run continues.
- `maxSteps: 1` with a tool-calling script → `stopped { reason: 'max_steps' }`.
- Abort mid-tool → `cancelled`; the tool step record ends as `uncertain` if the executor did not return.
- `beforeTool` returning `deny` → `tool.denied` and a tool result carrying the reason; the executor never ran.
- A second `run()` on the same session while the first is active → `failed { code: 'writer_mismatch' }` without touching the transcript.

## Resume state

- **Done so far:** stub only.
- **Next action:** after p1 ships, run `/dooplan` with this file as notes.
- **Open questions (to be asked in that round):** default decision for `destructive` tools without a hook; whether `run()` queues or refuses when the session writer is held; where the one-time in-memory-store warning is written (stderr vs a `warn` option).
