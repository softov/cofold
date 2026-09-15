<!--
Domain: agent
Status: Not started
Priority: Medium
Created: 2026-09-13
Revalidated: 2026-09-13
Dependencies: ./01-harness-core-p3-durable-hitl.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p5 - Streaming, context reduction, usage accounting (stub)

_Status: Not started · Priority: Medium · Created: 2026-09-13_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 5: "Add streaming, context reduction, usage accounting, and more model adapters as separate increments. Test partial streamed calls and recovery after an uncertain tool invocation."

This is a stub.
Run `/dooplan` against it when p3 is marked `Shipped`; it can proceed in parallel with p4.
Each bullet below is a separate increment and may become its own child plan in that round.

## Objective

Make long answers stream, keep long sessions inside the model budget without losing the canonical transcript, account usage and cost per run, and add a second adapter whose semantics differ from Chat Completions.

## Requires

- p3 shipped: durable store, step log with `uncertain` status.

## Scope

- **Streaming.** `ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `text.delta`, `toolCall.delta`, `done { reply }`. The loop publishes `model.delta` events for safe text immediately and assembles every tool call completely before validation or execution. A stream that ends before `done` produces no executable tool call and the step is recorded `failed`, never `uncertain` (spec "A stream interruption must not leave a partial call that gets executed on retry").
- **Context reduction.** `context.strategy` in `AgentOptions` (deferred question on the exact shape): default `recent` (p2 behavior); add `summarize` that produces a `Message` with `source: 'summary'` stored in the session next to, never instead of, the originals, carrying provenance (`summarizes: messageId[]`, model id, created at). Summaries are regenerable; the context assembler picks the summary when the originals exceed the budget.
- **Usage accounting.** `Usage` accumulated per run in `RunRecord.usage`; `limits.maxCost` with `ModelAdapter.pricing?` (per-million input/output) → `stopped { reason: 'max_cost' }` (extends `StopReason`).
- **Second adapter.** `@facio/model-anthropic` (Messages API: system as a top-level field, tool results as user content blocks, `stop_reason` mapping) to prove the contract is not shaped by Chat Completions.
- **Recovery test.** Kill a run between `tool.started` and `tool.completed`, restart, `resume()` reports `uncertain_invocation`, the operator resolves it, the transcript stays consistent.

## Acceptance

- Streaming text is visible before the reply completes; a stream cut mid tool call never executes that tool.
- A session longer than `context.maxTokens` continues with a summary in the request and all original messages still in the store.
- `maxCost` stops a run and reports usage that matches the adapter's reported tokens.
- The same example runs unchanged against `openaiCompat` and the Anthropic adapter.

## Resume state

- **Done so far:** stub only.
- **Next action:** after p3 ships, run `/dooplan` with this file as notes; expect a split into 4 children.
- **Open questions (to be asked in that round):** shape of `context.strategy`; whether `pricing` lives on the adapter or in agent options; SSE parsing without dependencies (own parser) vs allowing one.
