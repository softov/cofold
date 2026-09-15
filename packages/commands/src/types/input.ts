export interface RawCliInput {
  /** `:slot` values the parser matched, by slot name. Variadic slots arrive as arrays. */
  slots: Record<string, string | string[]>;
  /** Long option names *with* their dashes, as typed. */
  options: Record<string, string | string[] | boolean>;
  stdin?: string;
}
