/**
 * Standard Schema, vendored.
 *
 * The spec is an interface, not a package: zod, valibot and arktype all
 * implement `~standard` and none of them has to be installed for this file to
 * describe what they produce. That is the whole reason the interface is copied
 * here rather than imported - a CLI framework that drags in a validation
 * library has made the choice for every program built on it.
 */

import type { StandardIssue, StandardSchemaV1 } from "./types/schema.js";

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return typeof value === "object" && value !== null && "~standard" in value;
}

function pathOf(issue: StandardIssue): string {
  if (issue.path === undefined || issue.path.length === 0) return "";
  const parts = issue.path.map((segment) =>
    typeof segment === "object" && segment !== null && "key" in segment ? String(segment.key) : String(segment));
  return `${parts.join(".")}: `;
}

/**
 * Validate, and fail the way this framework fails.
 *
 * Every issue is reported, not just the first: somebody who mistyped two
 * options should be told about two options rather than made to run the command
 * again to discover the second one.
 */
export async function validate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  onIssues: (message: string) => Error,
): Promise<T> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw onIssues(result.issues.map((issue) => `${pathOf(issue)}${issue.message}`).join("; "));
  }
  return result.value;
}
