/**
 * @facio/commands - a command is data.
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
export type { Match, OptionTableEntry, Tokens } from "./types/argv.js";
export * as coerce from "./coerce.js";
export { assertSupported, check, coerceValue, decode, expectationOf } from "./coerce.js";
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
  ActionDefinition,
  ArgumentSpec,
  Command,
  CommandDefinition,
  CommandExample,
  CompletionContext,
  CompletionSource,
  CommandMeta,
  Field,
  CliField,
  Surfaces,
  OptionNote,
  OptionSpec,
  PatternToken,
  Surface,
  SurfaceFlags,
} from "./types/command.js";
export { compact } from "./compact.js";
export type { Compacted } from "./types/compact.js";
export { displayValue } from "./display.js";
export type { Coercer, JsonSchema } from "./types/coerce.js";
export {
  BaseContext,
  output,
  RESERVED_CONTEXT_KEYS,
  silentIo,
} from "./context.js";
export type { CommandContext, Io, Output, RequestContext } from "./types/context.js";
export {
  ArgumentError,
  AuthorizationError,
  ConfigurationError,
  FacioError,
  UnavailableError,
  exitCodeFor,
} from "./errors.js";
export type { FaultKind } from "./types/errors.js";
export { argumentFields, canonicalFromCli, canonicalFromObject, fieldsOf } from "./input.js";
export type { FieldDescriptor, RawCliInput } from "./types/input.js";
export { commandFor } from "./command.js";
export { createRegistry, Registry, sectionsOf, validateCommand } from "./registry.js";
export type {
  Runner,
  AuthorizeRequest,
  CommandGroup,
  CommandSection,
  ExecuteOptions,
  RegistryOptions,
  ProviderDefinition,
  Resolution,
} from "./types/registry.js";
export { isStandardSchema, validate } from "./schema.js";
export { didYouMean, suggest } from "./suggest.js";
export type { StandardIssue, StandardResult, StandardSchemaV1 } from "./types/schema.js";
