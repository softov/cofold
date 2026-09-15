export type AgentErrorCode =
  | 'invalid_options'
  | 'unsupported_keyword'
  | 'invalid_schema'
  | 'seq_gap'
  | 'writer_mismatch'
  | 'not_found'
  | 'already_exists'
  | 'unsupported_feature'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'invalid_response'
  | 'aborted'
  | 'hook_error'
  | 'capability_error'
  | 'writer_busy'
  | 'internal'
  | 'uncertain_invocation'
  | 'interrupted'
  | 'superseded';

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
export class SchemaError extends AgentError {}
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
