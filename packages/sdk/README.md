# @facio/sdk

**The contracts the facio packages share.** Types only; nothing here runs.

| Type | File | What |
| --- | --- | --- |
| `JsonSchema` | `json-schema.ts` | The JSON Schema subset every validator in the family enforces, and what `z.toJSONSchema()` emits |
| `JsonSchemaType` | `json-schema-type.ts` | The `type` keyword's vocabulary |
| `SchemaResult` | `schema-result.ts` | What validating a value reports: the value, or every issue |
| `SchemaIssue` | `schema-issue.ts` | One issue, at a dotted path |
| `StandardSchema` | `standard-schema.ts` | The Standard Schema v1 interface (Zod, Valibot, ArkType) |
| `StandardResult` | `standard-result.ts` | What its `validate` returns |
| `StandardIssue` | `standard-issue.ts` | One issue it reports |

Used by [`@facio/commands`](../commands) and [`@facio/agents`](../agents). Part of the [facio](https://github.com/softov/facio) family.

## License

MIT
