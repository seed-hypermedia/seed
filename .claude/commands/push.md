---
name: push
description: Run pre-push checks including typecheck and tests
---

Run pre-push checks before pushing to remote:

1. **Type checking**: run `pnpm typecheck` from the repo root.
2. **Tests**: run `pnpm test` from the repo root.
3. **Build smoke checks**: run `./dev build-desktop` and `pnpm web:prod` when the changed files can affect desktop or
   web builds.
4. **Formatting**: run `pnpm format:write` if the checks or edits touched formatted files.
5. If a check fails, fix it in place and rerun the failed command.
6. Report which checks passed or failed and include any remaining errors.

Do not edit `dev` just to run these checks. Do not amend, pull, or push unless the user explicitly asked for git
changes.
