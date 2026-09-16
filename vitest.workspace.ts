import { defineWorkspace } from 'vitest/config';

// Explicit projects instead of directory globs: a glob project gets an empty config and never
// runs *.test-d.ts, even with `vitest run --typecheck` at the root. The typecheck tsconfig must
// not exclude test files (the build tsconfig does), or tsc checks nothing and reports no errors.
const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };

export default defineWorkspace([
  { test: { name: '@facio/sdk', root: 'packages/sdk', typecheck } },
  { test: { name: '@facio/commands', root: 'packages/commands', typecheck } },
  { test: { name: '@facio/terminal', root: 'packages/terminal', typecheck } },
  { test: { name: '@facio/mcp', root: 'packages/mcp', typecheck } },
  { test: { name: '@facio/remote', root: 'packages/remote', typecheck } },
  { test: { name: '@facio/config', root: 'packages/config', typecheck } },
  { test: { name: '@facio/yaml', root: 'packages/yaml', typecheck } },
  { test: { name: '@facio/docs', root: 'packages/docs', typecheck } },
  { test: { name: '@facio/agents', root: 'packages/agents', typecheck } },
  { test: { name: '@facio/model-openai-compat', root: 'packages/model-openai-compat', typecheck } },
  { test: { name: '@facio/store-file', root: 'packages/store-file', typecheck } },
  { test: { name: '@facio/tools', root: 'packages/tools', typecheck } },
  { test: { name: '@facio/papo', root: 'packages/papo', typecheck } },
  { test: { name: 'examples-commands', root: 'examples/commands' } },
  { test: { name: 'examples-agents', root: 'examples/agents' } },
]);
