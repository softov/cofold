/**
 * softcli/core - a command is data.
 *
 * Nothing in this package knows what a terminal is. It holds the declaration
 * (`command.ts`), the capabilities a command declares it needs (`registry.ts`),
 * the one object every surface turns its arguments into (`input.ts`), and the
 * three readings of a result (`context.ts`). The surfaces - the CLI, MCP, the
 * generated reference - are renderings of what is here, and each of them is
 * small because all of the meaning is in this package.
 */
export * as coerce from "./core/coerce.js";
export { check, coerceValue, decode, expectationOf } from "./core/coerce.js";
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
} from "./core/command.js";
export type {
  ArgumentSpec,
  Command,
  CommandDefinition,
  CommandExample,
  CompletionContext,
  CompletionSource,
  OptionNote,
  OptionSpec,
  PatternToken,
  Surface,
  SurfaceFlags,
} from "./core/command.js";
export { compact } from "./core/compact.js";
export type { Compacted } from "./core/compact.js";
export { displayValue } from "./core/display.js";
export type { Coercer, JsonSchema } from "./core/coerce.js";
export {
  BaseContext,
  output,
  RESERVED_CONTEXT_KEYS,
  silentIo,
} from "./core/context.js";
export type { CommandContext, Io, Output } from "./core/context.js";
export {
  ArgumentError,
  AuthorizationError,
  ConfigurationError,
  SoftcliError,
  UnavailableError,
  exitCodeFor,
} from "./core/errors.js";
export type { FaultKind } from "./core/errors.js";
export { argumentFields, canonicalFromCli, canonicalFromObject, fieldsOf } from "./core/input.js";
export type { FieldDescriptor, RawCliInput } from "./core/input.js";
export { createRegistry, Registry, sectionsOf, validateCommand } from "./core/registry.js";
export type {
  Runner,
  AuthorizeRequest,
  CommandGroup,
  CommandSection,
  ExecuteOptions,
  RegistryOptions,
  ProviderDefinition,
  Resolution,
} from "./core/registry.js";
export { isStandardSchema, validate } from "./core/schema.js";
export type { StandardIssue, StandardResult, StandardSchemaV1 } from "./core/schema.js";
