---
title: CLI-04.6 - A path tool's subject is the resolved path, relative inside the workspace and absolute outside; acceptEdits is a mode check, not a rule
status: accepted
date: 2026-09-16
refs:
  - code://packages/tools/src/files.ts - `subject` of `read_file`, `write_file`, `edit_file`: `displayPath(workspace, resolveWithin(workspace, input.path).absolute)`
  - code://packages/tools/src/paths.ts - `resolveWithin` (resolves against the workspace, says whether the result is inside) and `displayPath` (relative with forward slashes when under it, absolute otherwise)
  - code://packages/papo/src/agent.ts - `policyOf(mode, workspace)`: `acceptEdits` allows `write_file` / `edit_file` when `resolveWithin(workspace, input.path).inside`
  - code://.project/decisions/rules-are-harness-data.md - decision 117: rules are data over a tool's declared subject; this refines what a path tool's subject is
---

## Context

Decision 117 made a rule's `match` a glob over the tool's `subject`, and agent/04 task 04 gave the file tools `subject: (input) => input.path`, the raw input.
cli/04 task 04 maps Claude's `acceptEdits` onto the harness: a file write inside the working directory runs unasked (`claude-code/src/utils/permissions/filesystem.ts`).
Its planned form was an allow rule `{ tool: 'write_file', match: '<workspace>/*' }`.
Checked against the raw subject with workspace `/work`: `src/a.ts`, the spelling the tools tell the model to use, does not match, so an edit inside the workspace would ask; `/work/../etc/passwd` matches textually, so an edit outside would run.
The glob dialect (`*`, `?`, anchored) cannot say "relative and not climbing out", so no rule over the raw path is reliable.

## Decision

`read_file`, `write_file` and `edit_file` declare `subject: (input) => displayPath(workspace, resolveWithin(workspace, input.path).absolute)`: the path resolved against the workspace, relative with forward slashes when inside it (`src/a.ts`, whatever the model wrote), absolute when outside.
`list_files` and `search_files` keep the `pattern`.
papo's `acceptEdits` is not an allow rule but the mode's `otherwise`: for `write_file` and `edit_file`, `resolveWithin(workspace, input.path).inside` allows, anything else falls to the effects check; `session rules` shows the mode as the mode, its grant being behaviour, not a rule.
`resolveWithin` is exported from `@doopx/tools` and used by papo; it is not duplicated.

Source: user, 2026-09-16, asked "cli/04 task 04 (acceptEdits and path rules): @doopx/tools' file tools declare `subject: input.path` (raw). A rule `write_file(<workspace>/*)` cannot tell inside from outside (`src/a.ts` misses, `/work/../etc/passwd` matches). How should the subject and the acceptEdits grant work?": "Normalized subject + mode check".

## Consequences

A config or session rule on a path is written the way the workspace is seen (`{ tool: 'edit_file', match: 'src/*' }`) and cannot be slipped past with `./` or `..`; a rule on a path outside the workspace is written absolute.
`files.test.ts`'s subject assertions and the tools README say so.
`policyOf` returns one `decide`; papo has no mode-owned rule list.

## Options

The resolved absolute path as the subject with `acceptEdits` as an allow rule `${resolve(workspace)}${sep}*` was rejected: right on every probe, but every path rule a person writes would then be absolute and platform-spelled, and the mode's grant would have been a rule the person could not see the reason for.
The raw subject with a papo-only `otherwise` calling `resolveWithin` was rejected: no package but papo changes, but a config rule on a path stays unreliable, since the subject it matches is whatever the model typed.
