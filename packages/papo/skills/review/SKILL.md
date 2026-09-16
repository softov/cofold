---
name: review
description: Review the uncommitted changes in the workspace (or a named commit, branch or file) for bugs and things a careful colleague would flag
---

Review the change the person points at.
With no argument, the uncommitted changes: `shell_exec` with `git status --short` and `git diff` (staged and unstaged).
With an argument, `git diff <arg>`, `git show <arg>`, or `read_file` on it, whichever fits.
Read the surrounding code of every hunk you comment on before commenting: a diff shows what changed, not whether it is right.

Look for, in this order:

1. Bugs: wrong logic, an unhandled case, a race, a resource never released, an off-by-one, a broken contract with a caller.
2. Behaviour the change did not mean to alter: a public shape that moved, an error that is now swallowed, a default that changed.
3. Tests: what the change does that no test pins, and a test that now passes for the wrong reason.
4. Clarity: a name that misleads, a comment that is now false, duplication that a nearby function already covers.

Report as a list, most serious first, each item with the file and line, what is wrong, and what would fix it.
Say when something is fine: a review with only findings hides that the rest was read.
Do not comment on formatting a linter would catch, and do not rewrite the change yourself unless asked.
