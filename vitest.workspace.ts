import { defineWorkspace } from 'vitest/config';

// Explicit projects instead of directory globs: a glob project gets an empty config and never
// runs *.test-d.ts, even with `vitest run --typecheck` at the root. The typecheck tsconfig must
// not exclude test files (the build tsconfig does), or tsc checks nothing and reports no errors.
const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };

export default defineWorkspace([
  { test: { name: '@doopx/sdk', root: 'packages/sdk', typecheck } },
  { test: { name: '@doopx/commands', root: 'packages/commands', typecheck } },
  { test: { name: '@doopx/terminal', root: 'packages/terminal', typecheck } },
  { test: { name: '@doopx/mcp', root: 'packages/mcp', typecheck } },
  { test: { name: '@doopx/remote', root: 'packages/remote', typecheck } },
  { test: { name: '@doopx/config', root: 'packages/config', typecheck } },
  { test: { name: '@doopx/yaml', root: 'packages/yaml', typecheck } },
  { test: { name: '@doopx/docs', root: 'packages/docs', typecheck } },
  { test: { name: '@doopx/agents', root: 'packages/agents', typecheck } },
  { test: { name: '@doopx/model-openai-compat', root: 'packages/model-openai-compat', typecheck } },
  { test: { name: '@doopx/store-file', root: 'packages/store-file', typecheck } },
  { test: { name: '@doopx/tools', root: 'packages/tools', typecheck } },
  { test: { name: '@doopx/papo', root: 'packages/papo', typecheck } },
  { test: { name: 'examples-commands', root: 'examples/commands' } },
  { test: { name: 'examples-agents', root: 'examples/agents' } },
]);
