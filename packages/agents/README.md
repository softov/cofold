# @facio/agents

Agent runtime: contracts, JSON Schema validation, `createTool`, `createAgent`, `run`, `resume`, `createAskUserTool`, `skills`, an in-memory `Store`, and a scripted fake model.
Zero runtime dependencies.
A model conducts a conversation, proposes tools, the runtime authorizes and executes them, one turn is a run.

## Install

```bash
pnpm add @facio/agents
```

Node >= 22, ESM only.

## Define a tool

```ts
import { createTool } from '@facio/agents';

const echo = createTool<{ text: string }>({
  name: 'echo',
  description: 'Return the text unchanged',
  input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  effects: { reads: true },
  execute: (input) => input.text,
});
```

`createTool` validates the definition once: the name must match `/^[a-zA-Z0-9_-]{1,64}$/`, the description must not be empty, `input` must be a `type: 'object'` schema, and every keyword must belong to the supported subset (see below).
`execute(input, ctx)` is the one positional signature in the API: input first, context second, so a tool that needs no context is `(input) => ...`.
It returns a `string` or `{ content, detail? }`: `content` is what the model sees, `detail` stays in the step log.

## Validate model-supplied arguments

```ts
import { validateSchema } from '@facio/agents';

const result = validateSchema<{ text: string }>({ schema: echo.input, value: { text: 'hi' } });
if (result.ok) result.value.text; // typed, defaults applied
else result.issues;               // [{ path: '$.text', message: 'required' }]
```

Supported keywords: `type` (single or array), `properties`, `required`, `additionalProperties` (boolean), `items` (single schema), `enum`, `const`, `default`, `description`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `anyOf`, `oneOf`, `nullable`.
`title`, `examples` and `$schema` are accepted and ignored.
Anything else (`$ref`, `patternProperties`, ...) throws `SchemaError('unsupported_keyword')` at `createTool` time, never at validation time; a bad value (`pattern: '('`, `type: 'str'`, a non-array `required`) throws `SchemaError('invalid_schema')` there too.
Types are never coerced: `"3"` is not an integer.

## Run one turn

```ts
import { createAgent, run, textOf } from '@facio/agents';

const agent = createAgent({ id: 'support', instructions: 'Answer briefly.', model, tools: [echo], store });
const handle = run({ agent, session: 'sess-1', input: 'Say hello' });
for await (const event of handle.events) console.log(event.seq, event.type);
const outcome = await handle.outcome;
if (outcome.status === 'completed') console.log(textOf(outcome.message));
```

`createAgent` validates the options once and returns a frozen value with no methods: `definition`, `model`, `tools`, `capabilities`, `store`, `hooks`, `policy`, `limits`, `context`, `params`, `resources`.
Without a `store` it uses an in-memory store and warns once; pass a real store for anything but tests.

`run({ agent, session, input, messageId?, workspace?, signal? })` returns a `RunHandle` synchronously and executes the turn in the background. `messageId` is the input message's id (default `newId()`), so a client can match `run.started` to its own send; it must be new in the session, or the handle finishes `failed { code: 'already_exists' }` with nothing written. `compact()` takes one for its ask too.

- `events`: every `RunEvent` from `seq` 1, replayed to any iterator, ending after `run.finished`. While a model step streams, `model.delta { step, kind: 'text' | 'reasoning', text }` carries each fragment as it arrives; deltas are persisted and replayed like every other event, tool-call fragments are never published, and `model.completed` still carries the whole message.
- `outcome`: resolves to exactly one of `completed | awaiting | stopped | cancelled | failed`; it never rejects. Every outcome carries `usage`, `steps` and, when the adapter has `pricing`, `cost` in USD (absent means unknown, never zero); the run record carries the same.
- `cancel({ reason })` / `submit({ type: 'cancel' })`: aborts the run; a tool in flight is left `uncertain` in the step log. The transcript stays model-valid and says what happened: every call the cancel cut is answered `[Request interrupted by user for tool use]` (an error result) and a `role: 'user'`, `source: 'system'` message `[Request interrupted by user]` is appended (`INTERRUPTED_TOOL`, `INTERRUPTED`; Claude's runtime's wording, so one projection reads both). A timeout writes the same texts and finishes `stopped { reason: 'timeout' }`.
- `submit({ type: 'steer', text })`: a message for the running turn, without cancelling it. It is appended to the transcript as a `user` message before the next model step (after every result of the tool batch in progress), announced as `run.steered`, and the promise resolves then. A steer that is still queued when the run settles rejects with `not_running`, as does one sent to a finished handle; the host decides whether to send it as a new run.
- `status()`: `running` until the outcome settles.

