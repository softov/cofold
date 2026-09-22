# @doopx/store-file

The first durable `Store` for `@doopx/agents`: one folder per session, JSONL logs per run, a `writer.lock` with a heartbeat as the fence.
Also `fileSkillSource`, the on-disk `SkillSource` for `skills()`.
Zero dependencies beyond `node:fs`, `node:path`, `node:os`.

## Use

```ts
import { createAgent } from '@doopx/agents';
import { createFileStore, resolveHome } from '@doopx/store-file';

const store = createFileStore({ root: resolveHome({ name: 'facio' }) });   // $FACIO_HOME or ~/.facio
const agent = createAgent({ id: 'cli', instructions, model, tools, store });
```

`createFileStore({ root, staleAfterMs? })` passes the `@doopx/agents` Store conformance suite; `staleAfterMs` (default 60 s) is how old a `running` run's heartbeat must be before another claim takes its lock.

## Layout

```
<root>/
  sessions/<sessionId>/                       sessions without a workspace
  workspaces/<slug>/sessions/<sessionId>/     sessions created with a workspace (slug = workspaceSlug({ workspace }))
    session.json                              SessionRecord (tmp + rename)
    messages.jsonl                            the transcript, append-only
    writer.lock                               { runId, pid, claimedAt, heartbeatAt }
    runs/<runId>/
      run.json                                RunRecord
      events.jsonl                            seq 1..n
      steps.jsonl                             one line per append or update; folded by invocationId on read
      requests/<requestId>.json               PendingRequest
  workspaces/<slug>/kv/<key>.json             kv { kind: 'workspace' }
  kv/agent/<agentId>/<key>.json               kv { kind: 'agent' }
  kv/shared/<namespace>/<key>.json            kv { kind: 'shared' }
  skills/<name>/SKILL.md                      global skills for fileSkillSource
```

Ids and kv keys are percent-encoded (every byte outside `[A-Za-z0-9._-]`); a key longer than 200 bytes after encoding is refused with `invalid_options`.
A session is found under `sessions/` first, then by one scan of `workspaces/*/sessions/`; the result is cached per store instance.
Copying a session folder to another root carries its runs, requests and lock, so `resume()` works from the copy.

## The writer lock

`claimWriter` creates `writer.lock` with `wx`.
When the file exists, the claim succeeds if the same run holds it (a new process resuming its own run re-stamps the `pid`), or if the holder is a `running` run whose `heartbeatAt` is older than `staleAfterMs`; a paused (`awaiting`) holder keeps its claim with no expiry.
`heartbeat` refreshes `heartbeatAt`; the loop calls it every 10 s while running.
Every write of a run whose lock was taken over by another `pid` fails with `writer_mismatch`, so a process that wakes up after a takeover cannot land on top of the recovery.

## Logs

`events.jsonl` and `messages.jsonl` are append-only, but for a cut rewriting the transcript (see "Cutting a conversation"); a torn last line from a crash is skipped on read and closed off before the next append.
`steps.jsonl` gets one line per `appendStep` and per `updateStep` (the merged record); `listSteps` keeps the last line per `invocationId` in order of first appearance.
A step `detail` larger than 256 KB when serialized is replaced by `{ truncated: true, bytes }`.

## Cutting a conversation

`sessions.truncate({ sessionId, throughMessageId })` and `sessions.fork({ fromSessionId, throughMessageId, sessionId })` implement p4 fork/rewind.
A cut keeps the messages through `throughMessageId`, and a run only when it is terminal and both its `inputMessageId` and `lastMessageId` are among them; every other run goes with its `runs/<runId>/` folder, so a kept turn keeps its step log and tool timings.
`truncate` rewrites `messages.jsonl` (tmp + rename, like `session.json`) and removes the dropped run folders, releasing a paused holder's `writer.lock`; `fork` writes a new session folder under the same workspace, copying the kept messages, runs, events and steps (never requests) and rewriting their `sessionId`.
Neither touches a session whose `writer.lock` is held by a `running` run.
`lastMessageId` is not something a caller writes: `sessions.appendMessages` advances it to the last message written under the run, so any run the loop drove carries the span a cut reads.

## Skills

```ts
import { skills } from '@doopx/agents';
import { fileSkillSource } from '@doopx/store-file';

createAgent({ ..., capabilities: [skills({ sources: [fileSkillSource({ root })] })] });
```

`fileSkillSource({ root })` lists `<root>/skills/<name>/SKILL.md` and, when the session has a workspace, `<workspace>/.agents/skills/<name>/SKILL.md` first (a workspace skill shadows a global one of the same name).
The name comes from the frontmatter `name`, else the folder; the description from `description`.
Only `key: value` lines between two `---` fences are read.
`read({ ref })` returns the body without the frontmatter; `read({ ref, path })` a file beside it, and a `path` that leaves the skill folder is refused.
