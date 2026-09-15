<!--
Domain: agent
Status: Shipped
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-15
Dependencies: ./01-harness-core-p1-contracts.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p2 - Serial loop and run handle

_Status: Shipped · Priority: High · Created: 2026-09-13 · Planned in full: 2026-09-15 · Built: 2026-09-15_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 2: "Implement the bounded serial loop with argument validation, cancellation, and ordered events. Prove a model can request a tool, receive its result, and produce a final answer."

## Goal

After this phase `createAgent({...})` returns a frozen `Agent` and `run({ agent, session, input })` executes one turn: it claims the session, resolves capabilities, loops model step → tool calls → model step until a final answer or a limit, persists every message, step and event through the `Store`, and exposes the turn through a `RunHandle` (ordered events, `submit`, `cancel`, `outcome`).
The fake model plus one tool produce a `completed` outcome with events `seq 1..n` and a reconstructible transcript.
Approvals pause the run as `awaiting`; resuming is p3.

## Reconnaissance

### Files read

- `packages/agents/src/types/{agent,run,hooks,event,outcome,command,store,tool,capability,model,message}.ts` - the p1 contracts this phase implements; every symbol used below exists there unless this plan says `UPDATE`.
- `packages/agents/src/store/memory.ts` - `already_exists` on `create`, `writer_mismatch` on `appendMessages`, `seq_gap` on `appendEvent`, `RunRef` on every run-level call; the loop is written against these semantics.
- `packages/agents/src/schema/validate.ts` - `validateSchema` returns `{ ok, value }` with defaults applied; the loop executes tools with `value`, never with the raw input.
- `packages/agents/src/testing/fake-model.ts` - `FakeStep` shapes (`text`, `toolCalls`, `rawToolCall`, `error`) drive every loop test.
- `packages/model-openai-compat/src/wire.ts:15-50` - `toWireMessages` sends one wire `tool` message per `toolResult` part and ignores `reasoning` parts; decision 54 (one tool message per result) keeps the transcript and the wire shape aligned.
- `roadmap/specs/agent-harness-spec.md` "Turn lifecycle", "Events versus hooks", "Tools and execution", "Persistence and recovery".
- OpenAI Agents SDK (public docs, run loop) - step outcomes as a discriminated union driving the outer loop; the same idea is `ToolCallResult` (`result | approval | aborted`) in Task 5.
- OpenAI Agents SDK (public docs, human-in-the-loop) - approval resolution order: remembered decision → `needsApproval` → pause; mirrored by decision 46/63.

### Searches performed

- `rg "hook_error|capability_error|writer_busy" packages/agents/src` - only `hook_error` exists; the other two are added here.
- `rg "structuredClone" packages/agents/src/store/memory.ts` - every read returns a clone, so the loop may mutate what it reads without corrupting the store.

### Runtime path

```
host → createAgent(options) → Agent (frozen value)
     → run({ agent, session, workspace?, input, signal? }) → RunHandle (returned synchronously)
        └ execute():  sessions.get|create → runs.create → claimWriter → capabilities → append input → run.started
                      loop: assembleRequest → beforeModel → model.complete → afterModel → append reply → model.completed
                            → per toolCall: handleToolCall → append toolResult → tool.* events
                      finish: runs.update(status) → releaseWriter (not for awaiting) → run.finished → handle closes
```

### Existing patterns to reuse

- `packages/agents/src/tool/create-tool.ts` - option validation with `AgentError('invalid_options')` and `Object.freeze` on the result; `createAgent` follows it.
- `packages/agents/src/store/memory.ts:10-14` - `now()` helper and ISO timestamps; the loop uses the same.

### Gaps

- `Not found: any loop, run handle, or context assembler - searched "run(" and "assemble" in packages/agents/src.` Written here.
- `RunInfo` has no `kv`; `RunCommand.approve` has no `input`; `AgentOptions` has no `policy` or `warn`; `AgentErrorCode` lacks `capability_error`, `writer_busy`, `internal`. All `UPDATE`d in Task 1.

## Decisions locked in

Rows 1-45 (parent and p1) apply. Additional rows for this phase:

