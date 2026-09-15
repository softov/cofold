# @facio/agents

Agent runtime: contracts, JSON Schema validation, `createTool`, an in-memory `Store`, and a scripted fake model.
Zero runtime dependencies.
The loop (`createAgent`, `run`, `resume`) lands in the next phase; the contracts for it are already here.

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

## The shape the whole family follows

```ts
const agent = createAgent({ id: 'support', instructions: '...', model, tools: [readFile], store });
const handle = run({ agent, session: 'sess-1', input: 'Summarize README.md' });
for await (const event of handle.events) { /* ... */ }
const outcome = await handle.outcome;
```

`createAgent` returns a frozen value with no methods; `run` executes one turn and returns a `RunHandle` immediately.
An outcome is always one of `completed | awaiting | stopped | cancelled | failed`.

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

## Models and providers

`ModelAdapter` is what an agent talks to: `{ id, modelId, features, complete(request) }`.
`ModelProvider` is what a host lists models from: `{ id, listModels(), model({ id }) }`; it lives in `types/provider.ts` and the core never calls it.
`ModelFeatures` says what a model actually supports (`tools`, `streaming`, `images`, `structuredOutput`, `reasoning`); an adapter refuses a request that needs more.
Messages carry `text`, `image`, `reasoning`, `toolCall` and `toolResult` parts; `textOf()` returns the text parts only.

## Layout

```
src/types/      contracts only: interfaces and type aliases, no runtime values
src/agent/      DEFAULT_LIMITS (createAgent in the next phase)
src/message/    textOf, toolCallsOf
src/model/      ZERO_USAGE, addUsage
src/schema/     validateSchema, assertSupportedSchema
src/tool/       createTool
src/store/      createMemoryStore
src/testing/    createFakeModel
src/index.ts    public entry
src/testing.ts  the "./testing" sub-path
```
