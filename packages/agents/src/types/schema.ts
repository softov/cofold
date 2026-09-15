export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  nullable?: boolean;
}

export interface SchemaIssue { path: string; message: string }
export type ValidationResult<T = unknown> = { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };
