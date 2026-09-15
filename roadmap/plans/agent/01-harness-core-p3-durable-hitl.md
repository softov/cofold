<!--
Domain: agent
Status: Not started
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-13
Dependencies: ./01-harness-core-p2-loop.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p3 - Durable sessions and paused approvals (stub)

_Status: Not started · Priority: High · Created: 2026-09-13_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 3: "Add durable sessions and paused approvals. Prove that a run can pause, lose its observer, and resume from a command without executing the tool twice."

This is a stub.
Run `/dooplan` against it when p2 is marked `Shipped`.

## Objective

Make the `Store` durable with a file-based implementation (`@facio/store-file`), make approvals and user-input requests survive the loss of every observer and a process restart, and implement `resume({ agent, runId })`.
SQLite and other stores come later as separate packages behind the same contract (parent decision 28).

## Requires

- p2 shipped: `createAgent`, `run`, memory store passing the p2 suite.

## Scope

- `@facio/store-file` (`packages/store-file`): the `Store` contract on `node:fs`, zero dependencies. One folder per session and per run; append-only JSONL for everything that is a log, `tmp + rename` for the few records that are rewritten:

  ```
  <root>/                                   createFileStore({ root }); the CLI passes resolveHome({ name: 'facio' })
    workspaces/<slug>/                      slug = workspaceSlug({ workspace }); sessions with SessionRecord.workspace
      sessions/<sessionId>/
        session.json                        SessionRecord (rewritten)
        messages.jsonl                      canonical transcript, append-only
        writer.lock                         { runId, pid, claimedAt, heartbeatAt } created with the 'wx' flag
        runs/<runId>/                       parent decision 30: runs live under their session
          run.json                          RunRecord (rewritten)
          events.jsonl                      seq 1..n, append-only; appendEvent checks the last line's seq
          steps.jsonl                       append-only; a later line with the same invocationId supersedes the earlier one
          requests/<requestId>.json
      kv/<key>.json                         { kind: 'workspace' } scope
    sessions/<sessionId>/...                same shape, for sessions without a workspace
    kv/agent/<agentId>/<key>.json
    kv/shared/<namespace>/<key>.json
    skills/<name>/SKILL.md                  global skills, read by fileSkillSource (parent decision 31)
  ```
  Project skills are not under `<root>`: `fileSkillSource` also scans `<workspace>/.agents/skills/<name>/SKILL.md` when the session has a workspace (same convention as this repo's `.agents/skills/`).

  Locating a session folder: `session.json` is found through `SessionRecord.workspace`, so `sessions.get({ sessionId })` needs the workspace too or a lookup. Decision for this phase: `<root>/sessions.json` is NOT introduced; instead the store tries `sessions/<sessionId>/` first and then every `workspaces/*/sessions/<sessionId>/` (one `readdir` of `workspaces/`, no recursion). `sessions.list({ workspace })` reads one folder. Every run-level call carries `RunRef { sessionId, runId }` (parent decision 30) and resolves the same way, then addresses `runs/<runId>/` directly.

  Two helpers exported from `@facio/store-file` (parent decision 29; the core never resolves paths):
  ```ts
  // packages/store-file/src/home.ts
  /** `${NAME}_HOME` from env (name upper-cased) when set, else path.join(os.homedir(), `.${name}`). */
  export function resolveHome(args: { name: string; env?: NodeJS.ProcessEnv }): string;

  // packages/store-file/src/slug.ts
  /**
   * path.resolve(workspace); on win32 lower-case the drive letter; replace every char outside [A-Za-z0-9._-] with '-'.
   * f:\github\opendoop → f--github-opendoop (same shape as Claude Code's projects/ folder, but drive-letter-normalized:
   * theirs yields F--github-ahpc and f--github-opendoop side by side on Windows).
   */
  export function workspaceSlug(args: { workspace: string }): string;

  // packages/store-file/src/skills.ts
  /**
   * SkillSource over the filesystem: lists <root>/skills/<name>/SKILL.md plus <workspace>/.agents/skills/<name>/SKILL.md,
   * parses `name` / `description` from the YAML frontmatter (own 20-line parser: only `key: value` lines between `---` fences),
   * `ref` is the absolute skill folder; `read` refuses a `path` that escapes the folder (path.resolve + startsWith).
   */
  export function fileSkillSource(args: { root: string }): SkillSource;
  ```
  Hosts: the CLI calls `createFileStore({ root: resolveHome({ name: 'facio' }) })` and `run({ ..., workspace: process.cwd() })`; the AHP transport (p4) does the same with `SessionOptions.cwd`. Both therefore read and write the same folders, so a session started from one is resumable from the other.

  Writer fence: `claimWriter` creates `writer.lock` exclusively; a lock whose `heartbeatAt` is older than the stale threshold (deferred question: value and who refreshes it) may be taken over; `appendMessages` re-reads the lock and throws `writer_mismatch` when `runId` differs.
  Key encoding for `kv` and ids in paths: percent-encode anything outside `[A-Za-z0-9._-]` (deferred question: or hash).
- Re-run the entire p2 test suite against the file store (parent risk note); the suite becomes a shared `Store` conformance test that every later store package imports.
- Paused runs: `beforeTool → approval` and an `askUser` tool (`packages/agents/src/tool/ask-user.ts`, the only tool shipped inside core because it is a control-flow primitive; deferred question) create a `PendingRequest`, persist `runs.update({ status: 'awaiting', pendingRequestId })`, emit `approval.requested` / `input.requested` and `run.paused`, then return the `awaiting` outcome. The writer lock stays with the paused run.
- `resume({ agent, sessionId, runId, afterSeq })` (parent decision 30; both ids come from the `awaiting` outcome or the previous handle): loads the run, replays events after `afterSeq` into the handle, then waits for a command. `submit({ type: 'approve' | 'deny' | 'answer', requestId })` validates `requestId` against `RunRecord.pendingRequestId`, resolves the request, emits `approval.resolved` / `input.resolved` and `run.resumed`, and continues the loop from the step log: the tool step for the approved call is executed exactly once, keyed by its existing `invocationId`.
- Recovery on start: a run whose last tool step is `started` (no `endedAt`) is marked `uncertain`; `resume()` refuses to re-execute it and returns `failed { code: 'uncertain_invocation' }` until an explicit `submit({ type: 'deny' })` or `approve` is given for a generated resolution request (spec "recovery has a hard edge").
- `skills({ sources })` capability in `packages/agents/src/capabilities/skills.ts` (parent decision 31): `id: 'skills'`; `instructions(args)` concatenates `source.list({ workspace })` over all sources (duplicate `name` → first source wins, logged once) and renders the index (name, description) with the trigger rules (borrowed from openai-agents-js `sandbox/capabilities/skills.ts:287-320`, trimmed: name-or-description match means use it this turn; read only what SKILL.md points to); returns `undefined` when the index is empty so the section is absent. `tools(args)` exposes one tool `read_skill({ name, path? })` (`effects: { reads: true }`) that resolves `name` to its entry and calls `source.read({ ref, path })`; unknown name → error result, never a throw.
- Session contract slots for p4: `forkPoint` and `endPoint` need message ids per turn; add `RunRecord.inputMessageId` and `RunRecord.lastMessageId`. No fork or rewind implementation here.

## Acceptance

- Pause → drop the handle → new process (new store instance on the same root folder) → `resume()` → `submit(approve)` → tool executed once (`steps.jsonl` has one `completed` line for that `invocationId`) → `completed`.
- `submit(approve)` with a stale `requestId` → rejected, no state change.
- Kill between `tool.started` and `tool.completed` → on resume the run is `failed { uncertain_invocation }` and `messages.jsonl` is intact.
- Two processes on one root folder: the second `run()` on the same session fails with `writer_mismatch`.
- A session folder (`sessions/<sessionId>/`, including its `runs/`) copied to another machine's `<root>` resumes there with `resume({ agent, sessionId, runId })` (portability check; this is why runs live under the session).
- `createFileStore({ root: resolveHome({ name: 'facio', env: { FACIO_HOME: tmp } }) })` uses `tmp`; without the env var it uses `~/.facio`. `workspaceSlug({ workspace: 'F:\\github\\opendoop' })` and `'f:/github/opendoop'` give the same slug on win32.
- Two sessions with different workspaces: `sessions.list({ workspace })` returns only the matching one and reads only that workspace folder.
- The p2 suite passes unchanged against `createFileStore({ root })`.
- A `SKILL.md` under `<workspace>/.agents/skills/demo/` with frontmatter `name: demo` shows up in the first model step's `request.instructions` under `## skills`; `read_skill({ name: 'demo', path: 'references/a.md' })` returns that file; `path: '../../secret'` returns an error result.

## Resume state

- **Done so far:** stub only.
- **Next action:** after p2 ships, run `/dooplan` with this file as notes.
- **Open questions (to be asked in that round):** lock stale threshold and heartbeat owner; path encoding of ids and kv keys; whether `askUser` lives in core; whether a paused run holds the writer lock indefinitely or the lock carries a lease; cap on a `steps.jsonl` line (`StepRecord.original.detail` is unbounded) versus a `blobs/` side folder per run, like Claude Code's `<sessionId>/tool-results/`.
