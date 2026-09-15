export interface FileStoreOptions {
  root: string;
  /** A `running` holder whose heartbeat is older than this loses its writer.lock to a new claim (decision 68). Default 60 s. */
  staleAfterMs?: number;
}
