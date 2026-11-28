---
title: A command uploads a file
domain: commands
status: planned
priority: medium
created: 2026-11-28
revalidated: 2026-11-28
refs:
  - git://65d2851 - the last commit that holds the brief briefs/a-command-uploads-a-file.md, which this plan covers
  - "[code://packages/commands/src/coerce.ts#L177](../../../../packages/commands/src/coerce.ts#L177) - `timestamp`, a coercer that is a schema with a `format`; `file` copies it"
  - "[code://packages/commands/src/input.ts#L41](../../../../packages/commands/src/input.ts#L41) - `fieldsOf`, the fields of a command, which `hasFileInput` reads"
  - "[code://packages/remote/src/types/manifest.ts#L22-L36](../../../../packages/remote/src/types/manifest.ts#L22-L36) - `HttpBinding`, which names JSON and the URL-encoded form only"
  - "[code://packages/remote/src/types/http.ts](../../../../packages/remote/src/types/http.ts) - `HttpTransportOptions`, where the size limit goes"
  - "[code://packages/remote/src/http.ts#L38-L49](../../../../packages/remote/src/http.ts#L38-L49) - the body and its `content-type`; the URL-encoded form is the pattern a multipart body copies"
  - "[code://packages/remote/src/openapi.ts#L56-L75](../../../../packages/remote/src/openapi.ts#L56-L75) - `schemaOf`, which refuses `format: binary`"
  - "[code://packages/remote/src/openapi.ts#L146-L171](../../../../packages/remote/src/openapi.ts#L146-L171) - the body type, the options and the binding of one operation"
  - "[code://packages/remote/src/types/openapi.ts#L9-L32](../../../../packages/remote/src/types/openapi.ts#L9-L32) - `DescribedSchema` and `OpenApiOperationHint`"
  - "[code://packages/remote/src/manifest.ts#L72-L80](../../../../packages/remote/src/manifest.ts#L72-L80) - `manifestFrom`, which lists the commands that a server publishes"
  - "[code://packages/remote/src/serve.ts#L145-L152](../../../../packages/remote/src/serve.ts#L145-L152) - `routesOf`, the HTTP routes of a registry"
  - "[code://packages/mcp/src/index.ts#L86-L101](../../../../packages/mcp/src/index.ts#L86-L101) - `tools`, which every MCP entry point calls"
  - "[code://packages/mcp/src/types/tool.ts#L16-L22](../../../../packages/mcp/src/types/tool.ts#L16-L22) - `ToolOptions`"
  - "[code://packages/mcp/src/stdio.ts#L55](../../../../packages/mcp/src/stdio.ts#L55) - `serveStdio` passes only `filter` to `tools`, here and at line 176"
  - "[code://packages/mcp/src/server/server.ts#L54-L85](../../../../packages/mcp/src/server/server.ts#L54-L85) - the SDK server calls `tools` three times"
  - "[code://CLAUDE.md#L52-L53](../../../../CLAUDE.md#L52-L53) - zero third-party runtime dependencies, on Node, Bun and Deno"
  - https://spec.openapis.org/oas/v3.1.0#considerations-for-file-uploads - `format: binary` in OpenAPI 3.0 and `contentMediaType` in 3.1
  - https://nodejs.org/api/fs.html#fsopenasblobpath-options - `fs.openAsBlob`, a `Blob` that reads the file when it is sent
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools - a tool takes one JSON object
---

## Goal

An OpenAPI operation with a file in a `multipart/form-data` body becomes a command that uploads the file.
On the command line, the file is a path.
An MCP tool takes the path only when the program allows it, because the agent can then upload any file that the user can read.
s2cmd gets the upload commands from a dependency update.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "multipart|FormData|openAsBlob" packages` - only the two tests in `packages/remote/src/openapi.test.ts` that refuse a multipart body.
- `rg -l "from \"node:" packages/commands/src packages/remote/src packages/mcp/src` - `@cofold/commands` imports no Node module; `@cofold/remote` imports `node:fs/promises` in `cache.ts`.
- `rg "tools\(" packages/mcp/src` - `stdio.ts` and `server/server.ts` call `tools`; nothing else lists MCP tools.
- `rg "format" packages/sdk/src` - the validator checks only `date-time`, so a `file` format passes as text.
- `rg "code://packages/(commands|remote|mcp)/" .project/plans` - only built plans, and `commands/06-a-failure-has-a-json-shape`, which changes `packages/terminal` only.

### Runtime path

```
OpenAPI document -> manifestFromOpenApi -> ManifestOption { schema.format: "file" } + HttpBinding { multipart, files }
  -> commandsFrom -> Command -> argv `--file ./a.png` -> canonical input { file: "./a.png" }
  -> httpTransport -> stat, openAsBlob -> FormData -> fetch -> the server
