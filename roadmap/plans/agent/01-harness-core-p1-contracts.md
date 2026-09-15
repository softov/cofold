<!--
Domain: agent
Status: Shipped
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-15
Dependencies: — (first phase)
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p1 - Contracts, fake model, chat-completions adapter

_Status: Shipped 2026-09-15 · Priority: High · Created: 2026-09-13_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 1: "Define message, event, command, outcome, model, tool, and store contracts. Implement one non-streaming Chat Completions adapter and a deterministic fake model for tests."

## Goal

After this phase the repo builds, tests pass, and every shape the rest of the harness will use exists in `packages/agents/src/` with a test.
A developer can define a tool with `createTool({...})`, validate model-supplied arguments against it, drive a scripted `createFakeModel({...})`, and call a real Chat Completions endpoint through `openaiCompat({...})`.
No loop yet; `createAgent`, `run` and `resume` arrive in p2.

## Reconnaissance

Inherited from the parent; the parts that matter for this phase:

### Files read

- `roadmap/specs/agent-harness-spec.md` sections "Vocabulary", "Public shape", "Model adapters", "Tools and execution", "Persistence and recovery" - the contract requirements below quote them.
- `F:\github\facio\package.json:1-120` - `exports` sub-path map, `files`, `scripts` (`build: tsc -p`, `test: vitest run`, `typecheck: tsc --noEmit`), devDeps (`typescript ^5.8`, `vitest ^2.1`, `@types/node ^22`).
- `F:\github\facio\src\core\command.ts:192-197` - `Field = JsonSchema & {...}`; facio's own `JsonSchema` type is the shape our validator subset must accept so `fromFacioAction()` stays trivial later.
- `ahpd/packages/sdk/src/types/agent.ts` (softov/ahpd) - `BoundTool.definition` is an AHP `ToolDefinition` (name, description, JSON Schema params); confirms decision 5 (full JSON Schema object).
- Survey (`roadmap/research/agent-harness-survey.md`, events section) - event union style (discriminated `type`, flat payload); reused.

### Searches performed

- Chat Completions API reference (OpenAI docs, OpenRouter docs) - confirmed the tool-call shape: `choices[0].message.tool_calls[].{id, type:'function', function:{name, arguments:string}}`, tool results sent as `{ role:'tool', tool_call_id, content }`.
- Chat Completions API reference - `finish_reason` values: `stop`, `tool_calls`, `length`, `content_filter`.

### Runtime path

None at runtime in this phase.
Test path: `vitest` → `packages/agents/src/**/*.test.ts` and `packages/model-openai-compat/src/**/*.test.ts` with `fetch` mocked.

### Existing patterns to reuse

- facio `package.json` exports/files/scripts layout (copied, not linked).
- facio's JSON Schema field validation semantics (`type`, `enum`, `required`, `default`, `minimum`, `pattern`), reimplemented over a full schema object.

### Gaps

- `Not found: a zero-dependency JSON Schema validator in facio that accepts a full schema object - facio validates per-field maps (searched "validate" in facio/src/core).` Written here.

## Decisions locked in

Rows 1-31 of the parent apply.
Additional rows for this phase:

