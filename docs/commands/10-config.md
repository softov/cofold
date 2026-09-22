# Configuration

Where the configuration is, not what is in it.

```ts
import { configProvider, configGlobal } from "@doopx/config";

const registry = createRegistry().provide("config", configProvider({ name: "depot" }));

new Program({ name: "depot", version, registry, globals: [configGlobal] });
```

Then a command asks for it like anything else:

```ts
registry.action({
  id: "deploy",
  needs: ["config"],
  surfaces: { cli: { pattern: ["deploy"] } },
  run: ({ config }) => output(deploy(config.get("api"))),
});
```

## The order

Later wins, and each layer *merges* into the one below rather than replacing it, so an installation states the two values it disagrees with instead of restating the file.

| layer | where | absent |
|---|---|---|
| `base` | the program's own defaults, passed in | - |
| `user` | `$XDG_CONFIG_HOME/<name>/config.json`, else `~/.config/<name>/config.json` | fine |
| `project` | the nearest `.<name>.json` at or above the working directory | fine |
| `environment` | `$<NAME>_CONFIG` | a fault |
| `explicit` | `--config PATH` | a fault |

The split in that last column is the whole of the error handling. A file that was *looked for* and is not there is the ordinary case. A file that was *named* and is not there is somebody's mistake, and guessing past it runs the command against the wrong target.

The project file is found by walking upwards, the way a repository is, because a command run three directories into a project is still run inside that project.

## Which file said so

```ts
config.get("theme.mode");       // "light"
config.sourceOf("theme.mode");  // "/work/project/.depot.json"
config.layers;                  // every file that contributed, in order
```

`sourceOf` is why this is worth a module rather than a `JSON.parse` in a provider. "It is reading staging" is a guess until something can print the file, and that answer belongs in a support ticket rather than in somebody's afternoon.

## Bringing a parser

`@doopx/commands` has zero runtime dependencies and a configuration file is not worth breaking that for, so this module finds and layers files and does not parse them. JSON is the default because every runtime already has it; anything else is injected:

```ts
configProvider({
  name: "depot",
  extensions: [".yaml", ".yml", ".json"],
  parse: (text, path) => readYourYaml(text, path),
});
```

Which is the same seam [`@doopx/remote`](09-remote.md) uses for a manifest: the shape is this library's, the syntax is somebody else's.

## Why a provider

The explicit path arrives as a program-wide option, and `globals` exist precisely so a capability reads them and a command does not. An MCP tool call has no `--config`, so a handler that reached for one would be a handler that only works at a terminal - which is the one discipline this library asks for.

Resolution happens when the capability resolves, before the handler is entered, so a command that fails on a bad argument never reads a file.
