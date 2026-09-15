import type { SchemaIssue } from "./schema-issue.js";

/** What validating a value against a `JsonSchema` reports: the value, coerced where the schema says so, or every issue at once. */
export type SchemaResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; issues: SchemaIssue[] };
