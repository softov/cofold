import type { HttpBinding, ManifestCommand, ManifestOption, ProgramManifest } from "./types/manifest.js";
import type {
  DescribedSchema,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
} from "./types/openapi.js";
import { compact, type JsonSchema, type OptionSpec } from "@cofold/commands";

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

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Default command words follow the API path; tags are help headings only. */
export function patternFor(
  _method: string,
  path: string,
  operation: OpenApiOperation,
  _parameters: readonly OpenApiParameter[],
): string[] {
  if (operation["x-cli"]?.pattern !== undefined) return [...operation["x-cli"].pattern];
  const pattern = path.split("/").filter(Boolean).map((part) => {
    if (/^\{[^}]+\}$/u.test(part)) return `:${part.slice(1, -1)}`;
    const word = part.normalize("NFKD").replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase();
    if (!word) throw new Error(`Path segment ${part} needs an explicit CLI pattern`);
    return word;
  });
  if (!pattern.length) throw new Error("A root-path operation needs an explicit CLI pattern");
  return pattern;
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
  const held = described as unknown as Record<string, unknown>;
  for (const key of ["$ref", "allOf", "anyOf", "oneOf", "not", "additionalProperties", "nullable", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems"]) {
    if (held[key] !== undefined && !(key === "nullable" && held[key] === false)) throw new Error(`Unsupported input schema keyword ${key}`);
  }
  const type = held["type"] ?? (held["properties"] ? "object" : "string");
  if (typeof type !== "string" || !(TYPES as readonly string[]).includes(type)) throw new Error(`Unsupported input type ${JSON.stringify(type)}`);
  const schema: JsonSchema = { type: type as NonNullable<JsonSchema["type"]> };
  const out = schema as Record<string, unknown>;
  for (const key of ["description", "enum", "const", "default", "minimum", "maximum", "minLength", "maxLength", "pattern"]) {
    if (held[key] !== undefined) out[key] = held[key];
  }
  if (held["format"] === "binary" || held["format"] === "byte") throw new Error("Binary input requires a file upload transport");
  if (held["format"] === "date-time") schema.format = "date-time";
  if (held["items"]) schema.items = schemaOf(held["items"] as DescribedSchema);
  if (held["properties"]) schema.properties = Object.fromEntries(Object.entries(held["properties"] as Record<string, DescribedSchema>)
    .map(([name, property]) => [name, schemaOf(property)]));
  if (Array.isArray(held["required"])) schema.required = held["required"] as string[];
  return schema;
}

function optionFor(
  name: string,
  description: string,
  schema: DescribedSchema | undefined,
  required: boolean,
): OptionSpec {
  // OpenAPI optional booleans must remain absent unless supplied or defaulted.
  return {
    name: `--${name.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase()}`,
    description,
    field: name,
    ...compact({
      value: (schema?.type ?? "value").toUpperCase(),
      required: required ? true : undefined,
      coerce: { schema: schemaOf(schema) },
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
    if (typeof (item as unknown as Record<string, unknown>)["$ref"] === "string") {
      const issue = { id: path, method: "*", path, reason: `Unresolved path reference ${(item as unknown as Record<string, unknown>)["$ref"]}` };
      if (!options.onUnsupported) throw new Error(issue.reason);
      options.onUnsupported(issue); continue;
    }
    const shared = item.parameters ?? [];
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;

      const id = operation.operationId ?? `${method}${path.replaceAll("/", ".")}`;
      const pathId = `${method}${path.replaceAll("/", ".")}`;
      const hint = { ...operation["x-cli"], ...options.hints?.[pathId], ...options.hints?.[id] };
      if (hint.skip === true) continue;
      if (options.tags !== undefined && !(operation.tags ?? []).some((tag) => options.tags!.includes(tag))) continue;

      try {
      if ((operation as unknown as Record<string, unknown>)["$ref"] !== undefined) throw new Error("Unresolved operation reference");
      const parameters = [...new Map([...shared, ...(operation.parameters ?? [])].map((one) => [`${one.in}:${one.name}`, one])).values()];
      if (parameters.some((one) => !["query", "path"].includes(one.in))) throw new Error("Header/cookie parameters must be supplied by the configured transport");
      const pattern = patternFor(method, path, { ...operation, "x-cli": hint }, parameters);

      const query = parameters.filter((one) => one.in === "query");
      const content = operation.requestBody?.content;
      const contentType = content && Object.hasOwn(content, "application/json") ? "application/json" : content && Object.hasOwn(content, "application/x-www-form-urlencoded") ? "application/x-www-form-urlencoded" : undefined;
      if (content && contentType === undefined) throw new Error(`Unsupported request content type: ${Object.keys(content).join(", ")}`);
      const bodySchema = contentType === undefined ? undefined : content?.[contentType]?.schema;
      if (bodySchema && bodySchema.type !== "object" && !bodySchema.properties) throw new Error("Request body must have object properties");
      const bodyProperties = Object.entries(bodySchema?.properties ?? {});
      const bodyRequired = new Set(Array.isArray(bodySchema?.required) ? bodySchema.required : []);
      // Compatibility with the supplied Controllr schema's field-level required flags.
      for (const [name, property] of bodyProperties) if ((property as unknown as Record<string, unknown>)["required"] === true) bodyRequired.add(name);
      const names = [...query.map((one) => one.name), ...bodyProperties.map(([name]) => name), ...parameters.filter((one) => one.in === "path").map((one) => one.name)];
      if (new Set(names).size !== names.length) throw new Error("Input names overlap between request locations");

      const optionSpecs: ManifestOption[] = [
        ...query.map((one) =>
          manifestOption(optionFor(one.name, one.description ?? `The ${one.name} query parameter`, one.schema, one.required === true), one.schema)),
        ...bodyProperties.map(([name, schema]) =>
          manifestOption(optionFor(name, schema.description ?? `The ${name} field`, schema, bodyRequired.has(name)), schema)),
      ];

      const binding: HttpBinding = {
        method: method.toUpperCase() as HttpBinding["method"],
        ...compact({ contentType }),
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
        id,
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
      } catch (error) {
        const issue = { id, method: method.toUpperCase(), path, reason: error instanceof Error ? error.message : String(error) };
        if (!options.onUnsupported) throw new Error(`${issue.method} ${path}: ${issue.reason}`);
        options.onUnsupported(issue);
      }
    }
  }

  // Distinct methods or normalized paths must never silently share one CLI command.
  const patterns = new Map<string, ManifestCommand[]>();
  for (const command of commands) {
    const key = command.pattern.map((word) => word.startsWith(":") ? ":" : word).join(" ");
    patterns.set(key, [...(patterns.get(key) ?? []), command]);
  }
  const ambiguous = new Set<ManifestCommand>();
  for (const matches of patterns.values()) {
    if (matches.length < 2) continue;
    const reason = `Ambiguous CLI pattern "${matches[0]!.pattern.join(" ")}" for ${matches.map((command) => `${command.http.method} ${command.http.path}`).join(", ")}; set explicit hints.pattern or x-cli.pattern`;
    if (!options.onUnsupported) throw new Error(reason);
    for (const command of matches) {
      ambiguous.add(command);
      options.onUnsupported({ id: command.id, method: command.http.method, path: command.http.path, reason });
    }
  }

  return {
    cofold: 1,
    program: options.program ?? {
      name: document.info?.title ?? "api",
      version: document.info?.version ?? "0.0.0",
      ...compact({ description: document.info?.description }),
    },
    commands: commands.filter((command) => !ambiguous.has(command)),
  };
}
