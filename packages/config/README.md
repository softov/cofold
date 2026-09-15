# @facio/config

**Finding the configuration, not parsing it.**

A capability that resolves `--config` over the environment over a project file over the user's config directory, each layer merging leaf by leaf, and says which file a value came from.

```ts
import { configProvider } from "@facio/config";
```

Depends on [`@facio/commands`](../commands); part of the [facio](https://github.com/softov/facio) family.
The manual page is [`docs/commands/10-config.md`](../../docs/commands/10-config.md); the whole framework is described in [`@facio/commands`](../commands).

## License

MIT
