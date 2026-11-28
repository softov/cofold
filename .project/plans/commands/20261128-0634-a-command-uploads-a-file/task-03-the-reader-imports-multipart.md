---
title: The reader imports a multipart body
status: todo
depends: [task-02-the-transport-sends-multipart.md]
layer: "remote"
refs:
  - "[code://packages/remote/src/openapi.ts#L56-L75](../../../../packages/remote/src/openapi.ts#L56-L75) - `schemaOf`, which refuses `format: binary`"
  - "[code://packages/remote/src/openapi.ts#L146-L171](../../../../packages/remote/src/openapi.ts#L146-L171) - the body type, the options and the binding"
  - "[code://packages/remote/src/types/openapi.ts#L9-L32](../../../../packages/remote/src/types/openapi.ts#L9-L32) - `DescribedSchema` and `OpenApiOperationHint`"
  - "[code://packages/remote/src/openapi.test.ts#L18-L22](../../../../packages/remote/src/openapi.test.ts#L18-L22) - the tests that refuse a multipart body today"
  - https://spec.openapis.org/oas/v3.1.0#considerations-for-file-uploads - `format: binary` and `contentMediaType` for a file property
---

## Objective

`manifestFromOpenApi` imports a `multipart/form-data` body.
A property with `format: binary` or a `contentMediaType` becomes an option with `format: "file"`, and the binding lists it in `files`.
An operation that declares multipart and another body type imports as multipart, unless a hint chooses the other type.

## Files

- `UPDATE: packages/remote/src/types/openapi.ts:9-19` - add `contentMediaType?: string` to `DescribedSchema`.
- `UPDATE: packages/remote/src/types/openapi.ts:21-32` - add `contentType?` to `OpenApiOperationHint`, one of the three body types.
- `UPDATE: packages/remote/src/openapi.ts:56-75` - `schemaOf` takes a flag for a multipart property; with it, a binary property is `{ type: "string", format: "file" }`.
- `UPDATE: packages/remote/src/openapi.ts:146-171` - choose the body type, read the multipart schema, and fill `files`.
- `UPDATE: packages/remote/src/openapi.test.ts:18-22` - replace the two refusal tests with the cases in Validation.

## Steps

1. Add `contentMediaType` and the hint `contentType` to the types, each with a doc comment.
2. Choose the body type in this order: the hint, then multipart, then JSON, then the URL-encoded form.
3. Refuse a hint whose type the operation does not declare, with the reason in the issue.
4. For a multipart body, mark each property with `format: binary` or a `contentMediaType` as a file field.
5. Take a part's media type from `encoding.<field>.contentType`, then `contentMediaType`, else `application/octet-stream`.
6. Keep the refusal of `format: binary` and `format: byte` outside a multipart body.
7. Write the binding with `contentType: "multipart/form-data"` and `files`.

## Validation

- `openapi.test.ts`:
- a multipart-only operation imports; its file option has `format: "file"`, and its binding has `files`;
- an operation with multipart and a URL-encoded form imports as multipart;
- the same operation with the hint `contentType: "application/x-www-form-urlencoded"` imports as a form;
- `onUnsupported` gets a hint for a type that the operation does not declare;
- a `format: binary` property in a JSON body is still refused;
- a part type comes from `encoding`, then `contentMediaType`, then the default.
- `pnpm --filter @cofold/remote test` passes.

## Resume
