export interface YamlParseOptions {
  /** A filename or URL used in diagnostics; the parser does not read it. */
  source?: string;
  /** Bound input size before parsing. Default: 16 MiB. */
  maxBytes?: number;
  /** Bound nesting before recursive parsing. Default: 128. */
  maxDepth?: number;
}
