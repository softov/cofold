---
name: do-spec
description: Write or update the project's own documentation under .project/ (rules, specs, decisions, plans with their task files, research) in the specai 0.1 format. Use when asked to record a decision, add or retire a rule, write or correct a spec, write a plan or a task, or move a task's status.
metadata:
  specai: "0.1"
---

# Writing specai files

`.project/` describes the project to an agent and holds the work it is planning: what it does (`specs/`), what constraints apply to a change (`rules/`), why those constraints exist (`decisions/`), what is being built and in which order (`plans/`, one folder per plan, one file per task), and what was studied before deciding (`research/`).
`plans/index.md` is the entry: every plan, its status, what it requires. What the project is and the rules of its code are in `CLAUDE.md` at the repository root, not here.
`.agents/` holds only the skills; nothing else goes there.

Start every new file from its template in `assets/`, replace every `<placeholder>`, delete optional fields and sections you do not fill.

| Kind | Template | Goes in |
|---|---|---|
| rule | [assets/rule.md](assets/rule.md) | `.project/rules/<kebab-case>.md` |
| spec | [assets/spec.md](assets/spec.md) | `.project/specs/<kebab-case>.md` |
| decision | [assets/decision.md](assets/decision.md) | `.project/decisions/<kebab-case>.md` |
| plan | [assets/plan.md](assets/plan.md) | `.project/plans/<domain>/<NN>-<slug>/plan.md` |
| task | [assets/task.md](assets/task.md) | `.project/plans/<domain>/<NN>-<slug>/task-<NN>-<slug>.md` |
| domain reference | [assets/domain.md](assets/domain.md) | `.project/plans/<domain>/00-<domain>.md` |
| plans index | (kept by hand) | `.project/plans/index.md` |
| research | free Markdown with a `title` | `.project/research/<kebab-case>.md` |

## Conventions for every file

- Markdown with YAML frontmatter. `title` is required on every kind.
- Filenames are kebab-case. Plans and tasks carry a zero-padded number so the folder reads in order; everything else has no prefix. A path is an identity and never changes.
- Nothing is moved or deleted. A file that no longer applies gets a `status` in place.
- Links in the body are relative Markdown links. Paths in frontmatter (`because`, `decisions`, `changes`, `creates`, `supersedes`, `superseded-by`, `depends`, `requires`) are relative to `.project/`, except `depends` on a task, which names a sibling task file.
- `refs` is a list of where something is, never what state it is in. Every ref is a URI, `scheme://...`:
  - `code://<path>`, `code://<path>#L<n>`, `code://<path>#L<n>-L<m>` - a file or lines in this repository, relative to its root.
  - `npm://<package>`, `npm://<package>@<range>` - a package, as in `npm://@anthropic-ai/claude-agent-sdk@^0.3.273`.
  - `git://<sha>`, `git://<branch>`, `git://<tag>` - a commit, branch or tag of this repository; `git://<remote>/<sha>` for another.
  - `tasker://<instance>:<project>#<id>` - a tracker issue; `advisor://<kind>/<id>` - an Advisor record.
  - `https://...`, `file://...`, `ssh://...` - documentation, a pull request, a paper, a path outside the repository.
- Globs in `applies` and `covers` are relative to the repository root. `**` matches any depth, `*` one segment, a pattern without `/` matches a basename anywhere. A directory pattern `packages/agents/` means `packages/agents/**`.
- Long prose: one full sentence per line.
- Never an em dash; use `-`.

## Before writing

1. Read `.project/plans/index.md` and the domain's `00-<domain>.md`; they say which plans and files touch the area.
2. Check whether the thing already exists. A rule that restates an existing one is a duplicate to remove, not a file to add. A decision that changes an existing one is a new file that `supersedes` the old one. A plan for work another plan already covers is an amendment of that plan.
3. Find the references: the code, package, commit, or document this came from. They go in `refs`.

## Decision

Frontmatter: `title` as a statement, `status` (`proposed`, `accepted`, `deprecated`, `superseded`), `date` of the last status change, `supersedes` when replacing an earlier decision, `refs`. Body: `## Context`, `## Decision`, `## Consequences`, optionally `## Options`.

When superseding: set the old file's `status: superseded` and add `superseded-by` pointing at the new one. Leave its body alone. Then update every rule and spec that pointed at the old decision to point at the new one, unless the old rationale still holds. A decision has at most one `superseded-by`; the chain never cycles.

A decision that was made inside a plan (its *Decisions locked in* table) and that outlives the plan is promoted to a decision file when the plan is built; the plan's table then links it.

## Rule

