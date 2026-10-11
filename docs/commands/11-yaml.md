# YAML

`@cofold/yaml` exposes synchronous text parsing and an asynchronous document loader. Both return plain data; callers validate the application's schema.

```ts
import { parseYaml, loadYaml, YamlError } from "@cofold/yaml";

const data = parseYaml(text, { source: "api.yaml", maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
const document = await loadYaml("api.yaml", {
  refs: { local: true, remote: true, circular: "preserve" },
});
// document.data, document.sources, document.diagnostics
```

`parseYaml` never performs I/O. It supports block mappings/sequences, single-line flow collections, quoted/plain scalars, literal/folded block scalars with indentation and chomping indicators, comments, and a leading document marker. Empty input returns `null`. It remains a subset parser: anchors, aliases, custom tags, merge keys, directives, and multiple documents are refused. Multiline flow collections and multiline quoted/plain scalar continuation are not supported. `YamlError` carries `line`, optional `source`, and the unformatted `detail`.

`stringifyYaml(value)` writes a JSON value as YAML in the subset `parseYaml` reads, and `parseYaml` reads it back as the same value. Objects become block mappings and arrays block sequences, indented two spaces; an empty object or array is `{}` or `[]`. Multi-line text is a literal block scalar with the chomping indicator its last newline needs, unless the block cannot carry it: top-level text, a line of only spaces, or a control character other than tab, which are written double-quoted. Text that `parseYaml` would read as another type, or that starts with an indicator, is quoted, and so is a key that is not plain. A key whose value is `undefined` is skipped, as `JSON.stringify` does. `undefined` elsewhere, functions, symbols, bigints, non-finite numbers and the merge key `<<` throw `YamlError`.

`loadYaml` accepts local filenames and file/HTTP(S) URLs, parses JSON for `.json` sources, and optionally resolves `$ref`. Omitting `refs` leaves references as ordinary data. Internal JSON Pointers work when `refs` is present; external files/URLs require `local: true`/`remote: true`. Relative references use the containing document's location. Remote documents never gain access to local files. Requests carry no API credentials and reject redirects.

The loader caches each document per call. Limits default to 16 MiB per document, nesting depth 128, 1024 documents, and a 30-second fetch timeout. `readFile` and `fetch` are injectable. Cycles fail by default; `circular: "preserve"` leaves an absolute `$ref` at the recursive edge. The OpenAPI adapter refuses unresolved input schemas.

Reference failures throw by default. `unresolved: "preserve"` leaves the reference in place and appends a checkable diagnostic. Summary/description siblings may override referenced annotations; constraint siblings are rejected because a shallow merge would misrepresent JSON Schema intersection semantics. This is reference resolution, not s2cmd-style document merging.