| # | Decision | Rationale / source |
| --- | --- | --- |
| 46 | **Policy floor + hook.** `AgentOptions.policy?: Policy` with `requireApproval(args: { tool; input; run }): boolean \| Promise<boolean>`; default `tool.effects.destructive === true`. Order per call: validate → `hooks.beforeTool` → if the hook says `deny` stop there; else `needsApproval = hookDecision === 'approval' \|\| await policy.requireApproval(...)`; an `allow` from the hook never bypasses the policy. The remembered "always approve" (decision 63) is consulted after that and only skips the pause | User (2026-09-15); spec "the runtime must enforce the final authorization decision" |
| 47 | **Writer busy → refuse.** `run()` creates the `RunRecord`, then `claimWriter`; when the claim fails the run finishes as `failed { code: 'writer_busy' }` with a `run.finished` event and no transcript change. No queueing | User (2026-09-15) |
| 48 | **`approve` carries an optional edited input.** `RunCommand` `approve` becomes `{ type: 'approve'; requestId; input?: unknown; alwaysApprove?: boolean }`. The contract lands here; p3 executes it (re-validates `input` against the tool schema, same path as a `modify` decision) | User (2026-09-15) |
| 49 | **Hooks get kv.** `RunInfo` gains `kv: { agent: KvScope; shared: KvScope; workspace?: KvScope }`, the same object as `ToolContext.kv` and `CapabilityArgs.kv` | User (2026-09-15) |
| 50 | One-time memory-store warning goes to `AgentOptions.warn?: (message: string) => void`, default `console.warn`; emitted once per process (module-level flag) | (defaulted) |
| 51 | Shared kv namespace: `AgentOptions.sharedNamespace?: string`, default `'default'`. `kv.shared = store.kv({ kind: 'shared', namespace })` | (defaulted: decision 8 names the scope, not the namespace) |
| 52 | `AgentOptions.id` and `Capability.id` must match the tool-name pattern `/^[a-zA-Z0-9_-]{1,64}$/`; both end up in file paths and prompt headings | (defaulted) |
| 53 | Every run has a record. `runs.create` happens before the writer claim; a run that cannot start still gets `runs.update({ status: 'failed' })` and a `run.finished` event, so `RunHandle.events` always ends with `run.finished` | (defaulted: keeps the handle contract unconditional) |
| 54 | One `role: 'tool'` message per tool result, appended right after that call settles, `source: 'tool'`. A paused batch therefore leaves earlier results in the transcript and later ones absent; p3's resume appends the rest | (defaulted: matches `toWireMessages` and keeps resume simple) |
| 55 | `tool.denied` covers: unknown tool, invalid arguments (including `input: undefined` from an unparsable argument string), a `modify` whose new input fails validation, a `deny` from the hook, and calls skipped by `max_tool_calls`. Each emits `tool.denied { reason }` and appends an error tool result whose `content` is the reason; the executor never runs; the run continues (except the limit case) | Spec "execute or report a denial/error as a tool result" |
| 56 | `maxToolCalls`: before executing each call, if `toolCalls >= limits.maxToolCalls` the remaining calls of the batch are denied with reason `max_tool_calls`, their results appended, then the run ends `stopped { reason: 'max_tool_calls' }`. `maxSteps` is checked before each model step → `stopped { reason: 'max_steps' }` | (defaulted: every proposed call gets a result so the transcript stays model-valid) |
| 57 | Abort reasons are typed: the run's `AbortController` is aborted with `{ kind: 'cancel'; reason?: string }` (from `RunArgs.signal`, `handle.cancel`, or `submit({ type: 'cancel' })`) or `{ kind: 'timeout' }` (from `limits.timeoutMs`). `timeout` → `stopped { reason: 'timeout' }`; `cancel` → `cancelled { reason }`. A tool execution races against the abort; when the abort wins, the tool step is marked `uncertain` and the loop does not wait for the executor | Spec "Cancellation should propagate"; stub acceptance |
| 58 | `beforeModel` / `afterModel` returning `{ abort }` ends the run as `stopped { reason: 'policy' }`. `StopReason` stays a closed union; the hook's reason string is recorded on the model step (`StepRecord.model.detail = { abortedBy, reason }`, field added in Task 1), not on the outcome | (defaulted: `StopReason.policy` exists for exactly this) |
| 59 | Failure mapping: hook throws → `failed { code: 'hook_error' }` (decision 21); capability throws → `failed { code: 'capability_error' }`; adapter throws `ModelError` → `failed { code: error.code }` (no retry in the loop; the adapter already retried); any other throw → `failed { code: 'internal' }` with `detail: { name, stack }`. The step in flight is marked `failed`. Three new `AgentErrorCode` values: `capability_error`, `writer_busy`, `internal` | (defaulted) |
| 60 | Context assembly (`recent` strategy, the only one until p5): budget = `context.maxTokens - estimate(instructions)`; history is grouped into units (an assistant message with tool calls + the tool messages answering it; any other message is a unit of one); units are taken newest first while they fit; the newest unit (the current input) is always included even when it exceeds the budget; `reasoning` parts are neither counted nor sent | (defaulted: spec "assemble a bounded model request"; pairing rule from the stub) |
| 61 | `RunHandle.events` buffers every event in memory for the life of the handle; any in-process iterator replays from seq 1 and then follows live; iteration ends after `run.finished`. Cross-process reattach is `resume()` (p3) | (defaulted) |
| 62 | Approval in p2: the `PendingRequest` is persisted (`requests.create`), the run record goes `awaiting` with `pendingRequestId`, events `approval.requested` then `run.paused`, outcome `awaiting`; the writer claim is **kept** (p3 resumes under it). `submit({ type: 'approve' \| 'deny' \| 'answer' })` on a p2 handle throws `AgentError('not_found', 'no live request; resume() lands in p3')` | Stub; parent p3 scope |
| 63 | "Always approve" memory: agent kv key `approvals/<sessionId>/<toolName>` with value `true`. p2 reads it in `handleToolCall` (skips the pause when set); p3 writes it on `approve { alwaysApprove: true }` | (defaulted: decision 48 needs a home for the memory; the OpenAI Agents SDK has the same `alwaysApprove` notion) |
| 64 | `RunInfo.step` is the 1-based index of the model step in progress (tool calls of step N report `step: N`). `StepRecord.index` counts every step (model and tool) from 0 in order | (defaulted) |
| 66 | `RunAbort.dispose()` clears the `timeoutMs` timer and the external-signal listener; the loop calls it on every finish path (shared `finish`, the inlined awaiting path, the last-resort catch). Without it a normal finish kept the process alive for `timeoutMs` (found by `lmstudio-tools` hanging 60 s after printing its outcome) | Found while building (2026-09-15) |
| 65 | Timestamps: `Message.createdAt`, `EventBase.at`, step `startedAt` / `endedAt` are `new Date().toISOString()` at the moment of the write. `durationMs` on `tool.completed` is wall clock around `execute` | (defaulted) |
| 67 | `Tool<any, any>` at the seams that receive a tool the host did not type itself: `Policy.requireApproval({ tool })`, `BeforeToolArgs.tool`, `AfterToolArgs.tool`, `Capability.tools()` return. Reason: `ToolExecute`'s `input` is contravariant, so a `Tool<{ text: string }>` is not assignable to `Tool` (`Tool<unknown>`); without `any` every host policy or hook test needs a cast. `AgentOptions.tools` / `Agent.tools` already were `Tool<any, Resources>` | p2 review (2026-09-15); replaces deviation (c) |

## Proposed architecture

Files after this phase (new unless marked):

```
packages/agents/src/
  errors.ts                  UPDATE: + 'capability_error' | 'writer_busy' | 'internal'
  index.ts                   UPDATE: + createAgent, run
  types/agent.ts             UPDATE: Policy, AgentOptions.policy/warn/sharedNamespace, Agent.policy/sharedNamespace
  types/hooks.ts             UPDATE: RunInfo.kv
  types/command.ts           UPDATE: approve.input?, approve.alwaysApprove?
  types/store.ts             UPDATE: StepRecord.model.detail?
  types/contracts.test-d.ts  UPDATE: + Policy / RunInfo.kv assertions
  agent/create-agent.ts      createAgent
  agent/create-agent.test.ts
  run/abort.ts               AbortReason, createRunAbort
  run/handle.ts              createRunHandle (event buffer, AsyncIterable, outcome, submit, cancel)
  run/events.ts              createEmitter (seq, appendEvent, publish, onEvent observer)
  run/context.ts             assembleRequest, estimateMessageTokens
  run/context.test.ts
  run/tools.ts               handleToolCall, boundOutput, normalizeOutput
  run/tools.test.ts
  run/run.ts                 run, execute (the loop)
  run/run.test.ts
examples/
  standalone.ts              fake model + echo tool, prints events
  lmstudio-tools.ts          openaiCompat + now tool, prints events and outcome
```

- **Data flow.** `RunArgs.input` → `Message(source: 'input')` appended → `assembleRequest` builds a `ModelRequest` view → adapter → `ModelReply.message` appended → each `ToolCallPart` → `handleToolCall` → one `Message(role: 'tool')` appended → repeat.
- **Event flow.** `emit(body)`: `seq++` → `store.runs.appendEvent` → push to the handle buffer → `hooks.onEvent` (errors logged through `warn`, never thrown). Persist first, publish second.
- **State flow.** `RunRecord.status`: `running` at create → one of `completed | awaiting | stopped | cancelled | failed`; written with `runs.update` **before** the matching `run.finished` / `run.paused` event.
- **Layer responsibilities.** `agent/` resolves options; `run/` is the harness; `types/` gets the four small contract updates; examples are hosts.
- **Import rules.** As decision 37: `run/*` and `agent/*` import contracts from `../types/<name>.js`.

## Phases

Single phase; seven tasks in dependency order.

### Task 1 - Contract updates

- **Layer:** `@facio/agents` types
- **Files:**
  - `UPDATE: packages/agents/src/errors.ts` (`AgentErrorCode` union)
  - `UPDATE: packages/agents/src/types/agent.ts`
  - `UPDATE: packages/agents/src/types/hooks.ts` (`RunInfo`)
  - `UPDATE: packages/agents/src/types/command.ts`
  - `UPDATE: packages/agents/src/types/store.ts` (`StepRecord` model variant)
  - `UPDATE: packages/agents/src/types/contracts.test-d.ts`
