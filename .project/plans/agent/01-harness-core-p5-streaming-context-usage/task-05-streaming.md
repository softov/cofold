---
title: Streaming
status: done
depends: [task-04-provider-effort-levels-budgets-dynamic.md]
layer: agents
refs:
  - code://packages/agents/src/types/model.ts#L55-L63 - `ModelAdapter { complete, estimateTokens? }`; `stream?` is added next to `complete`
  - code://packages/agents/src/types/event.ts#L17 - `model.delta { step, text }` exists unused; it gains `kind`
  - code://packages/agents/src/run/turn.ts#L204-L214 - the one `agent.model.complete(request)` call of the loop and its failure path (step `failed`, run `failed`)
  - code://packages/agents/src/run/compact.ts#L62-L68 - the summary step's `complete` call; it never streams (decision 104)
  - code://packages/agents/src/run/events.ts#L20-L30 - `emit` persists then publishes; every delta goes through it (decision 102)
  - code://packages/agents/src/testing/fake-model.ts - `createFakeModel`; gains `stream()` so the loop tests need no server
  - code://packages/model-openai-compat/src/index.ts#L28-L67 - `send()`: retry loop, error decoding; `sendStream()` reuses its decoding for the pre-body failures
  - code://packages/model-openai-compat/src/wire.ts#L59-L97 - `fromWireResponse` and the `<think>` block rule the streamed form must keep
  - https://platform.openai.com/docs/api-reference/chat/streaming - chunk shape: `choices[].delta.{content,tool_calls[{index,id,function:{name,arguments}}]}`, `finish_reason`, `usage` with `stream_options.include_usage`, terminal `data: [DONE]`
---

## Objective

A model step streams: the loop publishes `model.delta` for text and reasoning as they arrive, persisted like every event, and assembles the reply from the adapter's `done` event.
`@cofold/model-openai-compat` implements `stream()` over SSE with its own parser.
A stream that ends early fails the step; no partial tool call is ever validated or executed.

## Files

- `UPDATE: packages/agents/src/types/model.ts:55-63` - `ModelStreamEvent`, `ModelAdapter.stream?`.
- `UPDATE: packages/agents/src/types/event.ts:17` - `model.delta` gains `kind`.
- `UPDATE: packages/agents/src/types/testing.ts` - `FakeStep` gains `chunks?` and `interrupt?`; `createFakeModel` options gain `stream?: boolean`.
- `UPDATE: packages/agents/src/testing/fake-model.ts` - `stream()` implementation.
- `UPDATE: packages/agents/src/run/turn.ts:202-210` - the `complete` call becomes `callModel(ctx, request, stepRef)`.
- `CREATE: packages/agents/src/run/stream.test.ts` - loop tests with the fake model.
- `UPDATE: packages/agents/src/types/contracts.test-d.ts` - `ModelStreamEvent` has exactly `text.delta | reasoning.delta | toolCall.delta | done`.
- `CREATE: packages/model-openai-compat/src/sse.ts` - `parseSse`.
- `CREATE: packages/model-openai-compat/src/stream.ts` - `streamChunks`: chunks -> `ModelStreamEvent`s, tool-call assembly, `<think>` splitting.
- `UPDATE: packages/model-openai-compat/src/types/wire.ts` - `WireChunk`.
- `UPDATE: packages/model-openai-compat/src/index.ts:9,28-67,75-107` - `DEFAULT_FEATURES.streaming: true`, `sendStream()`, `stream()` on the adapter.
- `CREATE: packages/model-openai-compat/src/sse.test.ts`, `CREATE: packages/model-openai-compat/src/stream.test.ts`.
- `UPDATE: packages/model-openai-compat/README.md` - streaming row and behavior lines.
- `UPDATE: packages/agents/README.md` - `model.delta` in the run-handle list.
- `UPDATE: examples/agents/lmstudio-tools.ts` - print `model.delta` text as it arrives.

