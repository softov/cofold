<!--
Domain: repo
Status: Built
Priority: High
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: —
Reference: ../../../ROADMAP.md, facio-agents (softov/facio-agents)
-->

# REPO-01 - One workspace: facio becomes the family, the framework becomes packages

_Status: Built (Task 4 user steps pending) · Priority: High · Created: 2026-09-16_

## Goal

Turn this repository from one published package (`facio`, the command framework at the root) into the workspace of the whole family: the command framework as one package per surface, the agent harness and its adapters brought in from `facio-agents` with their history, and the name `facio` reserved for the program that will compose them (the daemon and its CLI; not built here).
Order is mechanical first, renames last: Task 1 moves the framework 1:1 into `packages/facio`; Task 2 imports facio-agents 1:1; Task 3 splits and renames; Task 4 retires the old repository.
After Task 2 every check is green with nothing renamed, so the split can be reviewed as the only behavior-visible change.

## Reconnaissance

### Files read

- `package.json` (root) - `name: "facio"`, `version: 0.1.0`, `main`/`exports` (`.`, `./cli`, `./mcp`, `./mcp/stdio`, `./mcp/server`, `./docs`, `./remote`, `./config`, `./yaml`), `files` includes `docs`, `ROADMAP.md`, optional peer `@modelcontextprotocol/sdk`, scripts `build | check | clean | coverage | examples | prepublishOnly | test | typecheck`.
- `pnpm-workspace.yaml` - no `packages:` list (single package); `allowBuilds: esbuild`.
- `tsconfig.json` (`rootDir: src`, excludes tests), `tsconfig.test.json` (`noEmit`, `src/**/*.test.ts` + `examples/**/*.test.ts`), `tsconfig.base.json` (ES2023, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, no `DOM` lib), `examples/tsconfig.json` (compiles `examples/**` to `examples/dist`, imports `facio` by name).
- `src/index.ts` - header "facio/core - a command is data"; `src/cli/index.ts` - header "facio/cli - the terminal rendering of a registry"; the other five sub-path entry points.
- `.github/workflows/ci.yml` - `check` job (`typecheck`, `test`, `examples`, `pnpm pack`) and `runtimes` job (node / bun / deno run `examples/dist/petshop/cli.js`).
- `README.md` (415 lines, the framework's), `ROADMAP.md` (the framework's open items), `docs/01-11`.
- `F:\github\facio-agents\{package.json,pnpm-workspace.yaml,tsconfig.base.json,vitest.workspace.ts,CLAUDE.md}` - private root, `packages/*` + `examples`, base ES2022 with `lib: ["ES2022", "DOM"]`, explicit vitest projects with `typecheck: { tsconfig: 'tsconfig.test.json' }`.
- `F:\github\facio-agents\packages\{agents,model-openai-compat,store-file}\{package.json,tsconfig.json,tsconfig.test.json,README.md}` - `tsc -p` builds, `exports` maps, `files` include `README.md`.
- `F:\github\facio-agents\{examples/package.json,roadmap/plans/{index.md,README.md,_TEMPLATE.md,agent/*,cli/*},roadmap/research,roadmap/specs}`.

### Searches performed

- `grep -rhoE "from ['\"]facio(/[a-z/]+)?['\"]" src examples docs` - self-imports by package name: `facio` 13, `facio/remote` 6, `facio/cli` 5, `facio/mcp` 4, `facio/mcp/server` 3, `facio/mcp/stdio` 2, `facio/docs` 2, `facio/config` 1, `facio/yaml` 1. These resolve through `dist` via the package's own `exports` (CI comment says so); they keep working inside a workspace package and are rewritten only in Task 3.
- Import graph between sub-paths (non-test files): `cli`, `config`, `docs`, `mcp` import only `../index` (core); `remote` imports `../index` and `type { JsonSchema } from "../core/coerce.js"` (exported from the index too); `yaml` imports nothing. No sibling-to-sibling import, no cycle.
- Line counts: core 2162, mcp 868, cli 845, remote 844, yaml 560, config 276, docs 156.
- `grep -rn "DOM\|Response" facio-agents/packages/model-openai-compat/src/index.ts` - `Response` is the global fetch type; `@types/node` 22 declares it, so the `DOM` lib in facio-agents' base is not needed (verified in Task 2, see watch-outs).