- **Reason:** decisions 46-52, 58, 59.
- **Code:**

  `errors.ts`: add three members to `AgentErrorCode`, after `'hook_error'`:
  ```ts
    | 'hook_error'
    | 'capability_error'
    | 'writer_busy'
    | 'internal';
  ```

  `types/hooks.ts`: replace `RunInfo`:
  ```ts
  import type { KvScope } from './store.js';

  export interface RunInfo {
    runId: string;
    sessionId: string;
    agentId: string;
    /** 1-based index of the model step in progress; tool calls report the step that proposed them. */
    step: number;
    /** Same scopes as ToolContext.kv (decision 49). */
    kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
  }
  ```

  `types/command.ts`:
  ```ts
  export type RunCommand =
    | {
        type: 'approve';
        requestId: string;
        /** Edited arguments; re-validated against the tool schema before execution (decision 48). */
        input?: unknown;
        /** Remember the decision for this tool name in this session (decision 63). */
        alwaysApprove?: boolean;
      }
    | { type: 'deny'; requestId: string; reason?: string }
    | { type: 'answer'; requestId: string; text: string }
    | { type: 'cancel'; reason?: string };
  ```

  `types/agent.ts`: add `Policy`, extend `AgentOptions` and `Agent`:
  ```ts
  import type { RunInfo } from './hooks.js';

  /** The run-level authorization floor (decision 46). A hook may escalate above it, never below. */
  export interface Policy {
    requireApproval(args: { tool: Tool<any, any>; input: unknown; run: RunInfo }): boolean | Promise<boolean>;
  }

  export interface AgentOptions<Resources = Record<string, unknown>> {
    id: string;
    instructions: string;
    model: ModelAdapter;
    tools?: Tool<any, Resources>[];
    capabilities?: Capability[];
    store?: Store;
    hooks?: Hooks;
    /** Default: approval required when tool.effects.destructive is true. */
    policy?: Partial<Policy>;
    limits?: Partial<Limits>;
    context?: ContextOptions;
    params?: ModelParams;
    resources?: Resources;
    /** Namespace for the shared kv scope; default 'default' (decision 51). */
    sharedNamespace?: string;
    /** Where one-time warnings go; default console.warn (decision 50). */
    warn?: (message: string) => void;
  }

  export interface Agent<Resources = Record<string, unknown>> {
    readonly definition: AgentDefinition;
    readonly model: ModelAdapter;
    readonly tools: ReadonlyMap<string, Tool<any, Resources>>;
    readonly capabilities: readonly Capability[];
    readonly store: Store;
    readonly hooks: Hooks;
    readonly policy: Policy;
    readonly limits: Limits;
    readonly context: Required<ContextOptions>;
    readonly params: ModelParams;
    readonly resources: Resources;
    readonly sharedNamespace: string;
    readonly warn: (message: string) => void;
  }
  ```
  `AgentDefinition` is unchanged.

  `types/store.ts`: the `kind: 'model'` variant of `StepRecord` gains, after `reply?`:
  ```ts
        /** Hook abort reason or adapter error summary; never model content. */
        detail?: unknown;
  ```

  `contracts.test-d.ts`: two more cases:
  ```ts
  it('RunInfo exposes kv scopes to every hook', () => {
    expectTypeOf<RunInfo['kv']>().toEqualTypeOf<{ agent: KvScope; shared: KvScope; workspace?: KvScope }>();
  });
  it('approve accepts an optional edited input', () => {
    expectTypeOf<Extract<RunCommand, { type: 'approve' }>>().toHaveProperty('input');
  });
  ```
- **Validation:** `pnpm typecheck` clean; `pnpm test` type test passes with 8 cases.

### Task 2 - `createAgent`

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/agent/create-agent.ts`
  - `CREATE: packages/agents/src/agent/create-agent.test.ts`
  - `UPDATE: packages/agents/src/index.ts` (+ `export { createAgent } from './agent/create-agent.js';`)
- **Reason:** decision 27 (agent is a value); decisions 25, 50, 51, 52.
- **Code:**
  ```ts
  import { AgentError } from '../errors.js';
  import { createMemoryStore } from '../store/memory.js';
  import type { Agent, AgentDefinition, AgentOptions, ContextOptions, Policy } from '../types/agent.js';
  import type { Capability } from '../types/capability.js';
  import type { Limits } from '../types/limits.js';
  import type { Tool } from '../types/tool.js';
  import { DEFAULT_LIMITS } from './limits.js';

  const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
  const DEFAULT_CONTEXT: Required<ContextOptions> = {
    maxTokens: 32_000,
    estimateTokens: (text) => Math.ceil(text.length / 4),
  };
  const DEFAULT_POLICY: Policy = {
    requireApproval: ({ tool }) => tool.effects.destructive === true,
  };

  let warnedMemoryStore = false;

  export function createAgent<Resources = Record<string, unknown>>(options: AgentOptions<Resources>): Agent<Resources> {
    if (!ID_PATTERN.test(options.id)) {
      throw new AgentError({ code: 'invalid_options', message: `agent id "${options.id}" must match ${ID_PATTERN}` });
    }
    if (typeof options.instructions !== 'string' || !options.instructions.trim()) {
      throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}" needs instructions` });
    }
    if (!options.model || typeof options.model.complete !== 'function') {
      throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}" needs a model adapter` });
    }

    const tools = new Map<string, Tool<any, Resources>>();
    for (const tool of options.tools ?? []) {
      if (tools.has(tool.name)) {
        throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": duplicate tool "${tool.name}"` });
      }
      tools.set(tool.name, tool);
    }

    const capabilities: Capability[] = [];
    const capabilityIds = new Set<string>();
    for (const cap of options.capabilities ?? []) {
      if (!ID_PATTERN.test(cap.id)) {
        throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": capability id "${cap.id}" must match ${ID_PATTERN}` });
      }
      if (capabilityIds.has(cap.id)) {
        throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": duplicate capability "${cap.id}"` });
      }
      capabilityIds.add(cap.id);
      capabilities.push(cap);
    }

    const warn = options.warn ?? ((message: string) => console.warn(message));
    let store = options.store;
    if (!store) {
      store = createMemoryStore();
      if (!warnedMemoryStore) {
        warnedMemoryStore = true;
        warn(`@facio/agents: agent "${options.id}" has no store; using an in-memory store (nothing persists). Pass store: createFileStore(...) for anything but tests.`);
      }
    }

    const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
    const context: Required<ContextOptions> = { ...DEFAULT_CONTEXT, ...options.context };
    const policy: Policy = { ...DEFAULT_POLICY, ...options.policy };
    const definition: AgentDefinition = {
      id: options.id,
      instructions: options.instructions,
      model: { id: options.model.id, modelId: options.model.modelId },
      tools: [...tools.keys()],
      capabilities: [...capabilityIds],
      limits,
      context: { maxTokens: context.maxTokens },
    };

    return Object.freeze({
      definition,
      model: options.model,
      tools,
      capabilities,
      store,
      hooks: options.hooks ?? {},
      policy,
      limits,
      context,
      params: options.params ?? {},
      resources: (options.resources ?? {}) as Resources,
      sharedNamespace: options.sharedNamespace ?? 'default',
      warn,
    });
  }
  ```
  `{ ...options.limits }` spreads `undefined` values over defaults when a caller passes `{ maxSteps: undefined }`; `exactOptionalPropertyTypes` forbids that at the type level, so no runtime guard.
- **Validation:** `create-agent.test.ts`: bad id, empty instructions, missing model, duplicate tool, duplicate capability id, bad capability id → `invalid_options`; defaults filled (`limits` equals `DEFAULT_LIMITS`, `context.maxTokens` 32_000, `estimateTokens('abcd')` is 1, `policy.requireApproval` true for a destructive tool and false otherwise, `sharedNamespace` `'default'`); the result is frozen; `definition.tools` lists names in declaration order; no `store` → `warn` called exactly once across two `createAgent` calls with the same `warn` spy (reset the module flag with `vi.resetModules()` between files if needed); a provided `store` → `warn` not called.

### Task 3 - Abort, emitter, handle

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/abort.ts`
  - `CREATE: packages/agents/src/run/events.ts`
  - `CREATE: packages/agents/src/run/handle.ts`
