import type { StandardResult } from "./standard-result.js";

/**
 * The Standard Schema v1 interface (standardschema.dev), so a Zod, Valibot or
 * ArkType schema can be handed to a command or a tool without this family
 * depending on any of them. Field names are the specification's.
 */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}