```

### Gaps

- No coercer or schema marker says that a value is a path to a file.
- `HttpBinding` cannot say multipart, and `httpTransport` cannot build a multipart body.
- `manifestFromOpenApi` refuses a multipart body and a binary property.
- Nothing stops an MCP tool or an HTTP route from reading a path that the caller chose.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An MCP tool takes a file as a local path, only when the program opts in; the opt-in is off by default | Softov, 2026-11-28: "Path, opt-in" | 04 |
| When an operation declares multipart and a form, the reader chooses multipart; a hint can choose the form | Softov, 2026-11-28: "Multipart wins" | 03 |
| A command with a file is not an HTTP route for now; the idea is `ideas/serve-reads-multipart.md` | Softov, 2026-11-28: "not a route for now, save idea on .project for multipart" | 04 |
| A file is 10 MB at most by default, and a transport option changes the limit | Softov, 2026-11-28: "10 MB" | 02 |
| The upload uses `FormData`, `Blob`, `fs.openAsBlob` and `fetch`, with no dependency | (checked: Node 24.19, Bun 1.4.0 and Deno 2.9.6 send a multipart body this way) | 02 |
| The canonical value of a file field is its path, a string; no new type goes in `@cofold/sdk` | (defaulted: a path is a string on every surface, so `JsonSchema` already carries it) | 01 |
| A file field is a string schema with `format: "file"` | (defaulted: the marker that `timestamp` uses for `date-time`) | 01 |
| `@cofold/remote` checks the file and reads it; `@cofold/commands` imports no Node module | (defaulted: [code://packages/commands/src/coerce.ts#L177](../../../../packages/commands/src/coerce.ts#L177) is pure, and `remote` already imports `node:fs`) | 02 |
| The size option is `maxFileBytes` on `HttpTransportOptions` | (defaulted) | 02 |
| The MCP opt-in is `allowFiles: true` on `ToolOptions`, `StdioOptions` and `McpServerOptions` | (defaulted) | 04 |
| A file part's name is the base name of the path, and its type is the one the document names for the part, else `application/octet-stream` | (defaulted) | 02 |
| A repeated file field sends one part per file, under the same name | (defaulted: the URL-encoded form repeats a field the same way) | 02 |

## Proposed architecture

- **Data flow** - A path enters as text on the command line or in an MCP call, and stays a string in the canonical input. `httpTransport` turns it into a `Blob` part when it builds the request.
- **Event flow** - none.
- **State flow** - none; nothing is stored.
- **Layer responsibilities**:
  - commands: the `file` coercer and `hasFileInput(command)`.
  - remote: the multipart binding, the transport and the OpenAPI reader. `serve` and `manifestFrom` leave out file commands.
  - mcp: `tools` leaves out file commands unless `allowFiles` is set.
- **Source-of-truth files** - [`code://packages/commands/src/coerce.ts`](../../../../packages/commands/src/coerce.ts) for the marker, [`code://packages/remote/src/http.ts`](../../../../packages/remote/src/http.ts) for the upload.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a file field is a path](task-01-a-file-field-is-a-path.md) | todo | - |
| [02 - the transport sends a multipart body](task-02-the-transport-sends-multipart.md) | todo | 01 |
| [03 - the reader imports a multipart body](task-03-the-reader-imports-multipart.md) | todo | 02 |
| [04 - a file needs an opt-in on MCP](task-04-a-file-needs-an-opt-in.md) | todo | 01 |
| [05 - the docs and the versions](task-05-the-docs-and-the-versions.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- An operation that declares multipart and a form changes its options from the form's text fields to the file field. A script that calls the old options breaks. A hint chooses the form back.
- A path in an MCP call is a read of any file that the user can read. The opt-in is off by default, and *Answers* names who sets it.
- A native command with a `file` option and an `http` surface is not served and not published. Without this, a client could make the server upload a server file by naming its path.
- s2cmd needs its own change to use the opt-in: a document setting that sets `allowFiles`. That change is in s2cmd, after this plan ships.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-file-field-is-a-path.md](task-01-a-file-field-is-a-path.md).
- **Open questions:** none.
- **Watch out for:** `fetch` writes the multipart `content-type` with its boundary, so the transport must not set that header.

## Final verification checklist

- [ ] `pnpm check` is clean.
- [ ] A multipart-only operation imports as a command, and its `--file` uploads the file to a test server.
- [ ] An operation with multipart and a form imports as multipart, and a hint makes it a form.
- [ ] A missing file and a file over `maxFileBytes` fail before the request starts.
- [ ] `tools()`, `serveStdio` and the SDK server list no file command without `allowFiles`, and list it with `allowFiles: true`.
- [ ] `serve` and `manifestFrom` leave out a command with a file field.
- [ ] The upload test passes on Node; the same body was checked on Bun and Deno by hand.
