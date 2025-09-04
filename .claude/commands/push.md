---
name: push
description: Run pre-push checks including typecheck and tests
---

Run the following pre-push checks to ensure code quality before pushing to remote:

1. **Type checking**: Run `yarn typecheck` to check for TypeScript errors
2. if you find any errors. fix them.
3. comment this lines in "dev" file:
```
run("node scripts/cleanup-desktop.js")
run("./scripts/cleanup-frontend.sh")
```
4. **Tests**: Run `./dev build-desktop && yarn web:prod` to ensure the apps build properly and tests pass
5. uncomment the lines in the "dev" file.
6. if there are any changes you made to fix the typecheck, commit with `--amend` the changes keeping the same message code. no need to change the commit message, just add the new changed files.
7. git pull
8. git push
9.  **Report results**: Provide a summary of which checks passed or failed

If any checks fails and you cannot fix it, describe that in the report, provide details about the errors so they can be fixed before pushing.