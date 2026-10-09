---
title: A write through a dangling link creates its target
domain: tools
status: built
priority: high
created: 2026-10-09
revalidated: 2026-10-09
decisions: []
refs:
  - "[code://packages/tools/src/files.ts#L302-L331](../../../../packages/tools/src/files.ts#L302-L331) - `openChecked`, which creates a missing file at `resolved.absolute`, the link itself"
  - "[code://packages/tools/src/paths.ts#L9-L39](../../../../packages/tools/src/paths.ts#L9-L39) - `real` is the target of a dangling link, and `inside` is judged on it"
  - "[code://packages/tools/src/files.test.ts#L130-L175](../../../../packages/tools/src/files.test.ts#L130-L175) - the link tests of the write tools"
  - file:///github/ahpd/.project/plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md - where the create that refuses an existing name was chosen
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan whose two dangling-link rows fail on this
---

## Goal

A write to a link whose target does not exist creates the target, as cofold 0.1 did.
Today the create runs at the name of the link, finds the link there, and refuses with "changed after it was checked".
A link or file put at the target between the check and the write still makes the write fail.

## Reconnaissance

### Searches performed

- ahpd plugin/40 on `@cofold/tools` 0.3.0: two rows write through `dl -> <outside>/new.txt` with permissions bypassed.
- Both rows get "dl changed after it was checked; nothing was written".
- `openChecked` stats `resolved.real`, gets ENOENT, then opens `resolved.absolute` with `wx`.
- For a dangling link, `resolved.absolute` is the link and `resolved.real` is its target.

### Runtime path

```
write dl -> resolveWithin: absolute = <ws>/dl, real = <outside>/new.txt
openChecked -> stat(real) ENOENT -> open(absolute, 'wx') -> EEXIST (the link) -> "changed"
```

### Gaps

- The create opens the lexical path, not the path the check was made on.
- No cofold test writes through a dangling link.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A write through a dangling link creates its target | Softov, 2026-10-09, asked "When the model writes to a link whose target file does not exist yet, what should happen?": "Create at the target" | 01 |
| The create opens `resolved.real` with `wx`, so a name put at the target first still fails the open | the plugin/22 rule that a write lands where it was allowed | 01 |
| The change is tested against ahpd plugin/40 with a packed tarball before Softov releases it | the memory `test-the-consumer-before-a-release` | 02 |

## Proposed architecture

- **State flow** - `openChecked` creates a missing file at `resolved.real`, the path its `stat` checked, and makes the folders of that path.
- **Layer responsibilities** - tools: where a write lands. agents and store-file: unchanged.
- **Source-of-truth files** - [`code://packages/tools/src/files.ts`](../../../../packages/tools/src/files.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A missing file is created at the path that was checked](task-01-a-missing-file-is-created-at-the-checked-path.md) | done | - |
| [02 - The change is tested against ahpd before any release](task-02-release-tested-against-ahpd.md) | done | 01 |

## Risks and tradeoffs

- A write through a dangling link can make folders on the target's side; it is allowed only where `inside` or the mode allows the target.
- Folders above the target that change between the check and the open are not checked, as now.

## Resume state

- **Done so far:** tasks 01 and 02; see [implemented.md](implemented.md).
- **Next action:** none; the release is Softov's.
- **Open questions:** none.
- **Watch out for:** the error for EEXIST stays "changed": at the target, it now means a name was put there.

## Final verification checklist

- [x] A write through a dangling link creates its target and leaves the link in place.
- [x] A file put at the target before the open fails the write and is not changed.
- [x] ahpd plugin/40's two dangling-link rows pass against the packed package.
- [x] `plans/index.md` updated.