- **Reason:** decisions 53, 57, 61, 62. The loop (Task 6) is written against these three.
- **Code:**

  `run/abort.ts`
  ```ts
  export type AbortReason = { kind: 'cancel'; reason?: string } | { kind: 'timeout' };

  export interface RunAbort {
    signal: AbortSignal;
    abort(reason: AbortReason): void;
    /** The typed reason once aborted; undefined before. */
    reason(): AbortReason | undefined;
    /** Rejects with the AbortReason when the signal fires; used to race tool executions. */
    aborted(): Promise<never>;
  }

  export function createRunAbort(args: { external?: AbortSignal; timeoutMs: number }): RunAbort {
    const controller = new AbortController();
    let reason: AbortReason | undefined;
    const abort = (r: AbortReason) => {
      if (controller.signal.aborted) return;
      reason = r;
      controller.abort(r);
    };
    if (args.external) {
      if (args.external.aborted) abort({ kind: 'cancel', reason: 'signal' });
      else args.external.addEventListener('abort', () => abort({ kind: 'cancel', reason: 'signal' }), { once: true });
    }
    if (args.timeoutMs > 0) {
      const t = setTimeout(() => abort({ kind: 'timeout' }), args.timeoutMs);
      controller.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
    }
    return {
      signal: controller.signal,
      abort,
      reason: () => reason,
      aborted: () =>
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(reason);
          else controller.signal.addEventListener('abort', () => reject(reason), { once: true });
        }),
    };
  }
  ```

  `run/events.ts`
  ```ts
  import type { RunEvent, RunEventBody } from '../types/event.js';
  import type { Store } from '../types/store.js';

  export interface Emitter {
    emit(body: RunEventBody): Promise<RunEvent>;
    seq(): number;
  }

  export function createEmitter(args: {
    store: Store;
    runId: string;
    sessionId: string;
    agentId: string;
    publish: (event: RunEvent) => void;
    onEvent?: ((event: RunEvent) => void) | undefined;
    warn: (message: string) => void;
  }): Emitter {
    let seq = 0;
    return {
      seq: () => seq,
      async emit(body) {
        seq += 1;
        const event = { seq, runId: args.runId, sessionId: args.sessionId, agentId: args.agentId, at: new Date().toISOString(), ...body } as RunEvent;
        await args.store.runs.appendEvent(event);
        args.publish(event);
        if (args.onEvent) {
          try { args.onEvent(event); }
          catch (e) { args.warn(`onEvent observer threw on ${event.type}: ${(e as Error).message}`); }
        }
        return event;
      },
    };
  }
  ```
  Persist first, publish second (spec "Persist state transitions before publishing them").

  `run/handle.ts`
  ```ts
  import { AgentError } from '../errors.js';
  import type { RunCommand } from '../types/command.js';
  import type { RunEvent } from '../types/event.js';
  import type { RunOutcome, RunStatus } from '../types/outcome.js';
  import type { RunHandle } from '../types/run.js';
  import type { RunAbort } from './abort.js';

  export interface InternalRunHandle extends RunHandle {
    /** Called by the loop for every persisted event. */
    publish(event: RunEvent): void;
    /** Called once by the loop with the final outcome; closes the event stream. */
    finish(outcome: RunOutcome): void;
  }

  export function createRunHandle(args: { runId: string; sessionId: string; abort: RunAbort }): InternalRunHandle {
    const buffer: RunEvent[] = [];
    const waiters: (() => void)[] = [];
    let closed = false;
    let status: RunStatus = 'running';
    let resolveOutcome!: (o: RunOutcome) => void;
    const outcome = new Promise<RunOutcome>((resolve) => { resolveOutcome = resolve; });
    const wake = () => { for (const w of waiters.splice(0)) w(); };

    const events: AsyncIterable<RunEvent> = {
      async *[Symbol.asyncIterator]() {
        let i = 0;
        for (;;) {
          if (i < buffer.length) { yield buffer[i++]!; continue; }
          if (closed) return;
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      },
    };

    return {
      runId: args.runId,
      sessionId: args.sessionId,
      status: () => status,
      events,
      outcome,
      cancel: (opts) => args.abort.abort({ kind: 'cancel', ...(opts?.reason !== undefined ? { reason: opts.reason } : {}) }),
      async submit(command: RunCommand) {
        if (command.type === 'cancel') {
          args.abort.abort({ kind: 'cancel', ...(command.reason !== undefined ? { reason: command.reason } : {}) });
          return;
        }
        throw new AgentError({ code: 'not_found', message: `no live request for ${command.type}; resume() lands in p3` });
      },
      publish: (event) => { buffer.push(event); wake(); },
      finish: (o) => { status = o.status; closed = true; resolveOutcome(o); wake(); },
    };
  }
  ```
  `outcome` never rejects: the loop maps every failure to a `failed` outcome (decision 59). A host that awaits `outcome` without iterating `events` is fine; the buffer is bounded by the run's own event count.
- **Validation:** covered by `run.test.ts` (Task 6): two iterators over the same handle both see seq 1..n; an iterator started after `run.finished` still replays everything; `submit({ type: 'approve' })` throws `not_found`.

### Task 4 - Context assembly

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/context.ts`
  - `CREATE: packages/agents/src/run/context.test.ts`
- **Reason:** decision 60; spec "Assemble a bounded model request ... Preserve the canonical history separately from this derived request".
- **Code:**
  ```ts
  import type { Message } from '../types/message.js';
  import type { ModelParams, ModelRequest } from '../types/model.js';
  import type { ModelToolDefinition } from '../types/tool.js';

  export function estimateMessageTokens(message: Message, estimate: (text: string) => number): number {
    let n = 4; // role and framing
    for (const p of message.parts) {
      switch (p.type) {
        case 'text': n += estimate(p.text); break;
        case 'toolCall': n += estimate(p.name) + estimate(p.raw); break;
        case 'toolResult': n += estimate(p.content); break;
        case 'image': n += 1_000; break;   // flat cost until a provider reports one
        case 'reasoning': break;           // never sent (decision 60)
      }
    }
    return n;
  }

  /** Splits history into units: an assistant message with tool calls plus the tool messages answering it; anything else alone. */
  export function groupUnits(history: Message[]): Message[][] {
    const units: Message[][] = [];
    for (const m of history) {
      const last = units.at(-1);
      const lastHead = last?.[0];
      const answersLast =
        m.role === 'tool' && lastHead?.role === 'assistant' && lastHead.parts.some((p) => p.type === 'toolCall');
      if (answersLast && last) last.push(m);
      else units.push([m]);
    }
    return units;
  }

  export function assembleRequest(args: {
    instructions: string;
    history: Message[];
    tools: ModelToolDefinition[];
    params: ModelParams;
    maxTokens: number;
    estimateTokens: (text: string) => number;
    signal: AbortSignal;
  }): ModelRequest {
    const budget = args.maxTokens - args.estimateTokens(args.instructions);
    const units = groupUnits(args.history);
    const picked: Message[][] = [];
    let used = 0;
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!;
      const cost = unit.reduce((n, m) => n + estimateMessageTokens(m, args.estimateTokens), 0);
      if (picked.length > 0 && used + cost > budget) break;   // the newest unit always goes in
      picked.unshift(unit);
      used += cost;
    }
    const messages = picked.flat().map(stripReasoning);
    return { instructions: args.instructions, messages, tools: args.tools, params: args.params, signal: args.signal };
  }

  function stripReasoning(m: Message): Message {
    return m.parts.some((p) => p.type === 'reasoning') ? { ...m, parts: m.parts.filter((p) => p.type !== 'reasoning') } : m;
  }
  ```
- **Validation:** `context.test.ts`: with `estimateTokens = (t) => t.length` and `maxTokens` chosen so only the last two units fit, the request holds exactly those; an assistant-with-toolCalls unit is never split from its tool messages (either both in or both out); the newest unit is included even when it alone exceeds the budget; reasoning parts are absent from the request while the input `history` still has them; `groupUnits` on `[user, assistant(toolCall), tool, tool, assistant(text), user]` yields 4 units of sizes 1, 3, 1, 1.

### Task 5 - Tool call handling

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/tools.ts`
  - `CREATE: packages/agents/src/run/tools.test.ts`
