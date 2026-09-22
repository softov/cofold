# @doopx/config

**Finding the configuration, not parsing it.**

A capability that resolves `--config` over the environment over a project file over the user's config directory, each layer merging leaf by leaf, and says which file a value came from.

```ts
import { configProvider } from "@doopx/config";
```

Depends on [`@doopx/commands`](../commands); part of the [doopx](https://github.com/softov/doopx) family.
The manual page is [`docs/commands/10-config.md`](../../docs/commands/10-config.md); the whole framework is described in [`@doopx/commands`](../commands).

## License

MIT
