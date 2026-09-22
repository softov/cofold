# @cofold/sdk

**What the cofold packages share.** A JSON Schema, the one validator that holds a value to it, and the Standard Schema interface. No dependencies.

| Type | File | What |
| --- | --- | --- |
| `validateSchema({ schema, value })` | `validate-schema.ts` | Every issue at once, or the value with defaults filled; never throws |
| `assertSupportedSchema({ schema, path? })` | `validate-schema.ts` | Refuses at declaration time what the validator cannot hold a value to |
| `JsonSchema` | `json-schema.ts` | The JSON Schema subset every validator in the family enforces, and what `z.toJSONSchema()` emits |
| `JsonSchemaType` | `json-schema-type.ts` | The `type` keyword's vocabulary |
| `SchemaResult` | `schema-result.ts` | What validating a value reports: the value, or every issue |
| `SchemaIssue` | `schema-issue.ts` | One issue, at a dotted path |
| `StandardSchema` | `standard-schema.ts` | The Standard Schema v1 interface (Zod, Valibot, ArkType) |
| `StandardResult` | `standard-result.ts` | What its `validate` returns |
| `StandardIssue` | `standard-issue.ts` | One issue it reports |

Used by [`@cofold/commands`](../commands) and [`@cofold/agents`](../agents). Part of the [cofold](https://github.com/softov/cofold) family.

## License

MIT
