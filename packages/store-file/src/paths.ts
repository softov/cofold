import { StoreError } from '@cofold/agents';

const SAFE = /[^A-Za-z0-9._-]/g;

/** Percent-encodes every byte outside [A-Za-z0-9._-] so any id or kv key is one safe path segment (decision 81). */
export function encodeSegment(value: string): string {
  const out = value.replace(SAFE, (c) => Array.from(new TextEncoder().encode(c), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''));
  if (Buffer.byteLength(out) > 200) {
    throw new StoreError({ code: 'invalid_options', message: `key too long after encoding: ${value.slice(0, 40)}...` });
  }
  return out;
}

export function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}
