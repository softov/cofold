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
