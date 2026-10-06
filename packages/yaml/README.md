# @cofold/yaml

[![npm](https://img.shields.io/npm/v/%40cofold%2Fyaml)](https://www.npmjs.com/package/@cofold/yaml)
[![CI](https://github.com/softov/cofold/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/cofold/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

**A documented YAML subset as plain data.**

Parsing with source-aware errors, and document loading with local and remote references, JSON pointers and bounded reads. No dependencies, no I/O in the parser.

```ts
import { parseYaml, loadYaml } from "@cofold/yaml";
```

Part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/11-yaml.md`](../../docs/commands/11-yaml.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