### Runtime path (after this plan)

```
pnpm check (root)
  → pnpm -r --filter "./packages/**" build      (tsc -p per package, workspace order)
  → pnpm -r typecheck                           (per package tsconfig.test.json, examples/*)
  → vitest run --typecheck                      (root vitest.workspace.ts, one project per package + examples)
publish: pnpm --filter <name> publish            (per package; nothing at the root)
```

### Existing patterns to reuse

- facio-agents' root shape (private root, `packages/*`, explicit vitest projects, `pnpm check`) is adopted as is; it was designed for exactly this.
- facio's `tsconfig.base.json` is the stricter of the two and becomes the shared base; per-package `tsconfig.json` extends `../../tsconfig.base.json` as facio-agents' do today.
- facio-agents' `roadmap/plans/{README.md,_TEMPLATE.md,index.md}` become this repository's; this plan is its first `repo` entry.

### Gaps

- `Not found: a git history for facio-agents inside this repository` - Task 2 uses `git subtree add`, which brings the commits, not a copy.
- `Not found: the daemon` - `packages/facio` after Task 3 is empty on purpose; the root `package.json` stays `name: "facio", private: true` so the word is reserved and nothing is published under it.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | The root is a private workspace (`name: "facio"`, `private: true`); nothing publishes from the root. The published units are `packages/*`, each with its own version | User (2026-09-16): `facio` is the program, not the lib |
| 2 | Order: Task 1 (framework → `packages/facio`, 1:1, name and exports unchanged) → Task 2 (facio-agents imported 1:1 with history) → Task 3 (split and rename) → Task 4 (retire facio-agents). Every task ends green | User: "start by the migration 1:1 then the renaming" |
| 3 | Framework split, one package per sub-path, names: `@facio/commands` (`src/core` + `src/index.ts`: the declaration, the registry, input, context, the argv grammar, coercion, schema), `@facio/terminal` (`src/cli`), `@facio/mcp` (`src/mcp`, sub-paths `./stdio`, `./server`), `@facio/remote`, `@facio/config`, `@facio/yaml`, `@facio/docs`. Six depend on `@facio/commands` (`workspace:^`); `@facio/yaml` depends on nothing; `@facio/mcp` alone carries the optional peer `@modelcontextprotocol/sdk` | Import graph (Recon); user: `cli` would read as a CLI program, which it is not; `src/cli/index.ts` calls itself "the terminal rendering" |
| 4 | The declaration-and-registry package is **`@facio/commands`**: named for what it is (the command), not for its position (`core`, which could be anything). The surfaces render commands; `@facio/agents` runs; `facio` composes. `@facio/actions` was the runner-up and is not taken while the exports are still `Command` / `CommandContext`; `@facio/sdk` stays free for a later contract-only package shared by commands and agents | User (2026-09-16): "core can be anything" |
| 5 | Versions after Task 3: every framework package starts at `0.2.0` (above the last `facio` release); agents packages keep their versions. `facio@0.1.x` on npm is deprecated with `npm deprecate facio@"<1" "split into @facio/commands, @facio/terminal, @facio/mcp, @facio/remote, @facio/config, @facio/yaml, @facio/docs"` when the first `@facio/*` framework package is published (user runs it; the `@facio` npm org must be the user's) | (defaulted) |
| 6 | Layout: `packages/<name>/` per package (`src`, `package.json`, `tsconfig.json`, `tsconfig.test.json`, `README.md`); `examples/commands/` (the framework's five programs + samples, one workspace package `facio-examples-commands`) and `examples/agents/` (facio-agents' scripts, package `facio-examples-agents`); `docs/commands/` (the framework's `01-11`) and `docs/agents/` (empty until written); `roadmap/plans/{repo,commands,agent,cli}/` + `roadmap/{research,specs}` from facio-agents; root `README.md` is the family page, each package keeps its own | User's layout, 2026-09-16 |
| 7 | `files` of a package never reaches outside its folder: `docs` and `ROADMAP.md` leave the framework's `files` list in Task 1 (they are GitHub-relative links in the README already). `ROADMAP.md` stays at the root until its items become plans under `roadmap/plans/commands/` (not in this plan) | (defaulted: `pnpm pack` from a subfolder cannot include `../docs`) |
| 8 | Shared `tsconfig.base.json` is facio's (ES2023, the extra strictness flags, no `DOM`). A package that needs a lib facio's base lacks adds it in its own `tsconfig.json`, with the reason in the task report | (defaulted: one base, the stricter one; the exception is local) |
| 9 | Self-imports by package name inside test files (`from "facio"`, `from "facio/cli"`) stay in Task 1 and are rewritten to the new names in Task 3 with one `sed` per sub-path, listed in that task | Recon counts; CI comment "test files import the package by its own name" |
| 10 | History: Task 2 uses `git subtree add --prefix=incoming <facio-agents> main` (commits preserved, no squash), then `git mv` out of `incoming/`; the user runs the git commands, the dev session prepares everything else and hands over the exact sequence | Repo rule: the user owns commits; `git subtree` writes a merge commit |
| 11 | CI: one workflow, `check` job runs `pnpm check`; `runtimes` job keeps its three-runtime smoke on `examples/commands/dist/petshop/cli.js`; the `pack` step becomes `pnpm -r --filter "./packages/**" pack --pack-destination …` so every publishable package is packed | `ci.yml` |
| 12 | `CLAUDE.md` is the union: facio-agents' rules (they are the newer, fuller set) plus the framework's own conventions taken from its README "Conventions" / ROADMAP (zero dependencies per package, runs on Node/Bun/Deno, `action` is the way in) | (defaulted) |

## Proposed architecture

```
facio/
  package.json                    private workspace root: scripts build/typecheck/test/check/clean/examples
  pnpm-workspace.yaml             packages: [packages/*, examples/*]; allowBuilds: esbuild
  tsconfig.base.json              facio's
  vitest.workspace.ts             explicit projects, typecheck per package
  CLAUDE.md  README.md  ROADMAP.md  LICENSE
  .github/workflows/ci.yml
  packages/
    commands/  terminal/  mcp/  remote/  config/  yaml/  docs/ (Task 3; Task 1-2: packages/facio/)
    agents/  store-file/  model-openai-compat/                (Task 2)
    facio/                                                   (later: the program)
  examples/
    commands/   package.json, tsconfig.json, clerver/ kitchen-sink/ mcp-server/ open-cli/ petshop/ samples/
    agents/     package.json, tsconfig.json, *.ts
  docs/
    commands/   01-getting-started.md … 11-yaml.md, README.md
    agents/
  roadmap/
    plans/      README.md, _TEMPLATE.md, index.md, repo/01-workspace.md, agent/*, cli/*, commands/00-commands.md
    research/   specs/
```

## Phases

### Task 1 - Root becomes a workspace; the framework moves 1:1 to `packages/facio`

- **Files:** `MOVE: src/ → packages/facio/src/`, `MOVE: tsconfig.json, tsconfig.test.json → packages/facio/`, `MOVE: examples/{clerver,kitchen-sink,mcp-server,open-cli,petshop,samples,tsconfig.json} → examples/commands/`, `MOVE: docs/* → docs/commands/`, `CREATE: packages/facio/package.json`, `CREATE: packages/facio/README.md` (copy of the root README, the framework's), `CREATE: examples/commands/package.json`, `CREATE: vitest.workspace.ts`, `UPDATE: package.json` (root), `UPDATE: pnpm-workspace.yaml`, `UPDATE: .github/workflows/ci.yml`, `UPDATE: README.md` (root; only the paths `docs/` → `docs/commands/`, `src/` → `packages/facio/src/`; the family rewrite is Task 3), `UPDATE: .gitignore` (`packages/*/dist`, `examples/*/dist`).
- `packages/facio/package.json`: everything publishable from the root today (`name: "facio"`, `version: 0.1.0`, `description`, `license`, `author`, `funding`, `repository` + `directory: "packages/facio"`, `homepage`, `bugs`, `keywords`, `engines`, `sideEffects`, `main`, `types`, `exports` unchanged, `files: ["dist", "src", "!src/**/*.test.ts", "LICENSE", "README.md"]` (decision 7), `publishConfig`, `peerDependencies` + `peerDependenciesMeta`), scripts:
  ```json
  { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json", "clean": "rm -rf dist" }
  ```
  `devDependencies` for the package's own tests: `@modelcontextprotocol/sdk`, `zod` (the server tests use them); `typescript`, `vitest`, `@types/node`, `@vitest/coverage-v8` stay at the root. `LICENSE` is copied into the package (pack needs it inside the folder).
- `packages/facio/tsconfig.json`: `extends: "../../tsconfig.base.json"`, rest as today. `tsconfig.test.json`: `include: ["src/**/*.test.ts"]` only (examples typecheck themselves).
- `examples/commands/package.json`:
  ```json
  { "name": "facio-examples-commands", "private": true, "type": "module", "engines": { "node": ">=22" },
    "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run", "clean": "rm -rf dist" },
    "dependencies": { "facio": "workspace:*" }, "devDependencies": { "@modelcontextprotocol/sdk": "1.30.0", "zod": "4.3.6" } }
  ```
  `examples/commands/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `rootDir: "."`, `outDir: "dist"`, `types: ["node"]`; `exclude: ["dist", "**/*.test.ts"]`.
- Root `package.json`:
  ```json
  { "name": "facio", "private": true, "type": "module", "packageManager": "pnpm@10.28.0", "engines": { "node": ">=22" },
    "scripts": {
      "build": "pnpm -r --filter \"./packages/**\" run build",
      "typecheck": "pnpm build && pnpm -r run typecheck",
      "test": "pnpm build && vitest run --typecheck",
      "check": "pnpm typecheck && vitest run --typecheck",
      "examples": "pnpm build && pnpm -r --filter \"./examples/**\" run build",
      "coverage": "pnpm build && vitest run --coverage --coverage.include='packages/*/src/**'",
      "clean": "pnpm -r run clean" },
    "devDependencies": { "@types/node": "^22.15.3", "@vitest/coverage-v8": "2.1.9", "typescript": "^5.8.3", "vitest": "^2.1.9" } }
  ```
  (`packageManager` pinned as facio-agents does; CI's `pnpm/action-setup` `version: 11` becomes the pinned one.)
- `pnpm-workspace.yaml`: `packages: ["packages/*", "examples/*"]` + `allowBuilds`.
- `vitest.workspace.ts` (facio-agents' shape):
  ```ts
  const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };
  export default defineWorkspace([
    { test: { name: 'facio', root: 'packages/facio', typecheck } },
    { test: { name: 'examples-commands', root: 'examples/commands' } },
  ]);
  ```
- `ci.yml`: `pnpm run typecheck` → `pnpm typecheck`; `timeout 600 pnpm test`; `pnpm run examples` → `pnpm examples`; pack → `pnpm -r --filter "./packages/**" pack --pack-destination ${{ runner.temp }}`; runtimes job path → `examples/commands/dist/petshop/cli.js`.
- `pnpm install` regenerates `pnpm-lock.yaml` (user commits it).
- **Validation:** `pnpm check` green (same test count as before the move: record it in the report); `pnpm examples` builds; `node examples/commands/dist/petshop/cli.js pet add Rex -a 3 -b corgi` prints Rex; `pnpm --filter facio pack` lists `dist`, `src`, `LICENSE`, `README.md` and nothing outside the package.

### Task 2 - Import facio-agents 1:1, with history

- **Git sequence (user runs; the dev session prepares the moves as a script it can hand over):**
  ```
  git remote add agents F:/github/facio-agents
  git fetch agents
  git subtree add --prefix=incoming agents/main -m "chore(repo) - import facio-agents history"
  ```
- **Files (after the subtree commit, in the working tree):** `MOVE: incoming/packages/{agents,store-file,model-openai-compat} → packages/`, `MOVE: incoming/examples → examples/agents` (its `package.json` renamed `facio-examples-agents`; scripts unchanged), `MOVE: incoming/roadmap/plans/{README.md,_TEMPLATE.md,index.md,agent,cli} → roadmap/plans/`, `MOVE: incoming/roadmap/{research,specs} → roadmap/`, `MOVE: incoming/CLAUDE.md → CLAUDE.md` (merged per decision 12), `DELETE: incoming/{package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tsconfig.base.json,vitest.workspace.ts,LICENSE,README.md}` (README content folded into the root family README in Task 3; keep a copy at `docs/agents/README.md` until then), `DELETE: incoming/` (empty), `UPDATE: vitest.workspace.ts` (+ `@facio/agents`, `@facio/model-openai-compat`, `@facio/store-file` projects with `typecheck`, + `examples-agents`), `UPDATE: roadmap/plans/index.md` (+ `## repo` section with this plan; `## commands` section pointing at `ROADMAP.md`), `CREATE: roadmap/plans/commands/00-commands.md` (domain stub: "items live in `/ROADMAP.md` until planned").
- `packages/{agents,store-file,model-openai-compat}/tsconfig.json` already extend `../../tsconfig.base.json`; they now get facio's base (decision 8). Expected fallout: `lib` no longer has `DOM` (verify `Response` / `fetch` / `AbortSignal` types come from `@types/node`; if a global is missing, add `"lib": ["ES2023", "DOM"]` to that one package's tsconfig and say why), `noImplicitOverride` / `noFallthroughCasesInSwitch` (fix in place; these are correctness flags, not style), `target` ES2022 → ES2023 (no source change expected).
- Plan paths inside the moved plans: `roadmap/plans/cli/01-facio-chat.md` uses `link:../../../textui/packages/<name>` from `packages/chat/` - unchanged depth, still correct. `roadmap/plans/agent/*` refer to `packages/agents/src/...` - unchanged. `examples/*.ts` references become `examples/agents/*.ts` (one `sed` over `roadmap/plans/agent/*.md`, list the hits in the report).
- **Validation:** `pnpm check` green with the sum of both repositories' tests; `pnpm --filter facio-examples-agents run pause-resume` and `ask-user` run; `git log --oneline -- packages/agents/src/run/turn.ts` shows facio-agents' commits.

### Task 3 - Split `packages/facio` into seven packages and rename

- **Files:** `MOVE: packages/facio/src/{core,index.ts} → packages/commands/src/` (`index.ts` stays the entry), `MOVE: packages/facio/src/cli → packages/terminal/src`, `MOVE: packages/facio/src/mcp → packages/mcp/src`, `MOVE: packages/facio/src/remote → packages/remote/src`, `MOVE: packages/facio/src/config → packages/config/src`, `MOVE: packages/facio/src/yaml → packages/yaml/src`, `MOVE: packages/facio/src/docs → packages/docs/src`; `CREATE: packages/<each>/{package.json,tsconfig.json,tsconfig.test.json,README.md,LICENSE}`; `DELETE: packages/facio/` (the folder is recreated by the daemon plan later); `UPDATE: examples/commands/**/*.ts`, `docs/commands/*.md`, every test file (import rewrites), `UPDATE: README.md` (root, the family page), `UPDATE: vitest.workspace.ts`, `UPDATE: .github/workflows/ci.yml` (nothing but the pack glob already covers it; verify), `UPDATE: roadmap/plans/index.md`.
- Per package `package.json` (from `packages/facio/package.json`, fields not listed are dropped): `name`, `version: "0.2.0"`, `description` (the sub-path's header sentence), `license`, `author`, `funding`, `repository` (+ `directory`), `homepage`, `bugs`, `keywords` (trimmed to the surface), `engines`, `sideEffects: false`, `main`, `types`, `exports` (`.` for all; `@facio/mcp` also `./stdio` and `./server`), `files`, `publishConfig`, scripts as Task 1; `dependencies: { "@facio/commands": "workspace:^" }` for terminal, mcp, remote, config, docs; none for commands and yaml; `peerDependencies` + `peerDependenciesMeta` on `@facio/mcp` only; `devDependencies`: `@modelcontextprotocol/sdk` + `zod` on `@facio/mcp` only (its server tests).
- Entry points: `packages/commands/src/index.ts` is today's `src/index.ts` with `./core/` paths unchanged (the folder moves with it). Every other package's `src/index.ts` is the sub-path's index as is.
- Import rewrites (non-test, inside the moved sources): `from "../index.js"` → `from "@facio/commands"` in terminal, mcp, remote, config, docs; `from "../core/coerce.js"` (remote `manifest.ts`, `openapi.ts`) → `from "@facio/commands"` (`JsonSchema` is exported there). Test files and examples/docs, by sub-path: `"facio"` → `"@facio/commands"`, `"facio/cli"` → `"@facio/terminal"`, `"facio/mcp"` → `"@facio/mcp"`, `"facio/mcp/stdio"` → `"@facio/mcp/stdio"`, `"facio/mcp/server"` → `"@facio/mcp/server"`, `"facio/remote"` → `"@facio/remote"`, `"facio/config"` → `"@facio/config"`, `"facio/yaml"` → `"@facio/yaml"`, `"facio/docs"` → `"@facio/docs"` (counts in Recon; the report lists the files touched). `examples/commands/package.json` dependencies become the seven `workspace:*` entries it actually imports.
- `tsconfig.json` per package: `extends: "../../tsconfig.base.json"`, `rootDir: src`, `outDir: dist`, `exclude` tests. Workspace build order follows `dependencies`, so `pnpm -r build` builds commands first; no `references` needed (facio-agents already works this way).
- READMEs: `packages/commands/README.md` is the framework README (from `packages/facio/README.md`) with the package table pointing at sibling packages; each surface package gets a short README (what it is, the import, a link to `docs/commands/<n>.md`). Root `README.md` becomes the family page: one paragraph, a table of packages (`@facio/commands` … `@facio/docs`, `@facio/agents`, `@facio/store-file`, `@facio/model-openai-compat`), links to `docs/commands/`, `docs/agents/`, `roadmap/plans/index.md`; badges per package or none.
- `vitest.workspace.ts`: seven framework projects replace `facio`.
- `roadmap/plans/cli/00-cli.md` and `01-facio-chat.md`: the later "`facio` CLI" mention points at `@facio/terminal` + `packages/facio` (the program); one line each.
- **Validation:** `pnpm check` green, same test count as after Task 2; `pnpm examples` + the petshop smoke; `pnpm -r --filter "./packages/**" pack` produces ten tarballs, each containing only its own `dist`, `src`, `LICENSE`, `README.md`; `grep -rn '"facio"' packages examples docs` finds nothing but the root `package.json` name.

### Task 4 - Retire facio-agents

- User-side, after Task 3 is pushed: archive `softov/facio-agents` on GitHub with its README's first line pointing at `softov/facio`; run the `npm deprecate` of decision 5 when the first framework package is published; remove the `agents` git remote (`git remote remove agents`).
- Dev-side: `UPDATE: docs/agents/README.md` (the former facio-agents README, paths fixed), `UPDATE: CLAUDE.md` "Layout" section to the final tree, `UPDATE: roadmap/plans/index.md` status of this plan.
- The textui plan `roadmap/plans/chat/01-textui-chat.md` mentions `@facio/chat` "in facio-agents" once; change to "in the facio workspace" (textui repo, one line; done from that repo).
- **Validation:** `grep -rn "facio-agents" . --exclude-dir=node_modules --exclude-dir=.git` finds only history notes (this plan, the subtree commit message).

## Cross-layer consistency

| Shape | Source | Consumers |
| --- | --- | --- |
| `tsconfig.base.json` | root | every `packages/*/tsconfig.json`, `examples/*/tsconfig.json` |
| `vitest.workspace.ts` projects | root | `pnpm test`, `pnpm check`, CI |
| `@facio/commands` exports (`JsonSchema`, `Registry`, …) | `packages/commands/src/index.ts` | terminal, mcp, remote, config, docs, examples/commands, later `@facio/agents`' action→Tool bridge |

## Risks and tradeoffs

1. **Two base configs become one, the stricter one.** The agents packages may surface `noImplicitOverride` / missing-`DOM` errors in Task 2; they are fixed there, in place, and listed. The alternative (keep two bases) would make "one workspace" a folder, not a build.
2. **`git subtree add` writes a merge commit with a foreign history.** `git log` on the root shows both lines; `git log -- <path>` on any moved file is clean. Squashing would lose the p1-p3 history the plans cite by commit.
3. **The published `facio` name changes meaning.** At 0.1.x with the deprecate message this is acceptable; the risk is a consumer pinned to `facio@0.1` seeing no updates, which the message addresses.
4. **`@facio/commands` carries the older noun** while `registry.action` is the way in; if the vocabulary question in `ROADMAP.md` is ever answered "action", the package name follows in a release of its own.

## Resume state

- **Done so far:** plan written 2026-09-16. Task 1 done 2026-09-16 (commits `4e328a5`, `14e2524`): workspace root, `packages/facio`, `examples/commands`, `docs/commands`, CI; 292/292 tests, typecheck, examples, petshop smoke, pack contents verified. The 10 tests that failed on win32 before the move (POSIX fixture paths in `config` and `yaml` suites) were fixed on the way, test-side.
- Task 2 done 2026-09-16 (commits `2797acb` subtree import of facio-agents `master`, `ac090ce` moves + merged `CLAUDE.md` + plans index + `commands` domain stub, `dd12935` `.npmrc` / `.env` ignore): 41 test files, 480 tests, no type errors; `pause-resume` and `ask-user` examples run; `git log --follow` reaches facio-agents' commits. Fallout of decision 8: none from the stricter base; one pre-existing type error surfaced in `packages/agents/src/run/{resume,run}.test.ts` (`build` helper typed `tools?: Tool[]`, refused `createAskUserTool()` per decision 67) and was fixed to `Tool<any, any>[]`.
- Task 3 done 2026-09-16 (commit `49a55cd`): seven packages at `0.2.0`; `pnpm check` 41 files / 480 tests / no type errors; petshop smoke; ten tarballs, each `dist` + `src` (tests excluded) + `LICENSE` + `README.md` + `package.json`; no `"facio"` import left. Deviations: (a) `CommandMeta` is now exported from `@facio/commands` (the `declare module` augmentations in `@facio/mcp` and `@facio/remote` targeted the file path before and could only merge with an exported declaration); (b) `@facio/remote` has `@facio/terminal` as a devDependency (`manifest.test.ts` imports it); (c) `mcp/server/package.test.ts` rewritten: it stages `@facio/mcp` with `@facio/commands` under `node_modules` and checks the mcp entry points only, since the other packages' "no dependencies" is now their `dependencies` map; (d) `src/core/` kept as the folder inside `packages/commands/src` per the plan, source comments updated to the new names.
- Task 4 dev side done 2026-09-16: `docs/agents/README.md`, `CLAUDE.md` layout, plans scrubbed of the old repository name and absolute paths (two historical mentions remain in the p1 plan's recon code block on purpose), the textui plan line, the `agents` git remote removed. User side pending: archive `softov/facio-agents`, `npm deprecate facio@"<1"` at first `@facio/commands` publish.
- **Next action:** user runs the Task 4 steps; then CLI-01 (`@facio/chat`) and p5 Tasks 1-4.
- **Open questions:** none.
- **Watch out for:** `pnpm install` must run at the root after every task (the lockfile changes each time; commit it with the task). Do not edit `F:\github\facio-agents` during Task 2; it is the subtree source. `examples/commands` tests import the built package (`dist`), so `pnpm build` precedes `vitest` as in facio-agents' scripts. Keep LF line endings; the repository has no `.gitattributes` (add `* text=auto eol=lf` in Task 1 if a CRLF shows up in the diff).

## Final verification checklist

- [x] After Task 1: `pnpm check`, `pnpm examples`, petshop smoke, `pnpm --filter facio pack` contents.
- [x] After Task 2: `pnpm check` runs both test suites; `git log` follows a moved agents file; `pause-resume` and `ask-user` examples run.
- [x] After Task 3: ten tarballs, each self-contained; no `"facio"` import remains; root README is the family page.
- [ ] After Task 4: facio-agents archived, `npm deprecate` run, no live reference to the old repository.