| # | Decision | Rationale / source |
| --- | --- | --- |
| 28 | JSON Schema subset supported by `validateSchema`: `type` (string, number, integer, boolean, null, object, array, or array of these), `properties`, `required`, `additionalProperties` (boolean only), `items` (single schema), `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `default`, `description`, `anyOf`, `oneOf`, `nullable` (OpenAPI style). Any other keyword → `SchemaError('unsupported_keyword')` at `createTool` time, not at validation time | (defaulted: smallest set that covers facio fields and MCP tool schemas; unsupported keywords fail loudly per parent risk note) |
| 29 | `validateSchema` applies `default` for missing optional properties and returns the coerced value; it never coerces types (a string `"3"` is not an integer) | (defaulted: matches facio; models emit typed JSON) |
| 30 | Tool `execute` returns `string | { content: string; detail?: unknown }`; `content` is what the model sees (bounded by `limits.maxToolOutputChars` in p2), `detail` is stored in the step log only | Spec "Preserve structured error details internally" |
| 31 | Tool execution errors: `execute` throwing becomes `{ isError: true, content: error.message, detail: { name, stack } }`; the run does not fail | Spec "execute or report a denial/error as a tool result" |
| 32 | Adapter retries `429` and `5xx` with exponential backoff (`retries` default 2, base 500 ms); never retries `4xx` other than 429; `signal` aborts retries | Spec "Keep ... retries ... inside the adapter" |
| 33 | Adapter parses `function.arguments` JSON; on parse failure the `toolCall` part carries `input: undefined` and `raw: string`; the loop (p2) turns that into a validation failure result. The adapter never throws on model-produced JSON | Spec "A model-supplied ... JSON object is never trusted"; stream interruption rule |
| 34 | `ModelFeatures` defaults for `openaiCompat`: `{ tools: true, streaming: false, images: false, structuredOutput: false }`; the caller overrides per model with `features` | Spec "configuration should say which model actually supports ..." |
| 35 | Memory store `appendEvent` rejects a seq that is not `last + 1` with `StoreError('seq_gap')`; `appendMessages` and `appendStep` require the caller's `runId` to equal the active writer claim or throw `StoreError('writer_mismatch')` | Decision 24; writer fence pattern from the survey |
| 36 | Package sub-path exports: `@facio/agents` (everything), `@facio/agents/testing` (fake model, memory store helpers); no deep imports | (defaulted: facio pattern) |
| 37 | `packages/agents/src/types/` holds contracts only: interfaces and type aliases, no runtime values. Runtime code lives in domain folders (`agent/`, `message/`, `model/`, `schema/`, `store/`, `tool/`, `testing/`) and imports contracts from the specific file `../types/<name>.js`, never from the barrel. `types/index.ts` is a barrel consumed by `index.ts` only. Later phases add new runtime code under those folders (p2 `agent/create-agent.ts`, `run/run.ts`; p3 `tool/ask-user.ts`) | User (2026-09-14) |
| 38 | Public authoring surfaces take named argument types: `Hooks` handlers are `HookHandler<Args, Result>` over `BeforeModelArgs`, `AfterModelArgs`, `BeforeToolArgs`, `AfterToolArgs`; `ToolDefinition.execute` is the one positional exception: `execute(input, ctx)`, input first, context second, the same order as the OpenAI Agents SDK and most tool frameworks (`execute(args, context)`), so a tool body is `(input) => ...` when it needs no context. `Store` method arguments stay inline: implementers get them by contextual typing and twenty named one-field shapes is noise | User (2026-09-14) |
| 39 | Sibling packages resolve `@facio/agents` through its `exports` map, which points at `dist/` only. Root `typecheck` and `test` therefore run `pnpm build` first (`"typecheck": "pnpm build && pnpm -r run typecheck"`, `"test": "pnpm build && vitest run --typecheck"`); no source-mapped exports, no project references | User (2026-09-15); facio pattern (`examples: npm run build && tsc`) |
| 40 | `vitest.workspace.ts` lists explicit projects (`defineWorkspace([{ test: { name, root, typecheck } }])`) with `typecheck: { enabled: true, tsconfig: 'tsconfig.test.json' }`; each package has a `tsconfig.test.json` that extends its `tsconfig.json` with `exclude: []`. A directory-glob project gets an empty config and never runs `*.test-d.ts`; and vitest copies the package tsconfig verbatim, so the build tsconfig's `*.test-d.ts` exclude made tsc check nothing and report no errors | Found while building (2026-09-15): a deliberately false `expectTypeOf` passed until both were fixed |
| 41 | `sessions.create` and `runs.create` throw `StoreError('already_exists')` (new `AgentErrorCode`) when the id exists; never overwrite. p3's file store creates `session.json` with the `wx` flag for the same reason | Review (2026-09-15) |
| 42 | `assertSupportedSchema` validates values, not only keyword names: `pattern` must compile, `type` must be a `JsonSchemaType` or an array of them, `required` / `enum` / `anyOf` / `oneOf` must be arrays, `properties` / `items` must be objects; violations throw `SchemaError('invalid_schema')` at `createTool` time so `validateSchema` never throws on a model-supplied argument | Review (2026-09-15) |
| 43 | `fromWireResponse` accepts `content` as a string or as an array of `{ type: 'text', text }` parts (joined); other part types are ignored | Review (2026-09-15) |
| 44 | Model catalog: `types/provider.ts` defines `ModelInfo { id, name, features, contextTokens?, maxOutputTokens?, pricing? }` and `ModelProvider { id, listModels(args?), model(args) }`. `@facio/model-openai-compat` exports `openaiCompatProvider({ baseUrl, apiKey?, headers?, name?, retries?, fetch? })`; `listModels` calls `GET <baseUrl>/models` and fills `features` / `contextTokens` / `maxOutputTokens` / `pricing` from OpenRouter's extra fields when present (`supported_parameters`, `architecture.input_modalities`, `context_length`, `top_provider.max_completion_tokens`, `pricing`), defaults otherwise. Provider id is `openai-compat:<name ?? URL host>`. `openaiCompat({...})` stays as the one-model shortcut and is `openaiCompatProvider(...).model(...)` | Review (2026-09-15); AHP probe wants `models: { id, name, ... }[]` |
| 45 | Reasoning: `ModelFeatures.reasoning: boolean` (default false), `ModelParams.reasoning?: { effort?: 'low' \| 'medium' \| 'high'; maxTokens?: number }`, `Usage.reasoningTokens?` (from `completion_tokens_details.reasoning_tokens`), and a fifth part `ReasoningPart { type: 'reasoning'; text: string }` (amends decision 16). The adapter sends `reasoning_effort` when only `effort` is set and `reasoning: { effort?, max_tokens }` when `maxTokens` is set (OpenAI has no budget form; OpenRouter accepts both); nothing is sent when `features.reasoning` is false. On reply it reads `message.reasoning` (OpenRouter) or `message.reasoning_content` (DeepSeek / LM Studio), else strips one leading `<think>...</think>` block out of `content`; the reasoning part precedes the text part. `toWireMessages` never sends reasoning parts back; `textOf` ignores them; `addUsage` sums `reasoningTokens` like `cacheReadTokens` | Review (2026-09-15) |

## Proposed architecture

Package layout after this phase:

```
F:\github\facio-agents\
  package.json                 private, scripts: build / typecheck / test / check
  pnpm-workspace.yaml          packages/*, examples
  tsconfig.base.json           strict, ES2022, NodeNext, declaration
  vitest.workspace.ts
  .gitignore  .npmrc  README.md  LICENSE (MIT)
  packages/
    agents/                    @facio/agents
      package.json  tsconfig.json  README.md
      src/
        index.ts               public entry: `export type *` from types/index.ts + every runtime export
        testing.ts             sub-path "./testing": createFakeModel, createMemoryStore
        errors.ts              AgentError, SchemaError, StoreError, ModelError, AgentErrorCode
        ids.ts                 newId()
        types/                 contracts only; no runtime values (decision 37)
          index.ts             barrel, one `export type * from` per sibling
          message.ts           Role, TextPart, ImagePart, ReasoningPart, ToolCallPart, ToolResultPart, ContentPart, MessageSource, Message
          tool.ts              ToolEffects, ToolContext, ToolOutput, ToolExecute, ToolDefinition, Tool, ModelToolDefinition
          model.ts             ModelFeatures, ModelParams, Usage, FinishReason, ModelRequest, ModelReply, ModelAdapter
          event.ts             EventBase, RunEventBody, RunEvent, RunEventType
          command.ts           RunCommand
          outcome.ts           RunStatus, StopReason, RunOutcome
          provider.ts          ModelInfo, ModelProvider (decision 44)
          store.ts             SessionRecord, RunRecord, StepStatus, StepRecord, PendingRequest, KvScope, KvScopeKey, Store
          hooks.ts             RunInfo, HookHandler, Before/After Model/Tool Args + Result, Hooks
          capability.ts        CapabilityArgs, Capability (parent decision 31)
          skills.ts            SkillIndexEntry, SkillSource (parent decision 31; the skills() capability itself is p3)
          agent.ts             ContextOptions, AgentOptions, AgentDefinition, Agent (createAgent body in p2)
          run.ts               RunArgs, ResumeArgs, RunHandle (run()/resume() bodies in p2/p3)
          limits.ts            Limits
          schema.ts            JsonSchemaType, JsonSchema, SchemaIssue, ValidationResult
          contracts.test-d.ts  type-level assertions (vitest --typecheck)
        agent/limits.ts        DEFAULT_LIMITS
        message/helpers.ts     textOf, toolCallsOf
        model/usage.ts         ZERO_USAGE, addUsage
        schema/validate.ts     SUPPORTED_KEYWORDS, validateSchema, assertSupportedSchema
        tool/create-tool.ts    createTool
        store/memory.ts        createMemoryStore
        testing/fake-model.ts  createFakeModel
    model-openai-compat/       @facio/model-openai-compat
      package.json  tsconfig.json  README.md
      src/index.ts             openaiCompatProvider, openaiCompat (shortcut)
      src/wire.ts              request/response mapping
      src/index.test.ts
  examples/
    package.json  tsconfig.json
    adapter-smoke.ts           calls a local LM Studio model once, prints the reply and usage
```

- **Data flow.** None at runtime; contracts only.
- **Layer responsibilities.** `@facio/agents` owns every type. `@facio/model-openai-compat` imports them and owns HTTP.
- **Source-of-truth files.** `packages/agents/src/types/*.ts` for contracts; the runtime files as listed.
- **Import rules.** `types/*` files import only sibling `./<name>.js` files. Runtime files import contracts from `../types/<name>.js` (never the barrel) and runtime symbols from their domain folders. `index.ts` is the only importer of `types/index.ts`. Test files sit next to what they test; `*.test-d.ts` are type-only tests and are excluded from `dist` together with `*.test.ts`.

## Phases

Single phase; eight tasks in dependency order.

### Task 1 - Workspace scaffold

- **Layer:** repo
- **Files:**
  - `CREATE: package.json`
  - `CREATE: pnpm-workspace.yaml`
  - `CREATE: tsconfig.base.json`
  - `CREATE: vitest.workspace.ts`
  - `CREATE: .gitignore`, `.npmrc`, `LICENSE`, `README.md`
  - `CREATE: packages/agents/package.json`, `packages/agents/tsconfig.json`, `packages/agents/README.md`
  - `CREATE: packages/model-openai-compat/package.json`, `packages/model-openai-compat/tsconfig.json`, `packages/model-openai-compat/README.md`
  - `CREATE: examples/package.json`, `examples/tsconfig.json`
- **Reason:** decision 18; every later task assumes `pnpm typecheck` and `pnpm test` exist.
- **Integration points:** none.
- **Code:**

  `package.json`
  ```json
  {
    "name": "facio-agents",
    "private": true,
    "type": "module",
    "packageManager": "pnpm@10.28.0",
    "engines": { "node": ">=22" },
    "scripts": {
      "build": "pnpm -r --filter './packages/*' run build",
      "typecheck": "pnpm -r run typecheck",
      "test": "vitest run --typecheck",
      "check": "pnpm typecheck && pnpm test",
      "clean": "pnpm -r run clean"
    },
    "devDependencies": {
      "@types/node": "^22.15.3",
      "typescript": "^5.8.3",
      "vitest": "^2.1.9"
    }
  }
  ```

  `pnpm-workspace.yaml`
  ```yaml
  packages:
    - packages/*
    - examples
  ```

  `tsconfig.base.json`
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "exactOptionalPropertyTypes": true,
      "noUncheckedIndexedAccess": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "skipLibCheck": true,
      "isolatedModules": true,
      "verbatimModuleSyntax": true,
      "lib": ["ES2022", "DOM"]
    }
  }
  ```
  `"lib"` includes `DOM` only for the `fetch` / `AbortSignal` types on Node 22; no browser code.

  `packages/agents/package.json`
  ```json
  {
    "name": "@facio/agents",
    "version": "0.0.1",
    "description": "Agent runtime: contracts, loop, run handle, step log.",
    "license": "MIT",
    "type": "module",
    "engines": { "node": ">=22" },
    "sideEffects": false,
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "./testing": { "types": "./dist/testing.d.ts", "default": "./dist/testing.js" }
    },
    "files": ["dist", "src", "!src/**/*.test.ts", "!src/**/*.test-d.ts", "README.md"],
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "clean": "rm -rf dist"
    },
    "publishConfig": { "access": "public" }
  }
  ```
  No `dependencies` key at all (decision 6).

  `packages/agents/tsconfig.json`
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "rootDir": "src", "outDir": "dist" },
    "include": ["src"],
    "exclude": ["src/**/*.test.ts", "src/**/*.test-d.ts"]
  }
  ```
  Both `*.test.ts` and `*.test-d.ts` are excluded; the `*.test.ts` glob alone does not match `contracts.test-d.ts` and would ship it in `dist`.

  `packages/model-openai-compat/package.json` is the same shape with `"name": "@facio/model-openai-compat"`, one export `"."`, and
  ```json
  "peerDependencies": { "@facio/agents": "workspace:*" },
  "devDependencies": { "@facio/agents": "workspace:*" }
  ```

  `vitest.workspace.ts`
  ```ts
  export default ['packages/*', 'examples'];
  ```
  The root `test` script passes `--typecheck` so `*.test-d.ts` files run; without the flag vitest 2 skips `expectTypeOf` assertions silently.

  `examples/package.json`: `"name": "facio-agents-examples"`, private, `"dependencies": { "@facio/agents": "workspace:*", "@facio/model-openai-compat": "workspace:*" }`, `"scripts": { "smoke": "node --experimental-strip-types adapter-smoke.ts" }`.

- **Validation:** `pnpm install` succeeds; `pnpm typecheck` and `pnpm test` run (zero tests) with exit 0.

