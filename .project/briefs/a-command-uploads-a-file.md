---
title: A command uploads a file
created: 2026-11-28
refs:
  - git://3ae42f0 - the commit of cofold the facts were checked at
  - "[code://packages/remote/src/types/manifest.ts#L22-L24](../../packages/remote/src/types/manifest.ts#L22-L24) - HttpBinding.contentType names only JSON and the URL-encoded form"
  - "[code://packages/remote/src/http.ts#L38-L49](../../packages/remote/src/http.ts#L38-L49) - httpTransport writes the body as JSON text or URLSearchParams"
  - "[code://packages/remote/src/openapi.ts#L148-L149](../../packages/remote/src/openapi.ts#L148-L149) - the reader picks JSON, then the form, and refuses every other content type"
  - "[code://packages/remote/src/openapi.ts#L69](../../packages/remote/src/openapi.ts#L69) - the reader refuses a binary or byte format in an input schema"
  - "[code://packages/remote/src/openapi.test.ts#L18-L22](../../packages/remote/src/openapi.test.ts#L18-L22) - the tests that a multipart body is refused or reported"
  - "[code://packages/remote/src/serve.ts#L205-L209](../../packages/remote/src/serve.ts#L205-L209) - the HTTP surface accepts only an application/json body and answers 415 otherwise"
  - "[code://packages/commands/src/coerce.ts#L141-L206](../../packages/commands/src/coerce.ts#L141-L206) - the coercers; none of them reads a file"
  - "[code://packages/mcp/src/index.ts#L46](../../packages/mcp/src/index.ts#L46) - inputSchemaFor, the JSON Schema an MCP tool takes"
  - "[code://CLAUDE.md#L52-L53](../../CLAUDE.md#L52-L53) - a shape two packages need lives in @cofold/sdk; zero third-party runtime dependencies on Node, Bun and Deno"
  - https://curl.se/docs/manpage.html#-F - curl's --form, multipart MIME data, checked against curl 8.14.1
  - https://spec.openapis.org/oas/v3.1.0#considerations-for-file-uploads - how OpenAPI 3.0 and 3.1 describe a file in a request body
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools - an MCP tool takes a JSON object that its inputSchema describes
  - https://nodejs.org/api/fs.html#fsopenasblobpath-options - fs.openAsBlob, a Blob that reads the file when it is sent
  - npm://s2cmd@0.1.0 - the consumer that imports OpenAPI documents through @cofold/remote
---

# A command uploads a file

Softov asked on 2026-11-28 how cofold can send `multipart/form-data` uploads.
The goal is that an OpenAPI operation with a file in its request body becomes a command that uploads the file.
The first user is s2cmd, which imports OpenAPI documents with `manifestFromOpenApi` and omits their upload operations today.

## What others do

- curl sends multipart with `-F name=@path` for a file part and `-F name=value` for a text part.
- OpenAPI 3.0 describes a file property as `type: string` with `format: binary`. OpenAPI 3.1 describes it with `contentMediaType`, as *Considerations for File Uploads* says.
- MCP has no file type. A tool takes one JSON object, and its `inputSchema` describes that object.
- Node, Bun and Deno have `FormData`, `Blob` and `fs.openAsBlob` built in.
- With `fetch`, a `FormData` that holds an `openAsBlob` file sends `multipart/form-data` with a boundary. Node 24.19, Bun 1.4.0 and Deno 2.9.6 all do this with no library.

## What cofold has today

- [`code://packages/remote/src/types/manifest.ts#L24`](../../packages/remote/src/types/manifest.ts#L24): a binding body is JSON or a URL-encoded form.
- [`code://packages/remote/src/http.ts#L38-L49`](../../packages/remote/src/http.ts#L38-L49): the transport writes one of those two bodies and sets `content-type` itself.
- [`code://packages/remote/src/openapi.ts#L148-L149`](../../packages/remote/src/openapi.ts#L148-L149): the reader refuses an operation whose body is only `multipart/form-data`.
- [`code://packages/remote/src/openapi.ts#L69`](../../packages/remote/src/openapi.ts#L69): the reader refuses `format: binary` and `format: byte` in an input.
- [`code://packages/remote/src/serve.ts#L205-L209`](../../packages/remote/src/serve.ts#L205-L209): the HTTP surface reads only JSON bodies.
- [`code://packages/commands/src/coerce.ts#L141-L206`](../../packages/commands/src/coerce.ts#L141-L206): no coercer turns a path into a file.

An OpenAPI operation can declare a file body in two ways, and the reader treats them differently:

| Request body | Today |
| --- | --- |
| `multipart/form-data` only | omitted, or a thrown error without `onUnsupported` |
| `multipart/form-data` and `application/x-www-form-urlencoded` | imported as a form |

An operation imported as a form sends only the text fields that its form body declares. It sends no file.

## Who writes

| Writer | Files it changes | Effect of this change |
| --- | --- | --- |
| Branch `pr-2`, in a worktree | none in `packages/remote`, `packages/commands` or `packages/mcp` | none |
| Plan `commands/06-a-failure-has-a-json-shape` | `packages/terminal` only | none |
| s2cmd 0.1.0 | consumes `@cofold/remote` ^0.5.0 | gets uploads from a dependency update, with no code of its own |

## The change

- `@cofold/commands` has a file coercer. On the command line, its value is a path, and the coercer checks that the file exists and is not too large.
- The file value is one type in `@cofold/sdk`, because `@cofold/commands`, `@cofold/remote` and `@cofold/mcp` all read it.
- `HttpBinding.contentType` also takes `multipart/form-data`, and the binding names its file fields.
- `httpTransport` builds a `FormData`. A file field is a `Blob` from `fs.openAsBlob`; another field is text, and an object is JSON text, as in the form body.
- `httpTransport` does not set `content-type` for a multipart body, because `fetch` writes it with the boundary.
- `manifestFromOpenApi` reads a `multipart/form-data` body. A property with `format: binary` or a `contentMediaType` becomes a file field.
- When an operation declares multipart and a form, the reader chooses multipart. A hint on the operation can choose the form.
- A binary property outside a multipart body is still refused.
- A file input has a size limit, 10 MB by default. A setting changes it. A larger file is refused before the request starts.
- An MCP tool takes a file as a local path, only when the document opts in. Without the opt-in, a command with a file has no MCP tool.
- A command with a file is not an HTTP route in `serve.ts`. [The HTTP surface reads multipart uploads](../ideas/serve-reads-multipart.md) keeps that for later.

## Answers

| What | Source |
| --- | --- |
| An MCP tool takes a local path, with an opt-in per document that is off by default | Softov, 2026-11-28: "Path, opt-in" |
| Multipart wins when an operation declares multipart and a form | Softov, 2026-11-28: "Multipart wins" |
| A command with a file is not an HTTP route for now | Softov, 2026-11-28: "not a route for now, save idea on .project for multipart" |
| The default size limit is 10 MB | Softov, 2026-11-28: "10 MB" |
| Bun and Deno can send the upload | (checked: Node 24.19, Bun 1.4.0 and Deno 2.9.6 send a multipart body with `openAsBlob` and `fetch`) |