- **Reason:** decisions 46, 54, 55, 57, 63; spec "Tools and execution".
- **Integration points:** called by the loop once per `ToolCallPart`; returns either a result to append or a pending approval.
- **Code:**
  ```ts
  import { AgentError } from '../errors.js';
  import { newId } from '../ids.js';
  import { validateSchema } from '../schema/validate.js';
  import type { Agent } from '../types/agent.js';
  import type { RunInfo } from '../types/hooks.js';
  import type { ToolCallPart, ToolResultPart } from '../types/message.js';
  import type { StepRecord } from '../types/store.js';
  import type { Tool, ToolContext, ToolOutput } from '../types/tool.js';
  import type { RunAbort } from './abort.js';
  import type { Emitter } from './events.js';

  export type ToolCallResult =
    | { kind: 'result'; part: ToolResultPart; executed: boolean }
    | { kind: 'approval'; tool: Tool<any, any>; input: unknown; prompt?: string }
    | { kind: 'aborted' };

  export interface ToolCallDeps {
    agent: Agent<any>;
    tools: ReadonlyMap<string, Tool<any, any>>;
    run: RunInfo;
    abort: RunAbort;
    emit: Emitter['emit'];
    /** Next StepRecord.index; the caller increments after a step is appended. */
    nextStepIndex: () => number;
  }

  export async function handleToolCall(deps: ToolCallDeps, call: ToolCallPart): Promise<ToolCallResult> {
    const { agent, run, emit } = deps;
    const deny = async (reason: string): Promise<ToolCallResult> => {
      await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason });
      return { kind: 'result', executed: false, part: { type: 'toolResult', callId: call.callId, name: call.name, content: reason, isError: true } };
    };

    const tool = deps.tools.get(call.name);
    if (!tool) return deny(`Unknown tool "${call.name}"`);

    await emit({ type: 'tool.proposed', callId: call.callId, name: call.name, input: call.input });

    if (call.input === undefined) return deny('Invalid arguments: not valid JSON');
    const validated = validateSchema({ schema: tool.input, value: call.input });
    if (!validated.ok) return deny(`Invalid arguments: ${formatIssues(validated.issues)}`);
    let input: unknown = validated.value;

    // Hook first (decision 46): it may deny, modify, or ask for approval. It cannot lower the policy floor.
    let hookWantsApproval = false;
    let prompt: string | undefined;
    if (agent.hooks.beforeTool) {
      const decision = await agent.hooks.beforeTool({ call, tool, run });
      if (decision.decision === 'deny') return deny(decision.reason);
      if (decision.decision === 'modify') {
        const again = validateSchema({ schema: tool.input, value: decision.input });
        if (!again.ok) return deny(`Invalid arguments after hook modify: ${formatIssues(again.issues)}`);
        input = again.value;
      }
      if (decision.decision === 'approval') { hookWantsApproval = true; prompt = decision.prompt; }
    }
    const needsApproval = hookWantsApproval || (await agent.policy.requireApproval({ tool, input, run }));
    if (needsApproval) {
      const remembered = await run.kv.agent.get<boolean>(`approvals/${run.sessionId}/${tool.name}`);
      if (remembered !== true) return { kind: 'approval', tool, input, ...(prompt !== undefined ? { prompt } : {}) };
    }

    return execute(deps, call, tool, input);
  }

  export async function execute(deps: ToolCallDeps, call: ToolCallPart, tool: Tool, input: unknown): Promise<ToolCallResult> {
    const { agent, run, abort, emit } = deps;
    const invocationId = newId();
    const startedAt = new Date().toISOString();
    const index = deps.nextStepIndex();
    const base = { kind: 'tool' as const, sessionId: run.sessionId, runId: run.runId, index, invocationId, callId: call.callId, name: tool.name, input, startedAt };
    await agent.store.runs.appendStep({ ...base, status: 'started' });
    await emit({ type: 'tool.started', callId: call.callId, name: tool.name, invocationId });

    const ctx: ToolContext = {
      agentId: run.agentId, sessionId: run.sessionId, runId: run.runId, callId: call.callId, invocationId,
      signal: abort.signal, kv: run.kv, resources: agent.resources,
    };
    const t0 = Date.now();
    let original: { content: string; isError: boolean; detail?: unknown };
    try {
      const output = await Promise.race([Promise.resolve(tool.execute(input, ctx)), abort.aborted()]);
      original = { ...normalizeOutput(output), isError: false };
    } catch (e) {
      if (abort.signal.aborted) {
        await agent.store.runs.updateStep({ sessionId: run.sessionId, runId: run.runId, invocationId, patch: { status: 'uncertain', endedAt: new Date().toISOString() } });
        return { kind: 'aborted' };
      }
      const err = e as Error;
      original = { content: err.message || String(e), isError: true, detail: { name: err.name, stack: err.stack } };
    }
    const durationMs = Date.now() - t0;

    let content = boundOutput(original.content, agent.limits.maxToolOutputChars);
    let isError = original.isError;
    let transformed: { content: string; isError: boolean } | undefined;
    if (agent.hooks.afterTool) {
      const after = await agent.hooks.afterTool({ call, tool, output: original.detail !== undefined ? { content, detail: original.detail } : content, isError, run });
      const next = normalizeOutput(after.output);
      content = boundOutput(next.content, agent.limits.maxToolOutputChars);
      isError = after.isError ?? isError;
      if (content !== boundOutput(original.content, agent.limits.maxToolOutputChars) || isError !== original.isError) transformed = { content, isError };
    }

    const patch: Partial<StepRecord> = { status: original.isError ? 'failed' : 'completed', original, ...(transformed ? { transformed } : {}), endedAt: new Date().toISOString() };
    await agent.store.runs.updateStep({ sessionId: run.sessionId, runId: run.runId, invocationId, patch });
    await emit({ type: 'tool.completed', callId: call.callId, name: tool.name, invocationId, content, isError, durationMs });
    return { kind: 'result', executed: true, part: { type: 'toolResult', callId: call.callId, name: tool.name, content, isError } };
  }

  export function normalizeOutput(output: ToolOutput): { content: string; detail?: unknown } {
    return typeof output === 'string' ? { content: output } : { content: output.content, ...(output.detail !== undefined ? { detail: output.detail } : {}) };
  }

  export function boundOutput(content: string, max: number): string {
    if (content.length <= max) return content;
    const dropped = content.length - max;
    return `${content.slice(0, max)}\n…[truncated ${dropped} chars]`;
  }

  function formatIssues(issues: { path: string; message: string }[]): string {
    return issues.map((i) => `${i.path} ${i.message}`).join('; ');
  }
  ```
  Hook throws propagate out of `handleToolCall` as-is; the loop wraps them as `hook_error` (decision 59). `AgentError` import is for that wrapping in Task 6 and can be dropped here if unused.
- **Validation:** `tools.test.ts` with a stub `Emitter` that records bodies and a memory store: unknown tool → `tool.denied` + error result, no `tool.proposed`; `input: undefined` → denied "not valid JSON"; schema failure → denied with the issue path; `beforeTool` `deny` → denied with the reason, executor not called; `modify` with valid input → executor receives the modified, defaulted value; `modify` with invalid input → denied; `approval` from the hook → `{ kind: 'approval' }`, executor not called; policy floor: destructive tool with a hook returning `allow` → still `{ kind: 'approval' }`; remembered key `approvals/<sessionId>/<tool>` = true → executes; executor throwing → `tool.completed` `isError: true`, step `failed`, `original.detail.name` set; output longer than `maxToolOutputChars` → truncated with the marker and `original.content` untouched in the step; `afterTool` changing content → `transformed` recorded and the result carries the new content; abort during a never-resolving executor → `{ kind: 'aborted' }` within 50 ms and the step is `uncertain`.

