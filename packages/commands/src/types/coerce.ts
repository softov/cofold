/**
 * The JSON Schema subset this enforces.
 *
 * Nothing is carried that is not checked. A keyword an agent is shown and a
 * request is not held to reads as a promise, and is worse than one nobody
 * wrote - `$ref`, `anyOf`, `allOf` and `oneOf` are absent for that reason and
 * are refused at registration rather than passed along.
 */
export interface JsonSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
}

/**
 * How a word becomes a value, and what shape that value has.
 *
 * `schema` is required and `parse` is not: a value whose text reading is the
 * ordinary one for its type needs no function at all. A coercer that declares
 * one is saying its *text* form is not its value form - `KEY=VALUE` becoming a
 * pair - and `schema` then describes what arrives, because that is what a
 * client has to send and an agent has to be shown.
 */
export interface Coercer<T = unknown> {
  readonly schema: JsonSchema;
  /** Only where the text form differs from the value. Runs after `check`. */
  parse?(raw: string, label: string): T;
  /** Overrides the sentence built from the schema. */
  readonly expects?: string;
  /** Fixed candidates, when there are any. Feeds shell completion. */
  readonly candidates?: readonly string[];
}
