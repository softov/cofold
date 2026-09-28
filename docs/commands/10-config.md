# Configuration

Where the configuration is, not what is in it.

```ts
import { configProvider, configGlobal } from "@cofold/config";

const registry = createRegistry().provide("config", configProvider({ name: "depot", project: ".depot.json" }));

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
| `project` | the nearest `project` file at or above the working directory, when the program names one | fine |
| `environment` | `$<NAME>_CONFIG`, or the variable the program names | a fault |
| `explicit` | `--config PATH` | a fault |

The split in that last column is the whole of the error handling. A file that was *looked for* and is not there is the ordinary case. A file that was *named* and is not there is somebody's mistake, and guessing past it runs the command against the wrong target.

The project file is found by walking upwards, the way a repository is, because a command run three directories into a project is still run inside that project.

## Choosing the layers

A program says which layers it reads. `base` and `explicit` are always there when given; the other three are options:

| option | absent | set |
|---|---|---|
| `user` | the user file is read | `false` leaves it out |
| `project` | no project file is read | the file's name, found upwards as written: `.depot.json`, `depot.json`, `.depot/config.json` |
| `environment` | `$<NAME>_CONFIG` is read | a variable name reads that one; `false` reads none |

The project file is opt-in. A program that wants one names it, and the name is taken as written: no dot is added and `extensions` is not tried, so a program that reads `.depot.yaml` says so. A path with folders in it is joined to each directory on the way up like a plain name.

```ts
configProvider({ name: "depot", project: ".depot/config.json", user: false, environment: "DEPOT_FILE" });
```

## Which file said so

```ts
config.get("theme.mode");       // "light"
config.sourceOf("theme.mode");  // "/work/project/.depot.json"
config.layers;                  // every file that contributed, in order
```

`sourceOf` is why this is worth a module rather than a `JSON.parse` in a provider. "It is reading staging" is a guess until something can print the file, and that answer belongs in a support ticket rather than in somebody's afternoon.

## Bringing a parser

`@cofold/commands` has zero runtime dependencies and a configuration file is not worth breaking that for, so this module finds and layers files and does not parse them. JSON is the default because every runtime already has it; anything else is injected. `extensions` is the order the user file is looked for in; the project file is the one name given.

```ts
configProvider({
  name: "depot",
  project: ".depot.yaml",
  extensions: [".yaml", ".yml", ".json"],
  parse: (text, path) => readYourYaml(text, path),
});
```

Which is the same seam [`@cofold/remote`](09-remote.md) uses for a manifest: the shape is this library's, the syntax is somebody else's.

## Why a provider

The explicit path arrives as a program-wide option, and `globals` exist precisely so a capability reads them and a command does not. An MCP tool call has no `--config`, so a handler that reached for one would be a handler that only works at a terminal - which is the one discipline this library asks for.

Resolution happens when the capability resolves, before the handler is entered, so a command that fails on a bad argument never reads a file.