### Task 6 - `run()` and the loop

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/run.ts`
  - `CREATE: packages/agents/src/run/run.test.ts`
  - `UPDATE: packages/agents/src/index.ts` (+ `export { run } from './run/run.js';`)
- **Reason:** decision 27; spec "Turn lifecycle"; decisions 47, 53, 56-59, 62, 64.
- **Code:**
  ```ts
  import { AgentError, ModelError } from '../errors.js';
  import { newId } from '../ids.js';
  import { toolCallsOf } from '../message/helpers.js';
  import { ZERO_USAGE, addUsage } from '../model/usage.js';
  import type { Agent } from '../types/agent.js';
  import type { CapabilityArgs } from '../types/capability.js';
  import type { RunInfo } from '../types/hooks.js';
  import type { ContentPart, Message, ToolResultPart } from '../types/message.js';
  import type { ModelReply, ModelRequest, Usage } from '../types/model.js';
  import type { RunOutcome } from '../types/outcome.js';
  import type { RunArgs, RunHandle } from '../types/run.js';
  import type { KvScope, PendingRequest, SessionRecord } from '../types/store.js';
  import type { ModelToolDefinition, Tool } from '../types/tool.js';
  import { createRunAbort, type RunAbort } from './abort.js';
  import { assembleRequest } from './context.js';
  import { createEmitter, type Emitter } from './events.js';
  import { createRunHandle, type InternalRunHandle } from './handle.js';
  import { execute as executeTool, handleToolCall } from './tools.js';

  export function run<Resources = Record<string, unknown>>(args: RunArgs<Resources>): RunHandle {
    const runId = newId();
    const abort = createRunAbort({ ...(args.signal ? { external: args.signal } : {}), timeoutMs: args.agent.limits.timeoutMs });
    const handle = createRunHandle({ runId, sessionId: args.session, abort });
    void executeRun(args, runId, abort, handle);
    return handle;
  }

  type Finish = { status: 'finished'; outcome: RunOutcome } | { status: 'awaiting'; outcome: RunOutcome };

  async function executeRun<Resources>(args: RunArgs<Resources>, runId: string, abort: RunAbort, handle: InternalRunHandle): Promise<void> {
    const { agent } = args;
    const { store } = agent;
    const sessionId = args.session;
    const agentId = agent.definition.id;
    const now = () => new Date().toISOString();
    let usage: Usage = ZERO_USAGE;
    let steps = 0;
    let stepIndex = 0;
    let toolCalls = 0;
    let emitter: Emitter | undefined;
    let claimed = false;

    const fail = (code: string, message: string, detail?: unknown): RunOutcome =>
      ({ status: 'failed', error: { code, message, ...(detail !== undefined ? { detail } : {}) }, usage, steps });

    const finish = async (outcome: RunOutcome): Promise<void> => {
      await store.runs.update({ sessionId, runId, status: outcome.status, ...(outcome.status === 'awaiting' ? { pendingRequestId: outcome.requestId } : {}) });
      if (claimed && outcome.status !== 'awaiting') await store.sessions.releaseWriter({ sessionId, runId });
      if (emitter) await emitter.emit({ type: 'run.finished', outcome });
      handle.finish(outcome);
    };

    try {
      // 1. session and run record
      let session = await store.sessions.get({ sessionId });
      if (!session) {
        try {
          session = await store.sessions.create({ sessionId, agentId, ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) });
        } catch (e) {
          if ((e as AgentError).code !== 'already_exists') throw e;
          session = (await store.sessions.get({ sessionId })) as SessionRecord;
        }
      }
      await store.runs.create({ runId, sessionId, agentId, status: 'running', createdAt: now(), updatedAt: now() });
      emitter = createEmitter({ store, runId, sessionId, agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn });
      const emit = emitter.emit;

      // 2. writer claim (decision 47)
      claimed = await store.sessions.claimWriter({ sessionId, runId });
      if (!claimed) return await finish(fail('writer_busy', `session ${sessionId} is being written by another run`));

      // 3. scopes and run info
      const kv: RunInfo['kv'] = {
        agent: store.kv({ kind: 'agent', agentId }),
        shared: store.kv({ kind: 'shared', namespace: agent.sharedNamespace }),
        ...(session.workspace !== undefined ? { workspace: store.kv({ kind: 'workspace', workspace: session.workspace }) } : {}),
      };
      const run: RunInfo = { runId, sessionId, agentId, step: 0, kv };

      // 4. capabilities (decision 31)
      const tools = new Map<string, Tool<any, any>>(agent.tools);
      const sections: string[] = [];
      const capArgs: CapabilityArgs = { agentId, sessionId, runId, ...(session.workspace !== undefined ? { workspace: session.workspace } : {}), kv, signal: abort.signal };
      for (const cap of agent.capabilities) {
        let contributed: Tool[] = [];
        let text: string | undefined;
        try {
          contributed = (await cap.tools?.(capArgs)) ?? [];
          text = await cap.instructions?.(capArgs);
        } catch (e) {
          return await finish(fail('capability_error', `capability "${cap.id}": ${(e as Error).message}`, { capability: cap.id }));
        }
        for (const tool of contributed) {
          if (tools.has(tool.name)) return await finish(fail('invalid_options', `capability "${cap.id}" contributes a duplicate tool "${tool.name}"`));
          tools.set(tool.name, Object.freeze({ ...tool, source: cap.id }));
        }
        if (text && text.trim()) sections.push(`## ${cap.id}\n${text.trim()}`);
      }
      const instructions = [agent.definition.instructions, ...sections].join('\n\n');
      const toolDefinitions: ModelToolDefinition[] = [...tools.values()].map((t) => t.toModelDefinition());

      // 5. input
      const parts: ContentPart[] = typeof args.input === 'string' ? [{ type: 'text', text: args.input }] : args.input;
      const input: Message = { id: newId(), role: 'user', source: 'input', parts, createdAt: now() };
      await store.sessions.appendMessages({ sessionId, runId, messages: [input] });
      await emit({ type: 'run.started', input });

      // 6. loop
      for (;;) {
        if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
        if (steps >= agent.limits.maxSteps) return await finish({ status: 'stopped', reason: 'max_steps', usage, steps });
        steps += 1;
        run.step = steps;

        const history = await store.sessions.listMessages({ sessionId });
        let request: ModelRequest = assembleRequest({
          instructions, history, tools: toolDefinitions, params: agent.params,
          maxTokens: agent.context.maxTokens, estimateTokens: agent.context.estimateTokens, signal: abort.signal,
        });

        const modelInvocationId = newId();
        const modelIndex = stepIndex++;
        const startedAt = now();
        const stepRef = { sessionId, runId, invocationId: modelInvocationId };
        const { signal: _s, ...requestRecord } = request;
        await store.runs.appendStep({ kind: 'model', sessionId, runId, index: modelIndex, invocationId: modelInvocationId, status: 'started', request: requestRecord, startedAt });
        await emit({ type: 'model.started', step: steps });

        // hooks around the model (decisions 21, 58, 59)
        if (agent.hooks.beforeModel) {
          let before;
          try { before = await agent.hooks.beforeModel({ request, run }); }
          catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finish(fail('hook_error', `beforeModel: ${(e as Error).message}`)); }
          if ('abort' in before) {
            await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', detail: { abortedBy: 'beforeModel', reason: before.abort.reason }, endedAt: now() } });
            return await finish({ status: 'stopped', reason: 'policy', usage, steps });
          }
          request = before.request;
        }

        let reply: ModelReply;
        try {
          reply = await agent.model.complete(request);
        } catch (e) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', detail: summarize(e), endedAt: now() } });
          if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
          const code = e instanceof ModelError ? e.code : 'internal';
          return await finish(fail(code, (e as Error).message, summarize(e)));
        }

        if (agent.hooks.afterModel) {
          let after;
          try { after = await agent.hooks.afterModel({ reply, run }); }
          catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finish(fail('hook_error', `afterModel: ${(e as Error).message}`)); }
          if ('abort' in after) {
            await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply, detail: { abortedBy: 'afterModel', reason: after.abort.reason }, endedAt: now() } });
            return await finish({ status: 'stopped', reason: 'policy', usage, steps });
          }
          reply = after.reply;
        }

        usage = addUsage(usage, reply.usage);
        const { raw: _raw, ...replyRecord } = reply;
        await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord, endedAt: now() } });
        await store.sessions.appendMessages({ sessionId, runId, messages: [reply.message] });
        await emit({ type: 'model.completed', step: steps, message: reply.message, usage: reply.usage, finish: reply.finish });

        const calls = toolCallsOf(reply.message);
        if (calls.length === 0) return await finish({ status: 'completed', message: reply.message, usage, steps });

        // 7. tool calls, serially (decisions 54-56)
        const deps = { agent, tools, run, abort, emit, nextStepIndex: () => stepIndex++ };
        let limitHit = false;
        for (const call of calls) {
          if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
          if (limitHit || toolCalls >= agent.limits.maxToolCalls) {
            limitHit = true;
            await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason: 'max_tool_calls' });
            await appendResult({ type: 'toolResult', callId: call.callId, name: call.name, content: 'Tool call limit reached', isError: true });
            continue;
          }
          toolCalls += 1;
          let result;
          try { result = await handleToolCall(deps, call); }
          catch (e) { return await finish(fail('hook_error', `beforeTool/afterTool: ${(e as Error).message}`, summarize(e))); }

          if (result.kind === 'aborted') return await finish(abortOutcome(abort, usage, steps));
          if (result.kind === 'approval') {
            const requestId = newId();
            const pending: PendingRequest = {
              requestId, sessionId, runId, kind: 'approval', callId: call.callId,
              payload: { name: result.tool.name, input: result.input, ...(result.prompt !== undefined ? { prompt: result.prompt } : {}) },
              createdAt: now(),
            };
            await store.requests.create(pending);
            await emit({ type: 'approval.requested', requestId, callId: call.callId, name: result.tool.name, input: result.input, ...(result.prompt !== undefined ? { prompt: result.prompt } : {}) });
            const outcome: RunOutcome = { status: 'awaiting', sessionId, runId, requestId, kind: 'approval', usage, steps };
            await store.runs.update({ sessionId, runId, status: 'awaiting', pendingRequestId: requestId });
            await emit({ type: 'run.paused', requestId, kind: 'approval' });
            await emit({ type: 'run.finished', outcome });
            handle.finish(outcome);
            return; // writer claim kept for p3 (decision 62)
          }
          await appendResult(result.part);
        }
        if (limitHit) return await finish({ status: 'stopped', reason: 'max_tool_calls', usage, steps });
      }
    } catch (e) {
      // Store failures and programming errors end here; the outcome is still delivered.
      const outcome = fail(e instanceof AgentError ? e.code : 'internal', (e as Error).message, summarize(e));
      try { await finish(outcome); }
      catch { handle.finish(outcome); }
    }

    async function appendResult(part: ToolResultPart): Promise<void> {
      const message: Message = { id: newId(), role: 'tool', source: 'tool', parts: [part], createdAt: now() };
      await store.sessions.appendMessages({ sessionId, runId, messages: [message] });
    }
  }

  function abortOutcome(abort: RunAbort, usage: Usage, steps: number): RunOutcome {
    const reason = abort.reason();
    if (reason?.kind === 'timeout') return { status: 'stopped', reason: 'timeout', usage, steps };
    return { status: 'cancelled', ...(reason?.reason !== undefined ? { reason: reason.reason } : {}), usage, steps };
  }

  function summarize(e: unknown): { name: string; message: string; code?: string; stack?: string } {
    const err = e as Error & { code?: string };
    return { name: err?.name ?? 'Error', message: err?.message ?? String(e), ...(err?.code ? { code: err.code } : {}), ...(err?.stack ? { stack: err.stack } : {}) };
  }
  ```
  Notes for the implementer:
  - `finish()` for the awaiting path is inlined because it must not release the writer and must write `pendingRequestId`; do not "simplify" it into the shared `finish`.
  - The `run.finished` event is emitted **after** `runs.update` in every path (spec: persist the transition, then publish).
  - `executeTool` is imported for p3 (resume executes an approved call directly); if the linter flags it unused in p2, drop the import and re-add it in p3.
  - `handle.publish` is passed to the emitter so `RunHandle.events` sees events in seq order with no gap between persist and publish.
- **Validation:** `run.test.ts` (fake model + memory store + `createTool` echo):
  1. Happy path from the stub: script `[{ toolCalls: [{ name: 'echo', input: { text: 'hi' } }] }, { text: 'done' }]` → events exactly `run.started, model.started, model.completed, tool.proposed, tool.started, tool.completed, model.started, model.completed, run.finished` with `seq` 1..9; transcript roles `user, assistant, tool, assistant`; outcome `completed`, `steps: 2`, `usage` summed; `listSteps` has 3 records (model, tool, model) with `index` 0,1,2 and status `completed`; the tool step's `input` equals the validated value.
  2. `rawToolCall` → `tool.proposed` then `tool.denied` (reason starts with "Invalid arguments"), a tool message with `isError: true`, the second model request (`fakeModel.requests[1]`) contains that tool message, outcome `completed`.
  3. Unknown tool name → `tool.denied` without `tool.proposed`; run continues.
  4. `limits.maxSteps: 1` with a tool-calling script → outcome `stopped { reason: 'max_steps' }` after the tool result is appended; events end with `run.finished`.
  5. `limits.maxToolCalls: 1` with one step proposing two calls → first executed, second `tool.denied { reason: 'max_tool_calls' }` with an error result, outcome `stopped { reason: 'max_tool_calls' }`, transcript has two tool messages.
  6. `beforeTool` → `deny` → `tool.denied`, executor not called (spy), run continues to `completed`.
  7. Destructive tool, no hook → outcome `awaiting { kind: 'approval' }`; `requests.get` returns the pending request with `payload.input`; run record `awaiting` with `pendingRequestId`; events end `approval.requested, run.paused, run.finished`; `sessions.get().activeWriterRunId` still equals the run id; `handle.submit({ type: 'approve', requestId })` throws `not_found`.
  8. Destructive tool with `approvals/<sessionId>/<tool>` set to `true` in agent kv beforehand → executes, no approval event.
  9. Abort via `handle.cancel({ reason: 'user' })` while the tool executor is pending → outcome `cancelled { reason: 'user' }`; the tool step is `uncertain`; writer released.
  10. `limits.timeoutMs: 20` with a slow executor → `stopped { reason: 'timeout' }`.
  11. Second `run()` on the same session while the first awaits a never-resolving executor → second outcome `failed { code: 'writer_busy' }`, its events are exactly `run.finished`, transcript unchanged (message count equal before and after); then cancel the first.
  12. `beforeModel` returning `{ abort }` → `stopped { reason: 'policy' }`, model never called (`fakeModel.requests.length === 0`), model step `completed` with `detail.abortedBy`.
  13. Hook throwing → `failed { code: 'hook_error' }`; adapter throwing `ModelError('server')` → `failed { code: 'server' }`; capability throwing → `failed { code: 'capability_error' }` before `run.started`.
  14. Capability contributing a tool and instructions → the first request's `instructions` ends with `## <id>\n<text>` and its `tools` include the tool; the executed tool result's step shows the tool ran; a capability tool with a name that clashes with an agent tool → `failed { code: 'invalid_options' }`.
  15. Two iterators over `handle.events`, one started after `outcome` resolved, both yield the same seq list.
  16. `workspace: 'F:/x'` on a new session → `sessions.get().workspace` set and `kv.workspace` present in `ToolContext` (assert inside the tool); on an existing session with a different `workspace` arg → unchanged.

