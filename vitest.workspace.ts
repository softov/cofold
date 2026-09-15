import { defineWorkspace } from 'vitest/config';

// Explicit projects instead of directory globs: a glob project gets an empty config and never
// runs type tests, even with `vitest run --typecheck` at the root.
const typecheck = { enabled: true, tsconfig: 'tsconfig.test.json' };

export default defineWorkspace([
  { test: { name: 'facio', root: 'packages/facio', typecheck } },
  { test: { name: 'examples-commands', root: 'examples/commands' } },
]);
