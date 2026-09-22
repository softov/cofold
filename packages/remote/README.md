# @cofold/remote

**Commands that arrive over the wire.**

HTTP as a surface an action declares: manifests, OpenAPI, authentication, caching and the client that materialises a remote program's commands as local ones.

```ts
import { httpTransport, loadManifest, commandsFrom } from "@cofold/remote";
```

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/09-remote.md`](../../docs/commands/09-remote.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
