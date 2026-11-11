---
title: Publish @cofold/mcp-client for the first time
plans:
  - plans/agent/20261110-1126-copapo-uses-mcp-servers/plan.md
---

# Publish @cofold/mcp-client for the first time

`@cofold/mcp-client` is a new npm name. The release workflow stages only names that exist on npm, so its first version is published by hand, as `@cofold/copapo`'s was.

1. Set `/github/softx/package.json` to `"name": "@cofold/mcp-client"`, `"version": "0.0.1"`, with the description, license, author and `repository.directory: packages/mcp-client` from `packages/mcp-client/package.json`.
2. Run `npm publish --access public` in `/github/softx`.
3. Set GitHub Actions as its trusted publisher with `npm trust github`, as you did for `@cofold/copapo`.
4. Push the next `release-*` tag; the workflow then stages `@cofold/mcp-client` 0.1.0 with `@cofold/copapo`.

`@cofold/copapo` depends on it, so copapo's next release needs it on npm first.

## Reply

- Say "done" when the placeholder is on npm and the trust is set.
