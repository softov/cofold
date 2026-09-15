/**
 * Object literals under `exactOptionalPropertyTypes`.
 *
 * The setting is right - an optional field that is present and undefined is a
 * different thing from an absent one, and a manifest that serialises
 * `"group": undefined` is a manifest with a hole in it. What it costs is a
 * spread-and-ternary per optional field, and this file is that cost paid once.
 *
 * `compact` drops the undefined entries and types the result as all-optional,
 * so it is spread beside the fields that are actually required:
 *
 *   { id, summary, ...compact({ description, group }) }
 */

import type { Compacted } from "./types/compact.js";


export function compact<T extends object>(value: T): Compacted<T> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as Compacted<T>;
}
