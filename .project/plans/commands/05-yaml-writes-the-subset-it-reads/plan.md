---
title: "@cofold/yaml writes the subset it reads"
domain: commands
status: planned
priority: high
created: 2026-10-10
revalidated: 2026-10-10
refs:
  - "[code://packages/yaml/src/yaml.ts#L50-L62](../../../../packages/yaml/src/yaml.ts#L50-L62) - `parseYaml`, the reader the writer must round-trip with"
  - "[code://packages/yaml/src/yaml.ts#L127-L163](../../../../packages/yaml/src/yaml.ts#L127-L163) - `blockScalars`, which reads a literal block scalar"
  - "[code://packages/yaml/src/yaml.ts#L312-L336](../../../../packages/yaml/src/yaml.ts#L312-L336) - `scalar`, which decides when a plain scalar is a number, a boolean or null"
  - "[code://packages/yaml/src/index.ts](../../../../packages/yaml/src/index.ts) - the package exports"
  - "[code://docs/commands/11-yaml.md](../../../../docs/commands/11-yaml.md) - the manual page for the subset"
---

## Goal

`@cofold/yaml` gets `stringifyYaml`, which writes a JSON value as YAML in the subset `parseYaml` reads.
ahpd keeps bot records and automations as Markdown files with YAML frontmatter, and the daemon writes those files as well as reads them.
A multi-line string is written as a literal block scalar, so a long prompt reads as text in the file.

## Reconnaissance

### Searches performed

- `rg -n "stringify|dump|emit" packages/yaml/src` - the package has no writer.
- `rg -n "yaml" /github/ahpd/packages/*/package.json` - ahpd has no YAML dependency today.

### Runtime path

```
ahpd store -> stringifyYaml(record) -> frontmatter text -> file -> parseYaml -> the same record
```

### Gaps

- No function writes YAML.
- No test proves that a value survives a write and a read.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | The writer is in `@cofold/yaml`, not in ahpd | Softov, 2026-10-10, asked where YAML writing comes from: "Add stringifyYaml to cofold" |

| What | Source | Task |
| --- | --- | --- |
| `parseYaml(stringifyYaml(v))` deep-equals `v` for every JSON value | Softov, 2026-10-10, the same answer | 01 |
| A multi-line string is a literal block scalar | the reason for the format: a long prompt reads as text | 01 |

## Proposed architecture

- **Data flow** - a JSON value goes in, and YAML text in block style comes out.
- **Layer responsibilities** - `packages/yaml`: the writer, beside the reader, with no I/O.
- **Source-of-truth files** - [`code://packages/yaml/src/yaml.ts`](../../../../packages/yaml/src/yaml.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - stringifyYaml writes what parseYaml reads](task-01-stringify-yaml.md) | todo | - |
| [02 - The docs describe the writer](task-02-the-docs-describe-the-writer.md) | todo | 01 |

## Risks and tradeoffs

- A string that `scalar` reads as another type, such as `true`, `1` or `null`, must be quoted - the round-trip test covers each of them.
- A key that is not a plain key must be quoted too - the test has keys with a colon, a space and a leading dash.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stringify-yaml.md](task-01-stringify-yaml.md).
- **Open questions:** none.
- **Watch out for:** a release of `@cofold/yaml` needs Softov's approval, and ahpd uses the writer only after it is published.

## Final verification checklist

- [ ] `pnpm -r typecheck` and the `@cofold/yaml` tests pass.
- [ ] The round-trip test passes for every case in task 01.
- [ ] `plans/index.md` updated.
