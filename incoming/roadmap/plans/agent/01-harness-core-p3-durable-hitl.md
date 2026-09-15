<!--
Domain: agent
Status: Shipped
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-16
Dependencies: ./01-harness-core-p2-loop.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p3 - Durable sessions, resume, paused approvals, askUser, skills

_Status: Shipped 2026-09-16 · Priority: High · Created: 2026-09-13 · Planned in full: 2026-09-16 · Built: 2026-09-16_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 3: "Add durable sessions and paused approvals. Prove that a run can pause, lose its observer, and resume from a command without executing the tool twice."

## Goal

After this phase a run can pause on an approval or a question, the process can die, and a new process can `resume({ agent, sessionId, runId })`, replay the events, receive `submit({ type: 'approve' | 'deny' | 'answer' })`, and continue the same turn with the approved tool executed exactly once.
`@facio/store-file` is the first durable `Store` (JSONL per session and run, `writer.lock` with a heartbeat as the fence) and passes the same conformance suite as the memory store.
`createAskUserTool()` ships in the core as the structured question primitive (several questions, single or multiple choice, free text).
`skills({ sources })` ships in the core as the first capability, with `fileSkillSource` in `@facio/store-file`.

## Reconnaissance

### Files read

- `packages/agents/src/run/run.ts` (p2, 235 lines) - the loop is one function; the tool-call batch and the model loop are inlined. `resume()` must re-enter both from a persisted state, so the loop is refactored here into `runTurn()` (Task 2) with no behavior change for `run()`.
- `packages/agents/src/run/tools.ts` - `handleToolCall` (validate → hook → policy → remembered approval → `execute`) and the exported `execute(deps, call, tool, input)`; resume calls `execute` directly for an approved call.
- `packages/agents/src/run/handle.ts` - `createRunHandle` buffers events; `submit` rejects everything but `cancel`. p3 gives it a `commands` sink so `resume()` receives `approve | deny | answer`.
- `packages/agents/src/run/events.ts` - `createEmitter` starts `seq` at 0; resume must start at the store's last seq.
- `packages/agents/src/store/memory.ts` and `store/memory.test.ts` - the reference semantics; the test file becomes the shared conformance suite.
- `packages/agents/src/types/{store,command,event,outcome,run,skills,capability}.ts` - contracts touched in Task 1.
- `roadmap/specs/agent-harness-spec.md` "Persistence and recovery" ("Recovery has a hard edge"), "Turn lifecycle".

### Searches performed

- `rg "submit\(|pendingRequestId|kind: 'input'" packages/agents/src` - `input` kind is declared in `PendingRequest`, `RunOutcome`, events, never produced; `submit` handles only `cancel`.
- `rg "approvals/" packages/agents/src/run/tools.ts` - the remembered-approval key read in p2 (decision 63); written here on `alwaysApprove`.

### Runtime path

```
pause (p2):   handleToolCall → { kind: 'approval' } → requests.create → runs.update(awaiting) → approval.requested, run.paused, run.finished → outcome awaiting (writer claim kept)
askUser (p3): tool execute → throws PauseSignal(kind 'input', questions) → same pause path with kind 'input' → input.requested
resume (p3):  resume({ agent, sessionId, runId, afterSeq }) → runs.get → replay listEvents(afterSeq) into the handle
              status awaiting → wait for submit → validate requestId → requests.resolve → approval.resolved | input.resolved → run.resumed → runs.update(running)
                → approve: execute(approved call) once, keyed by a fresh invocationId; deny: error result; answer: tool result with the answers
                → remaining calls of the batch (from the transcript) → runTurn() continues the model loop → normal finish
              status running (crash): claimWriter (takeover if stale) → last started step → failed | uncertain → outcome failed
              status terminal → replay + outcome immediately
file store:   <root>/workspaces/<slug>/sessions/<id>/{session.json, messages.jsonl, writer.lock, runs/<runId>/{run.json, events.jsonl, steps.jsonl, requests/}}
```

### Existing patterns to reuse

- `packages/agents/src/run/tools.ts:execute` - the only executor; resume must not duplicate it.
- `packages/agents/src/store/memory.ts` - `structuredClone` on every read, `already_exists` on create, `RunRef` on every run-level call; the file store mirrors each.
- `packages/model-openai-compat/src/index.ts` `openaiCompat` - the option-object factory shape for `createFileStore({ root })`.

### Gaps

- `Not found: any resume, heartbeat, lock, JSONL or askUser code - searched "resume|heartbeat|lock|jsonl|askUser" in packages/.` Written here.
- `RunRecord` has no usage/steps counters, so a resumed run cannot continue its accounting; added in Task 1.
- `Emitter` cannot start from a stored seq; `RunHandle.submit` has no command sink; both extended in Task 2.

## Decisions locked in

Rows 1-67 apply. Additional rows for this phase:

