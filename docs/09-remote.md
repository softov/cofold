# Remote commands

If a command is data, a command can arrive from somewhere else. This is the
property nothing built on Commander can have, and it is worth the package.

## The round trip

A service describes its own registry:

```ts
import { describe } from "@softcli/remote";

// GET /cli-manifest
send(describe(kernel, { name: "clerver", version: "0.1.0" }));
```

The one extra fact a command carries is how it becomes a request:

```ts
meta: { http: { method: "GET", path: "/pets/{id}" } }
meta: { http: { method: "POST", path: "/pets", body: ["name", "species", "age"] } }
meta: { http: { method: "GET", path: "/pets", query: ["species", "limit"] } }
```

The core ignores `meta`; `@softcli/remote` reads it from **both** ends - the
server routes with it, the client builds requests with it. Commands with no
binding are simply not published: a local `doctor` command is nobody else's
business.

A client materialises them:

```ts
const manifest = await loadManifest(`${url}/cli-manifest`, { directory: cacheDir });
kernel.register(...materialise(manifest, { capability: "transport" }));
```

and they behave like any other command - help, completion, `--json`, coercion,
exit codes - because they *are* any other command.
[`packages/playground/src/clerver`](../packages/playground/src/clerver) is the
whole round trip in three small files.

## What has to be got right

**Help and completion must work offline.** A surface that only exists after a
round trip makes `--help` slow and completion useless, and breaks the binary on
a train. The manifest is cached; `--refresh` re-fetches; a failed fetch falls
back to the cache *with a line on stderr*, because a stale surface beats no
surface and silence about it beats neither.

**The client owns the transport.** The manifest says what a command is. It does
not say where to send it or what to send with it - base URL, credentials,
timeouts and retries are the client's, supplied as a capability. A server that
could name the host and the header would be a server that could point somebody's
token elsewhere.

**Bounds travel.** `minimum`, `maximum` and enums are published, so
`pet add --age -3` is refused locally in 2ms rather than after a round trip.

**Versions are checked first.** A client that meets a manifest from the future
refuses it and says to upgrade. Half a command surface is worse than none.

## OpenAPI

```sh
open-cli --spec ./petstore.json pet list --limit 2
```

`manifestFromOpenApi(document)` produces a *manifest*, not commands - so
everything downstream is the code that already exists.

The honest caveat: four hundred endpoints are not four hundred commands. A CLI
that mirrors a REST API one-for-one is usually worse than curl, because the
operation ids are the server's internal names and nothing is grouped the way a
person works. So the mapping is a default meant to be overridden:

```json
"post": {
  "operationId": "createPet",
  "x-cli": { "pattern": ["pet", "add"], "group": "pets" }
}
"get": { "operationId": "internalMetrics", "x-cli": { "skip": true } }
```

Without hints, the default is noun-first: `listPets` under the tag `pets`
becomes `pet list`, `showPetById` becomes `pet show <id>`. Path parameters
become slots, query parameters and flat JSON body properties become options with
their types, bounds and enums. `hints` and `tags` on the import let you do the
same for an API you do not own.
