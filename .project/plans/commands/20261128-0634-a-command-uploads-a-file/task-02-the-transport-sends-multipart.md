---
title: The transport sends a multipart body
status: todo
depends: [task-01-a-file-field-is-a-path.md]
layer: "remote"
refs:
  - "[code://packages/remote/src/types/manifest.ts#L22-L36](../../../../packages/remote/src/types/manifest.ts#L22-L36) - `HttpBinding`, which gets the multipart type and `files`"
  - "[code://packages/remote/src/types/http.ts](../../../../packages/remote/src/types/http.ts) - `HttpTransportOptions`, which gets `maxFileBytes`"
  - "[code://packages/remote/src/http.ts#L38-L49](../../../../packages/remote/src/http.ts#L38-L49) - the URL-encoded form, the pattern the multipart body copies"
  - "[code://packages/remote/src/http.test.ts#L43-L80](../../../../packages/remote/src/http.test.ts#L43-L80) - *where the input goes*, the tests with an injected `fetch`"
  - https://nodejs.org/api/fs.html#fsopenasblobpath-options - `fs.openAsBlob(path, { type })`
---

## Objective

A binding with `contentType: "multipart/form-data"` sends its body as `FormData`.
Each field in `files` is a file part read with `fs.openAsBlob`, and every other field is a text part.
A missing file, a path that is not a regular file, and a file over `maxFileBytes` fail before the request starts.

## Files

- `UPDATE: packages/remote/src/types/manifest.ts:24` - add `"multipart/form-data"` to `contentType`.
- `UPDATE: packages/remote/src/types/manifest.ts:35` - add `files?: Readonly<Record<string, string>>`: each file field and the media type of its part.
- `UPDATE: packages/remote/src/types/http.ts` - add `maxFileBytes?: number`, 10 MB when left out.
- `UPDATE: packages/remote/src/http.ts:38-49` - build the multipart body, and set no `content-type` for it.
- `UPDATE: packages/remote/src/http.test.ts` - the cases in Validation.

## Steps

1. Add the multipart type and `files` to `HttpBinding`, each with a doc comment.
2. Add `maxFileBytes` to `HttpTransportOptions`, with the 10 MB default in its doc comment.
3. In `httpTransport`, `stat` each file path in the body before `fetch`.
4. Refuse a path that is missing, is not a regular file, or is too large.
5. Throw `ArgumentError` for those three cases, with the field name and the path.
6. Build a `FormData`: a file part is `await openAsBlob(path, { type })` with the base name of the path as its file name.
7. Send a repeated file field as one part per path, as the URL-encoded form does.
8. Send an object field as JSON text.
9. Leave `content-type` unset for a multipart body, because `fetch` writes it with the boundary.
10. Keep JSON and the URL-encoded form unchanged.

## Validation

- `http.test.ts`, with an injected `fetch` that reads the body with `new Request(url, init).formData()`:
- a file field arrives as a `File` with the base name and the bytes of the file;
- the `File` has the media type from `files`;
- a text field arrives as text, and a repeated file field arrives as two parts;
- the request has `multipart/form-data` with a boundary, and no `content-type` set by the transport;
- a missing path, a directory and a file one byte over `maxFileBytes` throw `ArgumentError`, and `fetch` is never called.
- `pnpm --filter @cofold/remote test` passes.
- By hand: the same request reaches a test server from Bun and from Deno.

## Resume
