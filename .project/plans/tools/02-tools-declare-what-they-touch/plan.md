---
title: Tools declare what they touch
domain: tools
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
decisions:
  - decisions/rules-are-harness-data.md
  - decisions/tool-subject-normalized-path.md
refs:
  - "[code://packages/agents/src/types/tool.ts#L31-L47](../../../../packages/agents/src/types/tool.ts#L31-L47) - `ToolDefinition`; `subject` at line 40 is the slot this plan fills and mirrors"
  - "[code://packages/agents/src/types/event.ts#L22](../../../../packages/agents/src/types/event.ts#L22) - `tool.proposed { callId, name, input }`, no subject"
  - "[code://packages/agents/src/run/tools.ts#L23-L31](../../../../packages/agents/src/run/tools.ts#L23-L31) - `tool.proposed` is emitted before the input is validated"
  - "[code://packages/agents/src/types/capability.ts#L18-L30](../../../../packages/agents/src/types/capability.ts#L18-L30) - `Capability`"
  - "[code://packages/agents/src/run/turn.ts#L103-L110](../../../../packages/agents/src/run/turn.ts#L103-L110) - a duplicate tool name fails the run `invalid_options`"
  - "[code://packages/agents/src/policy/modes.ts#L41-L49](../../../../packages/agents/src/policy/modes.ts#L41-L49) - `policyOf`; `acceptEdits` asks the host `isEdit(tool)` and reads `input.path`"
  - "[code://packages/agents/src/types/policy.ts#L35-L40](../../../../packages/agents/src/types/policy.ts#L35-L40) - `PermissionModeRules { inside, isEdit }`"
  - "[code://packages/tools/src/files.ts#L44-L50](../../../../packages/tools/src/files.ts#L44-L50) - the path tools' `subject`, the resolved display path"
  - "[code://packages/tools/src/files.ts#L83-L132](../../../../packages/tools/src/files.ts#L83-L132) - `write_file` and `edit_file`, the two tools that write a named file"
  - "[code://packages/tools/src/web.ts#L35-L48](../../../../packages/tools/src/web.ts#L35-L48) - `web_fetch`, no subject"
  - "[code://packages/tools/src/web.ts#L76-L89](../../../../packages/tools/src/web.ts#L76-L89) - `web_search`, no subject"
  - "[code://packages/tools/src/memory.ts#L38-L78](../../../../packages/tools/src/memory.ts#L38-L78) - `memory_read`, `memory_write`, no subject"
  - "[code://packages/papo/src/agent.ts#L32-L33](../../../../packages/papo/src/agent.ts#L32-L33) - papo's `EDITS`"
  - "[code://packages/papo/src/agent.ts#L80-L86](../../../../packages/papo/src/agent.ts#L80-L86) - `isEdit: (tool) => EDITS.has(tool.name)`"
  - file:///github/ahpd/packages/agent-cofold/src/turnagent.ts - lines 35-45, `EDITS` and `editPathOf`
  - file:///github/ahpd/packages/agent-cofold/src/tools.ts - lines 176-224, `toolMetaOf`, `intentionOf`, `toolInputOf`, `describe`: each tool's subject field by name
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 84-117, `withoutTaken`: a host tool wins its name
---

## Goal

Every standard tool says what it acts on, and a tool that writes a file says which file, so a host reads both from the tool rather than keeping a table of tool names.
A host can also leave a capability's tool out when it offers its own tool of that name, instead of the run failing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg -n "subject" packages/tools/src packages/agents/src --type ts` - set by `shell.ts:53` and `files.ts:66,96,121,147,178`; nothing in `web.ts` or `memory.ts`.
- `rg -n "EDITS" packages` - papo's `agent.ts:33`; ahpd repeats it in `turnagent.ts:35`.
- `rg -n "duplicate tool" packages/agents/src` - `create-agent.ts:35` for the agent's own tools, `turn.ts:105` for a capability's.
- `rg -n "code://packages/tools/src/(web|memory).ts" .project/` - nothing.

### Runtime path

```
createTool({ subject, writes }) -> capability tools() minus exclude -> handleToolCall:
  validate -> tool.proposed { name, input, subject } -> hook -> policy.decide (acceptEdits reads tool.writes(input)) -> execute
```

### Gaps

