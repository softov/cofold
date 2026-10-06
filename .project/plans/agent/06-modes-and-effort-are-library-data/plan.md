---
title: Permission modes and reasoning effort are library data
domain: agent
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
refs:
  - "[code://packages/agents/src/types/policy.ts#L26](../../../../packages/agents/src/types/policy.ts#L26) - `PermissionMode`, the six names, a type only"
  - "[code://packages/agents/src/policy/modes.ts#L41](../../../../packages/agents/src/policy/modes.ts#L41) - `policyOf`, what a mode becomes"
  - "[code://packages/agents/src/types/model.ts#L13-L14](../../../../packages/agents/src/types/model.ts#L13-L14) - `ReasoningEffort`, the providers' whole range (decision 98)"
  - "[code://packages/model-openai-compat/src/index.ts#L12](../../../../packages/model-openai-compat/src/index.ts#L12) - `DEFAULT_FEATURES.reasoning` is false"
  - "[code://packages/model-openai-compat/src/index.ts#L101-L102](../../../../packages/model-openai-compat/src/index.ts#L101-L102) - `model(args)`: features are the defaults over `args.features`"
  - "[code://packages/model-openai-compat/src/index.ts#L123](../../../../packages/model-openai-compat/src/index.ts#L123) - reasoning is sent only when `params.reasoning && features.reasoning`"
  - "[code://packages/papo/src/agent.ts#L64-L72](../../../../packages/papo/src/agent.ts#L64-L72) - papo passes `params.reasoning` and no features, so its effort never reaches the request"
  - "[code://packages/papo/src/types/settings.ts#L23-L24](../../../../packages/papo/src/types/settings.ts#L23-L24) - papo's `PERMISSION_MODES` (four) and `REASONING_LEVELS`"
  - "[code://packages/papo/src/config.ts#L39](../../../../packages/papo/src/config.ts#L39) - the `permissions` enum"
  - "[code://packages/papo/src/config.ts#L45](../../../../packages/papo/src/config.ts#L45) - the `reasoning` enum"
  - "[code://packages/papo/src/commands.ts#L26](../../../../packages/papo/src/commands.ts#L26) - the `--reasoning` option's enum"
  - file:///github/ahpd/.project/decisions/permission-modes-live-in-the-harness.md - ahpd's accepted decision (2026-09-20): the agents package owns the modes; thinking is `off`, `low`, `medium`, `high`
  - file:///github/ahpd/packages/agent-cofold/src/agent.ts - lines 124-158 `PERMISSION_MODES`, `PERMISSION_LABELS`, `PERMISSION_DESCRIPTIONS`, `EFFORT_LEVELS`, `effortOf`; line 374 forces `features.reasoning`
---

## Goal

A host takes the list of permission modes with what each one does, and the list of thinking levels with their parser, from `@cofold/agents`, and draws only its own labels.
Choosing a thinking level reaches the model request without the host also switching a feature on, which fixes papo's effort setting that does nothing today.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg -n "PERMISSION_MODES|EFFORT_LEVELS|REASONING_LEVELS|effortOf" packages` and in ahpd - papo's `types/settings.ts:23-24`; ahpd's `agent.ts:124-158`; nothing in `@cofold/agents`.
- `rg -n "features.reasoning|reasoning: true" packages` - only the adapter's gate and tests set it; papo never does.
- `rg -n "code://packages/agents/src/policy/modes.ts|code://packages/agents/src/types/policy.ts" .project/` - nothing.

### Runtime path

```
host setting (mode, level) -> PERMISSION_MODES / EFFORT_LEVELS -> policyOf(mode) / effortOf(level)
  -> params.reasoning -> openaiCompatProvider(...).model({ params }) -> features.reasoning on -> request body `reasoning`
```

### Gaps

- `@cofold/agents` has the mode type and `policyOf`, but not the list or what each mode does.
- No shared list or parser for the levels a host offers; both hosts keep a copy.
- `params.reasoning` without `features.reasoning` is silently dropped.

## Decisions locked in

None: every row is a task.

