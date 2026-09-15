/**
 * What a document may say about one value, before it is narrowed.
 *
 * Deliberately looser than `JsonSchema`: this is somebody else's file, and a
 * `type` it names is a claim rather than one of the six this library checks.
 */
export interface DescribedSchema {
  type?: string;
  description?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface OpenApiOperationHint {
  /** The words, with `:name` for a path parameter: `["pet", "show", ":petId"]`. */
  pattern?: readonly string[];
  group?: string;
  summary?: string;
  /** Left out of the surface entirely. */
  skip?: boolean;
}

export interface OpenApiOptions {
  /** Keyed by operationId, merged over any `x-cli` in the document. */
  hints?: Readonly<Record<string, OpenApiOperationHint>>;
  /** Only these tags. For the usual case: a large API, a small useful corner of it. */
  tags?: readonly string[];
  program?: { name: string; version: string; description?: string };
  /** If supplied, unsupported operations are reported and omitted; otherwise they throw. */
  onUnsupported?(operation: { id: string; method: string; path: string; reason: string }): void;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: DescribedSchema;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: readonly string[];
  parameters?: readonly OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: { type?: string; properties?: Record<string, DescribedSchema>; required?: readonly string[] } }>;
  };
  security?: readonly Record<string, readonly string[]>[];
  "x-cli"?: OpenApiOperationHint;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation> & { parameters?: readonly OpenApiParameter[] }>;
}
