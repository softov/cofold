import type { AgentErrorCode } from './types/error.js';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly detail: unknown;
  constructor(options: { code: AgentErrorCode; message: string; detail?: unknown; cause?: unknown }) {
    super(options.message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.detail = options.detail;
  }
}
export class StoreError extends AgentError {}
export class ModelError extends AgentError {
  readonly status: number | undefined;
  readonly retryable: boolean;
  constructor(options: ConstructorParameters<typeof AgentError>[0] & { status?: number; retryable?: boolean }) {
    super(options);
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