| What | Source | Task |
| --- | --- | --- |
| `PERMISSION_MODES` (the six, in ahpd's order: `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk`) and `PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string>` (ahpd's six sentences) in `@cofold/agents`; labels stay in each host | ahpd decision `permission-modes-live-in-the-harness` (accepted 2026-09-20): the agents package owns the modes, and its list did not move; Softov, 2026-10-06, chose "C: modes and effort as library data" | 01 |
| `EFFORT_LEVELS = ['off', 'low', 'medium', 'high']`, `type EffortLevel`, and `effortOf(value: unknown): ReasoningEffort \| undefined` (`off`, missing and unknown give `undefined`) beside `ReasoningEffort`, which keeps its six values | the same ahpd decision, point 5 ("the harness's own four levels"); ahpd `agent.ts:147-158` | 02 |
| A model whose `params.reasoning` is set has `features.reasoning` on, unless `features.reasoning` is given as `false` | the facts of 2026-10-06: papo's effort never reaches the request; ahpd forces the feature at `agent.ts:374` | 03 |
| papo takes the shared lists: its four modes are `PERMISSION_MODES` filtered to the four it offers, its levels are `EFFORT_LEVELS`, its `reasoning` param comes from `effortOf`, and its schema and option enums are built from them | Softov, 2026-10-06 (the brief: "papo switches to the shared lists"); papo's four modes per cli/03 F8 | 04 |
| No `titleOf` helper: ahpd cuts at 200 and at 60, papo at 60 with an ellipsis, so a shared one would need a length each surface already chose for itself | (defaulted: the brief allowed leaving it out unless it stays small) | - |
| ahpd drops its copies after a cofold release, in an ahpd plan; its labels stay | Softov, 2026-10-06 (the brief) | 05 |

## Proposed architecture

- **Data flow** - constants and one parser in `@cofold/agents`; the adapter derives one feature from its params.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - agents: the lists, the descriptions, `effortOf` · model-openai-compat: the feature default · papo: uses them.
- **Source-of-truth files** - [`code://packages/agents/src/policy/modes.ts`](../../../../packages/agents/src/policy/modes.ts), [`code://packages/model-openai-compat/src/index.ts`](../../../../packages/model-openai-compat/src/index.ts)

```ts
// packages/agents/src/policy/modes.ts
export const PERMISSION_MODES: readonly PermissionMode[];
export const PERMISSION_MODE_DESCRIPTIONS: Readonly<Record<PermissionMode, string>>;

// packages/agents/src/model/effort.ts
export const EFFORT_LEVELS: readonly ['off', 'low', 'medium', 'high'];
export type EffortLevel = (typeof EFFORT_LEVELS)[number]; // the type goes in types/model.ts
export function effortOf(value: unknown): ReasoningEffort | undefined;
```

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The permission modes and what each does](task-01-the-permission-modes.md) | todo | - |
| [02 - The thinking levels and their parser](task-02-the-thinking-levels.md) | todo | - |
| [03 - A reasoning param turns reasoning on](task-03-a-reasoning-param-turns-reasoning-on.md) | todo | - |
| [04 - papo takes the shared lists, and its effort reaches the request](task-04-papo-takes-the-shared-lists.md) | todo | 01, 02, 03 |
| [05 - The READMEs, and ahpd's copies](task-05-readmes-and-ahpd.md) | todo | 01, 02, 03 |

## Risks and tradeoffs

- The plan spans three packages, which do-spec would make a parent; it stays one plan because Softov asked for four plans, and each task stays inside one package.
- A model that cannot reason but is given `params.reasoning` now gets the field; the endpoint may refuse it, which is the provider's error (decision 98), and `features: { reasoning: false }` turns it off.
- papo's config accepts the same four modes as before; offering `plan` and `auto` stays a later papo change.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-permission-modes.md](task-01-the-permission-modes.md).
- **Open questions:** none.
- **Watch out for:** tools/02 also edits `policy/modes.ts` (the `isEdit` default); keep both changes. The descriptions are library text a host may show, so they are plain sentences with no internals.

## Final verification checklist

- [ ] `PERMISSION_MODES`, `PERMISSION_MODE_DESCRIPTIONS`, `EFFORT_LEVELS` and `effortOf` are exported from `@cofold/agents`.
- [ ] `openaiCompatProvider(...).model({ id, params: { reasoning: { effort: 'high' } } })` sends `reasoning` in the body.
- [ ] papo with `reasoning: high` sends `reasoning` in the request body.
- [ ] `pnpm check` in cofold is clean.
- [ ] `plans/index.md` updated.
