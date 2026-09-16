---
title: <The change, as a name>
domain: <agent | cli | tools | commands | ...>
status: draft
priority: medium
created: <YYYY-MM-DD>
revalidated: <YYYY-MM-DD>
requires:
  - plans/<domain>/<NN>-<slug>/plan.md
changes:
  - specs/<existing-spec>.md
creates:
  - specs/<new-spec>.md
decisions:
  - decisions/<decision>.md
refs:
  - code://packages/<package>/src/<file>.ts
  - npm://<package>@<range>
  - git://<sha>
---

## Goal

<One paragraph. What changes, and why, in product terms. No implementation detail.>

## Reconnaissance

### Files read

- `code://<path>#L<n>-L<m>` - <what it does today and why it matters here>.

### Searches performed

- `rg "<pattern>" <paths>` - <what was found>.

### Runtime path

```
<entry point> -> <layer> -> <contract> -> <store or event> -> <what the person sees>
```

### Existing patterns to reuse

- `code://<path>#L<n>` - <the pattern this plan mirrors>.

### Gaps

- <Missing contract, behaviour, validation, state, or test.>
- `Not found: <thing> - searched <terms> in <paths>.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | <decision> | <user's words with the date / `code://<path>#L<n>` / `(defaulted: ...)`> |

## Proposed architecture

- **Data flow** - <...>
- **Event flow** - <...>
- **State flow** - <...>
- **Layer responsibilities** - <package>: <...> · <package>: <...>
- **Source-of-truth files** - `code://<path>`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - <slug>](task-01-<slug>.md) | todo | - |
| [02 - <slug>](task-02-<slug>.md) | todo | 01 |

## Risks and tradeoffs

- <risk> - <what is done about it>.

## Resume state

- **Done so far:** <nothing; or the tasks done, with dates>.
- **Next action:** [task-01-<slug>.md](task-01-<slug>.md).
- **Open questions:**
  1. <question> - proposed: <answer>.
- **Watch out for:** <what a fresh session would get wrong>.

## Final verification checklist

- [ ] <check>
- [ ] `plans/index.md` updated.