## Steps

1. Contracts (decision 105; the `model.delta` shape follows the harness spec). In `types/model.ts`:

   ```ts
   /**
    * What an adapter yields while a reply is being produced (decision 105). A `toolCall.delta` is a
    * fragment for a host reading the adapter directly; the loop never acts on one: `done.reply`
    * carries every tool call whole, and nothing is validated or executed before `done`.
    */
   export type ModelStreamEvent =
     | { type: 'text.delta'; text: string }
     | { type: 'reasoning.delta'; text: string }
     | { type: 'toolCall.delta'; index: number; callId?: string; name?: string; arguments: string }
     | { type: 'done'; reply: ModelReply };

   export interface ModelAdapter {
     id: string;
     modelId: string;
     features: ModelFeatures;
     complete(request: ModelRequest): Promise<ModelReply>;
     /** Present when features.streaming is true; the loop prefers it over complete() (decision 104). Must end with `done`. */
     stream?(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
     estimateTokens?(text: string): number;
   }
   ```

   In `types/event.ts`: `| { type: 'model.delta'; step: number; kind: 'text' | 'reasoning'; text: string }`.

2. The loop (decisions 102, 104; an early end fails the step per the harness spec). In `run/turn.ts`, replace lines 202-210 (`let reply: ModelReply; try { reply = await agent.model.complete(request); } catch ...`) with a call to a new function and keep the catch as it is:

   ```ts
   let reply: ModelReply;
   try { reply = await callModel(ctx, request); }
   catch (e) { /* unchanged: step failed, abort → abortOutcome, else fail(code) */ }
   ```

   ```ts
   /** Streams when the adapter can (decision 104); every delta is an event before the next one is read (decision 102). */
   async function callModel(ctx: TurnContext, request: ModelRequest): Promise<ModelReply> {
     const { agent, emit, counters } = ctx;
     if (!agent.model.stream || !agent.model.features.streaming) return agent.model.complete(request);
     for await (const event of agent.model.stream(request)) {
       if (event.type === 'done') return event.reply;
       if (event.type === 'toolCall.delta') continue; // assembled by the adapter; whole in done.reply (decision 105)
       await emit({ type: 'model.delta', step: counters.steps, kind: event.type === 'text.delta' ? 'text' : 'reasoning', text: event.text });
     }
     throw new ModelError({ code: 'invalid_response', message: 'the stream ended before the reply was complete' });
   }
   ```

   `writeSummary` in `run/compact.ts` keeps calling `agent.model.complete` (decision 104).
   The step record is unchanged: `request` at start, `reply` at completion; deltas live in the event log only.

3. Fake model. `FakeStep` text steps gain `chunks?: string[]` (the text delta boundaries; default: one chunk per word, spaces attached) and `interrupt?: true` (the stream ends after the chunks without `done`). `createFakeModel({ script, stream: true })` sets `features.streaming: true` and adds `stream()`, which records the request like `complete`, yields `reasoning.delta` for a step's `reasoning?: string` (one chunk) then `text.delta` per chunk, then `done` with the same reply `complete` would build. With `stream: false` (default) the adapter has no `stream` and existing tests are untouched.

4. `run/stream.test.ts`:
   1. A streamed text answer: events are `run.started, model.started, model.delta×3, model.completed, run.finished`; seqs contiguous; `store.runs.listEvents` holds the deltas; the joined delta text equals `textOf(outcome.message)`.
   2. A streamed tool call: no `model.delta` (the fake yields only `done` for a tool step), the tool runs, the second step streams its text.
   3. Reasoning then text: `kind` is `reasoning` first, then `text`.
   4. `interrupt: true`: the step is `failed`, the outcome is `failed { code: 'invalid_response' }`, no tool step exists, and a `run()` after it on the same session assembles a valid history (the failed step wrote no assistant message).
   5. `stream: false` on the fake: `complete` is used, no `model.delta`.
   6. `compact()` on a streaming fake: no `model.delta` (the summary step does not stream).
   7. A `resume()` on a finished streamed run replays the deltas in order (decision 102).

