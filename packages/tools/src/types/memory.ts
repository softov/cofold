export interface MemoryOptions {
  /** The folder the memory files live in; the program chooses it (papo: `<home>/memory/<workspace slug>`). */
  dir: string;
  /** Lines of `MEMORY.md` carried in the instructions every run; default 200. */
  indexLines?: number;
}

export interface MemoryReadInput {
  /** Relative to the memory folder; default `MEMORY.md`. */
  path?: string;
}

export interface MemoryWriteInput {
  /** Relative to the memory folder. */
  path: string;
  content: string;
}
