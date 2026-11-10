---
name: init
description: Write or refresh AGENTS.md, the notes an agent needs to work in this repository
---

Write `AGENTS.md` at the root of the workspace, or refresh the one there, so that an agent starting cold knows how to work in this repository.

Look before writing: `list_files` for the layout, `read_file` on `package.json` (or the equivalent manifest), the README, any existing `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md`, and the CI configuration.
Run nothing that changes the tree.

Keep it under 60 lines. Cover, in this order, only what is true and not obvious from the tree:

1. What the project is, in one sentence.
2. The commands: build, test, typecheck, lint, run. Exact invocations.
3. The layout: the folders that matter and what lives in each.
4. The conventions a reader cannot guess: naming, where types go, what is generated and must not be edited by hand, how errors are reported.
5. What to read before changing something central.

Do not restate the README. Do not add sections with nothing in them. Do not invent rules; if a convention is unclear, leave it out.

If an `AGENTS.md` exists, keep what is still true, fix what is not, and add what is missing; do not rewrite it from scratch.
Write the file with `write_file`, then say in two lines what changed.
