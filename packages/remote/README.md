# @cofold/remote

**Commands that arrive over the wire.**

HTTP as a surface an action declares: manifests, OpenAPI, authentication, caching and the client that materialises a remote program's commands as local ones.

```ts
import { httpTransport, loadManifest, commandsFrom } from "@cofold/remote";
```

`serve(registry, program)` answers those commands over HTTP from the same declaration: a `Request` in, a `Response` out, as `Bun.serve` and `Deno.serve` take it. On Node, `createServer(toNodeListener(serve(registry, program)))`.

The manifest carries each command's `effect` and `resource`, and `x-cli` in an OpenAPI document may name them too. `serve` refuses a binding whose path parameter is optional, takes a list or names no input, because that route could never match.

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/09-remote.md`](../../docs/commands/09-remote.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
