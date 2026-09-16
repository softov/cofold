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

`run` returns a `RunHandle` synchronously and executes the turn in the background:

- `events`: every `RunEvent` from `seq` 1, replayed to any iterator, ending after `run.finished`.
- `outcome`: resolves to exactly one of `completed | awaiting | stopped | cancelled | failed`; it never rejects.
- `cancel({ reason })` / `submit({ type: 'cancel' })`: aborts the run; a tool in flight is left `uncertain` in the step log.
- `status()`: `running` until the outcome settles.

Per step the loop assembles a bounded request from the session transcript (newest messages first, tool-call groups kept whole), calls `hooks.beforeModel`, the model, `hooks.afterModel`, then handles each proposed tool call in order: validate the arguments, `hooks.beforeTool`, the policy floor (`policy.requireApproval`, default: `effects.destructive`), execute, bound the output, `hooks.afterTool`.
Every message, step and event is persisted through the `Store` before it is published.
A call that needs approval pauses the run as `awaiting` with a durable `requestId` (see "Pause and resume").
Limits: `maxSteps`, `maxToolCalls`, `timeoutMs`, `maxToolOutputChars`.

Capabilities (`{ id, tools?(args), instructions?(args) }`) are resolved at the start of every run and contribute tools plus a `## <id>` section to the instructions.

## Pause and resume

A run pauses when a tool needs approval (`policy.requireApproval`, or a `beforeTool` hook returning `approval`) or when a tool asks the user something.
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
`deny` appends an error result so the model can react.
`cancel` while waiting detaches the handle and leaves the request open for a later `resume`.

`resume` on a run that was `running` when its process died (decision 78) marks the open step `failed` (model) or `uncertain` (tool, plus an error result so the transcript stays valid) and finishes `failed { code: 'interrupted' | 'uncertain_invocation' }`.
`resume` on a terminal run replays its events and delivers the stored outcome; `afterSeq` skips events the host already has.
A durable store hands a `running` run's writer claim to a new process only when its heartbeat is stale (60 s by default); the loop refreshes it every `HEARTBEAT_MS` (10 s).

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
The memory store is the reference `Store`: it enforces the writer claim (`writer_mismatch`), contiguous event sequence numbers (`seq_gap`), refuses to overwrite an existing session or run (`already_exists`), and addresses runs only through their session (`RunRef { sessionId, runId }`).
Every `Store` implementation runs the same conformance suite from a vitest file:

```ts
import { describeStoreConformance } from '@facio/agents/testing/store-conformance';

describeStoreConformance({ name: 'mine', create: () => createMyStore(), dispose: (store) => ... });
```

It lives on its own sub-path because it imports `vitest`.

## Models and providers

`ModelAdapter` is what an agent talks to: `{ id, modelId, features, complete(request) }`.
`ModelProvider` is what a host lists models from: `{ id, listModels(), model({ id }) }`; it lives in `types/provider.ts` and the core never calls it.
`ModelFeatures` says what a model actually supports (`tools`, `streaming`, `images`, `structuredOutput`, `reasoning`); an adapter refuses a request that needs more.
Messages carry `text`, `image`, `reasoning`, `toolCall` and `toolResult` parts; `textOf()` returns the text parts only.

## Layout

```
src/types/      contracts only: interfaces and type aliases, no runtime values
src/agent/      createAgent, DEFAULT_LIMITS
src/capabilities/ skills
src/run/        run, resume, the loop (turn.ts), run handle, context assembly, tool handling, pause signal
src/message/    textOf, toolCallsOf
src/model/      ZERO_USAGE, addUsage
src/schema/     validateSchema, assertSupportedSchema
src/tool/       createTool, createAskUserTool
src/store/      createMemoryStore
src/testing/    createFakeModel, the Store conformance suite
src/index.ts    public entry
src/testing.ts  the "./testing" sub-path
```
