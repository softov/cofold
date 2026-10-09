---
title: A harness can turn off the rule that a write needs a read first
domain: tools
status: planned
priority: high
created: 2026-10-09
revalidated: 2026-10-09
decisions: []
refs:
  - "[code://packages/tools/src/files.ts#L45-L53](../../../../packages/tools/src/files.ts#L45-L53) - `files(options)`, which gets the option"
  - "[code://packages/tools/src/files.ts#L113-L121](../../../../packages/tools/src/files.ts#L113-L121) - `write_file` calls `assertCurrent` on a file it did not make"
  - "[code://packages/tools/src/files.ts#L145-L150](../../../../packages/tools/src/files.ts#L145-L150) - `edit_file` calls `assertCurrent`"
  - "[code://packages/tools/src/files.ts#L273-L278](../../../../packages/tools/src/files.ts#L273-L278) - `assertCurrent`, the refusal"
  - "[code://packages/tools/src/types/files.ts#L1](../../../../packages/tools/src/types/files.ts#L1) - `FilesOptions`, which has only `maxLines` and `maxMatches`"
  - "[code://packages/tools/src/standard.ts#L12-L59](../../../../packages/tools/src/standard.ts#L12-L59) - `TOOLS_SCHEMA` and `standardCapabilities`, where `files` is a boolean"
  - "[code://packages/tools/src/types/standard.ts#L11-L18](../../../../packages/tools/src/types/standard.ts#L11-L18) - `ToolsConfig`"
  - file:///github/ahpd/.project/plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md - where the refusal was chosen, with no way to turn it off
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan that takes this release
---

## Goal

A harness can turn off the refusal of a write to a file the session did not read, or that changed since the read.
The rule stays on unless the harness turns it off.
The re-check of the opened file against the checked path stays on in every case.

## Reconnaissance

### Searches performed

- `rg "assertCurrent" packages/tools/src` - two calls, in `write_file` and `edit_file`; `memory_write` has no such check.
- `rg "FilesOptions" packages/tools/src` - `files()` is the one reader.
- `rg "files" packages/tools/src/standard.ts` - `standardCapabilities` calls `files()` with no options.

### Runtime path

```
tools config { files: { requireRead: false } } -> standardCapabilities -> files({ requireRead: false }) -> write_file / edit_file skip assertCurrent
```

### Gaps

- `FilesOptions` has no option for the rule, so no harness can turn it off.
- `ToolsConfig.files` and `TOOLS_SCHEMA` take only a boolean, so a configuration file cannot say it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `files({ requireRead: false })` turns off the refusal of an unread or changed file; the default is `true` | Softov, 2026-10-09, asked "Should cofold's file tools get an opt-out for the read-before-write rule?": "Opt-out, on by default" | 01 |
| `ToolsConfig.files` and `TOOLS_SCHEMA` take `boolean` or `{ requireRead?: boolean }`, as `web` takes `boolean` or an object | the same answer; `web` is the pattern | 01 |
| `read_file` still records what a session saw when the rule is off | (defaulted: the record costs nothing, and the rule can come back on in a later run) | 01 |
| The change is tested against ahpd's agent-cofold suite before Softov releases it | the memory `test-the-consumer-before-a-release` | 02 |

## Proposed architecture

- **Data flow** - `ToolsConfig.files` -> `standardCapabilities` -> `files(options)` -> `fileTools({ requireRead })`.
- **Layer responsibilities** - `files.ts` skips `assertCurrent` when `requireRead` is `false`; `standard.ts` passes the option through.
- **Source-of-truth files** - [`code://packages/tools/src/files.ts`](../../../../packages/tools/src/files.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The file tools take requireRead](task-01-the-file-tools-take-require-read.md) | todo | - |
| [02 - The change is tested against ahpd before any release](task-02-release-tested-against-ahpd.md) | todo | 01 |

## Risks and tradeoffs

- With the rule off, a write can replace a file a person changed during the turn.
- papo reads `TOOLS_SCHEMA`, so papo gets the key with no papo change.

## Resume state

- **Done so far:** nothing; planned 2026-10-09.
- **Next action:** Softov reads this plan; then [task-01-the-file-tools-take-require-read.md](task-01-the-file-tools-take-require-read.md).
- **Open questions:** none.
- **Watch out for:** the re-check after open is a separate rule, from ahpd plugin 22 task 02; do not turn it off with this option.

## Final verification checklist

- [ ] A write to an unread file succeeds with `requireRead: false`, and is refused without it.
- [ ] A `tools` config with `files: { requireRead: false }` passes `TOOLS_SCHEMA`.
- [ ] `files: { requireRead: 1 }` and `files: { other: true }` fail `TOOLS_SCHEMA`.
- [ ] ahpd's agent-cofold suite passes against the packed package.
- [ ] `plans/index.md` updated.
