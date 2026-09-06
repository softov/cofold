import { coerce, compact, type Coercer } from "../index.js";

/**
 * What a description says about one value, and the coercer it becomes.
 *
 * Two things describe values on this side of the library - a manifest option
 * and an OpenAPI schema - and they describe them with the same four fields,
 * which is not a coincidence: a manifest is a JSON Schema fragment with the
 * parts nobody needed removed. So the conversion is written once here rather
 * than once per description format, which is how the two copies had already
 * begun to differ.
 *
 * The parameter is the `type` vocabulary. Reading a description leaves it open,
 * because an OpenAPI document may say anything; a manifest narrows it to the
 * four `ManifestType` names it is allowed to carry.
 */
export interface ValueShape<T extends string = string> {
  type?: T;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
}

/** The types a manifest is allowed to name. Anything else travels as text. */
export type ManifestType = "string" | "integer" | "number" | "boolean";

export function typeOf(shape: ValueShape | undefined): ManifestType {
  const type = shape?.type;
  return type === "integer" || type === "number" || type === "boolean" ? type : "string";
}

/**
 * Bounds, carried rather than dropped.
 *
 * Without them a client would accept `--age -3`, send it, and let the server
 * say no after a round trip.
 */
export function boundsOf(shape: ValueShape | undefined): { minimum?: number; maximum?: number } {
  return compact({ minimum: shape?.minimum, maximum: shape?.maximum });
}

export function coercerFor(shape: ValueShape | undefined): Coercer<unknown> | undefined {
  if (shape?.enum !== undefined && shape.enum.length > 0) return coerce.oneOf([...shape.enum] as [string]);
  const bounds = compact({ min: shape?.minimum, max: shape?.maximum });
  if (shape?.type === "integer") return coerce.integer(bounds);
  if (shape?.type === "number") return coerce.decimal(bounds);
  return undefined;
}
