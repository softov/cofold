import { defineWorkspace } from 'vitest/config';

// Explicit projects instead of directory globs: a glob project gets an empty config and never
// runs *.test-d.ts, even with `vitest run --typecheck` at the root. The typecheck tsconfig must
// not exclude test files (the build tsconfig does), or tsc checks nothing and reports no errors.
const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };

export default defineWorkspace([
  { test: { name: '@facio/agents', root: 'packages/agents', typecheck } },
  { test: { name: '@facio/model-openai-compat', root: 'packages/model-openai-compat', typecheck } },
  { test: { name: 'examples', root: 'examples' } },
]);
