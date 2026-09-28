# @cofold/config

**Finding the configuration, not parsing it.**

A capability that resolves `--config` over the environment over a project file over the user's config directory, each layer merging leaf by leaf, and says which file a value came from.

```ts
import { configProvider } from "@cofold/config";

configProvider({ name: "depot", project: ".depot.json" });
```

The project file is opt-in: it is read only when `project` names it, found upwards by that name as written. `user: false` leaves out the user file, and `environment` names the variable that points at a file (`<NAME>_CONFIG` when absent, none when `false`).

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/10-config.md`](../../docs/commands/10-config.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