### Task 2 - Contracts

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/ids.ts`
  - `CREATE: packages/agents/src/errors.ts`
  - `CREATE: packages/agents/src/types/limits.ts`
  - `CREATE: packages/agents/src/types/message.ts`
  - `CREATE: packages/agents/src/types/tool.ts` (types; `createTool` is Task 4)
  - `CREATE: packages/agents/src/types/model.ts`
  - `CREATE: packages/agents/src/types/event.ts`
  - `CREATE: packages/agents/src/types/command.ts`
  - `CREATE: packages/agents/src/types/outcome.ts`
  - `CREATE: packages/agents/src/types/store.ts`
  - `CREATE: packages/agents/src/types/hooks.ts`
  - `CREATE: packages/agents/src/types/capability.ts`
  - `CREATE: packages/agents/src/types/skills.ts`
  - `CREATE: packages/agents/src/types/agent.ts`
  - `CREATE: packages/agents/src/types/run.ts`
  - `CREATE: packages/agents/src/types/index.ts`
  - `CREATE: packages/agents/src/types/contracts.test-d.ts`
  - `CREATE: packages/agents/src/agent/limits.ts`
  - `CREATE: packages/agents/src/message/helpers.ts`
  - `CREATE: packages/agents/src/model/usage.ts`
  - `CREATE: packages/agents/src/index.ts`
- **Reason:** spec build step 1; every other package and phase imports these.
- **Integration points:** none at runtime; p2 implements `createAgent`, `run`, `resume`, p3 implements `Store` on files and `PendingRequest`, p4 maps to `@ahpd/sdk`.
- **Data contracts:** the files themselves are the source of truth. Full content:

  `ids.ts`
  ```ts
  export function newId(): string {
    return crypto.randomUUID();
  }
  ```

  `errors.ts`
  ```ts
  export type AgentErrorCode =
    | 'invalid_options'
    | 'unsupported_keyword'
    | 'invalid_schema'
    | 'seq_gap'
    | 'writer_mismatch'
    | 'not_found'
    | 'unsupported_feature'
    | 'auth'
    | 'rate_limit'
    | 'server'
    | 'network'
    | 'invalid_response'
    | 'aborted'
    | 'hook_error';

  export class AgentError extends Error {
    readonly code: AgentErrorCode;
    readonly detail: unknown;
    constructor(options: { code: AgentErrorCode; message: string; detail?: unknown; cause?: unknown }) {
      super(options.message, { cause: options.cause });
      this.name = new.target.name;
      this.code = options.code;
      this.detail = options.detail;
    }
  }
  export class SchemaError extends AgentError {}
  export class StoreError extends AgentError {}
  export class ModelError extends AgentError {
    readonly status: number | undefined;
    readonly retryable: boolean;
    constructor(options: ConstructorParameters<typeof AgentError>[0] & { status?: number; retryable?: boolean }) {
      super(options);
      this.status = options.status;
      this.retryable = options.retryable ?? false;
    }
  }
  ```

  `types/limits.ts`
  ```ts
  export interface Limits {
    /** Model steps per run. */
    maxSteps: number;
    /** Tool executions per run. */
    maxToolCalls: number;
    /** Wall clock for the whole run; 0 = no limit. */
    timeoutMs: number;
    /** Characters of a tool result the model sees; the rest is truncated with a marker. */
    maxToolOutputChars: number;
  }
  ```

  `agent/limits.ts`
  ```ts
  import type { Limits } from '../types/limits.js';

  export const DEFAULT_LIMITS: Limits = {
    maxSteps: 20,
    maxToolCalls: 50,
    timeoutMs: 0,
    maxToolOutputChars: 16_000,
  };
  ```

  `types/message.ts`
  ```ts
  export type Role = 'system' | 'user' | 'assistant' | 'tool';

  export interface TextPart { type: 'text'; text: string }
  export interface ImagePart {
    type: 'image';
    mimeType: string;
    /** Exactly one of `data` (base64) or `url`. */
    data?: string;
    url?: string;
  }
  export interface ToolCallPart {
    type: 'toolCall';
    /** Model-supplied id when present, otherwise newId(). Pairs with ToolResultPart.callId. */
    callId: string;
    name: string;
    /** Parsed arguments; undefined when `raw` did not parse as JSON. */
    input: unknown;
    /** The argument string exactly as the model produced it. */
    raw: string;
  }
  export interface ToolResultPart {
    type: 'toolResult';
    callId: string;
    name: string;
    /** What the model sees. Already bounded and, if a hook transformed it, the transformed value. */
    content: string;
    isError: boolean;
  }
  export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

  /** Where a message came from; kept so context assembly can tell instructions, input, tool output and summaries apart. */
  export type MessageSource = 'input' | 'model' | 'tool' | 'hook' | 'summary' | 'system';

  export interface Message {
    id: string;
    role: Role;
    parts: ContentPart[];
    source: MessageSource;
    createdAt: string;
  }
  ```

  `message/helpers.ts`
  ```ts
  import type { Message, TextPart, ToolCallPart } from '../types/message.js';

  export function textOf(message: Message): string {
    return message.parts.filter((p): p is TextPart => p.type === 'text').map((p) => p.text).join('');
  }
  export function toolCallsOf(message: Message): ToolCallPart[] {
    return message.parts.filter((p): p is ToolCallPart => p.type === 'toolCall');
  }
  ```

  `types/tool.ts` (types; `createTool` is Task 4)
  ```ts
  import type { JsonSchema } from './schema.js';
  import type { KvScope } from './store.js';

  export interface ToolEffects {
    reads?: boolean;
    writes?: boolean;
    network?: boolean;
    destructive?: boolean;
  }

  export interface ToolContext<Resources = Record<string, unknown>> {
    agentId: string;
    sessionId: string;
    runId: string;
    callId: string;
    /** Stable across retries of the same execution attempt; the step-log key. */
    invocationId: string;
    signal: AbortSignal;
    /** `workspace` is present only when the session has a workspace (SessionRecord.workspace). */
    kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
    /** Host-provided; credentials and handles live here, never in messages. */
    resources: Resources;
  }

  export type ToolOutput = string | { content: string; detail?: unknown };

  /** Positional on purpose (decision 38): `(input) => ...` covers most tools; `ctx` is there when needed. */
  export type ToolExecute<Input = unknown, Resources = Record<string, unknown>> =
    (input: Input, ctx: ToolContext<Resources>) => ToolOutput | Promise<ToolOutput>;

  export interface ToolDefinition<Input = unknown, Resources = Record<string, unknown>> {
    name: string;
    description: string;
    input: JsonSchema;
    effects?: ToolEffects;
    execute: ToolExecute<Input, Resources>;
  }

  /** Result of createTool(): the definition with effects filled and the schema pre-validated. */
  export interface Tool<Input = unknown, Resources = Record<string, unknown>> extends ToolDefinition<Input, Resources> {
    effects: ToolEffects;
    /**
     * Who owns the tool (spec: a registry must not erase ownership). createTool sets 'agent';
     * run() re-stamps tools contributed by a capability with that capability's id (parent decision 31).
     */
    source: string;
    /** What an adapter sends to the model. */
    toModelDefinition(): ModelToolDefinition;
  }

  export interface ModelToolDefinition {
    name: string;
    description: string;
    input: JsonSchema;
  }
  ```

  `types/model.ts`
  ```ts
  import type { Message } from './message.js';
  import type { ModelToolDefinition } from './tool.js';

  export interface ModelFeatures {
    tools: boolean;
    streaming: boolean;
    images: boolean;
    structuredOutput: boolean;
  }

  export interface ModelParams {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stop?: string[];
    seed?: number;
  }

  export interface Usage {
    inputTokens: number;
    outputTokens: number;
    /** Provider-reported cache hits, when known. */
    cacheReadTokens?: number;
  }

  export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other';

  export interface ModelRequest {
    instructions: string;
    messages: Message[];
    tools: ModelToolDefinition[];
    params: ModelParams;
    signal: AbortSignal;
  }

  export interface ModelReply {
    /** role 'assistant', source 'model'; text and toolCall parts only. */
    message: Message;
    usage: Usage;
    finish: FinishReason;
    /** Provider payload for diagnostics; never sent to the model or stored in the transcript. */
    raw?: unknown;
  }

  export interface ModelAdapter {
    /** Stable id for logs and the agent definition, e.g. "openai-compat:qwen3-8b". */
    id: string;
    modelId: string;
    features: ModelFeatures;
    complete(request: ModelRequest): Promise<ModelReply>;
    /** Optional exact counter; the loop falls back to context.estimateTokens. */
    estimateTokens?(text: string): number;
  }
  ```

  `model/usage.ts`
  ```ts
  import type { Usage } from '../types/model.js';

  export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };
  export function addUsage(a: Usage, b: Usage): Usage {
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      ...(a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
        ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
        : {}),
    };
  }
  ```

  `types/event.ts`
  ```ts
  import type { Message } from './message.js';
  import type { FinishReason, Usage } from './model.js';
  import type { RunOutcome } from './outcome.js';

  export interface EventBase {
    seq: number;
    runId: string;
    sessionId: string;
    agentId: string;
    at: string;
  }

  export type RunEventBody =
    | { type: 'run.started'; input: Message }
    | { type: 'model.started'; step: number }
    | { type: 'model.delta'; step: number; text: string }
    | { type: 'model.completed'; step: number; message: Message; usage: Usage; finish: FinishReason }
    | { type: 'tool.proposed'; callId: string; name: string; input: unknown }
    | { type: 'tool.denied'; callId: string; name: string; reason: string }
    | { type: 'tool.started'; callId: string; name: string; invocationId: string }
    | { type: 'tool.completed'; callId: string; name: string; invocationId: string; content: string; isError: boolean; durationMs: number }
    | { type: 'approval.requested'; requestId: string; callId: string; name: string; input: unknown; prompt?: string }
    | { type: 'approval.resolved'; requestId: string; decision: 'approve' | 'deny'; reason?: string }
    | { type: 'input.requested'; requestId: string; prompt: string }
    | { type: 'input.resolved'; requestId: string; text: string }
    | { type: 'run.paused'; requestId: string; kind: 'approval' | 'input' }
    | { type: 'run.resumed'; requestId: string }
    | { type: 'run.finished'; outcome: RunOutcome };

  export type RunEvent = EventBase & RunEventBody;
  export type RunEventType = RunEventBody['type'];
  ```
  `model.delta` is declared now and only emitted from p5; `approval.*`, `input.*`, `run.paused`, `run.resumed` are emitted from p3.

  `types/command.ts`
  ```ts
  export type RunCommand =
    | { type: 'approve'; requestId: string }
    | { type: 'deny'; requestId: string; reason?: string }
    | { type: 'answer'; requestId: string; text: string }
    | { type: 'cancel'; reason?: string };
  ```

  `types/outcome.ts`
  ```ts
  import type { Message } from './message.js';
  import type { Usage } from './model.js';

  export type RunStatus = 'running' | 'completed' | 'awaiting' | 'stopped' | 'cancelled' | 'failed';

  export type StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy';

  export type RunOutcome =
    | { status: 'completed'; message: Message; usage: Usage; steps: number }
    | { status: 'awaiting'; sessionId: string; runId: string; requestId: string; kind: 'approval' | 'input'; usage: Usage; steps: number }
    | { status: 'stopped'; reason: StopReason; usage: Usage; steps: number }
    | { status: 'cancelled'; reason?: string; usage: Usage; steps: number }
    | { status: 'failed'; error: { code: string; message: string; detail?: unknown }; usage: Usage; steps: number };
  ```

  `types/store.ts`
  ```ts
  import type { RunEvent } from './event.js';
  import type { Message } from './message.js';
  import type { ModelRequest, ModelReply } from './model.js';
  import type { RunStatus } from './outcome.js';

  export interface SessionRecord {
    sessionId: string;
    agentId: string;
    /**
     * Host-supplied partition key (parent decision 29). The CLI passes the cwd; the AHP transport passes
     * SessionOptions.cwd. Absent for hosts without a working directory (chat bots). The file store
     * nests the session under workspaces/<slug>/ when set.
     */
    workspace?: string;
    createdAt: string;
    updatedAt: string;
    /** The run currently allowed to append; undefined when idle. */
    activeWriterRunId?: string;
  }

  /** Locates a run. Runs live under their session (parent decision 30), so every run-level call carries both ids. */
  export interface RunRef {
    sessionId: string;
    runId: string;
  }

  export interface RunRecord {
    runId: string;
    sessionId: string;
    agentId: string;
    status: RunStatus;
    createdAt: string;
    updatedAt: string;
    /** Set when status is 'awaiting'. */
    pendingRequestId?: string;
  }

  export type StepStatus = 'started' | 'completed' | 'failed' | 'uncertain';

  export type StepRecord =
    | {
        kind: 'model';
        sessionId: string;
        runId: string;
        index: number;
        invocationId: string;
        status: StepStatus;
        request?: Omit<ModelRequest, 'signal'>;
        reply?: ModelReply;
        startedAt: string;
        endedAt?: string;
      }
    | {
        kind: 'tool';
        sessionId: string;
        runId: string;
        index: number;
        invocationId: string;
        status: StepStatus;
        callId: string;
        name: string;
        /** Arguments as validated (and possibly hook-modified) before execution. */
        input: unknown;
        /** Executor output before any afterTool transform. */
        original?: { content: string; isError: boolean; detail?: unknown };
        /** What the model saw, when a hook changed it. */
        transformed?: { content: string; isError: boolean };
        startedAt: string;
        endedAt?: string;
      };

  export interface PendingRequest {
    requestId: string;
    sessionId: string;
    runId: string;
    kind: 'approval' | 'input';
    /** For approvals: the tool call awaiting a decision. */
    callId?: string;
    payload: unknown;
    createdAt: string;
    resolvedAt?: string;
    resolution?: unknown;
  }

  export interface KvScope {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  }

  export type KvScopeKey =
    | { kind: 'agent'; agentId: string }
    | { kind: 'shared'; namespace: string }
    | { kind: 'workspace'; workspace: string };

  export interface Store {
    sessions: {
      get(args: { sessionId: string }): Promise<SessionRecord | undefined>;
      create(args: { sessionId: string; agentId: string; workspace?: string }): Promise<SessionRecord>;
      /** Newest `updatedAt` first. `workspace` and `agentId` filter when given. */
      list(args: { workspace?: string; agentId?: string; limit?: number }): Promise<SessionRecord[]>;
      /** Fails with StoreError('writer_mismatch') unless runId holds the claim. */
      appendMessages(args: { sessionId: string; runId: string; messages: Message[] }): Promise<void>;
      listMessages(args: { sessionId: string; limit?: number }): Promise<Message[]>;
      /** Returns false when another run holds the claim. */
      claimWriter(args: { sessionId: string; runId: string }): Promise<boolean>;
      releaseWriter(args: { sessionId: string; runId: string }): Promise<void>;
    };
    runs: {
      create(record: RunRecord): Promise<void>;
      get(args: RunRef): Promise<RunRecord | undefined>;
      update(args: RunRef & { status: RunStatus; pendingRequestId?: string }): Promise<void>;
      /** Fails with StoreError('seq_gap') unless event.seq === last + 1 (first is 1). Located by event.sessionId + event.runId. */
      appendEvent(event: RunEvent): Promise<void>;
      listEvents(args: RunRef & { afterSeq?: number }): Promise<RunEvent[]>;
      /** Located by step.sessionId + step.runId. */
      appendStep(step: StepRecord): Promise<void>;
      updateStep(args: RunRef & { invocationId: string; patch: Partial<StepRecord> }): Promise<void>;
      listSteps(args: RunRef): Promise<StepRecord[]>;
    };
    requests: {
      /** Located by request.sessionId + request.runId. */
      create(request: PendingRequest): Promise<void>;
      get(args: RunRef & { requestId: string }): Promise<PendingRequest | undefined>;
      resolve(args: RunRef & { requestId: string; resolution: unknown }): Promise<void>;
    };
    kv(scope: KvScopeKey): KvScope;
  }
  ```
  Every run-level locator carries `sessionId` so a file store can address `sessions/<sessionId>/runs/<runId>/` directly and never scans or keeps a run index (parent decision 30). A store still rejects a `runId` that exists under a different session with `StoreError('not_found')`.

  `types/hooks.ts`
  ```ts
  import type { ToolCallPart } from './message.js';
  import type { ModelReply, ModelRequest } from './model.js';
  import type { Tool, ToolOutput } from './tool.js';
  import type { RunEvent } from './event.js';

  export interface RunInfo { runId: string; sessionId: string; agentId: string; step: number }

  export interface BeforeModelArgs { request: ModelRequest; run: RunInfo }
  export type BeforeModelResult = { request: ModelRequest } | { abort: { reason: string } };

  export interface AfterModelArgs { reply: ModelReply; run: RunInfo }
  export type AfterModelResult = { reply: ModelReply } | { abort: { reason: string } };

  export interface BeforeToolArgs { call: ToolCallPart; tool: Tool<any, any>; run: RunInfo }
  export type BeforeToolResult =
    | { decision: 'allow' }
    | { decision: 'modify'; input: unknown }
    | { decision: 'deny'; reason: string }
    | { decision: 'approval'; prompt?: string };

  export interface AfterToolArgs { call: ToolCallPart; tool: Tool<any, any>; output: ToolOutput; isError: boolean; run: RunInfo }
  export type AfterToolResult = { output: ToolOutput; isError?: boolean };

  export type HookHandler<Args, Result> = (args: Args) => Result | Promise<Result>;

  export interface Hooks {
    beforeModel?: HookHandler<BeforeModelArgs, BeforeModelResult>;
    afterModel?: HookHandler<AfterModelArgs, AfterModelResult>;
    beforeTool?: HookHandler<BeforeToolArgs, BeforeToolResult>;
    afterTool?: HookHandler<AfterToolArgs, AfterToolResult>;
    /** Observer. Errors are logged and ignored. */
    onEvent?(event: RunEvent): void;
  }
  ```
  Property syntax (not method syntax) on purpose: method signatures are bivariant in TypeScript, property function types are checked strictly, so a host assigning a wrongly typed handler fails at compile time.

  `types/capability.ts`
  ```ts
  import type { KvScope } from './store.js';
  import type { Tool } from './tool.js';

  export interface CapabilityArgs {
    agentId: string;
    sessionId: string;
    runId: string;
    workspace?: string;
    kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
    signal: AbortSignal;
  }

  /**
   * Contributes tools and/or an instructions section to every run (parent decision 31).
   * Resolved by run() at run start, in AgentOptions.capabilities order, before the first model step.
   * MCP servers and skill folders are capabilities provided by later packages; the core never learns their formats.
   */
  export interface Capability {
    /** Stable id; unique within an agent. Becomes Tool.source for its tools and the section label in the prompt. */
    id: string;
    tools?(args: CapabilityArgs): Tool<any, any>[] | Promise<Tool<any, any>[]>;
    /** Text appended to the agent instructions under a `## <id>` heading; undefined contributes nothing this run. */
    instructions?(args: CapabilityArgs): string | undefined | Promise<string | undefined>;
  }
  ```

  `types/skills.ts`
  ```ts
  /** One entry of the skill index the model sees. */
  export interface SkillIndexEntry {
    /** Frontmatter `name`, else the folder name. Must match /^[a-zA-Z0-9_-]{1,64}$/ so the model can name it. */
    name: string;
    /** Frontmatter `description`; the trigger text. */
    description: string;
    /** Opaque locator the source understands (folder path, row id, AHP uri). Shown to the model only as a label. */
    ref: string;
  }

  /**
   * Where skills come from (parent decision 31). Not part of Store: skills are content, the store is runtime state.
   * `@facio/store-file` ships `fileSkillSource`; a DB or an AHP host implements the same two methods.
   */
  export interface SkillSource {
    /** Skills visible to this session: global ones plus the workspace's own when `workspace` is set. */
    list(args: { workspace?: string }): Promise<SkillIndexEntry[]>;
    /** The SKILL.md body for `ref`; with `path` (relative, e.g. 'references/x.md') a file beside it. Throws AgentError('not_found'). */
    read(args: { ref: string; path?: string }): Promise<string>;
  }
  ```

  `types/agent.ts` (types only in p1; `createAgent` body is p2 in `agent/create-agent.ts`)
  ```ts
  import type { Capability } from './capability.js';
  import type { Hooks } from './hooks.js';
  import type { Limits } from './limits.js';
  import type { ModelAdapter, ModelParams } from './model.js';
  import type { Store } from './store.js';
  import type { Tool } from './tool.js';

  export interface ContextOptions {
    /** Budget for instructions + history; default 32_000. */
    maxTokens?: number;
    /** Default: Math.ceil(text.length / 4). */
    estimateTokens?(text: string): number;
  }

  export interface AgentOptions<Resources = Record<string, unknown>> {
    id: string;
    instructions: string;
    model: ModelAdapter;
    tools?: Tool<any, Resources>[];
    /** Resolved per run; see types/capability.ts. Duplicate ids → invalid_options at createAgent. */
    capabilities?: Capability[];
    store?: Store;
    hooks?: Hooks;
    limits?: Partial<Limits>;
    context?: ContextOptions;
    params?: ModelParams;
    resources?: Resources;
  }

  /** Serializable view; what an adapter advertises. */
  export interface AgentDefinition {
    id: string;
    instructions: string;
    model: { id: string; modelId: string };
    /** Names of AgentOptions.tools only; capability tools are per run and appear in the model step's request. */
    tools: string[];
    capabilities: string[];
    limits: Limits;
    context: { maxTokens: number };
  }

  /**
   * What createAgent() returns: every option resolved, defaults filled, frozen.
   * A value, not an actor. run({ agent, ... }) executes it.
   */
  export interface Agent<Resources = Record<string, unknown>> {
    readonly definition: AgentDefinition;
    readonly model: ModelAdapter;
    readonly tools: ReadonlyMap<string, Tool<any, Resources>>;
    readonly capabilities: readonly Capability[];
    readonly store: Store;
    readonly hooks: Hooks;
    readonly limits: Limits;
    readonly context: Required<ContextOptions>;
    readonly params: ModelParams;
    readonly resources: Resources;
  }
  ```

  `types/run.ts` (types only in p1; `run()` body is p2 in `run/run.ts`, `resume()` body is p3)
  ```ts
  import type { Agent } from './agent.js';
  import type { RunCommand } from './command.js';
  import type { RunEvent } from './event.js';
  import type { ContentPart } from './message.js';
  import type { RunOutcome, RunStatus } from './outcome.js';

  export interface RunArgs<Resources = Record<string, unknown>> {
    agent: Agent<Resources>;
    session: string;
    /** Stored on the session when it is created; ignored for an existing session. See SessionRecord.workspace. */
    workspace?: string;
    input: string | ContentPart[];
    signal?: AbortSignal;
  }

  export interface ResumeArgs<Resources = Record<string, unknown>> {
    agent: Agent<Resources>;
    /** Both come from the `awaiting` outcome (or RunHandle.sessionId / runId). */
    sessionId: string;
    runId: string;
    /** Replay persisted events after this seq before joining the live stream. Default 0. */
    afterSeq?: number;
  }

  export interface RunHandle {
    readonly runId: string;
    readonly sessionId: string;
    status(): RunStatus;
    /** Ordered from seq 1 (or afterSeq + 1 when reattached); ends after run.finished. */
    readonly events: AsyncIterable<RunEvent>;
    submit(command: RunCommand): Promise<void>;
    cancel(args?: { reason?: string }): void;
    readonly outcome: Promise<RunOutcome>;
  }
  ```
  Usage shape the whole family follows (documented in `packages/agents/README.md` now, implemented in p2):
  ```ts
  const agent = createAgent({ id: 'support', instructions: '...', model, tools: [readFile], store });
  const handle = run({ agent, session: 'sess-1', input: 'Summarize README.md' });
  for await (const event of handle.events) { /* ... */ }
  const outcome = await handle.outcome;
  ```

  `types/index.ts`
  ```ts
  export type * from './agent.js';
  export type * from './capability.js';
  export type * from './skills.js';
  export type * from './command.js';
  export type * from './event.js';
  export type * from './hooks.js';
  export type * from './limits.js';
  export type * from './message.js';
  export type * from './model.js';
  export type * from './outcome.js';
  export type * from './run.js';
  export type * from './schema.js';
  export type * from './store.js';
  export type * from './tool.js';
  ```

  `index.ts`
  ```ts
  export type * from './types/index.js';
  export { AgentError, ModelError, SchemaError, StoreError, type AgentErrorCode } from './errors.js';
  export { newId } from './ids.js';
  export { DEFAULT_LIMITS } from './agent/limits.js';
  export { textOf, toolCallsOf } from './message/helpers.js';
  export { ZERO_USAGE, addUsage } from './model/usage.js';
  export { assertSupportedSchema, validateSchema } from './schema/validate.js';
  export { createTool } from './tool/create-tool.js';
  export { createMemoryStore } from './store/memory.js';
  ```
  `testing.ts` re-exports `createFakeModel` and `createMemoryStore` (Task 6).

- **Validation:** `pnpm typecheck` clean. A type-level test `packages/agents/src/types/contracts.test-d.ts` (vitest `expectTypeOf`, run via the root `vitest run --typecheck`) asserts: `RunOutcome['status']` is exactly the five statuses; `RunEvent` has `seq: number`; `Store['runs']['appendEvent']` accepts a `RunEvent`; `Hooks['beforeTool']` accepts `(args: BeforeToolArgs) => BeforeToolResult` and rejects a handler typed over `AfterToolArgs`. `grep -l "^export const\|^export function" packages/agents/src/types/*.ts` prints nothing (decision 37).

### Task 3 - JSON Schema validator subset

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/types/schema.ts`
  - `CREATE: packages/agents/src/schema/validate.ts`
  - `CREATE: packages/agents/src/schema/validate.test.ts`
- **Reason:** decisions 5, 6, 27, 28. Runtime validation of model-supplied arguments is the executor's protection (spec "Tools and execution").
- **Integration points:** `createTool` calls `assertSupportedSchema` once; p2's loop calls `validateSchema` on every tool call and again after a `modify` hook decision.
- **Data contracts:**
  ```ts
  // types/schema.ts
  export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  export interface JsonSchema {
    type?: JsonSchemaType | JsonSchemaType[];
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: unknown[];
    const?: unknown;
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    nullable?: boolean;
  }

  export interface SchemaIssue { path: string; message: string }
  export type ValidationResult<T = unknown> = { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };
  ```
- **Code:**
  ```ts
  // schema/validate.ts
  import { SchemaError } from '../errors.js';
  import type { JsonSchema, SchemaIssue, ValidationResult } from '../types/schema.js';

  /** Keywords of the supported subset; `title`, `examples`, `$schema` are accepted and ignored. */
  export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set(Object.keys({
    type: 0, description: 0, properties: 0, required: 0, additionalProperties: 0, items: 0, enum: 0, const: 0,
    default: 0, minimum: 0, maximum: 0, minLength: 0, maxLength: 0, pattern: 0, minItems: 0, maxItems: 0,
    anyOf: 0, oneOf: 0, nullable: 0, title: 0, examples: 0, $schema: 0,
  } satisfies Record<string, 0>));

  /** Throws SchemaError('unsupported_keyword' | 'invalid_schema'). Called at createTool time. */
  export function assertSupportedSchema(args: { schema: JsonSchema; path?: string }): void {
    const path = args.path ?? '$';
    for (const key of Object.keys(args.schema)) {
      if (!SUPPORTED_KEYWORDS.has(key)) {
        throw new SchemaError({ code: 'unsupported_keyword', message: `${path}: unsupported keyword "${key}"` });
      }
    }
    if (args.schema.type === 'object' || args.schema.properties) {
      for (const [name, sub] of Object.entries(args.schema.properties ?? {})) {
        assertSupportedSchema({ schema: sub, path: `${path}.${name}` });
      }
    }
    if (args.schema.items) assertSupportedSchema({ schema: args.schema.items, path: `${path}[]` });
    for (const alt of [...(args.schema.anyOf ?? []), ...(args.schema.oneOf ?? [])]) {
      assertSupportedSchema({ schema: alt, path });
    }
  }

  export function validateSchema<T = unknown>(args: { schema: JsonSchema; value: unknown }): ValidationResult<T> {
    const issues: SchemaIssue[] = [];
    const value = check(args.schema, args.value, '$', issues);
    return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
  }

  function check(schema: JsonSchema, value: unknown, path: string, issues: SchemaIssue[]): unknown {
    if (value === undefined && schema.default !== undefined) return structuredClone(schema.default);
    if (value === null && (schema.nullable || typeOk(schema, null))) return null;
    if (schema.const !== undefined && !deepEqual(value, schema.const)) {
      issues.push({ path, message: `must equal ${JSON.stringify(schema.const)}` }); return value;
    }
    if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
      issues.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` }); return value;
    }
    if (schema.anyOf) {
      const hit = schema.anyOf.some((alt) => validateSchema({ schema: alt, value }).ok);
      if (!hit) issues.push({ path, message: 'matches none of anyOf' });
      return value;
    }
    if (schema.oneOf) {
      const hits = schema.oneOf.filter((alt) => validateSchema({ schema: alt, value }).ok).length;
      if (hits !== 1) issues.push({ path, message: `matches ${hits} of oneOf, expected 1` });
      return value;
    }
    if (schema.type && !typeOk(schema, value)) {
      issues.push({ path, message: `expected ${String(schema.type)}, got ${describe(value)}` }); return value;
    }
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: `shorter than ${schema.minLength}` });
      if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: `longer than ${schema.maxLength}` });
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push({ path, message: `does not match /${schema.pattern}/` });
      return value;
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `less than ${schema.minimum}` });
      if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `greater than ${schema.maximum}` });
      return value;
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, message: `fewer than ${schema.minItems} items` });
      if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, message: `more than ${schema.maxItems} items` });
      return schema.items ? value.map((v, i) => check(schema.items!, v, `${path}[${i}]`, issues)) : value;
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      const props = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (value[key] === undefined && props[key]?.default === undefined) issues.push({ path: `${path}.${key}`, message: 'required' });
      }
      for (const [key, sub] of Object.entries(props)) {
        const v = check(sub, value[key], `${path}.${key}`, issues);
        if (v !== undefined) out[key] = v;
      }
      for (const key of Object.keys(value)) {
        if (key in props) continue;
        if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: 'unexpected property' });
        else out[key] = value[key];
      }
      return out;
    }
    return value;
  }

  function typeOk(schema: JsonSchema, value: unknown): boolean {
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (types.length === 0) return true;
    return types.some((t) => {
      switch (t) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'null': return value === null;
        case 'object': return isPlainObject(value);
        case 'array': return Array.isArray(value);
      }
    });
  }
  function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
  function describe(v: unknown): string {
    return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  }
  function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  ```
- **Validation:** `validate.test.ts` covers: required missing; wrong type (no coercion: `"3"` vs integer fails); default applied; `additionalProperties: false` rejects; nested object path in issue (`$.user.age`); array items; enum/const; anyOf/oneOf counts; nullable; `assertSupportedSchema` throws `unsupported_keyword` for `$ref` and `patternProperties`. Run `pnpm --filter @facio/agents test`.

### Task 4 - `createTool`

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/tool/create-tool.ts`
  - `CREATE: packages/agents/src/tool/create-tool.test.ts`
- **Reason:** decision 4; the only way to build a tool. Validates the definition once so the loop never meets a bad schema.
- **Integration points:** `Tool.toModelDefinition()` is what `openaiCompat` maps to `tools[].function`; `Tool.effects` is read by `run()` in p2 (`destructive` → `beforeTool` default decision is `approval` when no hook is set; see p2 plan) and later by code mode.
- **Code:**
  ```ts
  import { AgentError } from '../errors.js';
  import { assertSupportedSchema } from '../schema/validate.js';
  import type { ModelToolDefinition, Tool, ToolDefinition, ToolEffects } from '../types/tool.js';

  const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  export function createTool<Input = unknown, Resources = Record<string, unknown>>(
    options: ToolDefinition<Input, Resources>,
  ): Tool<Input, Resources> {
    if (!NAME_PATTERN.test(options.name)) {
      throw new AgentError({ code: 'invalid_options', message: `tool name "${options.name}" must match ${NAME_PATTERN}` });
    }
    if (!options.description.trim()) {
      throw new AgentError({ code: 'invalid_options', message: `tool "${options.name}" needs a description` });
    }
    if (options.input.type !== 'object') {
      throw new AgentError({ code: 'invalid_options', message: `tool "${options.name}": input schema must have type "object"` });
    }
    assertSupportedSchema({ schema: options.input });
    const effects: ToolEffects = { ...options.effects };
    const definition: ModelToolDefinition = { name: options.name, description: options.description, input: options.input };
    return Object.freeze({
      ...options,
      effects,
      source: 'agent',
      toModelDefinition: () => definition,
    });
  }
  ```
  Example use (goes into `packages/agents/README.md`):
  ```ts
  const echo = createTool<{ text: string }>({
    name: 'echo',
    description: 'Return the text unchanged',
    input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    effects: { reads: true },
    execute: (input) => input.text,
  });
  ```
- **Validation:** `create-tool.test.ts`: name pattern rejected (`"bad name"`), empty description rejected, non-object schema rejected, `$ref` rejected via `unsupported_keyword`, `toModelDefinition()` returns the three fields only, result is frozen, `effects` defaults to `{}`, `source` is `'agent'`.

### Task 5 - In-memory store

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/store/memory.ts`
  - `CREATE: packages/agents/src/store/memory.test.ts`
- **Reason:** decisions 8, 24, 25, 34. The reference implementation of `Store` that p2 tests run against and p3's file store must match.
- **Integration points:** default store resolved by `createAgent` (p2). Exported from both `@facio/agents` and `@facio/agents/testing`.
- **Code:**
  ```ts
  import { StoreError } from '../errors.js';
  import type { RunEvent } from '../types/event.js';
  import type { Message } from '../types/message.js';
  import type { KvScope, PendingRequest, RunRecord, RunRef, SessionRecord, StepRecord, Store } from '../types/store.js';

  export function createMemoryStore(): Store {
    const sessions = new Map<string, SessionRecord & { messages: Message[] }>();
    const runs = new Map<string, RunRecord & { events: RunEvent[]; steps: StepRecord[] }>();
    const requests = new Map<string, PendingRequest>();
    /** One entry map per kv scope, keyed "agent:<agentId>", "shared:<namespace>" or "workspace:<workspace>". */
    const scopes = new Map<string, Map<string, unknown>>();
    const now = () => new Date().toISOString();

    /** Runs are keyed by runId here; the sessionId check mirrors the file store, which can only find a run through its session. */
    const requireRun = (ref: RunRef) => {
      const run = runs.get(ref.runId);
      if (!run || run.sessionId !== ref.sessionId) {
        throw new StoreError({ code: 'not_found', message: `run ${ref.runId} in session ${ref.sessionId}` });
      }
      return run;
    };
    const requireSession = (sessionId: string) => {
      const s = sessions.get(sessionId);
      if (!s) throw new StoreError({ code: 'not_found', message: `session ${sessionId}` });
      return s;
    };
    const requireWriter = (sessionId: string, runId: string) => {
      const s = requireSession(sessionId);
      if (s.activeWriterRunId !== runId) {
        throw new StoreError({ code: 'writer_mismatch', message: `run ${runId} is not the writer of session ${sessionId}` });
      }
      return s;
    };

    return {
      sessions: {
        async get({ sessionId }) { return sessions.get(sessionId); },
        async create({ sessionId, agentId, workspace }) {
          const record: SessionRecord & { messages: Message[] } = {
            sessionId,
            agentId,
            ...(workspace !== undefined ? { workspace } : {}),
            createdAt: now(),
            updatedAt: now(),
            messages: [],
          };
          sessions.set(sessionId, record);
          return stripSession(record);
        },
        async list({ workspace, agentId, limit }) {
          const all = [...sessions.values()]
            .filter((s) => (workspace === undefined || s.workspace === workspace) && (agentId === undefined || s.agentId === agentId))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
            .map(stripSession);
          return limit ? all.slice(0, limit) : all;
        },
        async appendMessages({ sessionId, runId, messages }) {
          const s = requireWriter(sessionId, runId);
          s.messages.push(...messages.map((m) => structuredClone(m)));
          s.updatedAt = now();
        },
        async listMessages({ sessionId, limit }) {
          const all = requireSession(sessionId).messages;
          return structuredClone(limit ? all.slice(-limit) : all);
        },
        async claimWriter({ sessionId, runId }) {
          const s = requireSession(sessionId);
          if (s.activeWriterRunId && s.activeWriterRunId !== runId) return false;
          s.activeWriterRunId = runId;
          return true;
        },
        async releaseWriter({ sessionId, runId }) {
          const s = requireSession(sessionId);
          if (s.activeWriterRunId === runId) delete s.activeWriterRunId;
        },
      },
      runs: {
        async create(record) {
          requireSession(record.sessionId);
          runs.set(record.runId, { ...record, events: [], steps: [] });
        },
        async get(ref) {
          const r = runs.get(ref.runId);
          return r && r.sessionId === ref.sessionId ? stripRun(r) : undefined;
        },
        async update({ sessionId, runId, status, pendingRequestId }) {
          const r = requireRun({ sessionId, runId });
          r.status = status;
          r.updatedAt = now();
          if (pendingRequestId === undefined) delete r.pendingRequestId; else r.pendingRequestId = pendingRequestId;
        },
        async appendEvent(event) {
          const r = requireRun(event);
          const expected = (r.events.at(-1)?.seq ?? 0) + 1;
          if (event.seq !== expected) {
            throw new StoreError({ code: 'seq_gap', message: `run ${event.runId}: expected seq ${expected}, got ${event.seq}` });
          }
          r.events.push(structuredClone(event));
        },
        async listEvents({ sessionId, runId, afterSeq = 0 }) {
          return structuredClone(requireRun({ sessionId, runId }).events.filter((e) => e.seq > afterSeq));
        },
        async appendStep(step) { requireRun(step).steps.push(structuredClone(step)); },
        async updateStep({ sessionId, runId, invocationId, patch }) {
          const r = requireRun({ sessionId, runId });
          const i = r.steps.findIndex((s) => s.invocationId === invocationId);
          if (i < 0) throw new StoreError({ code: 'not_found', message: `step ${invocationId}` });
          r.steps[i] = { ...r.steps[i], ...patch } as StepRecord;
        },
        async listSteps(ref) { return structuredClone(requireRun(ref).steps); },
      },
      requests: {
        async create(request) {
          requireRun(request);
          requests.set(request.requestId, structuredClone(request));
        },
        async get({ sessionId, runId, requestId }) {
          const r = requests.get(requestId);
          return r && r.sessionId === sessionId && r.runId === runId ? structuredClone(r) : undefined;
        },
        async resolve({ sessionId, runId, requestId, resolution }) {
          const r = requests.get(requestId);
          if (!r || r.sessionId !== sessionId || r.runId !== runId) {
            throw new StoreError({ code: 'not_found', message: `request ${requestId} in run ${runId}` });
          }
          r.resolution = resolution;
          r.resolvedAt = now();
        },
      },
      kv(scope) {
        const scopeKey =
          scope.kind === 'agent' ? `agent:${scope.agentId}`
          : scope.kind === 'shared' ? `shared:${scope.namespace}`
          : `workspace:${scope.workspace}`;
        let entries = scopes.get(scopeKey);
        if (!entries) {
          entries = new Map();
          scopes.set(scopeKey, entries);
        }
        const map = entries;
        return {
          async get<T = unknown>(key: string) { return structuredClone(map.get(key)) as T | undefined; },
          async set(key, value) { map.set(key, structuredClone(value)); },
          async delete(key) { map.delete(key); },
          async list(prefix = '') { return [...map.keys()].filter((k) => k.startsWith(prefix)); },
        } satisfies KvScope;
      },
    };

    function stripRun(r: RunRecord & { events: unknown; steps: unknown }): RunRecord {
      const { events: _e, steps: _s, ...rest } = r;
      return structuredClone(rest);
    }
    function stripSession(s: SessionRecord & { messages: unknown }): SessionRecord {
      const { messages: _m, ...rest } = s;
      return structuredClone(rest);
    }
  }
  ```
- **Validation:** `memory.test.ts`: `appendMessages` without claim throws `writer_mismatch`; second `claimWriter` from another run returns false; `releaseWriter` then claim succeeds; `appendEvent` seq 1 ok, seq 3 throws `seq_gap`, `listEvents({ sessionId, runId, afterSeq: 1 })` returns from 2; `runs.get` with the right `runId` but another `sessionId` returns `undefined`, `runs.update` with it throws `not_found`; `sessions.create` without `workspace` stores no `workspace` key; `sessions.list({ workspace: 'a' })` returns only sessions created with that workspace, newest `updatedAt` first, and `sessions.get` never exposes `messages`; `kv` agent, shared and workspace scopes do not see each other; two `kv()` calls with the same scope share entries; values are cloned on write and on read (mutating the object returned by `kv.get` does not change a second `get`, same for `listMessages` / `runs.get`).

### Task 6 - Fake model

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/testing/fake-model.ts`
  - `CREATE: packages/agents/src/testing/fake-model.test.ts`
  - `CREATE: packages/agents/src/testing.ts`
- **Reason:** spec build step 1 "a deterministic fake model for tests"; p2 proves the loop with it.
- **Integration points:** implements `ModelAdapter`; exported at `@facio/agents/testing`.
- **Code:**
  ```ts
  import { ModelError } from '../errors.js';
  import { newId } from '../ids.js';
  import type { Message } from '../types/message.js';
  import type { ModelAdapter, ModelFeatures, ModelReply, ModelRequest, Usage } from '../types/model.js';

  export type FakeStep =
    | { text: string; usage?: Usage }
    | { toolCalls: { name: string; input: unknown; callId?: string }[]; text?: string; usage?: Usage }
    | { error: { code: 'server' | 'rate_limit' | 'network'; message?: string; retryable?: boolean } }
    | { rawToolCall: { name: string; raw: string; callId?: string } };

  export interface FakeModel extends ModelAdapter {
    /** Every request received, in order, with the signal removed. */
    readonly requests: Omit<ModelRequest, 'signal'>[];
    /** Steps left in the script. */
    remaining(): number;
  }

  export function createFakeModel(options: { script: FakeStep[]; features?: Partial<ModelFeatures>; modelId?: string }): FakeModel {
    const script = [...options.script];
    const requests: Omit<ModelRequest, 'signal'>[] = [];
    const usage0: Usage = { inputTokens: 1, outputTokens: 1 };
    return {
      id: `fake:${options.modelId ?? 'fake'}`,
      modelId: options.modelId ?? 'fake',
      features: { tools: true, streaming: false, images: false, structuredOutput: false, ...options.features },
      requests,
      remaining: () => script.length,
      async complete(request) {
        const { signal: _s, ...rest } = request;
        requests.push(structuredClone(rest));
        if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'aborted before fake reply' });
        const step = script.shift();
        if (!step) throw new ModelError({ code: 'invalid_response', message: 'fake model script exhausted' });
        if ('error' in step) {
          throw new ModelError({ code: step.error.code, message: step.error.message ?? step.error.code, retryable: step.error.retryable ?? false });
        }
        const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts: [] };
        if ('rawToolCall' in step) {
          message.parts.push({ type: 'toolCall', callId: step.rawToolCall.callId ?? newId(), name: step.rawToolCall.name, input: undefined, raw: step.rawToolCall.raw });
          return { message, usage: usage0, finish: 'tool_calls' } satisfies ModelReply;
        }
        if (step.text) message.parts.push({ type: 'text', text: step.text });
        if ('toolCalls' in step) {
          for (const c of step.toolCalls) {
            message.parts.push({ type: 'toolCall', callId: c.callId ?? newId(), name: c.name, input: c.input, raw: JSON.stringify(c.input) });
          }
          return { message, usage: step.usage ?? usage0, finish: 'tool_calls' };
        }
        return { message, usage: step.usage ?? usage0, finish: 'stop' };
      },
    };
  }
  ```
  `testing.ts`:
  ```ts
  export { createFakeModel, type FakeModel, type FakeStep } from './testing/fake-model.js';
  export { createMemoryStore } from './store/memory.js';
  ```
- **Validation:** `fake-model.test.ts`: script consumed in order; `requests` records instructions/messages/tools; exhausted script throws `invalid_response`; `error` step throws `ModelError` with the given code; `rawToolCall` yields `input: undefined`; aborted signal throws `aborted`.

### Task 7 - Chat Completions adapter

- **Layer:** `@facio/model-openai-compat`
- **Files:**
  - `CREATE: packages/model-openai-compat/src/index.ts`
  - `CREATE: packages/model-openai-compat/src/wire.ts`
  - `CREATE: packages/model-openai-compat/src/index.test.ts`
- **Reason:** spec build step 1; decisions 13, 31, 32, 33. Covers OpenRouter (`https://openrouter.ai/api/v1`, bearer key) and LM Studio (`http://localhost:1234/v1`, no key) by configuration only.
- **Integration points:** implements `ModelAdapter` from `@facio/agents`; `examples/agents/adapter-smoke.ts` uses it; p2 passes it as `model` to `createAgent`.
- **Data contracts:** `ModelAdapter`, `ModelRequest`, `ModelReply`, `Message`, `ToolCallPart` from `@facio/agents`.
- **Code:**

  `wire.ts`
  ```ts
  import { newId, type Message, type ModelRequest, type ModelReply, type FinishReason, type ContentPart } from '@facio/agents';

  export interface WireMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | { type: 'text'; text: string }[] | { type: 'image_url'; image_url: { url: string } }[] | null;
    tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    tool_call_id?: string;
    name?: string;
  }

  export function toWireMessages(request: ModelRequest, features: { images: boolean }): WireMessage[] {
    const out: WireMessage[] = [{ role: 'system', content: request.instructions }];
    for (const m of request.messages) {
      if (m.role === 'tool') {
        for (const p of m.parts) {
          if (p.type === 'toolResult') out.push({ role: 'tool', tool_call_id: p.callId, name: p.name, content: p.content });
        }
        continue;
      }
      if (m.role === 'assistant') {
        const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
        const calls = m.parts.filter((p): p is Extract<ContentPart, { type: 'toolCall' }> => p.type === 'toolCall');
        out.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.callId, type: 'function' as const, function: { name: c.name, arguments: c.raw } })) } : {}),
        });
        continue;
      }
      // user / system messages
      const parts: WireMessage['content'] = [];
      for (const p of m.parts) {
        if (p.type === 'text') (parts as { type: 'text'; text: string }[]).push({ type: 'text', text: p.text });
        else if (p.type === 'image') {
          if (!features.images) throw new Error('image part not supported by this model'); // wrapped into ModelError by caller
          (parts as { type: 'image_url'; image_url: { url: string } }[]).push({ type: 'image_url', image_url: { url: p.url ?? `data:${p.mimeType};base64,${p.data}` } });
        }
      }
      out.push({ role: m.role === 'system' ? 'system' : 'user', content: parts.length === 1 && (parts[0] as { type: string }).type === 'text' ? (parts[0] as { text: string }).text : parts });
    }
    return out;
  }

  export function toWireTools(request: ModelRequest) {
    return request.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.input } }));
  }

  export interface WireResponse {
    choices?: { message?: WireMessage; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  }

  export function fromWireResponse(body: WireResponse): ModelReply {
    const choice = body.choices?.[0];
    if (!choice?.message) throw new Error('response has no choices[0].message');
    const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts: [] };
    const content = choice.message.content;
    if (typeof content === 'string' && content) message.parts.push({ type: 'text', text: content });
    for (const call of choice.message.tool_calls ?? []) {
      let input: unknown;
      try { input = JSON.parse(call.function.arguments || '{}'); } catch { input = undefined; }
      message.parts.push({ type: 'toolCall', callId: call.id || newId(), name: call.function.name, input, raw: call.function.arguments ?? '' });
    }
    const finish = mapFinish(choice.finish_reason, message.parts.some((p) => p.type === 'toolCall'));
    return {
      message,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        ...(body.usage?.prompt_tokens_details?.cached_tokens !== undefined ? { cacheReadTokens: body.usage.prompt_tokens_details.cached_tokens } : {}),
      },
      finish,
      raw: body,
    };
  }

  function mapFinish(reason: string | undefined, hasToolCalls: boolean): FinishReason {
    if (hasToolCalls) return 'tool_calls';
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'content_filter': return 'content_filter';
      case 'tool_calls': return 'tool_calls';
      default: return 'other';
    }
  }
  ```

  `index.ts`
  ```ts
  import { ModelError, type ModelAdapter, type ModelFeatures, type ModelParams, type ModelRequest } from '@facio/agents';
  import { fromWireResponse, toWireMessages, toWireTools, type WireResponse } from './wire.js';

  export interface OpenAICompatOptions {
    baseUrl: string;               // e.g. 'http://localhost:1234/v1' or 'https://openrouter.ai/api/v1'
    model: string;                 // provider model id
    apiKey?: string;
    headers?: Record<string, string>;
    features?: Partial<ModelFeatures>;
    params?: ModelParams;
    retries?: number;              // default 2, on 429 and 5xx
    fetch?: typeof fetch;          // injection for tests
  }

  export function openaiCompat(options: OpenAICompatOptions): ModelAdapter {
    const features: ModelFeatures = { tools: true, streaming: false, images: false, structuredOutput: false, ...options.features };
    const doFetch = options.fetch ?? fetch;
    const retries = options.retries ?? 2;
    const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

    return {
      id: `openai-compat:${options.model}`,
      modelId: options.model,
      features,
      async complete(request: ModelRequest) {
        if (request.tools.length > 0 && !features.tools) {
          throw new ModelError({ code: 'unsupported_feature', message: `${options.model} does not support tools` });
        }
        let messages;
        try { messages = toWireMessages(request, features); }
        catch (e) { throw new ModelError({ code: 'unsupported_feature', message: (e as Error).message, cause: e }); }
        const params = { ...options.params, ...request.params };
        const body = {
          model: options.model,
          messages,
          ...(request.tools.length ? { tools: toWireTools(request), tool_choice: 'auto' } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(params.topP !== undefined ? { top_p: params.topP } : {}),
          ...(params.maxOutputTokens !== undefined ? { max_tokens: params.maxOutputTokens } : {}),
          ...(params.stop ? { stop: params.stop } : {}),
          ...(params.seed !== undefined ? { seed: params.seed } : {}),
          stream: false,
        };
        const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
        if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

        for (let attempt = 0; ; attempt++) {
          let res: Response;
          try {
            res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal });
          } catch (e) {
            if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'request aborted', cause: e });
            if (attempt < retries) { await backoff(attempt, request.signal); continue; }
            throw new ModelError({ code: 'network', message: `fetch failed: ${(e as Error).message}`, cause: e, retryable: true });
          }
          if (res.ok) {
            let json: WireResponse;
            try { json = (await res.json()) as WireResponse; }
            catch (e) { throw new ModelError({ code: 'invalid_response', message: 'response is not JSON', cause: e }); }
            try { return fromWireResponse(json); }
            catch (e) { throw new ModelError({ code: 'invalid_response', message: (e as Error).message, detail: json, cause: e }); }
          }
          const text = await res.text().catch(() => '');
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attempt < retries) { await backoff(attempt, request.signal); continue; }
          throw new ModelError({
            code: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'invalid_response',
            message: `${res.status} from ${url}: ${text.slice(0, 500)}`,
            status: res.status,
            retryable,
            detail: text,
          });
        }
      },
    };
  }

  async function backoff(attempt: number, signal: AbortSignal): Promise<void> {
    const ms = 500 * 2 ** attempt;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new ModelError({ code: 'aborted', message: 'aborted during backoff' })); }, { once: true });
    });
  }
  ```
