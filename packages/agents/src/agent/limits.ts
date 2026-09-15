import type { Limits } from '../types/limits.js';

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 20,
  maxToolCalls: 50,
  timeoutMs: 0,
  maxToolOutputChars: 16_000,
};
