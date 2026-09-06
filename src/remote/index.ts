/**
 * softcli/remote - a command surface that arrives over the wire.
 *
 * `describe` is the server half: what is registered, as JSON. `materialise` is
 * the client half: JSON, as commands. Between them a program gets a CLI for a
 * service it does not ship with, and the service gets a CLI without writing one.
 *
 * `manifestFromOpenApi` does the same for an API that never heard of this
 * library, which is most of them.
 */
export { loadManifest } from "./cache.js";
export type { CacheOptions } from "./cache.js";
export { HttpError, httpTransport } from "./http.js";
export type { HttpTransportOptions } from "./http.js";
export {
  bodyFields,
  describe,
  expandPath,
  MANIFEST_VERSION,
  ManifestError,
  materialise,
  parseManifest,
} from "./manifest.js";
export type {
  HttpBinding,
  Manifest,
  ManifestCommand,
  ManifestOption,
  MaterialiseOptions,
  Transport,
} from "./manifest.js";
export { manifestFromOpenApi, patternFor } from "./openapi.js";
export type { OpenApiOperationHint, OpenApiOptions } from "./openapi.js";