Per step the loop assembles a bounded request from the session transcript (newest messages first, tool-call groups kept whole), calls `hooks.beforeModel`, the model, `hooks.afterModel`, then handles each proposed tool call in order: validate the arguments, `hooks.beforeTool`, `policy.decide` (`allow | ask | deny`; default: `ask` when `effects.destructive`, else `allow`), execute, bound the output, `hooks.afterTool`.
The hook runs first and may modify the input the policy then judges; a policy `deny` wins over a hook `allow` and over a remembered approval, a policy `ask` wins over a hook `allow`, and a policy `allow` leaves a hook's `approval` standing (decision 119).
Every message, step and event is persisted through the `Store` before it is published.
A call that needs approval pauses the run as `awaiting` with a durable `requestId` (see "Pause and resume").
Every refused call is recorded: `RunRecord.denials` and `outcome.denials` list `Denial { callId, name, input, reason, by }` in order, `by` being `invalid` (unknown tool, arguments not JSON or failing the schema), `hook` (a `beforeTool` deny or stop), `policy` (a `deny` decision), `user` (a denied approval or a declined question) or `limit` (`maxToolCalls`); the record is written with the counters at every run update and is the authoritative list, as Claude's `permission_denials` is.
A hook can end the run on purpose: `beforeTool` returning `{ decision: 'stop', reason }` answers the call `Not executed: <reason>` without running it, `afterTool` returning `{ output, stop: { reason } }` records the result as usual; either way the rest of the batch is answered `Not executed: the run was stopped` and the outcome is `stopped { reason: 'hook' }` (a `beforeModel` / `afterModel` abort is `stopped { reason: 'policy' }`).
Limits: `maxSteps`, `maxToolCalls`, `timeoutMs`, `maxCost` (USD per run, `0` = no limit; checked before each model step, so the step that crosses it completes and the run ends `stopped { reason: 'max_cost' }`; it never trips without adapter pricing), `maxToolOutputChars`.
Every model request carries `cacheKey`, the session id, for adapters that key a provider-side prompt cache.
A model step streams when the adapter has `stream()` and its `features.streaming` is true (there is no agent option; turn it off per model with `features: { streaming: false }`); the reply is assembled from the adapter's final `done` event, so nothing is validated or executed before the stream is complete, and a stream that ends without `done` fails the step (`invalid_response`) with no assistant message written. The compaction summary step never streams.

Capabilities (`{ id, tools?(args), instructions?(args) }`) are resolved at the start of every run and contribute tools plus a `## <id>` section to the instructions.

## Pause and resume

A run pauses when a tool needs approval (`policy.decide` answering `ask`, or a `beforeTool` hook returning `approval`) or when a tool asks the user something.
The outcome is `awaiting { sessionId, runId, requestId, kind: 'approval' | 'input' }`, the run record says `awaiting` with `pendingRequestId`, and the session's writer claim is kept.
The process may exit here; everything needed to continue is in the store.

```ts
import { resume } from '@facio/agents';

const handle = resume({ agent, sessionId, runId });   // replays the stored events, then waits for a command
await handle.submit({ type: 'approve', requestId });   // or { type: 'approve', requestId, input, alwaysApprove }
await handle.submit({ type: 'deny', requestId, reason: 'not today' });
await handle.submit({ type: 'answer', requestId, answers: { lang: 'Rust', targets: ['node'] } });
const outcome = await handle.outcome;
```

