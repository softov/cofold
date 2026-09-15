import type { JsonSchemaType } from "./json-schema-type.js";

/**
 * The JSON Schema subset the family enforces, and the one it is shown.
 *
 * One definition for a command's input, an agent tool's input and what an
 * MCP client or an HTTP caller is told to send, so the three can never
 * disagree. It is also what `z.toJSONSchema()` produces for the ordinary
 * object, string, number, enum, array, union and nullable shapes.
 *
 * Nothing is carried that a validator in this family does not check. `$ref`,
 * `not` and `patternProperties` are absent for that reason and are refused
 * at declaration time rather than passed along.
 */
export interface JsonSchema {
  $schema?: string;
  type?: JsonSchemaType | JsonSchemaType[];
  title?: string;
  description?: string;
  default?: unknown;
  examples?: readonly unknown[];
  enum?: readonly unknown[];
  const?: unknown;
  /** Same as `type: [..., "null"]`; kept because OpenAPI 3.0 and some emitters still write it. */
  nullable?: boolean;
  // strings
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  // numbers
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  // arrays
  items?: JsonSchema;
  prefixItems?: readonly JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  // objects
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  // composition
  anyOf?: readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
}
