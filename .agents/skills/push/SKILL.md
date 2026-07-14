---
name: push
description: 'Run pre-push checks including typecheck and tests.'
---

# Push

Follow `AGENTS.md` first. Only run git commands that write state when the user explicitly asks to push or publish this
branch.

Run the following pre-push checks to ensure code quality before pushing to remote:

1. **Type checking**: Run `pnpm typecheck` to check for TypeScript errors.
2. If you find any errors, fix them.
3. Comment these lines in the `dev` file:

   ```
   run("node scripts/cleanup-desktop.js")
   run("./scripts/cleanup-frontend.sh")
   ```

4. **Tests**: Run `./dev build-desktop && pnpm web:prod` to ensure the apps build properly and tests pass.
5. Uncomment the lines in the `dev` file.
6. If there are any changes you made to fix the typecheck, ask before amending the existing commit.
7. Ask before running `git pull`.
8. Ask before running `git push`.
9. **Report results**: Provide a summary of which checks passed or failed.

If any check fails and you cannot fix it, describe that in the report and provide details about the errors so they can
be fixed before pushing.
