# @facio/tools

The tools every agent on `@facio/agents` gets, as capabilities: files today; shell, web and memory follow (TOOLS-01).
Each capability is a `Capability` (its tools plus one instructions section), every tool is `createTool`, and nothing here is a second registry.
Zero dependencies beyond `node:fs` and `node:path`.

## Use

```ts
import { createAgent } from '@facio/agents';
import { files } from '@facio/tools';

const agent = createAgent({ id: 'cli', instructions, model, store, capabilities: [files()] });
```

## `files()`

Relative paths resolve against the run's workspace (`SessionRecord.workspace`; `process.cwd()` when the session has none).
Reads go anywhere; `write_file` and `edit_file` declare `effects.destructive`, so the default policy asks before them, and `resolveWithin(workspace, path).inside` is what a program's policy reads to ask only outside the workspace.

| Tool | Input | Returns |
| --- | --- | --- |
| `read_file` | `path`, `offset?` (1-based), `limit?` | Numbered lines (`  12│text`), 2000 at a time; a trailer says how many are left. Binary files are refused, lines cut at 2000 characters. |
| `write_file` | `path`, `content` | `created` or `replaced`, with the byte count; folders are made. |
| `edit_file` | `path`, `old`, `new`, `all?` | Replaces `old`, which must occur exactly once unless `all`; zero or several occurrences are refused with the count. |
| `list_files` | `pattern`, `cwd?` | One entry per line, folders with a trailing `/`; `node_modules` and `.git` skipped unless the pattern names them; 1000 entries at most. |
| `search_files` | `pattern` (regex), `path?`, `glob?`, `ignoreCase?`, `limit?` | `file:line:text` rows, 200 by default; binary files and files over 2 MiB skipped. |

`files({ maxLines, maxMatches })` changes the two defaults.
Every result is the text the model reads; every refusal is a thrown `Error` with one sentence, which the harness turns into an `isError` result.
