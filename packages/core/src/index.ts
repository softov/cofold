/**
 * softcli/core - a command is data.
 *
 * Nothing in this package knows what a terminal is. It holds the declaration
 * (`command.ts`), the capabilities a command declares it needs (`kernel.ts`),
 * the one object every surface turns its arguments into (`input.ts`), and the
 * three readings of a result (`context.ts`). The surfaces - the CLI, MCP, the
 * generated reference - are renderings of what is here, and each of them is
 * small because all of the meaning is in this package.
 */
export * as coerce from "./coerce.js";
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
} from "./command.js";
export { compact } from "./compact.js";
export type { Compacted } from "./compact.js";
export { displayValue } from "./display.js";
export type { Coercer, JsonSchemaFragment } from "./coerce.js";
export {
  BaseContext,
  output,
  RESERVED_CONTEXT_KEYS,
  silentIo,
} from "./context.js";
export type { CommandContext, Io, Output } from "./context.js";
export {
  ArgumentError,
  AuthorizationError,
  ConfigurationError,
  SoftcliError,
  UnavailableError,
  exitCodeFor,
} from "./errors.js";
export type { FaultKind } from "./errors.js";
export { argumentFields, canonicalFromCli, canonicalFromObject, fieldsOf } from "./input.js";
export type { FieldDescriptor, RawCliInput } from "./input.js";
export { createKernel, Kernel, sectionsOf, validateCommand } from "./kernel.js";
export type {
  Runner,
  AuthorizeRequest,
  CommandGroup,
  CommandSection,
  ExecuteOptions,
  KernelOptions,
  ProviderDefinition,
  Resolution,
} from "./kernel.js";
export { isStandardSchema, validate } from "./schema.js";
export type { StandardIssue, StandardResult, StandardSchemaV1 } from "./schema.js";
