/**
 * @doopx/commands - a command is data.
 *
 * Nothing in this package knows what a terminal is. It holds the declaration
 * (`command.ts`), the capabilities a command declares it needs (`registry.ts`),
 * the one object every surface turns its arguments into (`input.ts`), the
 * three readings of a result (`context.ts`), and the grammar a line of
 * arguments is read with (`argv.ts`) - a grammar rather than a device, which
 * is why it is here. `types/` holds the contracts and nothing else; the file of
 * the same name beside it is the runtime. The surfaces - the CLI, MCP, the generated reference -
 * are renderings of what is here, and each of them is small because all of
 * the meaning is in this package.
 */
export { matchCommand, optionTable, tokenize } from "./argv.js";
export * as coerce from "./coerce.js";
export { check, coerceValue, decode, expectationOf } from "./coerce.js";
export {
  commandPattern,
  fieldNameOf,
  fullyNamed,
  isFlag,
  literalPrefix,
  optionNotes,
  optionsOf,
  parsePattern,
  surfaceEnabled,
  underPrefix,
  visible,
} from "./command.js";
export { compact } from "./compact.js";
export { displayValue } from "./display.js";
export {
  BaseContext,
  output,
  RESERVED_CONTEXT_KEYS,
  silentIo,
} from "./context.js";
export {
  ArgumentError,
  AuthorizationError,
  ConfigurationError,
  DoopxError,
  UnavailableError,
  exitCodeFor,
} from "./errors.js";
export { argumentFields, canonicalFromCli, canonicalFromObject, fieldsOf } from "./input.js";
export { commandFor } from "./command.js";
export { createRegistry, Registry, sectionsOf, validateCommand } from "./registry.js";
export { isStandardSchema, validate } from "./schema.js";
export { didYouMean, suggest } from "./suggest.js";

// contracts
export type { Match, OptionTableEntry, Tokens } from "./types/argv.js";
export type { Coercer } from "./types/coerce.js";
export type {
  ActionDefinition,
  Command,
  CommandDefinition,
  CommandExample,
  CommandGroup,
  CommandMeta,
  CommandSection,
  PatternToken,
  Surface,
  SurfaceFlags,
  Surfaces,
} from "./types/command.js";
export type { Compacted } from "./types/compact.js";
export type { CommandContext, Io, Output, RequestContext } from "./types/context.js";
export type { FaultKind } from "./types/errors.js";
export type {
  ArgumentSpec,
  CliField,
  CompletionContext,
  CompletionSource,
  Field,
  FieldDescriptor,
  OptionNote,
  OptionSpec,
} from "./types/field.js";
export type { RawCliInput } from "./types/input.js";
export type {
  JsonSchema,
  JsonSchemaType,
  SchemaIssue,
  SchemaResult,
  StandardIssue,
  StandardResult,
  StandardSchema,
} from "@doopx/sdk";
export type {
  AuthorizeRequest,
  ExecuteOptions,
  ProviderDefinition,
  RegistryOptions,
  Resolution,
  Runner,
} from "./types/registry.js";