`submit` resolves once the command is persisted (`approval.resolved` / `input.resolved` / `input.declined`, then `run.resumed`) and rejects with `not_found` for a wrong `requestId` or `invalid_options` for an edited input or answers that do not validate; the run stays `awaiting` in that case.
A `deny` on an input request declines the questions: the asking tool's result carries the reason as an error and the model goes on without the answers.
The approved call is executed exactly once, then the rest of its batch and the model loop continue as in `run`.
`deny` appends an error result so the model can react, and the run records the refusal with `by: 'user'`.
`cancel` while waiting denies the pending request (`deny { reason: 'The turn was stopped' }` through the same path a host's deny takes: `approval.resolved` or `input.declined`, the error result for the call, `run.resumed`), then finishes the run `cancelled` with the interrupt marker; a request is never left open by a cancel.
A `steer` while waiting is refused with `invalid_options` (answer the request first); once the command is applied the resumed handle takes steers like `run`'s.

`resume` on a run that was `running` when its process died (decision 78) marks the open step `failed` (model) or `uncertain` (tool, plus an error result so the transcript stays valid) and finishes `failed { code: 'interrupted' | 'uncertain_invocation' }`.
`resume` on a terminal run replays its events and delivers the stored outcome; `afterSeq` skips events the host already has.
A durable store hands a `running` run's writer claim to a new process only when its heartbeat is stale (60 s by default); the loop refreshes it every `HEARTBEAT_MS` (10 s).

## Rules

`rules()` builds a `Policy` from lists of `Rule { tool, match? }`, the harness's counterpart to Claude's permission rules (decision 117).

```ts
import { rules } from '@facio/agents';

const policy = rules({
  deny: [{ tool: 'shell_exec', match: 'rm *' }],
  ask: [{ tool: 'write_file' }, { tool: 'shell_exec', match: 'git push*' }],
  allow: [{ tool: '*', match: 'src/*' }],
});
const agent = createAgent({ id, instructions, model, store, tools, policy });
```

`tool` is a tool name or `*`; `match` is a glob (`*` any run of characters, `?` one, anchored to the whole subject) checked against what the tool declares as its `subject(input)`: the command for `shell_exec`, the path for the file tools.
A tool without a `subject` matches by name only, so a rule with `match` never applies to it.
The first matching rule decides, `deny` before `ask` before `allow`; when nothing matches, `otherwise` decides (default: `ask` when `effects.destructive`, else `allow`).
A tool declares its subject next to `effects`: `subject: (input) => input.command`.

## Ask the user

`createAskUserTool()` is the structured question primitive: several questions per call, each free text or single / multiple choice.
It is not added to any agent by default.

```ts
import { createAskUserTool } from '@facio/agents';

const agent = createAgent({ ..., tools: [createAskUserTool()] });
// the model calls ask_user({ questions: [{ id: 'lang', question: '...', options: [{ label: 'TypeScript' }, { label: 'Rust' }], allowOther: false }] })
// the run pauses with kind 'input'; the pending request's payload.questions is what to show the user
// the host answers with submit({ type: 'answer', requestId, answers: { lang: 'Rust' } })
```

Answers are validated against the questions (unknown id, missing answer, an option not in `options` when `allowOther` is false, an array for a single-select) and rendered as `Q/A` text for the model; the raw answers stay on the tool step's `original.detail`.
A tool of your own can pause the same way with `pauseForInput({ questions })`.

## Skills

`skills({ sources })` is the first core capability: it lists the available skills under `## skills` in the instructions and adds one `read_skill({ name, path? })` tool.
A `SkillSource` is `{ list({ workspace }), read({ ref, path? }) }`; `@facio/store-file` ships `fileSkillSource({ root })` for `<root>/skills/<name>/SKILL.md` and `<workspace>/.agents/skills/<name>/SKILL.md`.
Duplicate names across sources: the first source wins, with one warning.

```ts
import { skills } from '@facio/agents';
import { fileSkillSource } from '@facio/store-file';

const agent = createAgent({ ..., capabilities: [skills({ sources: [fileSkillSource({ root })] })] });
```

## Compaction

A request carries the instructions and the history up to `context.maxTokens` (32 000 by default), newest turns first; what does not fit is left out.
Before that silently loses the beginning, the history can be folded into one summary message: `compact({ agent, session })` is a run of one model step whose input is the ask (`source: 'system'`) and whose outcome's message is the summary (`role: 'user'`, `source: 'summary'`, `summarizes: [ids]`), appended to the session like any message.
From then on a request carries the newest summary first, then every message no summary stands for; the originals stay on disk for the record and the screen.
A compaction keeps a verbatim tail: the newest units (a tool call with its results counts as one, never split) whose estimate fits in `context.compactKeepTokens` (default 20% of `maxTokens`; `0` keeps nothing) are left out of the summary and of `summarizes`, so the model sees summary, tail, input in that order. `contextOf(history)` is exported as the one answer to "what does the model see of this session". The `context.compacted` event says `summarized`, `kept`, `estimatedTokens` (before) and `afterTokens` (after).
`context.autoCompactTokens` does the same in passing: a turn whose history is estimated above it writes the summary first (an extra model step, `context.compacted` event) and then answers, keeping its own input out of the summary since that is what it is about to answer.

```ts
const agent = createAgent({ ..., context: { maxTokens: 64_000, autoCompactTokens: 48_000 } });
const handle = compact({ agent, session: 'abc' });   // events: run.started, model.started, model.completed, context.compacted, run.finished
```

The summary step sends no tools and skips the `beforeModel` / `afterModel` hooks; a model error fails the run as `summary: <message>`, and an empty reply is `invalid_response`.

## Deferred tools

An agent with fifty tools sends the model a handful of definitions and one index line for the rest.
`createTool({ ..., deferred: true })` marks one; a capability marks its own wholesale with `defer: true` or `defer: { over: N }` (every tool past the first N it returns).
While any tool is deferred the run adds one core tool, `load_tools`, and the instructions end with a `## tools` section: the rule, then `- name: first sentence of the description` for every deferred tool the session has not loaded.

`load_tools({ names })` returns the full definitions and loads them; `load_tools({ query })` matches the words against names and descriptions (ten at most); `load_tools({})` returns the index.
A loaded tool is in every later request of the session: the names live in `kv.agent` at `loaded-tools/<sessionId>`, beside `approvals/`, so the next turn and a resumed run start with them; a new session starts clean.
A valid call to a deferred tool that was never loaded runs anyway (the model may remember the schema) and loads it; what is refused is what was refused before: unknown names and invalid arguments.
`AgentDefinition.deferred` names the agent's own deferred tools.

```ts
const agent = createAgent({ ..., capabilities: [mcpServer({ ..., defer: { over: 0 } })] });
// request 1: tools = [load_tools], instructions end with "## tools\n...\n- list_issues: List the issues of a repository.\n- ..."
// the model calls load_tools({ names: ['list_issues'] }) → request 2 carries list_issues; the line is gone from the index
```

## Testing helpers

```ts
import { createFakeModel, createMemoryStore } from '@facio/agents/testing';

const model = createFakeModel({
  script: [
    { toolCalls: [{ name: 'echo', input: { text: 'hi' } }] },
    { text: 'done' },
  ],
});
const store = createMemoryStore();
```

The fake model replays its script in order and records every request it received (`model.requests`).
With `createFakeModel({ script, stream: true })` it also has `stream()`: a text step yields its `reasoning` (one delta) and its text per `chunks` entry (default: one per word), then `done`; `interrupt: true` ends the stream without `done`.
The memory store is the reference `Store`: it enforces the writer claim (`writer_mismatch`), contiguous event sequence numbers (`seq_gap`), refuses to overwrite an existing session or run (`already_exists`), and addresses runs only through their session (`RunRef { sessionId, runId }`).
Every `Store` implementation runs the same conformance suite from a vitest file:

```ts
import { describeStoreConformance } from '@facio/agents/testing/store-conformance';

describeStoreConformance({ name: 'mine', create: () => createMyStore(), dispose: (store) => ... });
```

It lives on its own sub-path because it imports `vitest`.

## Models and providers

`ModelAdapter` is what an agent talks to: `{ id, modelId, features, complete(request), stream?(request) }`; `stream()` yields `ModelStreamEvent`s (`text.delta`, `reasoning.delta`, `toolCall.delta`, then `done { reply }`) and the loop prefers it when `features.streaming` is true.
`ModelProvider` is what a host lists models from: `{ id, listModels(), model({ id, features?, params?, pricing? }) }`; it lives in `types/provider.ts` and the core never calls it.
Pricing lives on the adapter (`ModelAdapter.pricing`, a `ModelPricing { inputPerMillion, outputPerMillion, cacheReadPerMillion?, cacheWritePerMillion?, currency }` in USD per million tokens): a host passes `listModels()[i].pricing` through to `model({ id, pricing })`, and the loop records `costOf(usage, pricing)` per step, cache reads and writes at their own rates (defaulting to the input rate), rounded to micro-dollars. `Usage.inputTokens` counts every prompt token, cached ones included; `cacheReadTokens` and `cacheWriteTokens` say how many of them were cached.
`ModelFeatures` says what a model actually supports (`tools`, `streaming`, `images`, `structuredOutput`, `reasoning`); an adapter refuses a request that needs more.
Messages carry `text`, `image`, `reasoning`, `toolCall` and `toolResult` parts; `textOf()` returns the text parts only.

## Layout

```
src/types/      contracts only: interfaces and type aliases, no runtime values
src/agent/      createAgent, DEFAULT_LIMITS
src/capabilities/ skills
src/run/        run, resume, the loop (turn.ts), run handle, context assembly, tool handling, pause signal
src/message/    textOf, toolCallsOf, INTERRUPTED, INTERRUPTED_TOOL
src/model/      ZERO_USAGE, addUsage, costOf
src/schema/     validateSchema, assertSupportedSchema
src/tool/       createTool, createAskUserTool
src/store/      createMemoryStore
src/testing/    createFakeModel, the Store conformance suite
src/index.ts    public entry
src/testing.ts  the "./testing" sub-path
```
