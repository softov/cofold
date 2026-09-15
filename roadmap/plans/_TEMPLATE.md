<!--
Domain: <domain>
Status: Not started | In progress | Blocked | Partial | Shipped
Priority: Low | Medium | High
Created: YYYY-MM-DD
Revalidated: YYYY-MM-DD
Dependencies: <relative links to plans that must land first, or —>
Reference: ./00-<domain>.md
-->

# <DOMAIN-NN> — <Plan title>

_Status: Not started · Priority: Medium · Created: YYYY-MM-DD_

## Goal

One paragraph. What changes, and why, in product terms. No implementation detail here.

## Reconnaissance

Grounds the whole plan. Filled during Gate 1 — never empty, never SDK-only.

### Files read

- `path/file.ts` — why it matters / what it currently does.

### Searches performed

- `rg "TypeName|EventName"` — result summary.

### Runtime path

```
entrypoint → controller/bridge → service/manager → sdk contract → store/event → UI effect
```

### Existing patterns to reuse

- `path/file.ts:line` — the pattern this plan mirrors.

### Gaps

- Missing contract / behavior / validation / UI state / tests.
- `Not found: <thing> — searched <terms> in <paths>.`

## Decisions locked in

Every decision settled by the notes, the code, or a question answered before writing. Anything not
here is undecided — and an undecided fork hit during implementation means STOP and ask, then amend.

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | <decision> | <user answer / code evidence / `(defaulted: …)`> |

## Proposed architecture

- **Data flow** — …
- **Event flow** — …
- **State flow** — …
- **Layer responsibilities** — sdk: … · pood: … · web: …
- **Source-of-truth files** — `packages/sdk/src/...`

## Phases

> If this plan was split, this section is a phase map linking child plans instead. See README.

### Phase 1 — <objective>

**Objective:** …
**Expected result:** …
**Validation:** …

#### Task: <clear task name>

- **Layer:** sdk | pood | web  _(one task per layer if it spans layers)_
- **Files:**
  - `CREATE: packages/.../file.ts`
  - `UPDATE: pood/src/.../file.ts:120-145`
  - `DELETE: …` _(omit lines that don't apply)_
- **Reason:** why this task exists.
- **Integration points:** how it wires to events / routes / stores / runtime.
- **Data contracts:**
  ```ts
  import type { SomeRealType } from '@opendoop/sdk/...';
  ```
- **Code:**
  ```ts
  // real example using real names — not pseudocode
  ```
- **Validation:** expected behavior + how to check (test / manual / logs).

## Cross-layer consistency

Keep sdk ↔ pood ↔ web aligned. One concept, one type, referenced from the SDK source-of-truth file.
List every layer this plan touches and the shared shape each uses.

## Risks & tradeoffs

- <only the relevant risks>

## Resume state

Checkpoint so a fresh session can continue cold.

- **Done so far:** <phases/tasks completed, with commit/file evidence>
- **Next action:** <the single next concrete step>
- **Open questions:** <should be none; if any, the plan is not ready>
- **Watch out for:** <gotchas discovered mid-implementation>

## Final verification checklist

- [ ] All phases' validation steps pass.
- [ ] `pnpm typecheck` clean (or named workspace).
- [ ] Relevant tests pass.
- [ ] No contract drift — shared shapes come from the SDK.
- [ ] `index.md` status updated.