- **Validation:** `index.test.ts` with an injected `fetch` stub: request body has `system` first, user text as string, assistant `tool_calls` with `raw` arguments, `tool` messages with `tool_call_id`; response with `tool_calls` maps to `toolCall` parts and `finish: 'tool_calls'`; arguments `"{not json"` → `input: undefined`, `raw` preserved, no throw; usage mapped incl. `cached_tokens`; `429` then `200` succeeds with 2 fetch calls; `401` throws `ModelError{code:'auth'}` with one call; `500` × 3 throws `server` after 3 calls; aborted signal throws `aborted`; image part with `features.images: false` throws `unsupported_feature` before any fetch; `tools` non-empty with `features.tools: false` throws `unsupported_feature`. Run `pnpm --filter @facio/model-openai-compat test`.

### Task 8 - Adapter smoke example

- **Layer:** examples
- **Files:**
  - `CREATE: examples/agents/adapter-smoke.ts`
  - `CREATE: examples/README.md`
- **Reason:** first "harness uses the agent" host, even before the loop exists; proves the adapter against a real local model and is the template every later example copies.
- **Integration points:** `openaiCompat` + one `createTool`; no store, no loop.
- **Code:**
  ```ts
  import { createTool, newId, textOf, toolCallsOf } from '@facio/agents';
  import { openaiCompat } from '@facio/model-openai-compat';

  const model = openaiCompat({
    baseUrl: process.env.FACIO_BASE_URL ?? 'http://localhost:1234/v1',
    model: process.env.FACIO_MODEL ?? 'qwen/qwen3-8b',
    ...(process.env.FACIO_API_KEY ? { apiKey: process.env.FACIO_API_KEY } : {}),
    features: { tools: true },
  });

  const now = createTool({
    name: 'now',
    description: 'Current time in ISO 8601',
    input: { type: 'object', properties: {}, additionalProperties: false },
    effects: { reads: true },
    execute: () => new Date().toISOString(),
  });

  const reply = await model.complete({
    instructions: 'Answer briefly. Use the now tool if the user asks the time.',
    messages: [{ id: newId(), role: 'user', source: 'input', createdAt: new Date().toISOString(), parts: [{ type: 'text', text: 'What time is it?' }] }],
    tools: [now.toModelDefinition()],
    params: { temperature: 0 },
    signal: AbortSignal.timeout(60_000),
  });

  console.log('finish:', reply.finish, 'usage:', reply.usage);
  console.log('text:', textOf(reply.message));
  console.log('tool calls:', toolCallsOf(reply.message).map((c) => `${c.name}(${c.raw})`));
  ```
  `examples/README.md` lists the env vars (`FACIO_BASE_URL`, `FACIO_MODEL`, `FACIO_API_KEY`) and the two known-good targets: LM Studio (no key) and OpenRouter (`https://openrouter.ai/api/v1`, key).
