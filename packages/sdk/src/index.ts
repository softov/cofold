/**
 * @facio/sdk - the contracts two packages must agree on.
 *
 * Types only, one per file: a JSON Schema and what validating against it
 * reports, and the Standard Schema interface a third-party validator is
 * handed through. Nothing here runs.
 */
export type { JsonSchema } from "./json-schema.js";
export type { JsonSchemaType } from "./json-schema-type.js";
export type { SchemaIssue } from "./schema-issue.js";
export type { SchemaResult } from "./schema-result.js";
export type { StandardSchema } from "./standard-schema.js";
export type { StandardResult } from "./standard-result.js";
export type { StandardIssue } from "./standard-issue.js";
