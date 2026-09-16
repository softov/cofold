---
name: do-spec
description: Write or update the project's documentation under .project/ (plans with their task files, implemented and deferred records, specs, rules, decisions, research) in the specai 0.1 format. Use when asked to write or amend a plan or a task, move a task's status, close a plan, record a decision, add or retire a rule, or write or correct a spec.
metadata:
  specai: "0.1"
---

# Writing specai files

`.project/` holds what the project is building and why. `.agents/` holds only skills.
Start every file from its template in `assets/`; the template says what goes in each field and section. Replace every `<placeholder>`, delete what you do not fill.

| Kind | Template | Path |
|---|---|---|
| plan | [plan.md](assets/plan.md) | `.project/plans/<domain>/<NN>-<slug>/plan.md` |
| task | [task.md](assets/task.md) | same folder, `task-<NN>-<slug>.md` |
| implemented | [implemented.md](assets/implemented.md) | same folder, `implemented.md` |
| deferred | [deferred.md](assets/deferred.md) | same folder, `deferred.md` |
| domain reference | [domain.md](assets/domain.md) | `.project/plans/<domain>/00-<domain>.md` |
| spec | [spec.md](assets/spec.md) | `.project/specs/<slug>.md` |
| rule | [rule.md](assets/rule.md) | `.project/rules/<slug>.md` |
| decision | [decision.md](assets/decision.md) | `.project/decisions/<slug>.md` |
| research | Markdown with a `title` | `.project/research/<slug>.md` |

`.project/plans/index.md` is the entry: one row per plan, kept by hand.

## Conventions

- Frontmatter on every file; `title` always. Slugs are kebab-case; only plans and tasks carry a number.
- A path is an identity: nothing is moved or deleted; what no longer applies gets a `status`.
- Paths in frontmatter are relative to `.project/`, except a task's `depends`, which names sibling task files.
- `refs` say where something is, never its state, one per line as `<uri> - <one line on why it is here>`. A ref is a URI: `code://<path>#L<n>-L<m>`, `npm://<package>@<range>`, `git://<sha|branch|tag>`, `tasker://<instance>:<project>#<id>`, `https://...`, `file://...`. A plan's files read and patterns to reuse are its refs; nothing lists them twice.
- Globs (`applies`, `covers`) are relative to the repository root.
- One full sentence per line in prose. Never an em dash.

## Statuses

- plan: `draft` `planned` `active` `built` `dropped`
- task: `todo` `doing` `done` `blocked` `dropped`
- decision: `proposed` `accepted` `deprecated` `superseded`
- rule: `active` `retired` · spec: `current` `retired`

## Plans

A plan is a folder: `plan.md`, one task file per task, and two files whose presence is their meaning:

- `implemented.md` exists when the plan is built: what exists now, what was verified, where it departed from the plan.
- `deferred.md` exists when the plan set something aside: what waits, why, where it goes.

`plan.md` is forward-action-only: the decision now and its source, never how it changed.
Anything not in *Decisions locked in* is undecided; a fork met during a task means stop, ask, amend the table.
A task's status moves in its own file and in the plan's *Tasks* table in the same change; the plan's *Resume state* and `index.md` move with it.
A plan that spans more than two packages or about eight tasks is a parent whose *Tasks* table lists child plans (`<NN>-<slug>-p<N>-<slug>/`).

To close a plan: every task `done` or `dropped`, `implemented.md` written, `deferred.md` written if anything waits, `status: built`, specs in `changes` and `creates` corrected, the index row updated.

## Decisions, rules, specs

- A decision that replaces another is a new file with `supersedes`; the old one gets `status: superseded` and `superseded-by`, body untouched; rules and specs that pointed at the old one move to the new one unless the old rationale still holds.
- A decision made in a plan's table and outliving the plan is promoted to a decision file when the plan closes; the table then links it.
- A rule restating another is removed, not added. To retire one: `status: retired` and one line at the top saying why.
- A spec is corrected in place when behaviour changes; if the change contradicts a listed decision, a new decision comes first.

## Before writing

1. Read `.project/plans/index.md` and the domain's `00-<domain>.md`.
2. Check the thing does not already exist; amend rather than duplicate.
3. Find the refs: the code, package, commit or document it came from.

## Finishing

- No `<placeholder>` left. Every frontmatter path and every relative link resolves (`creates` may name a spec not yet written).
- Every `status` is one of the values above for its kind.
- `index.md` has the row and the status.
