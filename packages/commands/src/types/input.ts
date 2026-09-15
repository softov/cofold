import type { Coercer } from "./coerce.js";
import type { OptionSpec } from "./command.js";

export interface RawCliInput {
  /** `:slot` values the parser matched, by slot name. Variadic slots arrive as arrays. */
  slots: Record<string, string | string[]>;
  /** Long option names *with* their dashes, as typed. */
  options: Record<string, string | string[] | boolean>;
  stdin?: string;
}

/** Every field the command can produce, for docs, MCP schemas and validation. */
export interface FieldDescriptor {
  name: string;
  source: "argument" | "option";
  label: string;
  description: string;
  required: boolean;
  repeated: boolean;
  coerce: Coercer<unknown>;
  option?: OptionSpec;
}
