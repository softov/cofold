import type { StandardIssue } from "./standard-issue.js";

/** What a Standard Schema's `validate` returns; `issues` is the specification's name. */
export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };
