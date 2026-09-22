# @doopx/remote

**Commands that arrive over the wire.**

HTTP as a surface an action declares: manifests, OpenAPI, authentication, caching and the client that materialises a remote program's commands as local ones.

```ts
import { httpTransport, loadManifest, commandsFrom } from "@doopx/remote";
```

Depends on [`@doopx/commands`](../commands); part of the [doopx](https://github.com/softov/doopx) family.
The manual page is [`docs/commands/09-remote.md`](../../docs/commands/09-remote.md); the whole framework is described in [`@doopx/commands`](../commands).

## License

MIT
