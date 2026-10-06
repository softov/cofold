import type { EffortLevel, ReasoningEffort } from '../types/model.js';

/**
 * The thinking levels a host offers, `off` first.
 *
 * The union is the vocabulary; this is the list a host draws its own choices from, so two hosts
 * that offer a level offer the same words for it. What a provider accepts is `ReasoningEffort`,
 * which is wider: a level is the setting a person picks, not the field that is sent.
 */
export const EFFORT_LEVELS = ['off', 'low', 'medium', 'high'] as const satisfies readonly EffortLevel[];

/**
 * The reasoning effort a chosen level asks for.
 *
 * `off`, a missing value and anything unrecognised all send nothing: an endpoint is not troubled
 * with a field for a model that was not asked to think.
 */
export function effortOf(value: unknown): ReasoningEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