5. openai-compat SSE (own parser: zero deps, parent decision 6). `sse.ts`:

   ```ts
   /** SSE per the WHATWG spec: `data:` lines joined with '\n' per event, `event:` kept, comments skipped; the reader is released on return. */
   export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<{ event?: string; data: string }>
   ```

   `types/wire.ts`:

   ```ts
   export interface WireChunk {
     choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: { index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
     usage?: WireResponse['usage'];
   }
   ```

   `stream.ts`:

   ```ts
   /** Chunks → events. Text goes out as it arrives (after the leading `<think>` split); tool calls accumulate by `index` and appear only in `done` (decision 105). */
   export async function* streamChunks(chunks: AsyncIterable<WireChunk>): AsyncIterable<ModelStreamEvent>
   ```

   Rules: `delta.reasoning` / `delta.reasoning_content` → `reasoning.delta`; each `tool_calls` fragment → one `toolCall.delta { index, callId?, name?, arguments }` as received; `delta.content` → `text.delta`, except that while no reasoning field has been seen, a leading `<think>` (after optional whitespace) switches the splitter to reasoning until `</think>`, and the text after it resumes as `text.delta` (same result as `fromWireResponse`'s `THINK_BLOCK`); the splitter buffers at most the bytes needed to decide whether `<think>` is starting. `tool_calls` fragments append `function.arguments` per `index`; `id` and `function.name` are taken from the first fragment that carries them. `usage` arrives on the last chunk with `stream_options: { include_usage: true }` (OpenRouter and LM Studio); without it, `ZERO_USAGE`-shaped usage. `done.reply` is built by the same rules as `fromWireResponse` (parts order: reasoning, text, tool calls; `input` parsed from the accumulated arguments, `undefined` when not JSON; `finish` via `mapFinish`); `raw` is the list of chunks. `data: [DONE]` ends the stream; a stream that ends without a `finish_reason` still yields `done` (LM Studio sends `[DONE]` after a finished choice; a truly cut connection throws from the reader and no `done` is yielded).

   `index.ts`: `DEFAULT_FEATURES.streaming` becomes `true` (decision 104). `sendStream(url, body, signal)` shares the attempt loop with `send` up to the response check: connection errors and retryable statuses before the body are retried per decision 32; once the body is being read nothing is retried (harness spec: no partial call executed on retry). It returns `res.body` (or throws `invalid_response` when there is none). The adapter's `stream(request)` sends the same body as `complete` plus `stream: true, stream_options: { include_usage: true }` and yields `streamChunks(parse(parseSse(res.body)))`, where a non-JSON `data` line throws `invalid_response`. A reader error while streaming becomes `ModelError { code: 'network' }` (or `aborted` when the signal is aborted).

6. Tests: `sse.test.ts` (multi-line data, comments, CRLF line ends, an event split across reads, `[DONE]`); `stream.test.ts` (text in three chunks; a tool call whose arguments span four chunks with `id`/`name` only on the first; two parallel tool calls interleaved by index; `reasoning_content` deltas then text; inline `<think>` split at chunk boundaries including `<thi` + `nk>`; usage on the last chunk; no usage → zeros). `index.test.ts` gains: `stream()` sends `stream: true` and `stream_options`; a 429 before the body is retried, an error mid-body is not; abort mid-stream → `aborted`.

## Validation

- `pnpm check`.
- `examples/agents/lmstudio-tools.ts` prints the answer as it streams against LM Studio (manual; hosts print `model.delta` when `kind === 'text'`).
- `run/stream.test.ts` case 4 is the spec's "partial streamed call" test: an interrupted stream leaves no tool call to execute on retry.

## Resume

Built 2026-09-16.

- Contracts: `types/model.ts` has `ModelStreamEvent` (`text.delta | reasoning.delta | toolCall.delta | done`, decision 105) and `ModelAdapter.stream?`; `types/event.ts` `model.delta` carries `kind: 'text' | 'reasoning'`; `types/contracts.test-d.ts` proves the union has exactly the four kinds.
- Loop: `run/turn.ts` `callModel(ctx, request)` streams when `agent.model.stream` exists and `features.streaming` is true (decision 104), emits one persisted `model.delta` per text or reasoning fragment before reading the next (decision 102), skips `toolCall.delta`, returns `done.reply`; a stream that ends without `done` throws `ModelError('invalid_response')`, which the existing catch turns into a failed step and a failed run. `writeSummary` in `run/compact.ts` is untouched and keeps calling `complete()`.
- Fake model: `FakeStep` text steps gained `reasoning?`, `chunks?`, `interrupt?`; tool steps gained `reasoning?` (needed so the streamed and the whole reply match); `createFakeModel({ stream: true })` adds `stream()` and sets `features.streaming`. Default behaviour is unchanged (no `stream`, `streaming: false`).
- `run/stream.test.ts`: the seven planned cases plus `features: { streaming: false }` on a streaming fake (8 tests).
- openai-compat: `src/sse.ts` `parseSse` (own WHATWG parser: multi-line data, comments, CR / LF / CRLF, splits across reads, trailing event, cancels the body when the consumer stops early); `src/stream.ts` `parseChunks` (`[DONE]`, non-JSON is `invalid_response`) and `streamChunks` (text as it arrives, `<think>` splitter that buffers only the bytes needed to decide, reasoning fields, tool-call fragments accumulated by index and whole only in `done`, usage from the chunk that carries it); `src/index.ts` `attempt()` is the shared retry loop, `send()` and `sendStream()` sit on it, `bodyOf(request)` is the shared body, `stream()` on the adapter sends `stream: true, stream_options: { include_usage: true }`, `DEFAULT_FEATURES.streaming: true` (decision 104); `usageOf` and `mapFinish` exported from `wire.ts` so both forms share them; `types/wire.ts` `WireChunk`.
- Tests: `sse.test.ts` (8), `stream.test.ts` (13), `index.test.ts` gained a `stream()` block (7: default features, gates before fetch, non-JSON payload, 429 before the body retried, error mid-body not retried and no `done`, abort mid-stream, no body).
- READMEs: `@cofold/agents` (`model.delta` in the handle list, when a step streams, fake `stream: true`, `ModelAdapter.stream`), `@cofold/model-openai-compat` (intro, `features` default, a streaming behaviour line), `examples/agents/README.md`; `examples/agents/lmstudio-tools.ts` prints `model.delta` text as it arrives.

Evidence: `pnpm --filter @cofold/agents build` and `typecheck` green; `vitest --project @cofold/agents` 17 files, 166 tests; `vitest --project @cofold/model-openai-compat` 4 files, 66 tests; `@cofold/store-file` and `@cofold/tools` green against the new build; examples typecheck green. Not run against a live LM Studio (manual check left to the user).

Deviations and findings:
- `SseEvent` lives in `packages/model-openai-compat/src/types/sse.ts`, not in `sse.ts` (rule: exported types live in `src/types/`); `parseSse` is not exported from the package entry (the plan did not ask for it).
- `parseSse` cancels the body when the consumer stops before the stream ends (the plan said "the reader is released"); without it a connection stays open until the server closes it.
- Erroring a `ReadableStream` in `start()` drops what is still queued (Streams spec), so the "error mid-body" tests enqueue on the first `pull()` and error on the second.
- An unterminated inline `<think>` stays reasoning in the streamed form, where `fromWireResponse`'s regex would have left everything as text; deltas already published cannot be reclassified. Noted in `stream.ts`.
- `mapFinish` now accepts `null` (a chunk's `finish_reason` is `null` until the last one).
