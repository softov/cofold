# @facio/remote

**Commands that arrive over the wire.**

HTTP as a surface an action declares: manifests, OpenAPI, authentication, caching and the client that materialises a remote program's commands as local ones.

```ts
import { httpTransport, loadManifest, commandsFrom } from "@facio/remote";
```

Depends on [`@facio/commands`](../commands); part of the [facio](https://github.com/softov/facio) family.
The manual page is [`docs/commands/09-remote.md`](../../docs/commands/09-remote.md); the whole framework is described in [`@facio/commands`](../commands).

## License

MIT
