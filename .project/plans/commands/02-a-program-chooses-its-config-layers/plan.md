---
title: A program chooses its configuration layers and names its project file
domain: commands
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
refs:
  - "[code://packages/config/src/index.ts#L75-L133](../../../../packages/config/src/index.ts#L75-L133) - `resolveConfig`: base, user, project, environment and explicit layers, all always on"
  - "[code://packages/config/src/index.ts#L141-L157](../../../../packages/config/src/index.ts#L141-L157) - `findUp` builds `.<name><ext>`, so the project file always starts with a dot"
  - "[code://packages/config/src/index.ts#L64-L66](../../../../packages/config/src/index.ts#L64-L66) - `environmentNameOf`, the `<NAME>_CONFIG` variable"
  - "[code://packages/config/src/types/config.ts](../../../../packages/config/src/types/config.ts) - `ConfigOptions`, where the new options go"
  - "[code://packages/config/src/index.test.ts](../../../../packages/config/src/index.test.ts) - the layer tests the new cases join"
  - "[code://packages/papo/src/config.ts#L131](../../../../packages/papo/src/config.ts#L131) - the one caller, which relies on the project layer"
  - "file:///github/ahpd/.project/plans/daemon/08-the-config-file-is-checked-in-one-place/plan.md - the first consumer: ahpd reads its file through this"
---

## Goal

A program using `@cofold/config` says which layers it reads and what its project file is called.
The project file is read only when the program names it, with any name, with or without a leading dot. The user and environment layers can each be turned off.
A program that wants today's project file passes its name; papo passes `.papo.json`.

## Reconnaissance

The files read are the `refs` above.

### Searches performed

- `rg "findUp|environmentNameOf|optional\(\"user\"" packages/config/src` - one resolver, every layer unconditional.

### Runtime path

```
resolveConfig(options) -> base -> user (~/.config/<name>/config<ext>) -> project (findUp .<name><ext>) -> environment ($<NAME>_CONFIG) -> explicit (path) -> merged values + sourceOf
```

### Gaps

- The project file name is always `.<name><ext>`.
- No layer can be turned off, so a program whose named file must replace the others cannot use the resolver.

## Decisions locked in

No decision records; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| `project`: a file name (any name, path segments allowed, no dot added); absent means no project layer | Softov, 2026-09-28, asked "What should the @cofold/config adjustment be?": "Project file named, layers optional", then: reading the workspace config "could be opt-in" | 01 |
| papo passes `project: '.papo.json'`, so its behaviour does not change | the one caller of the project layer | 01 |
| `user: false` skips the user file, and `environment`: a variable name or `false`; absent keeps today's behaviour | the same answer | 01 |

## Proposed architecture

- **Data flow** - `ConfigOptions` gains `user?: boolean`, `project?: string` and `environment?: string | false`; `resolveConfig` skips the user or environment layer set to `false` and looks for a project file only when `project` names one, as written.
- **Layer responsibilities** - `@cofold/config`, and papo's one call.
- **Source-of-truth files** - [`code://packages/config/src/index.ts`](../../../../packages/config/src/index.ts), [`code://packages/config/src/types/config.ts`](../../../../packages/config/src/types/config.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The layers and the project file name are options](task-01-the-layers-are-options.md) | done | - |

## Risks and tradeoffs

- A `project` value with a path separator (`.ahpd/config.json`) is found upward like a plain name; `findUp` joins it to each directory, which already works for a relative path.

## Resume state

- **Done so far:** task 01 done 2026-09-28 (`c7835d6`, released as `@cofold/config` 0.3.0 under `release-2026-09-28-2`), checked by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the version. Dropping the default project layer changes what an existing caller reads, so the release notes say to pass `project`. Softov chooses the version and publishes; ahpd's daemon/08 waits for the release.

## Final verification checklist

- [x] Every existing `@cofold/config` test passes, the project-layer ones passing `project` explicitly.
- [x] papo still reads `.papo.json`.
- [x] `plans/index.md` updated.