| # | Decision | Rationale / source |
| --- | --- | --- |
| 68 | **Lock lease.** `writer.lock` = `{ runId, pid, claimedAt, heartbeatAt }`. The loop calls `store.sessions.heartbeat({ sessionId, runId })` every 10 s while `running` (new `Store` method; memory store updates a timestamp). `claimWriter` may take over a lock only when the lock's run (`runs/<runId>/run.json`) has `status: 'running'` and `heartbeatAt` is older than `staleAfterMs` (default 60 s). A paused (`awaiting`) run keeps its claim with no expiry; a new `run()` on that session gets `writer_busy` until the host resumes it and answers or cancels | User (2026-09-16) |
| 69 | **`askUser` in core**, structured: `createAskUserTool()` in `tool/ask-user.ts`, not added to any agent by default (decision 7). Input is `{ questions: AskQuestion[] }` with `AskQuestion { id, question, header?, options?: { label, description? }[], multiSelect?, allowOther? }`; the answer is `{ answers: Record<id, string \| string[]> }`. `RunCommand.answer` becomes `{ type: 'answer'; requestId; answers }`; `input.requested` carries `questions`, `input.resolved` carries `answers` | User (2026-09-16): "multiple questions, multiple choice, like Codex, Claude and Copilot" |
| 70 | Large step detail: the file store caps a serialized `StepRecord` `detail` / `original.detail` at 256 KB and stores `{ truncated: true, bytes }` in its place. No side files in this phase | User (2026-09-16) |
| 71 | `Store.runs.list(args: { sessionId; status?: RunStatus }): Promise<RunRecord[]>`, newest `createdAt` first. Used by hosts to find the awaiting run and by recovery | User (2026-09-16) |
| 72 | A tool pauses the run for input by throwing `PauseSignal` (internal class in `run/pause.ts`, exported for tool authors as `pauseForInput({ questions })`). `execute()` in `tools.ts` recognizes it before the generic catch, marks the tool step `started` → stays `started` (it completes on resume), and returns `{ kind: 'input', questions }`. This keeps the `ToolExecute` signature unchanged | (defaulted: the alternative, a `ctx.ask()` promise that resolves after resume, cannot survive a process death) |
| 73 | `RunRecord` gains `usage: Usage` and `steps: number` (written on every `runs.update` from the loop) and, for p4, `inputMessageId: string` and `lastMessageId?: string`. Resume continues the counters from the record | (defaulted: the awaiting outcome is not durable; the record is) |
| 74 | Resume of an `awaiting` run: `submit` validates `command.requestId === run.pendingRequestId` (else `AgentError('not_found')`, no state change); then `requests.resolve`, event `approval.resolved` / `input.resolved`, `runs.update({ status: 'running', pendingRequestId: undefined })`, event `run.resumed`; then the remaining calls of the paused batch are computed from the transcript (last assistant message's `toolCall` parts minus the `callId`s that already have a `toolResult`), in order, the paused call first | (defaulted: no extra state; the transcript is the source of truth) |
| 75 | `approve { input?, alwaysApprove? }`: `input` present → `validateSchema` against the tool; failure → `AgentError('invalid_options')` from `submit` and the run stays awaiting. `alwaysApprove` → `kv.agent.set('approvals/<sessionId>/<tool>', true)` before executing. The approved call runs through `tools.ts` `execute()` with a fresh `invocationId`; the step log therefore shows exactly one `tool` step for that `callId` | Decisions 48, 63; spec "without executing the tool twice" |
| 76 | `deny { reason? }` on an approval → tool result `{ isError: true, content: reason ?? 'Denied by the user' }` appended, no `tool.denied` event (`approval.resolved { decision: 'deny' }` already says it); the loop continues so the model can react | (defaulted: mirrors decision 55 for hook denies) |
| 77 | `answer { answers }` on an input request → the ask-user tool step (left `started` at pause) is completed with `original.content` = a rendered `Q/A` text and `original.detail = { answers }`; `tool.completed` event; result appended; loop continues. Answers are validated against the questions: unknown id, missing required answer, an option label not in `options` when `allowOther` is false, an array for a single-select → `AgentError('invalid_options')` from `submit`, run stays awaiting | (defaulted) |
| 78 | Recovery of a `running` run (process died): `resume()` claims the writer (takeover if stale per decision 68; `writer_busy` if a live process holds it); the last step with no `endedAt` is marked: `model` → `failed`, `tool` → `uncertain` plus an error tool result `execution outcome unknown: the process died during the call` appended so the transcript stays model-valid; then `runs.update(failed)`, `run.finished`, outcome `failed { code: 'uncertain_invocation' }` for a tool, `failed { code: 'interrupted' }` for a model step or no step. No resolution request is generated (the stub's idea is dropped: a human cannot know either, and the error result lets the next turn ask the model to check). New codes: `uncertain_invocation`, `interrupted`, `superseded` | Spec "recovery has a hard edge"; (defaulted: simpler than the stub) |
| 79 | `resume()` on a terminal run (`completed \| stopped \| cancelled \| failed`) replays events after `afterSeq` and finishes the handle with the outcome from the stored `run.finished` event. On an unknown `runId` the handle finishes `failed { code: 'not_found' }` (no throw: the signature returns a handle synchronously) | (defaulted) |
| 80 | Only one `resume()` handle per run per process; a second one on an `awaiting` run while the first is live gets `failed { code: 'writer_busy' }` (the first holds an in-process lease) | (defaulted) |
| 81 | File store layout as in "Proposed architecture"; ids and kv keys are percent-encoded (every byte outside `[A-Za-z0-9._-]`), a key longer than 200 bytes after encoding → `StoreError('invalid_options')`. `session.json`, `run.json`, `writer.lock` are written `tmp + rename`; JSONL files are `appendFile` with one JSON object per line and `\n` | Stub; (defaulted) |
| 82 | JSONL seq check: `appendEvent` keeps a per-run `lastSeq` cache filled from the last line on first use; the writer fence guarantees a single appender per run, so the cache is authoritative within a process. `appendStep` and `updateStep` append lines; a later line with the same `invocationId` supersedes the earlier one; `listSteps` folds by `invocationId` keeping order of first appearance | Stub |
| 83 | Session lookup in the file store: `sessions/<id>/` first, then one `readdir` of `workspaces/` looking for `<slug>/sessions/<id>/`; `sessions.list({ workspace })` reads one folder. An in-memory `sessionId → folder` cache avoids repeating the scan | Decision 30 ("no scanning" refers to runs; sessions need one bounded lookup) |
| 84 | Conformance: `packages/agents/src/testing/store-conformance.ts` exports `describeStoreConformance(args: { name; create: () => Promise<Store> \| Store; dispose?: (store) => Promise<void> })`, a vitest `describe` block holding every case from `memory.test.ts` plus the p3 additions (`runs.list`, `heartbeat`, `already_exists`, stale takeover). `memory.test.ts` and `store-file`'s test both call it; no store-specific test duplicates a conformance case | Stub |
| 85 | `skills({ sources })` (core, `capabilities/skills.ts`): `id: 'skills'`; `instructions` renders the index (name, description) with fixed trigger rules and returns `undefined` when empty; duplicate names across sources → first source wins, one `warn`; `tools` exposes `read_skill({ name, path? })` (`effects: { reads: true }`), unknown name → error result. `fileSkillSource({ root })` (`@facio/store-file`) scans `<root>/skills/<name>/SKILL.md` and, when `workspace` is given, `<workspace>/.agents/skills/<name>/SKILL.md`; frontmatter parser handles `key: value` lines between `---` fences only; `read` refuses a `path` that escapes the skill folder | Parent decision 31 |
| 86 | `RunHandle` gains no new members; `submit` on a `resume()` handle resolves after the command has been persisted (request resolved, run updated, events appended) and rejects with the validation error otherwise. The continuation itself runs in the background like `run()` | (defaulted) |
| 87 | `describeStoreConformance` lives on its own sub-path `@facio/agents/testing/store-conformance` (imports `vitest`, which throws outside a test run); `./testing` stays vitest-free | Build (2026-09-16), deviation (a) |
| 88 | The heartbeat interval lives on `TurnContext` and is cleared in `settle()` before the outcome is published; `resume()` starts it only after the command is persisted (a paused run has no lease, decision 68, and an idle interval would pin the process) | Build, deviation (b) |
| 89 | `superseded`: a `seq_gap` / `writer_mismatch` thrown mid-turn means another process recovered this run; `runTurn` settles `failed { code: 'superseded' }` without further writes. The file store fences by pid: run-level writes fail `writer_mismatch` once the run's lock carries another pid; a new-process `resume()` re-stamps its own pid. Cross-process double resume of one awaiting run is therefore last-wins (decision 80 covers in-process only) | Build, deviation (c) |
| 90 | Recovery of a run that died mid-tool answers every unanswered call of that batch (`not executed: the run was interrupted`), not only the uncertain one, so the transcript stays model-valid | Build, deviation (d); completes decision 78 |
| 91 | `resume()` derives a `running` run's `usage` / `steps` from the step log (the record is written only at pause / finish) | Build, deviation (e) |
| 92 | `writer_busy` on `resume()` and cancel-while-waiting finish the handle only: no store writes, no foreign `run.finished` in the log; the request stays open | Build, deviation (f) |
| 93 | JSONL: `appendLine` closes off a torn tail (no trailing newline) before appending; `readLines` skips an unparsable line and keeps the rest. `lock.claim` on a torn lock removes it and retries once | Build, deviations (g), (h) |
| 94 | `Store.runs.update` takes `pendingRequestId?: string \| undefined` (explicit clear under `exactOptionalPropertyTypes`); the memory store's internal step array is `stepLog` since `RunRecord.steps` is the counter | Build, deviations (g), (i) |

## Proposed architecture

```
packages/agents/src/
  errors.ts                       UPDATE: + 'uncertain_invocation' | 'interrupted' | 'superseded'
  index.ts                        UPDATE: + resume, createAskUserTool, pauseForInput, skills
  testing.ts                      UPDATE: + describeStoreConformance
  types/command.ts                UPDATE: answer.answers
  types/event.ts                  UPDATE: input.requested.questions, input.resolved.answers
  types/store.ts                  UPDATE: RunRecord.usage/steps/inputMessageId/lastMessageId, runs.list, sessions.heartbeat, StepRecord.tool.pause?
  types/ask.ts                    AskQuestion, AskOption, AskAnswers
  types/contracts.test-d.ts       UPDATE
  run/pause.ts                    PauseSignal, pauseForInput
  run/events.ts                   UPDATE: createEmitter({ startSeq })
  run/handle.ts                   UPDATE: commands sink (onCommand) for resume
  run/tools.ts                    UPDATE: execute() recognizes PauseSignal → { kind: 'input' }
  run/turn.ts                     runTurn(ctx, entry) - the loop extracted from run.ts (model loop + batch processing)
  run/run.ts                      UPDATE: run() = setup + runTurn; heartbeat timer
  run/resume.ts                   resume()
  run/resume.test.ts
  tool/ask-user.ts                createAskUserTool
  tool/ask-user.test.ts
  capabilities/skills.ts          skills()
  capabilities/skills.test.ts
  store/memory.ts                 UPDATE: runs.list, heartbeat, usage/steps on update
  store/memory.test.ts            UPDATE: delegates to the conformance suite
  testing/store-conformance.ts    describeStoreConformance
packages/store-file/              @facio/store-file (zero deps; node:fs, node:path, node:os)
  package.json  tsconfig.json  tsconfig.test.json  README.md
  src/index.ts                    createFileStore, resolveHome, workspaceSlug, fileSkillSource
  src/paths.ts                    encodeSegment, layout helpers
  src/jsonl.ts                    appendLine, readLines
  src/lock.ts                     writer.lock read/write/claim/heartbeat/release
  src/store.ts                    createFileStore
  src/home.ts  src/slug.ts  src/skills.ts
  src/store.test.ts               conformance + file-specific cases
  src/skills.test.ts
examples/
  pause-resume.ts                 two store instances on one temp root: pause, "die", resume, approve
  ask-user.ts                     fake model asks two questions; the host answers from stdin
```

File layout on disk:

```
<root>/                                   createFileStore({ root }); the CLI passes resolveHome({ name: 'facio' })
  workspaces/<slug>/                      slug = workspaceSlug({ workspace }); sessions with SessionRecord.workspace
    sessions/<sessionId>/
      session.json                        SessionRecord (tmp + rename)
      messages.jsonl                      canonical transcript, append-only
      writer.lock                         { runId, pid, claimedAt, heartbeatAt }; created with 'wx'
      runs/<runId>/                       decision 30
        run.json                          RunRecord (tmp + rename)
        events.jsonl                      seq 1..n
        steps.jsonl                       one line per append/update; folded by invocationId on read
        requests/<requestId>.json         PendingRequest (tmp + rename)
    kv/<key>.json                         { kind: 'workspace' } scope
  sessions/<sessionId>/...                same shape, sessions without a workspace
  kv/agent/<agentId>/<key>.json
  kv/shared/<namespace>/<key>.json
  skills/<name>/SKILL.md                  global skills, read by fileSkillSource
```

- **Data flow.** Unchanged for `run()`. `resume()` reads `RunRecord`, the transcript and the pending request; the command supplies the missing piece (decision, input, answers); the remaining batch is derived from the transcript; `runTurn()` continues.
- **Event flow.** `resume()` replays `listEvents({ afterSeq })` into the handle buffer, then the emitter continues from the last stored seq. Persist-then-publish stays.
- **State flow.** `awaiting → running` on a valid command (persisted before `run.resumed`); `running → failed` on recovery. `usage` / `steps` ride on `RunRecord`.
- **Import rules.** `run/turn.ts` is the only place with loop logic; `run.ts` and `resume.ts` are entry points that build a `TurnContext` and call it.

## Phases

Single phase; eight tasks in dependency order.

### Task 1 - Contract updates

- **Layer:** `@facio/agents` types
- **Files:**
  - `UPDATE: packages/agents/src/errors.ts`
  - `CREATE: packages/agents/src/types/ask.ts`
  - `UPDATE: packages/agents/src/types/command.ts`
  - `UPDATE: packages/agents/src/types/event.ts`
  - `UPDATE: packages/agents/src/types/store.ts`
  - `UPDATE: packages/agents/src/types/index.ts` (+ `export type * from './ask.js';`)
  - `UPDATE: packages/agents/src/types/contracts.test-d.ts`
- **Reason:** decisions 68, 69, 71, 73, 78.
- **Code:**

  `errors.ts`: append to `AgentErrorCode`:
  ```ts
    | 'uncertain_invocation'
    | 'interrupted'
    | 'superseded';
  ```

  `types/ask.ts`
  ```ts
  export interface AskOption {
    label: string;
    description?: string;
  }

  export interface AskQuestion {
    /** Key of the answer in AskAnswers; unique within one request; /^[a-zA-Z0-9_-]{1,64}$/. */
    id: string;
    question: string;
    /** Short chip shown by UIs (<= 12 chars). */
    header?: string;
    /** When absent the answer is free text. */
    options?: AskOption[];
    /** Answer is string[] instead of string. Only with options. */
    multiSelect?: boolean;
    /** Free text accepted even when options are given. Default true. */
    allowOther?: boolean;
  }

  /** question id → answer; string[] only for multiSelect questions. */
  export type AskAnswers = Record<string, string | string[]>;
  ```

  `types/command.ts`: replace the `answer` member:
  ```ts
    | { type: 'answer'; requestId: string; answers: AskAnswers }
  ```
  (add `import type { AskAnswers } from './ask.js';`)

  `types/event.ts`: replace the two `input.*` members:
  ```ts
    | { type: 'input.requested'; requestId: string; callId: string; questions: AskQuestion[] }
    | { type: 'input.resolved'; requestId: string; answers: AskAnswers }
  ```
  (add `import type { AskAnswers, AskQuestion } from './ask.js';`)

  `types/store.ts`:
  ```ts
  import type { Usage } from './model.js';

  export interface RunRecord {
    runId: string;
    sessionId: string;
    agentId: string;
    status: RunStatus;
    createdAt: string;
    updatedAt: string;
    /** Set when status is 'awaiting'. */
    pendingRequestId?: string;
    /** Accumulated by the loop; resume continues from here (decision 73). */
    usage: Usage;
    steps: number;
    /** Message ids of this turn's input and last appended message; p4 fork/rewind slots. */
    inputMessageId?: string;
    lastMessageId?: string;
  }

  // Store.sessions gains:
      /** Refreshes writer.lock heartbeatAt (decision 68); StoreError('writer_mismatch') unless runId holds the claim. */
      heartbeat(args: { sessionId: string; runId: string }): Promise<void>;
  // Store.runs gains, and update() widens:
      list(args: { sessionId: string; status?: RunStatus }): Promise<RunRecord[]>;
      update(args: RunRef & { status: RunStatus; pendingRequestId?: string; usage?: Usage; steps?: number; lastMessageId?: string }): Promise<void>;
  ```
  `update` semantics: fields present are written; `pendingRequestId: undefined` (explicitly passed) clears it, absent leaves it. Implement with `'pendingRequestId' in args`.

  `contracts.test-d.ts`: add `RunCommand` answer has `answers: AskAnswers`; `Store['runs']['list']` returns `Promise<RunRecord[]>`; `RunRecord` has `usage: Usage`.
- **Validation:** `pnpm typecheck` fails in `run.ts`, `handle.ts`, `memory.ts` until Tasks 2-4 land; that is expected. Type test passes once Task 4 is done.

### Task 2 - Loop extraction, pause signal, handle commands, `run()` heartbeat

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/pause.ts`
  - `CREATE: packages/agents/src/run/turn.ts`
  - `UPDATE: packages/agents/src/run/run.ts` (becomes setup + `runTurn`)
  - `UPDATE: packages/agents/src/run/tools.ts` (`execute` recognizes `PauseSignal`)
  - `UPDATE: packages/agents/src/run/events.ts` (`startSeq`)
  - `UPDATE: packages/agents/src/run/handle.ts` (`onCommand`)
  - `UPDATE: packages/agents/src/run/run.test.ts` (must pass unchanged, plus heartbeat case)
- **Reason:** decisions 68, 72, 86; `resume()` needs the loop as a function of state.
- **Code:**

  `run/pause.ts`
  ```ts
  import type { AskQuestion } from '../types/ask.js';

  /** Thrown by a tool to pause the run for human input; the loop turns it into an 'input' pending request. */
  export class PauseSignal extends Error {
    readonly questions: AskQuestion[];
    constructor(questions: AskQuestion[]) {
      super('pause for input');
      this.name = 'PauseSignal';
      this.questions = questions;
    }
  }

  export function pauseForInput(args: { questions: AskQuestion[] }): never {
    throw new PauseSignal(args.questions);
  }
  ```

  `run/tools.ts`: extend `ToolCallResult` and the catch in `execute`:
  ```ts
  export type ToolCallResult =
    | { kind: 'result'; part: ToolResultPart; executed: boolean }
    | { kind: 'approval'; tool: Tool<any, any>; input: unknown; prompt?: string }
    | { kind: 'input'; tool: Tool<any, any>; input: unknown; invocationId: string; questions: AskQuestion[] }
    | { kind: 'aborted' };

  // inside execute(), first branch of the catch:
    } catch (e) {
      if (e instanceof PauseSignal) {
        // Step stays 'started'; it completes on resume with the answers (decision 77).
        return { kind: 'input', tool, input, invocationId, questions: e.questions };
      }
      if (abort.signal.aborted) { ... unchanged ... }
  ```

  `run/events.ts`: `createEmitter(args & { startSeq?: number })` → `let seq = args.startSeq ?? 0;`.

  `run/handle.ts`: `createRunHandle(args & { onCommand?: (command: RunCommand) => Promise<void> })`; `submit` becomes:
  ```ts
      async submit(command: RunCommand) {
        if (command.type === 'cancel') { args.abort.abort({ kind: 'cancel', ...(command.reason !== undefined ? { reason: command.reason } : {}) }); return; }
        if (!args.onCommand) throw new AgentError({ code: 'not_found', message: `no live request for ${command.type}; use resume()` });
        await args.onCommand(command);
      },
  ```

  `run/turn.ts` - the loop from p2 `executeRun`, parameterized. Signature and the parts that differ from p2; everything else is moved verbatim:
  ```ts
  export interface TurnContext {
    agent: Agent<any>;
    store: Store;
    sessionId: string;
    runId: string;
    agentId: string;
    run: RunInfo;               // step and kv
    tools: Map<string, Tool<any, any>>;
    toolDefinitions: ModelToolDefinition[];
    instructions: string;
    abort: RunAbort;
    emit: Emitter['emit'];
    handle: InternalRunHandle;
    counters: { usage: Usage; steps: number; stepIndex: number; toolCalls: number };
    claimed: boolean;
  }

  /** Where to enter the loop: a fresh turn, or the rest of a paused batch. */
  export type TurnEntry =
    | { kind: 'model' }
    | { kind: 'batch'; calls: ToolCallPart[] };

  export async function runTurn(ctx: TurnContext, entry: TurnEntry): Promise<void>
  ```
  Inside: `finish()` (from p2) additionally writes `usage: ctx.counters.usage, steps: ctx.counters.steps` on `runs.update`; the pause path is one function `pause(kind, callId, payload, events)` used by both approval and input:
  ```ts
  async function pause(ctx: TurnContext, args: { call: ToolCallPart; kind: 'approval' | 'input'; payload: unknown; requested: RunEventBody }): Promise<void> {
    const requestId = newId();
    await ctx.store.requests.create({ requestId, sessionId: ctx.sessionId, runId: ctx.runId, kind: args.kind, callId: args.call.callId, payload: args.payload, createdAt: now() });
    await ctx.emit({ ...args.requested, requestId } as RunEventBody);
    const outcome: RunOutcome = { status: 'awaiting', sessionId: ctx.sessionId, runId: ctx.runId, requestId, kind: args.kind, usage: ctx.counters.usage, steps: ctx.counters.steps };
    await ctx.store.runs.update({ sessionId: ctx.sessionId, runId: ctx.runId, status: 'awaiting', pendingRequestId: requestId, usage: outcome.usage, steps: outcome.steps });
    await ctx.emit({ type: 'run.paused', requestId, kind: args.kind });
    await ctx.emit({ type: 'run.finished', outcome });
    ctx.abort.dispose();
    ctx.handle.finish(outcome);
  }
  ```
  `input` payload: `{ name, input, questions, invocationId }` (the invocationId lets resume complete the same step). `requested` for input: `{ type: 'input.requested', callId, questions }`.
  The batch processor `processCalls(ctx, calls)` returns `'continue' | 'done'` and is used by both the model loop (after a reply) and `entry.kind === 'batch'`.

  `run/run.ts` after the refactor:
  ```ts
  export function run(args) {
    // unchanged: runId, abort, handle (no onCommand)
    void (async () => {
      const ctx = await setupRun(args, runId, abort, handle);   // steps 1-5 of p2: session, run record, claim, kv, capabilities, input message, run.started
      if (!ctx) return;                                          // setupRun already finished the handle (writer_busy, capability_error, ...)
      const beat = setInterval(() => { void ctx.store.sessions.heartbeat({ sessionId: ctx.sessionId, runId }).catch(() => {}); }, HEARTBEAT_MS);
      try { await runTurn(ctx, { kind: 'model' }); } finally { clearInterval(beat); }
    })();
    return handle;
  }
  export const HEARTBEAT_MS = 10_000;
  ```
  `runs.create` now includes `usage: ZERO_USAGE, steps: 0, inputMessageId` (the input message is created before the record so the id is known; keep `runs.create` before `claimWriter` as decision 53 says, so create the input `Message` object first, append it after the claim).
- **Validation:** `run.test.ts` cases 1-16 pass unchanged (the refactor is behavior-neutral). New: with `vi.useFakeTimers()` and a slow executor, after `HEARTBEAT_MS + 1` the store spy `sessions.heartbeat` was called once with the run id; after finish no further calls. A tool that calls `pauseForInput({ questions })` → outcome `awaiting { kind: 'input' }`, `requests.get().payload.questions` equals the questions, the tool step is `started` with no `endedAt`, events end `input.requested, run.paused, run.finished`.

### Task 3 - `createAskUserTool`

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/tool/ask-user.ts`
  - `CREATE: packages/agents/src/tool/ask-user.test.ts`
  - `UPDATE: packages/agents/src/index.ts` (+ `createAskUserTool`, `pauseForInput`)
- **Reason:** decision 69.
- **Code:**
  ```ts
  import { pauseForInput } from '../run/pause.js';
  import { createTool } from './create-tool.js';
  import type { AskAnswers, AskQuestion } from '../types/ask.js';
  import type { JsonSchema } from '../types/schema.js';
  import type { Tool } from '../types/tool.js';

  const QUESTION_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      question: { type: 'string', minLength: 1 },
      header: { type: 'string', maxLength: 12 },
      options: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { label: { type: 'string', minLength: 1 }, description: { type: 'string' } }, required: ['label'], additionalProperties: false } },
      multiSelect: { type: 'boolean' },
      allowOther: { type: 'boolean' },
    },
    required: ['id', 'question'],
    additionalProperties: false,
  };

  export function createAskUserTool(options: { name?: string; description?: string } = {}): Tool<{ questions: AskQuestion[] }> {
    return createTool<{ questions: AskQuestion[] }>({
      name: options.name ?? 'ask_user',
      description: options.description ?? 'Ask the user one or more questions and wait for the answers. Use options for choices; leave options out for free text.',
      input: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 4, items: QUESTION_SCHEMA } }, required: ['questions'], additionalProperties: false },
      effects: {},
      execute: (input) => {
        const ids = new Set<string>();
        for (const q of input.questions) {
          if (ids.has(q.id)) return { content: `duplicate question id "${q.id}"`, detail: { isError: true } };
          ids.add(q.id);
          if (q.multiSelect && !q.options) return { content: `question "${q.id}": multiSelect needs options`, detail: { isError: true } };
        }
        return pauseForInput({ questions: input.questions });
      },
    });
  }

  /** Validates host answers against the questions (decision 77). Returns the issues, empty when valid. */
  export function validateAnswers(questions: AskQuestion[], answers: AskAnswers): string[] {
    const issues: string[] = [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    for (const id of Object.keys(answers)) if (!byId.has(id)) issues.push(`unknown question "${id}"`);
    for (const q of questions) {
      const a = answers[q.id];
      if (a === undefined) { issues.push(`missing answer for "${q.id}"`); continue; }
      const values = Array.isArray(a) ? a : [a];
      if (Array.isArray(a) && !q.multiSelect) issues.push(`"${q.id}" is single-select`);
      if (values.length === 0 || values.some((v) => typeof v !== 'string' || !v.trim())) issues.push(`"${q.id}" needs a non-empty answer`);
      if (q.options && q.allowOther === false) {
        const labels = new Set(q.options.map((o) => o.label));
        for (const v of values) if (!labels.has(v)) issues.push(`"${q.id}": "${v}" is not one of the options`);
      }
    }
    return issues;
  }

  /** What the model sees as the tool result. */
  export function renderAnswers(questions: AskQuestion[], answers: AskAnswers): string {
    return questions.map((q) => {
      const a = answers[q.id];
      return `Q (${q.id}): ${q.question}\nA: ${Array.isArray(a) ? a.join(', ') : a}`;
    }).join('\n\n');
  }
  ```
  A validation failure inside `execute` (duplicate id, multiSelect without options) returns an error result; `createTool` cannot express `isError` for a returned value, so the loop treats `detail.isError === true`? No: keep it simple and honest - throw `new Error(...)` instead; `execute()` in `tools.ts` turns a throw into `isError: true` with the message. Replace the two `return { content, detail }` lines with `throw new Error(...)`.
- **Validation:** `ask-user.test.ts`: schema rejects an empty `questions` array, more than 4 questions, an option list of 1; `execute` throws `PauseSignal` carrying the questions; duplicate ids and `multiSelect` without options throw a plain `Error`; `validateAnswers` covers each issue; `renderAnswers` output for one single and one multi question matches a fixture.

### Task 4 - Memory store additions and the conformance suite

- **Layer:** `@facio/agents`
- **Files:**
  - `UPDATE: packages/agents/src/store/memory.ts`
  - `CREATE: packages/agents/src/testing/store-conformance.ts`
  - `UPDATE: packages/agents/src/store/memory.test.ts` (becomes `describeStoreConformance({ name: 'memory', create: createMemoryStore })` plus nothing else)
  - `UPDATE: packages/agents/src/testing.ts` (+ `describeStoreConformance`)
- **Reason:** decisions 68, 71, 73, 84.
- **Code (memory.ts deltas):**
  ```ts
  // sessions
  async heartbeat({ sessionId, runId }) { requireWriter(sessionId, runId).updatedAt = now(); },
  // runs
  async list({ sessionId, status }) {
    requireSession(sessionId);
    return [...runs.values()]
      .filter((r) => r.sessionId === sessionId && (status === undefined || r.status === status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map(stripRun);
  },
  async update({ sessionId, runId, status, usage, steps, lastMessageId, ...rest }) {
    const r = requireRun({ sessionId, runId });
    r.status = status;
    r.updatedAt = now();
    if ('pendingRequestId' in rest) { if (rest.pendingRequestId === undefined) delete r.pendingRequestId; else r.pendingRequestId = rest.pendingRequestId; }
    if (usage) r.usage = structuredClone(usage);
    if (steps !== undefined) r.steps = steps;
    if (lastMessageId !== undefined) r.lastMessageId = lastMessageId;
  },
  ```
  `store-conformance.ts` skeleton:
  ```ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest';
  import type { Store } from '../types/store.js';

  export function describeStoreConformance(args: { name: string; create: () => Store | Promise<Store>; dispose?: (store: Store) => Promise<void> | void }): void {
    describe(`Store conformance: ${args.name}`, () => {
      let store: Store;
      beforeEach(async () => { store = await args.create(); });
      afterEach(async () => { await args.dispose?.(store); });
      // every `it` from p1/p2 memory.test.ts, rewritten against `store`, plus:
      it('runs.list filters by session and status, newest first', ...);
      it('runs.update writes usage, steps, lastMessageId and clears pendingRequestId only when passed explicitly', ...);
      it('sessions.heartbeat requires the writer claim', ...);
      it('sessions.create and runs.create throw already_exists', ...);
    });
  }
  ```
  Vitest allows `describe` inside an imported function as long as the importing file is a test file.
- **Validation:** `memory.test.ts` runs the suite (same 12+ cases plus 4 new); `pnpm --filter @facio/agents test` green.

### Task 5 - `resume()`

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/run/resume.ts`
  - `CREATE: packages/agents/src/run/resume.test.ts`
  - `UPDATE: packages/agents/src/index.ts` (+ `resume`)
- **Reason:** decisions 74-80; spec build step 3.
- **Code:**
  ```ts
  import { AgentError } from '../errors.js';
  import { newId } from '../ids.js';
  import { toolCallsOf } from '../message/helpers.js';
  import { validateSchema } from '../schema/validate.js';
  import { renderAnswers, validateAnswers } from '../tool/ask-user.js';
  import type { AskAnswers, AskQuestion } from '../types/ask.js';
  import type { RunCommand } from '../types/command.js';
  import type { RunEvent } from '../types/event.js';
  import type { Message, ToolCallPart, ToolResultPart } from '../types/message.js';
  import type { RunOutcome } from '../types/outcome.js';
  import type { ResumeArgs, RunHandle } from '../types/run.js';
  import type { PendingRequest, RunRecord } from '../types/store.js';
  import { createRunAbort } from './abort.js';
  import { createEmitter } from './events.js';
  import { createRunHandle, type InternalRunHandle } from './handle.js';
  import { buildTurnContext, runTurn, type TurnContext } from './turn.js';   // buildTurnContext: kv, capabilities, instructions, tools; shared with run.ts setup
  import { execute as executeTool } from './tools.js';

  const liveResumes = new Set<string>();   // decision 80, per process

  export function resume<Resources = Record<string, unknown>>(args: ResumeArgs<Resources>): RunHandle {
    const { agent, sessionId, runId } = args;
    const abort = createRunAbort({ timeoutMs: agent.limits.timeoutMs });
    let onCommand: ((command: RunCommand) => Promise<void>) | undefined;
    const handle = createRunHandle({ runId, sessionId, abort, onCommand: (c) => (onCommand ? onCommand(c) : Promise.reject(new AgentError({ code: 'not_found', message: 'run is not awaiting a command' }))) });
    void attach();
    return handle;

    async function attach(): Promise<void> {
      const store = agent.store;
      const record = await store.runs.get({ sessionId, runId });
      if (!record) return handle.finish({ status: 'failed', error: { code: 'not_found', message: `run ${runId}` }, usage: { inputTokens: 0, outputTokens: 0 }, steps: 0 });

      const events = await store.runs.listEvents({ sessionId, runId, afterSeq: args.afterSeq ?? 0 });
      for (const e of events) handle.publish(e);
      const lastSeq = (await store.runs.listEvents({ sessionId, runId })).at(-1)?.seq ?? 0;

      if (record.status !== 'awaiting' && record.status !== 'running') {
        const finished = events.findLast((e): e is RunEvent & { type: 'run.finished' } => e.type === 'run.finished')
          ?? (await store.runs.listEvents({ sessionId, runId })).findLast((e) => e.type === 'run.finished');
        return handle.finish(finished && finished.type === 'run.finished' ? finished.outcome : { status: record.status, ...terminalFallback(record) } as RunOutcome);
      }

      if (liveResumes.has(runId)) return handle.finish({ status: 'failed', error: { code: 'writer_busy', message: `run ${runId} is already attached in this process` }, usage: record.usage, steps: record.steps });
      liveResumes.add(runId);
      try {
        const emitter = createEmitter({ store, runId, sessionId, agentId: record.agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn, startSeq: lastSeq });
        const ctx = await buildTurnContext({ agent, store, sessionId, runId, abort, emit: emitter.emit, handle, record, claimed: true });

        if (record.status === 'running') return await recover(ctx, record);       // decision 78

        const pending = record.pendingRequestId ? await store.requests.get({ sessionId, runId, requestId: record.pendingRequestId }) : undefined;
        if (!pending) return await ctx.finish({ status: 'failed', error: { code: 'not_found', message: `pending request ${record.pendingRequestId} of run ${runId}` }, usage: record.usage, steps: record.steps });

        const beat = setInterval(() => { void store.sessions.heartbeat({ sessionId, runId }).catch(() => {}); }, 10_000);
        try {
          const command = await waitForCommand(pending);           // resolves when a valid command has been persisted
          const remaining = await remainingCalls(ctx, pending);    // decision 74
          await runTurn(ctx, { kind: 'batch', calls: remaining, resolved: { pending, command } });
        } finally { clearInterval(beat); }
      } finally { liveResumes.delete(runId); }
    }
  }
  ```
  `waitForCommand(pending)` installs `onCommand`, validates per decisions 74-77 (`requestId` match; for `approve` with `input` → `validateSchema` against `ctx.tools.get(payload.name)`; for `answer` → `validateAnswers(payload.questions, answers)`; `deny` always valid; `approve`/`deny` on an `input` request and `answer` on an `approval` request → `invalid_options`), then persists: `requests.resolve`, event `approval.resolved` / `input.resolved`, `runs.update({ status: 'running', pendingRequestId: undefined })`, event `run.resumed`, sets `onCommand = undefined`, resolves the promise. Abort while waiting (`handle.cancel`) → `finish(cancelled)` and the pending request stays open for a later `resume()`.
  `runTurn`'s `batch` entry gains `resolved?: { pending, command }`: for the first call of `calls` (the paused one) it does, instead of `handleToolCall`:
  - `approve`: `alwaysApprove` → `kv.agent.set(...)`; `input = command.input !== undefined ? validated : pending.payload.input`; `await executeTool(deps, call, tool, input)`.
  - `deny`: append result `{ isError: true, content: command.reason ?? 'Denied by the user' }`.
  - `answer`: complete the paused step: `updateStep({ invocationId: payload.invocationId, patch: { status: 'completed', original: { content: rendered, isError: false, detail: { answers } }, endedAt } })`, emit `tool.completed`, append the result.
  Then the rest of `calls` go through `handleToolCall` as usual, then the model loop.
  `remainingCalls(ctx, pending)`: `messages = listMessages`; find the last `assistant` message with `toolCall` parts; `answered = new Set(toolResult callIds after it)`; return `toolCallsOf(msg).filter((c) => !answered.has(c.callId))`; assert the first is `pending.callId`, else `finish(failed { code: 'internal' })`.
  `recover(ctx, record)`: `claimed = await store.sessions.claimWriter(...)` (takeover happens inside the file store per decision 68); not claimed → `finish(failed writer_busy)`. `steps = listSteps`; `open = steps.find((s) => !s.endedAt)`; tool → `updateStep(uncertain)` + append error result `execution outcome unknown: the process died during the call` + outcome `failed { code: 'uncertain_invocation' }`; model → `updateStep(failed)` + `failed { code: 'interrupted' }`; none → `failed { code: 'interrupted' }`.
- **Validation:** `resume.test.ts` with the memory store (same store instance across "processes"; the file store repeats these in Task 6):
  1. Pause on approval → `resume()` → events replay seq 1..n → `submit({ type: 'approve' })` → `approval.resolved`, `run.resumed`, `tool.started`, `tool.completed`, ..., `run.finished`; `listSteps` has exactly one `tool` step for that `callId`; outcome `completed`; executor spy called once.
  2. `submit` with a wrong `requestId` → rejects `not_found`; run still `awaiting`; a second correct `submit` works.
  3. `approve { input: {...} }` → executor receives the edited, validated input; invalid edit → rejects `invalid_options`, still awaiting.
  4. `approve { alwaysApprove: true }` then a later run proposing the same tool → no pause.
  5. `deny { reason: 'no' }` → error result with `no`, no `tool.denied` event, model called again, outcome `completed`.
  6. Batch of three calls, second needs approval → after approve, the third executes, transcript has three tool messages in call order.
  7. askUser: pause `kind: 'input'` → `submit({ type: 'answer', answers })` → the paused step completes with `detail.answers`, result content equals `renderAnswers(...)`; wrong shape → `invalid_options`.
  8. `resume()` on a `completed` run → replay + outcome, no writer claim taken (`activeWriterRunId` unchanged).
  9. `resume()` on unknown run → `failed not_found`.
  10. Crash simulation: run with a never-resolving executor, drop the handle (cancel nothing), then directly `runs.update` stays `running`; call `resume()` on a new store view (memory: same instance, but `releaseWriter` first to simulate the lock takeover) → step `uncertain`, error result appended, outcome `failed uncertain_invocation`.
  11. `handle.cancel()` while awaiting a command → outcome `cancelled`, the request still `get`s with no `resolvedAt`, and a fresh `resume()` can still approve it.
  12. Two `resume()` on the same awaiting run → second is `failed writer_busy`.

### Task 6 - `@facio/store-file`

- **Layer:** new package
- **Files:**
  - `CREATE: packages/store-file/package.json` (same shape as `model-openai-compat`, name `@facio/store-file`, peer + dev dep on `@facio/agents`, no `dependencies`)
  - `CREATE: packages/store-file/tsconfig.json`, `tsconfig.test.json`, `README.md`
  - `CREATE: packages/store-file/src/{index,paths,jsonl,lock,store,home,slug,skills}.ts`
  - `CREATE: packages/store-file/src/store.test.ts`, `src/skills.test.ts`
  - `UPDATE: vitest.workspace.ts` (add the project)
- **Reason:** decisions 68, 70, 81-83, 85; parent decision 28.
- **Code (key parts):**

  `paths.ts`
  ```ts
  export function encodeSegment(value: string): string {
    const out = value.replace(/[^A-Za-z0-9._-]/g, (c) => Array.from(new TextEncoder().encode(c), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''));
    if (Buffer.byteLength(out) > 200) throw new StoreError({ code: 'invalid_options', message: `key too long after encoding: ${value.slice(0, 40)}…` });
    return out;
  }
  export interface Layout { root: string; sessionDir(sessionId: string, workspace?: string): string; runDir(sessionDir: string, runId: string): string; kvDir(scope: KvScopeKey): string; }
  ```

  `jsonl.ts`
  ```ts
  export async function appendLine(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
  }
  export async function readLines<T>(file: string): Promise<T[]> {
    let text: string;
    try { text = await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    const out: T[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line) as T); }
      catch { break; }   // a torn last line from a crash ends the log; everything before it is intact
    }
    return out;
  }
  export async function writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, file);
  }
  ```

  `lock.ts`
  ```ts
  export interface WriterLock { runId: string; pid: number; claimedAt: string; heartbeatAt: string }

  export async function claim(args: { sessionDir: string; runId: string; staleAfterMs: number; runStatus: (runId: string) => Promise<RunStatus | undefined> }): Promise<boolean> {
    const file = join(args.sessionDir, 'writer.lock');
    const now = new Date().toISOString();
    const lock: WriterLock = { runId: args.runId, pid: process.pid, claimedAt: now, heartbeatAt: now };
    try {
      await writeFile(file, JSON.stringify(lock), { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const current = await readLock(file);
    if (!current) return claim(args);                       // torn or vanished: retry once through 'wx'
    if (current.runId === args.runId) return true;           // idempotent re-claim
    const status = await args.runStatus(current.runId);
    const stale = status === 'running' && Date.now() - Date.parse(current.heartbeatAt) > args.staleAfterMs;
    if (!stale) return false;                                // live or paused holder (decision 68)
    await writeAtomic(file, lock);                           // takeover
    return true;
  }
  export async function heartbeat(sessionDir, runId): Promise<void>   // read, verify runId (else writer_mismatch), writeAtomic with new heartbeatAt
  export async function release(sessionDir, runId): Promise<void>     // read, unlink only when runId matches
  export async function holder(sessionDir): Promise<string | undefined>
  ```
  `sessions.get` fills `activeWriterRunId` from `holder()` so the record is honest without duplicating the lock into `session.json`.

  `store.ts` `createFileStore(options: { root: string; staleAfterMs?: number }): Store` implements every method over the layout; notable rules: `sessions.create` writes `session.json` with `flag: 'wx'` semantics (check `existsSync` then `writeAtomic`; a race is tolerated because the writer fence serializes writers); `runs.create` mkdir + `run.json`; `appendEvent` seq cache per run (decision 82); `appendStep` / `updateStep` append lines (`updateStep` reads the folded step, merges the patch, appends the merged record); `listSteps` folds; `requests.*` one JSON file each; `kv` one JSON file per key under the scope dir; `list(prefix)` = `readdir` + decode + filter. Detail cap (decision 70) applied in `appendStep`/`updateStep`: `const s = JSON.stringify(detail); if (Buffer.byteLength(s) > 262_144) detail = { truncated: true, bytes }`.

  `home.ts`, `slug.ts`, `skills.ts` as specified in the parent decision 29/31 rows and below:
  ```ts
  export function resolveHome(args: { name: string; env?: NodeJS.ProcessEnv }): string {
    const env = args.env ?? process.env;
    const key = `${args.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HOME`;
    return env[key] ?? join(homedir(), `.${args.name}`);
  }
  export function workspaceSlug(args: { workspace: string }): string {
    let p = resolve(args.workspace);
    if (process.platform === 'win32' && /^[A-Za-z]:/.test(p)) p = p[0]!.toLowerCase() + p.slice(1);
    return p.replace(/[^A-Za-z0-9._-]/g, '-');
  }
  export function fileSkillSource(args: { root: string }): SkillSource   // scans <root>/skills and <workspace>/.agents/skills; ref = absolute skill dir
  ```
  Frontmatter parser: text starts with `---\n`; take lines until the next `---`; each `key: value` line → trimmed value (quotes stripped); nothing else.
- **Validation:** `store.test.ts` = `describeStoreConformance({ name: 'file', create: () => createFileStore({ root: mkdtemp }) , dispose: rm -rf })` plus file-specific cases: a session with `workspace` lands under `workspaces/<slug>/`; `sessions.get` finds it without the workspace; `writer.lock` exists after `claimWriter` and is gone after `releaseWriter`; stale takeover: write a lock with `heartbeatAt` 2 min old for a run whose `run.json` says `running` → `claimWriter` by another run returns `true`; same but `awaiting` → `false`; torn last line in `events.jsonl` (append half a line) → `listEvents` returns the intact prefix and the next `appendEvent` continues the seq; `updateStep` folding; detail > 256 KB replaced by the marker; kv key with `/` and spaces round-trips; a 300-byte key → `invalid_options`; a session folder copied to a second temp root → `resume()` from a store on that root replays and completes (case 1 of Task 5 across two roots). `skills.test.ts`: global + workspace skills listed, frontmatter parsed, `read` of `references/a.md`, `../` escape refused.

### Task 7 - `skills()` capability

- **Layer:** `@facio/agents`
- **Files:**
  - `CREATE: packages/agents/src/capabilities/skills.ts`
  - `CREATE: packages/agents/src/capabilities/skills.test.ts`
  - `UPDATE: packages/agents/src/index.ts` (+ `skills`)
- **Reason:** decision 85; parent decision 31.
- **Code:**
  ```ts
  import { createTool } from '../tool/create-tool.js';
  import type { Capability, CapabilityArgs } from '../types/capability.js';
  import type { SkillIndexEntry, SkillSource } from '../types/skills.js';

  const RULES = [
    'A skill is a set of instructions stored in a SKILL.md file. The list below has the skills available in this session (name and description).',
    'When the user names a skill or the task clearly matches a skill description, read it with read_skill({ name }) before doing the work and follow it for that turn.',
    'Read only what the SKILL.md points to (read_skill({ name, path }) for files beside it). Do not load everything.',
    'If a skill cannot be applied (missing files, unclear steps), say so and continue with the next-best approach.',
  ].join('\n');

  export function skills(options: { sources: SkillSource[]; warn?: (message: string) => void }): Capability {
    if (options.sources.length === 0) throw new AgentError({ code: 'invalid_options', message: 'skills(): at least one source' });
    let warned = false;
    const index = async (args: CapabilityArgs) => {
      const seen = new Map<string, { entry: SkillIndexEntry; source: SkillSource }>();
      for (const source of options.sources) {
        for (const entry of await source.list({ ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) })) {
          if (seen.has(entry.name)) { if (!warned) { warned = true; options.warn?.(`skills: duplicate skill "${entry.name}"; first source wins`); } continue; }
          seen.set(entry.name, { entry, source });
        }
      }
      return seen;
    };
    return {
      id: 'skills',
      async instructions(args) {
        const entries = [...(await index(args)).values()].map(({ entry }) => `- ${entry.name}: ${entry.description}`);
        return entries.length ? `${RULES}\n\n${entries.join('\n')}` : undefined;
      },
      async tools(args) {
        const map = await index(args);
        return [createTool<{ name: string; path?: string }>({
          name: 'read_skill',
          description: 'Read a skill (its SKILL.md) or a file beside it by relative path.',
          input: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } }, required: ['name'], additionalProperties: false },
          effects: { reads: true },
          execute: async (input) => {
            const hit = map.get(input.name);
            if (!hit) throw new Error(`unknown skill "${input.name}"`);
            return hit.source.read({ ref: hit.entry.ref, ...(input.path !== undefined ? { path: input.path } : {}) });
          },
        })];
      },
    };
  }
  ```
  `index()` runs twice per run (instructions and tools); acceptable, sources are cheap; cache per `runId` in a `Map` if a source turns out slow.
- **Validation:** `skills.test.ts` with an in-memory `SkillSource`: instructions contain the rules and one line per skill, `undefined` when empty; duplicate across two sources → first wins, `warn` once; `read_skill` returns the body and a sub-path; unknown name → error result through `run()` (integration with the fake model: script calls `read_skill`, result `isError: true`).

### Task 8 - Examples and docs

- **Files:** `CREATE: examples/pause-resume.ts`, `CREATE: examples/ask-user.ts`, `UPDATE: examples/README.md`, `examples/package.json` scripts, `packages/agents/README.md` (resume, askUser, skills sections), `packages/store-file/README.md`.
- `pause-resume.ts`: temp root; agent with a destructive `delete_file` tool (fake executor) and the fake model scripted to call it; `run()` → prints `awaiting`; a **second** `createFileStore({ root })` instance + `resume()` → prints replayed events → `submit({ type: 'approve' })` → prints the rest and `completed`; asserts one `tool` step in `listSteps`.
- `ask-user.ts`: `createAskUserTool()` + fake model asking two questions (one with options); the host reads answers from stdin (`node:readline`) and submits; prints the final text.
- **Validation:** both examples run without a server; `pause-resume` exits 0 and prints `tool steps: 1`.

## Cross-layer consistency

| Shape | Source | Consumers |
| --- | --- | --- |
| `AskQuestion`, `AskAnswers` | `types/ask.ts` | `tool/ask-user.ts`, `run/pause.ts`, events, `RunCommand`, hosts |
| `RunRecord.usage/steps` | `types/store.ts` | `run/turn.ts`, `run/resume.ts`, both stores |
| `Store.sessions.heartbeat`, `runs.list` | `types/store.ts` | loop timer, `resume()`, hosts, conformance |
| `PauseSignal` | `run/pause.ts` | `tools.ts` `execute`, `ask-user.ts` |
| `TurnContext`, `runTurn` | `run/turn.ts` | `run.ts`, `resume.ts` only |
| `SkillSource` | `types/skills.ts` | `capabilities/skills.ts`, `store-file/src/skills.ts` |

`run/turn.ts` is the only file with loop logic; `run/tools.ts` the only executor; `run/events.ts` the only seq assigner; `store-file/src/lock.ts` the only writer of `writer.lock`.

## Risks and tradeoffs

- Lock takeover reads the holder's `run.json`; a holder that died between `runs.create` and its first heartbeat has `heartbeatAt = claimedAt`, so takeover waits `staleAfterMs` from the claim. Acceptable.
- `updateStep` as append-then-fold makes `steps.jsonl` grow by one line per patch (2-3 per step). Fine at run scale; compaction is a p5 concern if ever.
- The remaining-batch derivation trusts the transcript; a host that appends its own messages between pause and resume would break it. `appendMessages` is fenced by the writer claim, which the paused run keeps, so a host cannot do that through the store.
- `askUser` answers are validated against the questions the model wrote; a model can therefore constrain answers. `allowOther` defaults to true so a human can always type something.

## Resume state

- **Done so far (2026-09-16):** Tasks 1-8 built. `pnpm check`: build (3 packages), typecheck (4 workspaces), 188 tests (177 runtime + 11 type-level, was 125), 0 type errors; three consecutive runs green.
  Evidence: `types/ask.ts`, contract edits in `errors.ts`, `types/{command,event,store,index}.ts`, `contracts.test-d.ts` (+3); `run/pause.ts`, `run/turn.ts` (the loop, `runTurn(ctx, entry)`), `run/run.ts` (setup + heartbeat), `run/resume.ts` + `resume.test.ts` (the 12 numbered cases plus "died before the first step" and "submit before attach"); `tool/ask-user.ts` (+ 6 tests); `store/memory.ts` deltas; `testing/store-conformance.ts` (18 cases, run by `memory.test.ts` and `store-file`); `capabilities/skills.ts` (+ 4 tests); `packages/store-file` (`paths`, `jsonl`, `lock`, `store`, `home`, `slug`, `skills`; 29 tests: conformance + 7 file cases + cross-root resume + skills); `examples/{pause-resume,ask-user}.ts`; READMEs.
  `run.test.ts` passed unchanged after the Task 2 extraction (23 with the two Task 2 additions).
  Deviations from the plan's code, each proven:
  (a) `describeStoreConformance` is exported from `@facio/agents/testing/store-conformance`, not from `./testing`: the module imports `vitest`, which throws when loaded outside a vitest run and would have broken every host importing `createFakeModel` (the examples did).
  (b) `TurnContext.heartbeat` + `settle(ctx, outcome)`: the heartbeat timer is cleared inside every finish path before the outcome is published (the unchanged p2 timer test requires `getTimerCount() === 0` right after `outcome`); `run()` and `resume()` start the timer with `startHeartbeat()` from `run.ts`. In `resume()` it starts after the command is persisted, not while waiting: a paused run needs no lease (decision 68) and an idle interval would keep the process alive.
  (c) `runTurn` maps a `seq_gap` / `writer_mismatch` thrown mid-turn to `failed { code: 'superseded' }` and settles without another write: that is the zombie whose run another process recovered (decision 78 names the code without a home). The file store fences that zombie by `pid`: `writer.lock` writes require `runId` and `pid` to match, run-level writes (`runs.update`, `appendEvent`, `appendStep`, `updateStep`, `requests.*`) fail with `writer_mismatch` once the same run's lock carries another pid, and a resume from a new process re-stamps the pid on its own lock. In-process (memory store, same pid) a zombie cannot be fenced; `resume.test.ts` case 10 asserts the `superseded` outcome instead.
  (d) Recovery of a run that died mid-tool appends `not executed: the run was interrupted` results for the other unanswered calls of that batch too, not only for the uncertain one; decision 78's own goal ("the transcript stays model-valid") needs every call answered.
  (e) `resume()` derives counters of a `running` run from the step log (`usage` = sum of model replies, `steps` = model steps): a running record still has `usage: ZERO, steps: 0` because the loop writes them only at pause / finish (decision 73 as built).
  (f) `writer_busy` on `resume()` (decision 80, and a live claim held elsewhere) and `cancel` while waiting (test 11) finish the handle only; the store is not touched, so no `run.finished` with a foreign outcome lands in the log.
  (g) `Store.runs.update` takes `pendingRequestId?: string | undefined` so the explicit-clear form compiles under `exactOptionalPropertyTypes`; `lock.claim` on a torn lock removes it and retries once instead of recursing.
  (h) `appendLine` closes off a torn tail (no trailing newline) before appending and `readLines` skips an unparsable line rather than stopping there; the plan's "torn last line ends the log" would have glued the next event onto the fragment.
  (i) The memory store keeps its step log under `stepLog`; `RunRecord.steps` is now the counter.
- **Next action:** reviewed and accepted 2026-09-16 (deviations promoted to decisions 87-94); next is `/dooplan` then `/dooit` on [01-harness-core-p4-ahpd-adapter.md](01-harness-core-p4-ahpd-adapter.md). Commit of the p3 code is the user's (see Commit below).
- **Commit:** HEAD `f2d199e` (2026-09-16 03:00, not made by the build session) already contains an intermediate p3 snapshot (Tasks 1-4) under the p2 review-fix message; the rest of p3 is the working tree: `pnpm-lock.yaml vitest.workspace.ts examples packages`.
- **Open questions:** none blocking. Cross-process double `resume()` on one awaiting run is last-wins (the second re-stamps the pid, the first becomes `superseded` on its next write); decision 80 covers only the in-process case.
- **Watch out for:** `Array.prototype.findLast` needs `lib: ES2023` or a manual loop (base tsconfig is ES2022: use a reverse `for`); Windows `rename` over an existing file works on Node >= 22 but fails when the target is open elsewhere - tests must close nothing, they only read; `vi.useFakeTimers()` interferes with `setInterval` heartbeats and with `Date.now()` in the stale check, so file-store lock tests write `heartbeatAt` explicitly instead of advancing timers; the p2 `run.test.ts` must stay green after the extraction before any resume work starts (do the extraction as its own commit).

## Final verification checklist

- [x] `pnpm check` clean; `run.test.ts` unchanged and green after the extraction (2026-09-16, 188 tests).
- [x] Conformance suite runs against memory and file stores from one source file (`testing/store-conformance.ts`, 18 cases each).
- [x] Pause → new store instance → `resume()` → `approve` → tool executed once → `completed` (`store.test.ts` end to end, `examples/pause-resume.ts` prints `tool steps: 1 (executions: 1)`).
- [x] Stale-lock takeover only for `running` holders; paused runs keep their claim (`store.test.ts` "takes over a stale lock only when its run is still running").
- [x] askUser round trip with two questions, one multi-select (`resume.test.ts` case 7; `examples/ask-user.ts`).
- [x] A `SKILL.md` under `<workspace>/.agents/skills/` is listed first, `read_skill` reads `references/`, path escape refused (`skills.test.ts` in both packages).
- [x] `examples/pause-resume.ts` and `examples/ask-user.ts` run without a server (ask-user verified with piped and with closed stdin).
- [x] `index.md` status for 01-p3 updated.