### Task 7 - Examples and docs

- **Layer:** examples, README
- **Files:**
  - `CREATE: examples/agents/standalone.ts`
  - `CREATE: examples/agents/lmstudio-tools.ts`
  - `UPDATE: examples/README.md`, `packages/agents/README.md` (replace "lands in the next phase" with the real usage)
- **Code:**

  `examples/agents/standalone.ts`
  ```ts
  import { createAgent, createTool, run, textOf } from '@facio/agents';
  import { createFakeModel, createMemoryStore } from '@facio/agents/testing';

  const echo = createTool<{ text: string }>({
    name: 'echo',
    description: 'Return the text unchanged',
    input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    execute: (input) => input.text,
  });

  const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'hello' } }] }, { text: 'The tool said: hello' }] });
  const agent = createAgent({ id: 'demo', instructions: 'Echo what the user says, then summarize.', model, tools: [echo], store: createMemoryStore() });

  const handle = run({ agent, session: 'session-1', input: 'Say hello' });
  for await (const event of handle.events) console.log(String(event.seq).padStart(2), event.type);
  const outcome = await handle.outcome;
  console.log(outcome.status, outcome.status === 'completed' ? textOf(outcome.message) : outcome);
  ```

  `examples/agents/lmstudio-tools.ts`: same shape with `openaiCompat({ baseUrl: process.env.FACIO_BASE_URL ?? 'http://localhost:1234/v1', model: process.env.FACIO_MODEL ?? 'qwen/qwen3-8b', features: { tools: true } })`, the `now` tool from `adapter-smoke.ts`, input `'What time is it? Use the tool.'`, and a `hooks.onEvent` that prints `tool.*` events with their payloads. `examples/package.json` gains `"standalone": "node --experimental-strip-types standalone.ts"` and `"lmstudio-tools": "node --experimental-strip-types lmstudio-tools.ts"`.
