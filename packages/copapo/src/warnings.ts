/** Where the service's warnings go: stderr, or a front that draws on the terminal while it does. */
export interface Warnings {
  warn(message: string): void;
  /** Sends every warning to `listener` instead of stderr; the returned function sends them back. */
  divert(listener: (message: string) => void): () => void;
}

export function createWarnings(write: (message: string) => void = (message) => { process.stderr.write(`copapo: ${message}\n`); }): Warnings {
  let listener: ((message: string) => void) | undefined;
  return {
    warn: (message) => { (listener ?? write)(message); },
    divert: (next) => {
      listener = next;
      return () => { if (listener === next) listener = undefined; };
    },
  };
}
