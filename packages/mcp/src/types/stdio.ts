import type { Readable, Writable } from "node:stream";
import type { Command, RequestContext } from "@facio/commands";
export interface StdioOptions {
  /** Reported to the client as `serverInfo`. */
  name: string;
  version: string;
  /** Shown to the agent once, at initialisation. */
  instructions?: string;
  stdin?: Readable;
  stdout?: Writable;
  /**
   * Trusted per-call data, reaching handlers as `context.request`.
   *
   * A stdio server is one process per client, so this is usually constant -
   * whoever launched the process. It is a function so that a token read from
   * the environment can be refreshed without restarting the server.
   */
  context?(): Readonly<RequestContext> | Promise<Readonly<RequestContext>>;
  /** Narrows what is served, on top of `surfaces.mcp`. Never widens it. */
  filter?(command: Command): boolean;
  /** Which failures come back as a readable tool error rather than a generic one. */
  recoverable?(error: unknown): boolean;
  /** Stderr, a log, anything that is not stdout. Facio never writes diagnostics itself. */
  onDiagnostic?(error: unknown): void;
  /** A single message this large is treated as a broken stream. */
  maxMessageBytes?: number;
}

export interface StdioServer {
  /** Resolves when stdin ends or `close` is called. The process is the caller's. */
  readonly closed: Promise<void>;
  close(): void;
}