- **Validation:** `pnpm --filter facio-agents-examples standalone` prints seq 1..9 and `completed The tool said: hello` with no server. `lmstudio-tools` is manual (LM Studio running): prints a `tool.completed` for `now` and a `completed` outcome whose text contains a time.

## Cross-layer consistency

| Shape | Source | Consumers in this phase |
| --- | --- | --- |
| `Agent`, `Policy`, `AgentOptions` | `types/agent.ts` | `agent/create-agent.ts`, `run/*` |
| `RunInfo` (+ `kv`) | `types/hooks.ts` | `run/run.ts`, `run/tools.ts`, hooks, `Policy.requireApproval` |
| `RunCommand.approve.input` | `types/command.ts` | `run/handle.ts` (rejects in p2), p3 |
| `StepRecord.model.detail` | `types/store.ts` | `run/run.ts` |
| `RunEventBody` | `types/event.ts` | `run/events.ts`, every emit site |
| `RunOutcome` | `types/outcome.ts` | `run/run.ts`, `run/handle.ts`, examples |

`run.ts` is the only file that writes `RunRecord.status`; `tools.ts` is the only file that writes tool `StepRecord`s; `events.ts` is the only file that assigns `seq`.

## Risks and tradeoffs

- The handle buffers every event for the run's lifetime. A run is bounded by `maxSteps` and `maxToolCalls`, so the buffer is small; p5's `model.delta` events will need a cap or a drop policy for iterators that have already passed them.
- `Promise.race` on tool execution leaves an abandoned promise when the abort wins; the executor may still complete and mutate the world. The step is `uncertain` for exactly that reason (spec "recovery has a hard edge").
- `listMessages` on every step re-reads the whole transcript; fine for the memory and file stores at this size, and p5's context strategy is where paging lands.
- `createAgent` freezes shallowly; `agent.tools` is a `Map` and mutable at runtime by a hostile caller. Not defended: the agent is the host's own value.

## Resume state

- **Done so far (2026-09-15):** Tasks 1-7 built. `pnpm check`: build, typecheck (3 workspaces), 122 tests (114 runtime + 8 type-level), 0 type errors.
  Evidence: `packages/agents/src/agent/create-agent{,.test}.ts`, `run/{abort,events,handle,context,tools,run}.ts` with `context.test.ts` (6), `tools.test.ts` (14), `run.test.ts` (19: the plan's 16 cases plus external signal / `submit cancel`, content-part input + observer errors, timer release); contract updates in `errors.ts`, `types/{agent,hooks,command,store}.ts`, `contracts.test-d.ts` (8); `examples/{standalone,lmstudio-tools}.ts`; READMEs.
  Deviations from the plan's code, each proven: (a) decision 66, `RunAbort.dispose()`; (b) `run/tools.ts` wraps the executor in `Promise.resolve().then(...)` and guards non-Error throws (`err?.message`), and drops the unused `AgentError` import as the plan allowed; (c) superseded by decision 67 (`Tool<any, any>` at the hook / policy / capability seams; `create-agent.test.ts` now uses `createTool<{ text: string }>`, `contracts.test-d.ts` asserts a typed tool is assignable to `BeforeToolArgs['tool']`).
- **p2 review fixes (2026-09-15, after commit `eac7883`):** (1) the `afterModel` abort path stored the full `reply` (with provider `raw`) on the model step; both paths now go through `replyRecord()` in `run/run.ts`, which strips `raw`. (2) `usage = addUsage(usage, reply.usage)` ran after the `afterModel` hook, so an `{ abort }` lost the tokens the model consumed; it now runs right after `model.complete` succeeds. Test: afterModel abort → `outcome.usage` equals the fake reply's usage, step `reply` has no `raw`. (3) `toolCalls` was incremented before `handleToolCall`, so denied calls (unknown tool, invalid args, hook deny) counted toward `limits.maxToolCalls`; it now counts only results with `executed: true`, `approval`, or `aborted` (decision 56 "before executing"). Test: `maxToolCalls: 1`, one step proposing `[unknown-tool, echo]` → echo still executes, outcome `completed`. (4) decision 67. `pnpm check`: 125 tests (116 runtime + 9 type-level), 0 type errors; `standalone` still prints seq 1..9 + `completed`.
- **Next action:** `/dooit` on [01-harness-core-p3-durable-hitl.md](01-harness-core-p3-durable-hitl.md). `resume()` should reuse `run/tools.ts` `execute()` for an approved call and `handle.submit` already rejects non-cancel commands with `not_found` until then.
- **Open questions:** none.
- **Watch out for:** `vi.useFakeTimers()` is safe around `run()` only because the loop itself sets no timers apart from `timeoutMs`; the `standalone` example must keep exiting immediately (no timer) and `lmstudio-tools` within ~2 s without a server (retries only). `handle.events` buffers all events for the handle's life (decision 61); p5's `model.delta` needs a cap. `Tool<Input>` contravariance is settled by decision 67; a new seam that receives a host tool should take `Tool<any, any>`, not `Tool`.

## Final verification checklist

- [x] `pnpm check` clean at the repo root (2026-09-15, 125 tests after the review fixes).
- [x] `run.test.ts` cases 1-16 pass against `createMemoryStore()`.
- [x] Every `run.finished` is preceded by `runs.update` with the same status (grep the loop: no `emit({ type: 'run.finished'` without an `update` above it).
- [x] `packages/agents/src/types/` still exports no runtime value.
- [x] `examples/agents/standalone.ts` prints seq 1..9 and `completed`.
- [x] `index.md` status for 01-p2 updated. `lmstudio-tools` verified 2026-09-15 against the `.env` server (`Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-GGUF`): `tool.completed` for `now`, `completed` outcome with the time, seq 1..9.
