import { defineWorkspace } from 'vitest/config';

// Explicit projects instead of directory globs: a glob project gets an empty config and never
// runs *.test-d.ts, even with `vitest run --typecheck` at the root. The typecheck tsconfig must
// not exclude test files (the build tsconfig does), or tsc checks nothing and reports no errors.
const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };

export default defineWorkspace([
  { test: { name: '@cofold/sdk', root: 'packages/sdk', typecheck } },
  { test: { name: '@cofold/commands', root: 'packages/commands', typecheck } },
  { test: { name: '@cofold/terminal', root: 'packages/terminal', typecheck } },
  { test: { name: '@cofold/mcp', root: 'packages/mcp', typecheck } },
  { test: { name: '@cofold/remote', root: 'packages/remote', typecheck } },
  { test: { name: '@cofold/config', root: 'packages/config', typecheck } },
  { test: { name: '@cofold/yaml', root: 'packages/yaml', typecheck } },
  { test: { name: '@cofold/docs', root: 'packages/docs', typecheck } },
  { test: { name: '@cofold/agents', root: 'packages/agents', typecheck } },
  { test: { name: '@cofold/model-openai-compat', root: 'packages/model-openai-compat', typecheck } },
  { test: { name: '@cofold/store-file', root: 'packages/store-file', typecheck } },
  { test: { name: '@cofold/tools', root: 'packages/tools', typecheck } },
  { test: { name: '@cofold/papo', root: 'packages/papo', typecheck } },
  { test: { name: 'examples-commands', root: 'examples/commands' } },
  { test: { name: 'examples-agents', root: 'examples/agents' } },
]);