- `web_fetch`, `web_search`, `memory_read`, `memory_write` have no subject, so a rule cannot match their URL, query or file.
- An event reader has no subject; ahpd derives one per tool name.
- Shell is `writes: true` with the command as its subject, so `subject` plus `effects.writes` cannot say which file a call writes.
- `Not found: a way to drop one tool of a capability - searched "exclude", "disallow" in packages/agents/src.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [117 - Permission rules are data the harness evaluates; a tool names its subject](../../../decisions/rules-are-harness-data.md) | the slot this plan fills for four more tools |
| 2 | [CLI-04.6 - A path tool's subject is the resolved path, relative inside the workspace and absolute outside; acceptEdits is a mode check, not a rule](../../../decisions/tool-subject-normalized-path.md) | the memory tools follow it, relative to the memory folder |

The choices below are tasks.

| What | Source | Task |
| --- | --- | --- |
| `web_fetch`'s subject is the URL as given, `web_search`'s the query, `memory_read`'s and `memory_write`'s the file relative to the memory folder (`MEMORY.md` when `memory_read` names none) | Softov, 2026-10-06, chose "B: tools declare what they touch"; decision CLI-04.6 for the path form | 01 |
| `ToolDefinition.writes?(input): string`: the absolute path of the file the call writes; `write_file` and `edit_file` declare it | Softov, 2026-10-06 (the brief: "a tool declares the path it writes, e.g. a `writes(input)`"); shell has no single file, see [`code://packages/tools/src/shell.ts#L53`](../../../../packages/tools/src/shell.ts#L53) | 02 |
| `memory_write` declares its file too; a host that tracks workspace edits checks whether the path is inside | (defaulted: it writes one named file; ahpd's `editPathOf` leaves it out only because it is outside the workspace) | 02 |
| `PermissionModeRules.isEdit` becomes optional and defaults to `tool.writes !== undefined`; `acceptEdits` reads the path from `tool.writes(input)`, falling back to `input.path` | (defaulted: papo's and ahpd's `EDITS` are exactly the tools that will declare `writes` inside a workspace) | 02 |
| `tool.proposed` carries `subject?: string`, computed from the validated input; absent when the tool has none, the input does not validate, or `subject` throws | Softov, 2026-10-06 (the brief) | 03 |
| `Capability.exclude?: readonly string[]`: tools of a capability with those names are dropped before the duplicate check; a clash nobody excluded still fails the run | Softov, 2026-10-06 (the brief); pi's `excludeTools`, Claude's `disallowedTools` | 04 |
| papo drops `EDITS` and passes no `isEdit` | Softov, 2026-10-06 (the brief) | 05 |
| ahpd drops its per-name subject table, `EDITS`/`editPathOf` and `withoutTaken`, after a cofold release, in an ahpd plan | Softov, 2026-10-06 (the brief) | 06 |

## Proposed architecture

- **Data flow** - a tool definition carries `subject` and `writes`; the loop reads `subject` into `tool.proposed`; `policyOf` reads `writes`.
- **Event flow** - `tool.proposed { callId, name, input, subject? }`.
- **State flow** - none.
- **Layer responsibilities** - agents: the `writes` slot, the event field, `Capability.exclude`, `policyOf`'s default · tools: the subjects and `writes` · papo: drops `EDITS`.
- **Source-of-truth files** - [`code://packages/agents/src/types/tool.ts`](../../../../packages/agents/src/types/tool.ts), [`code://packages/agents/src/types/capability.ts`](../../../../packages/agents/src/types/capability.ts)

```ts
// packages/agents/src/types/tool.ts, on ToolDefinition beside subject
/** The file this call writes, as an absolute path; absent for a tool that writes no single named file (a shell). */
writes?(input: Input): string;

// packages/agents/src/types/capability.ts
/** Names of this capability's tools to leave out, so a tool of the same name from elsewhere takes the name. */
exclude?: readonly string[];
```

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The web and memory tools name their subject](task-01-web-and-memory-subjects.md) | done | - |
| [02 - A tool declares the file it writes](task-02-a-tool-declares-the-file-it-writes.md) | done | - |
| [03 - tool.proposed carries the subject](task-03-tool-proposed-carries-the-subject.md) | done | - |
| [04 - A capability leaves out the tools it is told to](task-04-a-capability-leaves-out-tools.md) | done | - |
| [05 - papo drops its edit list](task-05-papo-drops-its-edit-list.md) | done | 02 |
| [06 - The READMEs, and ahpd's removals](task-06-readmes-and-ahpd.md) | done | 01, 02, 03, 04 |

## Risks and tradeoffs

- The plan spans three packages, which do-spec would make a parent; it stays one plan because Softov asked for four plans, and each task stays inside one package.
- `writes` beside `effects.writes` is two words for two things: the doc comment on each says which is the boolean and which is the path.
- A rule that matched `web_fetch` by name only is unchanged; a rule with `match` on it now matches the URL, where before it never matched.
- `tool.proposed` validates the input before it is emitted; an invalid call still emits `tool.proposed` (without a subject) and then `tool.denied`, in the same order as today.

## Resume state

- **Done so far:** every task, 01 to 06. The six are `implemented` in this table and in their own files, and [implemented.md](implemented.md) records what was built, what was verified and where the work departed from this plan. Task 06's ahpd half is [deferred.md](deferred.md)'s only row.
- **Next action:** none - the plan is built. Softov's review is what moves a task from `implemented` to `done`.
- **Open questions:** none.
- **Watch out for:** tools/03 also edits `packages/papo/src/agent.ts` and `packages/agents/src/index.ts`; rebase rather than overwrite. `exactOptionalPropertyTypes`: spread `subject` only when defined.

## Final verification checklist

- [x] A rule `{ tool: 'web_fetch', match: 'https://a.example/*' }` matches a fetch of that host and lets another through (`packages/tools/src/web.test.ts`, with a real `rules()`).
- [x] `tool.proposed` for `write_file` carries the display path; for a tool without `subject`, no field - proven by composition, see [implemented.md](implemented.md) *Departures*.
- [x] `acceptEdits` with no `isEdit` lets an in-workspace `edit_file` through and asks for `shell_exec` (`packages/agents/src/policy/modes.test.ts`, `packages/papo/src/chat.test.ts`).
- [x] A tool named `write_file` beside a capability contributing one and naming it in `exclude` runs; without `exclude` the run fails `invalid_options` as today (`packages/agents/src/run/run.test.ts`).
- [x] `pnpm check` in cofold is clean - `pnpm typecheck` clean and `pnpm test` 937 of 937, after `@cofold/store-file`'s copied-folder test was fixed (Softov's answer, recorded in agent/05's [implemented.md](../agent/05-a-run-answers-its-own-pause/implemented.md)).
- [x] `plans/index.md` updated.