- **Validation:** manual. With LM Studio running a tool-capable model, `pnpm --filter facio-agents-examples smoke` prints `finish: tool_calls` and one `now({})` call. With `FACIO_MODEL` set to a non-tool model, the same script prints `finish: stop` and a text answer; neither run throws.

## Cross-layer consistency

| Shape | Source | Consumers in this phase |
| --- | --- | --- |
| `Message`, `ContentPart` | `packages/agents/src/types/message.ts` | `message/helpers.ts`, fake model, `wire.ts` |
| `ModelAdapter`, `ModelRequest`, `ModelReply`, `Usage` | `packages/agents/src/types/model.ts` | `model/usage.ts`, fake model, `openaiCompat` |
| `Tool`, `ToolDefinition`, `ToolExecute`, `ModelToolDefinition`, `JsonSchema` | `packages/agents/src/types/tool.ts`, `types/schema.ts` | `tool/create-tool.ts`, `schema/validate.ts`, `openaiCompat` (`toWireTools`), example |
| `Store` and records, `RunRef`, `KvScope`, `KvScopeKey` | `packages/agents/src/types/store.ts` | `store/memory.ts`; p3 `@facio/store-file` |
| `Limits` | `packages/agents/src/types/limits.ts` | `agent/limits.ts` |
| `Capability`, `CapabilityArgs` | `packages/agents/src/types/capability.ts` | type tests only; p2 resolves them, p3 `skills()` and later `@facio/tools-mcp` produce them |
| `SkillIndexEntry`, `SkillSource` | `packages/agents/src/types/skills.ts` | type tests only; p3 `capabilities/skills.ts` consumes, `@facio/store-file` `fileSkillSource` implements |
| `RunEvent`, `RunCommand`, `RunOutcome`, `Hooks` + `*Args` / `*Result`, `Agent*`, `RunArgs`, `RunHandle` | `packages/agents/src/types/{event,command,outcome,hooks,agent,run}.ts` | type tests only; p2 |

