import { compact, type OptionSpec } from "../index.js";
import type { HttpBinding, ProgramManifest, ManifestCommand, ManifestOption } from "./manifest.js";
import type { JsonSchema } from "../core/coerce.js";

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

/**
 * An OpenAPI document, read as a command surface.
 *
 * With one honest caveat, which is why `x-cli` exists: four hundred endpoints
 * are not four hundred commands. A generated CLI that mirrors a REST API
 * one-for-one is a worse way to use that API than curl, because the names are
 * the server's internal ones and nothing is grouped the way a person works.
 *
 * So the mapping here is a *default*, meant to be overridden: `x-cli` on an
 * operation names the words, the group, and whether it is published at all. An
 * API you own should carry those hints; for one you do not, pass `hints`.
 */

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
  "x-cli"?: OpenApiOperationHint;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation> & { parameters?: readonly OpenApiParameter[] }>;
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function words(identifier: string): string[] {
  return identifier
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[_\-/]/gu, " ")
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
}

function singular(word: string): string {
  return word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * The default naming, which is a guess and says so.
 *
 * `listPets` under the tag `pets` becomes `pet list`; `showPetById` becomes
 * `pet show <petId>`. Noun first, because that is how a person looks for a
 * command - by what they are working on, not by what they are doing to it.
 */
export function patternFor(
  method: string,
  path: string,
  operation: OpenApiOperation,
  parameters: readonly OpenApiParameter[],
): string[] {
  const hint = operation["x-cli"];
  if (hint?.pattern !== undefined) return [...hint.pattern];

  const tag = operation.tags?.[0];
  const noun = singular(tag === undefined ? (words(path)[0] ?? "call") : words(tag)[0] ?? "call");
  const identifier = operation.operationId ?? `${method} ${path}`;
  const rest = words(identifier)
    .filter((word) => word !== "by" && word !== "id")
    .filter((word) => singular(word) !== noun);
  const verb = rest.length === 0 ? method.toLowerCase() : rest.join("-");
  const slots = parameters.filter((one) => one.in === "path").map((one) => `:${one.name}`);
  return [noun, verb, ...slots];
}

/** The types this library checks. Anything else a document names travels as text. */
const TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;

/**
 * A described value as this library's own schema.
 *
 * An OpenAPI schema *is* a JSON Schema, so it is kept rather than read: what
 * the document says about a value is what a client holds it to, including the
 * keywords this library has no builder for. Only `type` is narrowed, because a
 * document may name one nothing here can check.
 */
function schemaOf(described: DescribedSchema | undefined): JsonSchema {
  if (described === undefined) return { type: "string" };
  const { type, ...rest } = described;
  return { type: TYPES.find((one) => one === type) ?? "string", ...rest } as JsonSchema;
}

function optionFor(
  name: string,
  description: string,
  schema: DescribedSchema | undefined,
  required: boolean,
): OptionSpec {
  const flag = schema?.type === "boolean";
  return {
    name: `--${name.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase()}`,
    description,
    field: name,
    ...compact({
      value: flag ? undefined : (schema?.type ?? "value").toUpperCase(),
      required: required ? true : undefined,
      coerce: flag ? undefined : { schema: schemaOf(schema) },
    }),
  };
}

function manifestOption(option: OptionSpec, schema: DescribedSchema | undefined): ManifestOption {
  return {
    name: option.name,
    description: option.description,
    schema: schemaOf(schema),
    ...compact({
      value: option.value,
      required: option.required === true ? true : undefined,
      field: option.field,
    }),
  };
}

/**
 * A manifest, so an imported API and a native one are the same thing downstream.
 *
 * Deliberately not a second way of building commands: everything after this point -
 * building commands, help, completion, `--json` - is code that already exists
 * and does not need to know where the description came from.
 */
export function manifestFromOpenApi(document: OpenApiDocument, options: OpenApiOptions = {}): ProgramManifest {
  const commands: ManifestCommand[] = [];

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const shared = item.parameters ?? [];
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;

      const hint = { ...operation["x-cli"], ...options.hints?.[operation.operationId ?? ""] };
      if (hint.skip === true) continue;
      if (options.tags !== undefined && !(operation.tags ?? []).some((tag) => options.tags!.includes(tag))) continue;

      const parameters = [...shared, ...(operation.parameters ?? [])];
      const pattern = patternFor(method, path, { ...operation, "x-cli": hint }, parameters);

      const query = parameters.filter((one) => one.in === "query");
      const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
      const bodyProperties = Object.entries(bodySchema?.properties ?? {});
      const bodyRequired = new Set(bodySchema?.required ?? []);

      const optionSpecs: ManifestOption[] = [
        ...query.map((one) =>
          manifestOption(optionFor(one.name, one.description ?? `The ${one.name} query parameter`, one.schema, one.required === true), one.schema)),
        ...bodyProperties.map(([name, schema]) =>
          manifestOption(optionFor(name, schema.description ?? `The ${name} field`, schema, bodyRequired.has(name)), schema)),
      ];

      const binding: HttpBinding = {
        method: method.toUpperCase() as HttpBinding["method"],
        path: path.replaceAll(/\{([^}]+)\}/gu, "{$1}"),
        ...compact({
          query: query.length === 0 ? undefined : query.map((one) => one.name),
          body: bodyProperties.length === 0 ? undefined : bodyProperties.map(([name]) => name),
        }),
      };

      const parameterDescriptions = Object.fromEntries(parameters
        .filter((one) => one.in === "path")
        .map((one) => [one.name, {
          schema: schemaOf(one.schema),
          ...compact({ description: one.description }),
        }]));

      commands.push({
        id: operation.operationId ?? `${method}${path.replaceAll("/", ".")}`,
        pattern,
        summary: hint.summary ?? operation.summary ?? `${method.toUpperCase()} ${path}`,
        options: optionSpecs,
        http: binding,
        ...compact({
          description: operation.description,
          group: hint.group ?? operation.tags?.[0],
          arguments: Object.keys(parameterDescriptions).length === 0 ? undefined : parameterDescriptions,
        }),
      });
    }
  }

  return {
    softcli: 1,
    program: options.program ?? {
      name: document.info?.title ?? "api",
      version: document.info?.version ?? "0.0.0",
      ...compact({ description: document.info?.description }),
    },
    commands,
  };
}
