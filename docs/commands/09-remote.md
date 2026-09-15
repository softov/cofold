# Remote commands

If a command is data, a command can arrive from somewhere else. That is the property a builder call cannot have, and it is worth the package.

## The round trip

A service describes its own registry:

```ts
import { manifestFrom } from "@facio/remote";

// GET /cli-manifest
send(manifestFrom(registry, { name: "clerver", version: "0.1.0" }));
```

HTTP is a surface, declared beside the others:

```ts
surfaces: {
  cli: { pattern: ["pet", "show", ":id"] },
  http: { method: "GET", path: "/pets/{id}" },
  mcp: true,
}
```

```ts
http: { method: "POST", path: "/pets", body: ["name", "species", "age"] }
http: { method: "GET", path: "/pets", query: ["species", "limit"] }
```

`surfaces.http` is `@facio/remote`'s own key, added to `Surfaces` by declaration merging: the binding is typed where it is written and the core still knows no protocol. `@facio/remote` reads it from **both** ends - the server routes with it, the client builds requests with it. Actions with no binding are simply not published: a local `doctor` command is nobody else's business.

The rules are the same rules. A request is validated against the same schemas the terminal parses against, so `{"age": -5}` is refused with `400` for the reason `--age -5` is refused at a prompt. What differs is only the name in the message: a client that sent an object is told `age`, not `--age`, because it has no flag to correct.

A client turns them back into commands:

```ts
const manifest = await loadManifest(`${url}/cli-manifest`, { directory: cacheDir });
registry.register(...commandsFrom(manifest, { capability: "transport" }));
```

and they behave like any other command - help, completion, `--json`, coercion, exit codes - because they *are* any other command. [`examples/clerver`](../../examples/commands/clerver) is the whole round trip in three small files.

## What has to be got right

**Help and completion must work offline.** A surface that only exists after a round trip makes `--help` slow and completion useless, and breaks the binary on a train. The manifest is cached; `--refresh` re-fetches; a failed fetch falls back to the cache *with a line on stderr*, because a stale surface beats no surface and silence about it beats neither.

**The client owns the transport.** The manifest says what a command is. It does not say where to send it or what to send with it - base URL, credentials, timeouts and retries are the client's, supplied as a capability. A server that could name the host and the header would be a server that could point somebody's token elsewhere.

**Bounds travel.** `minimum`, `maximum` and enums are published, so `pet add --age -3` is refused locally in 2ms rather than after a round trip.

**Versions are checked first.** A client that meets a manifest from the future refuses it and says to upgrade. Half a command surface is worse than none.

## OpenAPI

```sh
open-cli --spec ./petstore.json pets --limit 2
```

`manifestFromOpenApi(document)` produces a *manifest*, not commands - so everything downstream is the code that already exists.

The honest caveat: four hundred endpoints are not four hundred commands. A CLI that mirrors a REST API one-for-one is usually worse than curl, because the operation ids are the server's internal names and nothing is grouped the way a person works. So the mapping is a default meant to be overridden:

```json
"post": {
  "operationId": "createPet",
  "x-cli": { "pattern": ["pet", "add"], "group": "pets" }
}
"get": { "operationId": "internalMetrics", "x-cli": { "skip": true } }
```

Without hints, command words always follow the API path: `GET /pets` becomes `pets`, and `GET /pets/{id}` becomes `pets <id>`. Tags are help headings only; operation IDs identify commands and select hints but do not determine command words. Literal path segments use lowercase ASCII words with hyphens; the HTTP path itself stays unchanged. Path parameters become slots, query parameters and flat JSON body properties become options with their types, bounds and enums. `hints` and `tags` on the import let you do the same for an API you do not own.

## Form bodies and authentication

`HttpBinding.contentType` selects `application/json` (default) or `application/x-www-form-urlencoded`. Form bodies preserve false/zero, repeat array fields, and percent-encode text through `URLSearchParams`. JSON text supplied for an object field is sent as JSON in that form field. Requests do not follow redirects, preventing an authenticated call from forwarding credentials elsewhere.

`httpTransport` accepts `auth: { type: "basic", username, password }` or `auth: { type: "cookie", jar }`. `CookieJar` receives Set-Cookie headers and applies host, path, secure, and expiry checks. It deliberately accepts cookies only for the exact request host, not parent-domain sharing. `snapshot()` returns serializable cookie data; persistence belongs to the application. Treat snapshots as credentials. `onResponse` allows an application to persist changed session cookies. Successful cookie login and logout workflows are application commands, not automatic transport retries.

`manifestFromOpenApi` supports JSON and form object bodies. Pass `onUnsupported` to collect operation-level diagnostics and omit unsupported operations; without it, unsupported input fails import. Resolve external references before calling the adapter with `loadYaml`. Specification fetches and API transports are separate so reference servers never receive API credentials.

HTTP methods remain request metadata, not default command words. Operations sharing the same generated path need explicit `hints.pattern` or `x-cli.pattern` names; ambiguous operations fail import or are reported together through `onUnsupported`.