`@facio/model-openai-compat` declares `@facio/agents` as a peer dependency and imports only from its package root.

## Risks and tradeoffs

- `exactOptionalPropertyTypes` makes the `...(x !== undefined ? {x} : {})` spreads necessary; it is the price of never storing `undefined` fields in records that will be serialized in p3.
- The adapter sends `tool_choice: 'auto'` whenever tools are present; LM Studio models that do not support tools ignore it, OpenRouter models that do not support tools return 4xx which surfaces as `invalid_response`. `features.tools: false` avoids the round trip and is the documented fix.
- No streaming means `AbortSignal` cancels only between attempts and at the HTTP layer; acceptable until p5.

## Resume state

- **Done so far (2026-09-15):** Tasks 1-8 built, then the review round applied (decisions 41-45: `already_exists`, `invalid_schema` value checks, array `content`, `ModelProvider` catalog + `openaiCompatProvider`, reasoning part/feature/params/usage); `pnpm check` from a dist-less tree: build, typecheck (3 workspaces), 77 tests (71 runtime + 6 type-level) green, 0 type errors.
  Evidence: `packages/agents/src/{ids,errors,index,testing}.ts`, `types/*.ts` (16 files + `contracts.test-d.ts`), `agent/limits.ts`, `message/helpers.ts`, `model/usage.ts`, `schema/validate{,.test}.ts`, `tool/create-tool{,.test}.ts`, `store/memory{,.test}.ts`, `testing/fake-model{,.test}.ts`; `packages/model-openai-compat/src/{index,wire,index.test}.ts`; `examples/agents/adapter-smoke.ts`; READMEs in root, both packages and `examples/`.
  Deviations from the plan's code blocks, each proven by a failing check: (a) `schema/validate.ts` `check()` returns early for an absent value (the plan's version type-checked `undefined` and rejected any absent optional property without a default, and doubled the `required` issue); (b) `store/memory.ts` `sessions.get` strips `messages` (the plan's validation demanded it, its code did not), `runs.create` / `updateStep` / `requests.resolve` clone their inputs; (c) `openaiCompat` `backoff()` checks `signal.aborted` up front and removes its listener on resolve; (d) root `build` filter is `"./packages/**"` in escaped double quotes (`'./packages/*'` matched nothing, and single quotes are literal under cmd.exe); (e) decisions 39-40 (build-first scripts, explicit vitest projects + `tsconfig.test.json`).
- **Next action:** none; phase shipped 2026-09-15 (smoke run confirmed by the user). p2 starts at Task 1 of 01-harness-core-p2-loop.md.
- **Open questions:** none.
- **Watch out for:** Node 22 `--experimental-strip-types` cannot run `.ts` files that use `enum` or parameter properties; the example uses neither. `structuredClone` of a `Message` containing `undefined` `input` keeps the key; the file store in p3 serializes with `JSON.stringify`, which drops it, so p3 re-runs this phase's store tests. `CLAUDE.md` still describes `pnpm typecheck` as plain `tsc --noEmit`; it builds first now (decision 39). vitest 2 workspace `typecheck` is experimental: pin `vitest` before upgrading and re-run the flipped-assertion check (`expectTypeOf(wrong).toMatchTypeOf` must fail) after any bump.

## Final verification checklist

- [x] `pnpm install`, `pnpm typecheck`, `pnpm test` clean at the repo root (2026-09-15, via `pnpm check`).
- [x] `packages/agents` has no `dependencies`.
- [x] Every contract file in Task 2 exists with the listed exports, `types/index.ts` re-exports each one, and `index.ts` re-exports the barrel plus every runtime symbol.
- [x] No file under `packages/agents/src/types/` exports a runtime value (decision 37).
- [x] Validator rejects unsupported keywords at `createTool` time and never coerces types.
- [x] Memory store enforces `seq_gap` and `writer_mismatch`, rejects run-level calls whose `sessionId` does not own the run, and lists sessions by workspace.
- [x] Fake model and `openaiCompat` both satisfy `ModelAdapter` (type test) and their unit tests pass.
- [x] `examples/agents/adapter-smoke.ts` runs against a real model (user-confirmed 2026-09-15).
- [x] `index.md` status for 01-p1 updated (`Shipped` 2026-09-15).
