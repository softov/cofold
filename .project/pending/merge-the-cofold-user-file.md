---
title: Merge the copapo user file into the cofold one
plans:
  - plans/cli/20261111-0517-copapo-uses-the-cofold-names/plan.md
---

# Merge the copapo user file into the cofold one

copapo now reads `~/.config/cofold/config.json` and no longer reads `~/.config/copapo/config.json`. This machine has both: the cofold file from 2026-09-26, with `providers` and `instructions`, and the copapo file from 2026-11-12. The copapo file holds the trust answers and the remembered model, mode and level.

1. Copy each key of `~/.config/copapo/config.json` that the cofold file lacks into `~/.config/cofold/config.json`. Where both have a key, keep the one you use now.
2. Rename any `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL` or `COPAPO_BACKEND` in your shell profile to `COFOLD_*`.
3. Rename a project's `.copapo.json` to `.cofold.json`.
4. Keep `~/.config/copapo/config.json` until ahpd's plan `cofold/20261111-1054-cofold-reads-the-cofold-names` is built, because ahpd's cofold agents read it until then. Delete it after.

## Reply

- Say "done" when the cofold file holds what you use.
