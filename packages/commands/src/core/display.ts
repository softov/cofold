/**
 * A value, as one string.
 *
 * Not a terminal concern, despite where it is used: the question "what does
 * this value look like written down" has one answer, and having had four of
 * them - a table cell, a record field, a markdown cell, a flattened row - meant
 * an array printed three different ways depending on which one you reached.
 *
 * `empty` is the only genuine variation: a table shows a dash where a value is
 * missing, and a markdown cell shows nothing at all.
 */
export function displayValue(value: unknown, empty = "-"): string {
  if (value === null || value === undefined) return empty;
  if (Array.isArray(value)) return value.map((item) => displayValue(item, empty)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
