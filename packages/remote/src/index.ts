/**
 * @facio/remote - a command surface that arrives over the wire.
 *
 * `manifestFrom` is the server half: what is registered, as JSON. `commandsFrom`
 * is the client half: JSON, as commands. Between them a program gets a CLI for a
 * service it does not ship with, and the service gets a CLI without writing one.
 *
 * `manifestFromOpenApi` does the same for an API that never heard of this
 * library, which is most of them.
 */
export { loadManifest } from "./cache.js";
export { HttpError, httpTransport } from "./http.js";
export {
  bodyFields,
  manifestFrom,
  expandPath,
  MANIFEST_VERSION,
  ManifestError,
  commandsFrom,
  parseManifest,
} from "./manifest.js";
export { manifestFromOpenApi, patternFor } from "./openapi.js";

export { CookieJar, basicAuthorization } from "./auth.js";

export type { StoredCookie } from "./types/auth.js";
export type { CacheOptions } from "./types/cache.js";
export type { HttpTransportOptions } from "./types/http.js";
export type {
  CommandsFromOptions,
  HttpBinding,
  ManifestCommand,
  ManifestOption,
  ProgramManifest,
  Transport,
} from "./types/manifest.js";
export type {
  DescribedSchema,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOperationHint,
  OpenApiOptions,
  OpenApiParameter,
} from "./types/openapi.js";
