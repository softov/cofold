import type { JsonSchema } from "@cofold/sdk";

/**
 * How a word becomes a value, and what shape that value has.
 *
 * `schema` is required and `parse` is not: a value whose text reading is the
 * ordinary one for its type needs no function at all. A coercer that declares
 * one is saying its *text* form is not its value form - `KEY=VALUE` becoming a
 * pair - and `schema` then describes what arrives, because that is what a
 * client has to send and an agent has to be shown.
 */
export interface Coercer<T = unknown> {
  readonly schema: JsonSchema;
  /** Only where the text form differs from the value. Runs after `check`. */
  parse?(raw: string, label: string): T;
  /** Overrides the sentence built from the schema. */
  readonly expects?: string;
  /** Fixed candidates, when there are any. Feeds shell completion. */
  readonly candidates?: readonly string[];
}