Frontmatter: `title` as an imperative, `applies` globs for the files it governs (absent means everywhere), `because` listing the decisions that justify it, `status` (`active` default, `retired`). Body: the constraint in full, what to do instead, how to check, known exceptions. No rationale in the body; that is what `because` is for. A rule without `because` is allowed but will be questioned.

To retire: set `status: retired` and add one line at the top of the body saying why.

## Spec

Frontmatter: `title`, `covers` globs for the implementing code, `decisions` the behaviour rests on, `status` (`current` default, `retired`). Body: one paragraph on what the capability does as it is now, then `## Scenarios` with one `###` per scenario as `WHEN <situation> THEN <outcome>`, `AND` lines as needed. Each scenario should be turnable into a test.

A spec is corrected in place when behaviour changes; no proposal is required. If the change contradicts a listed decision, stop: that needs a new decision first.

## Plan

A plan is a folder: `plan.md` and one file per task. The folder is `plans/<domain>/<NN>-<slug>/`; `NN` is the next free number in that domain, from `plans/index.md`.

`plan.md` frontmatter: `title`, `domain`, `status` (`draft`, `planned`, `active`, `built`, `dropped`), `priority` (`low`, `medium`, `high`), `created` and `revalidated` dates, `requires` (plans or tasks that must land first), `changes` and `creates` for specs, `decisions` it rests on or proposes, `refs`.

Body, in this order:

1. `## Goal` - one paragraph, product terms, no implementation.
2. `## Reconnaissance` - what was read and searched before deciding (`### Files read`, `### Searches performed`, `### Runtime path`, `### Existing patterns to reuse`, `### Gaps`). Never empty, never from memory alone; every claim about the code names a file.
3. `## Decisions locked in` - a table `| # | Decision | Rationale / source |`. Anything not here is undecided; an undecided fork met during a task means stop, ask, then amend the table. A decision has a source: the user's words with the date, a file and line, `(defaulted: ...)`.
4. `## Proposed architecture` - data flow, event flow, state flow, layer responsibilities, source-of-truth files.
5. `## Tasks` - a table `| Task | Status | Depends on |` with one row per task file, in order. The detail lives in the task files, not here.
6. `## Risks and tradeoffs`.
7. `## Resume state` - `Done so far`, `Next action` (one task file), `Open questions` (numbered; each with the proposed answer), `Watch out for`.
8. `## Final verification checklist` - checkboxes.

A plan is forward-action-only: no history of how a decision changed, only the decision now and its source. An amended decision replaces its row.

Splitting: more than about eight tasks, or more than two packages, means a parent plan whose `## Tasks` table lists child plans (`<NN>-<slug>-p<N>-<slug>/`) instead of tasks.

To finish: every task `done`, `## Resume state` says so, `status: built`, the specs in `changes` and `creates` corrected, the index row updated.

## Task

One file per task, in the plan's folder, named `task-<NN>-<slug>.md`; `NN` is its order in the plan.

Frontmatter: `title`, `status` (`todo`, `doing`, `done`, `blocked`, `dropped`), `depends` (sibling task files that must be `done` first; empty list when none), `layer` (the package or the part of the system it touches, one per task; a change that spans layers is two tasks), `refs`.

Body:

1. `## Objective` - what is true when this task is done.
2. `## Files` - `CREATE:`, `UPDATE: path:lines`, `DELETE:` lines; nothing vague.
3. `## Steps` - what to do, in order, concrete enough to execute without reading the plan again; the plan's decisions are named by number where a step applies one.
4. `## Validation` - the tests to write or run, the commands, what is observed by hand.
5. `## Resume` - what was done, what is left, what was found; updated as the task runs. Empty until started.

A task's status moves in its own file and in the plan's `## Tasks` table, in the same change.
A task that turns out to need a decision the plan does not have is `blocked` with the question in its `## Resume` and in the plan's `Open questions`.

## Domain reference

`plans/<domain>/00-<domain>.md` describes what exists today in that domain: the packages, the entry points, the contracts, the tests. It is corrected when a plan is built. Frontmatter: `title`, `domain`, `revalidated`.

## Finishing

- No `<placeholder>` is left in the file.
- Every path in `because`, `decisions`, `changes`, `supersedes`, `superseded-by`, `requires` and `depends` resolves to a file of that kind; `creates` may point at a spec that does not exist yet.
- Every relative link in the body resolves.
- Every `status` value is one of the values listed above for its kind.
- Nothing was moved or deleted.
- `plans/index.md` has a row for every plan and the right status.
- Run the validator if the project has one; fix errors, read warnings.
